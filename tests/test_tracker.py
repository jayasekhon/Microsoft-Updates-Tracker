import io
import os
import re
import unittest
import urllib.error
from datetime import date, timedelta
from unittest import mock

from tracker import digest, store, summarize
from tracker.classify import classify_roadmap, classify_text
from tracker.sources import roadmap, rss
from tracker.util import load_config, strip_html

CONFIG = load_config()


def raw_roadmap(rid=1, title="Microsoft Copilot (Microsoft 365): Draft emails", products=("Microsoft Copilot (Microsoft 365)",),
                status="In development", ga="December CY2026", description="<p>Copilot drafts replies.</p>", created="2026-10-20T10:00:00"):
    return {
        "id": rid, "title": title, "description": description, "status": status,
        "publicDisclosureAvailabilityDate": ga, "publicPreviewDate": None, "moreInfoLink": None,
        "created": created, "modified": created,
        "tagsContainer": {"products": [{"tagName": p} for p in products], "releasePhase": [{"tagName": "General Availability"}],
                          "platforms": [{"tagName": "Web"}], "cloudInstances": []},
    }


class ClassifyTests(unittest.TestCase):
    def test_copilot_chat_split_from_m365(self):
        self.assertEqual(classify_roadmap(["Microsoft Copilot (Microsoft 365)"], "Copilot Chat in Outlook", "", CONFIG), "chat")
        self.assertEqual(classify_roadmap(["Microsoft Copilot (Microsoft 365)"], "Copilot in Excel", "", CONFIG), "m365")

    def test_sharepoint_only_ai(self):
        self.assertEqual(classify_roadmap(["SharePoint"], "Agent chat web part", "", CONFIG), "sharepoint")
        self.assertIsNone(classify_roadmap(["SharePoint"], "HTML pages", "Create pages with HTML.", CONFIG))
        self.assertEqual(classify_roadmap(["SharePoint"], "News page", "Copilot can now draft news.", CONFIG), "sharepoint")

    def test_copilot_item_about_sharepoint(self):
        self.assertEqual(classify_roadmap(["Microsoft Copilot (Microsoft 365)"], "SharePoint Site Builder", "", CONFIG), "sharepoint")

    def test_studio(self):
        self.assertEqual(classify_roadmap(["Microsoft Copilot Studio"], "Computer use", "", CONFIG), "studio")

    def test_dynamics_excluded(self):
        tags = ["Microsoft Copilot (Microsoft 365)", "Dynamics 365 Sales"]
        self.assertIsNone(classify_roadmap(tags, "Sales agent", "", CONFIG))

    def test_out_of_scope(self):
        self.assertIsNone(classify_roadmap(["Microsoft Teams"], "Town halls", "", CONFIG))

    def test_blog_title_only(self):
        self.assertEqual(classify_text("New in Copilot Studio", "", CONFIG), "studio")
        self.assertIsNone(classify_text("AI at work", "Mentions SharePoint in passing", CONFIG))


class RoadmapTests(unittest.TestCase):
    def test_normalize(self):
        item = roadmap.normalize(raw_roadmap(title="Microsoft Copilot (Microsoft 365): Microsoft Teams: Recap  in\nchat",
                                             products=("Microsoft Copilot (Microsoft 365)", "Microsoft Teams")), CONFIG)
        self.assertEqual(item["id"], "rm-1")
        self.assertEqual(item["title"], "Recap in chat")
        self.assertEqual(item["apps"], ["Microsoft Teams"])
        self.assertEqual(item["description"], "Copilot drafts replies.")
        self.assertIn("featureid=1", item["url"])

    def test_rejects_tiny_payload(self):
        with mock.patch.object(roadmap, "http_get", return_value=b"[]"):
            with self.assertRaises(RuntimeError):
                roadmap.fetch(CONFIG)


