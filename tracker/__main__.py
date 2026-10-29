"""Command line: python -m tracker <command>

  update     fetch sources, detect changes, summarise, write data/
  build      assemble the static site into _site/
  digest     build the weekly digest (archive it; optionally email it)
"""

from __future__ import annotations

import argparse
import os
import shutil
import sys
from datetime import date, timedelta

from . import digest as digest_mod
from . import store as store_mod
from .sources import roadmap, rss
from .summarize import summarize
from .util import DATA_DIR, ROOT, load_config, load_json, save_json, utcnow


def cmd_update(args) -> int:
    config = load_config()
    store = store_mod.load()
    fetched: list[dict] = []
    kinds: set[str] = set()
    warnings: list[str] = []

    try:
        features = roadmap.fetch(config)
        fetched += features
        kinds.add("feature")
        print(f"[roadmap] {len(features)} in-scope features", file=sys.stderr)
    except Exception as err:  # noqa: BLE001
        warnings.append(f"error: Microsoft 365 Roadmap unavailable: {err}")
        print(f"[roadmap] ERROR {err}", file=sys.stderr)

    posts, feed_warnings = rss.fetch(config)
    fetched += posts
    warnings += feed_warnings
    if posts:
        kinds.add("post")

    if not fetched:
        print("Nothing fetched; leaving data untouched.", file=sys.stderr)
        return 1

    counts = store_mod.merge(store, fetched, kinds_fetched=kinds)
    print(f"[store] {counts}", file=sys.stderr)
    if args.no_ai:
        os.environ["AI_PROVIDER"] = "none"  # still fill in rule-based summaries
    ai_counts = summarize(store, config, max_items=args.max_ai)
    print(f"[ai] {ai_counts}", file=sys.stderr)

    store["meta"] = {
        "updated_at": utcnow().isoformat(timespec="seconds"),
        "warnings": warnings,
        "last_counts": counts,
    }
    store_mod.save(store)
    write_site_data(store, config)
    # Fail the run only if the primary source is down, so the workflow alerts someone.
    return 1 if "feature" not in kinds else 0


def write_site_data(store: dict, config: dict) -> None:
    """data/site.json: the compact payload the website loads."""
    items = []
    for item in store["items"].values():
        ai = item.get("ai") or {}
        items.append({
            "id": item["id"],
            "k": item["kind"],
            "p": item["product"],
            "t": item["title"],
            "d": item.get("description", ""),
            "u": item["url"],
            "mu": item.get("more_info_url"),
            "s": item.get("status"),
            "src": item.get("source"),
            "rid": item.get("roadmap_id"),
            "ap": item.get("apps") or [],
            "ph": item.get("release_phases") or [],
            "pf": item.get("platforms") or [],
            "cl": item.get("clouds") or [],
            "pv": item.get("preview_date"),
            "ga": item.get("ga_date"),
            "c": item.get("created"),
            "fs": item.get("first_seen"),
            "la": store_mod.last_activity(item),
            "x": bool(item.get("removed")),
            "ev": item.get("events", []),
            "ai": {k: ai.get(k) for k in ("summary", "audience", "action", "action_note", "impact", "model")} if ai else None,
        })
    items.sort(key=lambda i: (i["la"], i["id"]), reverse=True)
    payload = {
        "updated_at": store.get("meta", {}).get("updated_at"),
        "warnings": store.get("meta", {}).get("warnings", []),
        "products": [{"id": r["id"], "name": r["name"]} for r in config["products"]],
        "items": items,
    }
    save_json(DATA_DIR / "site.json", payload, compact=True)


def cmd_build(args) -> int:
    out = ROOT / args.out
    if out.exists():
        shutil.rmtree(out)
    shutil.copytree(ROOT / "site", out)
    (out / "data").mkdir(exist_ok=True)
    shutil.copy(DATA_DIR / "site.json", out / "data" / "site.json")
    digests = ROOT / "digests"
    if digests.exists():
        shutil.copytree(digests, out / "digests", dirs_exist_ok=True)
    (out / "digests").mkdir(exist_ok=True)
    shutil.copy(ROOT / "site" / "digests.html", out / "digests" / "index.html")
    (out / "feed.xml").write_text(build_feed(load_json(DATA_DIR / "site.json", {})), encoding="utf-8")
    (out / ".nojekyll").write_text("")
    print(f"Site built in {out}", file=sys.stderr)
    return 0


