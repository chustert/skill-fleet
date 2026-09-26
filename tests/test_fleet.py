"""Installer and checker tests. Run with python3 -m unittest discover -s tests."""

import contextlib
import io
import json
import subprocess
from pathlib import Path
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import check_skills as checks  # noqa: E402
import fleet  # noqa: E402

SKILLS = sorted(p.name for p in (ROOT / "skills").iterdir() if (p / "SKILL.md").is_file())


def run(*argv):
    """Run the fleet CLI quietly and return its exit code and output."""
    out = io.StringIO()
    with contextlib.redirect_stdout(out), contextlib.redirect_stderr(out):
        code = fleet.main(list(argv))
    return code, out.getvalue()


class InstallTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.project = Path(self.tmp.name) / "project"
        self.project.mkdir()

    def tearDown(self):
        self.tmp.cleanup()

    def install(self, *extra):
        return run("install", str(self.project), *extra)

    def test_install_writes_skills_references_adapters_and_manifest(self):
        code, output = self.install()
        self.assertEqual(code, 0, output)
        for name in SKILLS:
            self.assertTrue((self.project / ".agents/skills" / name / "SKILL.md").is_file())
            for base in (".claude/skills", ".cursor/skills"):
                self.assertTrue((self.project / base / name / "SKILL.md").is_file())
        self.assertFalse((self.project / ".kiro").exists())
        self.assertTrue((self.project / ".agents/references/platforms/game.md").is_file())
        self.assertTrue((self.project / ".agents/scripts/check_skills.py").is_file())
        manifest = json.loads((self.project / checks.MANIFEST).read_text())
        self.assertEqual(manifest["harnesses"], ["claude", "cursor"])
        self.assertEqual(checks.check(self.project), [])
        self.assertIn("setup-project", output)

    def test_install_never_writes_the_profile(self):
        self.install()
        self.assertFalse((self.project / "docs").exists())

    def test_scripts_stay_executable(self):
        self.install()
        script = self.project / ".agents/skills/sprint-status/scripts/sprint_data.py"
        self.assertTrue(script.stat().st_mode & 0o100)

    def test_reinstall_is_a_no_op(self):
        self.install()
        code, output = self.install()
        self.assertEqual(code, 0, output)
        self.assertIn("unchanged", output)
        for word in ("create", "update", "delete"):
            self.assertNotIn(f" {word}", output.split(":", 1)[1].split(".")[0])

    def test_adapters_copy_tool_specific_fields_only(self):
        self.install("--harness", "claude", "--harness", "cursor", "--harness", "kiro")
        claude = (self.project / ".claude/skills/sprint-status/SKILL.md").read_text()
        cursor = (self.project / ".cursor/skills/sprint-status/SKILL.md").read_text()
        kiro = (self.project / ".kiro/skills/sprint-status/SKILL.md").read_text()
        self.assertIn("allowed-tools:", claude)
        self.assertNotIn("allowed-tools:", cursor)
        self.assertNotIn("allowed-tools:", kiro)
        self.assertTrue(claude.endswith(
            "Read `../../../.agents/skills/sprint-status/SKILL.md` and follow that canonical workflow in full.\n"))

    def test_local_change_to_a_fleet_file_blocks_the_update(self):
        self.install()
        edited = self.project / ".agents/skills/tdd/SKILL.md"
        edited.write_text(edited.read_text() + "\nLocal edit.\n")
        code, output = self.install()
        self.assertEqual(code, 1)
        self.assertIn("changed since the fleet installed it", output)
        self.assertIn("Local edit.", edited.read_text())
        self.assertTrue(any("tdd/SKILL.md" in e for e in checks.check(self.project)))
        code, _ = self.install("--force")
        self.assertEqual(code, 0)
        self.assertNotIn("Local edit.", edited.read_text())

    def test_existing_skills_from_another_workflow_are_never_overwritten(self):
        foreign = self.project / ".agents/skills/start-issue/SKILL.md"
        foreign.parent.mkdir(parents=True)
        foreign.write_text("---\nname: start-issue\ndescription: A project's own version.\n---\n\nBody.\n")
        code, output = self.install()
        self.assertEqual(code, 1)
        self.assertIn("was not installed by the fleet", output)
        self.assertIn("A project's own version.", foreign.read_text())
        self.assertFalse((self.project / checks.MANIFEST).exists())
        self.assertFalse((self.project / ".agents/skills/tdd").exists())

    def test_dropping_a_harness_removes_its_adapters(self):
        self.install("--harness", "claude", "--harness", "kiro")
        self.assertTrue((self.project / ".kiro/skills/tdd/SKILL.md").is_file())
        code, output = self.install("--harness", "claude")
        self.assertEqual(code, 0, output)
        self.assertFalse((self.project / ".kiro").exists())
        self.assertTrue((self.project / ".claude/skills/tdd/SKILL.md").is_file())
        self.assertEqual(checks.check(self.project), [])

    def test_the_installed_harness_set_is_kept_on_update(self):
        self.install("--harness", "cursor")
        self.install()
        self.assertFalse((self.project / ".claude").exists())
        self.assertTrue((self.project / ".cursor/skills/tdd/SKILL.md").is_file())

    def test_dry_run_writes_nothing(self):
        code, output = self.install("--dry-run")
        self.assertEqual(code, 0)
        self.assertIn("would create", output)
        self.assertEqual(list(self.project.iterdir()), [])

    def test_refuses_to_install_into_the_fleet(self):
        with self.assertRaises(SystemExit):
            run("install", str(ROOT / "skills"))