class StoreTests(unittest.TestCase):
    def _item(self, **kw):
        return roadmap.normalize(raw_roadmap(**kw), CONFIG)

    def test_bootstrap_dates_new_by_created(self):
        s = {"items": {}}
        store.merge(s, [self._item(created="2025-01-05T00:00:00")], kinds_fetched={"feature"}, today="2026-10-29")
        self.assertEqual(s["items"]["rm-1"]["events"], [{"type": "new", "date": "2025-01-05"}])

    def test_later_new_item_with_old_created_date_uses_today(self):
        s = {"items": {}}
        store.merge(s, [self._item(rid=2)], kinds_fetched={"feature"}, today="2026-10-28")
        store.merge(s, [self._item(rid=2), self._item(rid=3, created="2024-01-01T00:00:00")], kinds_fetched={"feature"}, today="2026-10-29")
        self.assertEqual(s["items"]["rm-3"]["events"][0]["date"], "2026-10-29")

    def test_late_seen_post_keeps_publish_date(self):
        s = {"items": {}}
        store.merge(s, [self._item()], kinds_fetched={"feature"}, today="2026-10-01")
        post = {"id": "post-x", "kind": "post", "source": "Blog", "product": "studio", "title": "Old post",
                "description": "", "url": "https://example.com/x", "created": "2026-06-25", "modified": "2026-06-25"}
        store.merge(s, [self._item(), post], kinds_fetched={"feature", "post"}, today="2026-10-29")
        self.assertEqual(s["items"]["post-x"]["events"], [{"type": "new", "date": "2026-06-25"}])

    def test_repairs_posts_stored_with_found_date(self):
        s = {"items": {"post-y": {"id": "post-y", "kind": "post", "created": "2026-07-28", "first_seen": "2026-10-29",
                                  "events": [{"type": "new", "date": "2026-10-29"}]}}}
        store.merge(s, [], kinds_fetched=set(), today="2026-10-30")
        self.assertEqual(s["items"]["post-y"]["events"], [{"type": "new", "date": "2026-07-28"}])

    def test_status_and_date_changes(self):
        s = {"items": {}}
        store.merge(s, [self._item()], kinds_fetched={"feature"}, today="2026-10-20")
        counts = store.merge(s, [self._item(status="Rolling out", ga="January CY2027")], kinds_fetched={"feature"}, today="2026-10-29")
        events = s["items"]["rm-1"]["events"]
        self.assertEqual(counts["changed"], 1)
        self.assertIn({"type": "status", "date": "2026-10-29", "from": "In development", "to": "Rolling out"}, events)
        self.assertIn({"type": "ga_date", "date": "2026-10-29", "from": "December CY2026", "to": "January CY2027"}, events)
        self.assertEqual(s["items"]["rm-1"]["status"], "Rolling out")

    def test_removed_only_when_source_fetched(self):
        s = {"items": {}}
        store.merge(s, [self._item()], kinds_fetched={"feature"}, today="2026-10-20")
        store.merge(s, [], kinds_fetched=set(), today="2026-10-21")
        self.assertFalse(s["items"]["rm-1"].get("removed"))
        store.merge(s, [], kinds_fetched={"feature"}, today="2026-10-22")
        self.assertTrue(s["items"]["rm-1"]["removed"])
        store.merge(s, [self._item()], kinds_fetched={"feature"}, today="2026-10-23")
        self.assertFalse(s["items"]["rm-1"]["removed"])
        self.assertEqual(s["items"]["rm-1"]["events"][-1]["type"], "returned")


RSS = b"""<?xml version="1.0"?><rss version="2.0"><channel><title>Blog</title>
<item><title>New in Copilot Studio</title><link>https://example.com/a</link><pubDate>Wed, 28 Oct 2026 17:00:00 +0000</pubDate>
<description>&lt;p&gt;Agents get smarter.&lt;/p&gt;&lt;p&gt;The post New appeared first on Blog.&lt;/p&gt;</description><category>AI</category></item>
<item><title>Quarterly earnings</title><link>https://example.com/b</link><pubDate>Wed, 28 Oct 2026 17:00:00 +0000</pubDate><description>Numbers.</description></item>
</channel></rss>"""

