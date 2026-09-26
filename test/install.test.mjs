import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import * as checks from "../lib/check-skills.mjs";
import { main, parseArgs, UsageError } from "../lib/cli.mjs";
import { ROOT, skillNames } from "../lib/install.mjs";

const SKILLS = skillNames();

/** Run the command line with scripted answers. Resolves to { code, output }. */
async function run(argv, { cwd, interactive = false, answers = {} } = {}) {
  let output = "";
  const sink = { write: (text) => { output += text; } };
  const asked = [];
  const prompts = {
    checkbox: async ({ message, choices }) => {
      asked.push(message);
      return answers.tools ?? choices.filter((c) => c.checked).map((c) => c.value);
    },
    confirm: async ({ message, initial }) => {
      asked.push(message);
      if (message.includes("Git repository")) return answers.notGit ?? true;
      if (message.includes("AGENTS.md")) return answers.instructions ?? initial;
      if (message.includes("Overwrite")) return answers.overwrite ?? false;
      return initial;
    },
  };
  const code = await main(argv, { cwd: cwd ?? process.cwd(), stdout: sink, stderr: sink, interactive, prompts });
  return { code, output, asked };
}

function tempProject(name = "project") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "skill-fleet-"));
  const project = path.join(dir, name);
  fs.mkdirSync(project);
  return { dir, project };
}

const read = (project, relative) => fs.readFileSync(path.join(project, relative), "utf8");
const exists = (project, relative) => fs.existsSync(path.join(project, relative));

