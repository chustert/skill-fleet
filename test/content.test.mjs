import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, test } from "node:test";
import * as checks from "../lib/check-skills.mjs";
import { ROOT, skillNames } from "../lib/install.mjs";

const SKILLS = skillNames();
const PLATFORMS = ["web", "mobile", "desktop", "game", "service", "library-cli"];
const GUIDE_SECTIONS = ["## Test seams", "## Runtime evidence", "## Bug feedback loops",
  "## Compatibility at boundaries", "## Visible-first order"];
// Shipped files may link GitHub only through placeholder owners, the orgs/ and
// users/ segments of board URLs, and the credited author of a borrowed pattern.
const GITHUB_OWNER = /(?<![\w.-])github\.com[:/]([\w.-]+)/g;
const ALLOWED_OWNERS = new Set(["owner", "acme", "orgs", "users", "mattpocock"]);

/** Files the package ships, with forward-slash paths relative to the fleet. */
function shippedFiles() {
  return ["bin", "lib", "skills", "references"].flatMap((base) =>
    checks.listFiles(path.join(ROOT, base))
      .filter((file) => /\.(md|mjs|yaml)$/.test(file))
      .map((file) => `${base}/${file}`));
}

function matchingLines(pattern) {
  const found = [];
  for (const file of shippedFiles()) {
    fs.readFileSync(path.join(ROOT, file), "utf8").split("\n").forEach((line, index) => {
      if (pattern(line)) found.push(`${file}:${index + 1}: ${line.trim()}`);
    });
  }
  return found;
}

describe("content", () => {
  test("every skill has valid frontmatter", () => {
    assert.ok(SKILLS.length >= 18);
    for (const name of SKILLS) assert.deepEqual(checks.checkSkill(path.join(ROOT, "skills", name)), [], name);
  });

  test("relative links resolve", () => {
    assert.deepEqual(checks.checkLinks(ROOT, [path.join(ROOT, "skills"), path.join(ROOT, "references")]), []);
  });

  test("no specific GitHub owner ships", () => {
    const named = matchingLines((line) =>
      [...line.matchAll(GITHUB_OWNER)].some(([, owner]) => !ALLOWED_OWNERS.has(owner)));
    assert.deepEqual(named, []);
  });

  test("nothing shipped still depends on Python", () => {
    assert.deepEqual(matchingLines((line) => /\bpython3?\b|\.py\b/.test(line)), []);
    const scripts = shippedFiles().filter((file) => file.endsWith(".py"));
    assert.deepEqual(scripts, []);
  });

  test("every platform has a complete guide", () => {
    const index = fs.readFileSync(path.join(ROOT, "references/platforms/README.md"), "utf8");
    const template = fs.readFileSync(path.join(ROOT, "skills/setup-project/templates/verification.md"), "utf8");
    for (const platform of PLATFORMS) {
      const guide = path.join(ROOT, "references/platforms", `${platform}.md`);
      assert.ok(fs.existsSync(guide), platform);
      const text = fs.readFileSync(guide, "utf8");
      for (const section of GUIDE_SECTIONS) assert.ok(text.includes(section), `${platform}: ${section}`);
      assert.ok(index.includes(`\`${platform}\``), platform);
      assert.ok(template.includes(`\`${platform}\``), platform);
    }
  });

  test("skills named in backticks exist", () => {
    const names = new Set(SKILLS);
    // A backticked word followed by "skill", "workflow", or a skill-routing verb.
    const pattern = /`([a-z]+(?:-[a-z]+)*)`(?= (?:skill|workflow|before|after|as the manual))/g;
    for (const skill of SKILLS) {
      const text = fs.readFileSync(path.join(ROOT, "skills", skill, "SKILL.md"), "utf8");
      for (const [, reference] of text.matchAll(pattern)) assert.ok(names.has(reference), `${skill}: ${reference}`);
    }
  });

  test("every profile file the skills read has a template", () => {
    const templates = new Set(fs.readdirSync(path.join(ROOT, "skills/setup-project/templates")));
    const referenced = new Set();
    for (const file of shippedFiles()) {
      const text = fs.readFileSync(path.join(ROOT, file), "utf8");
      for (const [, name] of text.matchAll(/docs\/agents\/([a-z-]+\.md)/g)) referenced.add(name);
    }
    assert.deepEqual([...referenced].filter((name) => !templates.has(name)), []);
  });

  test("the package ships what the installer reads", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
    for (const entry of ["bin/", "lib/", "skills/", "references/"]) assert.ok(pkg.files.includes(entry), entry);
    assert.equal(pkg.bin["skill-fleet"], "bin/skill-fleet.mjs");
    assert.equal(pkg.repository.url, "git+https://github.com/chustert/skill-fleet.git");
  });
});
