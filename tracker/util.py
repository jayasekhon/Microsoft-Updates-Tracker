"""Small shared helpers: HTTP, HTML cleanup, dates, JSON files."""

from __future__ import annotations

import hashlib
import html
import json
import re
import time
import urllib.error
import urllib.request
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
CONFIG_DIR = ROOT / "config"

USER_AGENT = "Microsoft-Updates-Tracker/1.0 (+https://github.com/jayasekhon/Microsoft-Updates-Tracker)"


def http_get(url: str, *, timeout: int = 60, retries: int = 3, headers: dict | None = None) -> bytes:
    """GET a URL, retrying transient failures with exponential backoff."""
    req_headers = {"User-Agent": USER_AGENT, "Accept": "*/*"}
    req_headers.update(headers or {})
    last_err: Exception | None = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers=req_headers)
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return resp.read()
        except urllib.error.HTTPError as err:
            # 4xx (other than rate limiting) will not fix itself on retry.
            if 400 <= err.code < 500 and err.code != 429:
                raise
            last_err = err
        except (urllib.error.URLError, TimeoutError, ConnectionError) as err:
            last_err = err
        time.sleep(2 ** (attempt + 1))
    raise RuntimeError(f"GET {url} failed after {retries} attempts: {last_err}")


def http_post_json(url: str, payload: dict, *, headers: dict | None = None, timeout: int = 120) -> dict:
    req_headers = {"User-Agent": USER_AGENT, "Content-Type": "application/json"}
    req_headers.update(headers or {})
    req = urllib.request.Request(url, data=json.dumps(payload).encode(), headers=req_headers, method="POST")
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read())


_BLOCK_TAGS = re.compile(r"</?(p|div|br|li|ul|ol|h\d)[^>]*>", re.I)
_TAGS = re.compile(r"<[^>]+>")
_SPACES = re.compile(r"[ \t\r\f\v]+")


def strip_html(text: str | None) -> str:
    """Turn a snippet of HTML into readable plain text, keeping paragraph breaks."""
    if not text:
        return ""
    text = _BLOCK_TAGS.sub("\n", text)
    text = _TAGS.sub("", text)
    text = html.unescape(text).replace(" ", " ")
    lines = [_SPACES.sub(" ", line).strip() for line in text.split("\n")]
    out: list[str] = []
    for line in lines:
        if line or (out and out[-1]):
            out.append(line)
    return "\n".join(out).strip()


def content_hash(*parts: str) -> str:
    return hashlib.sha1("\x1f".join(parts).encode()).hexdigest()[:12]


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def today_iso() -> str:
    return utcnow().date().isoformat()


def parse_date(value: str | None) -> date | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).date()
    except ValueError:
        return None


def week_start(d: date) -> date:
    """Monday of the ISO week containing d."""
    return d - timedelta(days=d.weekday())


def load_json(path: Path, default):
    if not path.exists():
        return default
    with path.open(encoding="utf-8") as fh:
        return json.load(fh)


def save_json(path: Path, data, *, compact: bool = False) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    with tmp.open("w", encoding="utf-8") as fh:
        if compact:
            json.dump(data, fh, ensure_ascii=False, separators=(",", ":"))
        else:
            json.dump(data, fh, ensure_ascii=False, indent=1, sort_keys=True)
            fh.write("\n")
    tmp.replace(path)


def load_config() -> dict:
    return load_json(CONFIG_DIR / "sources.json", {})


def keyword_match(patterns: list[str], text: str) -> bool:
    return any(re.search(p, text, re.I) for p in patterns)
