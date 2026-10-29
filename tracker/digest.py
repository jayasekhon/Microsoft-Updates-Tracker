"""Weekly digest: what changed between two dates, rendered as an Outlook-safe HTML email,
a plain-text alternative, and an archived web copy under digests/.

Email HTML deliberately uses tables, inline styles and system fonts: Outlook for Windows
renders with Word's engine and ignores most modern CSS.
"""

from __future__ import annotations

import os
from datetime import date, timedelta
from html import escape

from .classify import product_names
from .store import events_between
from .summarize import ACTIONS
from .util import ROOT, load_json, save_json, today_iso, utcnow, week_start

DIGESTS_DIR = ROOT / "digests"
DEFAULT_SITE_URL = "https://jayasekhon.github.io/Microsoft-Updates-Tracker/"

PRODUCT_COLORS = {"m365": "#6d4aff", "chat": "#0f8a7e", "studio": "#c2410c", "sharepoint": "#0b6fb8"}
STATUS_COLORS = {
    "In development": ("#fff4d6", "#8a5a00"),
    "Rolling out": ("#dff3ff", "#03558c"),
    "Launched": ("#ddf7e6", "#146c34"),
    "Cancelled": ("#fde2e2", "#9b1c1c"),
}
# Order of sections in the email, and how each event type maps onto them.
SECTIONS = [
    ("launched", "Now available", "Launched or rolling out to tenants this week."),
    ("new", "Newly announced", "Added to the Microsoft 365 Roadmap."),
    ("timeline", "Timeline changes", "Target dates that moved."),
    ("posts", "From the Microsoft blogs", "Official announcements and deep dives."),
    ("ended", "Cancelled or removed", "No longer on the Roadmap."),
]
_EVENT_RANK = {"status": 0, "new": 1, "ga_date": 2, "preview": 3, "removed": 4, "returned": 5}


def site_url() -> str:
    url = os.environ.get("SITE_URL") or DEFAULT_SITE_URL
    return url if url.endswith("/") else url + "/"


def default_window(today: date | None = None) -> tuple[date, date]:
    """The most recent full Monday-Sunday week before today."""
    end = week_start(today or date.fromisoformat(today_iso()))
    return end - timedelta(days=7), end


def _section_for(item: dict, event: dict) -> str | None:
    if item["kind"] == "post":
        return "posts" if event["type"] == "new" else None
    t = event["type"]
    if t == "status":
        if event.get("to") in ("Launched", "Rolling out"):
            return "launched"
        if event.get("to") == "Cancelled":
            return "ended"
        return "timeline"
    if t == "new":
        # Microsoft often adds items that are already rolling out; readers care that it's here.
        return "launched" if item.get("status") in ("Launched", "Rolling out") else "new"
    if t in ("ga_date", "preview"):
        return "timeline"
    if t == "removed":
        return "ended"
    if t == "returned":
        return "new"
    return None


def build(store: dict, config: dict, start: date, end: date) -> dict:
    """Collect the week's changes. Each item appears once, under its most significant event."""
    best: dict[str, tuple[dict, list[dict]]] = {}
    for item, event in events_between(store, start.isoformat(), end.isoformat()):
        if event["type"] == "details":
            continue
        entry = best.setdefault(item["id"], (item, []))
        entry[1].append(event)

    sections: dict[str, list[dict]] = {key: [] for key, *_ in SECTIONS}
    for item, events in best.values():
        events.sort(key=lambda e: _EVENT_RANK.get(e["type"], 9))
        section = _section_for(item, events[0])
        if section:
            sections[section].append({"item": item, "events": events})

    impact_rank = {"high": 0, "medium": 1, "low": 2}
    for entries in sections.values():
        entries.sort(key=lambda e: (impact_rank.get((e["item"].get("ai") or {}).get("impact"), 1), e["item"]["product"], e["item"]["title"].lower()))

    actions = [
        e for key in ("launched", "new", "timeline")
        for e in sections[key]
        if (e["item"].get("ai") or {}).get("action") in ("admin", "prepare")
    ]
    horizon = _horizon(store, end)
    total = sum(len(v) for v in sections.values())
    return {
        "start": start.isoformat(),
        "end": (end - timedelta(days=1)).isoformat(),
        "sections": sections,
        "actions": actions,
        "horizon": horizon,
        "total": total,
        "names": product_names(config),
        "stats": {
            "available": len(sections["launched"]),
            "new": len(sections["new"]),
            "timeline": len(sections["timeline"]),
            "actions": len(actions),
        },
    }


