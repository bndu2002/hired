# **Personal Referral Outreach Agent — Implementation Blueprint**

An end-to-end specification for building a zero-cost local automation agent that mirrors Uplers Happpy Agent. The system uses **Uplers** as a free job discovery engine, **Google Gemini API** for message tailoring, **Gmail API** for email dispatch, and a **custom Chrome Extension** for automated LinkedIn networking.

## **Part 1: THE WHAT (Functional Specification)**

### **1\. Core Architecture Overview**

![][image1]

### **2\. Functional Capabilities Map**

| Module | Feature | System Behavior |
| :---- | :---- | :---- |
| **Job Sourcing** | Page Extraction | Extracts job titles, company names, URLs, descriptions, and tech stacks from platform.uplers.com via a Chrome Extension. |
|  | Automated Scroll | Programmatically scrolls lazy-loaded containers and clicks "Load More" buttons to parse complete job catalogs. |
| **Contact Discovery** | Employee Matching | Generates standard corporate email patterns (first.last@domain.com) and scrapes target LinkedIn profiles (HR, Engineering Managers, Leads) using free search queries. |
| **Outreach Dispatch** | Gmail Gateway | Populates personalized templates and dispatches emails via Nodemailer using personal Gmail OAuth2. |
|  | LinkedIn Automation | Executes automated connection requests with dynamic 300-character invitation notes via Manifest V3 Chrome Extension scripting. |
| **Tracking & Intent** | Activity Matrix | Displays job status logs (PENDING, EMAIL\_SENT, LINKEDIN\_CONNECTED, REPLIED). |
|  | LLM Classification | Parses incoming reply text via Gemini to assign intent tags (*"Agreed to refer"*, *"Declined due to onsite requirement"*, *"Interview scheduled"*). |
| **Follow-Up System** | Automated Nudges | Executes background CRON tasks to dispatch polite follow-up messages inside active Gmail threads after 3 business days of inactivity. |

## 

## 

## **Part 2: THE HOW (Technical Design & Stack)**

### **1\. Technology Stack (\$0 Cost)**

* **Frontend:** React, Tailwind CSS, Lucide Icons (Hosted locally)  
* **Backend:** Node.js, Express, TypeScript, pg (PostgreSQL client)  
* **Database:** Local PostgreSQL instance or Supabase Free Tier  
* **Browser Extension:** Chrome Extension Manifest V3 (JavaScript/TypeScript)  
* **AI & Email:** @google/generative-ai (Gemini API Free Tier), Nodemailer (Gmail OAuth2)

### **2\. Database Schema (PostgreSQL)**

SQL  
\-- Jobs Table  
CREATE TABLE jobs (  
    id SERIAL PRIMARY KEY,  
    company\_name VARCHAR(255) NOT NULL,  
    job\_title VARCHAR(255) NOT NULL,  
    job\_url TEXT NOT NULL,  
    job\_description TEXT,  
    created\_at TIMESTAMP DEFAULT CURRENT\_TIMESTAMP  
);

\-- Outreach Contacts Table  
CREATE TABLE outreach\_contacts (  
    id SERIAL PRIMARY KEY,  
    job\_id INT REFERENCES jobs(id) ON DELETE CASCADE,  
    contact\_name VARCHAR(255) NOT NULL,  
    contact\_title VARCHAR(255),  
    contact\_email VARCHAR(255),  
    linkedin\_url TEXT,  
    gmail\_status VARCHAR(50) DEFAULT 'PENDING',  \-- PENDING, SENT, REPLIED  
    linkedin\_status VARCHAR(50) DEFAULT 'PENDING', \-- PENDING, REQUEST\_SENT, CONNECTED  
    intent\_label VARCHAR(100),                     \-- e.g., 'Agreed to refer'  
    sentiment VARCHAR(20),                         \-- POSITIVE, NEGATIVE, NEUTRAL  
    gmail\_thread\_id VARCHAR(255),  
    last\_activity TIMESTAMP DEFAULT CURRENT\_TIMESTAMP  
);

\-- Daily Limits Tracking  
CREATE TABLE daily\_logs (  
    run\_date DATE PRIMARY KEY DEFAULT CURRENT\_DATE,  
    jobs\_processed INT DEFAULT 0  
);

### **3\. Step-by-Step Implementation Phase Plan**

#### **Phase 1: Database & Data Extraction (Days 1–2)**

> 1. Initialize local PostgreSQL database and execute table creation scripts.  
> 2. Build local Express server endpoints:  
   * POST /api/jobs/sync — Receive batch scraped job data.  
   * GET /api/jobs — Serve paginated list of ingested jobs to local React UI.  
