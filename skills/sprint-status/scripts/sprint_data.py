#!/usr/bin/env python3
"""Collect sprint and review state for the authenticated GitHub user.

Emits JSON on stdout. All GitHub access goes through `gh`, so it uses whatever
account `gh auth status` reports. Board queries need the `read:project` scope.

Nothing here names a project. The skill reads the owner, board, field names,
and lifecycle statuses from the project's docs/agents/issue-tracker.md and
passes them as flags. The owner can be an organization or a user; the script
detects which.
"""

import argparse
import datetime as dt
import json
import subprocess
import sys

OWNER_QUERY = """
query($login: String!) {
  repositoryOwner(login: $login) { __typename login }
}
"""

# __ROOT__ becomes `organization` or `user`, depending on the owner.
PROJECTS_QUERY = """
query($owner: String!, $title: String!) {
  __ROOT__(login: $owner) {
    projectsV2(first: 50, query: $title) {
      nodes { number title url closed }
    }
  }
}
"""

PROJECT_QUERY = """
query($owner: String!, $num: Int!) {
  __ROOT__(login: $owner) {
    projectV2(number: $num) { number title url closed }
  }
}
"""

ITEMS_QUERY = """
query($owner: String!, $num: Int!, $after: String) {
  __ROOT__(login: $owner) {
    projectV2(number: $num) {
      items(first: 100, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes {
          content {
            __typename
            ... on Issue {
              number title url state createdAt updatedAt
              repository { nameWithOwner }
              assignees(first: 10) { nodes { login } }
              subIssuesSummary { total completed }
              subIssues(first: 30) {
                nodes {
                  number title url state
                  repository { nameWithOwner }
                  assignees(first: 10) { nodes { login } }
                }
              }
            }
            ... on PullRequest {
              number title url state createdAt updatedAt
              repository { nameWithOwner }
              assignees(first: 10) { nodes { login } }
            }
          }
          fieldValues(first: 30) {
            nodes {
              __typename
              ... on ProjectV2ItemFieldSingleSelectValue {
                name field { ... on ProjectV2FieldCommon { name } }
              }
              ... on ProjectV2ItemFieldIterationValue {
                title startDate duration
                field { ... on ProjectV2FieldCommon { name } }
              }
            }
          }
        }
      }
    }
  }
}
"""

ITERATION_QUERY = """
query($owner: String!, $num: Int!) {
  __ROOT__(login: $owner) {
    projectV2(number: $num) {
      fields(first: 50) {
        nodes {
          ... on ProjectV2IterationField {
            name
            configuration {
              iterations { title startDate duration }
              completedIterations { title startDate duration }
            }
          }
        }
      }
    }
  }
}
"""


def gh(args, **kw):
    res = subprocess.run(["gh", *args], capture_output=True, text=True, **kw)
    if res.returncode != 0:
        err = res.stderr.strip()
        if "read:project" in err:
            sys.exit(
                "Missing the read:project scope. Run:\n"
                "  gh auth refresh -s read:project"
            )
        sys.exit(f"gh {' '.join(args[:2])} failed: {err}")
    return res.stdout


def graphql(query, **variables):
    args = ["api", "graphql", "-f", f"query={query}"]
    for key, value in variables.items():
        if value is None:
            continue  # An omitted nullable variable is null.
        flag = "-F" if isinstance(value, int) else "-f"
        args += [flag, f"{key}={value}"]
    return json.loads(gh(args))


def parse_args(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--owner", required=True,
                    help="Organization or user that owns the board and repositories")
    ap.add_argument("--project",
                    help="Board number or exact title. Omit when the project has no board")
    ap.add_argument("--repo", action="append", default=[],
                    help="owner/repo to include in the PR queue; repeatable. "
                         "Omit to cover every repository the owner has")
    ap.add_argument("--status-field", default="Status")
    ap.add_argument("--iteration-field",
                    help="Iteration field name. Default: the board's first iteration field")
    ap.add_argument("--todo-status", default="Todo")
    ap.add_argument("--started-status", default="In progress")
    ap.add_argument("--review-status", default="In review")
    ap.add_argument("--done-status", default="Done")
    ap.add_argument("--date", type=dt.date.fromisoformat,
                    help="Report on the sprint containing this date (YYYY-MM-DD)")
    return ap.parse_args(argv)


def statuses(args):
    return {
        "todo": args.todo_status,
        "started": args.started_status,
        "review": args.review_status,
        "done": args.done_status,
    }


_owner_roots = {}


def owner_root(owner):
    """Return the GraphQL root field for the owner: organization or user."""
    if owner not in _owner_roots:
        node = graphql(OWNER_QUERY, login=owner)["data"]["repositoryOwner"]
        if not node:
            sys.exit(f"No GitHub organization or user named {owner!r}.")
        _owner_roots[owner] = (
            "organization" if node["__typename"] == "Organization" else "user"
        )
    return _owner_roots[owner]


