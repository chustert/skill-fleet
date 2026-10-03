import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { afterEach, beforeEach, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import * as sd from "../skills/sprint-status/scripts/sprint-data.mjs";
import * as recap from "../skills/sprint-recap/scripts/sprint-recap.mjs";

const SCRIPT = fileURLToPath(new URL("../skills/sprint-recap/scripts/sprint-recap.mjs", import.meta.url));
// Without PATH, a gh call fails to start instead of reaching GitHub.
const OFFLINE = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toUpperCase() !== "PATH")),
  PATH: "" };
const saved = { ...recap.deps };
afterEach(() => Object.assign(recap.deps, saved));

describe("windows and time zones", () => {
  test("a sprint crossing a daylight-saving change", () => {
    const [start, end] = recap.window({ start: "2026-09-21", end: "2026-10-04" }, "Pacific/Auckland",
      new Date("2026-10-10T00:00:00Z"));
    assert.equal(recap.iso(start), "2026-09-20T12:00:00Z");
    assert.equal(recap.iso(end), "2026-10-04T11:00:00Z");
    assert.ok(recap.within(recap.iso(start), start, end));
    assert.ok(!recap.within(recap.iso(end), start, end));
  });

  test("zones west of UTC and UTC itself", () => {
    assert.equal(recap.iso(recap.zoneMidnight("2026-03-08", "America/Los_Angeles")), "2026-03-08T08:00:00Z");
    assert.equal(recap.iso(recap.zoneMidnight("2026-03-09", "America/Los_Angeles")), "2026-03-09T07:00:00Z");
    assert.equal(recap.iso(recap.zoneMidnight("2026-01-01", "UTC")), "2026-01-01T00:00:00Z");
  });

  test("a day without a midnight starts when the clock jumps", () => {
    // America/Santiago moves from UTC-4 to UTC-3 at midnight, so 6 September 2026 starts at 01:00.
    assert.equal(recap.iso(recap.zoneMidnight("2026-09-06", "America/Santiago")), "2026-09-06T04:00:00Z");
    assert.equal(recap.iso(recap.zoneMidnight("2026-09-07", "America/Santiago")), "2026-09-07T03:00:00Z");
    assert.equal(recap.iso(recap.zoneMidnight("2026-03-29", "Asia/Beirut")), "2026-03-28T22:00:00Z");
    assert.equal(recap.iso(recap.zoneMidnight("2026-04-05", "America/Santiago")), "2026-04-05T04:00:00Z");
  });

  test("the current sprint stops at collection time", () => {
    const now = new Date("2026-09-22T23:00:00Z");
    const [, end] = recap.window({ start: "2026-09-21", end: "2026-10-04" }, "Europe/Berlin", now);
    assert.equal(end.getTime(), now.getTime());
  });

  test("today follows the time zone, not the machine", () => {
    const now = new Date("2026-09-26T20:00:00Z");
    assert.equal(sd.zoneToday(now, "Pacific/Auckland"), "2026-09-27");
    assert.equal(sd.zoneToday(now, "America/New_York"), "2026-09-26");
  });
});

describe("search", () => {
  test("paginates past one hundred results", () => {
    recap.deps.api = (_endpoint, params) => {
      const begin = (params.page - 1) * 100;
      const items = [];
      for (let i = begin; i < Math.min(begin + 100, 101); i += 1) items.push({ html_url: `https://example.test/${i}` });
      return { total_count: 101, incomplete_results: false, items };
    };
    assert.equal(recap.search("query").length, 101);
  });

  test("a partial search is never reported as complete", () => {
    for (const result of [{ total_count: 1001, items: [] }, { total_count: 0, incomplete_results: true, items: [] }]) {
      recap.deps.api = () => result;
      assert.throws(() => recap.search("query"));
    }
  });
});

