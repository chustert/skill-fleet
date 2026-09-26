#!/usr/bin/env python3
"""Install the skill fleet into a project, or check an installed project.

    python3 scripts/fleet.py install <project> [--harness claude --harness cursor] [--dry-run] [--force]
    python3 scripts/fleet.py check <project>
    python3 scripts/fleet.py list

`install` copies the canonical skills to <project>/.agents/skills/, the shared
references to <project>/.agents/references/, the checker to
<project>/.agents/scripts/check_skills.py, and writes a thin adapter per skill
for each chosen tool. It records every file it wrote, with its hash, in
<project>/.agents/skill-fleet.json.

It also gives the project its agent instruction files. A missing AGENTS.md is
created from the fleet's template, with the project's name and GitHub
repository filled in, and a missing CLAUDE.md is created to import it. In every
AGENTS.md and CLAUDE.md the installer owns only a marked skill-fleet section,
which it adds or updates; the rest of each file belongs to the project, and the
setup-project skill fills its TODOs.

It never writes docs/agents/. It refuses to overwrite a file it did not write,
a file changed since it wrote it, or a skill-fleet section edited by hand,
unless --force is given. Nothing is written when any conflict exists.
"""

import argparse
import json
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import check_skills as checks  # noqa: E402

DEFAULT_HARNESSES = ["claude", "cursor"]
IGNORED_NAMES = {".DS_Store", "__pycache__"}
AGENTS_TEMPLATE = ROOT / "skills/setup-project/templates/AGENTS.template.md"
CLAUDE_NOTE = ("<!-- Keep shared instructions in AGENTS.md; this file only imports it for Claude Code. "
               "Put personal instructions in CLAUDE.local.md, kept out of Git. -->\n")
GITHUB_REMOTE = re.compile(r"github\.com[:/]([^/\s]+)/([^/\s]+?)(?:\.git)?/?$")


def version():
    return (ROOT / "VERSION").read_text().strip()


def ignored(path):
    return path.suffix == ".pyc" or any(part in IGNORED_NAMES for part in path.parts)


def skill_dirs():
    return sorted(p for p in (ROOT / "skills").iterdir() if (p / "SKILL.md").is_file())


def desired_files(harnesses):
    """Map each fleet-managed project path to (content, file mode)."""
    files = {}
    for base, target in (("skills", checks.CANONICAL), ("references", checks.REFERENCES)):
        for path in sorted((ROOT / base).rglob("*")):
            relative = path.relative_to(ROOT / base)
            if path.is_file() and not ignored(relative):
                files[f"{target}/{relative.as_posix()}"] = (path.read_bytes(), path.stat().st_mode & 0o777)
    checker = ROOT / "scripts/check_skills.py"
    files[".agents/scripts/check_skills.py"] = (checker.read_bytes(), 0o755)
    for skill in skill_dirs():
        text = (skill / "SKILL.md").read_text()
        for harness in harnesses:
            base, fields = checks.HARNESSES[harness]
            content = checks.adapter_text(skill.name, text, fields).encode()
            files[f"{base}/{skill.name}/SKILL.md"] = (content, 0o644)
    return files


def plan(project, files, manifest, force):
    """Decide what to do with every fleet file. Returns (actions, conflicts)."""
    installed = (manifest or {}).get("files", {})
    actions, conflicts = [], []
    for relative, (content, _) in sorted(files.items()):
        path = project / relative
        if not path.exists():
            actions.append(("create", relative))
            continue
        current = checks.sha256(path.read_bytes())
        if current == checks.sha256(content):
            actions.append(("unchanged", relative))
        elif installed.get(relative) == current:
            actions.append(("update", relative))
        else:
            reason = ("changed since the fleet installed it" if relative in installed
                      else "exists and was not installed by the fleet")
            conflicts.append((relative, reason))
            if force:
                actions.append(("overwrite", relative))
    for relative, digest in sorted(installed.items()):
        if relative in files:
            continue
        path = project / relative
        if not path.exists():
            continue
        if checks.sha256(path.read_bytes()) == digest:
            actions.append(("delete", relative))
        else:
            conflicts.append((relative, "was removed from the fleet but changed locally; left in place"))
    return actions, conflicts


