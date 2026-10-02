# Project profile

The fleet's skills describe the workflow. Everything that differs between
projects lives in the project itself, in three files under `docs/agents/`.
Skills read those files instead of naming a repository, board, command, or
platform. The `setup-project` skill creates and fills them.

## What every project has

The workflow is opinionated about where work lives. Every project that uses it
has all of the following, and the installer (`npx skill-fleet`) sets them up:

- **A GitHub repository.** Issues and pull requests live there. The installer
  stops when the project folder is not one.
- **The GitHub CLI, logged in.** Skills and scripts call GitHub through `gh`,
  with a token that has the `repo` and `project` scopes. The installer offers
  to install `gh` and to log in.
- **A project board linked to the repository.** It has a `Status` field with
  the options `Todo`, `In progress`, `In review`, and `Done`, and an iteration
  field, `Sprint`, with two-week sprints. The installer creates the board when
  the repository has none, or adds what an existing board lacks. Skills move
  every issue across it: `create-issue` to `Todo`, `start-issue` to
  `In progress`, `prepare-pr` to `In review`. GitHub's built-in project
  workflow moves closed issues to `Done`.

When the board is missing or incomplete, a skill stops and asks the user to
run `npx skill-fleet@latest update`, which creates or repairs it. The command
changes the project board on GitHub, so it runs only with the user's approval,
after `--dry-run` shows what it would change. An agent never runs `install` or
`update` without that approval.

## Where things live

The project root is the directory that contains `.agents/skills/`. In a single
repository it is the repository root. In a coordination workspace that holds
several independent repositories, it is the workspace root, and each child
repository keeps its own Git history.

| File | Owned by | Holds |
| --- | --- | --- |
| `AGENTS.md` | project, except one section | Always-relevant instructions, working rules, and safety rules. The profile does not restate it. The fleet installer creates it when missing and maintains only the section between the `skill-fleet:begin` and `skill-fleet:end` markers. |
| `CLAUDE.md` | project, except one section | Imports `AGENTS.md` for Claude Code with `@AGENTS.md`. The installer creates it, or adds the import, when Claude Code is an installed tool. |
| `docs/agents/issue-tracker.md` | project | Tracker settings, the project board and its lifecycle statuses, branch conventions, and the routing table that maps each component to its repository, local path, and responsibilities. The installer creates it with every setting it reads from GitHub; `setup-project` adds the routing and labels. |
| `docs/agents/domain.md` | project | The knowledge reading order, glossary, architecture, contracts document, known boundaries and how to check each one locally, ADR location, and the project's quality weighting. |
| `docs/agents/verification.md` | project | For every component: platform, test harness, focused and final commands, local run, runtime evidence for each surface, prerequisites, and what a merge or release deploys. Also the online and paid services that need approval, protected files, and review-worktree setup. |
| `.agents/references/` | fleet | Shared models every project uses: this file, the software-quality characteristics, the GitHub reference rules, and the platform guides. Change them in the fleet and reinstall; do not edit them in a project. |

The templates for the three profile files and for a new `AGENTS.md` live in
`.agents/skills/setup-project/templates/`.

## Vocabulary

- **Component**: a unit of ownership and verification. In a monorepo it is a
  path such as `web/` or `server/`. In a workspace of independent repositories
  it is usually a whole repository. A single-purpose repository has one
  component.
- **Boundary**: an interface between parts that ship, deploy, or version
  separately, so that different versions of each side can run at the same time.
  `cross-boundary-contract` handles changes to one.
- **Platform**: the kind of software a component is, which decides what counts
  as runtime evidence. The profile names one of `web`, `mobile`, `desktop`,
  `game`, `service`, `library-cli`, or `other`, and the matching guide lives in
  [platforms](platforms/README.md).
- **Lifecycle statuses**: the board options the workflow moves an issue
  through. The profile maps four roles to the board's option names: new
  (`create-issue`), started (`start-issue`), in review (`prepare-pr`), and done
  (merge automation).

## Rules for reading the profile

1. Read the profile files a step needs before that step. The skills name the
   file and the section.
2. A value marked `TODO`, or absent, is unknown. Do not fill it from
   convention, another project, or memory. Ask the user, or recommend
   `setup-project`.
3. `None` is a real value. The project deliberately has no glossary, no
   contracts document, or no test harness. Skip the step that depends on it and
   report it as not configured, not as a failure. The board rows never allow
   `None`: without a board, stop and ask the user to run
   `npx skill-fleet@latest update`. It changes the board on GitHub, so it runs
   only with the user's approval, after `--dry-run` shows what it would change.
4. When the profile and the live system disagree, such as a renamed board or a
   removed command, trust the live evidence, report the disagreement, and
   propose the profile correction. Do not edit the profile silently from
   another workflow.
5. Never carry a value from one project's profile into another project.
6. If a profile file a step needs is missing, say so and fall back to the
   repository's own documentation for that step: `AGENTS.md`, `README.md`,
   `CONTRIBUTING.md`, the documentation index, the testing and development
   guides, and CI configuration. Recommend `setup-project`. A step that changes
   the tracker, such as creating an issue or moving a status, stops instead of
   guessing its target.
