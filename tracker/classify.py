"""Decide which tracked product an item belongs to (or that it is out of scope).

Rules live in config/sources.json and are evaluated in order; the first match wins.
  roadmap_tags         item must carry one of these Roadmap product tags ...
  keywords             ... or, if it carries an AI product tag, mention one of these in its title
  title_keywords /     scope filter: the title must match a title keyword or the description a
  description_keywords description keyword (used to keep only the AI side of SharePoint)
  require_keywords     title or description must contain one of these
"""

from __future__ import annotations

from .util import keyword_match


def _ai_tags(config: dict) -> set[str]:
    """Roadmap tags whose items are inherently about Copilot (no scope filter on their rule)."""
    tags: set[str] = set()
    for rule in config["products"]:
        if not rule.get("title_keywords") and not rule.get("description_keywords"):
            tags.update(rule.get("roadmap_tags", []))
    return tags


def _passes_scope_filter(rule: dict, title: str, description: str) -> bool:
    title_kw, desc_kw = rule.get("title_keywords"), rule.get("description_keywords")
    if not title_kw and not desc_kw:
        return True
    return keyword_match(title_kw or [], title) or keyword_match(desc_kw or [], description)


def classify_roadmap(product_tags: list[str], title: str, description: str, config: dict) -> str | None:
    tags = set(product_tags)
    excluded = tuple(config.get("exclude_tag_prefixes", []))
    if excluded and any(t.startswith(excluded) for t in tags) and "Microsoft Copilot Studio" not in tags:
        return None
    has_ai_tag = bool(tags & _ai_tags(config))
    text = f"{title}\n{description}"
    for rule in config["products"]:
        by_tag = bool(tags & set(rule.get("roadmap_tags", [])))
        by_keyword = has_ai_tag and keyword_match(rule.get("keywords", []), title)
        if not (by_tag or by_keyword):
            continue
        if by_tag and not by_keyword and not _passes_scope_filter(rule, title, description):
            continue
        if rule.get("require_keywords") and not keyword_match(rule["require_keywords"], text):
            continue
        return rule["id"]
    return None


def classify_text(title: str, description: str, config: dict) -> str | None:
    """Best-effort product for free text such as a blog post (no Roadmap tags available).

    Only the title is used: a post that mentions SharePoint in passing should not be filed
    under SharePoint. Callers fall back to the feed's default product.
    """
    text = title
    for rule in config["products"]:
        if rule.get("keywords") and keyword_match(rule["keywords"], text):
            return rule["id"]
        if rule.get("require_keywords") and keyword_match(rule["require_keywords"], text):
            return rule["id"]
    return None


def tracked_tags(config: dict) -> set[str]:
    return {t for rule in config["products"] for t in rule.get("roadmap_tags", [])}


def product_names(config: dict) -> dict[str, str]:
    return {r["id"]: r["name"] for r in config["products"]}
