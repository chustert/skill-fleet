#!/usr/bin/env node
/**
 * Collect branch and worktree state for each local clone of the project.
 *
 * Emits JSON on stdout, or with --format overview the at-a-glance tables the
 * report opens with. Git access is local apart from `git fetch --prune` and,
 * when a merged PR's head commit is missing, a fetch of refs/pull/<n>/head.
 * --no-fetch skips both. GitHub access goes through `gh` and is read-only.
 * The script never creates, removes, or switches a branch or worktree.
 *
 * Nothing here names a project. The skill reads the local paths, the board, and
 * the sprint time zone from the project's docs/agents/issue-tracker.md and
 * passes them as flags.
 * The issue map reuses the sibling sprint-status collector, so both skills
 * agree on the board, the sprint, and the lifecycle statuses. Only Node's
 * standard library is used.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs as parseFlags } from "node:util";
import * as sprintData from "../../sprint-status/scripts/sprint-data.mjs";

const { UsageError, gh, isoDate, daysBetween } = sprintData;

const PR_REF = /(?:^|\/|-)pr-(\d+)(?:-|$)/;
const ISSUE_REF = /(?:^|\/)(\d+)(?:-|$)/;

// Categories, in the order the report presents them.
export const ACTIVE = "active"; // Yours: uncommitted changes, your open PR, or recent unmerged commits
export const OTHERS = "others"; // Someone else's open PR or recent unmerged commits
export const PLACEHOLDER = "placeholder"; // No commits of its own, named after an open issue
export const MERGED = "merged"; // Its PR merged and the branch holds nothing beyond it
export const EMPTY = "empty"; // No commits of its own and no open issue behind it
export const UNMERGED = "unmerged"; // Commits that never merged, with no recent activity
export const MISSING = "missing"; // Worktree folder is gone; Git lists it as prunable

// Never wait for a credential prompt, and never rewrite the index while reading status.
const GIT_ENV = { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0" };

function spawnGit(repo, args) {
  return spawnSync("git", ["-C", repo, ...args], { encoding: "utf8", env: GIT_ENV, maxBuffer: 512 * 1024 * 1024 });
}

export function git(repo, ...args) {
  const res = spawnGit(repo, args);
  if (res.error) {
    throw new UsageError(res.error.code === "ENOENT"
      ? "Git is not installed or not on PATH."
      : `git failed to start: ${res.error.message}`);
  }
  if (res.status !== 0) {
    throw new UsageError(`git ${args.slice(0, 3).join(" ")} failed in ${repo}: ${(res.stderr ?? "").trim()}`);
  }
  return res.stdout;
}

function gitOk(repo, ...args) {
  return spawnGit(repo, args).status === 0;
}

function isAncestor(repo, commit, other) {
  return gitOk(repo, "merge-base", "--is-ancestor", commit, other);
}

const pick = (object, keys) => Object.fromEntries(keys.map((key) => [key, object[key] ?? null]));

function localDate(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function isDirectory(target) {
  try {
    return fs.statSync(target).isDirectory();
  } catch {
    return false;
  }
}

function samePath(a, b) {
  const norm = (p) => (process.platform === "win32" ? path.resolve(p).toLowerCase() : path.resolve(p));
  return norm(a) === norm(b);
}

/** A path relative to the folder that holds the project, else from the home folder. */
export function displayPath(target, parent = null, home = os.homedir()) {
  const resolved = path.resolve(target);
  const below = (base) => {
    const relative = path.relative(base, resolved);
    const outside = !relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative);
    return outside ? null : relative;
  };
  const fromParent = parent && below(parent);
  if (fromParent) return fromParent;
  const fromHome = below(home);
  return fromHome ? `~${path.sep}${fromHome}` : resolved;
}

/** The owner/repo a GitHub remote URL points at, or null for another host. */
export function githubSlug(remote) {
  return /github\.com[:/](.+?)(?:\.git)?\/?$/.exec(remote)?.[1] ?? null;
}