def _horizon(store: dict, end: date) -> list[dict]:
    """Features still in development that target general availability next month."""
    nxt = (end.replace(day=1) + timedelta(days=32)).replace(day=1)
    label = f"{nxt.strftime('%B')} CY{nxt.year}"
    items = [
        i for i in store.get("items", {}).values()
        if i.get("kind") == "feature" and not i.get("removed")
        and i.get("status") == "In development" and i.get("ga_date") == label
    ]
    items.sort(key=lambda i: ({"high": 0, "medium": 1, "low": 2}.get((i.get("ai") or {}).get("impact"), 1), i["title"]))
    return [{"label": label.replace(" CY", " "), "items": items}] if items else []


# ---------------------------------------------------------------- formatting helpers

def _fmt_day(iso: str) -> str:
    d = date.fromisoformat(iso)
    return f"{d.strftime('%b')} {d.day}"


def week_label(digest: dict) -> str:
    end = date.fromisoformat(digest["end"])
    return f"{_fmt_day(digest['start'])} – {_fmt_day(digest['end'])}, {end.year}"


def _change_text(event: dict) -> str:
    t = event["type"]
    if t == "status":
        return f"{event.get('from') or '—'} → {event.get('to')}"
    if t == "ga_date":
        return f"GA target {event.get('from') or 'unset'} → {event.get('to')}"
    if t == "preview":
        return f"Preview target {event.get('from') or 'unset'} → {event.get('to')}"
    if t == "new":
        return "New"
    if t == "removed":
        return "Removed from Roadmap"
    if t == "returned":
        return "Back on the Roadmap"
    return ""


def _item_link(item: dict) -> str:
    return f"{site_url()}#item={item['id']}"


# ---------------------------------------------------------------- HTML email

_FONT = "font-family:'Segoe UI',-apple-system,Helvetica,Arial,sans-serif;"


def _pill(text: str, bg: str, fg: str) -> str:
    return (f'<span style="{_FONT}display:inline-block;padding:2px 8px;border-radius:10px;'
            f'background:{bg};color:{fg};font-size:11px;font-weight:600;line-height:16px;'
            f'white-space:nowrap;">{escape(text)}</span>')


