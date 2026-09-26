#!/usr/bin/env python3
"""Check that a project's skills, tool adapters, and skill-fleet manifest agree.

Run from anywhere:

    python3 .agents/scripts/check_skills.py [project-root]

Without an argument, the project root is two directories above this file, which
is where the skill fleet's installer puts it. The installer in the fleet
repository imports the same checks, so a project and the fleet agree on what a
correct installation is.
"""

import hashlib
import json
from pathlib import Path
import re
import sys

# Frontmatter fields each tool's adapter keeps from the canonical skill.
HARNESSES = {
    "claude": (".claude/skills", ("name", "description", "allowed-tools", "argument-hint",
                                  "disable-model-invocation", "user-invocable", "model")),
    "cursor": (".cursor/skills", ("name", "description", "paths", "disable-model-invocation",
                                  "icon", "color", "metadata")),
    "kiro": (".kiro/skills", ("name", "description")),
}
CANONICAL = ".agents/skills"
REFERENCES = ".agents/references"
MANIFEST = ".agents/skill-fleet.json"
NAME = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")
LINK = re.compile(r"\]\(([^)\s]+)\)")

# The installer owns only the text between these markers in AGENTS.md and
# CLAUDE.md. Everything else in those files belongs to the project.
BLOCK_BEGIN = ("<!-- skill-fleet:begin. The skill-fleet installer maintains this section. "
               "Change it in the fleet and reinstall; a hand edit here stops the next update. -->")
BLOCK_END = "<!-- skill-fleet:end -->"
BLOCK = re.compile(r"^<!-- skill-fleet:begin\b[^\n]*-->\n(.*?)^<!-- skill-fleet:end -->\n?",
                   re.MULTILINE | re.DOTALL)
CLAUDE_IMPORT = re.compile(r"^@(\./)?AGENTS\.md\s*$", re.MULTILINE)


def sha256(data):
    if isinstance(data, str):
        data = data.encode()
    return hashlib.sha256(data).hexdigest()


def find_block(text):
    """Return the body of the skill-fleet section in text, or None."""
    match = BLOCK.search(text)
    return match.group(1) if match else None


def with_block(text, body, prepend=False):
    """Return text with the skill-fleet section set to body, adding it if absent."""
    block = f"{BLOCK_BEGIN}\n{body}{BLOCK_END}\n"
    if BLOCK.search(text):
        return BLOCK.sub(lambda _: block, text, count=1)
    if not text.strip():
        return block
    if prepend:
        return block + "\n" + text
    return text.rstrip("\n") + "\n\n" + block


def split_frontmatter(text):
    """Split a SKILL.md into [(key, raw lines)] and the body after the frontmatter.

    Each field keeps its original lines, including indented continuation lines,
    so adapters copy values exactly without a YAML parser.
    """
    if not text.startswith("---\n"):
        raise ValueError("missing YAML frontmatter")
    end = text.find("\n---\n", 3)
    if end == -1:
        raise ValueError("unterminated YAML frontmatter")
    fields = []
    for line in text[4:end].split("\n"):
        if fields and (not line.strip() or line[0] in " \t"):
            fields[-1][1].append(line)
        elif ":" in line and line[0] not in " \t":
            fields.append((line.split(":", 1)[0].strip(), [line]))
        else:
            raise ValueError(f"unexpected frontmatter line: {line!r}")
    return [(key, "\n".join(lines).rstrip()) for key, lines in fields], text[end + 5:]


def scalar(raw):
    """Return the string value of a simple `key: value` field."""
    value = raw.split(":", 1)[1].strip()
    if value[:1] == '"':
        return json.loads(value)
    if value[:1] == "'":
        return value[1:-1].replace("''", "'")
    return " ".join(part.strip() for part in [value, *raw.split("\n")[1:]] if part.strip())


def adapter_text(name, canonical_text, fields):
    """The exact content of a tool adapter that points at the canonical skill."""
    frontmatter, _ = split_frontmatter(canonical_text)
    kept = [raw for key, raw in frontmatter if key in fields]
    return (
        "---\n" + "\n".join(kept) + "\n---\n\n"
        f"Read `../../../{CANONICAL}/{name}/SKILL.md` and follow that canonical workflow in full.\n"
    )


def canonical_skills(root):
    base = root / CANONICAL
    if not base.is_dir():
        return []
    return sorted(p for p in base.iterdir() if (p / "SKILL.md").is_file())


