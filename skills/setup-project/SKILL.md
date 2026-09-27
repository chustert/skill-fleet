---
name: setup-project
description: Adapt the skill fleet to a project by inspecting its repositories, GitHub tracker and board, components, platforms, verification commands, knowledge documents, boundaries, and secret files, then writing the project profile in docs/agents/ that every other skill reads and tailoring the project's AGENTS.md and CLAUDE.md. Use after installing the fleet, when a skill reports a missing or TODO profile value, or when the project's structure, board, or commands change. Reads GitHub but never changes it.
---

# Set up project

Fill the project profile so the workflow skills run in this project without
guessing. The profile is three files under `docs/agents/`, described in the
[project profile](../../references/project-profile.md):

- `issue-tracker.md`: tracker settings, board, lifecycle statuses, branch
  conventions, and the routing table;
- `domain.md`: reading order, boundaries, ADR location, and quality weighting;
- `verification.md`: per-component commands and evidence, services that need
  approval, protected files, and review-worktree setup.

Then tailor the project's instruction files. The fleet installer creates
`AGENTS.md` from `templates/AGENTS.template.md` when the project has none, and
`CLAUDE.md` to import it when Claude Code is one of the installed tools. In
either file it owns only the section between the `skill-fleet:begin` and
`skill-fleet:end` markers. Everything else belongs to the project.

Invoking this skill authorizes reading the project, running read-only `git` and
`gh` queries, creating or editing the three profile files, and replacing the
`TODO` placeholders the installer left in `AGENTS.md`. It does not authorize
editing any other file or any hand-written part of `AGENTS.md` or `CLAUDE.md`,
creating labels, boards, fields, or issues, installing tools, running builds or
tests, or opening protected files. Never edit the skill-fleet section; the
installer rewrites it. Propose any other change, such as an addition to a
hand-written `AGENTS.md` or permission deny rules, as a diff, and apply it only
after the user approves it.

Record only what evidence supports. Write `TODO` with a short note of what would
resolve a value you could not establish, and `None` only for something you
confirmed is absent. A plausible guess recorded as fact is worse than a `TODO`,
because every later skill will trust it.

## 1. Establish the topology

1. Find the project root: the directory that holds `.agents/skills/`.
2. Classify the project as one of:
   - a single repository with one component;
   - a single repository with several components, such as a monorepo with an
     app, a server, and shared packages;
   - a workspace of independent repositories: child directories with their own
     `.git`, usually ignored by the workspace's `.gitignore`.
3. For each repository, read its remote with `git -C <path> remote get-url origin`
   and its metadata with
   `gh repo view <owner/repo> --json nameWithOwner,owner,defaultBranchRef,hasIssuesEnabled,visibility`.
   Note the current branch and whether the worktree is clean, but change
   nothing.
4. Read the existing instructions: `AGENTS.md`, `CLAUDE.md`, `README.md`,
   `CONTRIBUTING.md`, the documentation index, and any files already in
   `docs/agents/`. Existing profile files are the starting point. Update them in
   place and never discard a value the user wrote without asking.

## 2. Read the tracker

The installer has already made sure the project is a GitHub repository, that
`gh` is installed and logged in with the `repo` and `project` scopes, and that
a project board is linked to the repository with the workflow's `Status`
options and an iteration field. It recorded the repository, owner type, board,
lifecycle statuses, iteration field, sprint time zone, and base branch in
`docs/agents/issue-tracker.md`. Keep those values; fill the rest. Run read-only
queries and record names, not IDs.

- Check the recorded board against GitHub: `gh project field-list <number>
  --owner <owner> --format json` lists its `Status` options and iteration field.
  If the board is missing, unlinked, or lacks an option or the iteration field,
  do not repair it here. Tell the user to run `npx skill-fleet@latest update`,
  which creates or repairs it, and continue with the rest.
- If `docs/agents/issue-tracker.md` predates the installer and names no board,
  ask the user to run `npx skill-fleet@latest update` first. The board is
  required; never record `None` for it.