def _item_html(entry: dict, names: dict) -> str:
    item, events = entry["item"], entry["events"]
    ai = item.get("ai") or {}
    color = PRODUCT_COLORS.get(item["product"], "#555")
    pills = [_pill(names.get(item["product"], item["product"]), color, "#ffffff")]
    if item["kind"] == "feature" and item.get("status"):
        bg, fg = STATUS_COLORS.get(item["status"], ("#eee", "#333"))
        pills.append(_pill(item["status"], bg, fg))
    if ai.get("action") in ("admin", "prepare"):
        pills.append(_pill(ACTIONS[ai["action"]], "#fde8e8", "#a61b1b"))
    if ai.get("impact") == "high":
        pills.append(_pill("High impact", "#f3e8ff", "#6b21a8"))

    change = " · ".join(filter(None, (_change_text(e) for e in events if e["type"] != "new")))
    meta = []
    if item["kind"] == "feature":
        if item.get("ga_date"):
            meta.append(f"GA: {escape(item['ga_date'].replace(' CY', ' '))}")
        if item.get("preview_date"):
            meta.append(f"Preview: {escape(item['preview_date'].replace(' CY', ' '))}")
        if item.get("roadmap_id"):
            meta.append(f"Roadmap ID {item['roadmap_id']}")
    else:
        meta.append(escape(item.get("source", "")))
    if ai.get("audience"):
        meta.append("For: " + escape(", ".join(ai["audience"])))

    summary = ai.get("summary") or item.get("description", "")[:280]
    action_html = ""
    if ai.get("action_note"):
        action_html = (f'<tr><td style="{_FONT}padding:8px 12px;background:#fff5f5;border-left:3px solid #d93636;'
                       f'font-size:13px;color:#7a1c1c;line-height:19px;"><b>What to do:</b> {escape(ai["action_note"])}</td></tr>'
                       '<tr><td style="height:8px;line-height:8px;font-size:0;">&nbsp;</td></tr>')
    change_html = (f'<div style="{_FONT}font-size:12px;color:#03558c;font-weight:600;padding-top:6px;">{escape(change)}</div>'
                   if change else "")
    more = item.get("more_info_url")
    links = f'<a href="{escape(item["url"])}" style="color:#4f2fd6;font-weight:600;text-decoration:none;">Read on Microsoft &rarr;</a>'
    if more and more != item["url"]:
        links += f' &nbsp;·&nbsp; <a href="{escape(more)}" style="color:#4f2fd6;text-decoration:none;">More info</a>'
    links += f' &nbsp;·&nbsp; <a href="{escape(_item_link(item))}" style="color:#6b7280;text-decoration:none;">View in tracker</a>'

    return f"""
<tr><td style="padding:0 0 14px 0;">
 <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #e6e3f0;border-left:4px solid {color};border-radius:8px;background:#ffffff;">
  <tr><td style="padding:14px 16px 4px 16px;">{' '.join(pills)}</td></tr>
  <tr><td style="{_FONT}padding:6px 16px 0 16px;font-size:16px;line-height:22px;font-weight:700;color:#1b1530;">
   <a href="{escape(item['url'])}" style="color:#1b1530;text-decoration:none;">{escape(item['title'])}</a>{change_html}</td></tr>
  <tr><td style="{_FONT}padding:6px 16px 10px 16px;font-size:14px;line-height:21px;color:#3b3650;">{escape(summary)}</td></tr>
  {f'<tr><td style="padding:0 16px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">{action_html}</table></td></tr>' if action_html else ''}
  <tr><td style="{_FONT}padding:0 16px 6px 16px;font-size:12px;line-height:18px;color:#6b7280;">{' &nbsp;·&nbsp; '.join(meta)}</td></tr>
  <tr><td style="{_FONT}padding:2px 16px 14px 16px;font-size:13px;">{links}</td></tr>
 </table>
</td></tr>"""


def _stat_cell(value: int, label: str, color: str) -> str:
    return (f'<td align="center" width="25%" style="{_FONT}padding:12px 4px;">'
            f'<div style="font-size:28px;line-height:32px;font-weight:800;color:{color};">{value}</div>'
            f'<div style="font-size:11px;line-height:15px;color:#6b7280;text-transform:uppercase;letter-spacing:.5px;">{label}</div></td>')