ATOM = b"""<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>T</title>
<entry><title>Copilot news</title><link rel="alternate" href="https://example.com/c"/><published>2026-10-27T10:00:00Z</published><summary>Hi</summary></entry></feed>"""


class RssTests(unittest.TestCase):
    def test_parse_rss_and_filter(self):
        entries = rss.parse_feed(RSS)
        self.assertEqual(entries[0]["date"], "2026-10-28")
        self.assertEqual(entries[0]["summary"], "Agents get smarter.")
        feed = {"name": "Blog", "default_product": "m365"}
        items = [rss.normalize(e, feed, CONFIG) for e in entries]
        self.assertEqual(items[0]["product"], "studio")
        self.assertIsNone(items[1])

    def test_feed_relevance_override(self):
        entry = {"title": "SharePoint site templates", "summary": "New layouts.", "link": "https://example.com/d", "date": "2026-10-28", "categories": []}
        self.assertIsNotNone(rss.normalize(entry, {"name": "Blog"}, CONFIG))
        feed = {"name": "SP", "default_product": "sharepoint", "relevance_keywords": ["copilot"]}
        self.assertIsNone(rss.normalize(entry, feed, CONFIG))
        entry["summary"] = "Copilot builds them for you."
        self.assertEqual(rss.normalize(entry, feed, CONFIG)["product"], "sharepoint")

    def test_parse_atom(self):
        entries = rss.parse_feed(ATOM)
        self.assertEqual(entries[0]["link"], "https://example.com/c")
        self.assertEqual(entries[0]["date"], "2026-10-27")


class EnvTests(unittest.TestCase):
    def test_empty_github_variables_mean_defaults(self):
        s = {"items": {}}
        store.merge(s, [roadmap.normalize(raw_roadmap(), CONFIG)], kinds_fetched={"feature"}, today="2026-10-29")
        with mock.patch.dict(os.environ, {"AI_PROVIDER": "", "AI_MAX_ITEMS": "", "GEMINI_API_KEY": "", "SITE_URL": ""}):
            self.assertEqual(summarize.summarize(s, CONFIG)["rules"], 1)
            self.assertEqual(digest.site_url(), digest.DEFAULT_SITE_URL)


class SummarizeTests(unittest.TestCase):
    def _store(self):
        s = {"items": {}}
        store.merge(s, [roadmap.normalize(raw_roadmap(rid=i, description="Admins can turn this off in the admin center."), CONFIG) for i in (1, 2)],
                    kinds_fetched={"feature"}, today="2026-10-29")
        return s

    def test_rules_fallback(self):
        s = self._store()
        with mock.patch.dict(os.environ, {"AI_PROVIDER": "none"}):
            counts = summarize.summarize(s, CONFIG)
        self.assertEqual(counts["rules"], 2)
        self.assertEqual(s["items"]["rm-1"]["ai"]["action"], "admin")

    def test_provider_results_used_and_cached(self):
        s = self._store()

        class Fake:
            model = "fake"
            calls = 0

            def complete(self, prompt):
                Fake.calls += 1
                return [{"id": "rm-1", "summary": "Short.", "audience": ["IT admins", "Bogus"], "action": "admin",
                         "action_note": "Decide.", "impact": "high"}]

        with mock.patch.object(summarize, "get_provider", return_value=Fake()):
            counts = summarize.summarize(s, CONFIG)
        self.assertEqual(counts, {"ai": 1, "rules": 1, "errors": 0})
        self.assertEqual(s["items"]["rm-1"]["ai"]["audience"], ["IT admins"])
        with mock.patch.object(summarize, "get_provider", return_value=Fake()):
            summarize.summarize(s, CONFIG)
        # rm-1 is cached; only the rule-based rm-2 is retried.
        self.assertEqual(Fake.calls, 2)