/** The top of the Git checkout that holds dir, or null when dir is in none. */
export function repositoryRoot(dir) {
  const res = spawnGit(dir, ["rev-parse", "--show-toplevel"]);
  return res.status === 0 ? fs.realpathSync.native(res.stdout.trim()) : null;
}

/** Parse `git worktree list --porcelain` into one object per worktree. */
export function parseWorktrees(text) {
  const worktrees = [];
  let current = null;
  for (const line of [...text.split("\n"), ""]) {
    if (!line) {
      if (current) worktrees.push(current);
      current = null;
      continue;
    }
    const space = line.indexOf(" ");
    const key = space === -1 ? line : line.slice(0, space);
    const value = space === -1 ? "" : line.slice(space + 1);
    if (key === "worktree") current = { path: value, head: null, branch: null, detached: false, prunable: false };
    else if (!current) continue;
    else if (key === "HEAD") current.head = value;
    else if (key === "branch") current.branch = value.replace(/^refs\/heads\//, "");
    else if (key === "detached") current.detached = true;
    else if (key === "prunable") current.prunable = true;
  }
  return worktrees;
}

/** The changed paths from `git status --porcelain=v1 -z`. */
export function parseStatus(text) {
  const paths = [];
  const entries = text.split("\0");
  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i];
    if (entry.length < 4) continue;
    paths.push(entry.slice(3));
    if (entry[0] === "R" || entry[0] === "C") i += 1; // The original path of a rename or copy follows.
  }
  return paths;
}

export function plural(n, word, many = `${word}s`) {
  return `${n} ${n === 1 ? word : many}`;
}

/** The [issue number, PR number] a branch name carries; either may be null. */
export function branchRefs(name) {
  const pr = PR_REF.exec(name);
  if (pr) return [null, Number(pr[1])];
  const issue = ISSUE_REF.exec(name);
  return [issue ? Number(issue[1]) : null, null];
}

/** Place one branch or detached worktree in a category, with the reasons behind it. */
export function classify(entry, today, activeDays) {
  const worktree = entry.worktree ?? {};
  const upstream = entry.upstream ?? null;
  const pr = entry.pr ?? null;
  const reasons = [];

  if (upstream?.unpushed) reasons.push(`${plural(upstream.unpushed, "commit")} not pushed`);
  else if (entry.ownCommits && !upstream && !entry.detached) reasons.push("local only");
  if (upstream?.behind) reasons.push(`local copy ${plural(upstream.behind, "commit")} behind its upstream`);

  if (worktree.missing) return [MISSING, ["worktree folder is gone"]];
  if (worktree.dirty) {
    const edit = worktree.newestEdit ? `, newest edit ${worktree.newestEdit}` : "";
    reasons.unshift(`${plural(worktree.dirty, "uncommitted file")}${edit}`);
    return [ACTIVE, reasons];
  }
  if (pr?.state === "OPEN") return [pr.mine ? ACTIVE : OTHERS, reasons];
  if (pr?.state === "MERGED" && entry.containedInPr) return [MERGED, reasons];

  // A branch named after a PR, such as review/pr-189, is a review checkout.
  const review = entry.reviewOf;
  if (review && !pr) {
    const label = `review checkout of ${review.state.toLowerCase()} PR #${review.number}`;
    if (review.state === "OPEN") return [review.mine ? ACTIVE : OTHERS, [label, ...reasons]];
    if (entry.ownCommits === 0 || review.contained) return [review.state === "MERGED" ? MERGED : EMPTY, [label]];
    reasons.unshift(`${label}, with commits that PR does not contain`);
  }

  if (entry.ownCommits === 0) {
    const issue = entry.issue;
    if (issue && issue.state === "OPEN" && issue.isIssue) return [PLACEHOLDER, reasons];
    return [EMPTY, ["no commits of its own", ...reasons]];
  }

  if (pr?.state === "CLOSED") return [UNMERGED, ["PR closed without merging", ...reasons]];
  if (pr?.state === "MERGED" && entry.containedInPr === null) {
    return [UNMERGED, ["its PR merged, but the PR head could not be fetched to confirm nothing is left", ...reasons]];
  }
  if (pr?.state === "MERGED") reasons.unshift("commits after its PR merged");
  if (daysBetween(entry.lastCommit.date, today) <= activeDays) {
    return [entry.lastCommit.mine ? ACTIVE : OTHERS, reasons];
  }
  return [UNMERGED, reasons];
}

