"""Microsoft 365 Roadmap — Microsoft's public, structured feed of upcoming and shipped features.

The JSON API behind https://www.microsoft.com/microsoft-365/roadmap returns every roadmap
item in one response; we keep only the items our product rules match.
"""

from __future__ import annotations

import json
import re

from ..classify import classify_roadmap, tracked_tags
from ..util import http_get, strip_html

# Roadmap titles are prefixed with the product name ("SharePoint: Agent chat web part").
_TITLE_PREFIX = re.compile(r"^(Microsoft Copilot \(Microsoft (365|M365)\)|(Microsoft )?Copilot Studio|(Microsoft )?SharePoint( Syntex| Premium)?|Microsoft 365 Copilot)\s*:\s*", re.I)


def _canonical_app(tag: str) -> str:
    return {"Microsoft 365 Admin Center": "Microsoft 365 admin center"}.get(tag, tag)


def _tags(container: dict, key: str) -> list[str]:
    return [t["tagName"] for t in container.get(key) or [] if t.get("tagName")]


def normalize(raw: dict, config: dict) -> dict | None:
    container = raw.get("tagsContainer") or {}
    product_tags = _tags(container, "products")
    title = " ".join((raw.get("title") or "").split())
    description = strip_html(raw.get("description"))
    product = classify_roadmap(product_tags, title, description, config)
    if not product:
        return None
    rid = raw["id"]
    # Other product tags name the app the feature lands in (Word, Teams, Outlook...).
    tracked = tracked_tags(config)
    apps = sorted({_canonical_app(t) for t in product_tags if t not in tracked})
    clean_title = _TITLE_PREFIX.sub("", title).strip() or title
    prefix, sep, rest = clean_title.partition(":")
    if sep and rest.strip() and _canonical_app(prefix.strip()) in apps:
        clean_title = rest.strip()
    return {
        "id": f"rm-{rid}",
        "kind": "feature",
        "source": "Microsoft 365 Roadmap",
        "roadmap_id": rid,
        "product": product,
        "title": clean_title,
        "apps": apps,
        "description": description,
        "url": config["roadmap"]["item_url"].format(id=rid),
        "more_info_url": raw.get("moreInfoLink") or None,
        "status": raw.get("status") or "Unknown",
        "release_phases": _tags(container, "releasePhase"),
        "platforms": _tags(container, "platforms"),
        "clouds": _tags(container, "cloudInstances"),
        "roadmap_tags": product_tags,
        "preview_date": raw.get("publicPreviewDate") or None,
        "ga_date": raw.get("publicDisclosureAvailabilityDate") or None,
        "created": (raw.get("created") or "")[:10] or None,
        "modified": (raw.get("modified") or "")[:10] or None,
    }


def fetch(config: dict) -> list[dict]:
    raw_items = json.loads(http_get(config["roadmap"]["url"], timeout=120))
    if not isinstance(raw_items, list) or len(raw_items) < 100:
        # The API returns thousands of items; a tiny response means something is broken
        # and we must not treat every tracked item as removed.
        raise RuntimeError(f"Roadmap API returned an unexpected payload ({type(raw_items).__name__}, {len(raw_items)} items)")
    items = [normalize(r, config) for r in raw_items]
    return [i for i in items if i]
