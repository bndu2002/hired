# Hired — Requirements (v1)

> **Status:** Final · **Owner:** Vandana (single user, personal use) · **Supersedes:** `Personal Referral Outreach Agent — Implementation Blueprint (1).md` (kept as reference). This document is the source of truth for *what* v1 does and does not do. The *how* lives in `design.md`.

---

## 1. The problem I'm solving

I want referrals for jobs that match my profile. Doing this by hand at useful volume is slow — finding the right person at each hiring company, drafting outreach that reads as human and specific, tracking who replied with what, following up. I want to automate the mechanical parts (discovery, templating, dispatch, status tracking) and keep *myself* in the loop only at the moments where my judgment actually improves the outcome (which contacts to approach, whether to click Send on a LinkedIn request).

The output I care about is **real human responses from recruiters/engineering leaders that lead to interviews** — not volume of messages sent.

## 2. Reference product

Uplers' **Happy Agent** (`platform.uplers.com/talent/job-agent/...`) is the UX and functional reference. The hired agent mirrors its interaction model (job browser → Run Agent → multi-contact outreach → tracked activity → reply classification) as closely as possible while diverging on one load-bearing decision: **we do not scripted-click LinkedIn on my real account**. See `design.md § Decision Record D1` for the detail.

## 3. Success criteria

| Metric | Target | How we'll know |
|---|---|---|
| My time per day | ≤ 15 min of attention | Timed self-check during week 1 |
| First human reply to outreach | By day 4-5 of use | Reply visible in Responses tab |
| First interview conversation | By day 6 of use | Activity row manually moved to Interviews |
| Daily referral runs | 4 jobs · 1-8 contacts each | Server-enforced cap |
| Scripted LinkedIn traffic from real account | Zero | Code review of extension content scripts |
| Email sends to unverified addresses | Zero | Verifier gate in orchestrator |
| Build cost | $0 | All providers on free tiers at integration time |

## 4. User stories

Written in first person because v1 has one user.

### Job sourcing

- I browse jobs on Happy Agent itself — it already filters by my profile and recency, I'm not going to rebuild that. The **Hired** Chrome extension is loaded but adds nothing to Happy's UI.
- When I find a job worth pursuing, I press **Alt+H**. The extension's content script reads the focused job detail pane (title, company, URL, description, skills, metadata) and POSTs it to my local server. The server upserts one `jobs` row (deduped by `job_url`). A brief toast confirms the capture.
- Only jobs I explicitly Alt+H'd end up in my local DB. Thousands of jobs I just scrolled past stay on Happy, not in my Postgres.
- Paste-job-link flow (for jobs not on Happy) is deferred to v2.

### Running the agent

- I click **Run Agent** on a job card. A modal opens.
- The modal first shows channel checkboxes (Gmail, LinkedIn). I pick one or both.
- The modal then runs discovery (SerpAPI X-ray) and email finding (Snov) and email verification (Reoon) in the background and populates with up to 8 discovered contacts.
- For each contact the modal shows: name, title, tenure signal (if available), email with verification state, LinkedIn URL. Each contact has two channel pills (`[Gmail] [LinkedIn]`) that I can toggle individually.
- Contacts default to selected if they look clean (verified email, matching role). Unverified / likely-ex-employee / role-mismatch contacts default to unchecked.
- I review, uncheck anyone who looks wrong, click **Send to N contacts**.

### After Send

- Gmail-eligible selections dispatch immediately in the background. Each send stores its `thread_id`.
- LinkedIn-eligible selections become drafts in the **LinkedIn Queue** (new nav item). A toast tells me how many are waiting.
- I can close the modal and keep working. The Run Agent flow is non-blocking from this point.

### LinkedIn Queue (two-stage per contact — Flow B)

Flow B matches Happy Agent's canonical behavior: **bare connection request first, full referral template as a DM once the connection is accepted.**