export class Repository {
  /** parent is the folder that holds the project; paths display relative to it. */
  constructor(repoPath, me, fetch, parent = null) {
    this.path = repoPath;
    this.fetch = fetch;
    this.parent = parent;
    if (fetch) {
      try {
        git(repoPath, "fetch", "--quiet", "--prune");
      } catch (error) {
        throw new UsageError(`${error.message}\nPass --no-fetch to report from the local state alone.`);
      }
    }
    const remote = git(repoPath, "remote", "get-url", "origin").trim();
    this.slug = githubSlug(remote);
    if (!this.slug) throw new UsageError(`The origin remote of ${repoPath} is not on GitHub: ${remote}`);
    let head;
    try {
      head = git(repoPath, "symbolic-ref", "--short", "refs/remotes/origin/HEAD").trim();
    } catch {
      head = "origin/main";
    }
    this.base = head;
    this.default = head.slice(head.indexOf("/") + 1);
    this.me = me;
    this.emails = new Set([this.config("user.email")].filter(Boolean));
    this.names = new Set([this.config("user.name")].filter(Boolean));
    this.prs = this.pullRequests();
  }

  config(key) {
    try {
      return git(this.path, "config", key).trim();
    } catch {
      return "";
    }
  }

  count(range) {
    return Number(git(this.path, "rev-list", "--count", range, "--").trim() || 0);
  }

  pullRequests() {
    const rows = JSON.parse(gh(["pr", "list", "--repo", this.slug, "--state", "all", "--limit", "1000",
      "--json", "number,title,url,state,isDraft,headRefName,headRefOid,author,updatedAt,mergedAt"]) || "[]");
    const openRows = JSON.parse(gh(["pr", "list", "--repo", this.slug, "--state", "open", "--limit", "200",
      "--json", "number,closingIssuesReferences"]) || "[]");
    const closes = new Map(openRows.map((r) => [r.number, (r.closingIssuesReferences ?? []).map((c) => ({
      repo: `${c.repository.owner.login}/${c.repository.name}`,
      number: c.number,
      url: c.url,
    }))]));
    for (const row of rows) {
      row.author = row.author?.login ?? null;
      row.mine = row.author === this.me;
      row.closes = closes.get(row.number) ?? [];
    }
    return rows;
  }

  /** Prefer an open PR from the branch, then the newest; else an open PR at this commit. */
  prFor(name, sha) {
    const named = this.prs.filter((p) => name && p.headRefName === name)
      .sort((a, b) => (b.state === "OPEN") - (a.state === "OPEN") || b.number - a.number);
    if (named.length) return named[0];
    return this.prs.find((p) => p.state === "OPEN" && p.headRefOid === sha) ?? null;
  }

  /**
   * Whether the PR holds every commit on this branch; null when that cannot be checked.
   *
   * After a squash merge only the PR head proves it. A deleted head branch
   * leaves that commit missing locally, so fetch it from refs/pull/<n>/head.
   */
  contained(sha, pr) {
    if (pr.headRefOid === sha || isAncestor(this.path, sha, this.base)) return true;
    const present = () => gitOk(this.path, "cat-file", "-e", pr.headRefOid);
    if (!present() && this.fetch) gitOk(this.path, "fetch", "--quiet", "origin", `refs/pull/${pr.number}/head`);
    if (!present()) return null;
    return isAncestor(this.path, sha, pr.headRefOid);
  }