describe("attribution", () => {
  test("reviews count by actor and submission time", () => {
    const pr = { url: "https://example.test/pr", repo: "org/repo", number: 1, title: "PR" };
    const start = new Date("2026-09-21T00:00:00Z");
    const end = new Date("2026-10-05T00:00:00Z");
    const reviews = [
      [1, "me", "APPROVED", "2026-09-20T23:59:59Z"],
      [2, "ME", "DISMISSED", "2026-09-21T00:00:00Z"],
      [3, "me", "COMMENTED", "2026-10-05T00:00:00Z"],
      [4, "other", "APPROVED", "2026-09-22T00:00:00Z"],
      [5, "me", "PENDING", null],
      [6, "me", "COMMENTED", "2026-09-23T00:00:00Z"],
    ].map(([id, login, state, submitted]) => ({
      id, html_url: `https://example.test/review/${id}`, user: { login }, state, submitted_at: submitted,
    }));
    assert.deepEqual(recap.reviewRows(pr, reviews, "me", start, end).map((r) => r.id), [2, 6]);
  });

  test("opening, merging, and merge actions stay separate", () => {
    const row = (repo, number, author, created) => ({
      repository_url: `https://api.github.com/repos/${repo}`, html_url: `https://github.com/${repo}/pull/${number}`,
      number, title: "PR", user: { login: author }, created_at: created, state: "closed",
    });
    const carryover = row("org/a", 1, "me", "2026-09-01T00:00:00Z");
    const other = row("org/b", 1, "other", "2026-09-22T00:00:00Z");
    const opened = row("org/a", 2, "me", "2026-09-22T00:00:00Z");
    const results = [[], [opened], [carryover, other, opened], []];
    recap.deps.search = () => results.shift();
    recap.deps.api = (endpoint) => ({
      merged_at: "2026-09-23T00:00:00Z", draft: false, state: "closed", closed_at: "2026-09-23T00:00:00Z",
      merged_by: { login: endpoint.includes("/b/") ? "me" : "other" },
    });
    const [activity] = recap.collect("me", new Date("2026-09-21T00:00:00Z"), new Date("2026-10-05T00:00:00Z"),
      "org:org");
    const totals = recap.metrics(activity);
    assert.equal(totals.PRsOpened, 1);
    assert.equal(totals.authoredPRsMerged, 2);
    assert.equal(totals.mergeActions, 1);
    assert.equal(totals.medianHoursOpenToMerge, (22 * 24 + 24) / 2);
    assert.equal(activity.mergeActions[0].repo, "org/b");
  });

  test("zero merges is unavailable and distinct reviews use URLs", () => {
    const result = recap.metrics({ authoredPRsMerged: [], reviewsSubmitted: [
      { prUrl: "https://example.test/a/1" }, { prUrl: "https://example.test/a/1" },
      { prUrl: "https://example.test/b/1" }] });
    assert.equal(result.medianHoursOpenToMerge, null);
    assert.equal(result.distinctPRsReviewed, 2);
  });
});

describe("scope", () => {
  test("listed repositories narrow every query", () => {
    const scope = recap.scopeQualifier("acme", "organization", ["acme/web", "acme/app"]);
    assert.equal(scope, "repo:acme/web repo:acme/app");
    const queries = [];
    recap.deps.search = (query) => {
      queries.push(query);
      return [];
    };
    recap.collect("me", new Date("2026-09-21T00:00:00Z"), new Date("2026-10-05T00:00:00Z"), scope);
    assert.equal(queries.length, 4);
    for (const query of queries) assert.ok(query.startsWith("repo:acme/web repo:acme/app "));
  });

  test("the owner type selects the org or user qualifier, only with --all-repos", () => {
    assert.equal(recap.scopeQualifier("acme", "organization", [], true), "org:acme");
    assert.equal(recap.scopeQualifier("someone", "user", [], true), "user:someone");
    assert.throws(() => recap.scopeQualifier("acme", "organization", []), sd.UsageError);
  });

  test("a repository or --all-repos is required, not both", () => {
    const window = ["--owner", "acme", "--since", "2026-09-01"];
    assert.throws(() => recap.parseArgs(window), /--repo <owner\/repo>.*--all-repos/);
    assert.throws(() => recap.parseArgs([...window, "--repo", "acme/app", "--all-repos"]),
      /either --repo or --all-repos, not both/);
    const all = recap.parseArgs([...window, "--all-repos"]);
    assert.deepEqual([all.repos, all.allRepos], [[], true]);
    assert.deepEqual(recap.parseArgs([...window, "--repo", "acme/app"]).repos, ["acme/app"]);
  });

  test("each repository counts once, and a blank, malformed, or placeholder value stops", () => {
    const window = ["--owner", "acme", "--since", "2026-09-01"];
    assert.deepEqual(recap.parseArgs([...window, "--repo", "acme/app", "--repo", "ACME/app"]).repos, ["acme/app"]);
    for (const value of ["", "not a repo", "acme"]) {
      assert.throws(() => recap.parseArgs([...window, "--repo", value]), (error) => error instanceof sd.UsageError
        && error.message.startsWith(`--repo takes a repository in the form owner/repo, not ${JSON.stringify(value)}.`));
    }
    assert.throws(() => recap.parseArgs([...window, "--repo", "owner/repo"]), /template placeholder/);
  });

  test("--help prints the usage without a scope", () => {
    assert.match(recap.parseArgs(["--help"]).help, /^Usage: node sprint-recap\.mjs --owner/);
    assert.equal(recap.main(["--help"]), recap.parseArgs(["--help"]).help);
  });
});

