"""Run with python3 -m unittest discover -s skills/sprint-status/scripts."""

import datetime as dt
import unittest
from unittest.mock import patch

import sprint_data as sd

NAMES = {"todo": "Todo", "started": "In progress", "review": "In review", "done": "Done"}


def item(number, status, iteration=None, assignees=("me",), state="OPEN"):
    return {"repo": "acme/app", "number": number, "title": f"Item {number}",
            "url": f"https://github.com/acme/app/issues/{number}", "type": "Issue",
            "state": state, "updatedAt": "2026-09-20T00:00:00Z", "status": status,
            "iteration": iteration, "assignees": list(assignees), "subIssues": None}


class OwnerTests(unittest.TestCase):
    def setUp(self):
        sd._owner_roots.clear()

    def test_owner_type_picks_the_graphql_root(self):
        for typename, root in (("Organization", "organization"), ("User", "user")):
            sd._owner_roots.clear()
            reply = {"data": {"repositoryOwner": {"__typename": typename, "login": "x"}}}
            with self.subTest(typename=typename), patch.object(sd, "graphql", return_value=reply):
                self.assertEqual(sd.owner_root("x"), root)

    def test_owner_query_substitutes_the_root(self):
        sd._owner_roots["acme"] = "user"
        with patch.object(sd, "graphql", return_value={"data": {"user": {"ok": 1}}}) as call:
            self.assertEqual(sd.owner_query(sd.PROJECT_QUERY, "acme", num=3), {"ok": 1})
        query = call.call_args.args[0]
        self.assertIn("user(login: $owner)", query)
        self.assertNotIn("__ROOT__", query)

    def test_unknown_owner_stops(self):
        with patch.object(sd, "graphql", return_value={"data": {"repositoryOwner": None}}):
            with self.assertRaises(SystemExit):
                sd.owner_root("nobody")


class ProjectTests(unittest.TestCase):
    def test_exact_open_title_is_required(self):
        nodes = [{"number": 1, "title": "Sprints", "url": "u1", "closed": False},
                 {"number": 2, "title": "Sprints (old)", "url": "u2", "closed": False},
                 {"number": 3, "title": "Sprints", "url": "u3", "closed": True}]
        self.assertEqual(sd.pick_project(nodes, "Sprints", "acme")["number"], 1)

    def test_ambiguous_or_missing_title_stops(self):
        twice = [{"number": n, "title": "Board", "url": "u", "closed": False} for n in (1, 2)]
        for nodes in (twice, []):
            with self.subTest(count=len(nodes)), self.assertRaises(SystemExit):
                sd.pick_project(nodes, "Board", "acme")


class IterationTests(unittest.TestCase):
    FIELD = {"name": "Sprint", "configuration": {
        "completedIterations": [{"title": "S1", "startDate": "2026-09-07", "duration": 14}],
        "iterations": [{"title": "S2", "startDate": "2026-09-21", "duration": 14},
                       {"title": "S3", "startDate": "2026-10-05", "duration": 14}]}}

    def test_current_and_upcoming_iterations(self):
        current, upcoming = sd.current_iteration(self.FIELD, dt.date(2026, 9, 26))
        self.assertEqual(current["title"], "S2")
        self.assertEqual(current["day"], 6)
        self.assertEqual(current["end"], "2026-10-04")
        self.assertEqual([u["title"] for u in upcoming], ["S3"])

    def test_field_is_chosen_by_name_or_first(self):
        other = {"name": "Quarter", "configuration": self.FIELD["configuration"]}
        nodes = [{}, other, self.FIELD]
        self.assertEqual(sd.pick_iteration_field(nodes)["name"], "Quarter")
        self.assertEqual(sd.pick_iteration_field(nodes, "Sprint")["name"], "Sprint")
        self.assertIsNone(sd.pick_iteration_field([{}]))
        with self.assertRaises(SystemExit):
            sd.pick_iteration_field(nodes, "Missing")


class ClassifyTests(unittest.TestCase):
    def test_sprint_board_buckets_and_unscheduled_work(self):
        items = [item(1, "In progress", "S2"), item(2, "Todo", "S2"),
                 item(3, "In review", None), item(4, "Todo", None),
                 item(5, "Blocked", "S2"), item(6, "Done", "S2", state="CLOSED"),
                 item(7, "In progress", "S2", assignees=("someone",))]
        out = sd.classify(items, "me", NAMES, "S2", has_iterations=True)
        buckets = out["sprintItems"]
        self.assertEqual([i["number"] for i in buckets["inProgress"]], [1])
        self.assertEqual([i["number"] for i in buckets["todo"]], [2])
        self.assertEqual([i["number"] for i in buckets["done"]], [6])
        self.assertEqual(list(buckets["otherStatuses"]), ["Blocked"])
        self.assertEqual([i["number"] for i in out["unscheduledActive"]], [3])
        self.assertEqual([i["number"] for i in out["backlogAssigned"]], [3, 4])

    def test_board_without_iterations_reports_everything_by_status(self):
        items = [item(1, "Doing"), item(2, "Review"), item(3, "Backlog")]
        names = {"todo": "Backlog", "started": "Doing", "review": "Review", "done": "Shipped"}
        out = sd.classify(items, "me", names, None, has_iterations=False)
        self.assertEqual([i["number"] for i in out["sprintItems"]["inProgress"]], [1])
        self.assertEqual([i["number"] for i in out["sprintItems"]["inReview"]], [2])
        self.assertEqual([i["number"] for i in out["sprintItems"]["todo"]], [3])
        self.assertEqual(out["unscheduledActive"], [])

    def test_no_current_sprint_leaves_sprint_empty(self):
        out = sd.classify([item(1, "Todo", "S1")], "me", NAMES, None, has_iterations=True)
        self.assertEqual(out["sprintItems"]["todo"], [])


class FlattenTests(unittest.TestCase):
    def test_reads_configured_status_and_iteration_fields(self):
        node = {"content": {
            "__typename": "Issue", "number": 9, "title": "T", "url": "u", "state": "OPEN",
            "updatedAt": "x", "repository": {"nameWithOwner": "acme/app"},
            "assignees": {"nodes": [{"login": "me"}]}, "subIssuesSummary": {"total": 0}},
            "fieldValues": {"nodes": [
                {"name": "Doing", "field": {"name": "Stage"}},
                {"name": "ignored", "field": {"name": "Priority"}},
                {"title": "Cycle 4", "field": {"name": "Cycle"}}]}}
        flat = sd.flatten(node, "Stage", "Cycle")
        self.assertEqual((flat["status"], flat["iteration"]), ("Doing", "Cycle 4"))
        self.assertIsNone(sd.flatten(node, "Stage", None)["iteration"])

    def test_draft_items_without_numbers_are_skipped(self):
        self.assertIsNone(sd.flatten({"content": {}, "fieldValues": {"nodes": []}}, "Status", None))


class ScopeTests(unittest.TestCase):
    def test_search_scope_uses_repos_or_owner(self):
        self.assertEqual(sd.scope_flags("acme", ["acme/a", "acme/b"]),
                         ["--repo=acme/a", "--repo=acme/b"])
        self.assertEqual(sd.scope_flags("acme", []), ["--owner=acme"])

    def test_null_variables_are_omitted(self):
        with patch.object(sd, "gh", return_value="{}") as call:
            sd.graphql("q", owner="acme", num=3, after=None)
        args = call.call_args.args[0]
        self.assertIn("num=3", args)
        self.assertNotIn("after=", " ".join(args))


if __name__ == "__main__":
    unittest.main()
