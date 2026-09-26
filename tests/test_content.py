"""Content rules for the fleet itself. Run with python3 -m unittest discover -s tests."""

from pathlib import Path
import re
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import check_skills as checks  # noqa: E402

SKILL_DIRS = sorted(p for p in (ROOT / "skills").iterdir() if (p / "SKILL.md").is_file())
PLATFORMS = ("web", "mobile", "desktop", "game", "service", "library-cli")
GUIDE_SECTIONS = ("## Test seams", "## Runtime evidence", "## Bug feedback loops",
                  "## Compatibility at boundaries", "## Visible-first order")

# Skill names the fleet replaced, contract documents they depended on, and
# vendors a skill must not assume. None of them may appear in shipped files.
REPLACED_TERMS = re.compile(
    r"cross-repository-contract|cross-component-contract|component_contracts|"
    r"cross_repository_contracts|typesense|supabase|stripe",
    re.IGNORECASE)


def shipped_files():
    for base in ("skills", "references", "scripts"):
        for path in sorted((ROOT / base).rglob("*")):
            if path.is_file() and path.suffix in (".md", ".py", ".yaml") \
                    and not path.name.startswith("test_") and "__pycache__" not in path.parts:
                yield path


def leaks(pattern):
    found = []
    for path in shipped_files():
        for number, line in enumerate(path.read_text().splitlines(), 1):
            if pattern.search(line):
                found.append(f"{path.relative_to(ROOT)}:{number}: {line.strip()}")
    return found


class ContentTests(unittest.TestCase):
    def test_every_skill_has_valid_frontmatter(self):
        self.assertGreaterEqual(len(SKILL_DIRS), 18)
        for skill in SKILL_DIRS:
            with self.subTest(skill=skill.name):
                self.assertEqual(checks.check_skill(skill), [])

    def test_relative_links_resolve(self):
        self.assertEqual(checks.check_links(ROOT, [ROOT / "skills", ROOT / "references"]), [])

    def test_replaced_names_and_vendors_do_not_ship(self):
        self.assertEqual(leaks(REPLACED_TERMS), [])

    def test_every_platform_has_a_complete_guide(self):
        index = (ROOT / "references/platforms/README.md").read_text()
        template = (ROOT / "skills/setup-project/templates/verification.md").read_text()
        for platform in PLATFORMS:
            with self.subTest(platform=platform):
                guide = ROOT / "references/platforms" / f"{platform}.md"
                self.assertTrue(guide.is_file())
                text = guide.read_text()
                for section in GUIDE_SECTIONS:
                    self.assertIn(section, text)
                self.assertIn(f"`{platform}`", index)
                self.assertIn(f"`{platform}`", template)

    def test_skills_named_in_backticks_exist(self):
        names = {p.name for p in SKILL_DIRS}
        # A backticked word followed by "skill", "workflow", or a skill-routing verb.
        pattern = re.compile(r"`([a-z]+(?:-[a-z]+)*)`(?= (?:skill|workflow|before|after|as the manual))")
        for skill in SKILL_DIRS:
            for name in pattern.findall((skill / "SKILL.md").read_text()):
                with self.subTest(skill=skill.name, reference=name):
                    self.assertIn(name, names)

    def test_every_profile_file_skills_read_has_a_template(self):
        templates = {p.name for p in (ROOT / "skills/setup-project/templates").iterdir()}
        referenced = set()
        for path in shipped_files():
            referenced |= set(re.findall(r"docs/agents/([a-z-]+\.md)", path.read_text()))
        self.assertEqual(referenced - templates, set())


if __name__ == "__main__":
    unittest.main()