class AiResilienceTests(unittest.TestCase):
    def _gemini(self, responder):
        """A GeminiProvider whose HTTP calls go to responder(model) instead of Google."""
        calls = []

        def fake_post(url, payload, headers=None, timeout=None):
            model = url.split("/models/")[1].split(":")[0]
            calls.append(model)
            return responder(model)

        env = {"GEMINI_API_KEY": "k", "GEMINI_MODEL": "", "GEMINI_FALLBACK_MODEL": "", "AI_PAUSE_SECONDS": "0"}
        patches = [mock.patch.dict(os.environ, env), mock.patch.object(summarize, "http_post_json", fake_post),
                   mock.patch.object(summarize.time, "sleep", lambda s: None)]
        for p in patches:
            p.start()
            self.addCleanup(p.stop)
        return summarize.GeminiProvider(), calls

    @staticmethod
    def _ok(text='[{"id": "rm-1"}]'):
        return {"candidates": [{"content": {"parts": [{"text": text}]}}]}

    @staticmethod
    def _http(code):
        return urllib.error.HTTPError("u", code, "x", {}, io.BytesIO(b"{}"))

    def test_busy_model_falls_back_and_stays_on_the_fallback(self):
        def responder(model):
            if model == "gemini-flash-latest":
                raise self._http(503)
            return self._ok()

        provider, calls = self._gemini(responder)
        self.assertEqual(provider.complete("p"), [{"id": "rm-1"}])
        self.assertEqual(provider.model, "gemini-flash-lite-latest")
        self.assertEqual(calls, ["gemini-flash-latest", "gemini-flash-latest", "gemini-flash-lite-latest"])  # 1 retry, then switch
        provider.complete("p")
        self.assertEqual(calls[-1], "gemini-flash-lite-latest")
        self.assertEqual(calls.count("gemini-flash-latest"), 2)  # not asked again this run

    def test_retired_model_name_falls_back_immediately(self):
        def responder(model):
            if model == "gemini-flash-latest":
                raise self._http(404)
            return self._ok()

        provider, calls = self._gemini(responder)
        provider.complete("p")
        self.assertEqual(calls, ["gemini-flash-latest", "gemini-flash-lite-latest"])

    def test_bad_request_is_not_retried_on_another_model(self):
        def responder(model):
            raise self._http(400)

        provider, calls = self._gemini(responder)
        with self.assertRaises(RuntimeError):
            provider.complete("p")
        self.assertEqual(calls, ["gemini-flash-latest"])

    def test_all_models_busy_raises(self):
        provider, calls = self._gemini(lambda model: (_ for _ in ()).throw(self._http(503)))
        with self.assertRaisesRegex(RuntimeError, "every model is busy"):
            provider.complete("p")
        self.assertEqual(calls.count("gemini-flash-lite-latest"), 4)  # the last model gets full patience

    def test_isolated_failures_do_not_stop_later_batches(self):
        s = {"items": {}}
        store.merge(s, [roadmap.normalize(raw_roadmap(rid=i), CONFIG) for i in range(1, 21)], kinds_fetched={"feature"}, today="2026-10-29")

        class Flaky:
            model = "flaky"
            calls = 0

            def complete(self, prompt):
                Flaky.calls += 1
                if Flaky.calls % 2:  # every other batch times out
                    raise RuntimeError("The read operation timed out")
                ids = re.findall(r'"id": "(rm-\d+)"', prompt)
                return [{"id": i, "summary": "S", "audience": [], "action": "none", "action_note": "", "impact": "low"} for i in ids]

        with mock.patch.object(summarize, "get_provider", return_value=Flaky()):
            counts = summarize.summarize(s, CONFIG)
        self.assertEqual(Flaky.calls, 4)  # 20 items in batches of 5: all four attempted
        self.assertEqual(counts["ai"], 10)
        self.assertEqual(counts["errors"], 2)


