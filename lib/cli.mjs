/**
 * The skill-fleet command line: install, update, check, and list.
 *
 * main() takes every terminal dependency through its io argument, so tests can
 * answer the questions without a terminal.
 */

import fs from "node:fs";
import path from "node:path";
import * as checks from "./check-skills.mjs";
import * as fleet from "./install.mjs";
import { bold, CancelledError, checkbox, confirm, cyan, dim, green, yellow } from "./prompts.mjs";

const COMMANDS = ["install", "update", "check", "list", "help"];
const TOOLS = Object.keys(checks.HARNESSES);
const PROFILE = ["issue-tracker.md", "domain.md", "verification.md"];

export class UsageError extends Error {}

export function parseArgs(argv) {
  const options = {
    command: null, project: null, tools: null, instructions: null,
    yes: false, force: false, dryRun: false, help: false, version: false,
  };
  const positional = [];
  const addTools = (list) => {
    const names = list.split(",").map((name) => name.trim().toLowerCase()).filter(Boolean);
    options.tools ??= [];
    for (const name of names) {
      if (name === "none") continue;
      if (!TOOLS.includes(name)) {
        throw new UsageError(`Unknown tool: ${name}. Choose from ${TOOLS.join(", ")}, or none. `
          + "Codex and OpenCode need no adapter.");
      }
      if (!options.tools.includes(name)) options.tools.push(name);
    }
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--version" || arg === "-v") options.version = true;
    else if (arg === "--yes" || arg === "-y") options.yes = true;
    else if (arg === "--force" || arg === "-f") options.force = true;
    else if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--instructions") options.instructions = true;
    else if (arg === "--no-instructions") options.instructions = false;
    else if (TOOLS.some((tool) => arg === `--${tool}`)) addTools(arg.slice(2));
    else if (arg.startsWith("--tools=")) addTools(arg.slice("--tools=".length));
    else if (arg === "--tools") {
      if (index + 1 >= argv.length) throw new UsageError("--tools needs a list, such as --tools claude,cursor.");
      index += 1;
      addTools(argv[index]);
    } else if (arg.startsWith("-")) throw new UsageError(`Unknown option: ${arg}. Run skill-fleet --help for usage.`);
    else positional.push(arg);
  }
  if (positional.length && COMMANDS.includes(positional[0])) options.command = positional.shift();
  options.command ??= "install";
  if (positional.length > 1) throw new UsageError(`Unexpected argument: ${positional[1]}.`);
  options.project = positional[0] ?? null;
  const installOnly = options.tools !== null || options.instructions !== null || options.yes || options.force
    || options.dryRun;
  if (!["install", "update"].includes(options.command) && installOnly) {
    throw new UsageError(`${options.command} takes no install options.`);
  }
  if (options.command === "list" && options.project) throw new UsageError("list takes no project.");
  return options;
}

export function helpText() {
  return `${bold("skill-fleet")} ${fleet.version()}

Install workflow skills for coding agents into a project, and keep them up to date.

${bold("Usage")}
  npx skill-fleet@latest [install] [project] [options]
  npx skill-fleet@latest update [project] [options]
  npx skill-fleet@latest check [project]
  npx skill-fleet@latest list

  With pnpm, Yarn, or Bun, use pnpm dlx, yarn dlx, or bunx instead of npx.
  The project defaults to the current directory.

${bold("Commands")}
  install   Install the skills, or update an existing installation (default)
  update    Update an existing installation; stops when there is none
  check     Check a project's skills, adapters, and skill-fleet sections
  list      List the skills

${bold("Options for install and update")}
  --claude, --cursor, --kiro   Write adapters for these tools and skip the tools question
  --tools <list>               The same as a comma-separated list, such as claude,cursor, or none
  --instructions               Create or update AGENTS.md and CLAUDE.md without asking
  --no-instructions            Leave AGENTS.md and CLAUDE.md alone
  -y, --yes                    Ask nothing: keep the installed choices, or use Claude Code,
                               Cursor, and the instruction files on a first install
  -f, --force                  Overwrite conflicting files without asking
  --dry-run                    Show what would change and write nothing
  -h, --help                   Show this help
  -v, --version                Show the version

Codex and OpenCode read .agents/skills/ directly and need no adapter.
Without a terminal, such as in CI, skill-fleet asks nothing and behaves as with --yes.
`;
}

function isInside(child, parent) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function summary(counts) {
  const order = ["create", "update", "overwrite", "delete", "unchanged"];
  return order.filter((action) => counts[action]).map((action) => `${counts[action]} ${action}`).join(", ")
    || "no files";
}

async function askTools(io, current) {
  io.stdout.write(dim("Codex and OpenCode read .agents/skills/ directly and need no adapter.\n"));
  return io.prompts.checkbox({
    message: "Which coding tools should get skill adapters?",
    choices: TOOLS.map((tool) => ({
      label: checks.HARNESSES[tool].label,
      value: tool,
      hint: `${checks.HARNESSES[tool].dir}/`,
      checked: current.includes(tool),
    })),
  });
}

function printConflicts(io, conflicts, heading) {
  io.stdout.write(`${yellow(heading)}\n`);
  for (const { path: relative, reason } of conflicts) io.stdout.write(`  ${relative}: ${reason}\n`);
}

function nextSteps(io, project) {
  const missing = PROFILE.filter((name) => !fs.existsSync(path.join(project, "docs/agents", name)))
    .map((name) => `docs/agents/${name}`);
  const agents = path.join(project, "AGENTS.md");
  const todo = fs.existsSync(agents) && checks.withoutBlock(fs.readFileSync(agents, "utf8")).includes("TODO");
  const work = [];
  if (missing.length) work.push(`create ${missing.join(", ")}`);
  if (todo) work.push("fill the TODOs in AGENTS.md");
  if (work.length) {
    io.stdout.write(`\n${bold("Next:")} open the project in your coding agent and run the setup-project skill. `
      + `It will ${work.join(" and ")}.\n`);
  }
}