describe("install", () => {
  let dir;
  let project;
  beforeEach(() => ({ dir, project } = tempProject()));
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));
  const install = (...argv) => run(["install", project, ...argv]);

  test("writes skills, references, adapters, the checker, and the manifest", async () => {
    const { code, output } = await install();
    assert.equal(code, 0, output);
    for (const name of SKILLS) {
      assert.ok(exists(project, `.agents/skills/${name}/SKILL.md`));
      assert.ok(exists(project, `.claude/skills/${name}/SKILL.md`));
      assert.ok(exists(project, `.cursor/skills/${name}/SKILL.md`));
    }
    assert.equal(exists(project, ".kiro"), false);
    assert.ok(exists(project, ".agents/references/platforms/game.md"));
    assert.ok(exists(project, ".agents/scripts/check-skills.mjs"));
    const manifest = JSON.parse(read(project, checks.MANIFEST));
    assert.deepEqual(manifest.harnesses, ["claude", "cursor"]);
    assert.equal(manifest.instructions, true);
    assert.deepEqual(checks.check(project), []);
    assert.match(output, /setup-project/);
  });

  test("never writes the profile", async () => {
    await install();
    assert.equal(exists(project, "docs"), false);
  });

  test("scripts stay executable", { skip: process.platform === "win32" }, async () => {
    await install();
    const mode = fs.statSync(path.join(project, ".agents/skills/sprint-status/scripts/sprint-data.mjs")).mode;
    assert.ok(mode & 0o100);
  });

  test("a second install changes nothing", async () => {
    await install();
    const { code, output } = await install();
    assert.equal(code, 0, output);
    assert.match(output, /: \d+ unchanged\./);
  });

  test("adapters copy only the fields each tool reads", async () => {
    await install("--claude", "--cursor", "--kiro");
    const claude = read(project, ".claude/skills/sprint-status/SKILL.md");
    assert.match(claude, /allowed-tools:/);
    assert.doesNotMatch(read(project, ".cursor/skills/sprint-status/SKILL.md"), /allowed-tools:/);
    assert.doesNotMatch(read(project, ".kiro/skills/sprint-status/SKILL.md"), /allowed-tools:/);
    assert.ok(claude.endsWith(
      "Read `../../../.agents/skills/sprint-status/SKILL.md` and follow that canonical workflow in full.\n"));
  });

  test("a local change to a fleet file blocks the update until forced", async () => {
    await install();
    const edited = path.join(project, ".agents/skills/tdd/SKILL.md");
    fs.appendFileSync(edited, "\nLocal edit.\n");
    const blocked = await install();
    assert.equal(blocked.code, 1);
    assert.match(blocked.output, /changed since the fleet installed it/);
    assert.match(fs.readFileSync(edited, "utf8"), /Local edit\./);
    assert.ok(checks.check(project).some((e) => e.includes("tdd/SKILL.md")));
    const forced = await install("--force");
    assert.equal(forced.code, 0);
    assert.doesNotMatch(fs.readFileSync(edited, "utf8"), /Local edit\./);
  });

  test("never overwrites skills from another workflow", async () => {
    const foreign = path.join(project, ".agents/skills/start-issue/SKILL.md");
    fs.mkdirSync(path.dirname(foreign), { recursive: true });
    fs.writeFileSync(foreign, "---\nname: start-issue\ndescription: A project's own version.\n---\n\nBody.\n");
    const { code, output } = await install();
    assert.equal(code, 1);
    assert.match(output, /was not installed by the fleet/);
    assert.match(fs.readFileSync(foreign, "utf8"), /A project's own version\./);
    assert.equal(exists(project, checks.MANIFEST), false);
    assert.equal(exists(project, ".agents/skills/tdd"), false);
  });

  test("dropping a tool removes its adapters", async () => {
    await install("--claude", "--kiro");
    assert.ok(exists(project, ".kiro/skills/tdd/SKILL.md"));
    const { code, output } = await install("--claude");
    assert.equal(code, 0, output);
    assert.equal(exists(project, ".kiro"), false);
    assert.ok(exists(project, ".claude/skills/tdd/SKILL.md"));
    assert.deepEqual(checks.check(project), []);
  });

  test("an update keeps the installed tools", async () => {
    await install("--cursor");
    await run(["update", project]);
    assert.equal(exists(project, ".claude"), false);
    assert.ok(exists(project, ".cursor/skills/tdd/SKILL.md"));
  });

  test("update stops when nothing is installed", async () => {
    const { code, output } = await run(["update", project]);
    assert.equal(code, 1);
    assert.match(output, /not installed/);
  });

  test("a dry run writes nothing", async () => {
    const { code, output } = await install("--dry-run");
    assert.equal(code, 0);
    assert.match(output, /would create/);
    assert.deepEqual(fs.readdirSync(project), []);
  });

  test("refuses to install into the fleet itself", async () => {
    const { code, output } = await run(["install", path.join(ROOT, "skills")]);
    assert.equal(code, 1);
    assert.match(output, /not into the skill fleet itself/);
  });

  test("the project defaults to the current directory", async () => {
    const { code } = await run(["--yes"], { cwd: project });
    assert.equal(code, 0);
    assert.ok(exists(project, ".agents/skills/tdd/SKILL.md"));
  });

  test("upgrades a project installed by the Python version of the fleet", async () => {
    await install();
    // Recreate the files the Python installer wrote, recorded in its manifest.
    const manifest = JSON.parse(read(project, checks.MANIFEST));
    delete manifest.instructions;
    const old = {
      ".agents/scripts/check_skills.py": "# old checker\n",
      ".agents/skills/sprint-status/scripts/sprint_data.py": "# old collector\n",
      ".agents/skills/sprint-recap/scripts/test_sprint_recap.py": "# old tests\n",
    };
    for (const [relative, content] of Object.entries(old)) {
      fs.writeFileSync(path.join(project, relative), content);
      manifest.files[relative] = checks.sha256(content);
    }
    fs.writeFileSync(path.join(project, checks.MANIFEST), JSON.stringify(manifest));
    const { code, output } = await install();
    assert.equal(code, 0, output);
    for (const relative of Object.keys(old)) assert.equal(exists(project, relative), false, relative);
    assert.deepEqual(checks.check(project), []);
  });
});