def render_html(digest: dict, *, web: bool = False) -> str:
    names = digest["names"]
    stats = digest["stats"]
    title = f"Copilot & SharePoint AI updates — {week_label(digest)}"
    preheader = (f"{stats['available']} now available, {stats['new']} newly announced, "
                 f"{stats['actions']} needing action.")
    body: list[str] = []

    if digest["actions"]:
        rows = "".join(
            f'<tr><td style="{_FONT}padding:5px 0;font-size:14px;line-height:20px;color:#3b3650;">'
            f'<span style="color:#d93636;">&#9679;</span>&nbsp; <a href="{escape(e["item"]["url"])}" style="color:#1b1530;font-weight:600;text-decoration:none;">{escape(e["item"]["title"])}</a>'
            f' <span style="color:#6b7280;">— {escape(e["item"]["ai"].get("action_note") or ACTIONS[e["item"]["ai"]["action"]])}</span></td></tr>'
            for e in digest["actions"]
        )
        body.append(f"""
<tr><td style="padding:0 0 22px 0;">
 <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#fff7f5;border:1px solid #f6d5cf;border-radius:10px;">
  <tr><td style="{_FONT}padding:14px 18px 4px 18px;font-size:15px;font-weight:800;color:#a61b1b;">&#9888;&#65039; Needs attention this week</td></tr>
  <tr><td style="padding:2px 18px 12px 18px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">{rows}</table></td></tr>
 </table>
</td></tr>""")

    for key, heading, blurb in SECTIONS:
        entries = digest["sections"][key]
        if not entries:
            continue
        body.append(f"""
<tr><td style="{_FONT}padding:8px 0 10px 0;">
 <div style="font-size:20px;line-height:26px;font-weight:800;color:#1b1530;">{escape(heading)} <span style="color:#8b84a6;font-weight:600;">({len(entries)})</span></div>
 <div style="font-size:13px;line-height:18px;color:#6b7280;">{escape(blurb)}</div>
</td></tr>""")
        body.extend(_item_html(e, names) for e in entries)

    for group in digest["horizon"]:
        rows = "".join(
            f'<tr><td style="{_FONT}padding:4px 0;font-size:13px;line-height:19px;color:#3b3650;">'
            f'<span style="color:{PRODUCT_COLORS.get(i["product"], "#555")};">&#9632;</span>&nbsp; '
            f'<a href="{escape(i["url"])}" style="color:#3b3650;text-decoration:none;">{escape(i["title"])}</a></td></tr>'
            for i in group["items"][:12]
        )
        extra = len(group["items"]) - 12
        more = (f'<tr><td style="{_FONT}padding:6px 0 0 0;font-size:13px;"><a href="{site_url()}" style="color:#4f2fd6;text-decoration:none;">+ {extra} more in the tracker &rarr;</a></td></tr>'
                if extra > 0 else "")
        body.append(f"""
<tr><td style="padding:8px 0 18px 0;">
 <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f6f4ff;border-radius:10px;">
  <tr><td style="{_FONT}padding:14px 18px 2px 18px;font-size:15px;font-weight:800;color:#1b1530;">&#128301; On the horizon: targeted for {escape(group['label'])} ({len(group['items'])})</td></tr>
  <tr><td style="padding:4px 18px 14px 18px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">{rows}{more}</table></td></tr>
 </table>
</td></tr>""")

    if not digest["total"]:
        body.append(f'<tr><td style="{_FONT}padding:20px 0;font-size:15px;color:#3b3650;">A quiet week: Microsoft published no changes to tracked products.</td></tr>')

    view_online = (f'<a href="{site_url()}digests/{digest["start"]}.html" style="color:#d9d2ff;text-decoration:underline;">View in browser</a>'
                   if not web else "")
    return f"""<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light"><meta name="supported-color-schemes" content="light">
<title>{escape(title)}</title></head>
<body style="margin:0;padding:0;background:#f1eff8;">
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">{escape(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f1eff8;">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="640" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:640px;">
 <tr><td bgcolor="#3b1fa8" style="background:#3b1fa8;background-image:linear-gradient(135deg,#2a1380 0%,#5b2fe0 55%,#0f8a7e 100%);border-radius:14px 14px 0 0;padding:28px 28px 24px 28px;">
  <div style="{_FONT}font-size:12px;letter-spacing:1.5px;text-transform:uppercase;color:#cfc6ff;font-weight:700;">Weekly briefing &nbsp;·&nbsp; {escape(week_label(digest))}</div>
  <div style="{_FONT}font-size:28px;line-height:34px;font-weight:800;color:#ffffff;padding-top:8px;">Copilot &amp; SharePoint AI updates</div>
  <div style="{_FONT}font-size:14px;line-height:20px;color:#e4e0ff;padding-top:6px;">Microsoft 365 Copilot · Copilot Chat · Copilot Studio · SharePoint AI</div>
  <div style="{_FONT}font-size:12px;padding-top:12px;">{view_online}</div>
 </td></tr>
 <tr><td style="background:#ffffff;border-bottom:1px solid #ece9f5;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
   {_stat_cell(stats['available'], 'Now available', '#146c34')}
   {_stat_cell(stats['new'], 'Newly announced', '#5b2fe0')}
   {_stat_cell(stats['timeline'], 'Date changes', '#03558c')}
   {_stat_cell(stats['actions'], 'Need action', '#d93636')}
  </tr></table>
 </td></tr>
 <tr><td style="background:#faf9fe;padding:22px 22px 8px 22px;border-radius:0 0 14px 14px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
   {''.join(body)}
  </table>
 </td></tr>
 <tr><td style="{_FONT}padding:18px 10px;font-size:12px;line-height:18px;color:#7b7591;text-align:center;">
  Sourced from the <a href="https://www.microsoft.com/microsoft-365/roadmap" style="color:#5b2fe0;">Microsoft 365 Roadmap</a> and official Microsoft blogs.
  Summaries are AI-assisted; always check the Microsoft source before acting.<br>
  <a href="{site_url()}" style="color:#5b2fe0;font-weight:600;">Open the interactive tracker</a> &nbsp;·&nbsp; <a href="{site_url()}digests/" style="color:#5b2fe0;">Past briefings</a>
 </td></tr>
</table>
</td></tr></table>
</body></html>"""


