import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";
import * as sd from "../skills/sprint-status/scripts/sprint-data.mjs";

const NAMES = { todo: "Todo", started: "In progress", review: "In review", done: "Done" };
const realGh = sd.io.gh;

function item(number, status, iteration = null, assignees = ["me"], state = "OPEN") {
  return {
    repo: "acme/app", number, title: `Item ${number}`, url: `https://github.com/acme/app/issues/${number}`,
    type: "Issue", state, updatedAt: "2026-09-20T00:00:00Z", status, iteration, assignees, subIssues: null,
  };
}

/** Replace every gh call with a fake that answers GraphQL by owner type. */
function fakeGh(handler) {
  const calls = [];
  sd.io.gh = (args) => {
    calls.push(args);
    return JSON.stringify(handler(args));
  };
  return calls;
}

describe("owners and boards", () => {
  beforeEach(() => sd.clearCaches());
  afterEach(() => {
    sd.io.gh = realGh;
    sd.clearCaches();
  });

  test("the owner type picks the GraphQL root", () => {
    for (const [typename, root] of [["Organization", "organization"], ["User", "user"]]) {
      sd.clearCaches();
      fakeGh(() => ({ data: { repositoryOwner: { __typename: typename, login: "x" } } }));
      assert.equal(sd.ownerRoot("x"), root);
    }
  });

  test("owner queries substitute the root", () => {
    const calls = fakeGh((args) => (args.join(" ").includes("repositoryOwner")
      ? { data: { repositoryOwner: { __typename: "User", login: "acme" } } }
      : { data: { user: { ok: 1 } } }));
    assert.deepEqual(sd.ownerQuery(sd.PROJECT_QUERY, "acme", { num: 3 }), { ok: 1 });
    const query = calls.at(-1).find((arg) => arg.startsWith("query="));
    assert.match(query, /user\(login: \$owner\)/);
    assert.doesNotMatch(query, /__ROOT__/);
  });

  test("an unknown owner stops", () => {
    fakeGh(() => ({ data: { repositoryOwner: null } }));
    assert.throws(() => sd.ownerRoot("nobody"), sd.UsageError);
  });

  test("an exact open title is required", () => {
    const nodes = [
      { number: 1, title: "Sprints", url: "u1", closed: false },
      { number: 2, title: "Sprints (old)", url: "u2", closed: false },
      { number: 3, title: "Sprints", url: "u3", closed: true },
    ];
    assert.equal(sd.pickProject(nodes, "Sprints", "acme").number, 1);
    const twice = [1, 2].map((number) => ({ number, title: "Board", url: "u", closed: false }));
    for (const found of [twice, []]) assert.throws(() => sd.pickProject(found, "Board", "acme"), sd.UsageError);
  });

  test("null variables are omitted and integers are typed", () => {
    const calls = fakeGh(() => ({}));
    sd.graphql("q", { owner: "acme", num: 3, after: null });
    const args = calls[0];
    assert.ok(args.includes("-F") && args.includes("num=3"));
    assert.ok(!args.some((arg) => arg.startsWith("after=")));
  });
});

describe("iterations", () => {
  const FIELD = {
    name: "Sprint",
    configuration: {
      completedIterations: [{ title: "S1", startDate: "2026-09-07", duration: 14 }],
      iterations: [{ title: "S2", startDate: "2026-09-21", duration: 14 },
        { title: "S3", startDate: "2026-10-05", duration: 14 }],
    },
  };

  test("current and upcoming iterations", () => {
    const [current, upcoming] = sd.currentIteration(FIELD, "2026-09-26");
    assert.equal(current.title, "S2");
    assert.equal(current.day, 6);
    assert.equal(current.end, "2026-10-04");
    assert.deepEqual(upcoming.map((u) => u.title), ["S3"]);
  });

  test("the field is chosen by name, or the first one", () => {
    const other = { name: "Quarter", configuration: FIELD.configuration };
    const nodes = [{}, other, FIELD];
    assert.equal(sd.pickIterationField(nodes).name, "Quarter");
    assert.equal(sd.pickIterationField(nodes, "Sprint").name, "Sprint");
    assert.equal(sd.pickIterationField([{}]), null);
    assert.throws(() => sd.pickIterationField(nodes, "Missing"), sd.UsageError);
  });

  test("dates are validated and added across month ends", () => {
    assert.equal(sd.addDays("2026-09-21", 13), "2026-10-04");
    assert.throws(() => sd.isoDate("2026-02-30"), sd.UsageError);
    assert.equal(sd.isoDate("2026-02-28"), "2026-02-28");
  });
});