describe("AGENTS.md and CLAUDE.md", () => {
  let dir;
  let project;
  beforeEach(() => ({ dir, project } = tempProject("demo-game")));
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));
  const install = (...argv) => run(["install", project, ...argv]);

  test("new files name the project from its Git remote", async () => {
    spawnSync("git", ["init", "-q", project]);
    spawnSync("git", ["-C", project, "remote", "add", "origin", "git@github.com:acme/space-game.git"]);
    const { code, output } = await install();
    assert.equal(code, 0, output);
    const agents = read(project, "AGENTS.md");
    assert.ok(agents.startsWith("# space-game\n"));
    assert.ok(agents.includes("[`acme/space-game`](https://github.com/acme/space-game)"));
    assert.match(checks.findBlock(agents), /## Agent workflow/);
    assert.match(output, /fill the TODOs in AGENTS\.md/);
    assert.equal(checks.findBlock(read(project, "CLAUDE.md")), "@AGENTS.md\n");
    assert.deepEqual(checks.check(project), []);
  });

  test("without a remote the repository stays TODO", async () => {
    await install();
    const agents = read(project, "AGENTS.md");
    assert.ok(agents.startsWith("# demo-game\n"));
    assert.match(agents, /Repository: TODO/);
  });

  test("an existing AGENTS.md keeps its content", async () => {
    fs.writeFileSync(path.join(project, "AGENTS.md"), "# Mine\n\nKeep this rule.\n");
    fs.mkdirSync(path.join(project, "docs/agents"), { recursive: true });
    for (const name of ["issue-tracker.md", "domain.md", "verification.md"]) {
      fs.writeFileSync(path.join(project, "docs/agents", name), "Filled.\n");
    }
    const first = await install();
    let agents = read(project, "AGENTS.md");
    assert.ok(agents.startsWith("# Mine\n\nKeep this rule.\n\n<!-- skill-fleet:begin"));
    assert.doesNotMatch(first.output, /Next:/);
    const { code, output } = await install("--claude", "--cursor", "--kiro");
    assert.equal(code, 0, output);
    agents = read(project, "AGENTS.md");
    assert.match(checks.findBlock(agents), /`\.kiro\/skills\/`/);
    assert.ok(agents.startsWith("# Mine\n\nKeep this rule.\n"));
    assert.equal(agents.split("skill-fleet:begin").length, 2);
  });

  test("a hand-edited section blocks the update until forced", async () => {
    await install();
    const edited = read(project, "AGENTS.md").replace("## Agent workflow", "## Agent workflow, edited");
    fs.writeFileSync(path.join(project, "AGENTS.md"), edited);
    const blocked = await install("--claude");
    assert.equal(blocked.code, 1);
    assert.match(blocked.output, /AGENTS\.md: its skill-fleet section was edited by hand/);
    assert.equal(read(project, "AGENTS.md"), edited);
    assert.ok(exists(project, ".cursor"));
    assert.ok(checks.check(project).some((e) => e.includes("changed since install")));
    assert.equal((await install("--force")).code, 0);
    assert.doesNotMatch(read(project, "AGENTS.md"), /edited/);
  });

  test("a removed section stays removed", async () => {
    await install();
    fs.writeFileSync(path.join(project, "AGENTS.md"), checks.withoutBlock(read(project, "AGENTS.md")));
    const { code, output } = await install();
    assert.equal(code, 0, output);
    assert.match(output, /removed by hand, so it stays out/);
    assert.equal(checks.findBlock(read(project, "AGENTS.md")), null);
    assert.deepEqual(checks.check(project), []);
    await install("--force");
    assert.notEqual(checks.findBlock(read(project, "AGENTS.md")), null);
  });

  test("an existing Claude import is left alone", async () => {
    fs.writeFileSync(path.join(project, "CLAUDE.md"), "@AGENTS.md\n\nMy notes.\n");
    await install();
    assert.equal(read(project, "CLAUDE.md"), "@AGENTS.md\n\nMy notes.\n");
    assert.deepEqual(checks.check(project), []);
  });

  test("a CLAUDE.md without the import gets it first", async () => {
    fs.writeFileSync(path.join(project, "CLAUDE.md"), "# Old Claude notes\n");
    await install();
    const claude = read(project, "CLAUDE.md");
    assert.ok(claude.startsWith("<!-- skill-fleet:begin"));
    assert.ok(claude.endsWith("\n# Old Claude notes\n"));
  });

  test("without Claude Code no CLAUDE.md is written", async () => {
    await install("--cursor");
    assert.equal(exists(project, "CLAUDE.md"), false);
    const block = checks.findBlock(read(project, "AGENTS.md"));
    assert.match(block, /`\.cursor\/skills\/` holds thin adapters/);
    assert.doesNotMatch(block, /CLAUDE\.md/);
  });

  test("--no-instructions leaves both files alone and is remembered", async () => {
    await install("--no-instructions");
    assert.equal(exists(project, "AGENTS.md"), false);
    assert.equal(exists(project, "CLAUDE.md"), false);
    assert.deepEqual(checks.check(project), []);
    await run(["update", project]);
    assert.equal(exists(project, "AGENTS.md"), false);
  });

  test("the checker reports a lost Claude import", async () => {
    await install();
    fs.writeFileSync(path.join(project, "CLAUDE.md"), "Nothing here.\n");
    const errors = checks.check(project);
    assert.ok(errors.includes("the skill-fleet section in CLAUDE.md is missing. Reinstall to restore it."));
    assert.ok(errors.some((e) => e.includes("does not import AGENTS.md")));
  });
});

