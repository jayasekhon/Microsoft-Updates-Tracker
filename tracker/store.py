"""Persistent item store with change detection.

data/items.json holds every tracked item plus an `events` list recording what happened
to it and when:
  new        first appeared (dated by Microsoft's created date when it is recent or on the
             first run; otherwise by the date we first saw it)
  status     status moved, e.g. In development -> Rolling out
  ga_date    general availability target changed (e.g. slipped a month)
  preview    preview target changed
  details    title or description was rewritten
  removed    disappeared from the Roadmap
  returned   reappeared after being removed
The site and the weekly digest are both built from these events.
"""

from __future__ import annotations

from datetime import date, timedelta

from .util import DATA_DIR, content_hash, load_json, parse_date, save_json, today_iso

ITEMS_PATH = DATA_DIR / "items.json"
SCHEMA_VERSION = 1

# Roadmap timing fields and the event type recorded when they change.
_TRACKED_FIELDS = {"status": "status", "ga_date": "ga_date", "preview_date": "preview"}
# Fields refreshed from the source on every run (everything else we own).
_SOURCE_FIELDS = (
    "kind", "source", "roadmap_id", "product", "title", "description", "url", "more_info_url",
    "status", "apps", "release_phases", "platforms", "clouds", "roadmap_tags", "categories",
    "preview_date", "ga_date", "created", "modified",
)
_RECENT_DAYS = 14


def load() -> dict:
    return load_json(ITEMS_PATH, {"schema": SCHEMA_VERSION, "items": {}, "meta": {}})


def save(store: dict) -> None:
    save_json(ITEMS_PATH, store)


def _new_event_date(item: dict, today: str, bootstrap: bool) -> str:
    created = parse_date(item.get("created"))
    today_d = date.fromisoformat(today)
    if created and created <= today_d and (bootstrap or created >= today_d - timedelta(days=_RECENT_DAYS)):
        return created.isoformat()
    return today


def _text_hash(item: dict) -> str:
    return content_hash(item.get("title") or "", item.get("description") or "")


def merge(store: dict, fetched: list[dict], *, kinds_fetched: set[str], today: str | None = None) -> dict:
    """Merge freshly fetched items into the store, appending events for anything that changed.

    kinds_fetched lists the item kinds whose source was fetched successfully this run; only
    those kinds can be marked removed (a failed fetch must never look like mass removal).
    Returns counts of what changed.
    """
    today = today or today_iso()
    items: dict = store.setdefault("items", {})
    bootstrap = not items
    counts = {"new": 0, "changed": 0, "removed": 0}
    seen: set[str] = set()

    for fresh in fetched:
        iid = fresh["id"]
        seen.add(iid)
        current = items.get(iid)
        if current is None:
            record = {k: fresh.get(k) for k in _SOURCE_FIELDS if k in fresh}
            record.update({
                "id": iid,
                "first_seen": today,
                "last_seen": today,
                "text_hash": _text_hash(fresh),
                "events": [{"type": "new", "date": _new_event_date(fresh, today, bootstrap)}],
            })
            items[iid] = record
            counts["new"] += 1
            continue

        events = current.setdefault("events", [])
        changed = False
        if current.get("removed"):
            current["removed"] = False
            events.append({"type": "returned", "date": today})
            changed = True
        for field, event_type in _TRACKED_FIELDS.items():
            old, new = current.get(field), fresh.get(field)
            if fresh.get("kind") == "feature" and old != new and new:
                events.append({"type": event_type, "date": today, "from": old, "to": new})
                changed = True
        new_hash = _text_hash(fresh)
        if new_hash != current.get("text_hash"):
            events.append({"type": "details", "date": today})
            current["text_hash"] = new_hash
            changed = True
        for key in _SOURCE_FIELDS:
            if key in fresh:
                current[key] = fresh[key]
        current["last_seen"] = today
        counts["changed"] += changed

    for iid, item in items.items():
        if iid in seen or item.get("removed") or item.get("kind") not in kinds_fetched:
            continue
        if item.get("kind") == "post":
            continue  # posts age out of feeds; that is not a removal
        item["removed"] = True
        item.setdefault("events", []).append({"type": "removed", "date": today})
        counts["removed"] += 1

    store["schema"] = SCHEMA_VERSION
    return counts


def last_activity(item: dict) -> str:
    """Date of the most recent meaningful event (details-only edits don't count)."""
    dates = [e["date"] for e in item.get("events", []) if e["type"] != "details"]
    return max(dates) if dates else (item.get("first_seen") or "")


def events_between(store: dict, start: str, end: str, *, types: set[str] | None = None):
    """Yield (item, event) for events with start <= date < end."""
    for item in store.get("items", {}).values():
        for event in item.get("events", []):
            if start <= event["date"] < end and (types is None or event["type"] in types):
                yield item, event