def agents_block(harnesses):
    """The skill-fleet section of a project's AGENTS.md."""
    folders = [f"`{checks.HARNESSES[h][0]}/`" for h in harnesses]
    if len(folders) == 1:
        adapters = f"{folders[0]} holds thin adapters"
    else:
        adapters = f"{', '.join(folders[:-1])} and {folders[-1]} hold thin adapters"
    lines = [
        "## Agent workflow",
        "",
        f"The workflow skills in `.agents/skills/` come from the skill fleet. {adapters} that point to them.",
        "",
        "- Before planning, implementing, or reviewing work, read the documents in the order "
        "`docs/agents/domain.md` sets.",
        "- The project settings the skills read live in `docs/agents/`: `issue-tracker.md` holds the "
        "tracker, board, lifecycle statuses, and routing; `domain.md` the reading order, boundaries, and "
        "quality weighting; and `verification.md` the commands, evidence, services that need approval, "
        "and protected files. Change a project fact there, never in a skill.",
        "- `.agents/references/` holds the models the skills share: the software-quality "
        "characteristics, the GitHub reference rules, and one guide per platform.",
        "- Whenever you name a GitHub issue, pull request, comment, commit, workflow run, or project "
        "item, link it as `.agents/references/github-references.md` specifies.",
        "- The usual path through an issue is `start-issue`, then `implement` or `implement-slice`, "
        "then `verify-work`, `prepare-pr`, and `pr-review`. Run `setup-project` when a skill reports a "
        "missing or `TODO` setting.",
        "- Do not edit `.agents/skills/`, `.agents/references/`, or the adapters by hand. Update them "
        "from the fleet, then run `python3 .agents/scripts/check_skills.py`.",
    ]
    if "claude" in harnesses:
        lines.append("- Claude Code reads this file through the import in `CLAUDE.md`. Personal "
                     "instructions belong in `CLAUDE.local.md`, kept out of Git.")
    return "\n".join(lines) + "\n"


def instruction_bodies(harnesses):
    """The skill-fleet section each instruction file should carry."""
    bodies = {"AGENTS.md": agents_block(harnesses)}
    if "claude" in harnesses:
        bodies["CLAUDE.md"] = "@AGENTS.md\n"
    return bodies


def project_identity(project):
    """The project's name and GitHub repository, from its own Git remote when it has one."""
    def git(*args):
        try:
            result = subprocess.run(["git", "-C", str(project), *args], capture_output=True, text=True)
        except OSError:
            return ""
        return result.stdout.strip() if result.returncode == 0 else ""

    top = git("rev-parse", "--show-toplevel")
    if top and Path(top).resolve() == project:
        match = GITHUB_REMOTE.search(git("remote", "get-url", "origin"))
        if match:
            owner, repo = match.groups()
            return repo, f"[`{owner}/{repo}`](https://github.com/{owner}/{repo})"
    return project.name, "TODO: `owner/repo`"


def new_instruction_file(name, body, project):
    if name == "CLAUDE.md":
        return checks.with_block("", body) + "\n" + CLAUDE_NOTE
    project_name, repository = project_identity(project)
    text = (AGENTS_TEMPLATE.read_text()
            .replace("{{project_name}}", project_name)
            .replace("{{repository}}", repository))
    return checks.with_block(text, body)


def plan_instructions(project, harnesses, manifest, force):
    """Decide what to do with AGENTS.md and CLAUDE.md.

    Returns (changes, conflicts, notes, blocks). Each change is (action, name,
    new text). blocks is the manifest record: the digest of each file's
    skill-fleet section, or None when the project removed it on purpose.
    """
    recorded = (manifest or {}).get("blocks", {})
    changes, conflicts, notes, blocks = [], [], [], {}
    for name, body in instruction_bodies(harnesses).items():
        path = project / name
        text = path.read_text() if path.is_file() else None
        current = checks.find_block(text) if text is not None else None
        digest = checks.sha256(body)
        if current is None:
            if text is not None and name == "CLAUDE.md" and checks.CLAUDE_IMPORT.search(text):
                notes.append("CLAUDE.md already imports AGENTS.md, so it stays as it is.")
                continue
            if name in recorded and not force:
                notes.append(f"{name} or its skill-fleet section was removed by hand, so it stays out. "
                             "Rerun with --force to restore it.")
                blocks[name] = None
                continue
            if text is None:
                changes.append(("create", name, new_instruction_file(name, body, project)))
            else:
                changes.append(("update", name, checks.with_block(text, body, prepend=name == "CLAUDE.md")))
            blocks[name] = digest
        elif current == body:
            changes.append(("unchanged", name, None))
            blocks[name] = digest
        elif recorded.get(name) == checks.sha256(current):
            changes.append(("update", name, checks.with_block(text, body)))
            blocks[name] = digest
        else:
            conflicts.append((name, "its skill-fleet section was edited by hand"))
            if force:
                changes.append(("overwrite", name, checks.with_block(text, body)))
                blocks[name] = digest
    return changes, conflicts, notes, blocks


def remove_empty_parents(path, stop):
    parent = path.parent
    while parent != stop and parent.is_dir() and not any(parent.iterdir()):
        parent.rmdir()
        parent = parent.parent