- Issue types, for an organization only:
  `gh api graphql -f query='query($l:String!){organization(login:$l){issueTypes(first:25){nodes{name description isEnabled}}}}' -f l=<owner>`.
  Keep `Resolve from GitHub` when enabled types exist, otherwise record `None`.
- Labels: `gh label list --repo <owner/repo> --limit 200 --json name,description`.
  Propose the mapping from kinds of work to existing labels.
- Issue forms and the pull-request template: list `.github/ISSUE_TEMPLATE/` and
  `.github/pull_request_template.md` or `.github/PULL_REQUEST_TEMPLATE/`. The
  skills use them when present, so note that they exist.
- The fallback repository starts as the default repository. In a workspace of
  several repositories, propose where issues with an unclear owner belong, and
  the rule for work that spans components; the user confirms.

## 3. Map components and platforms

Identify components from the directory structure and the manifests. Read file
names and manifest contents; do not run anything.

| Signal | Suggests |
| --- | --- |
| `package.json` with a web framework such as Next.js, React, Vue, Svelte, or Vite; `index.html` | `web` |
| `*.xcodeproj`, `*.xcworkspace`, or `Package.swift` with app targets; `build.gradle` with `com.android.application`; `pubspec.yaml`; React Native or Expo configuration | `mobile` |
| Electron or Tauri configuration; a macOS app target; WinUI, WPF, or Qt projects | `desktop` |
| `ProjectSettings/ProjectVersion.txt` (Unity), `*.uproject` (Unreal), `project.godot` (Godot), a game framework dependency | `game` |
| Server frameworks, `Dockerfile`, `docker-compose.yml`, database migrations, Terraform or other infrastructure code | `service` |
| Published package metadata, library products or targets, `bin` entries, CLI frameworks | `library-cli` |

A component can span two platforms, such as a web app with its own API routes.
Record the primary one and name the other. Mark a component as legacy or
inactive only when the project's documentation says so.

Build the routing table: component, repository, local path relative to the
project root, and what it owns, in the project's own words where the
documentation has them.

## 4. Find the verification commands

For each component, find the documented commands. Sources, in order of
authority: `AGENTS.md`, the README and contributing or testing guides, CI
workflows in `.github/workflows/`, and task runners such as `package.json`
scripts, `Makefile`, `justfile`, Gradle tasks, `xcodebuild` schemes, fastlane
lanes, or the engine's command line.

- Record each command exactly, with its working directory. Prefer what CI runs
  as the final verification.
- Record the test harness, or `None` and the evidence that replaces it, such as
  a build, lint, or runtime check.
- Record how to run one focused test.
- Record the local run command and the runtime evidence method, starting from
  the defaults in the component's platform guide in
  [platforms](../../references/platforms/README.md).
- Record prerequisites: local services, seeded data, accounts, simulators,
  devices, engine or SDK versions, and licences.
- Do not run builds or tests to discover commands. Mark each command
  `(documented, not yet run)` until someone runs it in this checkout.

## 5. Find services, protected files, and worktree needs

- Protected files: find secret-bearing files by name only, such as ignored
  `.env` files other than examples, signing files and keystores,
  `*.xcconfig` files holding secrets, service-account JSON, cloud credentials,
  and `*.tfvars`. Use `git check-ignore` and `git ls-files` to tell an ignored
  local file from a committed example. Never open, print, search, or diff a
  protected file. List the ones a fresh worktree needs as symlink candidates.
- Online, hosted, and paid services: derive them from committed example
  environment files, configuration, and documentation. Variable names are
  enough to identify a payment provider, email delivery, an AI API, a hosted
  database, analytics, a store, or a platform service. Record each with the
  rule that verification needs explicit approval before contacting it.
- Review-worktree setup: which ignored files a fresh worktree needs, and which
  dependency directories can be reused when a pull request does not change the
  lockfile.
- Propose Claude Code deny rules for the protected files, as `Read(...)` and
  `Edit(...)` entries in `.claude/settings.json`, shown as a diff for approval.

## 6. Find the knowledge documents and boundaries

- Record the paths of the glossary, architecture overview, component guides,
  contracts document, and ADR directory, or `None`. Do not write these
  documents here. List a significant gap, such as a multi-component project
  with no architecture overview, as a recommendation.
