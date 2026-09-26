#!/usr/bin/env python3
"""Read GitHub activity during a sprint or date window and emit auditable JSON."""

import argparse
import datetime as dt
import importlib.util
import json
from pathlib import Path
import statistics
import sys
from zoneinfo import ZoneInfo


# Keep the owner, board, identity, and iteration definition shared with sprint-status.
SOURCE = Path(__file__).resolve().parents[2] / "sprint-status/scripts/sprint_data.py"
spec = importlib.util.spec_from_file_location("sprint_data", SOURCE)
sprint_data = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sprint_data)
UTC = dt.timezone.utc


def timestamp(value):
    return dt.datetime.fromisoformat(value.replace("Z", "+00:00"))


def iso(value):
    return value.astimezone(UTC).isoformat().replace("+00:00", "Z")


def within(value, start, end):
    return bool(value) and start <= timestamp(value) < end


def window(sprint, timezone, now):
    start = dt.datetime.combine(dt.date.fromisoformat(sprint["start"]), dt.time(), timezone)
    end_date = dt.date.fromisoformat(sprint["end"]) + dt.timedelta(days=1)
    end = dt.datetime.combine(end_date, dt.time(), timezone)
    return start.astimezone(UTC), min(end.astimezone(UTC), now)


def api(endpoint, **params):
    args = ["api", "--method", "GET", endpoint]
    for key, value in params.items():
        args += ["-f", f"{key}={value}"]
    return json.loads(sprint_data.gh(args))


def search(query):
    """Paginate, deduplicate, and reject incomplete search results."""
    rows = {}
    for page in range(1, 11):
        result = api("search/issues", q=query, per_page=100, page=page)
        total = result["total_count"]
        if result.get("incomplete_results") or total > 1000:
            raise RuntimeError(f"Incomplete GitHub search. Narrow the query: {query}")
        for row in result["items"]:
            rows[row["html_url"]] = row
        if page * 100 >= total:
            if len(rows) != total:
                raise RuntimeError("GitHub results changed during pagination. Run the recap again.")
            return list(rows.values())
    raise RuntimeError("GitHub search pagination did not finish.")


def pages(endpoint):
    rows, page = [], 1
    while True:
        batch = api(endpoint, per_page=100, page=page)
        rows.extend(batch)
        if len(batch) < 100:
            return rows
        page += 1


def identity(row):
    repo = row["repository_url"].split("/repos/", 1)[1]
    return {
        "repo": repo, "number": row["number"], "title": row["title"],
        "url": row["html_url"], "author": (row.get("user") or {}).get("login"),
        "createdAt": row["created_at"], "currentState": row["state"],
    }


def review_rows(pr, reviews, me, start, end):
    return [
        {"id": r["id"], "url": r["html_url"], "prUrl": pr["url"],
         "repo": pr["repo"], "number": pr["number"], "title": pr["title"],
         "submittedAt": r["submitted_at"], "currentState": r["state"]}
        for r in reviews
        if (r.get("user") or {}).get("login", "").lower() == me.lower()
        and r["state"] != "PENDING" and within(r.get("submitted_at"), start, end)
    ]


def metrics(activity):
    merged = activity["authoredPRsMerged"]
    hours = [(timestamp(p["mergedAt"]) - timestamp(p["createdAt"])).total_seconds() / 3600
             for p in merged]
    return {
        **{key: len(rows) for key, rows in activity.items()},
        "distinctPRsReviewed": len({r["prUrl"] for r in activity["reviewsSubmitted"]}),
        "medianHoursOpenToMerge": round(statistics.median(hours), 1) if hours else None,
        "openToMergeSampleSize": len(hours),
    }


def scope_qualifier(owner, owner_type, repos):
    """Search qualifier for the listed repositories, or everything the owner has.

    Several repo: qualifiers in one query match any of them.
    """
    if repos:
        return " ".join(f"repo:{r}" for r in repos)
    return f"{'org' if owner_type == 'organization' else 'user'}:{owner}"


