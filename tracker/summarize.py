"""Plain-English summaries and impact tags for each item.

Providers (set AI_PROVIDER):
  gemini   Google Gemini API (free tier works). Needs GEMINI_API_KEY; model via GEMINI_MODEL.
  bedrock  AWS Bedrock Converse API. Needs BEDROCK_MODEL_ID plus standard AWS credentials
           (AWS_REGION, and keys or an OIDC role). Requires `pip install boto3`.
  none     No AI: a rule-based summary taken from Microsoft's own text.
Default: gemini when GEMINI_API_KEY is set, otherwise none.

Each item is summarised once and re-summarised only when its title or description changes.
Microsoft's original text and source link are always kept alongside the summary.
"""

from __future__ import annotations

import json
import os
import re
import sys
import time
import urllib.error

from .classify import product_names
from .util import http_post_json, today_iso

AUDIENCES = ["End users", "IT admins", "Makers & developers", "Security & compliance", "Leaders"]
ACTIONS = {
    "none": "No action needed",
    "awareness": "Good to know",
    "prepare": "Prepare users",
    "admin": "Admin action",
}
IMPACTS = ["low", "medium", "high"]
BATCH_SIZE = 5  # small batches keep each response well inside the request timeout
REQUEST_TIMEOUT = 300  # seconds; Gemini's free tier can take minutes when busy
TIME_BUDGET = 20 * 60  # seconds of AI work per run, so the daily job always finishes

PROMPT = """You help a corporate department keep up with Microsoft Copilot and SharePoint AI changes.
For each update below write:
- "summary": 1-2 plain-English sentences (max 45 words) saying what changes and why it matters to people at work. No marketing language. Do not start with "This update".
- "audience": who is affected, a subset of {audiences}.
- "action": one of "admin" (an IT admin must configure, enable, disable or review something, or a default setting changes), "prepare" (users will notice a visible change and may need a heads-up or training), "awareness" (useful to know, nothing to do), "none".
- "action_note": if action is admin or prepare, one short imperative sentence saying what to do; otherwise "".
- "impact": "low", "medium" or "high" for a typical organisation.
Return a JSON array with one object per update, each including its "id". Base everything only on the text given.

Updates:
{items}"""

_RESPONSE_SCHEMA = {
    "type": "ARRAY",
    "items": {
        "type": "OBJECT",
        "properties": {
            "id": {"type": "STRING"},
            "summary": {"type": "STRING"},
            "audience": {"type": "ARRAY", "items": {"type": "STRING", "enum": AUDIENCES}},
            "action": {"type": "STRING", "enum": list(ACTIONS)},
            "action_note": {"type": "STRING"},
            "impact": {"type": "STRING", "enum": IMPACTS},
        },
        "required": ["id", "summary", "audience", "action", "action_note", "impact"],
    },
}


# ---------------------------------------------------------------- rule-based fallback

_ADMIN_HINTS = re.compile(r"\badmins?\b|administrator|admin center|policy|policies|tenant|by default|opt[- ]out|turn (it )?off|disable|license|PowerShell|Purview|retention|compliance", re.I)
_MAKER_HINTS = re.compile(r"\bmakers?\b|developer|\bAPI\b|\bSDK\b|connector|Copilot Studio|agent builder|\bMCP\b", re.I)
_SECURITY_HINTS = re.compile(r"security|compliance|Purview|DLP|sensitivity label|audit|eDiscovery", re.I)


def _first_sentences(text: str, limit: int = 280) -> str:
    text = " ".join(text.split())
    sentences = re.split(r"(?<=[.!?])\s+", text)
    out = ""
    for sentence in sentences:
        if out and len(out) + len(sentence) > limit:
            break
        out = f"{out} {sentence}".strip()
    if len(out) > limit:
        out = out[: limit - 1].rsplit(" ", 1)[0] + "…"
    return out


def heuristic(item: dict) -> dict:
    text = f"{item.get('title', '')}\n{item.get('description', '')}"
    audience = []
    if _ADMIN_HINTS.search(text):
        audience.append("IT admins")
    if _MAKER_HINTS.search(text) or item.get("product") == "studio":
        audience.append("Makers & developers")
    if _SECURITY_HINTS.search(text):
        audience.append("Security & compliance")
    if item.get("kind") == "feature" and item.get("product") != "studio":
        audience.insert(0, "End users")
    admin = bool(re.search(r"\badmins?\b|admin center|by default|policy|opt[- ]out", text, re.I))
    return {
        "summary": _first_sentences(item.get("description") or item.get("title", "")),
        "audience": audience or ["End users"],
        "action": "admin" if admin and item.get("kind") == "feature" else "awareness",
        "action_note": "Review the admin controls and decide how to configure this for your organisation." if admin and item.get("kind") == "feature" else "",
        "impact": "medium",
        "model": "rules",
    }


# ---------------------------------------------------------------- providers

def _extract_json_array(text: str) -> list:
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```(json)?|```$", "", text, flags=re.M).strip()
    start, end = text.find("["), text.rfind("]")
    return json.loads(text[start : end + 1])