# ---------------------------------------------------------------- plain text

def render_text(digest: dict) -> str:
    names = digest["names"]
    lines = [f"COPILOT & SHAREPOINT AI UPDATES — {week_label(digest)}", ""]
    s = digest["stats"]
    lines.append(f"{s['available']} now available · {s['new']} newly announced · {s['timeline']} date changes · {s['actions']} need action")
    lines.append(f"Interactive tracker: {site_url()}")
    lines.append("")
    if digest["actions"]:
        lines += ["NEEDS ATTENTION", "-" * 15]
        for e in digest["actions"]:
            ai = e["item"]["ai"]
            lines.append(f"* {e['item']['title']} — {ai.get('action_note') or ACTIONS[ai['action']]}")
        lines.append("")
    for key, heading, _ in SECTIONS:
        entries = digest["sections"][key]
        if not entries:
            continue
        lines += [f"{heading.upper()} ({len(entries)})", "-" * (len(heading) + 5)]
        for e in entries:
            item, ai = e["item"], e["item"].get("ai") or {}
            tag = names.get(item["product"], item["product"])
            status = f" | {item['status']}" if item["kind"] == "feature" else ""
            lines.append(f"* [{tag}{status}] {item['title']}")
            change = " · ".join(filter(None, (_change_text(ev) for ev in e["events"] if ev["type"] != "new")))
            if change:
                lines.append(f"  {change}")
            lines.append(f"  {ai.get('summary') or item.get('description', '')[:280]}")
            if ai.get("action_note"):
                lines.append(f"  What to do: {ai['action_note']}")
            lines.append(f"  {item['url']}")
            lines.append("")
    for group in digest["horizon"]:
        lines.append(f"ON THE HORIZON — targeted for {group['label']}: {len(group['items'])} features")
        lines += [f"* {i['title']}" for i in group["items"][:12]]
        lines.append("")
    lines.append("Sourced from the Microsoft 365 Roadmap and official Microsoft blogs. Summaries are AI-assisted; check the source before acting.")
    return "\n".join(lines)


def subject(digest: dict) -> str:
    s = digest["stats"]
    bits = []
    if s["available"]:
        bits.append(f"{s['available']} now available")
    if s["new"]:
        bits.append(f"{s['new']} new")
    if s["actions"]:
        bits.append(f"{s['actions']} need action")
    tail = ", ".join(bits) if bits else "quiet week"
    return f"Copilot & SharePoint AI updates · {week_label(digest)} · {tail}"


# ---------------------------------------------------------------- archive

def archive(digest: dict) -> str:
    """Write digests/<start>.html and update digests/index.json; returns the HTML path."""
    DIGESTS_DIR.mkdir(exist_ok=True)
    path = DIGESTS_DIR / f"{digest['start']}.html"
    path.write_text(render_html(digest, web=True), encoding="utf-8")
    index_path = DIGESTS_DIR / "index.json"
    old = load_json(index_path, [])
    previous = next((d for d in old if d["start"] == digest["start"]), {})
    index = [d for d in old if d["start"] != digest["start"]]
    index.append({
        **({"sent_at": previous["sent_at"]} if previous.get("sent_at") else {}),
        "start": digest["start"],
        "end": digest["end"],
        "label": week_label(digest),
        "subject": subject(digest),
        "stats": digest["stats"],
        "total": digest["total"],
    })
    index.sort(key=lambda d: d["start"], reverse=True)
    save_json(index_path, index)
    return str(path)


def already_sent(digest: dict) -> bool:
    index = load_json(DIGESTS_DIR / "index.json", [])
    return any(d["start"] == digest["start"] and d.get("sent_at") for d in index)


def mark_sent(digest: dict) -> None:
    index_path = DIGESTS_DIR / "index.json"
    index = load_json(index_path, [])
    for d in index:
        if d["start"] == digest["start"]:
            d["sent_at"] = utcnow().isoformat(timespec="seconds")
    save_json(index_path, index)