def collect(me, start, end, scope):
    # Search a broad UTC date range, then filter authoritative event timestamps.
    dates = f"{start.date().isoformat()}..{end.date().isoformat()}"
    queries = {
        "issues": f"{scope} is:issue author:{me} created:{dates}",
        "opened": f"{scope} is:pr author:{me} created:{dates}",
        "merged": f"{scope} is:pr merged:{dates}",
        # No upper updated bound: later activity must not hide an earlier review.
        "reviewed": f"{scope} is:pr reviewed-by:{me} updated:>={start.date().isoformat()}",
    }
    found = {key: search(query) for key, query in queries.items()}
    details = {}

    def pr_detail(row):
        item = identity(row)
        if item["url"] not in details:
            pr = api(f"repos/{item['repo']}/pulls/{item['number']}")
            item.update({
                "mergedAt": pr["merged_at"],
                "mergedBy": (pr.get("merged_by") or {}).get("login"),
                "currentState": "merged" if pr["merged_at"] else pr["state"],
                "isDraftNow": pr["draft"],
                "closedAt": pr["closed_at"],
            })
            details[item["url"]] = item
        return details[item["url"]]

    created = [identity(r) for r in found["issues"] if within(r["created_at"], start, end)]
    opened = [pr_detail(r) for r in found["opened"] if within(r["created_at"], start, end)]
    merged = [pr_detail(r) for r in found["merged"]]
    merged = [p for p in merged if within(p["mergedAt"], start, end)]
    reviews = {}
    for row in found["reviewed"]:
        pr = identity(row)
        if (pr["author"] or "").lower() == me.lower():
            continue
        for review in review_rows(pr, pages(f"repos/{pr['repo']}/pulls/{pr['number']}/reviews"),
                                  me, start, end):
            reviews[review["id"]] = review
    activity = {
        "issuesCreated": created,
        "PRsOpened": opened,
        "authoredPRsMerged": [p for p in merged if (p["author"] or "").lower() == me.lower()],
        "mergeActions": [p for p in merged if (p["mergedBy"] or "").lower() == me.lower()],
        "reviewsSubmitted": list(reviews.values()),
    }
    for rows in activity.values():
        rows.sort(key=lambda r: (r["repo"], r["number"], r.get("submittedAt", "")))
    return activity, queries


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--owner", required=True,
                        help="Organization or user that owns the board and repositories")
    parser.add_argument("--project", help="Board number or exact title")
    parser.add_argument("--iteration-field",
                        help="Iteration field name. Default: the board's first iteration field")
    parser.add_argument("--repo", action="append", default=[],
                        help="owner/repo to include; repeatable. Omit to cover the whole owner")
    parser.add_argument("--date", type=dt.date.fromisoformat,
                        help="Select the sprint containing this date, not a report cutoff")
    parser.add_argument("--since", type=dt.date.fromisoformat,
                        help="Start date of an explicit window, instead of a sprint")
    parser.add_argument("--until", type=dt.date.fromisoformat,
                        help="Last date of an explicit window, inclusive. Default: today")
    parser.add_argument("--timezone", default="UTC",
                        help="IANA time zone for sprint and window dates")
    args = parser.parse_args(argv)
    if args.since and args.date:
        parser.error("Use either --date to select a sprint or --since for a window, not both.")
    if args.until and not args.since:
        parser.error("--until needs --since.")
    if not args.since and not args.project:
        parser.error("Pass --project to recap a sprint, or --since for a date window.")
    return parser, args


def select_period(parser, args, timezone, now):
    """Return the board, the sprint or window, and its UTC bounds."""
    if args.since:
        until = args.until or now.astimezone(timezone).date()
        if until < args.since:
            parser.error("--until is before --since.")
        period = {"title": "Custom window", "start": args.since.isoformat(),
                  "end": until.isoformat()}
        board = (sprint_data.resolve_project(args.owner, args.project)
                 if args.project else None)
    else:
        selected = args.date or now.astimezone(timezone).date()
        board, field, period, _ = sprint_data.resolve_iterations(
            args.owner, args.project, selected, args.iteration_field)
        if not field:
            parser.error("The board has no iteration field. Use --since and --until.")
        if not period:
            parser.error(f"No sprint contains {selected}. Choose a date inside an iteration.")
    start, end = window(period, timezone, now)
    if start >= end:
        parser.error("That period has not started yet.")
    return board, period, start, end


def main(argv=None):
    parser, args = parse_args(argv)
    timezone = ZoneInfo(args.timezone)
    now = dt.datetime.now(UTC)
    board, period, start, end = select_period(parser, args, timezone, now)
    me = api("user")["login"]
    scope = scope_qualifier(args.owner, sprint_data.owner_root(args.owner), args.repo)
    activity, queries = collect(me, start, end, scope)
    repositories = sorted({r["repo"] for rows in activity.values() for r in rows})
    result = {
        "generatedFor": me, "generatedAt": iso(now),
        "project": {"title": board["title"], "url": board["url"]} if board else None,
        "sprint": period,
        "window": {"startInclusive": iso(start), "endExclusive": iso(end), "timezone": args.timezone},
        "scope": (f"{', '.join(args.repo)}, regardless of board membership" if args.repo
                  else f"Accessible {args.owner} repositories, regardless of board membership"),
        "metrics": metrics(activity),
        "byRepository": {repo: metrics({k: [r for r in rows if r["repo"] == repo]
                                         for k, rows in activity.items()}) for repo in repositories},
        "activity": activity, "queries": queries,
        "limitations": [
            "GitHub search can lag and only includes records visible to the authenticated account.",
            "Current states and titles are observed now, not reconstructed at the period end.",
            "Opened and merged PRs overlap. Merge actions also overlap with authored PRs merged.",
            "Reviews count submitted reviews on others' PRs, including reviews later dismissed, not comments or pending drafts.",
            "Open-to-merge time includes draft time and time before the period. It is not working time.",
            "Board commitments, hours worked, deployments, and unpushed work are not measured.",
        ],
    }
    json.dump(result, sys.stdout, indent=2)
    print()


if __name__ == "__main__":
    try:
        main()
    except (RuntimeError, OSError, ValueError) as error:
        sys.exit(str(error))
