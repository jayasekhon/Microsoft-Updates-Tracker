"""Official Microsoft blog feeds (RSS 2.0 or Atom) — announcements and monthly "what's new" posts."""

from __future__ import annotations

import sys
import xml.etree.ElementTree as ET
from datetime import timedelta
from email.utils import parsedate_to_datetime

from ..classify import classify_text
from ..util import content_hash, http_get, keyword_match, parse_date, strip_html, utcnow

ATOM = "{http://www.w3.org/2005/Atom}"
_RSS_BOILERPLATE = "The post "  # WordPress appends "The post X appeared first on Y."


def _date(value: str | None) -> str | None:
    if not value:
        return None
    try:
        return parsedate_to_datetime(value).date().isoformat()
    except (TypeError, ValueError):
        d = parse_date(value)
        return d.isoformat() if d else None


def _clean_summary(text: str) -> str:
    text = strip_html(text)
    cut = text.rfind(_RSS_BOILERPLATE)
    if cut > 0:
        text = text[:cut].strip()
    return text[:1200]


def parse_feed(xml_bytes: bytes) -> list[dict]:
    root = ET.fromstring(xml_bytes)
    entries = []
    for item in root.iter("item"):
        entries.append({
            "title": " ".join((item.findtext("title") or "").split()),
            "link": (item.findtext("link") or "").strip(),
            "date": _date(item.findtext("pubDate")),
            "summary": _clean_summary(item.findtext("description") or ""),
            "categories": [c.text.strip() for c in item.findall("category") if c.text],
        })
    for entry in root.iter(f"{ATOM}entry"):
        # Elements without children are falsy, so compare against None explicitly.
        link_el = entry.find(f"{ATOM}link[@rel='alternate']")
        if link_el is None:
            link_el = entry.find(f"{ATOM}link")
        entries.append({
            "title": " ".join((entry.findtext(f"{ATOM}title") or "").split()),
            "link": link_el.get("href", "") if link_el is not None else "",
            "date": _date(entry.findtext(f"{ATOM}published") or entry.findtext(f"{ATOM}updated")),
            "summary": _clean_summary(entry.findtext(f"{ATOM}summary") or entry.findtext(f"{ATOM}content") or ""),
            "categories": [c.get("term", "") for c in entry.findall(f"{ATOM}category") if c.get("term")],
        })
    return [e for e in entries if e["title"] and e["link"]]


def normalize(entry: dict, feed: dict, config: dict) -> dict | None:
    text = f"{entry['title']}\n{entry['summary']}\n{' '.join(entry['categories'])}"
    if not keyword_match(feed.get("relevance_keywords") or config.get("feed_relevance_keywords", []), text):
        return None
    product = classify_text(entry["title"], entry["summary"], config) or feed.get("default_product") or "m365"
    return {
        "id": "post-" + content_hash(entry["link"].split("?")[0].rstrip("/")),
        "kind": "post",
        "source": feed["name"],
        "product": product,
        "title": entry["title"],
        "description": entry["summary"],
        "url": entry["link"],
        "categories": entry["categories"],
        "created": entry["date"],
        "modified": entry["date"],
    }


def fetch(config: dict) -> tuple[list[dict], list[str]]:
    """Returns (items, warnings). A failing feed is a warning, never a fatal error."""
    items: dict[str, dict] = {}
    warnings: list[str] = []
    cutoff = (utcnow() - timedelta(days=config.get("feed_max_age_days", 180))).date().isoformat()
    for feed in config.get("feeds", []):
        try:
            entries = parse_feed(http_get(feed["url"], timeout=45, retries=2))
        except Exception as err:  # noqa: BLE001 - one bad feed must not stop the run
            level = "note" if feed.get("optional") else "warning"
            warnings.append(f"{level}: feed '{feed['name']}' unavailable: {err}")
            print(f"[rss] {level}: {feed['name']}: {err}", file=sys.stderr)
            continue
        kept = 0
        for entry in entries:
            if entry["date"] and entry["date"] < cutoff:
                continue
            item = normalize(entry, feed, config)
            if item and item["id"] not in items:  # the same post can appear in several feeds
                items[item["id"]] = item
                kept += 1
        print(f"[rss] {feed['name']}: {len(entries)} entries, {kept} kept", file=sys.stderr)
    return list(items.values()), warnings
