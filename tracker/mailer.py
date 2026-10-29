"""Send the digest through Gmail SMTP.

Environment:
  GMAIL_ADDRESS        the sending Gmail account
  GMAIL_APP_PASSWORD   a Google "App password" (needs 2-Step Verification on the account)
  DIGEST_TO            comma-separated visible recipients — ideally one Outlook distribution list
  DIGEST_BCC           optional comma-separated hidden recipients
  DIGEST_FROM_NAME     optional display name (default "Copilot Update Tracker")
"""

from __future__ import annotations

import os
import smtplib
import ssl
from email.message import EmailMessage
from email.utils import formataddr, make_msgid


def _split(value: str | None) -> list[str]:
    return [a.strip() for a in (value or "").replace(";", ",").split(",") if a.strip()]


def send(subject: str, html: str, text: str, *, to: list[str] | None = None) -> list[str]:
    sender = os.environ.get("GMAIL_ADDRESS", "").strip()
    password = os.environ.get("GMAIL_APP_PASSWORD", "").replace(" ", "")
    if not sender or not password:
        raise SystemExit("Email not configured: add the GMAIL_ADDRESS and GMAIL_APP_PASSWORD repository secrets")
    to_list = to if to is not None else _split(os.environ.get("DIGEST_TO"))
    bcc_list = [] if to is not None else _split(os.environ.get("DIGEST_BCC"))
    if not to_list and not bcc_list:
        raise SystemExit("No recipients: set DIGEST_TO and/or DIGEST_BCC")

    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = formataddr((os.environ.get("DIGEST_FROM_NAME") or "Copilot Update Tracker", sender))
    msg["To"] = ", ".join(to_list) if to_list else sender
    msg["Message-ID"] = make_msgid(domain=sender.split("@")[-1])
    msg.set_content(text)
    msg.add_alternative(html, subtype="html")

    recipients = to_list + bcc_list
    with smtplib.SMTP_SSL("smtp.gmail.com", 465, context=ssl.create_default_context(), timeout=60) as smtp:
        smtp.login(sender, password)
        smtp.send_message(msg, to_addrs=recipients)
    return recipients