  commit(ref) {
    const [sha, date, name, email] = git(this.path, "log", "-1", "--format=%H%x00%cs%x00%an%x00%ae", ref, "--")
      .trim().split("\0");
    return { sha, date, author: name, mine: this.emails.has(email) || this.names.has(name) };
  }

  worktreeState(wt) {
    const missing = wt.prunable || !isDirectory(wt.path);
    const state = { path: wt.path, display: displayPath(wt.path, this.parent), isMain: samePath(wt.path, this.path),
      missing, dirty: 0, newestEdit: null };
    if (missing) return state;
    const paths = parseStatus(git(wt.path, "status", "--porcelain=v1", "-z", "--untracked-files=all"));
    let newest = null;
    for (const file of paths) {
      try {
        newest = Math.max(newest ?? 0, fs.statSync(path.join(wt.path, file)).mtimeMs);
      } catch {
        // Deleted in the worktree, so it has no edit time.
      }
    }
    state.dirty = paths.length;
    if (newest !== null) state.newestEdit = localDate(new Date(newest));
    return state;
  }

  entry(name, sha, worktree, upstreamName, gone, issues, today, activeDays) {
    let upstream = null;
    let head = sha;
    if (upstreamName && !gone) {
      const [unpushed, behind] = git(this.path, "rev-list", "--left-right", "--count", `${sha}...${upstreamName}`,
        "--").trim().split(/\s+/).map(Number);
      upstream = { name: upstreamName, unpushed, behind };
      if (behind && !unpushed) head = upstreamName; // Judge a stale local copy by what its upstream holds.
    } else if (upstreamName) {
      upstream = { name: upstreamName, gone: true, unpushed: 0, behind: 0 };
    }

    const pr = this.prFor(name, sha);
    const contained = pr?.state === "MERGED" ? this.contained(sha, pr) : false;
    const [issueNumber, prNumber] = branchRefs(name ?? "");
    const entry = {
      branch: name,
      detached: name === null,
      head: sha.slice(0, 7),
      worktree,
      lastCommit: this.commit(head),
      ownCommits: this.count(`${this.base}..${head}`),
      behindBase: this.count(`${head}..${this.base}`),
      upstream,
      pr: pr && pick(pr, ["number", "title", "url", "state", "isDraft", "author", "mine", "updatedAt", "mergedAt",
        "closes"]),
      containedInPr: contained,
      issueRef: issueNumber,
      prRef: prNumber,
      issue: null,
    };
    if (issueNumber && !(pr?.state === "MERGED" && contained)) entry.issue = issues(this.slug, issueNumber);
    if (prNumber && !entry.pr) {
      const match = this.prs.find((p) => p.number === prNumber);
      if (match) {
        entry.reviewOf = { ...pick(match, ["number", "url", "state", "author", "mine"]),
          contained: this.contained(sha, match) };
      }
    }
    [entry.category, entry.reasons] = classify(entry, today, activeDays);
    return entry;
  }