def build_feed(site: dict) -> str:
    """RSS of recent activity, so people can follow along in Outlook, Teams or a feed reader."""
    from email.utils import format_datetime
    from datetime import datetime, timezone
    from html import escape

    base = digest_mod.site_url()
    names = {p["id"]: p["name"] for p in site.get("products", [])}
    entries = []
    for item in site.get("items", [])[:150]:
        events = [e for e in item["ev"] if e["type"] != "details" and e["date"] == item["la"]]
        if not events:
            continue
        ev = events[-1]
        label = {"new": "New", "status": f"Now {ev.get('to')}", "ga_date": "Date change", "preview": "Preview date change",
                 "removed": "Removed", "returned": "Back"}.get(ev["type"], "Update")
        summary = (item.get("ai") or {}).get("summary") or item["d"][:400]
        when = datetime.fromisoformat(item["la"]).replace(tzinfo=timezone.utc)
        entries.append(f"""<item><title>{escape(f"[{names.get(item['p'], item['p'])}] {label}: {item['t']}")}</title>
<link>{escape(item['u'])}</link><guid isPermaLink="false">{escape(item['id'] + ':' + item['la'] + ':' + ev['type'])}</guid>
<pubDate>{format_datetime(when)}</pubDate><description>{escape(summary)}</description></item>""")
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>Copilot &amp; SharePoint AI updates</title><link>{escape(base)}</link>
<description>Changes to Microsoft 365 Copilot, Copilot Chat, Copilot Studio and SharePoint AI, from Microsoft sources.</description>
{''.join(entries)}
</channel></rss>
"""


def cmd_digest(args) -> int:
    config = load_config()
    store = store_mod.load()
    if args.start:
        start = date.fromisoformat(args.start)
        end = start + timedelta(days=args.days)
    else:
        start, end = digest_mod.default_window()
    digest = digest_mod.build(store, config, start, end)
    html = digest_mod.render_html(digest)
    text = digest_mod.render_text(digest)
    subject = digest_mod.subject(digest)
    print(f"[digest] {subject} ({digest['total']} items)", file=sys.stderr)

    if args.preview:
        path = ROOT / args.preview
        path.write_text(html, encoding="utf-8")
        path.with_suffix(".txt").write_text(text, encoding="utf-8")
        print(f"[digest] preview written to {path}", file=sys.stderr)
    if args.archive:
        print(f"[digest] archived {digest_mod.archive(digest)}", file=sys.stderr)
    if args.send or args.test_to:
        if not digest["total"] and not args.send_empty and not args.test_to:
            print("[digest] nothing changed this week; not sending", file=sys.stderr)
            return 0
        if args.send and not args.test_to and not args.force and digest_mod.already_sent(digest):
            print("[digest] this week's briefing was already sent; use --force to resend", file=sys.stderr)
            return 0
        from .mailer import send

        to = [a.strip() for a in args.test_to.split(",")] if args.test_to else None
        sent = send(("[TEST] " if args.test_to else "") + subject, html, text, to=to)
        print(f"[digest] sent to {len(sent)} recipient(s)", file=sys.stderr)
        if not args.test_to:
            digest_mod.mark_sent(digest)
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="tracker", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)

    p = sub.add_parser("update", help="fetch sources and refresh data/")
    p.add_argument("--no-ai", action="store_true", help="rule-based summaries only (no AI calls)")
    p.add_argument("--max-ai", type=int, default=None, help="cap AI-summarised items this run (default AI_MAX_ITEMS or 200)")
    p.set_defaults(func=cmd_update)

    p = sub.add_parser("build", help="assemble the static site")
    p.add_argument("--out", default="_site")
    p.set_defaults(func=cmd_build)

    p = sub.add_parser("digest", help="build (and optionally send) the weekly digest")
    p.add_argument("--start", help="first day YYYY-MM-DD (default: last full Monday-Sunday week)")
    p.add_argument("--days", type=int, default=7)
    p.add_argument("--preview", help="write HTML + text preview to this path")
    p.add_argument("--archive", action="store_true", help="save to digests/ for the website")
    p.add_argument("--send", action="store_true", help="email to DIGEST_TO / DIGEST_BCC")
    p.add_argument("--send-empty", action="store_true", help="send even when nothing changed")
    p.add_argument("--force", action="store_true", help="resend even if this week was already sent")
    p.add_argument("--test-to", help="send only to these addresses, with [TEST] in the subject")
    p.set_defaults(func=cmd_digest)

    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