- List the boundaries between parts that ship or version separately, using the
  kinds `cross-boundary-contract` names. For each, record the producer, the
  consumers, and which versions can meet during rollout. A project that ships
  as one unit and keeps no data across releases records `None`.
- Propose the `Quality weighting` paragraph from what the product is and the
  starting points in the
  [software quality characteristics](../../references/software-quality-characteristics.md).
  Mark it proposed until the user confirms it.

## 7. Write the profile

- Create a missing profile file from the matching template in this skill's
  `templates/` directory, then fill it. Update an existing file in place,
  keeping its structure where it already covers the same settings.
- Keep the profile a configuration record, not a copy of the documentation.
  Link the architecture, contracts, and testing guides rather than restating
  them.
- Keep each prose paragraph, bullet, and table row on one source line.
- Apply `technical-writing` and `unslop`.

## 8. Tailor AGENTS.md and CLAUDE.md

`AGENTS.md` is what every coding agent reads first, on every task, so it holds
only instructions that are always relevant. Detailed facts stay in the profile
and the project's documentation, and `AGENTS.md` points to them.

When the installer created `AGENTS.md`, replace each `TODO` from the evidence
gathered above:

- **Project intent:** what the product is, who uses it, and what it must never
  get wrong. Take it from the README, the product documentation, or
  `gh repo view <owner/repo> --json description`. Leave the `TODO` when those
  sources do not say; do not invent a purpose from the code.
- **Source of truth:** where each component's code lives, which paths are
  legacy, and which files are the source of truth for the schema,
  configuration, or content. Name the paths and let the routing table carry
  ownership.
- **Local development:** the install and run commands the documentation gives,
  or a link to the guide. Do not restate the verification commands; they live
  in `docs/agents/verification.md`.
- **Working rules** and **Security and secrets:** the project-specific rules
  the documentation and code make clear, such as a check to run before a
  migration or a key that must never reach client code. Delete a placeholder
  line when there is nothing to add.

When `AGENTS.md` was written by hand before the fleet arrived, leave its
structure alone. Compare it with the sections of the template, and propose only
the always-relevant instructions it lacks, as a diff for approval.

In a workspace of independent repositories, the workspace `AGENTS.md` covers
the workspace and its boundaries, and each child repository keeps its own
`AGENTS.md`. Read those; do not copy them into the workspace file.

Check `CLAUDE.md` when Claude Code is one of the installed tools. It must import
`AGENTS.md` with the line `@AGENTS.md`. When a hand-written `CLAUDE.md` repeats
instructions that `AGENTS.md` also holds, propose moving them into `AGENTS.md`
so the two cannot drift, as a diff for approval.

## 9. Confirm with the user

Present a compact summary:

- the topology and the routing table;
- the tracker, board, lifecycle mapping, iteration field, time zone, base
  branch, fallback repository, and cross-component rule;
- per component: platform, test harness, and commands, marking which are
  documented only;
- protected files by name, and the services that need approval;
- knowledge documents found, gaps, boundaries, and the proposed quality
  weighting;
- what `AGENTS.md` now says about the project's intent, source of truth, and
  rules, and the source of each statement;
- every remaining `TODO`, in the profile or in `AGENTS.md`, and the question
  that would resolve it;
- proposed changes outside the profile and the installer's placeholders, such
  as deny rules or additions to a hand-written `AGENTS.md`, as diffs awaiting
  approval.

Ask the user to confirm or correct the judgement calls: routing ownership,
fallback repository, quality weighting, the project intent, and anything
marked proposed. Apply the corrections.

## 10. Check the installation

Run `node .agents/scripts/check-skills.mjs` from the project root when it
exists, and report the result. Recommend a smoke test in each coding agent the
team uses: ask it to name the product, the tracker, the board, the protected
files, and the verification commands for one component, then to list the
project skills. In Claude Code, `/memory` shows whether `CLAUDE.md` imports
`AGENTS.md`.

Stop after the profile and `AGENTS.md` are written and confirmed. Do not create
issues, branches, labels, boards, or commits.
