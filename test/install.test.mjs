import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import * as checks from "../lib/check-skills.mjs";
import { main, parseArgs, UsageError } from "../lib/cli.mjs";
import { ROOT, skillNames } from "../lib/install.mjs";
import { FakeGitHub } from "./fake-github.mjs";

const SKILLS = skillNames();

/** Run the command line with scripted answers against a fake GitHub. Resolves to { code, output, asked }. */
async function run(argv, { cwd, interactive = false, answers = {}, github = new FakeGitHub() } = {}) {
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
      if (message.includes("AGENTS.md")) return answers.instructions ?? initial;
      if (message.includes("Overwrite")) return answers.overwrite ?? false;
      if (message.includes("Install gh")) return answers.installGh ?? initial;
      if (message.includes("Log in")) return answers.login ?? initial;
      if (message.includes("scope")) return answers.refresh ?? initial;
      if (message.includes("needs changes")) return answers.repair ?? initial;
      return initial;
    },
    select: async ({ message, choices }) => {
      asked.push(message);
      return answers.board ? answers.board(choices) : choices[0].value;
    },
  };
  const io = { cwd: cwd ?? process.cwd(), stdout: sink, stderr: sink, interactive, prompts, github: github.io() };
  const code = await main(argv, io);
  return { code, output, asked };
}

/** A temporary folder that is a Git repository with a GitHub origin, unless remote is null. */
function tempProject(name = "project", remote = `https://github.com/acme/${name}.git`) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "skill-fleet-"));
  const project = path.join(dir, name);
  fs.mkdirSync(project);
  if (remote !== null) {
    spawnSync("git", ["init", "-q", project]);
    if (remote) spawnSync("git", ["-C", project, "remote", "add", "origin", remote]);
  }
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
    assert.equal(read(project, ".agents/skill-fleet-LICENSE"), fs.readFileSync(path.join(ROOT, "LICENSE"), "utf8"));
    for (const name of SKILLS.filter((skill) => fs.existsSync(path.join(ROOT, "skills", skill, "LICENSE")))) {
      assert.ok(exists(project, `.agents/skills/${name}/LICENSE`), name);
    }
    const manifest = JSON.parse(read(project, checks.MANIFEST));
    assert.deepEqual(manifest.harnesses, ["claude", "cursor"]);
    assert.equal(manifest.instructions, true);
    assert.deepEqual(checks.check(project), []);
    assert.match(output, /setup-project/);
  });

  test("writes only the tracker settings in the profile", async () => {
    await install();
    assert.deepEqual(fs.readdirSync(path.join(project, "docs/agents")), ["issue-tracker.md"]);
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
    assert.deepEqual(fs.readdirSync(project), [".git"]);
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
    spawnSync("git", ["-C", project, "remote", "set-url", "origin", "git@github.com:acme/space-game.git"]);
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
  beforeEach(() => ({ dir, project } = tempProject()));
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

  test("a folder that is not a GitHub repository stops with instructions", async () => {
    for (const remote of [null, "", "https://gitlab.com/acme/app.git"]) {
      const { dir: other, project: plain } = tempProject("plain", remote);
      try {
        const { code, output } = await run(["install", plain], { interactive: true });
        assert.equal(code, 1, String(remote));
        assert.match(output, /must be a GitHub repository/);
        assert.match(output, /gh repo create --source \. --private --push/);
        assert.equal(exists(plain, ".agents"), false);
      } finally {
        fs.rmSync(other, { recursive: true, force: true });
      }
    }
  });
});

