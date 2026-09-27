/**
 * Plan and apply an installation of the skill fleet into a project.
 *
 * The fleet's own files go to .agents/skills/, .agents/references/,
 * .agents/scripts/check-skills.mjs, and .agents/skill-fleet-LICENSE, with a thin
 * adapter per skill for each chosen tool. .agents/skill-fleet.json records a hash of every file written,
 * so an update can tell fleet files from files the project owns or changed.
 *
 * In AGENTS.md and CLAUDE.md the installer owns only the section between the
 * skill-fleet markers. A missing AGENTS.md is created from the setup-project
 * template with the project's name and repository; the rest stays TODO for the
 * setup-project skill. A missing docs/agents/issue-tracker.md is created with
 * the tracker settings the installer knows for certain, such as the board it
 * set up; nothing else in docs/agents/ is written, and an existing file is
 * never changed.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as checks from "./check-skills.mjs";
import { parseRemote } from "./github.mjs";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const DEFAULT_HARNESSES = ["claude", "cursor"];
const AGENTS_TEMPLATE = path.join(ROOT, "skills/setup-project/templates/AGENTS.template.md");
const CLAUDE_NOTE = "<!-- Keep shared instructions in AGENTS.md; this file only imports it for Claude Code. "
  + "Put personal instructions in CLAUDE.local.md, kept out of Git. -->\n";
const IGNORED = new Set([".DS_Store"]);
// The fleet's MIT notice travels with the copies it makes in a project.
export const LICENSE_TARGET = ".agents/skill-fleet-LICENSE";

export function version() {
  return JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")).version;
}

export function skillNames() {
  return fs.readdirSync(path.join(ROOT, "skills"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(ROOT, "skills", entry.name, "SKILL.md")))
    .map((entry) => entry.name)
    .sort();
}

function modeFor(relative) {
  return /(^|\/)scripts\/[^/]+\.mjs$/.test(relative) ? 0o755 : 0o644;
}

/** Map each fleet-managed project path to { content, mode }. */
export function desiredFiles(harnesses) {
  const files = new Map();
  for (const [base, target] of [["skills", checks.CANONICAL], ["references", checks.REFERENCES]]) {
    for (const relative of checks.listFiles(path.join(ROOT, base))) {
      if (relative.split("/").some((part) => IGNORED.has(part))) continue;
      const destination = `${target}/${relative}`;
      files.set(destination, { content: fs.readFileSync(path.join(ROOT, base, relative)), mode: modeFor(destination) });
    }
  }
  files.set(LICENSE_TARGET, { content: fs.readFileSync(path.join(ROOT, "LICENSE")), mode: 0o644 });
  files.set(".agents/scripts/check-skills.mjs", {
    content: fs.readFileSync(path.join(ROOT, "lib/check-skills.mjs")),
    mode: 0o755,
  });
  for (const name of skillNames()) {
    const text = fs.readFileSync(path.join(ROOT, "skills", name, "SKILL.md"), "utf8");
    for (const harness of harnesses) {
      const { dir, fields } = checks.HARNESSES[harness];
      files.set(`${dir}/${name}/SKILL.md`, { content: Buffer.from(checks.adapterText(name, text, fields)), mode: 0o644 });
    }
  }
  return new Map([...files.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

/** Decide what to do with every fleet file. Returns { actions, conflicts }. */
export function plan(project, files, manifest, force) {
  const installed = manifest?.files ?? {};
  const actions = [];
  const conflicts = [];
  for (const [relative, { content }] of files) {
    const file = path.join(project, relative);
    if (!fs.existsSync(file)) {
      actions.push({ action: "create", path: relative });
      continue;
    }
    const current = checks.sha256(fs.readFileSync(file));
    if (current === checks.sha256(content)) {
      actions.push({ action: "unchanged", path: relative });
    } else if (installed[relative] === current) {
      actions.push({ action: "update", path: relative });
    } else {
      const reason = relative in installed ? "changed since the fleet installed it" : "exists and was not installed by the fleet";
      conflicts.push({ path: relative, reason });
      if (force) actions.push({ action: "overwrite", path: relative });
    }
  }
  for (const [relative, digest] of Object.entries(installed).sort()) {
    if (files.has(relative)) continue;
    const file = path.join(project, relative);
    if (!fs.existsSync(file)) continue;
    if (checks.sha256(fs.readFileSync(file)) === digest) {
      actions.push({ action: "delete", path: relative });
    } else {
      conflicts.push({ path: relative, reason: "was removed from the fleet but changed locally; left in place" });
    }
  }
  return { actions, conflicts };
}

/** The skill-fleet section of a project's AGENTS.md. */
export function agentsBlock(harnesses) {
  const folders = harnesses.map((h) => `\`${checks.HARNESSES[h].dir}/\``);
  let adapters;
  if (folders.length === 0) adapters = "No tool needs an adapter; each reads `.agents/skills/` directly.";
  else if (folders.length === 1) adapters = `${folders[0]} holds thin adapters that point to them.`;
  else adapters = `${folders.slice(0, -1).join(", ")} and ${folders.at(-1)} hold thin adapters that point to them.`;
  const lines = [
    "## Agent workflow",
    "",
    `The workflow skills in \`.agents/skills/\` come from the skill fleet. ${adapters}`,
    "",
    "- Work items are GitHub issues on the project board that `docs/agents/issue-tracker.md` names. "
      + "The board is required: when it is missing or incomplete, run `npx skill-fleet@latest update`, "
      + "which creates or repairs it.",
    "- Before planning, implementing, or reviewing work, read the documents in the order "
      + "`docs/agents/domain.md` sets.",
    "- The project settings the skills read live in `docs/agents/`: `issue-tracker.md` holds the "
      + "tracker, board, lifecycle statuses, and routing; `domain.md` the reading order, boundaries, and "
      + "quality weighting; and `verification.md` the commands, evidence, services that need approval, "
      + "and protected files. Change a project fact there, never in a skill.",
    "- `.agents/references/` holds the models the skills share: the software-quality "
      + "characteristics, the GitHub reference rules, the subagent rules, and one guide per platform.",
    "- Whenever you name a GitHub issue, pull request, comment, commit, workflow run, or project "
      + "item, link it as `.agents/references/github-references.md` specifies.",
    "- The usual path through an issue is `start-issue`, then `implement` or `implement-slice`, "
      + "then `verify-work`, `prepare-pr`, and `pr-review`. Run `setup-project` when a skill reports a "
      + "missing or `TODO` setting.",
    "- Do not edit `.agents/skills/`, `.agents/references/`, or the adapters by hand. Update them "
      + "with `npx skill-fleet@latest update`, then run `node .agents/scripts/check-skills.mjs`.",
  ];
  if (harnesses.includes("claude")) {
    lines.push("- Claude Code reads this file through the import in `CLAUDE.md`. Personal "
      + "instructions belong in `CLAUDE.local.md`, kept out of Git.");
  }
  return lines.join("\n") + "\n";
}

/** The skill-fleet section each instruction file should carry. */
export function instructionBodies(harnesses) {
  const bodies = { "AGENTS.md": agentsBlock(harnesses) };
  if (harnesses.includes("claude")) bodies["CLAUDE.md"] = "@AGENTS.md\n";
  return bodies;
}

function git(project, ...args) {
  const result = spawnSync("git", ["-C", project, ...args], { encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : "";
}

/**
 * The canonical form of a path. The native call expands Windows short names,
 * such as RUNNER~1, which Git never reports, and Windows paths ignore case.
 */
export function canonicalPath(target) {
  const real = fs.realpathSync.native(target);
  return process.platform === "win32" ? real.toLowerCase() : real;
}

function samePath(a, b) {
  try {
    return canonicalPath(a) === canonicalPath(b);
  } catch {
    return false;
  }
}

/** Whether the project directory is the top of its own Git repository. */
export function isGitRoot(project) {
  const top = git(project, "rev-parse", "--show-toplevel");
  return Boolean(top) && samePath(top, project);
}

/** The project's name and GitHub repository, from its own Git remote when it has one. */
export function projectIdentity(project) {
  if (isGitRoot(project)) {
    const remote = parseRemote(git(project, "remote", "get-url", "origin"));
    if (remote) {
      const { owner, name } = remote;
      return { name, repository: `[\`${owner}/${name}\`](https://github.com/${owner}/${name})` };
    }
  }
  return { name: path.basename(project), repository: "TODO: `owner/repo`" };
}

function newInstructionFile(name, body, project) {
  if (name === "CLAUDE.md") return `${checks.withBlock("", body)}\n${CLAUDE_NOTE}`;
  const { name: projectName, repository } = projectIdentity(project);
  const text = fs.readFileSync(AGENTS_TEMPLATE, "utf8")
    .replaceAll("{{project_name}}", projectName)
    .replaceAll("{{repository}}", repository);
  return checks.withBlock(text, body);
}

/**
 * Decide what to do with AGENTS.md and CLAUDE.md. Returns { changes,
 * conflicts, notes, blocks }. Each change is { action, path, text }. blocks is
 * the manifest record: the digest of each file's skill-fleet section, or null
 * when the project removed it on purpose.
 */
export function planInstructions(project, harnesses, manifest, force) {
  const recorded = manifest?.blocks ?? {};
  const changes = [];
  const conflicts = [];
  const notes = [];
  const blocks = {};
  for (const [name, body] of Object.entries(instructionBodies(harnesses))) {
    const file = path.join(project, name);
    const text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
    const current = text === null ? null : checks.findBlock(text);
    const digest = checks.sha256(body);
    if (current === null) {
      if (text !== null && name === "CLAUDE.md" && checks.CLAUDE_IMPORT.test(text)) {
        notes.push("CLAUDE.md already imports AGENTS.md, so it stays as it is.");
        continue;
      }
      if (name in recorded && !force) {
        notes.push(`${name} or its skill-fleet section was removed by hand, so it stays out. `
          + "Rerun with --force to restore it.");
        blocks[name] = null;
        continue;
      }
      const updated = text === null
        ? newInstructionFile(name, body, project)
        : checks.withBlock(text, body, name === "CLAUDE.md");
      changes.push({ action: text === null ? "create" : "update", path: name, text: updated });
      blocks[name] = digest;
    } else if (current === body) {
      changes.push({ action: "unchanged", path: name, text: null });
      blocks[name] = digest;
    } else if (recorded[name] === checks.sha256(current)) {
      changes.push({ action: "update", path: name, text: checks.withBlock(text, body) });
      blocks[name] = digest;
    } else {
      conflicts.push({ path: name, reason: "its skill-fleet section was edited by hand" });
      if (force) {
        changes.push({ action: "overwrite", path: name, text: checks.withBlock(text, body) });
        blocks[name] = digest;
      }
    }
  }
  return { changes, conflicts, notes, blocks };
}

function removeEmptyParents(file, stop) {
  let parent = path.dirname(file);
  while (parent !== stop && fs.existsSync(parent) && fs.readdirSync(parent).length === 0) {
    fs.rmdirSync(parent);
    parent = path.dirname(parent);
  }
}

/** Write the planned changes and the manifest. */
export function apply(project, files, installation) {
  const { actions, instructionChanges, blocks, harnesses, instructions, github } = installation;
  for (const { action, path: relative } of actions) {
    const file = path.join(project, relative);
    if (action === "create" || action === "update" || action === "overwrite") {
      const { content, mode } = files.get(relative);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, content);
      fs.chmodSync(file, mode);
    } else if (action === "delete") {
      fs.unlinkSync(file);
      removeEmptyParents(file, project);
    }
  }
  for (const { path: relative, text } of instructionChanges) {
    if (text !== null) fs.writeFileSync(path.join(project, relative), text);
  }
  const manifest = {
    fleet: "skill-fleet",
    version: version(),
    harnesses,
    instructions,
    files: Object.fromEntries([...files].map(([relative, { content }]) => [relative, checks.sha256(content)])),
    blocks: Object.fromEntries(Object.entries(blocks).sort()),
    ...(github ? { github } : {}),
  };
  fs.mkdirSync(path.join(project, ".agents"), { recursive: true });
  fs.writeFileSync(path.join(project, checks.MANIFEST), JSON.stringify(manifest, null, 2) + "\n");
}

/** The origin remote's GitHub repository, when the project is the top of its own Git repository. */
export function projectRemote(project) {
  return isGitRoot(project) ? parseRemote(git(project, "remote", "get-url", "origin")) : null;
}

export const TRACKER = "docs/agents/issue-tracker.md";
const TRACKER_TEMPLATE = path.join(ROOT, "skills/setup-project/templates/issue-tracker.md");

/** Replace the value of each named row in a Markdown settings table. */
export function fillSettings(text, values) {
  let filled = text;
  for (const [setting, value] of Object.entries(values)) {
    const escaped = setting.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    filled = filled.replace(new RegExp(`^\\| ${escaped} \\| .* \\|$`, "m"), () => `| ${setting} | ${value} |`);
  }
  return filled;
}

/** The tracker settings the installer knows for certain, from GitHub and the board it set up. */
export function trackerSettings({ repo, board, inspection, timeZone }) {
  const names = inspection.statusNames;
  const organization = repo.owner.type === "Organization";
  return {
    "Default repository": `\`${repo.nameWithOwner}\`. A bare issue number refers to this repository.`,
    "Owner type": `\`${organization ? "Organization" : "User"}\`.`,
    "Issue types": organization ? "`Resolve from GitHub`." : "`None`. GitHub issue types exist only for organizations.",
    "Fallback repository": `\`${repo.nameWithOwner}\`.`,
    "Project board": `\`${board.title}\` owned by \`${repo.owner.login}\`: ${board.url}`,
    "Status field": "`Status`.",
    "Lifecycle statuses": `new → \`${names.new}\`; started → \`${names.started}\`; in review → \`${names.review}\`; done → \`${names.done}\`.`,
    "Iteration field": `\`${inspection.iterationName}\`.`,
    "Sprint time zone": `\`${timeZone}\`.`,
    "Default base branch": `\`${repo.defaultBranch}\`.`,
  };
}

/** Create docs/agents/issue-tracker.md from the template when it is missing. */
export function seedTracker(project, settings) {
  const file = path.join(project, TRACKER);
  if (fs.existsSync(file)) return false;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, fillSettings(fs.readFileSync(TRACKER_TEMPLATE, "utf8"), settings));
  return true;
}

/** Plan a complete installation without writing anything. */
export function prepare(project, { harnesses, instructions, force, manifest }) {
  const files = desiredFiles(harnesses);
  const { actions, conflicts } = plan(project, files, manifest, force);
  const instructionPlan = instructions
    ? planInstructions(project, harnesses, manifest, force)
    : { changes: [], conflicts: [], notes: [], blocks: {} };
  return {
    files,
    actions,
    instructionChanges: instructionPlan.changes,
    conflicts: [...conflicts, ...instructionPlan.conflicts],
    notes: instructionPlan.notes,
    blocks: instructionPlan.blocks,
    harnesses,
    instructions,
  };
}