describe("questions", () => {
  let dir;
  let project;
  beforeEach(() => {
    ({ dir, project } = tempProject());
    spawnSync("git", ["init", "-q", project]);
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));
  const ask = (answers, ...argv) => run(["install", project, ...argv], { interactive: true, answers });

  test("the chosen tools decide the adapters", async () => {
    const { code, asked } = await ask({ tools: ["kiro"] });
    assert.equal(code, 0);
    assert.ok(asked[0].startsWith("Which coding tools"));
    assert.ok(exists(project, ".kiro/skills/tdd/SKILL.md"));
    assert.equal(exists(project, ".claude"), false);
    assert.equal(exists(project, "CLAUDE.md"), false);
  });

  test("declining the instruction files leaves them alone", async () => {
    await ask({ instructions: false });
    assert.equal(exists(project, "AGENTS.md"), false);
    assert.equal(JSON.parse(read(project, checks.MANIFEST)).instructions, false);
  });

  test("flags skip their questions", async () => {
    const { asked } = await ask({}, "--cursor", "--no-instructions");
    assert.deepEqual(asked, []);
  });

  test("--yes asks nothing", async () => {
    const { asked, code } = await ask({}, "--yes");
    assert.equal(code, 0);
    assert.deepEqual(asked, []);
  });

  test("a conflict asks before overwriting", async () => {
    await ask({});
    const edited = path.join(project, ".agents/skills/tdd/SKILL.md");
    fs.appendFileSync(edited, "\nLocal edit.\n");
    const refused = await ask({ overwrite: false });
    assert.equal(refused.code, 1);
    assert.match(fs.readFileSync(edited, "utf8"), /Local edit\./);
    const accepted = await ask({ overwrite: true });
    assert.equal(accepted.code, 0);
    assert.doesNotMatch(fs.readFileSync(edited, "utf8"), /Local edit\./);
  });

  test("a directory outside Git asks first", async () => {
    const { dir: other, project: plain } = tempProject();
    try {
      const { code, output } = await run(["install", plain], { interactive: true, answers: { notGit: false } });
      assert.equal(code, 1);
      assert.match(output, /Cancelled/);
      assert.deepEqual(fs.readdirSync(plain), []);
    } finally {
      fs.rmSync(other, { recursive: true, force: true });
    }
  });
});