class AttentionTests(unittest.TestCase):
    """The email's "Needs attention" box lists flagged features once, as they start to land."""

    def _flag(self, s, action="admin"):
        for item in s["items"].values():
            item["ai"] = {"action": action, "action_note": "Do it.", "summary": "S", "audience": [], "impact": "medium", "model": "gemini"}

    def _ids(self, s, start):
        return [(a["item"]["id"], a["when"]) for a in digest._attention(s, start, start + timedelta(days=7))]

    def test_items_still_in_development_are_never_listed(self):
        s = {"items": {}}
        store.merge(s, [roadmap.normalize(raw_roadmap(rid=1, ga="November CY2026", created="2026-01-01T00:00:00"), CONFIG)],
                    kinds_fetched={"feature"}, today="2026-01-01")
        self._flag(s)
        for week in (date(2026, 10, 5), date(2026, 10, 12), date(2026, 10, 19), date(2026, 11, 2)):
            self.assertEqual(self._ids(s, week), [])
        # Even when it changes during the week (here: its GA date moves).
        store.merge(s, [roadmap.normalize(raw_roadmap(rid=1, ga="December CY2026", created="2026-01-01T00:00:00"), CONFIG)],
                    kinds_fetched={"feature"}, today="2026-11-03")
        self.assertEqual(self._ids(s, date(2026, 11, 2)), [])

    def test_rolling_out_and_launch_are_listed_that_week(self):
        s = {"items": {}}
        store.merge(s, [roadmap.normalize(raw_roadmap(rid=1, ga="October CY2026"), CONFIG)], kinds_fetched={"feature"}, today="2026-09-01")
        self._flag(s, "prepare")
        store.merge(s, [roadmap.normalize(raw_roadmap(rid=1, ga="October CY2026", status="Rolling out"), CONFIG)], kinds_fetched={"feature"}, today="2026-10-21")
        self.assertEqual(self._ids(s, date(2026, 10, 19)), [("rm-1", "Rolling out now")])
        self.assertEqual(self._ids(s, date(2026, 10, 26)), [])
        store.merge(s, [roadmap.normalize(raw_roadmap(rid=1, ga="October CY2026", status="Launched"), CONFIG)], kinds_fetched={"feature"}, today="2026-11-03")
        self.assertEqual(self._ids(s, date(2026, 11, 2)), [("rm-1", "Launched this week")])

    def test_stale_rollouts_and_unflagged_items_are_ignored(self):
        s = {"items": {}}
        store.merge(s, [roadmap.normalize(raw_roadmap(rid=1, ga="March CY2025"), CONFIG)], kinds_fetched={"feature"}, today="2026-09-01")
        store.merge(s, [roadmap.normalize(raw_roadmap(rid=1, ga="March CY2025", status="Rolling out"), CONFIG)], kinds_fetched={"feature"}, today="2026-10-21")
        self._flag(s)
        self.assertEqual(self._ids(s, date(2026, 10, 19)), [])  # GA target long past: rollout treated as done
        self._flag(s, "awareness")
        self.assertEqual(digest._attention(s, date(2026, 1, 1), date(2027, 1, 1)), [])

    def test_keyword_fallback_labels_do_not_count(self):
        s = {"items": {}}
        store.merge(s, [roadmap.normalize(raw_roadmap(rid=1, ga="October CY2026"), CONFIG)], kinds_fetched={"feature"}, today="2026-09-01")
        store.merge(s, [roadmap.normalize(raw_roadmap(rid=1, ga="October CY2026", status="Rolling out"), CONFIG)], kinds_fetched={"feature"}, today="2026-10-21")
        self._flag(s)
        s["items"]["rm-1"]["ai"]["model"] = "rules"
        self.assertEqual(self._ids(s, date(2026, 10, 19)), [])

    def test_posts_never_become_action_items(self):
        self.assertEqual(summarize._clean({"action": "admin", "action_note": "Read it."}, "post")["action"], "awareness")
        self.assertEqual(summarize._clean({"action": "admin", "action_note": "Read it."}, "post")["action_note"], "Read it.")
        self.assertEqual(summarize._clean({"action": "awareness", "action_note": "Stray"}, "feature")["action_note"], "")

    def test_items_labelled_by_an_older_prompt_are_relabelled(self):
        s = {"items": {}}
        store.merge(s, [roadmap.normalize(raw_roadmap(rid=1), CONFIG)], kinds_fetched={"feature"}, today="2026-10-29")
        item = s["items"]["rm-1"]
        item["ai"] = {"action": "prepare", "model": "gemini", "hash": item["text_hash"]}  # no "v": prompt version 1

        class Fake:
            model = "fake"

            def complete(self, prompt):
                return [{"id": "rm-1", "summary": "S", "audience": [], "action": "awareness", "action_note": "", "impact": "low"}]

        with mock.patch.object(summarize, "get_provider", return_value=Fake()):
            summarize.summarize(s, CONFIG)
        self.assertEqual((item["ai"]["action"], item["ai"]["v"]), ("awareness", summarize.PROMPT_VERSION))