describe("classification", () => {
  test("a sprint board buckets items and finds unscheduled work", () => {
    const items = [item(1, "In progress", "S2"), item(2, "Todo", "S2"), item(3, "In review"), item(4, "Todo"),
      item(5, "Blocked", "S2"), item(6, "Done", "S2", ["me"], "CLOSED"), item(7, "In progress", "S2", ["someone"])];
    const out = sd.classify(items, "me", NAMES, "S2");
    const numbers = (list) => list.map((i) => i.number);
    assert.deepEqual(numbers(out.sprintItems.inProgress), [1]);
    assert.deepEqual(numbers(out.sprintItems.todo), [2]);
    assert.deepEqual(numbers(out.sprintItems.done), [6]);
    assert.deepEqual(Object.keys(out.sprintItems.otherStatuses), ["Blocked"]);
    assert.deepEqual(numbers(out.unscheduledActive), [3]);
    assert.deepEqual(numbers(out.backlogAssigned), [3, 4]);
  });

  test("the board's own status names map to the lifecycle roles", () => {
    const names = { todo: "Todo", started: "In Progress", review: "In review", done: "Done" };
    const out = sd.classify([item(1, "In Progress", "S2"), item(2, "In Progress")], "me", names, "S2");
    assert.deepEqual(out.sprintItems.inProgress.map((i) => i.number), [1]);
    assert.deepEqual(out.unscheduledActive.map((i) => i.number), [2]);
  });

  test("no current sprint leaves the sprint empty", () => {
    assert.deepEqual(sd.classify([item(1, "Todo", "S1")], "me", NAMES, null).sprintItems.todo, []);
  });

  test("the configured status and iteration fields are read", () => {
    const node = {
      content: {
        __typename: "Issue", number: 9, title: "T", url: "u", state: "OPEN", updatedAt: "x",
        repository: { nameWithOwner: "acme/app" }, assignees: { nodes: [{ login: "me" }] },
        subIssuesSummary: { total: 0 },
      },
      fieldValues: { nodes: [
        { name: "Doing", field: { name: "Stage" } },
        { name: "ignored", field: { name: "Priority" } },
        { title: "Cycle 4", field: { name: "Cycle" } },
      ] },
    };
    const flat = sd.flatten(node, "Stage", "Cycle");
    assert.deepEqual([flat.status, flat.iteration], ["Doing", "Cycle 4"]);
    assert.equal(sd.flatten(node, "Stage", null).iteration, null);
    assert.equal(sd.flatten({ content: {}, fieldValues: { nodes: [] } }, "Status", null), null);
  });
});

describe("arguments and search scope", () => {
  test("search scope uses the repositories or the owner", () => {
    assert.deepEqual(sd.scopeFlags("acme", ["acme/a", "acme/b"]), ["--repo=acme/a", "--repo=acme/b"]);
    assert.deepEqual(sd.scopeFlags("acme", []), ["--owner=acme"]);
  });

  test("flags map to settings with defaults", () => {
    const args = sd.parseArgs(["--owner", "acme", "--project", "Board", "--repo", "acme/a", "--repo=acme/b",
      "--started-status", "Doing"]);
    assert.deepEqual(args.repos, ["acme/a", "acme/b"]);
    assert.equal(args.names.started, "Doing");
    assert.equal(args.names.todo, "Todo");
    assert.equal(args.statusField, "Status");
    assert.throws(() => sd.parseArgs(["--project", "Board"]), sd.UsageError);
    assert.throws(() => sd.parseArgs(["--owner", "acme"]), /--project is required/);
    assert.throws(() => sd.parseArgs(["--owner", "a", "--project", "B", "--date", "tomorrow"]), sd.UsageError);
  });

  test("a board problem asks the user to run the update, with approval and a dry run first", () => {
    assert.match(sd.REPAIR, /^Ask the user to run npx skill-fleet@latest update, which creates or repairs the board\./);
    assert.match(sd.REPAIR, /changes the project board on GitHub, so it runs only with the user's approval/);
    assert.match(sd.REPAIR, /--dry-run/);
    assert.throws(() => sd.pickProject([], "Board", "acme"), (error) => error.message.endsWith(sd.REPAIR));
  });

  test("comment excerpts collapse whitespace and stop at 400 characters", () => {
    assert.equal(sd.excerpt(" a\n\n b\tc "), "a b c");
    assert.equal(sd.excerpt("x".repeat(500)).length, 400);
  });
});