class GeminiProvider:
    def __init__(self) -> None:
        self.key = os.environ["GEMINI_API_KEY"]
        self.model = os.environ.get("GEMINI_MODEL") or "gemini-flash-latest"
        self.pause = float(os.environ.get("AI_PAUSE_SECONDS") or 6)  # free tier is ~10 requests/min

    def complete(self, prompt: str) -> list:
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{self.model}:generateContent"
        payload = {
            "contents": [{"role": "user", "parts": [{"text": prompt}]}],
            "generationConfig": {
                "temperature": 0.2,
                "responseMimeType": "application/json",
                "responseSchema": _RESPONSE_SCHEMA,
            },
        }
        for attempt in range(4):
            try:
                resp = http_post_json(url, payload, headers={"x-goog-api-key": self.key}, timeout=REQUEST_TIMEOUT)
                time.sleep(self.pause)
                parts = resp["candidates"][0]["content"]["parts"]
                return _extract_json_array("".join(p.get("text", "") for p in parts))
            except urllib.error.HTTPError as err:
                if err.code in (429, 500, 503) and attempt < 3:
                    time.sleep(30 * (attempt + 1))
                    continue
                body = err.read().decode(errors="replace")[:500]
                raise RuntimeError(f"Gemini HTTP {err.code}: {body}") from err
            except (TimeoutError, urllib.error.URLError) as err:
                if attempt < 1:
                    time.sleep(15)
                    continue
                raise RuntimeError(f"Gemini request failed: {err}") from err
        raise RuntimeError("Gemini: retries exhausted")


class BedrockProvider:
    def __init__(self) -> None:
        import boto3  # optional dependency, only needed for this provider

        self.model = os.environ["BEDROCK_MODEL_ID"]
        self.client = boto3.client("bedrock-runtime", region_name=os.environ.get("AWS_REGION") or None)

    def complete(self, prompt: str) -> list:
        resp = self.client.converse(
            modelId=self.model,
            messages=[{"role": "user", "content": [{"text": prompt + "\n\nRespond with only the JSON array."}]}],
            inferenceConfig={"temperature": 0.2, "maxTokens": 4000},
        )
        text = "".join(block.get("text", "") for block in resp["output"]["message"]["content"])
        return _extract_json_array(text)


def get_provider():
    name = (os.environ.get("AI_PROVIDER") or ("gemini" if os.environ.get("GEMINI_API_KEY") else "none")).lower()
    if name == "gemini":
        return GeminiProvider()
    if name == "bedrock":
        return BedrockProvider()
    return None


# ---------------------------------------------------------------- orchestration

def _clean(result: dict) -> dict:
    action = result.get("action") if result.get("action") in ACTIONS else "awareness"
    return {
        "summary": " ".join(str(result.get("summary", "")).split())[:500],
        "audience": [a for a in result.get("audience", []) if a in AUDIENCES] or ["End users"],
        "action": action,
        "action_note": str(result.get("action_note", "")).strip() if action in ("admin", "prepare") else "",
        "impact": result.get("impact") if result.get("impact") in IMPACTS else "medium",
    }


def _prompt_item(item: dict, names: dict) -> dict:
    return {
        "id": item["id"],
        "product": names.get(item["product"], item["product"]),
        "type": "roadmap feature" if item["kind"] == "feature" else "blog post",
        "status": item.get("status"),
        "title": item["title"],
        "description": (item.get("description") or "")[:2500],
        "release": ", ".join(item.get("release_phases") or []),
    }


def summarize(store: dict, config: dict, *, max_items: int | None = None) -> dict:
    """Fill item['ai'] for items that have none or whose text changed. Returns counts."""
    items = list(store.get("items", {}).values())
    pending = [i for i in items if not i.get("removed") and (i.get("ai") or {}).get("hash") != i.get("text_hash")]
    # Rule-based results are upgraded once an AI provider is configured.
    provider = get_provider()
    if provider:
        pending_ids = {i["id"] for i in pending}
        pending += [i for i in items if not i.get("removed") and (i.get("ai") or {}).get("model") == "rules" and i["id"] not in pending_ids]
    # Newest activity first so a capped run spends its budget where readers will look.
    pending.sort(key=lambda i: max((e["date"] for e in i.get("events", [])), default=""), reverse=True)
    # GitHub Actions passes unset repository variables as empty strings, hence `or`.
    max_items = max_items if max_items is not None else int(os.environ.get("AI_MAX_ITEMS") or 200)

    counts = {"ai": 0, "rules": 0, "errors": 0}
    names = product_names(config)
    ai_budget = pending[:max_items] if provider else []
    model = getattr(provider, "model", None)
    deadline = time.monotonic() + TIME_BUDGET
    failures_in_a_row = 0

    for start in range(0, len(ai_budget), BATCH_SIZE):
        if time.monotonic() > deadline:
            print("[ai] time budget used; the rest will be summarised on the next run", file=sys.stderr)
            break
        batch = ai_budget[start : start + BATCH_SIZE]
        prompt = PROMPT.format(
            audiences=json.dumps(AUDIENCES),
            items=json.dumps([_prompt_item(i, names) for i in batch], ensure_ascii=False, indent=1),
        )
        try:
            results = {r.get("id"): r for r in provider.complete(prompt) if isinstance(r, dict)}
        except Exception as err:  # noqa: BLE001 - keep going; these fall back to rules below
            print(f"[ai] batch failed: {err}", file=sys.stderr)
            counts["errors"] += 1
            failures_in_a_row += 1
            if failures_in_a_row >= 3:
                print("[ai] 3 failures in a row, falling back to rules for the rest", file=sys.stderr)
                break
            continue
        failures_in_a_row = 0
        for item in batch:
            if item["id"] in results:
                item["ai"] = {**_clean(results[item["id"]]), "model": model, "hash": item["text_hash"], "date": today_iso()}
                counts["ai"] += 1

    for item in pending:
        if not item.get("ai") or (item["ai"].get("hash") != item.get("text_hash")):
            item["ai"] = {**heuristic(item), "hash": item["text_hash"], "date": today_iso()}
            counts["rules"] += 1
    return counts