describe("check and list", () => {
  let dir;
  let project;
  beforeEach(async () => {
    ({ dir, project } = tempProject());
    await run(["install", project]);
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  test("the installed checker runs on its own", () => {
    const result = spawnSync(process.execPath, [path.join(project, ".agents/scripts/check-skills.mjs")],
      { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /skills, adapters for claude, cursor, and links check out/);
  });

  test("adapter drift is reported", () => {
    const adapter = path.join(project, ".cursor/skills/implement/SKILL.md");
    fs.writeFileSync(adapter, fs.readFileSync(adapter, "utf8").replace("canonical workflow", "workflow"));
    assert.ok(checks.check(project).includes("cursor adapter for implement differs from the canonical skill"));
  });

  test("missing and stray adapters are reported", () => {
    fs.unlinkSync(path.join(project, ".claude/skills/teach/SKILL.md"));
    const stray = path.join(project, ".claude/skills/old-skill/SKILL.md");
    fs.mkdirSync(path.dirname(stray));
    fs.writeFileSync(stray, "stray");
    const errors = checks.check(project);
    assert.ok(errors.includes("missing claude adapter for teach"));
    assert.ok(errors.includes("unexpected claude skill file: .claude/skills/old-skill/SKILL.md"));
  });

  test("a broken reference link is reported", () => {
    fs.unlinkSync(path.join(project, ".agents/references/github-references.md"));
    assert.ok(checks.check(project).some((e) => e.includes("broken link to ../../references/github-references.md")));
  });

  test("frontmatter rules are enforced", () => {
    const skill = path.join(project, ".agents/skills/bad-skill");
    fs.mkdirSync(skill);
    fs.writeFileSync(path.join(skill, "SKILL.md"), "---\nname: other\ndescription: x\n---\n\nBody.\n");
    assert.ok(checks.check(project).includes('bad-skill: frontmatter name "other" does not match its folder'));
  });

  test("check and list run from the command line", async () => {
    assert.equal((await run(["check", project])).code, 0);
    const { code, output } = await run(["list"]);
    assert.equal(code, 0);
    for (const name of SKILLS) assert.match(output, new RegExp(`^${name} `, "m"));
  });
});

describe("arguments and frontmatter", () => {
  test("tools come from flags or a list", () => {
    assert.deepEqual(parseArgs(["--cursor", "--claude"]).tools, ["cursor", "claude"]);
    assert.deepEqual(parseArgs(["--tools", "claude,kiro"]).tools, ["claude", "kiro"]);
    assert.deepEqual(parseArgs(["--tools=none"]).tools, []);
    assert.throws(() => parseArgs(["--tools", "codex"]), UsageError);
  });

  test("the command and project are positional", () => {
    assert.equal(parseArgs([]).command, "install");
    assert.equal(parseArgs(["./app"]).project, "./app");
    assert.deepEqual([parseArgs(["update", "./app"]).command, parseArgs(["update", "./app"]).project],
      ["update", "./app"]);
    assert.throws(() => parseArgs(["check", "--force"]), UsageError);
    assert.throws(() => parseArgs(["--nope"]), UsageError);
  });

  test("quoted and plain frontmatter values", () => {
    const [fields, body] = checks.splitFrontmatter(
      '---\nname: a\ndescription: "Say \\"hi\\"; ok"\nallowed-tools: Bash, Read\n---\n\nBody\n');
    const values = Object.fromEntries(fields.map(([key, raw]) => [key, checks.scalar(raw)]));
    assert.equal(values.description, 'Say "hi"; ok');
    assert.equal(values["allowed-tools"], "Bash, Read");
    assert.equal(body, "\nBody\n");
  });

  test("missing frontmatter is an error", () => {
    assert.throws(() => checks.splitFrontmatter("# No frontmatter\n"));
  });
});
