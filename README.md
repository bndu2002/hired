# Hired

A local, zero-cost personal agent that gets me referrals for jobs I'd be a strong fit for. Mirrors Uplers' Happy Agent UX, keeps my real LinkedIn account safe, and surfaces human-in-the-loop only where my judgment improves the outcome.

**Status:** Planning complete. Build starts at Phase 0 → see [`.kiro/specs/hired/tasks.md`](.kiro/specs/hired/tasks.md).

---

## What it does

- **Scrapes jobs** from my Happy Agent inbox (filtered by my profile) via a Chrome extension.
- **Discovers contacts** at each hiring company via Google X-ray search (SerpAPI).
- **Finds and verifies emails** (Hunter + Reoon), only sends to verified addresses.
- **Drafts outreach** using static templates with variable substitution (Gemini only for reply classification, not drafting).
- **Dispatches Gmail** in the background after I pick who to contact in a review modal.
- **Queues LinkedIn** actions for one-click human send (no scripted LinkedIn traffic — my real account stays clean).
- **Tracks replies** and auto-classifies sentiment + intent, so I know what to follow up on.

Daily cap: 4 jobs × up to 8 contacts. Daily time cost target: ≤ 15 min of my attention.

---

## Repository layout

```
hired/
├── .kiro/
│   ├── specs/hired/           source of truth for what and how
│   │   ├── requirements.md    scope, user stories, success criteria
│   │   ├── design.md          architecture, data model, interfaces
│   │   └── tasks.md           6-day phased build plan
│   └── steering/
│       └── coding-standards.md    style and testing conventions
├── apps/
│   ├── server/                Node + Express + TypeScript backend
│   ├── web/                   React + Tailwind dashboard
│   └── extension/             Chrome MV3 extension
├── packages/
│   └── shared-types/          types used across server/web/extension
├── docs/                      long-form docs built up during the build
├── Personal Referral Outreach Agent — Implementation Blueprint (1).md
│                              v2 blueprint, frozen reference
└── README.md                  you are here
```

---

## Quickstart

### Prerequisites

- Node.js 20 LTS
- pnpm 9+
- PostgreSQL 15+ (running locally)
- Chrome (dev profile recommended)

### First-time setup

Follow [`tasks.md § Phase 0`](.kiro/specs/hired/tasks.md) to register API keys (all free tier):

- Google Cloud Console (Gmail + Gemini)
- SerpAPI (250 searches/mo, no card required)
- Hunter.io (50 credits/mo)
- Reoon (600 verifications/mo)

Then from the workspace root:

```bash
# Install
pnpm install

# Copy env, fill in keys and shared secret
cp .env.example .env
openssl rand -hex 32   # paste into .env as SHARED_SECRET

# Create DB
psql -U postgres -c "CREATE USER hired WITH PASSWORD 'hired';"
psql -U postgres -c "CREATE DATABASE hired OWNER hired;"
pnpm --filter server migrate

# Boot
pnpm --filter server dev    # localhost:4000
pnpm --filter web dev        # localhost:5173
pnpm --filter extension build # loads from apps/extension/dist in Chrome
```

### Daily use (once v1 ships)

1. Open Happy Agent in Chrome → click "Sync to Hired" button → jobs land in the dashboard.
2. Open the Hired dashboard (`localhost:5173`) → pick 4 jobs → Run Agent on each.
3. For each run: review discovered contacts in the modal, uncheck anyone who looks wrong, click Send.
4. Open LinkedIn Queue once a day → process pending Connects and DMs (one click per contact).
5. Check Responses tab for replies. Mark the ones that led to interviews.

Expected daily cost: ≤ 15 min total.

---

## Architecture at a glance

Three processes, one local server:

- **Chrome extension** scrapes jobs from Happy Agent and assists LinkedIn actions.
- **React dashboard** at `localhost:5173` is where I run the agent and review activity.
- **Node server** at `127.0.0.1:4000` owns Postgres, Gmail OAuth, and all third-party API calls.

The server has three pluggable interfaces — `DiscoverySource`, `EmailFinder`, `EmailVerifier` — so providers rotate as free tiers deplete without changing the orchestrator. See [`design.md § 7-8`](.kiro/specs/hired/design.md).

Append-only `events` table is the source of truth; `contacts.*_status` columns are derived caches. See [`design.md § 5-6`](.kiro/specs/hired/design.md).

---

## Key constraints

- **No scripted clicks on LinkedIn.** All Connect and DM sends are human. See [`design.md § D1`](.kiro/specs/hired/design.md).
- **No sends to unverified emails.** Reoon gate before every Gmail dispatch.
- **4 runs/day cap**, server-enforced.
- **Local only**: server binds to `127.0.0.1`, shared-secret header required for all API calls.
- **$0 cost**: all providers on free tiers at integration time.

---

## Where to go next

- First time? Read [`requirements.md`](.kiro/specs/hired/requirements.md) → [`design.md`](.kiro/specs/hired/design.md) → [`tasks.md`](.kiro/specs/hired/tasks.md) in that order.
- Building? Start at [`tasks.md § Phase 0`](.kiro/specs/hired/tasks.md).
- Writing code? Read [`coding-standards.md`](.kiro/steering/coding-standards.md) first — it's short and shapes every file.
- Confused by a decision? Each is numbered (`D1`, `D2`…) and referenced throughout. Grep for the number.

---

## Not in v1

Deferred to v2+ (see [`requirements.md § 5`](.kiro/specs/hired/requirements.md)):
Resume tailoring · Auto-reply · Automated follow-ups · Reminder Alerts tab · Scheduled runs · Additional provider adapters beyond the first per interface · Blocked Companies list · LinkedIn reply polling

---

Personal use. Not a product. Not a hosted service. Written to help one person (me) get interviews, with code that someone else could read and understand.