def owner_query(query, owner, **variables):
    root = owner_root(owner)
    data = graphql(query.replace("__ROOT__", root), owner=owner, **variables)
    return data["data"][root]


_projects = {}


def resolve_project(owner, project):
    """Accept a board number or its exact title. Never guess between boards."""
    key = (owner, str(project))
    if key not in _projects:
        if str(project).isdigit():
            found = owner_query(PROJECT_QUERY, owner, num=int(project))["projectV2"]
            if not found:
                sys.exit(f"No project #{project} owned by {owner}.")
            _projects[key] = found
        else:
            nodes = owner_query(PROJECTS_QUERY, owner, title=project)["projectsV2"]["nodes"]
            _projects[key] = pick_project(nodes, project, owner)
    return _projects[key]


def pick_project(nodes, title, owner):
    matches = [p for p in nodes if p and p["title"] == title and not p["closed"]]
    if len(matches) != 1:
        sys.exit(
            f"Expected exactly one open project titled {title!r} owned by "
            f"{owner}, found {len(matches)}. Check docs/agents/issue-tracker.md."
        )
    return matches[0]


def iteration_window(it):
    start = dt.date.fromisoformat(it["startDate"])
    return start, start + dt.timedelta(days=it["duration"] - 1)


def pick_iteration_field(nodes, wanted=None):
    fields = [n for n in nodes if n and n.get("configuration")]
    if wanted:
        fields = [f for f in fields if f["name"] == wanted]
        if not fields:
            sys.exit(f"The board has no iteration field named {wanted!r}.")
    return fields[0] if fields else None


def current_iteration(field, today):
    cfg = field["configuration"]
    every = (cfg.get("completedIterations") or []) + (cfg.get("iterations") or [])
    current = None
    for it in every:
        start, end = iteration_window(it)
        if start <= today <= end:
            current = {
                "title": it["title"],
                "start": start.isoformat(),
                "end": end.isoformat(),
                "day": (today - start).days + 1,
                "duration": it["duration"],
            }
            break
    upcoming = [
        {"title": it["title"], "start": it["startDate"]}
        for it in (cfg.get("iterations") or [])
        if dt.date.fromisoformat(it["startDate"]) > today
    ]
    return current, upcoming


def resolve_iterations(owner, project, today, iteration_field=None):
    """Return the board, its iteration field name, and the current sprint.

    A board without an iteration field returns None for the field and sprint,
    so callers can report by status alone.
    """
    board = resolve_project(owner, project)
    nodes = owner_query(ITERATION_QUERY, owner, num=board["number"])
    field = pick_iteration_field(nodes["projectV2"]["fields"]["nodes"], iteration_field)
    if not field:
        return board, None, None, []
    current, upcoming = current_iteration(field, today)
    return board, field["name"], current, upcoming


def fetch_items(owner, number):
    nodes, after = [], None
    while True:
        items = owner_query(ITEMS_QUERY, owner, num=number, after=after)["projectV2"]["items"]
        nodes += items["nodes"]
        if not items["pageInfo"]["hasNextPage"]:
            return nodes
        after = items["pageInfo"]["endCursor"]


def flatten(node, status_field, iteration_field):
    content = node.get("content") or {}
    if not content.get("number"):
        return None

    status, iteration = None, None
    for fv in node["fieldValues"]["nodes"]:
        if not fv:
            continue
        name = (fv.get("field") or {}).get("name")
        if name == status_field:
            status = fv.get("name")
        elif iteration_field and name == iteration_field:
            iteration = fv.get("title")

    return {
        "repo": content["repository"]["nameWithOwner"],
        "number": content["number"],
        "title": content["title"],
        "url": content["url"],
        "type": content["__typename"],
        "state": content["state"],
        "updatedAt": content["updatedAt"],
        "status": status or "No status",
        "iteration": iteration,
        "assignees": [a["login"] for a in content["assignees"]["nodes"]],
        "subIssues": sub_issues(content),
    }


def sub_issues(content):
    summary = content.get("subIssuesSummary") or {}
    if not summary.get("total"):
        return None
    return {
        "total": summary["total"],
        "completed": summary["completed"],
        "children": [
            {
                "repo": n["repository"]["nameWithOwner"],
                "number": n["number"],
                "title": n["title"],
                "url": n["url"],
                "state": n["state"],
                "assignees": [a["login"] for a in n["assignees"]["nodes"]],
            }
            for n in (content.get("subIssues") or {}).get("nodes", [])
        ],
    }