  collect(issues, today, activeDays) {
    const worktrees = parseWorktrees(git(this.path, "worktree", "list", "--porcelain"));
    const byBranch = new Map(worktrees.filter((w) => w.branch).map((w) => [w.branch, w]));
    const root = worktrees.find((w) => samePath(w.path, this.path)) ?? worktrees[0];

    const entries = [];
    const refs = git(this.path, "for-each-ref", "refs/heads",
      "--format=%(refname:short)%00%(objectname)%00%(upstream:short)%00%(upstream:track)");
    let localDefault = null;
    for (const line of refs.split("\n").filter(Boolean)) {
      const [name, sha, upstream, track] = line.split("\0");
      if (name === this.default) {
        localDefault = sha;
        continue;
      }
      const wt = byBranch.get(name);
      entries.push(this.entry(name, sha, wt ? this.worktreeState(wt) : null, upstream, track.includes("[gone]"),
        issues, today, activeDays));
    }
    for (const wt of worktrees) {
      const unnamed = wt.detached || (!wt.branch && wt.prunable);
      if (!unnamed) continue;
      const state = this.worktreeState(wt);
      if (state.missing || !wt.head) {
        entries.push({ branch: null, detached: true, head: (wt.head ?? "").slice(0, 7), worktree: state,
          category: MISSING, reasons: ["worktree folder is gone"] });
        continue;
      }
      entries.push(this.entry(null, wt.head, state, null, false, issues, today, activeDays));
    }

    const localNames = new Set([...entries.filter((e) => e.branch).map((e) => e.branch), this.default]);
    const localShas = new Set(worktrees.filter((w) => w.head).map((w) => w.head));
    return {
      repo: this.slug,
      path: this.path,
      defaultBranch: this.default,
      rootCheckout: {
        branch: root.branch ?? "(detached)",
        display: displayPath(root.path, this.parent),
        dirty: this.worktreeState(root).dirty,
      },
      localDefaultBehind: localDefault ? this.count(`${localDefault}..${this.base}`) : null,
      entries,
      openPrsNotLocal: this.prs
        .filter((p) => p.state === "OPEN" && !localNames.has(p.headRefName) && !localShas.has(p.headRefOid))
        .map((p) => pick(p, ["number", "title", "url", "author", "mine", "isDraft", "updatedAt", "headRefName"])),
    };
  }
}

/** Look up an issue once per run; null when it does not exist or this account cannot see it. */
export function issueLookup(cache = new Map()) {
  return (slug, number) => {
    const key = `${slug}#${number}`;
    if (!cache.has(key)) {
      try {
        const raw = JSON.parse(gh(["api", `repos/${slug}/issues/${number}`]));
        cache.set(key, { repo: slug, number, title: raw.title, url: raw.html_url, state: raw.state.toUpperCase(),
          isIssue: !("pull_request" in raw) });
      } catch (error) {
        if (!(error instanceof UsageError)) throw error;
        cache.set(key, null);
      }
    }
    return cache.get(key);
  };
}

/** Open board items assigned to the user that are in this sprint or already started. */
export function sprintIssues(board, me, today) {
  const [project, field, current] = sprintData.resolveIterations(board.owner, board.project, today,
    board.iterationField);
  if (!field) throw new UsageError(`The board "${project.title}" has no iteration field. ${sprintData.REPAIR}`);
  const items = sprintData.fetchItems(board.owner, project.number)
    .map((node) => sprintData.flatten(node, board.statusField, field))
    .filter(Boolean);
  const buckets = sprintData.classify(items, me, board.names, current?.title ?? null);
  const sprint = buckets.sprintItems;
  const chosen = [...sprint.inProgress, ...sprint.inReview, ...sprint.todo,
    ...Object.values(sprint.otherStatuses).flat()];
  for (const item of buckets.unscheduledActive) chosen.push({ ...item, unscheduled: true });
  return [project, current, chosen];
}

// GitHub names ignore case, and a remote URL may spell one differently from the API.
const issueKey = (repo, number) => `${repo.toLowerCase()}#${number}`;

