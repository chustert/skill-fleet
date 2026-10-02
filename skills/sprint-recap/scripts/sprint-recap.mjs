#!/usr/bin/env node
/**
 * Read GitHub activity during a sprint or date window and emit auditable JSON.
 *
 * The owner, board, identity, and iteration definition come from the sibling
 * sprint-status collector, so both skills agree on what a sprint is. Only
 * Node's standard library is used.
 */

import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { parseArgs as parseFlags } from "node:util";
import * as sprintData from "../../sprint-status/scripts/sprint-data.mjs";

const { UsageError, isoDate, addDays, REPAIR } = sprintData;

export const UTC_FALLBACK = "No --timezone was passed, so dates use UTC, not the sprint time zone in "
  + "docs/agents/issue-tracker.md.";

export function timestamp(value) {
  return new Date(value);
}

export function iso(date) {
  return date.toISOString().replace(".000Z", "Z");
}

export function within(value, start, end) {
  if (!value) return false;
  const time = timestamp(value).getTime();
  return start.getTime() <= time && time < end.getTime();
}

function checkTimeZone(timeZone) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
  } catch {
    throw new UsageError(`Unknown time zone ${JSON.stringify(timeZone)}. Use an IANA name, such as Europe/Berlin.`);
  }
  return timeZone;
}

function zoneParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(date);
  const get = (type) => Number(parts.find((p) => p.type === type).value);
  return { year: get("year"), month: get("month"), day: get("day"), hour: get("hour"), minute: get("minute"),
    second: get("second") };
}

/** How far the zone's wall clock is ahead of UTC at this instant, in milliseconds. */
function zoneOffset(date, timeZone) {
  const p = zoneParts(date, timeZone);
  const wallClock = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return wallClock - Math.floor(date.getTime() / 1000) * 1000;
}

/** The instant the given date starts in the time zone, including across daylight-saving changes. */
export function zoneMidnight(date, timeZone) {
  const [y, m, d] = date.split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d);
  let instant = guess - zoneOffset(new Date(guess), timeZone);
  instant = guess - zoneOffset(new Date(instant), timeZone);
  return new Date(instant);
}