def classify(items, me, names, sprint_title, has_iterations):
    """Bucket the user's board items by lifecycle role and sprint membership."""
    mine = [i for i in items if me in i["assignees"]]
    open_mine = [i for i in mine if i["state"] == "OPEN"]
    active = (names["started"], names["review"])

    if has_iterations:
        scope = [i for i in mine if sprint_title and i["iteration"] == sprint_title]
        # Work that is underway but never got dropped into an iteration.
        unscheduled = [
            i for i in open_mine if i["iteration"] is None and i["status"] in active
        ]
        backlog = [i for i in open_mine if i["iteration"] is None]
    else:
        scope, unscheduled, backlog = mine, [], []

    def bucket(status):
        return [i for i in scope if i["status"] == status and i["state"] == "OPEN"]

    known = set(names.values())
    other = {}
    for i in scope:
        if i["state"] == "OPEN" and i["status"] not in known:
            other.setdefault(i["status"], []).append(i)

    return {
        "sprintItems": {
            "inProgress": bucket(names["started"]),
            "inReview": bucket(names["review"]),
            "todo": bucket(names["todo"]),
            "done": [i for i in scope if i["status"] == names["done"]],
            "otherStatuses": other,
        },
        "unscheduledActive": unscheduled,
        "backlogAssigned": backlog,
    }


def scope_flags(owner, repos):
    """Limit a `gh search` call to the listed repositories, or the whole owner."""
    if repos:
        return [f"--repo={r}" for r in repos]
    return [f"--owner={owner}"]


def pr_rows(query_args, owner, repos):
    out = gh([
        "search", "prs", *query_args, *scope_flags(owner, repos),
        "--state=open", "--limit=40",
        "--json", "repository,number,title,url,createdAt,updatedAt,isDraft",
    ])
    return json.loads(out or "[]")


def assigned_issues(me, owner, repos):
    out = gh([
        "search", "issues", f"--assignee={me}", *scope_flags(owner, repos),
        "--state=open", "--limit=100",
        "--json", "repository,number,title,url,createdAt,updatedAt",
    ])
    return json.loads(out or "[]")


def pr_detail(repo, number):
    fields = (
        "headRefName,changedFiles,additions,deletions,mergeable,"
        "reviewDecision,isDraft,createdAt,updatedAt,reviewRequests,"
        "latestReviews,closingIssuesReferences,comments"
    )
    pr = json.loads(gh(["pr", "view", str(number), "--repo", repo, "--json", fields]))
    comments = pr.get("comments") or []
    last = comments[-1] if comments else None
    return {
        "branch": pr["headRefName"],
        "changedFiles": pr["changedFiles"],
        "additions": pr["additions"],
        "deletions": pr["deletions"],
        "mergeable": pr["mergeable"],
        "reviewDecision": pr["reviewDecision"] or "none",
        "isDraft": pr["isDraft"],
        "updatedAt": pr["updatedAt"],
        "requestedReviewers": [
            r.get("login") or r.get("slug") for r in pr.get("reviewRequests") or []
        ],
        "reviews": [
            {"author": r["author"]["login"], "state": r["state"]}
            for r in pr.get("latestReviews") or []
        ],
        "closes": [
            {
                "number": c["number"],
                "repo": f"{c['repository']['owner']['login']}/{c['repository']['name']}",
                "url": c["url"],
            }
            for c in pr.get("closingIssuesReferences") or []
        ],
        "commentCount": len(comments),
        "lastComment": None if not last else {
            "author": last["author"]["login"],
            "createdAt": last["createdAt"],
            "url": last["url"],
            "excerpt": " ".join(last["body"].split())[:400],
        },
    }


def viewer_login():
    return graphql("query { viewer { login } }")["data"]["viewer"]["login"]


def main(argv=None):
    args = parse_args(argv)
    today = args.date or dt.date.today()
    names = statuses(args)
    me = viewer_login()

    result = {
        "generatedFor": me,
        "today": today.isoformat(),
        "owner": args.owner,
        "statusNames": names,
    }

    if args.project:
        board, iteration_field, current, upcoming = resolve_iterations(
            args.owner, args.project, today, args.iteration_field
        )
        items = [
            i for i in (
                flatten(n, args.status_field, iteration_field)
                for n in fetch_items(args.owner, board["number"])
            ) if i
        ]
        result.update({
            "mode": "sprint" if iteration_field else "board",
            "project": {"title": board["title"], "url": board["url"]},
            "iterationField": iteration_field,
            "sprint": current,
            "upcoming": upcoming[:2],
        })
        result.update(classify(
            items, me, names, current["title"] if current else None,
            has_iterations=bool(iteration_field),
        ))
    else:
        result.update({
            "mode": "no-board",
            "project": None,
            "sprint": None,
            "assignedOpen": assigned_issues(me, args.owner, args.repo),
        })

    reviews_for_me = pr_rows([f"--review-requested={me}"], args.owner, args.repo)
    mentions = pr_rows([f"--mentions={me}"], args.owner, args.repo)
    authored = pr_rows([f"--author={me}"], args.owner, args.repo)
    for row in reviews_for_me + authored:
        row["detail"] = pr_detail(row["repository"]["nameWithOwner"], row["number"])
    seen = {r["url"] for r in reviews_for_me + authored}
    result["prs"] = {
        "awaitingMyReview": reviews_for_me,
        "mineAwaitingOthers": authored,
        "mentioningMe": [m for m in mentions if m["url"] not in seen],
    }

    json.dump(result, sys.stdout, indent=2)
    print()


if __name__ == "__main__":
    main()