/** Where each issue, or one of its open sub-issues, lives in the local clones. */
export function issueLocations(items, repos) {
  const local = new Set(repos.map((r) => r.repo.toLowerCase()));
  return items.map((item) => {
    const targets = new Set([issueKey(item.repo, item.number)]);
    for (const child of item.subIssues?.children ?? []) {
      if (child.state === "OPEN") targets.add(issueKey(child.repo, child.number));
    }
    const locations = [];
    for (const repo of repos) {
      for (const e of repo.entries) {
        if (!e.branch && !e.pr) continue;
        const named = targets.has(issueKey(repo.repo, e.issueRef));
        const closes = (e.pr?.closes ?? []).some((c) => targets.has(issueKey(c.repo, c.number)));
        if (!named && !closes) continue;
        locations.push({
          repo: repo.repo,
          branch: e.branch,
          worktree: e.worktree?.display ?? null,
          category: e.category,
          ownCommits: e.ownCommits ?? null,
          dirty: e.worktree?.dirty ?? 0,
          pr: e.pr ? pick(e.pr, ["number", "url", "state"]) : null,
          reasons: e.reasons,
        });
      }
    }
    return {
      repo: item.repo,
      number: item.number,
      title: item.title,
      url: item.url,
      status: item.status,
      iteration: item.iteration,
      unscheduled: item.unscheduled ?? false,
      assignees: item.assignees,
      subIssues: item.subIssues,
      localClone: local.has(item.repo.toLowerCase()),
      locations,
    };
  });
}

// The skill's categories table lists the same icons. Change them there too.
export const ICONS = { [ACTIVE]: "🟢", [PLACEHOLDER]: "🟡", [OTHERS]: "🔵", [UNMERGED]: "🟠", [MERGED]: "⚪",
  [EMPTY]: "⚪", [MISSING]: "⚫" };
const ORDER = [ACTIVE, PLACEHOLDER, OTHERS, UNMERGED, MERGED, EMPTY, MISSING];
const LEGEND = "🟢 your active work · 🟡 issue branch, no commits yet · 🔵 someone else's work · "
  + "🟠 never merged, dormant · ⚪ merged or empty, safe to remove · ⚫ folder gone · "
  + "🏠 checkout on the default branch";

const repoName = (slug) => slug.split("/").at(-1);
const compare = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

function refLink(slug, number, url) {
  return `[${repoName(slug)}#${number}](${url})`;
}

/** The PR, reviewed PR, and open issue behind an entry, as links. */
function linked(slug, e) {
  const parts = [];
  const pr = e.pr;
  if (pr) {
    let text = `${refLink(slug, pr.number, pr.url)} ${pr.state.toLowerCase()}`;
    if (pr.closes?.length) text += `, closes ${pr.closes.map((c) => refLink(c.repo, c.number, c.url)).join(", ")}`;
    parts.push(text);
  }
  const review = e.reviewOf;
  if (review) parts.push(`review of ${refLink(slug, review.number, review.url)} ${review.state.toLowerCase()}`);
  const issue = e.issue;
  const closedByPr = new Set((pr?.closes ?? []).map((c) => issueKey(c.repo, c.number)));
  if (issue?.isIssue && issue.state === "OPEN" && !closedByPr.has(issueKey(issue.repo, issue.number))) {
    parts.push(refLink(issue.repo, issue.number, issue.url));
  }
  return parts.join("; ") || "—";
}

function overviewRow(slug, e, checkout) {
  const notes = [...e.reasons];
  if ([ACTIVE, OTHERS, UNMERGED].includes(e.category) && e.ownCommits) {
    notes.unshift(`${plural(e.ownCommits, "commit")} not on the default branch`);
  }
  const last = e.ownCommits ? e.lastCommit : null; // Otherwise it is the base commit.
  const when = last ? `${last.date}${last.mine ? "" : ` · ${last.author}`}` : "—";
  const branch = e.branch ? `\`${e.branch}\`` : `detached at \`${e.head}\``;
  return `| ${ICONS[e.category]} | ${checkout} | ${branch} | ${linked(slug, e)} | ${when} | ${notes.join("; ") || "—"} |`;
}