async function install(options, io) {
  const project = path.resolve(io.cwd, options.project ?? ".");
  if (!fs.existsSync(project) || !fs.statSync(project).isDirectory()) {
    throw new UsageError(`${project} is not a directory.`);
  }
  if (isInside(fs.realpathSync(project), fs.realpathSync(fleet.ROOT))) {
    throw new UsageError("Install into a project, not into the skill fleet itself.");
  }
  const manifest = checks.loadManifest(project);
  if (options.command === "update" && !manifest) {
    throw new UsageError(`The skill fleet is not installed in ${project}. Run skill-fleet install first.`);
  }
  const interactive = io.interactive && !options.yes;
  io.stdout.write(`${bold("skill-fleet")} ${fleet.version()} ${dim("→")} ${project}\n\n`);

  if (!fleet.isGitRoot(project)) {
    const warning = `${project} is not the top of a Git repository.`;
    if (interactive) {
      if (!await io.prompts.confirm({ message: `${warning} Install here anyway?`, initial: false })) {
        throw new CancelledError();
      }
    } else {
      io.stdout.write(`${yellow("!")} ${warning}\n`);
    }
  }

  const installedTools = manifest?.harnesses ?? fleet.DEFAULT_HARNESSES;
  let harnesses = options.tools ?? (interactive ? await askTools(io, installedTools) : installedTools);
  harnesses = TOOLS.filter((tool) => harnesses.includes(tool));

  const files = harnesses.includes("claude") ? "AGENTS.md and CLAUDE.md" : "AGENTS.md";
  const instructions = options.instructions ?? (interactive
    ? await io.prompts.confirm({
      message: `Create or update ${files}? The installer changes only its own marked section.`,
      initial: manifest?.instructions ?? true,
    })
    : manifest?.instructions ?? true);

  let force = options.force;
  let prepared = fleet.prepare(project, { harnesses, instructions, force, manifest });
  if (prepared.conflicts.length && !force) {
    printConflicts(io, prepared.conflicts, "These files conflict with the fleet:");
    const overwrite = interactive && await io.prompts.confirm({
      message: "Overwrite the conflicting files?",
      initial: false,
    });
    if (!overwrite) {
      io.stdout.write("\nNothing was written. Resolve the conflicts, or rerun with --force to overwrite them.\n");
      return 1;
    }
    force = true;
    prepared = fleet.prepare(project, { harnesses, instructions, force, manifest });
  } else if (prepared.conflicts.length) {
    printConflicts(io, prepared.conflicts, "Conflicts, overwritten because of --force:");
  }

  const counts = {};
  for (const { action } of [...prepared.actions, ...prepared.instructionChanges]) {
    counts[action] = (counts[action] ?? 0) + 1;
  }
  if (options.dryRun) {
    for (const { action, path: relative } of [...prepared.actions, ...prepared.instructionChanges]) {
      if (action !== "unchanged") io.stdout.write(`  would ${action} ${relative}\n`);
    }
    for (const note of prepared.notes) io.stdout.write(`${note}\n`);
    io.stdout.write(`Dry run: ${summary(counts)}. Nothing was written.\n`);
    return 0;
  }

  fleet.apply(project, prepared.files, prepared);
  const tools = harnesses.map((tool) => checks.HARNESSES[tool].label).join(", ") || "no adapters";
  io.stdout.write(`${green("✔")} Installed skill-fleet ${fleet.version()} for ${tools}: ${summary(counts)}.\n`);
  for (const note of prepared.notes) io.stdout.write(`${note}\n`);
  const errors = checks.check(project);
  if (errors.length) {
    io.stdout.write("\nThe installation check found problems:\n" + errors.map((e) => `- ${e}`).join("\n") + "\n");
    return 1;
  }
  nextSteps(io, project);
  return 0;
}

function runCheck(options, io) {
  const project = path.resolve(io.cwd, options.project ?? ".");
  const errors = checks.check(project);
  if (errors.length) {
    io.stderr.write(errors.map((error) => `- ${error}`).join("\n") + "\n");
    return 1;
  }
  io.stdout.write(`${green("✔")} The installation in ${project} checks out.\n`);
  return 0;
}

function list(io) {
  for (const name of fleet.skillNames()) {
    const [frontmatter] = checks.splitFrontmatter(
      fs.readFileSync(path.join(fleet.ROOT, "skills", name, "SKILL.md"), "utf8"));
    const description = checks.scalar(Object.fromEntries(frontmatter).description);
    io.stdout.write(`${cyan(name.padEnd(26))} ${description.split(". ")[0].replace(/\.$/, "")}.\n`);
  }
  return 0;
}

export function defaultIo() {
  return {
    cwd: process.cwd(),
    stdout: process.stdout,
    stderr: process.stderr,
    interactive: Boolean(process.stdin.isTTY && process.stdout.isTTY),
    prompts: { checkbox, confirm },
  };
}

/** Run the command line. Resolves to the process exit code. */
export async function main(argv, io = defaultIo()) {
  try {
    const options = parseArgs(argv);
    if (options.version) {
      io.stdout.write(`${fleet.version()}\n`);
      return 0;
    }
    if (options.help || options.command === "help") {
      io.stdout.write(helpText());
      return 0;
    }
    if (options.command === "check") return runCheck(options, io);
    if (options.command === "list") return list(io);
    return await install(options, io);
  } catch (error) {
    if (error instanceof UsageError || error instanceof CancelledError) {
      io.stderr.write(`${error.message}\n`);
      return 1;
    }
    throw error;
  }
}