- I open **LinkedIn Queue**. Two tabs: **Connect** (fresh requests) and **DM** (acceptances needing a referral template).
- **Connect tab**: for each contact, extension opens the profile in a dedicated panel, pre-fills the bare connection request (no custom note per Happy's observed behavior), and highlights the Send button. I press Alt+Enter → it registers my click (via the content script detecting the sent-state DOM change) → advances to the next contact. Typical batch of 16 takes 5-8 minutes.
- **DM tab**: once a day, the Gmail inbound poll detects LinkedIn's "X accepted your invitation" notification emails. Those contacts auto-populate here with their drafted DM (the full referral template, variable-substituted). Same Alt+Enter flow — I open each thread, send with one click, advance.
- The LinkedIn Queue only shows things I can act on *right now*. Nothing stays there after I've sent.

### Tracking

- **My Activity** shows a table of runs: company, role, status (COMPLETED / IN_PROGRESS / FAILED), last-activity timestamp. Each row expands to show the 1-8 contacts I actually reached out to and their per-channel status.
- **Responses** tab shows the same data but filtered to jobs where replies came in, grouped by job, with per-reply sentiment (Positive / Negative) and intent (free-form string classified by Gemini — e.g., "Agreed to refer", "Declined due to onsite requirement"). Each reply has a "View thread" link that opens the Gmail thread or LinkedIn DM.
- **Interviews** tab lists activity rows I manually marked as "I got an interview from this." No auto-classification in v1.

### Configure

- **Message Templates** sub-tab: edit my Gmail and LinkedIn templates with `{{outreachEmployeeName}} / {{jobTitle}} / {{companyName}} / {{jobLink}}` placeholders. Rich-text editor. No per-contact AI rewrites — templates are static with variable substitution.
- **Connected Accounts** sub-tab: Gmail OAuth setup (one-time).
- Everything else (Auto Reply, Follow-up Settings, Auto Run, Outreach Mode, Browser Extension, Blocked Companies) is deferred — behavior is hardcoded to sensible defaults in v1.

### Daily rhythm

A full day of me using the tool should look like: open dashboard (0.5 min) → pick 4 jobs, Run Agent on each with modal review (~8 min total) → open LinkedIn Queue once (~5 min batch) → check Responses for new replies, manually move anything that turned into an interview (~1-2 min). Total ≤ 15 min.

## 5. Scope

### In scope (v1)

- **On-demand** job capture from Happy Agent via Chrome extension — one job at a time, triggered by `Alt+H` hotkey on the focused job detail
- Chrome extension with **stealth model**: zero DOM injection on Happy, closed-Shadow-DOM toast feedback, one-time shared-secret entry via popup, background service worker as fetch proxy
- Discovery (`DiscoverySource` pluggable interface, SerpAPI X-ray as the day-1 adapter)
- Email finder (`EmailFinder` pluggable interface, Snov as the day-1 adapter, `PatternHeuristicFinder` as the fallback)
- Email verifier (`EmailVerifier` pluggable interface, Reoon as the day-1 adapter)
- Gmail OAuth2, outbound send with thread tracking, inbound 15-min poll
- Gemini for template variable substitution and reply intent classification
- Dashboard: Run Agent modal, My Activity, Responses, LinkedIn Queue, Configure (Templates + Connected Accounts only)
- LinkedIn **assist mode**: pre-fill actions, human clicks, log sent-state
- Daily cap: 4 referral runs, 1-8 contacts per job (user picks within the modal)
- Append-only `events` table as source of truth; `contacts.*_status` columns are derived caches

### Explicitly out of scope (v1)

- Scripted-automated clicking of LinkedIn Connect or DM Send (violates D1)
- Dashboard **Jobs browser** page — Happy Agent itself is the catalog browser; our dashboard shows only jobs we've acted on (via My Activity)
- Batch sync of Happy Agent's job list — we persist only jobs explicitly captured via Alt+H
- Paste-job-link flow (deferred — would be v2; the extension hotkey covers 95%+ of use)
- Dead-scrape alarm — no batch means no empty-sync-detection to do
- Auto-reply to inbound messages
- Auto-generated follow-up messages (first touch only in v1)
- Resume tailoring per job (deferred — would be v2)
- Reminder Alerts activity tab (deferred — would be v2)
- Auto-run / scheduled daily runs (manual trigger only in v1)
- Multi-user / multi-tenant features
- Mobile UI
- Blocked Companies list

### Deferred to v2+

- Automated follow-up CRON (threaded 3-business-day nudges)
- Additional discovery / finder / verifier plugs (Serply, Scrapfly, Snov, Prospeo, ZeroBounce, MillionVerifier) — the pluggable boundary exists in v1; adapters land as free tiers of day-1 providers deplete. **Apollo is explicitly not in the roster** (per owner decision).
- Resume tailoring per job description
- Reminder Alerts
- Shorter-latency LinkedIn acceptance detection (beyond Gmail notification polling)
- Burner-account LinkedIn scraper (last-resort fallback)
- Configure sub-tabs beyond Templates + Connected Accounts
- Outreach Mode persistent default (currently chosen per-run)

## 6. Hard constraints

- **D1 (LinkedIn safety).** No scripted clicks on my real LinkedIn account. All Connect sends and DM sends go through a Chrome-extension-mediated assist flow where I personally click. Content scripts may read DOM (to detect sent-state) and write DOM (to pre-fill text), but may not dispatch `click()` on action buttons.
- **D2 (Verified-only email).** No Gmail send to an address that didn't come back `VALID` from the verifier. Unverifiable contacts fall back to the LinkedIn branch; if LinkedIn isn't selected for them, they're dropped.
- **D3 (Append-only events).** No `UPDATE` or `DELETE` on the `events` table, ever. Status columns on `contacts` are caches, recomputable from `events`.
- **D6 (Daily cap).** 4 jobs/day enforced server-side; the 5th call to `/api/agent/run` returns a graceful 429-equivalent with a "resumes tomorrow" message. Contacts-per-job ceiling is 8, user-selectable down to 1.
- **Zero cost.** All third-party integrations on free tiers at the time of integration; graceful quota-exhaustion handling with alerts in the dashboard.
- **Local only.** The server binds to `127.0.0.1`. Shared-secret header required for extension → server calls. No outbound connections except to Gmail, Gemini, SerpAPI, Snov, Reoon.
- **No PII in logs.** Logs reference contacts by internal ID, not name/email. The event payload may store identifying data because it's part of the data model.

## 7. Acceptance criteria for v1 completion

The build is "done" (v1 shipped) when all of these pass:

- [ ] Alt+H on a focused Happy Agent job detail inserts one `jobs` row with full metadata (title, company, URL, description, skills, happy_job_id, experience_range, location_hint, posted_hint). Re-pressing Alt+H on the same job returns `isNew: false` and refreshes the row in place.
- [ ] The Chrome extension injects nothing into Happy's DOM until Alt+H is pressed. The confirmation toast is rendered inside a closed Shadow DOM.
- [ ] Run Agent on a job opens the modal, discovery runs, discovered contacts appear with verification signals, I can select/deselect and toggle per-contact channels, Send dispatches correctly.
- [ ] Verified-email selections send via Gmail API with `thread_id` stored. Unverified selections never hit Gmail.
- [ ] LinkedIn selections create drafts in the LinkedIn Queue → Connect tab. Alt+Enter flow works. Sent-state is detected and logged.
- [ ] Gmail poll (15 min) detects LinkedIn's "accepted invitation" emails and moves affected contacts into the LinkedIn Queue → DM tab with a drafted referral message. DM Send flow works the same way.
- [ ] Replies arriving in Gmail are intent-classified by Gemini into `{Positive, Negative}` + a free-form intent label. Contact row updates.
- [ ] My Activity table renders per-job rows with expandable per-contact detail. Responses tab filters correctly. Interviews tab accepts manual moves.
- [ ] 4-run daily cap enforced; UI shows `N/4 today` counter. 5th run attempt is blocked with a clear message.
- [ ] Every state transition writes an `events` row with a non-null `event_type` and useful `payload`. A `SELECT * FROM events WHERE contact_id = X` tells me the full history.
- [ ] All adapter interfaces (`DiscoverySource`, `EmailFinder`, `EmailVerifier`) have ≥ 1 implementation + a unit test suite exercising the interface contract.
- [ ] First batch of outreach can be sent within 2 calendar days of starting the build.
- [ ] A reader who's never seen the project can run `README.md`'s quickstart and have the dashboard open on their machine within 10 minutes.

## 8. Open items (resolved during build)

These require real-world calibration and will be adjusted as we go, not blocking:

- Exact SerpAPI X-ray query patterns (will iterate on precision/recall across the first 10 jobs).
- Scoring weights for the modal's default-select heuristic (verified email + role match + tenure 6mo-5yr → default checked).
- Gemini prompt wording for intent classification (will tune on real reply data from week 1).
- LinkedIn template short form for connection-note scenarios (currently out of scope in Flow B but may surface as fallback).

## 9. Related documents

- **`design.md`** — technical design, folder structure, schemas, flows, testing strategy
- **`tasks.md`** — phased build plan (6 days to first-interview target)
- **`.kiro/steering/coding-standards.md`** — style, naming, testing, docs conventions
- **`Personal Referral Outreach Agent — Implementation Blueprint (1).md`** — v2 blueprint, kept as reference (not editable; frozen)
