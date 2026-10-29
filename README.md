# Copilot Radar

Tracks every change to **Microsoft 365 Copilot, Copilot Chat, Copilot Studio and SharePoint AI** from Microsoft's own sources, then publishes:

- **A GitHub Pages site**:
  - The homepage has a 3D carousel with one animated card per product, showing three numbers only: changes this week, rolling out now, needs action.
  - Each card opens a **topic page** listing that product's updates in priority order: needs action, this week, rolling out now, coming soon, recently launched, blog posts.
  - Both pages end with the full searchable list: a feed grouped by week, a status board (In development → Rolling out → Launched), a release timeline by GA month, and a full history for every item.
- **A weekly email briefing** every Monday covering the previous Monday–Sunday: what needs action, what's now available, what's newly announced, date changes, Microsoft blog posts, and what's targeted for next month. Every item links back to Microsoft.
- **An RSS feed** (`feed.xml`) for anyone who wants updates in Outlook, Teams or a feed reader.

## Sources

| Source | What it gives us |
| --- | --- |
| [Microsoft 365 Roadmap](https://www.microsoft.com/microsoft-365/roadmap) public API | The main source. Structured features with status, preview and GA dates, platforms and clouds. The tracker compares each daily snapshot with the last one, so it catches **status moves and date slips**, not only new items. |
| Official Microsoft blogs (RSS): Microsoft 365/Copilot, Copilot Studio, SharePoint, plus the Tech Community Copilot, Copilot Studio and SharePoint blogs | Announcements and the monthly "What's new" posts. |

Scope rules live in [`config/sources.json`](config/sources.json):
- SharePoint items are kept only when they involve Copilot or AI.
- Copilot Chat items are split out from Microsoft 365 Copilot.
- Dynamics 365, Dataverse and Power Pages items are dropped. Microsoft tags many of them as "Microsoft 365 Copilot".

Message Center is not used. It needs tenant admin credentials and holds tenant-internal content, so it doesn't belong on a public site.

## How it runs

One GitHub Actions workflow, [`.github/workflows/tracker.yml`](.github/workflows/tracker.yml):

- **Daily (05:17 UTC)**: fetch sources → detect changes → write AI summaries for new or changed items → commit `data/` → deploy the site.
- **Mondays (06:43 UTC)**: the daily steps, then archive last week's briefing to `digests/`, deploy, and email it. If a run is repeated, the email isn't sent twice.

## Setup

### 1. Turn on GitHub Pages
**Settings → Pages → Build and deployment → Source: GitHub Actions.**

### 2. Gmail sending
1. Turn on 2-Step Verification for the Gmail account.
2. Create an **App password** at <https://myaccount.google.com/apppasswords>.
3. Add these repository secrets (**Settings → Secrets and variables → Actions → Secrets**):

| Secret | Value |
| --- | --- |
| `GMAIL_ADDRESS` | the Gmail address |
| `GMAIL_APP_PASSWORD` | the 16-character app password |
| `DIGEST_TO` | recipients, comma-separated. A single **Outlook distribution list** address is best: people join and leave in Outlook with no repo change. |
| `DIGEST_BCC` | *(optional)* hidden recipients |

> **Getting it into inboxes.** Mail from an outside Gmail address can land in Junk or be tagged `[External]`. Ask your Exchange admin to add the sender to the allowed senders list (or a transport rule). Otherwise, ask recipients to mark the first email *Not junk*. Gmail allows about 500 recipients a day, which is plenty when you send to one distribution list.

### 3. AI summaries (optional)
Without a key, the tracker uses Microsoft's own wording and rule-based tags. To turn on AI summaries with Gemini's free tier:

- Secret `GEMINI_API_KEY`: get one at <https://aistudio.google.com/apikey>
- *(optional)* Variable `GEMINI_MODEL`, default `gemini-flash-latest`

Each item is summarised once. It's summarised again only if Microsoft changes its text. The first run handles the 200 most recent items (`AI_MAX_ITEMS`); later runs work through the rest.

**Switching to AWS Bedrock later**: set variables `AI_PROVIDER=bedrock`, `BEDROCK_MODEL_ID` (any model with Bedrock's Converse API), `AWS_REGION`, and `AWS_ROLE_ARN`, an IAM role trusted for GitHub OIDC with `bedrock:InvokeModel`. No code changes are needed. Items summarised by Gemini keep their summaries.

### 4. Optional variables
| Variable | Purpose |
| --- | --- |
| `SITE_URL` | Public site URL used in emails. Default `https://jayasekhon.github.io/Microsoft-Updates-Tracker/` |
| `DIGEST_FROM_NAME` | Sender display name. Default "Copilot Update Tracker" |

### 5. Test it
**Actions → Tracker → Run workflow**:
- Leave the boxes empty to refresh the data and the site.
- Fill in **test_to** with your own address to get a `[TEST]` briefing that only you receive.
- Tick **send_digest** to send last week's briefing to everyone now.

## Running locally

Python 3.10+ with only the standard library (`boto3` is needed only for Bedrock).

```bash
python -m tracker update            # fetch + detect changes (+ AI if GEMINI_API_KEY is set)
python -m tracker update --no-ai    # rule-based summaries only
python -m tracker digest --preview preview.html   # render last week's briefing to a file
python -m tracker build && python -m http.server -d _site 8000
python -m unittest discover -s tests -t .
```

## Layout

```
config/sources.json     products, scope rules, feeds
tracker/                Python pipeline (sources, change detection, AI, digest, mailer)
site/                   static website (no build step): index.html (home), topic.html?p=<product>,
                        assets/core.js (shared), browser.js (full list), home.js, topic.js, art.js (illustrations)
data/items.json         full store with every item's event history (committed daily)
data/site.json          compact payload the website loads
digests/                archived weekly briefings
```