def check_skill(directory):
    errors = []
    try:
        frontmatter, body = split_frontmatter((directory / "SKILL.md").read_text())
    except ValueError as error:
        return [f"{directory.name}: {error}"]
    fields = dict(frontmatter)
    name = scalar(fields["name"]) if "name" in fields else None
    description = scalar(fields["description"]) if "description" in fields else ""
    if name != directory.name:
        errors.append(f"{directory.name}: frontmatter name {name!r} does not match its folder")
    elif not NAME.match(name) or len(name) > 64:
        errors.append(f"{directory.name}: name must be lowercase words joined by hyphens, at most 64 characters")
    if not description:
        errors.append(f"{directory.name}: description is missing")
    elif len(description) > 1024:
        errors.append(f"{directory.name}: description is {len(description)} characters; the limit is 1024")
    if not body.strip():
        errors.append(f"{directory.name}: body is empty")
    return errors


def check_links(root, directories):
    """Every relative Markdown link in the given directories must resolve."""
    errors = []
    for directory in directories:
        for path in sorted(directory.rglob("*.md")):
            for target in LINK.findall(path.read_text()):
                if re.match(r"^[a-z][a-z0-9+.-]*:", target) or target.startswith("#"):
                    continue
                if not (path.parent / target.split("#", 1)[0]).exists():
                    errors.append(f"{path.relative_to(root)}: broken link to {target}")
    return errors


def load_manifest(root):
    path = root / MANIFEST
    return json.loads(path.read_text()) if path.is_file() else None


def check_adapters(root, skills, harnesses):
    errors = []
    names = {skill.name for skill in skills}
    for harness in harnesses:
        base, fields = HARNESSES[harness]
        for skill in skills:
            adapter = root / base / skill.name / "SKILL.md"
            if not adapter.is_file():
                errors.append(f"missing {harness} adapter for {skill.name}")
                continue
            expected = adapter_text(skill.name, (skill / "SKILL.md").read_text(), fields)
            if adapter.read_text() != expected:
                errors.append(f"{harness} adapter for {skill.name} differs from the canonical skill")
        for path in sorted((root / base).rglob("*")) if (root / base).is_dir() else []:
            if not path.is_file() or path.name == ".DS_Store":
                continue
            relative = path.relative_to(root / base)
            if relative.parts[0] not in names or relative.name != "SKILL.md" or len(relative.parts) != 2:
                errors.append(f"unexpected {harness} skill file: {path.relative_to(root)}")
    return errors


def check_manifest(root, manifest):
    errors = []
    for relative, digest in sorted(manifest.get("files", {}).items()):
        path = root / relative
        if not path.is_file():
            errors.append(f"fleet file missing: {relative}")
        elif sha256(path.read_bytes()) != digest:
            errors.append(f"fleet file changed since install: {relative}. Change it in the fleet and reinstall.")
    # A null digest means the project removed the section on purpose.
    for relative, digest in sorted(manifest.get("blocks", {}).items()):
        path = root / relative
        body = find_block(path.read_text()) if path.is_file() else None
        if digest is None:
            continue
        if body is None:
            errors.append(f"the skill-fleet section in {relative} is missing. Reinstall to restore it.")
        elif sha256(body) != digest:
            errors.append(f"the skill-fleet section in {relative} changed since install. "
                          "Change it in the fleet and reinstall.")
    if "claude" in manifest.get("harnesses", []) and manifest.get("blocks", {}).get("CLAUDE.md", "") is not None:
        claude = root / "CLAUDE.md"
        if not claude.is_file() or not CLAUDE_IMPORT.search(claude.read_text()):
            errors.append("CLAUDE.md does not import AGENTS.md, so Claude Code misses the project instructions")
    return errors


def check(root):
    """Return a list of problems with the installation at root. Empty means correct."""
    root = Path(root).resolve()
    skills = canonical_skills(root)
    if not skills:
        return [f"no skills found in {root / CANONICAL}"]
    errors = [error for skill in skills for error in check_skill(skill)]
    manifest = load_manifest(root)
    if manifest:
        harnesses = manifest.get("harnesses", [])
        errors += check_manifest(root, manifest)
    else:
        harnesses = [h for h, (base, _) in HARNESSES.items() if (root / base).is_dir()]
    errors += check_adapters(root, skills, harnesses)
    errors += check_links(root, [p for p in (root / CANONICAL, root / REFERENCES) if p.is_dir()])
    return errors


def main(argv):
    root = Path(argv[1]) if len(argv) > 1 else Path(__file__).resolve().parents[2]
    errors = check(root)
    if errors:
        print("\n".join(f"- {error}" for error in errors), file=sys.stderr)
        return 1
    manifest = load_manifest(root)
    harnesses = manifest.get("harnesses", []) if manifest else "detected"
    print(f"{len(canonical_skills(root))} skills, adapters for {harnesses}, and links check out.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
