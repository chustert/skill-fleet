# AGENTS.md

This repository is the skill fleet: agent skills that work in any project, plus the `skill-fleet` npm package that installs them into a project. [README.md](README.md) explains the design and use.

## Layout

- `skills/<name>/SKILL.md`: canonical skills, with any `scripts/`, `references/`, `templates/`, or `agents/` files beside them. `skills/setup-project/templates/` holds the profile templates and `AGENTS.template.md`, the starting point for a project's `AGENTS.md`.
- `references/`: models shared by several skills. `project-profile.md` defines the contract between skills and a project. `platforms/` holds one guide per platform.
- `bin/skill-fleet.mjs`: the command `npx skill-fleet` runs.
- `lib/cli.mjs`: arguments, the installation questions, and the `install`, `update`, `check`, and `list` commands.
- `lib/install.mjs`: plans and writes an installation. `agentsBlock()` holds the text of the skill-fleet section it maintains in a project's `AGENTS.md`.
- `lib/check-skills.mjs`: the checks, shared by the installer and copied into every project as `.agents/scripts/check-skills.mjs`.
- `lib/prompts.mjs`: the terminal checkbox and yes-or-no questions.
- `test/`: tests for the package, the skills' content, and the sprint scripts. They are not published and never reach a project.
- `package.json`: the package name, the version recorded in each project's manifest, and what npm publishes.
- `.github/workflows/`: `test.yml` runs the tests on Linux, macOS, and Windows; `publish.yml` publishes a tagged version to npm.

## Rules for changing skills

1. Keep every skill project-agnostic. Never name a project, repository, organization, board, product, service vendor, command, path inside a product, or time zone in a skill or reference. `test/content.test.mjs` fails when a shipped file links a GitHub owner other than a placeholder such as `<owner>` or `acme`.
2. Put a project fact in the profile. When a skill needs a new kind of project fact, add a `TODO` row for it to the matching template in `skills/setup-project/templates/`, teach `setup-project` how to find it, and have the skill read it from `docs/agents/`. Follow the reading rules in `references/project-profile.md`.
3. Put a platform difference in a platform guide, not in a skill. Every guide keeps the same five sections, because skills refer to them by name: `Test seams`, `Runtime evidence`, `Bug feedback loops`, `Compatibility at boundaries`, and `Visible-first order`. To add a platform, add a guide with those sections, list it in `references/platforms/README.md`, and add its name to the platform row of the verification template.
4. Keep a shared model in one file under `references/` and link it from each skill with a relative path such as `../../references/software-quality-characteristics.md`. The same relative path resolves here and in an installed project. Do not restate a model inside a skill.
5. Refer to project files by their path from the project root in backticks, such as `docs/agents/verification.md`, not as relative links. They do not exist in this repository.
6. Keep each skill's safety and authorization rules when you edit it: what it may change, what needs approval, and where it stops.
7. Never hand-edit an adapter. The installer generates them from the canonical frontmatter.
8. Keep what the installer writes into a project's `AGENTS.md` and `CLAUDE.md` short and generic. It may fill only facts it reads with certainty, such as the repository from the Git remote; everything else stays `TODO` for `setup-project`. It owns only the section between the `skill-fleet:begin` and `skill-fleet:end` markers and never rewrites the rest of either file.
9. Write code for Node.js 20 or later, using only its standard library. The package has no dependencies, and the scripts copied into projects must run with nothing but Node and the GitHub CLI. Keep paths recorded in the manifest in forward-slash form, so installations match on Windows.
10. Keep tests out of `skills/`. Everything there is copied into projects, where a project's own test runner would pick them up.
11. Apply the `technical-writing` and `unslop` skills to every skill, reference, and document you write.
12. Bump `version` in `package.json` when a change alters shipped files: patch for fixes and wording, minor for new skills, sections, commands, or profile settings, major when an installed project's profile must change.

## Verification

Run the tests after any change, and report the results:

```sh
npm test
```

For a change to the installer or to how skills read the profile, also install into a scratch directory and read the installed result:

```sh
node bin/skill-fleet.mjs install <temporary-directory> --yes
```

The sprint scripts call GitHub; test them against a real board only with read-only commands.

## Releasing

1. Bump `version` in `package.json` and merge the change to `main`.
2. Tag the merge commit as `v<version>`, such as `v1.2.0`, and push the tag. `publish.yml` tests the package, checks that the tag matches the version, publishes to npm through trusted publishing, and creates the GitHub release.

## Working rules

- Do not install into, or change, any other project unless the user asks for that project by name.
- Do not commit, push, publish, or tag unless the user explicitly authorizes it.
- Never add AI attribution lines to commits, pull requests, or issues.
