# Skill fleet

A set of agent skills for building software through one workflow: plan an issue, start it, implement it in reviewable slices, verify it, open a pull request, and review it. The skills work in any project, whether a web app, an iOS or Android app, a game, a back-end service, a library, or a mix of these in one repository or several.

## How it works: GitHub issues on one board

skill-fleet is opinionated about where work lives. Every project that uses it runs its work through GitHub, and the installer sets that up for you:

- **A GitHub repository.** Issues and pull requests live there. The installer stops when the project folder is not a GitHub repository, and shows how to create one.
- **The GitHub CLI (`gh`), logged in.** The skills and their scripts talk to GitHub through it. When `gh` is missing, the installer offers to install it, with Homebrew on macOS or winget on Windows, and otherwise points to [cli.github.com](https://cli.github.com). When `gh` is not logged in, or its login lacks the `project` scope the board needs, it offers to fix that in your browser.
- **A GitHub Project board linked to the repository.** The board has a `Status` field with the options `Todo`, `In progress`, `In review`, and `Done`, and a `Sprint` field with two-week sprints. When the repository has no linked board, the installer creates one called `<repository> Sprints`, or links one of your existing boards if you pick it. When a linked board lacks a status option or the Sprint field, it adds them without touching the options already in use.

The skills then move each issue across the board:

| Status | Set by |
| --- | --- |
| `Todo` | `create-issue`, when it files the issue |
| `In progress` | `start-issue`, when work begins on a branch |
| `In review` | `prepare-pr`, when the pull request is ready for review |
| `Done` | GitHub's built-in project workflow, when the issue closes |

`sprint-status`, `sprint-recap`, and `repos-report` read the Sprint field to report on the current sprint. The board is not optional: when it is missing or incomplete, a skill stops and asks you to run `npx skill-fleet@latest update`, which creates or repairs it. The board starts with six sprints, about three months; add more in the Sprint field's settings on GitHub when they run out.

## How one skill set fits every project

Three layers keep the skills general:

| Layer | Lives in | Holds | Changes when |
| --- | --- | --- | --- |
| Skills | `skills/` → a project's `.agents/skills/` | The workflow: what to read, what to check, what never to do without approval | The workflow improves |
| Project profile | a project's `docs/agents/` | Tracker, board, lifecycle statuses, routing, reading order, boundaries, commands, evidence, protected files | The project changes |
| Shared references | `references/` → a project's `.agents/references/` | The 16 quality characteristics, GitHub link rules, subagent rules, and one guide per platform | The model or a platform's practice changes |

A skill never says "run `npm run build`" or "move the issue on the Roadmap board". It says "run the final verification in `docs/agents/verification.md`" and "move the issue to the started status on the board in `docs/agents/issue-tracker.md`". The [project profile reference](references/project-profile.md) defines the three profile files and how skills treat a missing, `TODO`, or `None` value.

Platform differences live in the [platform guides](references/platforms/README.md): `web`, `mobile`, `desktop`, `game`, `service`, and `library-cli`. Each gives the default test seams, runtime evidence, bug feedback loops, compatibility risks, and visible-first build order for that kind of software. The profile names each component's platform, so `verify-work` knows that a web change needs a browser pass, an iOS change needs simulator and device evidence kept apart, and a game change needs a play-test and a profiler capture on target hardware.

## Install into a project

Run the installer from the project's root folder with any package manager. It needs Node.js 20 or later:

```sh
npx skill-fleet@latest        # npm
pnpm dlx skill-fleet@latest   # pnpm
yarn dlx skill-fleet@latest   # Yarn 2 or later; with Yarn 1, use npx
bunx skill-fleet@latest       # Bun
```

It first checks GitHub as described [above](#how-it-works-github-issues-on-one-board): the GitHub CLI, its login, the repository, and the board. Then it asks three questions, sets up the board, and copies the fleet into the project so the project stays self-contained for collaborators who never run the installer:

1. **Which coding tools should get skill adapters?** Claude Code, Cursor, and Kiro each read skills from their own folder, so each gets a thin adapter that points at the canonical skill. Codex and OpenCode read `.agents/skills/` directly and need none.
2. **Create or update `AGENTS.md` and `CLAUDE.md`?** Described below.
3. **Overwrite the conflicting files?** Asked only when a file the fleet would write already exists and the fleet did not write it, or you changed it since. The answer defaults to no.

When several boards could serve the repository, it also asks which one to use. `--yes` skips every question and keeps the choices recorded by the last installation, or uses Claude Code, Cursor, and the instruction files the first time. Without a terminal, such as in CI, it asks nothing and behaves as with `--yes`. Flags answer a single question instead:

| Flag | Effect |
| --- | --- |
| `--claude`, `--cursor`, `--kiro`, or `--tools claude,cursor` | Choose the tools; `--tools none` writes no adapters |
| `--instructions`, `--no-instructions` | Create and update `AGENTS.md` and `CLAUDE.md`, or leave both alone |
| `--force` | Overwrite conflicting files without asking |
| `--board <number or title>` | Use this board of the repository's owner, linking it to the repository |
| `--dry-run` | Show what would change, on GitHub and on disk, and change nothing |

The installer writes:

- `.agents/skills/`: the canonical skills;
- `.claude/skills/`, `.cursor/skills/`, or `.kiro/skills/`: the adapters for the tools you chose;
- `.agents/references/`: the shared references;
- `.agents/scripts/check-skills.mjs`: a checker anyone can run with `node .agents/scripts/check-skills.mjs`;
- `.agents/skill-fleet-LICENSE`: the fleet's licence, which travels with the copies;
- `.agents/skill-fleet.json`: the version, the choices, and a hash of every file it wrote;
- `AGENTS.md` and `CLAUDE.md`: the project's instruction files, described below;
- `docs/agents/issue-tracker.md`, when it does not exist yet: the repository, owner type, board, lifecycle statuses, Sprint field, sprint time zone, and base branch, as read from GitHub. `setup-project` adds the routing and labels.

It never changes an existing `docs/agents/` file and writes nothing else there. The profile belongs to the project.

### AGENTS.md and CLAUDE.md

Every coding agent reads `AGENTS.md` first, and Claude Code reads `CLAUDE.md`. The installer handles both so a new project works at once:

- A project without `AGENTS.md` gets one from [the template](skills/setup-project/templates/AGENTS.template.md), headed with the project's name and linked to its GitHub repository, both read from its Git remote. The parts only a reader of the code can write, such as what the product is, where the source of truth lives, and the project's own safety rules, stay `TODO` until `setup-project` fills them.
- A project without `CLAUDE.md` gets one that imports `AGENTS.md`, when Claude Code is one of the chosen tools. An existing `CLAUDE.md` that lacks the import gets it added at the top.
- Both files carry a section between `<!-- skill-fleet:begin -->` and `<!-- skill-fleet:end -->` markers. In `AGENTS.md` it explains the workflow, where the profile lives, and which files not to edit by hand. The installer rewrites only that section on every update, and adds it to an `AGENTS.md` you wrote yourself without touching the rest.

If you edit the section by hand, the next install reports a conflict rather than overwrite your change. If you delete it, the installer leaves it out from then on, unless you pass `--force`.

### Updates, checks, and workspaces

```sh
npx skill-fleet@latest update            # update an existing installation
npx skill-fleet@latest update --dry-run  # preview the update
npx skill-fleet@latest check             # verify adapters, hashes, and links
npx skill-fleet@latest list              # list the skills
```

Each command takes the project folder as an optional argument, such as `npx skill-fleet@latest update ../my-app`, and defaults to the current folder. `update` asks the same questions with your previous answers selected. It checks GitHub again, recreating or repairing the board when it changed, updates changed files, removes files the fleet no longer ships, and leaves unchanged files alone. It never overwrites a file it did not write without asking, so a project that already has its own skills with the same names is safe.

In a workspace that holds several independent repositories, install at the workspace root, where cross-repository work starts. Install into a child repository as well only if people also open it on its own. Each installation then needs its own profile. The board links to the workspace repository, and issues from every child repository of the same owner can sit on it.

To try an unreleased version, run the installer straight from GitHub with `npx github:chustert/skill-fleet`, or from a clone with `node bin/skill-fleet.mjs install <project>`.

## Adapt it to the project

Open the project in your coding agent and run `setup-project`. It inspects the repositories, GitHub tracker, board, components, commands, services, secret files, and documentation, and fills in the three profile files:

- `docs/agents/issue-tracker.md`
- `docs/agents/domain.md`
- `docs/agents/verification.md`

It then replaces the `TODO`s in the `AGENTS.md` the installer created, and checks that `CLAUDE.md` imports it. When you wrote `AGENTS.md` yourself, it only proposes additions, as a diff for your approval.

It reads GitHub but never changes it, never opens secret files, and asks you to confirm the judgement calls: which board, how components map to repositories, the lifecycle statuses, the quality weighting, and what the product is. You can also fill the files by hand from the templates in `skills/setup-project/templates/`.

A project without a test runner, a glossary, or a contracts document is fine. Record `None`, and the skills skip the dependent step and say so instead of failing. The board is the exception: the installer always sets it up.

## The workflow

```mermaid
flowchart LR
    setup[setup-project] --> status[sprint-status]
    status --> start[start-issue]
    create[create-issue] --> start
    spec[to-spec] -. publish with .-> create
    start --> slice[implement-slice]
    start --> impl[implement]
    slice --> verify[verify-work]
    impl --> verify
    verify --> prepare[prepare-pr]
    prepare --> review[pr-review]
    verify -. code-quality pass .-> review
    verify -. failures .-> impl
    review -. findings .-> impl
    create -. open decisions .-> align[align-issue]
    start -. open decisions .-> align
    impl -. new behaviour .-> tdd
    impl -. defect .-> bugs[diagnosing-bugs]
    bugs -. regression test .-> tdd
    start -. boundary change .-> contract[cross-boundary-contract]
    impl -. boundary change .-> contract
```

Invoke a skill as `/name` in Claude Code and Cursor, or `$name` in Codex.

### Once per project

| Skill | What it does | Example prompt | Suggested models |
| --- | --- | --- | --- |
| `setup-project` | Inspects the project and writes the profile the other skills read. Rerun it when the board, structure, or commands change. | `/setup-project` | High-tier model, such as Opus 5 High or GPT-5.6-Sol High |

### Preparation

| Skill | What it does | Example prompt | Suggested models |
| --- | --- | --- | --- |
| `sprint-status` | Summarizes your sprint, active work, and PR review queue. | `/sprint-status` | Cheap model, such as Grok 4.6 or GPT-5.6-Luna |
| `sprint-recap` | Recaps issues created, PRs opened and merged, reviews, and merge time during a sprint or a date window. | `/sprint-recap` | Same as `sprint-status` |
| `repos-report` | Shows icon-coded at-a-glance tables of each repository's branches and worktrees, what is active or dormant, and where each open sprint issue lives locally. Changes nothing. | `/repos-report` | Same as `sprint-status` |
| `create-issue` | Creates a grounded issue in the right repository, with existing labels and the board's first status. | `/create-issue Create an issue for: [problem, expected behaviour, and reproduction steps].` | Cheap model, such as Grok 4.6 or GPT-5.6-Luna |
| `to-spec` | Turns the current discussion into a written specification. | `/to-spec` | High-tier model |

### Task workflow

| Step | Skill | What it does | Example prompt | Suggested models |
| :---: | --- | --- | --- | --- |
| 1 | `start-issue` | Reads the issue, plans the slices, creates the branch, assigns you, and sets the started status. | `/start-issue https://github.com/<owner>/<repo>/issues/12` | High-tier model, such as Opus 5 High/XHigh or GPT-5.6-Sol High/XHigh |
| 2 | `implement` | Implements the issue in small, verified steps without committing, and explains how to test each step by hand. | `/implement #12 according to the issue and agreed plan.` | Mid- to low-tier model, such as Grok 4.6, GLM 5.3-Flash, or GPT-5.6-Sol Medium |
| 2 (alt.) | `implement-slice` | Implements one slice, explains it, lists how to test it by hand, and waits for "continue". | `/implement-slice #12` | Same as `implement` |
| 3 | `verify-work` | Verifies acceptance criteria, commands, runtime behaviour on each platform, and code quality. | `/verify-work Verify the implementation for #12.` | Same as `implement` |
| 4 | `prepare-pr` | Checks the branch and drafts the PR for your approval before publishing anything. | `/prepare-pr Prepare the current branch's PR for #12.` | Same as `implement`, possibly at lower effort |
| 5 | `pr-review` | Independently reviews a PR and posts the findings as one comment. | `/pr-review https://github.com/<owner>/<repo>/pull/13` | High-tier model, such as Opus 5 High/XHigh or GPT-5.6-Sol High/XHigh |

### Used by other skills

`align-issue`, `cross-boundary-contract`, `tdd`, `diagnosing-bugs`, `technical-writing`, and `unslop` run from inside the workflows above. You can also invoke them directly, for example `/diagnosing-bugs` for a defect or `/teach` to be walked through code.

## Limits

- The tracker is GitHub: issues, sub-issues, and a Projects board. Another tracker, such as Jira or Linear, is not supported.
- The installer and the scripts it copies into projects need Node.js 20 or later and nothing else from npm. The sprint and `repos-report` scripts also need the GitHub CLI, authenticated with the `read:project` scope.
- Adapters are generated for Claude Code, Cursor, and Kiro. Codex and OpenCode read `.agents/skills/` directly.
- The skills report physical-device, target-hardware, and play-test checks as steps for a person to run. They never claim those checks passed on the strength of a build or an editor run.

## License

The skill fleet is released under the [MIT License](LICENSE). Anyone may use, change, and share it, including in commercial work, as long as the copyright notice stays with the copies.

Three skills contain text by other authors, also under the MIT License. Each carries its original notice in a `LICENSE` file in its folder, which the installer copies with the skill:

| Skill | Source |
| --- | --- |
| `unslop` | Copied from the pstack plugin by Lauren Tan |
| `technical-writing` | Adapted from the pstack plugin by Lauren Tan |
| `to-spec` | Specification template adapted from Matt Pocock's `to-spec` skill |

`align-issue` credits Matt Pocock's grilling skill for the interview pattern it follows, in its own words.

## Developing the fleet

[AGENTS.md](AGENTS.md) holds the rules for changing the fleet and the release steps. Run the tests with:

```sh
npm test
```

A GitHub Action runs them on Linux, macOS, and Windows with Node.js 20, 22, and 24. Pushing a version tag, such as `v1.2.0`, stages that version on npm. It goes live only after the maintainer approves it with two-factor authentication, so a leaked GitHub credential cannot publish a release on its own.