def apply(project, files, actions, instruction_changes, blocks, harnesses):
    for action, relative in actions:
        path = project / relative
        if action in ("create", "update", "overwrite"):
            content, mode = files[relative]
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(content)
            path.chmod(mode)
        elif action == "delete":
            path.unlink()
            remove_empty_parents(path, project)
    for action, name, text in instruction_changes:
        if text is not None:
            (project / name).write_text(text)
    manifest = {
        "fleet": "skill-fleet",
        "version": version(),
        "harnesses": harnesses,
        "files": {relative: checks.sha256(content) for relative, (content, _) in sorted(files.items())},
        "blocks": dict(sorted(blocks.items())),
    }
    (project / checks.MANIFEST).write_text(json.dumps(manifest, indent=2) + "\n")


def install(args):
    project = Path(args.project).expanduser().resolve()
    if not project.is_dir():
        sys.exit(f"{project} is not a directory.")
    if project == ROOT or ROOT in project.parents:
        sys.exit("Install into a project, not into the fleet repository itself.")
    manifest = checks.load_manifest(project)
    harnesses = args.harness or (manifest or {}).get("harnesses") or DEFAULT_HARNESSES
    unknown = sorted(set(harnesses) - set(checks.HARNESSES))
    if unknown:
        sys.exit(f"Unknown harness {', '.join(unknown)}. Choose from {', '.join(checks.HARNESSES)}.")
    harnesses = [h for h in checks.HARNESSES if h in harnesses]

    files = desired_files(harnesses)
    actions, conflicts = plan(project, files, manifest, args.force)
    instruction_changes, instruction_conflicts, notes, blocks = plan_instructions(
        project, harnesses, manifest, args.force)
    conflicts += instruction_conflicts
    counts = {}
    for action, *_ in actions + instruction_changes:
        counts[action] = counts.get(action, 0) + 1

    if conflicts:
        print("Conflicts:" if not args.force else "Conflicts, overwritten because of --force:")
        for relative, reason in conflicts:
            print(f"  {relative}: {reason}")
    if conflicts and not args.force:
        print("\nNothing was written. Resolve the conflicts, or rerun with --force to overwrite them.")
        return 1
    if args.dry_run:
        for action, relative, *_ in actions + instruction_changes:
            if action != "unchanged":
                print(f"  would {action} {relative}")
        for note in notes:
            print(note)
        print(f"Dry run: {summary(counts)}. Nothing was written.")
        return 0

    apply(project, files, actions, instruction_changes, blocks, harnesses)
    print(f"Installed skill-fleet {version()} into {project} for {', '.join(harnesses)}: {summary(counts)}.")
    for note in notes:
        print(note)
    errors = checks.check(project)
    if errors:
        print("\nThe installation check found problems:")
        print("\n".join(f"- {error}" for error in errors))
        return 1
    print_next_steps(project)
    return 0


def print_next_steps(project):
    missing = [f"docs/agents/{name}" for name in ("issue-tracker.md", "domain.md", "verification.md")
               if not (project / "docs/agents" / name).is_file()]
    agents = project / "AGENTS.md"
    todo = agents.is_file() and "TODO" in checks.BLOCK.sub("", agents.read_text())
    if not missing and not todo:
        return
    work = []
    if missing:
        work.append(f"create {', '.join(missing)}")
    if todo:
        work.append("fill the TODOs in AGENTS.md")
    print(f"\nNext: open the project in your coding agent and run the setup-project skill. "
          f"It will {' and '.join(work)}.")


def summary(counts):
    order = ("create", "update", "overwrite", "delete", "unchanged")
    return ", ".join(f"{counts[a]} {a}" for a in order if counts.get(a)) or "no files"


def check(args):
    errors = checks.check(Path(args.project).expanduser())
    if errors:
        print("\n".join(f"- {error}" for error in errors), file=sys.stderr)
        return 1
    print("The installation checks out.")
    return 0


def list_skills(_args):
    for skill in skill_dirs():
        fields = dict(checks.split_frontmatter((skill / "SKILL.md").read_text())[0])
        description = checks.scalar(fields["description"])
        print(f"{skill.name:26} {description.split('. ')[0].rstrip('.')}.")
    return 0


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0],
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    commands = parser.add_subparsers(dest="command", required=True)
    installer = commands.add_parser("install", help="install or update the fleet in a project")
    installer.add_argument("project")
    installer.add_argument("--harness", action="append", choices=sorted(checks.HARNESSES),
                           help="tool to write adapters for; repeatable. "
                                "Default: the installed set, or claude and cursor")
    installer.add_argument("--dry-run", action="store_true", help="show the plan without writing")
    installer.add_argument("--force", action="store_true", help="overwrite conflicting files")
    installer.set_defaults(run=install)
    checker = commands.add_parser("check", help="check an installed project")
    checker.add_argument("project")
    checker.set_defaults(run=check)
    commands.add_parser("list", help="list the fleet's skills").set_defaults(run=list_skills)
    args = parser.parse_args(argv)
    return args.run(args)


if __name__ == "__main__":
    sys.exit(main())