> 3. Build Chrome Extension DOM scraper script:  
   * Inject content script into platform.uplers.com.  
   * Programatically trigger container scrolling to parse all dynamic job elements.  
   * Transmit extracted JSON payload to [http\://localhost:4000/api/jobs/sync](http://localhost:4000/api/jobs/sync).  
   * 

#### **Phase 2: Gmail Gateway & Contact Generation (Days 3–4)**

> 1. Configure Google Cloud Console OAuth 2.0 Credentials (Gmail API scope).  
> 2. Set up Nodemailer transport using OAuth refresh tokens.  
> 3. Implement candidate email generation logic (e.g., standard domain patterns verified via SMTP checks).  
> 4. Integrate Gemini API to hydrate templates dynamically:  
   * Endpoint POST /api/outreach/run triggered from local React UI.  
   * Generates email content, dispatches via Nodemailer, and stores Gmail threadId in PostgreSQL.  
   * 

#### **Phase 3: LinkedIn Browser Automation (Days 5–6)**

> 1. Extend Chrome Extension with background Service Worker (background.js):  
   * Listen for socket/polling triggers from Express backend for pending LinkedIn outreach tasks.  
> 2. Implement profile navigation logic:  
   * Open profile URL in active/background tab.  
   * Click "Connect" button via DOM query selectors.  
   * Populate custom connection note (max 300 characters).  
   * Enforce a 90–180 second randomized delay queue between tasks to prevent profile flags.  
   * 

#### **Phase 4: Activity Dashboard & Intent Engine (Days 7–8)**

> 1. Build React "My Activity" Dashboard:  
   * Display parent job listings with collapsible children (the 4 contacted employees per company).  
> 2. Build Gmail Inbound Monitoring CRON Job:  
   * Poll Gmail API every 15 minutes for unread messages linked to stored threadId values.  
   * Pass incoming email body text to Gemini API with an intent parsing prompt:  
     Plaintext  
     Classify the intent of this reply: \[AGREED\_TO\_REFER, DECLINED, ONSITE\_REQUIRED, INTERVIEW\_REQUEST\].  
     Return JSON: { "sentiment": "POSITIVE|NEGATIVE", "intent": "..." }

   * Update database record with extracted tags (*"Agreed to refer"*, *"Declined due to onsite requirement"*).

#### **Phase 5: Rate Limiting & Automated Follow-Up (Day 9\)**

> 1. Implement execution queue guardrails:  
   * Cap jobs to maximum 5 daily runs (up to 20 total outreach contacts per day).  
   * Enqueue excess requests for sequential processing on subsequent calendar days.  
> 2. Implement automated follow-up CRON:  
   * Select outreach records where gmail\_status \= 'SENT' and last\_activity \< NOW() \- INTERVAL '3 days'.  
   * Dispatch a friendly follow-up message within the target Gmail thread.

# **Personal Referral Outreach Agent — Blueprint v2 (FINAL)**

> **Status:** Closed / build-ready. This document supersedes the v1 draft. **Owner:** single user (personal use only — not a product, not multi-tenant). **Goal:** a zero-cost, local automation agent that helps *me* get referrals for jobs surfaced by my Uplers profile. It finds people at the hiring company, sends tailored outreach, tracks replies, classifies intent, and nudges follow-ups — with the UI/UX modeled on Uplers Happy Agent (which I'm used to).

---

## **0\. Reading guide**

Every major section is written as **WHAT / WHY / HOW** so the reasoning behind each decision is captured, not just the decision. Where v1 made a choice that was changed during design review, the change is called out explicitly under **Changed from v1**.

The single most important rule in this whole system, stated once up front:

> **LinkedIn safety model:** The *real* job-search account NEVER generates scripted traffic. Automated profile discovery runs ONLY on a separate, disposable "burner" account. All outreach from the real account is human-clicked (assist-mode). This split is the load-bearing design decision — everything else bends around it.

---

## **Part 1 — THE WHAT (Functional Specification)**

### **1.1 Scope (locked)**

**IN scope (v1):**

- Scrape job listings from `platform.uplers.com` (my own logged-in session).  
- Discover up to **4 contacts per company** via LinkedIn search on a **burner account**.  
- Send tailored email outreach via Gmail API — **only to verifiable addresses**.  
- Assist LinkedIn connection requests on my **real account** (agent drafts, I click).  
- Track every job → contact → action in an append-only event log.  
- Classify inbound replies (email \+ pasted LinkedIn) with Gemini.  
- Auto follow-up on **email** threads after 3 business days of silence.  
- Dashboard mirroring Uplers Happy Agent UX.

**OUT of scope (v1), with reason:**

- **Auto-clicking LinkedIn connect on the real account** — would void the safety model.  
- **Multi-user / queue infra / horizontal scale** — single user, 16 actions/day max.  
- **SMTP VRFY email guessing-and-sending** — unreliable, wrecks sender reputation.

**Deferred (v2+):**

- LinkedIn acceptance auto-detection beyond opportunistic DOM reads.  
- Automated LinkedIn follow-up messaging (no sanctioned API; stays assisted).  
- Swapping discovery to an Uplers-provided contact source if Uplers exposes one.

### **1.2 Hard caps (locked)**

| Cap | Value | Enforced where |
| :---- | :---- | :---- |
| Jobs processed per day | **4** | Server-side (`daily_logs`), reject \+ enqueue the 5th |
| Contacts per job | **4** | Server-side, per `agent/run` |
| Max LinkedIn actions/day | **16** (4×4) | Derived from the two caps above |
| Email warm-up | start \~5/day week 1, ramp to cap | Server-side send gate |

### **1.3 Functional capabilities map (revised)**

| Module | Feature | System Behavior |
| :---- | :---- | :---- |
| **Job Sourcing** | Page Extraction | Extract job title, company, URL, description, tech stack from Uplers via content script in **my own** browser session. |
|  | Lazy-load handling | Scroll containers / click "Load More" to parse the full catalog, then POST a **schema-validated** batch to the local server. |
|  | Dead-scrape alarm | A sync run that extracts **0 jobs** raises an alert (not a silent success) — markup drift detection. |
| **Contact Discovery** | Burner search | On the **burner account**, run company people-search for HR / Eng Managers / Leads, capture name/title/profile URL. Isolated, consumable. |
|  | Pluggable source | Discovery is behind an interface so an **Uplers-provided contact** source can replace the scraper later with zero downstream change. |
| **Email Outreach** | Verify-then-send | Generate candidate address patterns, **verify**, send ONLY to verifiable addresses. Bounce circuit-breaker pauses a domain after N hard bounces. |
|  | Gemini tailoring | Draft personalized email body from job \+ contact context. |
|  | Gmail dispatch | Send via Gmail API (OAuth2), store `thread_id` for threading. |
| **LinkedIn Outreach** | Assist-mode (real acct) | Agent opens profile, drafts ≤300-char note, pre-fills/clipboards it. **I click Connect \+ Send.** Agent detects sent-state and logs it. |
| **Tracking & Intent** | Event log | Every state change is an append-only event; status columns are derived caches. |
|  | Activity matrix | Parent job → collapsible child contacts (up to 4), with per-channel status. |
|  | LLM classification | Gemini tags reply intent \+ sentiment. Same code path for email and pasted LinkedIn replies. |
| **Follow-Up** | Email nudge (auto) | CRON: email `SENT` \+ silent 3 business days → threaded follow-up via `In-Reply-To`. |
|  | LinkedIn nudge (assist) | Draft only; I send. No scripted LinkedIn traffic. |

---

## **Part 2 — THE WHY (Decision Record)**

Each decision is numbered so we can reference it during the build.

### **D1 — LinkedIn: burner for discovery, assisted on real account**

**Decision:** Scripted LinkedIn search runs only on a disposable burner. The real account only ever sends human-clicked connects. **Why:** LinkedIn detection fingerprints *traffic texture* (input events, session behavior, navigation graph), not just rate. A script lacks the human input layer, so even low-volume, slow, "careful" automation carries the automation signature and gets flagged. Volume (16/day) is low, but the detector keys on *shape*, not count — a one-button search-and-connect burst is a textbook bot signature. Isolating scripted behavior on a consumable account keeps the real (job-search-anchoring) account clean. **Accepted risk:** The burner will likely be restricted quickly (new accounts face the tightest thresholds). It is **consumable**; expect to rotate it. Run it on a separate browser profile (and ideally separate IP) to avoid fingerprint-linking the real account. **Changed from v1:** v1 specified auto-connect on one account with 90–180s delays as the sole defense. That reflects an outdated model of detection and is removed.

### **D2 — Email: send only to verifiable addresses**

**Decision:** Generate address patterns, verify, send only to those that verify. Add a bounce circuit-breaker (pause a domain after N hard bounces). **Why:** SMTP VRFY/RCPT verification is unreliable (providers return accept-all / lie), and blasting guessed addresses from a **personal Gmail** damages sender reputation — which also degrades my real correspondence. Fewer, verified sends beat volume. **Changed from v1:** v1 sent to pattern-guessed addresses verified via SMTP checks.

### **D3 — Postgres with an append-only `events` table as source of truth**

**Decision:** Keep Postgres (already installed). Add an `events` table; treat status columns as derived caches. **Why:** This system's whole job is "who did I contact, when, through which channel, what happened." A mutable status column tells you *where you are* but destroys *how you got there* on every `UPDATE`. For outreach debugging (double-send, early follow-up, misclassified intent) the event history is the one thing you can't afford to lose. **Changed from v1:** v1 had only mutable status columns.

### **D4 — Discovery as a pluggable source**

**Decision:** All discovery sits behind a `DiscoverySource` interface. **Why:** The LinkedIn scraper is the highest-risk, most-fragile component. If the burner dies, or if Uplers turns out to expose the referral contact directly (lower risk, my own data), we swap the source without touching the pipeline. Isolates risk and churn.

### **D5 — UI/UX mirrors Uplers Happy Agent**

**Decision:** The dashboard replicates the Happy Agent look/interaction model. **Why:** Familiarity — I already use it. This is a **UI reference only**; it does NOT imply copying their backend mechanism (which is almost certainly consented-marketplace data and/or paid APIs I don't have). WHAT it looks like ≠ HOW it works underneath. **Open input needed:** screenshots of Happy Agent (dashboard, job card w/ Run Agent, activity view, contact detail) to match faithfully. Deferred — does not block backend.

### **D6 — Caps as safety rails**

**Decision:** 4 jobs/day, 4 contacts/job, server-enforced; email warm-up ramp. **Why:** The cap is a self-imposed rail; the *real* limiter is Gmail reputation and LinkedIn rate limits. Warm-up avoids a new-sender spam signature on personal Gmail. **Changed from v1:** v1 said 5 jobs/20 contacts; tightened to 4/16 per final decision.

### **D7 — Single-process, local, node-cron**

**Decision:** One Node process; CRON via in-process `node-cron`, not external scheduler. **Why:** Single user, trivial workload. No concurrency to justify a separate scheduler or queue. Don't pay complexity for scale that will never arrive.

---

## **Part 3 — THE HOW (Technical Design)**

### **3.1 Technology stack (\$0)**

- **Frontend:** React, Tailwind CSS, Lucide Icons (local).  
- **Backend:** Node.js, Express, TypeScript, `pg`.  
- **Database:** Local PostgreSQL.  
- **Extension:** Chrome MV3 (TypeScript).  
- **AI:** `@google/generative-ai` (Gemini free tier) — note drafting \+ intent.  
- **Email:** Gmail API via OAuth2 (`googleapis`); threading via `In-Reply-To`/`References`.  
- **Scheduling:** `node-cron` in-process.

### **3.2 Module boundaries**

referral-agent/

├── server/                          \# Node \+ Express \+ TS

│   ├── db/

│   │   ├── schema.sql                \# DDL (Part 3.3)

│   │   └── client.ts                 \# pg pool

│   ├── sources/                      \# D4 — pluggable discovery (the swap boundary)

│   │   ├── DiscoverySource.ts        \# interface

│   │   ├── LinkedInScraperSource.ts  \# burner, scripted search (consumable)

│   │   └── UplersContactSource.ts    \# stub; wire later if Uplers exposes contacts

│   ├── verify/

│   │   ├── EmailVerifier.ts          \# interface \+ bounce circuit-breaker

│   │   └── providers/                \# swappable verifier impl(s)

│   ├── ai/gemini.ts                  \# note/email draft \+ reply intent classify

│   ├── mail/gmail.ts                 \# OAuth2 send \+ inbound poll \+ threaded follow-up

│   ├── routes/

│   │   ├── jobs.ts                   \# POST /api/jobs/sync, GET /api/jobs

│   │   ├── agent.ts                  \# POST /api/agent/run   (the "Run Agent" button)

│   │   └── outreach.ts               \# email send, status updates

│   ├── jobs/

│   │   ├── inboundPoll.ts            \# Gmail poll 15m → Gemini intent

│   │   └── followup.ts               \# 3-business-day email nudge

│   └── index.ts

├── extension/                        \# Chrome MV3

│   ├── manifest.json

│   ├── content/

│   │   ├── uplers.ts                 \# scrape jobs (my real session)

│   │   └── linkedin.ts               \# DUAL MODE: discovery(burner) | assist(real)

│   └── background.ts

└── web/                              \# React \+ Tailwind (mirrors Happy Agent UX — D5)

**The dual-mode content script (`linkedin.ts`) governs the whole safety model:**

- **Discovery mode** — injected on the burner's session: scripted company search \+ profile capture. Consumable account.  
- **Assist mode** — injected on the real account's session: draft \+ pre-fill note, log the sent-state after *I* click. NEVER auto-clicks. Mode is determined by which account's session the script runs in, not by a flag we can accidentally flip.

### **3.3 Database schema (Postgres)**

\-- Jobs scraped from Uplers

CREATE TABLE jobs (

    id              SERIAL PRIMARY KEY,

    company\_name    VARCHAR(255) NOT NULL,

    job\_title       VARCHAR(255) NOT NULL,

    job\_url         TEXT NOT NULL,

    job\_description TEXT,

    tech\_stack      TEXT,

    created\_at      TIMESTAMPTZ DEFAULT now()

);

\-- Contacts discovered per job (\<=4). Status cols are DERIVED caches (see events).

CREATE TABLE contacts (

    id              SERIAL PRIMARY KEY,

    job\_id          INT REFERENCES jobs(id) ON DELETE CASCADE,

    contact\_name    VARCHAR(255) NOT NULL,

    contact\_title   VARCHAR(255),

    contact\_email   VARCHAR(255),

    email\_status    VARCHAR(32) DEFAULT 'PENDING',   \-- PENDING|VERIFIED|UNVERIFIABLE|SENT|BOUNCED|REPLIED

    linkedin\_url    TEXT,

    linkedin\_status VARCHAR(32) DEFAULT 'PENDING',   \-- PENDING|REQUEST\_SENT|CONNECTED|REPLIED

    draft\_note      TEXT,                            \-- Gemini-drafted \<=300 char note

    gmail\_thread\_id VARCHAR(255),

    intent\_label    VARCHAR(100),                    \-- e.g. 'Agreed to refer'

    sentiment       VARCHAR(16),                     \-- POSITIVE|NEGATIVE|NEUTRAL

    last\_activity   TIMESTAMPTZ DEFAULT now(),

    created\_at      TIMESTAMPTZ DEFAULT now()

);

\-- D3 — append-only source of truth. Nothing here is ever UPDATEd/DELETEd.

CREATE TABLE events (

    id           BIGSERIAL PRIMARY KEY,

    contact\_id   INT REFERENCES contacts(id) ON DELETE CASCADE,

    event\_type   VARCHAR(48) NOT NULL,

    \-- contact\_captured | note\_generated | email\_verified | email\_unverifiable

    \-- | email\_sent | email\_bounced | linkedin\_request\_sent | linkedin\_connected

    \-- | followup\_sent | reply\_received | intent\_classified

    payload      JSONB,

    created\_at   TIMESTAMPTZ DEFAULT now()

);

CREATE INDEX idx\_events\_contact ON events(contact\_id);

\-- D6 — enforces the 4 jobs/day cap

CREATE TABLE daily\_logs (

    run\_date       DATE PRIMARY KEY DEFAULT CURRENT\_DATE,

    jobs\_processed INT DEFAULT 0

);

### **3.4 Core flow — "Run Agent" lifecycle (state machine)**

PENDING

  → (I click Run Agent on a job card)                           \[cap check: 4/day\]

  → discovery source returns up to 4 contacts        contact\_captured

  → Gemini drafts note \+ email body                  note\_generated       \[no LI traffic\]

  → EMAIL branch:

        verify address → VERIFIED | UNVERIFIABLE      email\_verified / \_unverifiable

        if VERIFIED → Gmail send (warm-up gate)        email\_sent → store thread\_id

  → LINKEDIN branch (real acct, assist):

        open profile, prefill note, I click Connect+Send  linkedin\_request\_sent

        acceptance observed/confirmed                  linkedin\_connected

  → reply arrives (email poll OR pasted LI)            reply\_received

  → Gemini classifies                                  intent\_classified → REPLIED

  → (email only) 3 business days silent                followup\_sent  \[auto, threaded\]

Every arrow writes an `events` row. `contacts.*_status` is recomputed from events.

### **3.5 Discovery source interface (D4)**

interface DiscoverySource {

  // Given a job (company \+ role context), return up to \`limit\` candidate contacts.

  // Implementations:

  //   LinkedInScraperSource  — burner account, scripted search (v1, consumable)

  //   UplersContactSource    — read contact Uplers exposes (v2, if available)

  discover(job: Job, limit: number): Promise\<CandidateContact\[\]\>;

}

### **3.6 Email verification \+ circuit-breaker (D2)**

- Generate candidate patterns (`first.last@`, `first@`, `f.last@`, …) from company domain.  
- Verify via the chosen provider; mark `VERIFIED` / `UNVERIFIABLE`.  
- **Send only to `VERIFIED`.** `UNVERIFIABLE` contacts fall back to the LinkedIn branch.  
- **Circuit-breaker:** after N hard bounces on a domain, auto-pause sends to that domain and surface it in the dashboard.  
- Verifier is an interface — provider is swappable. **(OPEN DECISION — see Part 5.)**

### **3.7 Gmail integration**

- OAuth2 (Google Cloud Console, Gmail send \+ readonly scopes).  
- Send stores `gmail_thread_id`.  
- **Inbound poll** every 15 min for replies on tracked threads → Gemini intent.  
- **Follow-up CRON:** `email_status = SENT` AND silent ≥ 3 business days → threaded reply via `In-Reply-To` / `References`. Logs `followup_sent`.

### **3.8 Gemini usage**

- **Draft:** email body \+ ≤300-char LinkedIn note from job \+ contact context.  
- **Classify:** reply text → `{ sentiment, intent }` where intent ∈ `{AGREED_TO_REFER, DECLINED, ONSITE_REQUIRED, INTERVIEW_REQUEST}`.

---

## **Part 4 — Build order (vertical slices, "try it then see")**

Build the thinnest end-to-end path that exercises the risky part early, then harden.

1. **DB \+ Express skeleton** — apply `schema.sql`, server boots, `GET /api/jobs` works.  
2. **Uplers scraper → `/api/jobs/sync`** — real jobs land in DB (schema-validated \+ dead-scrape alarm). This is the data spine.  
3. **Run Agent \+ burner discovery** — button → scripted company search on burner → up to 4 contacts captured. **This is the trial-and-see checkpoint**: run against one company, watch what happens to the burner, decide from real signal.  
4. **Email path** — verify → Gemini draft → Gmail send → thread tracking.  
5. **Inbound poll \+ intent \+ follow-up CRON.**  
6. **Dashboard** — Happy-Agent-style job→contacts tree \+ activity log (needs D5 screenshots).

Each slice is independently testable and committed separately.

---

## **Part 5 — OPEN decisions (must close before/at build start)**

| \# | Decision | Options | Default if unanswered |
| :---- | :---- | :---- | :---- |
| O1 | **Repo location** | personal repo (path?) / fresh standalone folder | fresh standalone folder |
| O2 | **Email verifier** | (a) free-tier verification API (capped, some accept-all) / (b) only send where Uplers/job exposes a real address (no guessing) | (b) exposed-only (most reliable for personal Gmail) |
| O3 | **Happy Agent UI** | screenshots (preferred) / written description / I design equivalent | design equivalent from functional spec, course-correct later |
| O4 | **Burner isolation** | separate browser profile only / separate profile \+ proxy IP | separate browser profile (add proxy if burner dies too fast) |

---

## **Part 6 — Risks & accepted trade-offs (eyes open)**

| Risk | Severity | Mitigation / stance |
| :---- | :---- | :---- |
| Burner LinkedIn account restricted | High (expected) | Accepted. Burner is consumable; rotate. Isolated from real account (O4). |
| Real account linked to burner via fingerprint | Medium | Separate browser profile; proxy if needed (O4). |
| Uplers ToS (scraping) | Medium | My own member account; lower stakes than LinkedIn. Accepted. |
| Gmail sender reputation damage | Medium | Verify-only sends (D2) \+ warm-up ramp (D6) \+ bounce breaker. |
| Uplers/LinkedIn markup drift breaks scraper | Medium | Schema-validate payloads; dead-scrape alarm on 0 extractions. |
| Gemini free-tier rate/quality limits | Low | Low volume (≤16/day); cache drafts; retry/backoff. |

---

## **Part 7 — Definition of done (v1)**

- [ ] I can scrape Uplers jobs into the DB with one action; 0-extraction raises an alert.  
- [ ] "Run Agent" on a job captures ≤4 burner-discovered contacts, enforcing 4/day.  
- [ ] Verified-only emails send via Gmail with threading; warm-up gate active.  
- [ ] LinkedIn assist-mode drafts a note and logs my manual send; never auto-clicks.  
- [ ] Inbound replies (email \+ pasted LI) are intent-classified by Gemini.  
- [ ] Email follow-up fires automatically after 3 business days of silence, in-thread.  
- [ ] Dashboard shows job→contacts tree \+ full append-only activity log.  
- [ ] Every state change is an `events` row; status columns reconstruct from it.

[image1]: <data:image/png;base64,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kSaIGkoVQojyEzpMNEjgBOQicAjG2rVrXZs2bUqUIyAHHHCAW7JkyQ4JHPlEn3rqKffggw+a/JBnlChax44d3fjx4+13ZO7LL780aTvmmGNMKIn8Ee2aN2+eRcqQQAQOqWRfInuUE6Xaa6+93KhRo6weJLbnnhcsWGBCRl5VhJD9iTB6afMCR67TcePG2X2Qjze8/yREEr///nvL+4rsehk86aST3PLly90hhxxin8mxSp24r2HDhrmPP/7Y7uuZZ55xTzzxREbkuD73xL1xz+3atcuIHO1Pu3fo0CF1H0IIIbITOkw0SOAE5CJwTZo0cZ9//rmJU7gtHwJ3yimnuGnTprmJEyeamPXp08cicK1bt3Y///yzGzFihEWcmPeFgCE/7Ld06VLXqlUri8KxP/eAwK1bt84kqF69eu7555838Tr11FPd6tWrLSJGtKtz584md+wzadIkqwPlzZo1c++++647+OCDMwL32muv2XVJZB/eewiRt+7du7utW7eayPkhZ0Tx6aeftvvj85gxYzK/I3AIH8cidAxLH3fcce6oo46ye+GeuLe+fftmBNDz0EMPuauvvjp1H0IIIbITOkw0SOAE5CJwiMRnn31mohRuy4fANW7cOBMR4zwIE59PO+0098c/3685c+a4119/3ea8EV275557bA4c4sVQ7r777mvb3n///cwQKnPgkKHHH3/c6nrLLbfYnDGibVyzefPmFvVivh11mzx5spUjWsOHD7fjvcAxTDlkyBCTyPDeS+OKK66waOHvv//uTj75ZCtDGhEuZBL59DKGwHXq1Clz7EcffWTRO+5h8ODBqXMn4V6JPIblQgghshM6TDRI4ATkInDAcCWRpbC8NIFjCLBXr14mLeEx2diyZYubO3euSRvXQqiIgv3222/uvvvus6FL5rqdffbZNq+NCNyiRYvc8ccfbyLEPbz11lulChzDsd99950JFHPGkDMicsjfrFmzbH4f98F3mSFXBMoLHJLEsduTKebvMQRKBM2XIVcDBw7MfOZePv30Uxvi9WWlCRwgqZyX8ssvv7zE3xovcLAv0brwXoQQQmQndJhokMAJyFXgGJZkODD51udVV11lQ3y//PKLDUcyX+3000+3bUgL89mIlIXnysa2bdvsrVPmmxF1Y04ck/cXLlxoEoU8Md+N8yFxCBzn55pE5xhqZei1NIHjvG+//bZF4XipAMnivAxNMjRKZI+hSIZcOReROC9wROlefvllews3vO8kHHPrrbeadA4aNMjdeeedNvTsh0qBz9SPKKMvK03gOB9tSx27du1qEkkdGWplG2+iEuHb3osVQggh/kfoMNEggROQq8ARaUM6EKDwbcps8OIDkSGOC7flCiKG0BCRC7ftt99+dp3yLjDMvRPl403XcBvyefTRR5vUhdtyhXl9XAf54zPn5B6JqH3wwQd23+Ex2eAlCKTZi7GHKB5RR962DY8RQghROqHDRIMETkCuAsebj8yFY/J9eQRO/A8kjPXpeLGCYVuik7xBGu6XC7zwgbyVV1yFEEL8l9BhokECJwCRCKM6QgghxM5O6DDRIIETwJyyMIuBEEIIsbMTOkw0SOCEEEIIUayEDhMNEjghhBBCFCuhw0SDBE4IIYQQxUroMNEggRNCCCFEsRI6TDRI4IoXshGwjlvyvz///DO1nxBCCLGzEjpMNEjgihcSt0+ZMsX95z//yQgcSdrD/YQQQoidldBhokECV9ywGO/s2bNN3kiPRcqpcB8hhBBiZyV0mGiQwBU3ZAUg9ydRuGnTprnGjRun9hFCCCF2VkKHiQYJnEDiPvzwQ8mbEEKIoiN0mGiQwAlo06ZNqkwIIYTY2QkdJhokcEIIIYQoVkKHiQYJnBBCCCGKldBhokECJ4QQQohiJXSYaJDACSGEEKJYCR0mGiRwQgghhChWQoeJBgmcEEIIIYqV0GGiQQInhBBCiGIldJhokMAJIYQQolgJHSYaJHBCCCGEKFZCh4kGCZwQQgghipXQYaJBAieEEEKIYiV0mGiIWeAOPvhgt2rVKvfVV1+51atXu99++82tWbPGPifZuHGjW7duXar8l19+Mb755psS5ezLMd99912Jcs7NNX788ccS5UDZr7/+mipfu3atHROWc78///yz/Qy3cX2OC8u5frZrcA6un63u1CFb3alztrpDtrqDr3t4z77u4fV93cPr+7pDshzYN1t7xVL3+fPnuxYtWqS+q0IIIQqT0GGiIWaBO+yww9xnn33mbr/9dtenTx/3/PPPu379+tnnJC+88IIbMWJEqvzpp5827rzzzhLl7MsxgwcPLlHev39/u8aoUaNS53r00UfdM888kyq/99577ZiwnGuOGTMmdW148MEH3T333JMqpyzbNag795St7tQhW9379u2bte6Qre7g6871kuW+7uE9+7oPHTq0RLmvO4TXoO7Z2iuWuiOF5557buq7KoQQojAJHSYaYhe4999/P1UuRHVBhE4CJ4QQ8RA6TDRI4ITIHxI4IYSIi9BhokECJ0T+kMAJIURchA4TDRI4IfKHBE4IIeIidJhoiFngGjdu7GbOnJkqF6K6WLp0qWvdunWqXAghRGESOkw0xCxwQgghhBA7Qugw0RCzwO2///7urrvuSpULUV2wbMmxxx6bKhdCCFGYhA4TDTELnObAiUJDc+CEECIuQoeJhmIRuIYNG7q2bdu6mjVrprbliwMPPNB17drVXX755e6MM85Ibc9Gq1at3AUXXJChXbt2dp5wv0Jnzz33dKeffrrV4bzzznOnnnpqap9c6Ny5szvooINS5TvCrrvu6k4++WR34YUXprblCwmcEELERegw0VAsAnfRRRe5ZcuWuVq1aqW25QtSKH399dfu999/dy+99FJqezbmzp2bSekFpAbr2LFjar9C59BDD3WTJk2yOpBeasWKFa5Bgwap/crL999/n3fR2muvvdzo0aPdl19+mdqWLyRwQggRF6HDREOxCFyXLl0sx2Xt2rVT2/bYYw/31FNPuVdffdXdcMMNrkaNGlbOz0svvdS9+OKLRr169aycKN51113nXnvtNSuvW7du5lxEobjO+PHjU9fJxqeffpr1TdoOHTrYvRxxxBF2H1dccYW7+OKL7R5uvPFG1759e3f//fe7Xr16uX322cfuqWfPnpbOiXsbMmSI3Rv15vj69eu7bt26mVhyHmSG6+y+++4mnq+//robNGiQO/roo62c8xEJnDhxorXN9qSEvnjnnXcyn7t37+6GDRtmv++yyy6WtmrChAmWdiop0XxXSFFGWx5//PGZbRs2bHCdOnWye7/++utN5vbee29Xp04duxfuKVl3IpdEP88//3yrIxE8zsU27m3AgAGW7urZZ5+1dFfh/eeL0gRuv/32c5dddpn7+OOP7bsRY5RVCCF2RkKHiYZiFzge8sgFScjffPNNS0repEkT23bAAQeYSMyePdsiZURvkD2kgf3eeustN2PGDMud6c9XEYGbM2eO1QV4MYPySy65xM6DqBxyyCFu/fr1JiAIzKZNm9ySJUvsvkgI//LLL9s+U6ZMcV988YXtyzk///xzt2jRIhuKROaQCyTr22+/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pdQ5KsItt9zi1q5d61577TVr22+++caNGzcutV91QX5M0jWF5fQ77VCZfS+EEKJ0QoeJhmISOESJZN8k/eZ3yojC9evXz6JBRMouv/xy16tXr8wxN954o3v44YfdbbfdljpfeUHgkJrTTz/drrt48WKTyDPPPNPyQvIAh2S7tWrVyso6duxoxw8fPtxddNFFdp9Elo4++mh31113ufPPP7/EtdjeoUMHN2jQIMvHSFmLFi1MnubNm5e5VuvWrVP3mQ+o20cffWRi4suoJ1LMfdeuXdsiTqeddprdB8LVtm1bN3ToULv38Hzl5bPPPrME4rQnOUFHjhyZkUPfJrQXeSopQ57POOMMy7OJWPMdQHK5R2SqTZs21vfcF/eXvBZtm60cKL/77rstDybXpc+p55IlS9xNN91kv3N/7Ov7/sILL0z9zfA9HDZsWInvIudDAs855xzbVhnRYiGEKDZCh4mGYhI4HtbTp09PlcNDDz3kpk6d6r7++msb0qSMIb9LLrnEPvfo0cONGDEidVx5SAocn6+//nr322+/WaSIBz0igVQmJZEH9a233up+/PFHE6+zzz7bttO2RJeIYjVv3tyNHz/ehOjcc8+1h/3333/vRo0aZbJHZBExOeaYY0wS3n//fbsWkJw8vM98gCAnpcNDOz777LPu448/dt26dbMy5IW6dOnSxYSUY7lfH5nMhV9//dUELSxHwnyb0Ea05aJFi2zodu7cue6HH34wobr33nstMopgDhw40PqH5OdI2vLly+1ctNuyZcus7fhuvPzyy9auDN3Sf7/88ov1G9I9Z84ct88++1i96HcEk0gk59hzzz3tfPQ9x61fvz7T91z/6aeftvshkfpll11m30vkkvNwL7TlfvvtZxFH6hTWWQghRPkJHSYaikngeHi++uqrqXJ488033YIFC9xXX31lD07KiHgQyRkzZox7/vnnTZbC48pDKHDIILKCKPh9EIEwyofYIBihOG7ZssW9+OKLJoLMoVq3bp0dSx0QjFNPPdUifQiIj/bw0sY777yTurd8s2nTpqzzuRjiRJiWLl1qksZ9IXBIENLCPojWCy+8YHISHr89fGQ1LEd+aBMifogh98F1EDgka+bMmbYfIvTtt99mBA6xpBzJot04FjFFtug/QEiJxjHn7o033sgcA02bNi1xH0QlTzjhhNT90e++//hM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>