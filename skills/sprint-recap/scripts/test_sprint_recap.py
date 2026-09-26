"""Run with python3 -m unittest discover -s skills/sprint-recap/scripts."""

import datetime as dt
import unittest
from unittest.mock import patch
from zoneinfo import ZoneInfo

import sprint_recap as recap


class RecapTests(unittest.TestCase):
    def test_sprint_crossing_daylight_saving(self):
        sprint = {"start": "2026-09-21", "end": "2026-10-04"}
        start, end = recap.window(sprint, ZoneInfo("Pacific/Auckland"),
                                  recap.timestamp("2026-10-10T00:00:00Z"))
        self.assertEqual(recap.iso(start), "2026-09-20T12:00:00Z")
        self.assertEqual(recap.iso(end), "2026-10-04T11:00:00Z")
        self.assertTrue(recap.within(recap.iso(start), start, end))
        self.assertFalse(recap.within(recap.iso(end), start, end))

    def test_current_sprint_stops_at_collection_time(self):
        now = recap.timestamp("2026-09-22T23:00:00Z")
        _, end = recap.window({"start": "2026-09-21", "end": "2026-10-04"},
                              ZoneInfo("Europe/Berlin"), now)
        self.assertEqual(end, now)

    def test_search_paginates_past_one_hundred(self):
        def api(_, **params):
            begin = (params["page"] - 1) * 100
            return {"total_count": 101, "incomplete_results": False,
                    "items": [{"html_url": f"https://example.test/{i}"}
                              for i in range(begin, min(begin + 100, 101))]}
        with patch.object(recap, "api", side_effect=api):
            self.assertEqual(len(recap.search("query")), 101)

    def test_partial_search_cannot_be_reported_as_complete(self):
        for result in ({"total_count": 1001}, {"total_count": 0, "incomplete_results": True}):
            with self.subTest(result=result), patch.object(recap, "api", return_value=result):
                with self.assertRaises(RuntimeError):
                    recap.search("query")

    def test_reviews_use_actor_and_submission_time(self):
        pr = {"url": "https://example.test/pr", "repo": "org/repo", "number": 1, "title": "PR"}
        start, end = map(recap.timestamp, ("2026-09-21T00:00:00Z", "2026-10-05T00:00:00Z"))
        reviews = [{"id": i, "html_url": f"https://example.test/review/{i}",
                    "user": {"login": actor}, "state": state, "submitted_at": submitted}
                   for i, actor, state, submitted in (
                       (1, "me", "APPROVED", "2026-09-20T23:59:59Z"),
                       (2, "ME", "DISMISSED", "2026-09-21T00:00:00Z"),
                       (3, "me", "COMMENTED", "2026-10-05T00:00:00Z"),
                       (4, "other", "APPROVED", "2026-09-22T00:00:00Z"),
                       (5, "me", "PENDING", None),
                       (6, "me", "COMMENTED", "2026-09-23T00:00:00Z"))]
        self.assertEqual([r["id"] for r in recap.review_rows(pr, reviews, "me", start, end)], [2, 6])

    def test_attribution_keeps_opening_merging_and_merge_actions_separate(self):
        def row(repo, number, author, created):
            return {"repository_url": f"https://api.github.com/repos/{repo}",
                    "html_url": f"https://github.com/{repo}/pull/{number}",
                    "number": number, "title": "PR", "user": {"login": author},
                    "created_at": created, "state": "closed"}
        carryover = row("org/a", 1, "me", "2026-09-01T00:00:00Z")
        other = row("org/b", 1, "other", "2026-09-22T00:00:00Z")
        opened = row("org/a", 2, "me", "2026-09-22T00:00:00Z")

        def api(endpoint):
            is_other = "/b/" in endpoint
            return {"merged_at": "2026-09-23T00:00:00Z", "draft": False,
                    "merged_by": {"login": "me" if is_other else "other"},
                    "state": "closed", "closed_at": "2026-09-23T00:00:00Z"}

        with patch.object(recap, "search", side_effect=[[], [opened], [carryover, other, opened], []]), \
                patch.object(recap, "api", side_effect=api):
            activity, _ = recap.collect("me", recap.timestamp("2026-09-21T00:00:00Z"),
                                        recap.timestamp("2026-10-05T00:00:00Z"), "org:org")
        totals = recap.metrics(activity)
        self.assertEqual(totals["PRsOpened"], 1)
        self.assertEqual(totals["authoredPRsMerged"], 2)
        self.assertEqual(totals["mergeActions"], 1)
        self.assertEqual(totals["medianHoursOpenToMerge"], (22 * 24 + 24) / 2)
        self.assertEqual(activity["mergeActions"][0]["repo"], "org/b")

    def test_zero_merges_is_unavailable_and_distinct_reviews_use_urls(self):
        result = recap.metrics({"authoredPRsMerged": [], "reviewsSubmitted": [
            {"prUrl": "https://example.test/a/1"}, {"prUrl": "https://example.test/a/1"},
            {"prUrl": "https://example.test/b/1"}]})
        self.assertIsNone(result["medianHoursOpenToMerge"])
        self.assertEqual(result["distinctPRsReviewed"], 2)


class ScopeTests(unittest.TestCase):
    def test_listed_repositories_narrow_every_query(self):
        scope = recap.scope_qualifier("acme", "organization", ["acme/web", "acme/app"])
        self.assertEqual(scope, "repo:acme/web repo:acme/app")
        with patch.object(recap, "search", return_value=[]) as search:
            recap.collect("me", recap.timestamp("2026-09-21T00:00:00Z"),
                          recap.timestamp("2026-10-05T00:00:00Z"), scope)
        for call in search.call_args_list:
            self.assertTrue(call.args[0].startswith("repo:acme/web repo:acme/app "))

    def test_owner_type_selects_org_or_user_qualifier(self):
        self.assertEqual(recap.scope_qualifier("acme", "organization", []), "org:acme")
        self.assertEqual(recap.scope_qualifier("someone", "user", []), "user:someone")


class PeriodTests(unittest.TestCase):
    NOW = recap.timestamp("2026-09-26T10:00:00Z")

    def period(self, argv):
        parser, args = recap.parse_args(argv)
        return recap.select_period(parser, args, ZoneInfo(args.timezone), self.NOW)

    def test_explicit_window_needs_no_board(self):
        board, period, start, end = self.period(
            ["--owner", "acme", "--since", "2026-09-01", "--until", "2026-09-07"])
        self.assertIsNone(board)
        self.assertEqual(period["title"], "Custom window")
        self.assertEqual(recap.iso(start), "2026-09-01T00:00:00Z")
        self.assertEqual(recap.iso(end), "2026-09-08T00:00:00Z")

    def test_board_without_iterations_asks_for_a_window(self):
        with patch.object(recap.sprint_data, "resolve_iterations",
                          return_value=({"title": "Board", "url": "u"}, None, None, [])):
            with self.assertRaises(SystemExit):
                self.period(["--owner", "acme", "--project", "Board"])

    def test_sprint_or_window_is_required(self):
        with self.assertRaises(SystemExit):
            recap.parse_args(["--owner", "acme"])
        with self.assertRaises(SystemExit):
            recap.parse_args(["--owner", "acme", "--project", "B",
                              "--since", "2026-09-01", "--date", "2026-09-02"])


if __name__ == "__main__":
    unittest.main()