/** Markdown tables showing each repository's checkouts and branches at a glance. */
export function renderOverview(data) {
  const lines = ["## At a glance", "", LEGEND];
  const rank = (e) => ORDER.indexOf(e.category);
  for (const repo of data.repositories) {
    const slug = repo.repo;
    const root = repo.rootCheckout;
    const entries = repo.entries;
    lines.push("", `### ${repoName(slug)}`, "",
      "| | Checkout | Branch | Linked to | Last commit | Notes |",
      "|---|---|---|---|---|---|");

    const onRoot = entries.find((e) => e.worktree?.isMain);
    if (onRoot) {
      lines.push(overviewRow(slug, onRoot, `\`${root.display}\` (main checkout)`));
    } else {
      const notes = [];
      if (repo.localDefaultBehind) notes.push(`local copy ${plural(repo.localDefaultBehind, "commit")} behind origin`);
      if (root.dirty) notes.push(plural(root.dirty, "uncommitted file"));
      lines.push(`| 🏠 | \`${root.display}\` (main checkout) | \`${root.branch}\` | — | — | `
        + `${notes.join("; ") || "up to date"} |`);
    }

    const worktrees = entries.filter((e) => e.worktree && !e.worktree.isMain)
      .sort((a, b) => rank(a) - rank(b) || compare(a.worktree.display, b.worktree.display));
    for (const e of worktrees) lines.push(overviewRow(slug, e, `\`${e.worktree.display}\``));

    const loose = entries.filter((e) => !e.worktree)
      .sort((a, b) => rank(a) - rank(b) || compare(a.branch ?? "", b.branch ?? ""));
    for (const e of loose) {
      if ([ACTIVE, PLACEHOLDER, OTHERS].includes(e.category)) lines.push(overviewRow(slug, e, "no worktree"));
    }
    for (const p of repo.openPrsNotLocal) {
      const state = p.isDraft ? "draft" : "open";
      const who = p.mine ? "" : ` · ${p.author}`;
      lines.push(`| ${p.mine ? "🟢" : "🔵"} | not checked out | \`${p.headRefName}\` | `
        + `${refLink(slug, p.number, p.url)} ${state} | ${(p.updatedAt ?? "").slice(0, 10)}${who} | — |`);
    }

    const safe = loose.filter((e) => e.category === MERGED || e.category === EMPTY).length;
    const kept = loose.filter((e) => e.category === UNMERGED).length;
    if (safe) {
      lines.push(`| ⚪ | no worktree | ${plural(safe, "merged or empty branch", "merged or empty branches")} `
        + "| — | — | safe to delete |");
    }
    if (kept) {
      lines.push(`| 🟠 | no worktree | ${plural(kept, "never-merged branch", "never-merged branches")} `
        + "| — | — | decide before deleting |");
    }
  }
  return `${lines.join("\n")}\n`;
}

const USAGE = `Usage: node repos-data.mjs --owner <owner> --project <number or exact title>
  [--path <local path> ...] [--active-days N] [--no-fetch] [--timezone <IANA zone>]
  [--date YYYY-MM-DD] [--status-field <name>] [--iteration-field <name>]
  [--todo-status <name>] [--started-status <name>] [--review-status <name>]
  [--done-status <name>] [--format json|overview]
       node repos-data.mjs --no-sprint [--path <local path> ...] [--active-days N] [--no-fetch]
  [--timezone <IANA zone>] [--format json|overview]
       node repos-data.mjs --from-json <file> [--format json|overview]

Each --path is a local path from the routing table in docs/agents/issue-tracker.md,
relative to the current folder. Omit it to report on the current folder's
repository alone. The board is the one that file names; --no-sprint skips the
issue map and needs no board. Pass that file's sprint time zone as --timezone.
Without it or --date, today's date comes from this machine's clock and the
script warns.

--format overview prints the at-a-glance tables instead of JSON. --from-json
reads the JSON an earlier run saved instead of collecting it again.`;