describe("GitHub setup", () => {
  let dir;
  let project;
  beforeEach(() => ({ dir, project } = tempProject("space-game")));
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));
  const install = (github, options = {}, ...argv) => run(["install", project, ...argv], { github, ...options });
  const board = (github) => github.boards[0];
  const field = (b, name) => b.fields.find((f) => f.name === name);

  test("creates a linked board with the workflow's statuses and sprints", async () => {
    const github = new FakeGitHub();
    const { code, output } = await install(github);
    assert.equal(code, 0, output);
    assert.match(output, /How the workflow runs/);
    assert.match(output, /Created the project board "space-game Sprints"/);
    const created = board(github);
    assert.ok(github.repo("acme/space-game").linked.has(created.id));
    assert.deepEqual(field(created, "Status").options.map((o) => o.name), ["Todo", "In progress", "In review", "Done"]);
    const sprint = field(created, "Sprint");
    assert.equal(sprint.dataType, "ITERATION");
    assert.equal(sprint.configuration.duration, 14);
    assert.equal(sprint.configuration.startDate, "2026-09-21");
    assert.equal(sprint.configuration.iterations.length, 6);
    assert.equal(sprint.configuration.iterations[1].startDate, "2026-10-05");
    const manifest = JSON.parse(read(project, checks.MANIFEST));
    assert.deepEqual(manifest.github, { repository: "acme/space-game",
      board: { owner: "acme", number: 1, title: "space-game Sprints", url: created.url } });
    const tracker = read(project, "docs/agents/issue-tracker.md");
    assert.match(tracker, /^\| Project board \| `space-game Sprints` owned by `acme`: https:\/\/github\.com\/users\/acme\/projects\/1 \|$/m);
    assert.match(tracker, /^\| Lifecycle statuses \| new → `Todo`; started → `In progress`; in review → `In review`; done → `Done`\. \|$/m);
    assert.match(tracker, /^\| Iteration field \| `Sprint`\. \|$/m);
    assert.match(tracker, /^\| Sprint time zone \| `Europe\/Berlin`\. \|$/m);
    assert.match(tracker, /^\| Owner type \| `User`\. \|$/m);
    assert.match(tracker, /^## Routing/m);
  });

  test("a second install reuses the board and changes nothing on GitHub", async () => {
    const github = new FakeGitHub();
    await install(github);
    const before = github.mutations().length;
    const { code, output } = await install(github);
    assert.equal(code, 0, output);
    assert.equal(github.boards.length, 1);
    assert.equal(github.mutations().length, before);
    assert.doesNotMatch(output, /How the workflow runs/);
  });

  test("an existing linked board is repaired without losing its options", async () => {
    const github = new FakeGitHub();
    const existing = github.addBoard({ title: "Roadmap", linkedTo: "acme/space-game", statuses: ["Todo", "In Progress", "Done"] });
    const ids = field(existing, "Status").options.map((o) => o.id);
    const { code, output, asked } = await install(github, { interactive: true });
    assert.equal(code, 0, output);
    assert.ok(asked.some((q) => q.includes('"Roadmap" needs changes')));
    const options = field(existing, "Status").options;
    assert.deepEqual(options.map((o) => o.name), ["Todo", "In Progress", "Done", "In review"]);
    assert.deepEqual(options.slice(0, 3).map((o) => o.id), ids);
    assert.equal(field(existing, "Sprint").dataType, "ITERATION");
    assert.equal(github.boards.length, 1);
    assert.match(read(project, "docs/agents/issue-tracker.md"), /started → `In Progress`/);
  });

  test("an existing iteration field is kept under its own name", async () => {
    const github = new FakeGitHub();
    github.addBoard({ title: "Board", linkedTo: "acme/space-game", statuses: ["Todo", "In progress", "In review", "Done"],
      iteration: "Iteration" });
    const { code } = await install(github);
    assert.equal(code, 0);
    assert.equal(github.mutations().length, 0);
    assert.match(read(project, "docs/agents/issue-tracker.md"), /^\| Iteration field \| `Iteration`\. \|$/m);
  });

  test("declining the repair stops before writing anything", async () => {
    const github = new FakeGitHub();
    github.addBoard({ title: "Roadmap", linkedTo: "acme/space-game" });
    const { code, output } = await install(github, { interactive: true, answers: { repair: false } });
    assert.equal(code, 1);
    assert.match(output, /needs those changes/);
    assert.equal(github.mutations().length, 0);
    assert.equal(exists(project, ".agents"), false);
  });

  test("several linked boards need a choice", async () => {
    const github = new FakeGitHub();
    github.addBoard({ title: "One", linkedTo: "acme/space-game" });
    github.addBoard({ title: "Two", linkedTo: "acme/space-game" });
    const refused = await install(github);
    assert.equal(refused.code, 1);
    assert.match(refused.output, /Choose one with --board: #1 "One", #2 "Two"/);
    const chosen = await install(github, { interactive: true, answers: { board: (choices) => choices[1].value } });
    assert.equal(chosen.code, 0, chosen.output);
    assert.equal(JSON.parse(read(project, checks.MANIFEST)).github.board.title, "Two");
  });

  test("--board links one of the owner's boards", async () => {
    const github = new FakeGitHub();
    const other = github.addBoard({ title: "Team board", statuses: ["Todo", "In progress", "In review", "Done"],
      iteration: "Sprint" });
    const { code, output } = await install(github, {}, "--board", "Team board");
    assert.equal(code, 0, output);
    assert.ok(github.repo("acme/space-game").linked.has(other.id));
    assert.match(output, /Linked the project board "Team board"/);
    assert.equal(github.boards.length, 1);
  });

  test("with no linked board, a user can pick one of the owner's boards", async () => {
    const github = new FakeGitHub();
    const other = github.addBoard({ title: "Team board", statuses: ["Todo", "In progress", "In review", "Done"],
      iteration: "Sprint" });
    const { code, asked } = await install(github, { interactive: true,
      answers: { board: (choices) => choices.find((c) => c.value?.title === "Team board").value } });
    assert.equal(code, 0);
    assert.ok(asked.some((q) => q.startsWith("No project board is linked")));
    assert.ok(github.repo("acme/space-game").linked.has(other.id));
  });

  test("a dry run changes nothing on GitHub", async () => {
    const github = new FakeGitHub();
    const { code, output } = await install(github, {}, "--dry-run");
    assert.equal(code, 0);
    assert.match(output, /would create the project board "space-game Sprints" owned by acme, linked to acme\/space-game/);
    assert.match(output, /would create docs\/agents\/issue-tracker\.md/);
    assert.equal(github.mutations().length, 0);
    assert.equal(exists(project, ".agents"), false);
  });

  test("an existing tracker file is left alone, with a note when it names another board", async () => {
    fs.mkdirSync(path.join(project, "docs/agents"), { recursive: true });
    fs.writeFileSync(path.join(project, "docs/agents/issue-tracker.md"), "# Mine\n");
    const { code, output } = await install(new FakeGitHub());
    assert.equal(code, 0);
    assert.equal(read(project, "docs/agents/issue-tracker.md"), "# Mine\n");
    assert.match(output, /does not name the board "space-game Sprints"/);
  });

  test("a missing gh stops with the install command, or installs it when accepted", async () => {
    const refused = await install(new FakeGitHub({ installed: false }));
    assert.equal(refused.code, 1);
    assert.match(refused.output, /Install the GitHub CLI with brew install gh/);
    assert.equal(exists(project, ".agents"), false);
    const github = new FakeGitHub({ installed: false });
    const accepted = await install(github, { interactive: true });
    assert.equal(accepted.code, 0, accepted.output);
    assert.deepEqual(github.runs, [["brew", "install", "gh"]]);
    const linux = await install(new FakeGitHub({ installed: false, platform: "linux", programs: [] }), { interactive: true });
    assert.equal(linux.code, 1);
    assert.match(linux.output, /follow https:\/\/cli\.github\.com/);
    assert.ok(!linux.asked.some((q) => q.includes("Install gh")));
  });

  test("winget installs gh on Windows", async () => {
    const github = new FakeGitHub({ installed: false, platform: "win32", programs: ["winget"] });
    assert.equal((await install(github, { interactive: true })).code, 0);
    assert.deepEqual(github.runs[0].slice(0, 4), ["winget", "install", "--id", "GitHub.cli"]);
  });

  test("a missing login stops, or logs in when accepted", async () => {
    const refused = await install(new FakeGitHub({ loggedIn: false }));
    assert.equal(refused.code, 1);
    assert.match(refused.output, /gh auth login --scopes project/);
    const github = new FakeGitHub({ loggedIn: false });
    const accepted = await install(github, { interactive: true });
    assert.equal(accepted.code, 0, accepted.output);
    assert.ok(github.calls.some((c) => c.args.slice(0, 2).join(" ") === "auth login"));
  });

  test("a login without the project scope is refreshed when accepted", async () => {
    const refused = await install(new FakeGitHub({ scopes: ["repo", "read:org"] }));
    assert.equal(refused.code, 1);
    assert.match(refused.output, /gh auth refresh --scopes project/);
    const github = new FakeGitHub({ scopes: ["repo", "read:org"] });
    const accepted = await install(github, { interactive: true });
    assert.equal(accepted.code, 0, accepted.output);
    assert.ok(github.scopes.includes("project"));
  });

  test("an organization records that issue types exist", async () => {
    await install(new FakeGitHub({ ownerType: "Organization" }));
    const tracker = read(project, "docs/agents/issue-tracker.md");
    assert.match(tracker, /^\| Owner type \| `Organization`\. \|$/m);
    assert.match(tracker, /^\| Issue types \| `Resolve from GitHub`\. \|$/m);
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