class InstructionFileTests(unittest.TestCase):
    """AGENTS.md and CLAUDE.md: the installer owns only its marked section."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.project = Path(self.tmp.name) / "demo-game"
        self.project.mkdir()

    def tearDown(self):
        self.tmp.cleanup()

    def install(self, *extra):
        return run("install", str(self.project), *extra)

    def read(self, name):
        return (self.project / name).read_text()

    def test_new_files_name_the_project_from_its_git_remote(self):
        subprocess.run(["git", "init", "-q", str(self.project)], check=True)
        subprocess.run(["git", "-C", str(self.project), "remote", "add", "origin",
                        "git@github.com:acme/space-game.git"], check=True)
        code, output = self.install()
        self.assertEqual(code, 0, output)
        agents = self.read("AGENTS.md")
        self.assertTrue(agents.startswith("# space-game\n"))
        self.assertIn("[`acme/space-game`](https://github.com/acme/space-game)", agents)
        self.assertIn("## Agent workflow", checks.find_block(agents))
        self.assertIn("fill the TODOs in AGENTS.md", output)
        self.assertEqual(checks.find_block(self.read("CLAUDE.md")), "@AGENTS.md\n")
        self.assertEqual(checks.check(self.project), [])

    def test_without_a_remote_the_repository_stays_todo(self):
        self.install()
        agents = self.read("AGENTS.md")
        self.assertTrue(agents.startswith("# demo-game\n"))
        self.assertIn("Repository: TODO", agents)

    def test_an_existing_agents_file_keeps_its_content(self):
        (self.project / "AGENTS.md").write_text("# Mine\n\nKeep this rule.\n")
        (self.project / "docs/agents").mkdir(parents=True)
        for name in ("issue-tracker.md", "domain.md", "verification.md"):
            (self.project / "docs/agents" / name).write_text("Filled.\n")
        code, output = self.install()
        agents = self.read("AGENTS.md")
        self.assertTrue(agents.startswith("# Mine\n\nKeep this rule.\n\n<!-- skill-fleet:begin"))
        self.assertNotIn("Next:", output)
        # A new tool changes the section; the project's own text stays.
        code, output = self.install("--harness", "claude", "--harness", "cursor", "--harness", "kiro")
        self.assertEqual(code, 0, output)
        agents = self.read("AGENTS.md")
        self.assertIn("`.kiro/skills/`", checks.find_block(agents))
        self.assertTrue(agents.startswith("# Mine\n\nKeep this rule.\n"))
        self.assertEqual(agents.count("skill-fleet:begin"), 1)

    def test_hand_edited_section_blocks_the_update(self):
        self.install()
        edited = self.read("AGENTS.md").replace("## Agent workflow", "## Agent workflow, edited")
        (self.project / "AGENTS.md").write_text(edited)
        code, output = self.install("--harness", "claude")
        self.assertEqual(code, 1)
        self.assertIn("AGENTS.md: its skill-fleet section was edited by hand", output)
        self.assertEqual(self.read("AGENTS.md"), edited)
        self.assertTrue((self.project / ".cursor").exists())
        self.assertTrue(any("changed since install" in e for e in checks.check(self.project)))
        code, _ = self.install("--force")
        self.assertEqual(code, 0)
        self.assertNotIn("edited", self.read("AGENTS.md"))

    def test_a_removed_section_stays_removed(self):
        self.install()
        agents = self.read("AGENTS.md")
        (self.project / "AGENTS.md").write_text(checks.BLOCK.sub("", agents))
        code, output = self.install()
        self.assertEqual(code, 0, output)
        self.assertIn("removed by hand, so it stays out", output)
        self.assertIsNone(checks.find_block(self.read("AGENTS.md")))
        self.assertEqual(checks.check(self.project), [])
        self.install("--force")
        self.assertIsNotNone(checks.find_block(self.read("AGENTS.md")))

    def test_an_existing_claude_import_is_left_alone(self):
        (self.project / "CLAUDE.md").write_text("@AGENTS.md\n\nMy notes.\n")
        self.install()
        self.assertEqual(self.read("CLAUDE.md"), "@AGENTS.md\n\nMy notes.\n")
        self.assertEqual(checks.check(self.project), [])

    def test_a_claude_file_without_the_import_gets_it_first(self):
        (self.project / "CLAUDE.md").write_text("# Old Claude notes\n")
        self.install()
        claude = self.read("CLAUDE.md")
        self.assertTrue(claude.startswith("<!-- skill-fleet:begin"))
        self.assertTrue(claude.endswith("\n# Old Claude notes\n"))

    def test_without_claude_code_no_claude_file_is_written(self):
        self.install("--harness", "cursor")
        self.assertFalse((self.project / "CLAUDE.md").exists())
        block = checks.find_block(self.read("AGENTS.md"))
        self.assertIn("`.cursor/skills/` holds thin adapters", block)
        self.assertNotIn("CLAUDE.md", block)

    def test_checker_reports_a_lost_claude_import(self):
        self.install()
        (self.project / "CLAUDE.md").write_text("Nothing here.\n")
        errors = checks.check(self.project)
        self.assertIn("the skill-fleet section in CLAUDE.md is missing. Reinstall to restore it.", errors)
        self.assertTrue(any("does not import AGENTS.md" in e for e in errors))


class CheckTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.project = Path(self.tmp.name)
        run("install", str(self.project))

    def tearDown(self):
        self.tmp.cleanup()

    def test_installed_checker_runs_standalone(self):
        script = self.project / ".agents/scripts/check_skills.py"
        namespace = {"__name__": "installed_check", "__file__": str(script)}
        exec(compile(script.read_text(), str(script), "exec"), namespace)
        self.assertEqual(namespace["check"](self.project), [])

    def test_adapter_drift_is_reported(self):
        adapter = self.project / ".cursor/skills/implement/SKILL.md"
        adapter.write_text(adapter.read_text().replace("canonical workflow", "workflow"))
        self.assertIn("cursor adapter for implement differs from the canonical skill",
                      checks.check(self.project))

    def test_missing_and_stray_adapters_are_reported(self):
        (self.project / ".claude/skills/teach/SKILL.md").unlink()
        stray = self.project / ".claude/skills/old-skill/SKILL.md"
        stray.parent.mkdir()
        stray.write_text("stray")
        errors = checks.check(self.project)
        self.assertIn("missing claude adapter for teach", errors)
        self.assertIn("unexpected claude skill file: .claude/skills/old-skill/SKILL.md", errors)

    def test_broken_reference_link_is_reported(self):
        (self.project / ".agents/references/github-references.md").unlink()
        errors = checks.check(self.project)
        self.assertTrue(any("broken link to ../../references/github-references.md" in e for e in errors))

    def test_frontmatter_rules(self):
        skill = self.project / ".agents/skills/bad-skill"
        skill.mkdir()
        (skill / "SKILL.md").write_text("---\nname: other\ndescription: x\n---\n\nBody.\n")
        self.assertIn("bad-skill: frontmatter name 'other' does not match its folder",
                      checks.check(self.project))


class FrontmatterTests(unittest.TestCase):
    def test_quoted_and_plain_values(self):
        fields, body = checks.split_frontmatter(
            '---\nname: a\ndescription: "Say \\"hi\\"; ok"\nallowed-tools: Bash, Read\n---\n\nBody\n')
        values = {k: checks.scalar(v) for k, v in fields}
        self.assertEqual(values["description"], 'Say "hi"; ok')
        self.assertEqual(values["allowed-tools"], "Bash, Read")
        self.assertEqual(body, "\nBody\n")

    def test_missing_frontmatter_is_an_error(self):
        with self.assertRaises(ValueError):
            checks.split_frontmatter("# No frontmatter\n")


if __name__ == "__main__":
    unittest.main()