describe("collection", () => {
  const realGh = sd.io.gh;
  const ARGS = ["--owner", "acme", "--since", "2025-01-06", "--until", "2025-01-12"];
  let queries;
  let warnings;

  beforeEach(() => {
    sd.clearCaches();
    sd.io.gh = () => JSON.stringify({ data: { repositoryOwner: { __typename: "Organization", login: "acme" } } });
    queries = [];
    warnings = [];
    recap.deps.api = () => ({ login: "me" });
    recap.deps.search = (query) => {
      queries.push(query);
      return [];
    };
    recap.deps.warn = (message) => warnings.push(message);
  });
  afterEach(() => {
    sd.io.gh = realGh;
    sd.clearCaches();
  });

  const run = (...extra) => JSON.parse(recap.main([...ARGS, ...extra]));

  test("without --timezone the recap warns and records that it used UTC", () => {
    const out = run("--repo", "acme/app");
    assert.deepEqual(warnings, [recap.UTC_FALLBACK]);
    assert.deepEqual(out.window, { startInclusive: "2025-01-06T00:00:00Z", endExclusive: "2025-01-13T00:00:00Z",
      timezone: "UTC", timezoneDefaulted: true });
    assert.ok(out.limitations.includes(recap.UTC_FALLBACK));
  });

  test("the sprint time zone needs no warning", () => {
    const out = run("--repo", "acme/app", "--timezone", "Europe/Berlin");
    assert.deepEqual(warnings, []);
    assert.equal(out.window.startInclusive, "2025-01-05T23:00:00Z");
    assert.equal(out.window.timezoneDefaulted, false);
    assert.ok(!out.limitations.includes(recap.UTC_FALLBACK));
  });

  test("searches cover the listed repositories, or the owner with --all-repos", () => {
    assert.equal(run("--repo", "acme/app", "--timezone", "UTC").scope,
      "acme/app, regardless of board membership");
    assert.equal(queries.length, 4);
    for (const query of queries) assert.ok(query.startsWith("repo:acme/app "), query);
    queries = [];
    assert.equal(run("--all-repos", "--timezone", "UTC").scope,
      "Accessible acme repositories, regardless of board membership");
    assert.equal(queries.length, 4);
    for (const query of queries) assert.ok(query.startsWith("org:acme "), query);
  });

  test("a repository listed twice is searched and named once", () => {
    assert.equal(run("--repo", "acme/app", "--repo", "acme/app", "--timezone", "UTC").scope,
      "acme/app, regardless of board membership");
    assert.equal(queries.length, 4);
    for (const query of queries) assert.ok(query.startsWith("repo:acme/app is:"), query);
  });

  test("the warning goes to stderr before any GitHub call", () => {
    // --until before --since stops the run before it reaches GitHub.
    const res = spawnSync(process.execPath, [SCRIPT, "--owner", "acme", "--repo", "acme/app",
      "--since", "2026-09-10", "--until", "2026-09-01"], { encoding: "utf8", env: OFFLINE });
    assert.equal(res.status, 1);
    assert.equal(res.stderr, `Warning: ${recap.UTC_FALLBACK}\n--until is before --since.\n`);
  });
});

describe("periods", () => {
  const NOW = new Date("2026-09-26T10:00:00Z");

  test("an explicit window needs no board", () => {
    const args = recap.parseArgs(["--owner", "acme", "--repo", "acme/app", "--since", "2026-09-01",
      "--until", "2026-09-07"]);
    const [board, period, start, end] = recap.selectPeriod(args, NOW);
    assert.equal(board, null);
    assert.equal(period.title, "Custom window");
    assert.equal(recap.iso(start), "2026-09-01T00:00:00Z");
    assert.equal(recap.iso(end), "2026-09-08T00:00:00Z");
  });

  test("a sprint or a window is required, not both", () => {
    assert.throws(() => recap.parseArgs(["--owner", "acme"]), sd.UsageError);
    assert.throws(() => recap.parseArgs(["--owner", "acme", "--project", "B", "--since", "2026-09-01",
      "--date", "2026-09-02"]), sd.UsageError);
    assert.throws(() => recap.parseArgs(["--owner", "acme", "--until", "2026-09-02"]), sd.UsageError);
    assert.throws(() => recap.parseArgs(["--owner", "acme", "--repo", "acme/app", "--since", "2026-09-01",
      "--timezone", "Mars/Base"]), /Unknown time zone "Mars\/Base"/);
  });

  test("a window without --until ends today in the time zone", () => {
    const args = recap.parseArgs(["--owner", "acme", "--repo", "acme/app", "--since", "2026-09-10",
      "--timezone", "Europe/Berlin"]);
    const [, period, start] = recap.selectPeriod(args, NOW);
    assert.equal(period.end, "2026-09-26");
    assert.equal(recap.iso(start), "2026-09-09T22:00:00Z");
  });

  test("a board without iterations asks for the update or a window", () => {
    recap.deps.resolveIterations = () => [{ title: "Board", url: "u" }, null, null, []];
    assert.throws(() => recap.selectPeriod(recap.parseArgs(["--owner", "acme", "--project", "Board",
      "--repo", "acme/app"]), NOW), (error) => error instanceof sd.UsageError
        && error.message === `The board "Board" has no iteration field. ${sd.REPAIR} `
          + "To recap a date window instead, pass --since and --until.");
  });

  test("no sprint on the chosen date is an error", () => {
    recap.deps.resolveIterations = () => [{ title: "Board", url: "u" }, "Sprint", null, []];
    assert.throws(() => recap.selectPeriod(recap.parseArgs(["--owner", "acme", "--project", "Board",
      "--repo", "acme/app", "--date", "2026-01-01"]), NOW), /No sprint contains 2026-01-01/);
  });
});