/** Today's date in the time zone, as YYYY-MM-DD. */
export function zoneToday(now, timeZone) {
  const p = zoneParts(now, timeZone);
  const pad = (n) => String(n).padStart(2, "0");
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** The start-inclusive, end-exclusive UTC window of a sprint, stopping at now. */
export function window(sprint, timeZone, now) {
  const start = zoneMidnight(sprint.start, timeZone);
  const end = zoneMidnight(addDays(sprint.end, 1), timeZone);
  return [start, end.getTime() < now.getTime() ? end : now];
}

/** Swappable in tests: every GitHub call and warning in this file goes through deps. */
export const deps = {
  warn(message) {
    process.stderr.write(`Warning: ${message}\n`);
  },
  api(endpoint, params = {}) {
    const args = ["api", "--method", "GET", endpoint];
    for (const [key, value] of Object.entries(params)) args.push("-f", `${key}=${value}`);
    return JSON.parse(sprintData.gh(args));
  },
  search(query) {
    return search(query);
  },
  resolveProject: sprintData.resolveProject,
  resolveIterations: sprintData.resolveIterations,
  pages(endpoint) {
    const rows = [];
    for (let page = 1; ; page += 1) {
      const batch = deps.api(endpoint, { per_page: 100, page });
      rows.push(...batch);
      if (batch.length < 100) return rows;
    }
  },
};

/** Paginate, deduplicate, and reject incomplete search results. */
export function search(query) {
  const rows = new Map();
  for (let page = 1; page <= 10; page += 1) {
    const result = deps.api("search/issues", { q: query, per_page: 100, page });
    const total = result.total_count;
    if (result.incomplete_results || total > 1000) {
      throw new Error(`Incomplete GitHub search. Narrow the query: ${query}`);
    }
    for (const row of result.items) rows.set(row.html_url, row);
    if (page * 100 >= total) {
      if (rows.size !== total) throw new Error("GitHub results changed during pagination. Run the recap again.");
      return [...rows.values()];
    }
  }
  throw new Error("GitHub search pagination did not finish.");
}

export function identity(row) {
  const repo = row.repository_url.split("/repos/")[1];
  return {
    repo, number: row.number, title: row.title, url: row.html_url,
    author: row.user?.login ?? null, createdAt: row.created_at, currentState: row.state,
  };
}

export function reviewRows(pr, reviews, me, start, end) {
  return reviews
    .filter((r) => (r.user?.login ?? "").toLowerCase() === me.toLowerCase()
      && r.state !== "PENDING" && within(r.submitted_at, start, end))
    .map((r) => ({
      id: r.id, url: r.html_url, prUrl: pr.url, repo: pr.repo, number: pr.number, title: pr.title,
      submittedAt: r.submitted_at, currentState: r.state,
    }));
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function metrics(activity) {
  const hours = (activity.authoredPRsMerged ?? [])
    .map((p) => (timestamp(p.mergedAt) - timestamp(p.createdAt)) / 3600000);
  return {
    ...Object.fromEntries(Object.entries(activity).map(([key, rows]) => [key, rows.length])),
    distinctPRsReviewed: new Set((activity.reviewsSubmitted ?? []).map((r) => r.prUrl)).size,
    medianHoursOpenToMerge: hours.length ? Math.round(median(hours) * 10) / 10 : null,
    openToMergeSampleSize: hours.length,
  };
}

/** Search qualifier for the listed repositories, or everything the owner has with allRepos. */
export function scopeQualifier(owner, ownerType, repos, allRepos = false) {
  // Several repo: qualifiers in one query match any of them.
  if (repos.length) return repos.map((r) => `repo:${r}`).join(" ");
  if (allRepos) return `${ownerType === "organization" ? "org" : "user"}:${owner}`;
  throw new UsageError(sprintData.SCOPE_REQUIRED);
}

export function collect(me, start, end, scope) {
  // Search a broad UTC date range, then filter authoritative event timestamps.
  const day = (date) => date.toISOString().slice(0, 10);
  const dates = `${day(start)}..${day(end)}`;
  const queries = {
    issues: `${scope} is:issue author:${me} created:${dates}`,
    opened: `${scope} is:pr author:${me} created:${dates}`,
    merged: `${scope} is:pr merged:${dates}`,
    // No upper updated bound: later activity must not hide an earlier review.
    reviewed: `${scope} is:pr reviewed-by:${me} updated:>=${day(start)}`,
  };
  const found = Object.fromEntries(Object.entries(queries).map(([key, query]) => [key, deps.search(query)]));
  const details = new Map();
  const prDetail = (row) => {
    const item = identity(row);
    if (!details.has(item.url)) {
      const pr = deps.api(`repos/${item.repo}/pulls/${item.number}`);
      Object.assign(item, {
        mergedAt: pr.merged_at,
        mergedBy: pr.merged_by?.login ?? null,
        currentState: pr.merged_at ? "merged" : pr.state,
        isDraftNow: pr.draft,
        closedAt: pr.closed_at,
      });
      details.set(item.url, item);
    }
    return details.get(item.url);
  };
  const lower = (value) => (value ?? "").toLowerCase();
  const created = found.issues.filter((r) => within(r.created_at, start, end)).map(identity);
  const opened = found.opened.filter((r) => within(r.created_at, start, end)).map(prDetail);
  const merged = found.merged.map(prDetail).filter((p) => within(p.mergedAt, start, end));
  const reviews = new Map();
  for (const row of found.reviewed) {
    const pr = identity(row);
    if (lower(pr.author) === lower(me)) continue;
    for (const review of reviewRows(pr, deps.pages(`repos/${pr.repo}/pulls/${pr.number}/reviews`), me, start, end)) {
      reviews.set(review.id, review);
    }
  }
  const activity = {
    issuesCreated: created,
    PRsOpened: opened,
    authoredPRsMerged: merged.filter((p) => lower(p.author) === lower(me)),
    mergeActions: merged.filter((p) => lower(p.mergedBy) === lower(me)),
    reviewsSubmitted: [...reviews.values()],
  };
  const order = (a, b) => (a.repo < b.repo ? -1 : a.repo > b.repo ? 1 : 0) || a.number - b.number
    || String(a.submittedAt ?? "").localeCompare(String(b.submittedAt ?? ""));
  for (const rows of Object.values(activity)) rows.sort(order);
  return [activity, queries];
}

const USAGE = `Usage: node sprint-recap.mjs --owner <owner> [--project <number or exact title>]
  (--repo <owner/repo> ... | --all-repos) [--timezone <IANA zone>]
  [--iteration-field <name>]
  [--date YYYY-MM-DD | --since YYYY-MM-DD [--until YYYY-MM-DD]]

Pass --repo for each repository in the routing table of
docs/agents/issue-tracker.md. --all-repos covers every repository the owner has
instead. Pass that file's sprint time zone as --timezone. Without it, dates use
UTC and the script warns.

--date selects the sprint containing that date. --since and --until select an
explicit window instead, such as a month or a quarter.`;

export function parseArgs(argv) {
  let values;
  try {
    ({ values } = parseFlags({
      args: argv,
      options: {
        owner: { type: "string" },
        project: { type: "string" },
        "iteration-field": { type: "string" },
        repo: { type: "string", multiple: true, default: [] },
        "all-repos": { type: "boolean", default: false },
        date: { type: "string" },
        since: { type: "string" },
        until: { type: "string" },
        timezone: { type: "string" },
        help: { type: "boolean", short: "h", default: false },
      },
    }));
  } catch (error) {
    throw new UsageError(`${error.message}\n\n${USAGE}`);
  }
  if (values.help) return { help: USAGE };
  if (!values.owner) throw new UsageError(`--owner is required.\n\n${USAGE}`);
  if (values.since && values.date) {
    throw new UsageError("Use either --date to select a sprint or --since for a window, not both.");
  }
  if (values.until && !values.since) throw new UsageError("--until needs --since.");
  if (!values.since && !values.project) {
    throw new UsageError("Pass --project to recap a sprint, or --since for a date window.");
  }
  return {
    owner: values.owner,
    project: values.project ?? null,
    iterationField: values["iteration-field"] ?? null,
    ...sprintData.repoScope(values.repo, values["all-repos"], USAGE),
    date: values.date ? isoDate(values.date, "--date") : null,
    since: values.since ? isoDate(values.since, "--since") : null,
    until: values.until ? isoDate(values.until, "--until") : null,
    timezone: checkTimeZone(values.timezone ?? "UTC"),
    timezoneDefaulted: values.timezone === undefined,
  };
}

/** The board, the sprint or window, and its UTC bounds. */
export function selectPeriod(args, now) {
  let board;
  let period;
  if (args.since) {
    const until = args.until ?? zoneToday(now, args.timezone);
    if (until < args.since) throw new UsageError("--until is before --since.");
    period = { title: "Custom window", start: args.since, end: until };
    board = args.project ? deps.resolveProject(args.owner, args.project) : null;
  } else {
    const selected = args.date ?? zoneToday(now, args.timezone);
    let field;
    [board, field, period] = deps.resolveIterations(args.owner, args.project, selected, args.iterationField);
    if (!field) {
      throw new UsageError(`The board "${board.title}" has no iteration field. ${REPAIR} `
        + "To recap a date window instead, pass --since and --until.");
    }
    if (!period) throw new UsageError(`No sprint contains ${selected}. Choose a date inside an iteration.`);
  }
  const [start, end] = window(period, args.timezone, now);
  if (start.getTime() >= end.getTime()) throw new UsageError("That period has not started yet.");
  return [board, period, start, end];
}

export function main(argv) {
  const args = parseArgs(argv);
  if (args.help) return args.help;
  if (args.timezoneDefaulted) deps.warn(UTC_FALLBACK);
  const now = new Date();
  const [board, period, start, end] = selectPeriod(args, now);
  const me = deps.api("user").login;
  const scope = scopeQualifier(args.owner, sprintData.ownerRoot(args.owner), args.repos, args.allRepos);
  const [activity, queries] = collect(me, start, end, scope);
  const repositories = [...new Set(Object.values(activity).flatMap((rows) => rows.map((r) => r.repo)))].sort();
  const result = {
    generatedFor: me,
    generatedAt: iso(now),
    project: board ? { title: board.title, url: board.url } : null,
    sprint: period,
    window: { startInclusive: iso(start), endExclusive: iso(end), timezone: args.timezone,
      timezoneDefaulted: args.timezoneDefaulted },
    scope: args.repos.length
      ? `${args.repos.join(", ")}, regardless of board membership`
      : `Accessible ${args.owner} repositories, regardless of board membership`,
    metrics: metrics(activity),
    byRepository: Object.fromEntries(repositories.map((repo) => [repo, metrics(Object.fromEntries(
      Object.entries(activity).map(([key, rows]) => [key, rows.filter((r) => r.repo === repo)])))])),
    activity,
    queries,
    limitations: [
      "GitHub search can lag and only includes records visible to the authenticated account.",
      "Current states and titles are observed now, not reconstructed at the period end.",
      "Opened and merged PRs overlap. Merge actions also overlap with authored PRs merged.",
      "Reviews count submitted reviews on others' PRs, including reviews later dismissed, not comments or pending drafts.",
      "Open-to-merge time includes draft time and time before the period. It is not working time.",
      "Board commitments, hours worked, deployments, and unpushed work are not measured.",
      ...(args.timezoneDefaulted ? [UTC_FALLBACK] : []),
    ],
  };
  return JSON.stringify(result, null, 2);
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  try {
    sprintData.runCommand(main);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