export function parseArgs(argv) {
  let values;
  try {
    ({ values } = parseFlags({
      args: argv,
      options: {
        path: { type: "string", multiple: true, default: [] },
        "active-days": { type: "string", default: "14" },
        "no-fetch": { type: "boolean", default: false },
        "no-sprint": { type: "boolean", default: false },
        date: { type: "string" },
        timezone: { type: "string" },
        owner: { type: "string" },
        project: { type: "string" },
        "status-field": { type: "string", default: "Status" },
        "iteration-field": { type: "string" },
        "todo-status": { type: "string", default: "Todo" },
        "started-status": { type: "string", default: "In progress" },
        "review-status": { type: "string", default: "In review" },
        "done-status": { type: "string", default: "Done" },
        format: { type: "string", default: "json" },
        "from-json": { type: "string" },
        help: { type: "boolean", short: "h", default: false },
      },
    }));
  } catch (error) {
    throw new UsageError(`${error.message}\n\n${USAGE}`);
  }
  if (values.help) return { help: USAGE };
  const format = values.format;
  if (!["json", "overview"].includes(format)) {
    throw new UsageError(`--format must be json or overview, not ${JSON.stringify(format)}.`);
  }
  if (values["from-json"]) return { fromJson: values["from-json"], format };
  if (!/^\d+$/.test(values["active-days"])) {
    throw new UsageError(`--active-days must be a whole number of days, not ${JSON.stringify(values["active-days"])}.`);
  }
  let board = null;
  if (!values["no-sprint"]) {
    if (!values.owner || !values.project) {
      throw new UsageError(`--owner and --project are required for the issue map. Pass --no-sprint to skip it.\n\n${USAGE}`);
    }
    board = {
      owner: values.owner,
      project: values.project,
      statusField: values["status-field"],
      iterationField: values["iteration-field"] ?? null,
      names: {
        todo: values["todo-status"],
        started: values["started-status"],
        review: values["review-status"],
        done: values["done-status"],
      },
    };
  }
  return {
    paths: values.path,
    activeDays: Number(values["active-days"]),
    fetch: !values["no-fetch"],
    date: values.date ? isoDate(values.date, "--date") : null,
    timezone: values.timezone === undefined ? null : sprintData.checkTimeZone(values.timezone),
    board,
    format,
  };
}

export function collect(args, root = process.cwd(), now = new Date()) {
  const { today, timezone, timezoneDefaulted } = sprintData.sprintToday(args.date, args.timezone, now);
  if (timezoneDefaulted) sprintData.io.warn(sprintData.MACHINE_CLOCK);
  const me = sprintData.viewerLogin();
  const lookup = issueLookup();

  const parent = path.dirname(fs.realpathSync.native(root));
  const repositories = [];
  const skipped = [];
  const seen = new Set();
  for (const relative of args.paths.length ? args.paths : ["."]) {
    const top = repositoryRoot(path.resolve(root, relative));
    if (!top) {
      skipped.push(relative);
      continue;
    }
    // Components of one repository share a clone; report it once.
    if (seen.has(top)) continue;
    seen.add(top);
    repositories.push(new Repository(top, me, args.fetch, parent).collect(lookup, today, args.activeDays));
  }

  let sprint = null;
  if (args.board) {
    try {
      const [project, current, items] = sprintIssues(args.board, me, today);
      sprint = { project: { title: project.title, url: project.url }, current,
        issues: issueLocations(items, repositories) };
    } catch (error) {
      if (!(error instanceof UsageError)) throw error;
      sprint = { error: error.message };
    }
  }

  return {
    generatedFor: me,
    today,
    timezone,
    timezoneDefaulted,
    activeDays: args.activeDays,
    fetched: args.fetch,
    skippedRepositories: skipped,
    repositories,
    sprint,
  };
}

function readReport(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    throw new UsageError(`Cannot read the report data in ${file}: ${error.message}`);
  }
}

export function main(argv) {
  const args = parseArgs(argv);
  if (args.help) return args.help;
  const data = args.fromJson ? readReport(args.fromJson) : collect(args);
  return args.format === "overview" ? renderOverview(data) : JSON.stringify(data, null, 2);
}

if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) {
  sprintData.runCommand(main);
}