class DigestTests(unittest.TestCase):
    def test_sections_and_render(self):
        s = {"items": {}}
        store.merge(s, [roadmap.normalize(raw_roadmap(rid=1, created="2026-10-01T00:00:00"), CONFIG)], kinds_fetched={"feature"}, today="2026-10-01")
        store.merge(s, [roadmap.normalize(raw_roadmap(rid=1, status="Rolling out", created="2026-10-01T00:00:00"), CONFIG),
                        roadmap.normalize(raw_roadmap(rid=2, title="Copilot Chat & <b>tips</b>", created="2026-10-21T00:00:00"), CONFIG)],
                    kinds_fetched={"feature"}, today="2026-10-22")
        with mock.patch.dict(os.environ, {"AI_PROVIDER": "none"}):
            summarize.summarize(s, CONFIG)
        d = digest.build(s, CONFIG, date(2026, 10, 19), date(2026, 10, 26))
        self.assertEqual([e["item"]["id"] for e in d["sections"]["launched"]], ["rm-1"])
        self.assertEqual([e["item"]["id"] for e in d["sections"]["new"]], ["rm-2"])
        html = digest.render_html(d)
        self.assertIn("In development → Rolling out", html)
        self.assertIn("Copilot Chat &amp; &lt;b&gt;tips&lt;/b&gt;", html)
        self.assertIn("Oct 19 – Oct 25, 2026", digest.subject(d))
        self.assertIn("NOW AVAILABLE (1)", digest.render_text(d))

    def test_horizon_is_next_30_days_by_month(self):
        # Nov 2: window ends Dec 1, one day into December -> November only.
        self.assertEqual(digest._horizon_months(date(2026, 11, 2)), [date(2026, 11, 1)])
        # Nov 23: window covers Dec 1-22, more than half of December -> both.
        self.assertEqual(digest._horizon_months(date(2026, 11, 23)), [date(2026, 11, 1), date(2026, 12, 1)])
        # Year boundary.
        self.assertEqual(digest._horizon_months(date(2026, 12, 28)), [date(2026, 12, 1), date(2027, 1, 1)])
        s = {"items": {}}
        store.merge(s, [roadmap.normalize(raw_roadmap(rid=1, ga="November CY2026"), CONFIG),
                        roadmap.normalize(raw_roadmap(rid=2, ga="December CY2026"), CONFIG),
                        roadmap.normalize(raw_roadmap(rid=3, ga="November CY2026", status="Rolling out"), CONFIG)],
                    kinds_fetched={"feature"}, today="2026-11-01")
        groups = digest._horizon(s, date(2026, 11, 2))
        self.assertEqual([(g["label"], [i["id"] for i in g["items"]]) for g in groups], [("November 2026", ["rm-1"])])

    def test_default_window_is_previous_week(self):
        self.assertEqual(digest.default_window(date(2026, 11, 2)), (date(2026, 10, 26), date(2026, 11, 2)))
        self.assertEqual(digest.default_window(date(2026, 11, 4)), (date(2026, 10, 26), date(2026, 11, 2)))


class UtilTests(unittest.TestCase):
    def test_strip_html(self):
        self.assertEqual(strip_html("<p>A&nbsp;b</p><ul><li>one</li><li>two</li></ul>"), "A b\n\none\n\ntwo")


if __name__ == "__main__":
    unittest.main()
