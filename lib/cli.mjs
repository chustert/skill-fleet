/**
 * The skill-fleet command line: install, update, check, and list.
 *
 * main() takes every terminal dependency through its io argument, so tests can
 * answer the questions without a terminal.
 */

import fs from "node:fs";
import path from "node:path";
import * as checks from "./check-skills.mjs";
import * as github from "./github.mjs";
import * as fleet from "./install.mjs";
import { bold, CancelledError, checkbox, confirm, cyan, dim, green, select, yellow } from "./prompts.mjs";

const COMMANDS = ["install", "update", "check", "list", "help"];
const TOOLS = Object.keys(checks.HARNESSES);

export class UsageError extends Error {}

export function parseArgs(argv) {
  const options = {
    command: null, project: null, tools: null, instructions: null, board: null,
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
    else if (arg.startsWith("--board=")) options.board = arg.slice("--board=".length);
    else if (arg === "--board") {
      if (index + 1 >= argv.length) throw new UsageError("--board needs a board number or exact title.");
      index += 1;
      options.board = argv[index];
    }
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
    || options.dryRun || options.board !== null;
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
  --board <number or title>    Use this project board of the repository's owner, and link it
  -y, --yes                    Ask nothing: keep the installed choices, or use Claude Code,
                               Cursor, and the instruction files on a first install, and
                               create, link, or repair the project board as needed
  -f, --force                  Overwrite conflicting files without asking, and run even when
                               a newer skill-fleet installed the project
  --dry-run                    Show what would change and write nothing
  -h, --help                   Show this help
  -v, --version                Show the version

${bold("What it needs")}
  The workflow runs through GitHub: the project must be a GitHub repository, and the
  GitHub CLI (gh) must be installed and logged in. skill-fleet offers to install gh and
  log in when needed. It then links a GitHub Project board to the repository, with a
  Status field (Todo, In progress, In review, Done) and two-week Sprint iterations,
  creating the board when the repository has none. It asks before it creates, links,
  or repairs the board.

Codex and OpenCode read .agents/skills/ directly and need no adapter.
Without a terminal, such as in CI, skill-fleet asks nothing and keeps the installed
choices. It changes the project board there only with --yes. Without it, a run that
would change the board lists the changes, writes nothing, and fails.
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

/** Print the note on paths in .agents/skills/ that the fleet does not manage. */
function writeNote(io, paths) {
  const lines = checks.unmanagedNote(paths);
  if (lines.length) io.stdout.write(`${lines.join("\n").replace(/^Note:/, yellow("Note:"))}\n`);
}

function newerInstallation(project, recorded, command) {
  return `${project} was installed with skill-fleet ${recorded}, which is newer than this skill-fleet ${fleet.version()}. `
    + "Running this version would replace the newer skills with older ones. Nothing was written.\n"
    + `Run npx skill-fleet@${recorded} ${command}, or npx skill-fleet@latest ${command} once ${recorded} is published. `
    + `To run ${fleet.version()} anyway, rerun with --force, which also overwrites conflicting files.`;
}

function nextSteps(io, project) {
  const missing = fleet.PROFILE.filter((name) => !fs.existsSync(path.join(project, "docs/agents", name)))
    .map((name) => `docs/agents/${name}`);
  const agents = path.join(project, "AGENTS.md");
  const todo = fs.existsSync(agents) && checks.withoutBlock(fs.readFileSync(agents, "utf8")).includes("TODO");
  const work = [];
  const tracker = path.join(project, fleet.TRACKER);
  if (missing.length) work.push(`create ${missing.join(", ")}`);
  for (const gap of fleet.profileGaps(project)) {
    work.push(`add the settings missing from ${gap.path}: ${gap.missing.join(", ")}`);
  }
  if (fs.existsSync(tracker) && fs.readFileSync(tracker, "utf8").includes("TODO")) {
    work.push(`finish the routing and labels in ${fleet.TRACKER}`);
  }
  if (todo) work.push("fill the TODOs in AGENTS.md");
  if (work.length) {
    io.stdout.write(`\n${bold("Next:")} open the project in your coding agent and run the setup-project skill. `
      + `It will:\n${work.map((item) => `  - ${item}\n`).join("")}`);
  }
}

function noRepository(project) {
  return `skill-fleet runs its workflow through GitHub issues and a GitHub Project board, so the project `
    + `must be a GitHub repository. ${project} is not the top of a Git repository whose origin remote is on GitHub.\n\n`
    + "Create the repository first, then rerun skill-fleet. For a new one, run in the project folder:\n"
    + "  git init\n"
    + "  gh repo create --source . --private --push    (or --public)\n"
    + "For an existing GitHub repository, add it as the origin remote:\n"
    + "  git remote add origin https://github.com/<owner>/<repo>.git";
}

/** Make sure gh is installed and logged in with the needed scopes, and find the project's repository. */
async function prepareGitHub(io, project, interactive) {
  const { gh } = io.github;
  let version = github.ghVersion(gh);
  if (!version) {
    const plan = github.installCommand(io.github.platform, io.github.has);
    const command = plan && `${plan.command} ${plan.args.join(" ")}`;
    io.stdout.write(`${yellow("!")} skill-fleet runs its workflow through the GitHub CLI (gh), which is not installed.\n`);
    if (plan && interactive && await io.prompts.confirm({ message: `Install gh now with ${command}?`, initial: true })) {
      const status = io.github.run(plan.command, plan.args);
      version = github.ghVersion(gh);
      if (status !== 0 || !version) {
        throw new UsageError(`gh is still not available. Install it from ${github.INSTALL_URL}, `
          + "open a new terminal, and rerun skill-fleet.");
      }
    } else {
      throw new UsageError(`Install the GitHub CLI${command ? ` with ${command}` : ""}, or follow ${github.INSTALL_URL}, `
        + "then rerun skill-fleet.");
    }
  }

  let auth = github.authState(gh);
  if (!auth.loggedIn) {
    if (interactive && await io.prompts.confirm({ message: "gh is not logged in to GitHub. Log in now in your browser?", initial: true })) {
      gh(["auth", "login", "--hostname", "github.com", "--web", "--git-protocol", "https", "--scopes", "project"],
        { interactive: true });
      auth = github.authState(gh);
    }
    if (!auth.loggedIn) throw new UsageError("Log in with gh auth login --scopes project, then rerun skill-fleet.");
  }
  let missing = github.missingScopes(auth.scopes);
  if (missing.length) {
    const scopes = missing.join(",");
    if (interactive && await io.prompts.confirm({
      message: `gh's login lacks the ${missing.join(" and ")} scope the board needs. Add it now in your browser?`,
      initial: true,
    })) {
      gh(["auth", "refresh", "--hostname", "github.com", "--scopes", scopes], { interactive: true });
      missing = github.missingScopes(github.authState(gh).scopes);
    }
    if (missing.length) throw new UsageError(`Run gh auth refresh --scopes ${scopes}, then rerun skill-fleet.`);
  }

  const remote = fleet.projectRemote(project);
  if (!remote) throw new UsageError(noRepository(project));
  const repo = github.repository(gh, remote);
  io.stdout.write(`${green("✔")} ${version.replace(/^gh version /, "gh ")}, logged in as ${auth.login}, `
    + `repository ${repo.nameWithOwner}\n\n`);
  return { gh, repo, today: io.github.today(), timeZone: io.github.timeZone };
}

function explainWorkflow(io) {
  const statuses = github.STATUSES.map((s) => s.name).join(", ");
  io.stdout.write(`${bold("How the workflow runs")}\n`
    + "  Work items are GitHub issues in this repository, tracked on a GitHub Project board linked to it.\n"
    + `  The board has a Status field (${statuses}) and ${github.SPRINT_DAYS / 7}-week `
    + `${github.ITERATION_FIELD} iterations.\n`
    + "  create-issue adds issues as Todo, start-issue moves them to In progress, prepare-pr to In review,\n"
    + "  and GitHub moves them to Done when they close. The installer sets the board up for you.\n\n");
}

function findBoard(boards, wanted) {
  return boards.find((b) => String(b.number) === String(wanted))
    ?? boards.find((b) => b.title === wanted)
    ?? null;
}

/**
 * Decide which board the workflow uses and what it still needs. Changes nothing on GitHub.
 *
 * Every board change needs consent: --yes, an answer in the terminal, or, for
 * linking, the --board flag. Without a terminal or --yes, a run that would
 * change the board stops here, before anything is written.
 */
async function planBoard(context, options, io, manifest, interactive) {
  const { gh, repo } = context;
  const linked = repo.boards;
  const ask = interactive && !options.dryRun;
  const plan = { board: null, create: false, link: false, inspection: null, title: github.defaultBoardTitle(repo) };
  if (options.board) {
    plan.board = findBoard(linked, options.board) ?? findBoard(github.ownerBoards(gh, repo.owner.login), options.board);
    if (!plan.board) {
      throw new UsageError(`${repo.owner.login} has no open project board numbered or titled ${JSON.stringify(options.board)}.`);
    }
    plan.link = !linked.some((b) => b.id === plan.board.id);
  } else {
    const recorded = manifest?.github?.board;
    plan.board = (recorded && linked.find((b) => b.number === recorded.number)) || (linked.length === 1 ? linked[0] : null);
    if (recorded && !plan.board) {
      io.stdout.write(`${yellow("!")} The board recorded at the last installation, #${recorded.number}, `
        + `is no longer linked to ${repo.nameWithOwner}.\n`);
    }
    if (!plan.board && linked.length > 1) {
      if (!interactive) {
        throw new UsageError(`${repo.nameWithOwner} has ${linked.length} linked project boards. Choose one with --board: `
          + linked.map((b) => `#${b.number} ${JSON.stringify(b.title)}`).join(", ") + ".");
      }
      plan.board = await io.prompts.select({
        message: `${repo.nameWithOwner} has several linked project boards. Which one should the workflow use?`,
        choices: linked.map((b) => ({ label: b.title, value: b, hint: `#${b.number}` })),
      });
    }
    if (!plan.board && linked.length === 0) {
      const others = interactive ? github.ownerBoards(gh, repo.owner.login) : [];
      if (others.length) {
        // The choice is the consent to create or link the board.
        plan.board = await io.prompts.select({
          message: `No project board is linked to ${repo.nameWithOwner}. Which board should the workflow use?`,
          choices: [
            { label: `Create "${plan.title}"`, value: null, hint: "recommended" },
            ...others.map((b) => ({ label: b.title, value: b, hint: `#${b.number}, link it to the repository` })),
          ],
        });
        plan.link = Boolean(plan.board);
      } else if (ask) {
        const accepted = await io.prompts.confirm({
          message: `No project board is linked to ${repo.nameWithOwner}. Create the project board "${plan.title}" `
            + `owned by ${repo.owner.login}, with the workflow's Status and ${github.ITERATION_FIELD} fields?`,
          initial: true,
        });
        if (!accepted) {
          throw new UsageError("The workflow needs a project board. Nothing was written. "
            + "To use an existing board, rerun with --board <number or title>.");
        }
      }
    }
    plan.create = !plan.board;
  }
  let repairs = [];
  if (plan.board) {
    plan.inspection = github.inspectBoard(github.boardFields(gh, plan.board.id));
    repairs = github.describeRepairs(plan.inspection);
    if (repairs.length && ask) {
      const accepted = await io.prompts.confirm({
        message: `The board "${plan.board.title}" needs changes for the workflow: ${repairs.join("; ")}. Make them?`,
        initial: true,
      });
      if (!accepted) throw new UsageError("The workflow needs those changes on the board. Nothing was written.");
    }
  }
  if (!io.interactive && !options.yes && !options.dryRun && (plan.create || repairs.length)) {
    throw new UsageError("The project board needs changes, and skill-fleet makes them only with your consent:\n"
      + describeBoardPlan(plan, repo).map((change) => `  - ${change}\n`).join("")
      + "Nothing was written, on GitHub or on disk. Rerun in a terminal to be asked first, "
      + "or rerun with --yes to make the changes.");
  }
  return plan;
}

function describeBoardPlan(plan, repo) {
  if (plan.create) {
    return [`create the project board "${plan.title}" owned by ${repo.owner.login}, linked to ${repo.nameWithOwner}, `
      + `with Status (${github.STATUSES.map((s) => s.name).join(", ")}) and ${github.SPRINT_DAYS / 7}-week `
      + `${github.ITERATION_FIELD} iterations`];
  }
  const changes = plan.link ? [`link the project board "${plan.board.title}" to ${repo.nameWithOwner}`] : [];
  return [...changes, ...github.describeRepairs(plan.inspection).map((r) => `${r} on "${plan.board.title}"`)];
}

/** Create, link, or repair the board as planned, then confirm it meets the workflow's needs. */
function applyBoard(context, plan, io) {
  const { gh, repo, today } = context;
  let { board } = plan;
  if (plan.create) {
    board = github.createBoard(gh, repo, plan.title);
    github.repairBoard(gh, board.id, github.inspectBoard(github.boardFields(gh, board.id)), { normalize: true, today });
    io.stdout.write(`${green("✔")} Created the project board "${board.title}", linked to ${repo.nameWithOwner}: ${board.url}\n`);
  } else {
    if (plan.link) {
      github.linkBoard(gh, board.id, repo.id);
      io.stdout.write(`${green("✔")} Linked the project board "${board.title}" to ${repo.nameWithOwner}\n`);
    }
    const repairs = github.describeRepairs(plan.inspection);
    if (repairs.length) {
      github.repairBoard(gh, board.id, plan.inspection, { today });
      io.stdout.write(`${green("✔")} Updated the project board "${board.title}": ${repairs.join("; ")}\n`);
    } else if (!plan.link) {
      io.stdout.write(`${green("✔")} Project board "${board.title}": ${board.url}\n`);
    }
  }
  const inspection = github.inspectBoard(github.boardFields(gh, board.id));
  const still = github.describeRepairs(inspection);
  if (still.length) throw new github.GitHubError(`The board "${board.title}" still needs: ${still.join("; ")}.`);
  return { board, inspection };
}

/** Seed the tracker settings, or point out an existing file that names another board. */
function recordTracker(io, project, { repo, board, inspection }) {
  const settings = fleet.trackerSettings({ repo, board, inspection, timeZone: io.github.timeZone });
  if (fleet.seedTracker(project, settings)) {
    io.stdout.write(`${green("✔")} Created ${fleet.TRACKER} with the repository, board, and sprint settings\n`);
    return;
  }
  const text = fs.readFileSync(path.join(project, fleet.TRACKER), "utf8");
  if (!text.includes(board.url) && !text.includes(`\`${board.title}\``)) {
    io.stdout.write(`${yellow("!")} ${fleet.TRACKER} does not name the board "${board.title}". Set its Project board row to:\n`
      + `  ${settings["Project board"]}\n`);
  }
}

async function install(options, io) {
  const project = path.resolve(io.cwd, options.project ?? ".");
  if (!fs.existsSync(project) || !fs.statSync(project).isDirectory()) {
    throw new UsageError(`${project} is not a directory.`);
  }
  if (isInside(fleet.canonicalPath(project), fleet.canonicalPath(fleet.ROOT))) {
    throw new UsageError("Install into a project, not into the skill fleet itself.");
  }
  const manifest = checks.loadManifest(project);
  if (options.command === "update" && !manifest) {
    throw new UsageError(`The skill fleet is not installed in ${project}. Run skill-fleet install first.`);
  }
  if (manifest && !options.force && fleet.compareVersions(manifest.version, fleet.version()) > 0) {
    throw new UsageError(newerInstallation(project, manifest.version, options.command));
  }
  const interactive = io.interactive && !options.yes;
  io.stdout.write(`${bold("skill-fleet")} ${fleet.version()} ${dim("→")} ${project}\n\n`);

  const context = await prepareGitHub(io, project, interactive);
  if (!manifest) explainWorkflow(io);

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

  const boardPlan = await planBoard(context, options, io, manifest, interactive);

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
    for (const change of describeBoardPlan(boardPlan, context.repo)) io.stdout.write(`  would ${change}\n`);
    for (const { action, path: relative } of [...prepared.actions, ...prepared.instructionChanges]) {
      if (action !== "unchanged") io.stdout.write(`  would ${action} ${relative}\n`);
    }
    if (!fs.existsSync(path.join(project, fleet.TRACKER))) {
      io.stdout.write(`  would create ${fleet.TRACKER} with the repository, board, and sprint settings\n`);
    }
    for (const note of prepared.notes) io.stdout.write(`${note}\n`);
    io.stdout.write(`Dry run: ${summary(counts)}. Nothing was written, on GitHub or on disk.\n`);
    return 0;
  }

  const { board, inspection } = applyBoard(context, boardPlan, io);
  prepared.github = {
    repository: context.repo.nameWithOwner,
    board: { owner: context.repo.owner.login, number: board.number, title: board.title, url: board.url },
  };
  fleet.apply(project, prepared.files, prepared);
  const tools = harnesses.map((tool) => checks.HARNESSES[tool].label).join(", ") || "no adapters";
  io.stdout.write(`${green("✔")} Installed skill-fleet ${fleet.version()} for ${tools}: ${summary(counts)}.\n`);
  for (const note of prepared.notes) io.stdout.write(`${note}\n`);
  const replaced = prepared.conflicts.filter((c) => c.reason === fleet.NOT_INSTALLED).map((c) => c.path);
  if (replaced.length) {
    io.stdout.write(`${yellow("Note:")} the installation replaced these files, which the fleet had not installed:\n`
      + replaced.map((relative) => `  ${relative}\n`).join("")
      + "Their previous versions remain in Git if they were committed. Run setup-project next. It reads "
      + "them to carry any project facts into docs/agents/ before they are lost.\n");
  }
  writeNote(io, checks.unmanaged(project));
  recordTracker(io, project, { repo: context.repo, board, inspection });
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
  writeNote(io, checks.unmanaged(project));
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
    prompts: { checkbox, confirm, select },
    github: {
      gh: github.runGh,
      run: github.runProgram,
      has: github.hasProgram,
      platform: process.platform,
      today: () => new Date(),
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    },
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
    if (error instanceof UsageError || error instanceof CancelledError || error instanceof github.GitHubError) {
      io.stderr.write(`${error.message}\n`);
      return 1;
    }
    throw error;
  }
}
