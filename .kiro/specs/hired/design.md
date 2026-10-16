# Hired — Design (v1)

> **Status:** Final · **Companion to:** `requirements.md` · **Supersedes design detail in:** `Personal Referral Outreach Agent — Implementation Blueprint (1).md`

This document describes *how* v1 is built: architecture, data model, the three pluggable interfaces that form the swap boundary, the Run Agent flow in detail, and the testing strategy. Where a decision was already made during planning, it's locked in with a brief rationale. Decisions still open are called out explicitly.

---

## Table of contents

1. Architecture at a glance
2. Decision record (locked)
3. Tech stack
4. Project structure
5. Database schema
6. Status state machines
7. Pluggable adapter interfaces
8. Provider registry + fallback chain
9. Run Agent lifecycle (orchestration)
10. Gmail integration
11. LinkedIn integration (Flow B)
12. Gemini usage
13. Chrome extension architecture
14. Testing strategy
15. Observability
16. Local security

---

## 1. Architecture at a glance

```
     ┌──────────────────────────────────────────────────────────────┐
     │                     Browser (Chrome)                          │
     │                                                                │
     │  ┌─────────────────┐           ┌──────────────────────────┐  │
     │  │ Happy Agent tab │◄──scrape──│  Hired Chrome Extension  │  │
     │  │ (platform.      │           │  (MV3)                   │  │
     │  │  uplers.com)    │  content  │                          │  │
     │  └─────────────────┘  script   │  content/uplers.ts       │  │
     │                                │  content/linkedin.ts     │  │
     │  ┌─────────────────┐           │  background.ts           │  │
     │  │ LinkedIn tab    │◄─────────►│                          │  │
     │  │ (real account)  │  pre-fill │                          │  │
     │  └─────────────────┘  only     └──────────────┬───────────┘  │
     │                                               │               │
     │  ┌──────────────────────────────────┐         │               │
     │  │ Hired Dashboard (React)          │         │               │
     │  │ localhost:5173                   │         │               │
     │  └──────────────┬───────────────────┘         │               │
     └─────────────────┼─────────────────────────────┼──────────────┘
                       │ shared-secret HTTP          │
                       ▼                             ▼
     ┌────────────────────────────────────────────────────────────┐
     │  Local Node server · 127.0.0.1:4000                        │
     │                                                             │
     │  routes/   services/   adapters/   core/   jobs/           │
     │                                                             │
     │  ┌─────────────┐  ┌─────────────┐  ┌───────────────────┐   │
     │  │ Postgres    │  │ Gmail API   │  │ Gemini / SerpAPI /│   │
     │  │ (local)     │  │ (OAuth2)    │  │ Hunter / Reoon    │   │
     │  └─────────────┘  └─────────────┘  └───────────────────┘   │
     └────────────────────────────────────────────────────────────┘
```

Three processes talk to one local server. The server owns all state (Postgres) and all third-party credentials.

---

## 2. Decision record (locked)

The decisions below drove the whole design. They're referenced by number across the codebase (e.g., `// D1`).

- **D1 — LinkedIn safety: assist mode only.** No scripted `click()` on LinkedIn action buttons. Content scripts may read DOM (detect sent-state) and write DOM (pre-fill text), but all Connect and DM sends require a human mouse click or `Alt+Enter` registered as a `KeyboardEvent` on my key. Rationale: LinkedIn's bot detection keys on input-event signature and traffic texture, not volume; even careful automation gets the real account flagged.
- **D2 — Email: verified-only sends.** Gmail dispatch is gated on `EmailVerifier` returning `valid`. `accept_all` and `unknown` fall back to LinkedIn branch; `invalid` is dropped. Protects personal Gmail sender reputation.
- **D3 — Append-only `events` as source of truth.** All state changes write a row. `contacts.*_status` are derived caches, recomputable with `SELECT ... ORDER BY created_at`. Dual-write pattern: `recordEvent()` writes event + updates status in one transaction. No `UPDATE events` ever.
- **D4 — Discovery / finder / verifier are pluggable.** Three interfaces, N adapters each, ordered fallback chain. Rotate providers as free tiers deplete without touching orchestrator.
- **D5 — UX mirrors Happy Agent.** With one divergence: our Run Agent flow adds a modal with contact selection + per-contact channel toggles before Send. Happy fires-and-forgets; we fire → review → forget. The quality gate is cheap (~2 min/job) and catches X-ray noise.
- **D6 — Hard caps.** 4 runs/day enforced server-side. 1-8 contacts/job, user-selectable at modal time.
- **D7 — Single Node process + `node-cron`.** No queue infra, no scheduler service. Single user, 16 actions/day max — don't pay complexity for scale that will never arrive.
- **D8 — Monorepo (pnpm workspaces).** Three apps + one shared-types package. Shared types are the single biggest correctness win and worth the small tooling overhead.

---

## 3. Tech stack

Pinned versions below are the recommended baseline. Minor-version upgrades are fine; majors need a decision.

| Layer | Choice | Version | Why |
|---|---|---|---|
| Runtime | Node.js | 20 LTS | Current LTS, stable through 2026+ |
| Package manager | pnpm | 9.x | Workspace support out of the box |
| Language | TypeScript | 5.3+ | Strict mode on everywhere; shared types across apps |
| Backend HTTP | Express | 4.19+ | Minimal, well-understood, v5 skipped (still stabilizing) |
| DB driver | pg | 8.x | Direct Postgres client, no ORM in v1 (small schema) |
| Schema validation | Zod | 3.x | Runtime validation for request payloads + scraped data |
| Scheduling | node-cron | 3.x | In-process, no external scheduler |
| AI client | @google/generative-ai | latest | Gemini free-tier access |
| Email client | googleapis | latest | Gmail API via OAuth2 |
| Logging | pino | 9.x | Structured JSON logs, fast |
| Testing | Vitest | 1.x | TS-native, Jest-compatible API, 10× faster |
| Frontend framework | React | 18.x | Standard; works with Vite |
| Frontend build | Vite | 5.x | Fast, zero-config for React+TS |
| Styling | Tailwind CSS | 3.x | Matches Happy Agent's visual density; utility-first |
| Icons | lucide-react | latest | Same icon set Happy uses |
| Data fetching | TanStack Query | 5.x | Caching + background refetch; fits Activity view polling |
| Routing | React Router | 6.x | Standard, straightforward |
| Date math | date-fns + date-fns-business-days | latest | For the 3-business-day follow-up (v2) + general date ops |
| Extension | Chrome MV3 | — | Service worker + content scripts; TypeScript via Vite |
| Database | PostgreSQL | 15+ | Local install, JSONB for `events.payload` |

**What we're NOT using (and why):**
- **ORM (Prisma, TypeORM, Drizzle).** Schema is 5 tables. Raw SQL in repositories is clearer for a learner than ORM mental model. Can migrate to Drizzle in v2 if the schema grows.
- **Monolithic framework (Nest, Fastify-plus-plugins).** Overkill for 20 endpoints.
- **Message queue (BullMQ, Kafka).** Single user, no concurrency. `setTimeout` and `node-cron` cover scheduling needs.
- **Docker in v1.** Everything is local-only. Add Dockerization if we ever host.

---

## 4. Project structure

Monorepo with three apps and one shared-types package. Code lives at the workspace root; specs live in `.kiro/`.

```
hired/                                   workspace root
├── .kiro/
│   ├── specs/hired/{requirements,design,tasks}.md
│   └── steering/coding-standards.md
├── apps/
│   ├── server/                          Node + Express + TS
│   │   ├── src/
│   │   │   ├── config/                  env parsing, constants (one file: config/index.ts)
│   │   │   ├── db/
│   │   │   │   ├── migrations/          ordered .sql files
│   │   │   │   ├── schema.sql           full current schema (read-only, generated)
│   │   │   │   ├── client.ts            pg.Pool
│   │   │   │   └── repositories/        job.repo.ts, contact.repo.ts, event.repo.ts
│   │   │   ├── core/                    PURE domain logic, zero I/O
│   │   │   │   ├── events.ts            EventType enum + payload type map
│   │   │   │   ├── stateMachines.ts     transitions for gmail_status + linkedin_status
│   │   │   │   ├── scoring.ts           contact ranking heuristic
│   │   │   │   └── templating.ts        {{var}} substitution
│   │   │   ├── adapters/                THE SWAP BOUNDARY (D4)
│   │   │   │   ├── discovery/
│   │   │   │   │   ├── DiscoverySource.ts         interface + types
│   │   │   │   │   ├── SerpApiXRaySource.ts
│   │   │   │   │   └── __tests__/
│   │   │   │   │       └── contract.test.ts       runs against every registered adapter
│   │   │   │   ├── emailFinder/
│   │   │   │   │   ├── EmailFinder.ts
│   │   │   │   │   ├── HunterFinder.ts
│   │   │   │   │   └── __tests__/contract.test.ts
│   │   │   │   └── emailVerifier/
│   │   │   │       ├── EmailVerifier.ts
│   │   │   │       ├── ReoonVerifier.ts
│   │   │   │       └── __tests__/contract.test.ts
│   │   │   ├── services/                application-level orchestration
│   │   │   │   ├── orchestrator.ts      Run Agent lifecycle
│   │   │   │   ├── providerRegistry.ts  fallback chain + credit telemetry
│   │   │   │   ├── gmail.ts             send + inbound poll
│   │   │   │   ├── gemini.ts            template render + intent classify
│   │   │   │   └── linkedinAssist.ts    draft creation (no sending)
│   │   │   ├── routes/
│   │   │   │   ├── jobs.routes.ts       POST /api/jobs/sync, GET /api/jobs
│   │   │   │   ├── agent.routes.ts      POST /api/agent/run, POST /api/agent/send
│   │   │   │   ├── contacts.routes.ts   GET /api/contacts, PATCH /api/contacts/:id
│   │   │   │   ├── linkedinQueue.routes.ts
│   │   │   │   └── activity.routes.ts
│   │   │   ├── jobs/                    cron workers
│   │   │   │   ├── inboundPoll.ts
│   │   │   │   └── index.ts
│   │   │   ├── middleware/
│   │   │   │   ├── sharedSecret.ts
│   │   │   │   └── errorHandler.ts
│   │   │   └── index.ts                 entry point
│   │   ├── test/
│   │   │   ├── integration/
│   │   │   └── fixtures/
│   │   ├── package.json
│   │   └── tsconfig.json
│   ├── extension/                       Chrome MV3
│   │   ├── src/
│   │   │   ├── background.ts            service worker
│   │   │   ├── content/
│   │   │   │   ├── uplers.ts            Happy Agent jobs scrape
│   │   │   │   └── linkedin.ts          assist mode (D1)
│   │   │   ├── shared/                  types + API client
│   │   │   │   └── api.ts
│   │   │   └── popup/                   small UI for sync button + queue counts
│   │   ├── manifest.json
│   │   ├── public/
│   │   ├── vite.config.ts               @crxjs/vite-plugin for MV3 builds
│   │   └── package.json
│   └── web/                             React dashboard
│       ├── src/
│       │   ├── features/                organized BY FEATURE, not by tech
│       │   │   ├── jobs/
│       │   │   │   ├── JobsPage.tsx
│       │   │   │   ├── JobCard.tsx
│       │   │   │   ├── JobDetail.tsx
│       │   │   │   └── __tests__/
│       │   │   ├── run-agent/
│       │   │   │   ├── RunAgentModal.tsx
│       │   │   │   ├── ContactRow.tsx
│       │   │   │   └── useRunAgent.ts
│       │   │   ├── my-activity/
│       │   │   ├── linkedin-queue/
│       │   │   │   ├── LinkedinQueuePage.tsx
│       │   │   │   ├── ConnectTab.tsx
│       │   │   │   ├── DmTab.tsx
│       │   │   │   └── useHotkey.ts
│       │   │   └── configure/
│       │   │       ├── TemplatesTab.tsx
│       │   │       └── ConnectedAccountsTab.tsx
│       │   ├── shared/
│       │   │   ├── components/          Button, Modal, Table, Badge, Toast
│       │   │   ├── hooks/
│       │   │   └── api/                 typed fetch wrappers using TanStack Query
│       │   ├── app/
│       │   │   ├── layout.tsx           sidebar + top bar
│       │   │   └── router.tsx
│       │   └── main.tsx
│       ├── index.html
│       ├── tailwind.config.ts
│       ├── vite.config.ts
│       └── package.json
├── packages/
│   └── shared-types/
│       ├── src/
│       │   ├── Job.ts
│       │   ├── Contact.ts
│       │   ├── Event.ts
│       │   ├── Adapter.ts               the three interfaces
│       │   └── index.ts
│       ├── package.json
│       └── tsconfig.json
├── .env.example
├── .gitignore
├── README.md
├── package.json                         pnpm workspace root
├── pnpm-workspace.yaml
└── tsconfig.base.json
```

**The organization principles — worth internalizing because they drive every file decision:**

- **`core/` is pure.** Anything that touches the network, filesystem, or database goes elsewhere. Pure code is trivially unit-testable without mocks.
- **`adapters/` is the swap boundary.** Every third-party integration lives behind an interface in this folder. The orchestrator imports the interface, not the implementation. This is D4.
- **`services/` orchestrates.** Services compose `core/` + `adapters/` + `db/` to do real work. The orchestrator is a service.
- **`routes/` is thin.** Routes parse requests, call services, return responses. No business logic in routes.
- **Features over layers in `web/`.** Grouping React code by feature (`features/run-agent/`) keeps related files together. Grouping by tech (`components/`, `hooks/`, `pages/`) scatters a feature across 4 folders. We only use the by-tech grouping inside `shared/` for genuinely cross-cutting primitives.

---

## 5. Database schema

Full DDL. Comments explain the non-obvious choices.

```sql
-- Jobs scraped from Happy Agent or added via paste-link.
CREATE TABLE jobs (
    id                   SERIAL PRIMARY KEY,
    source               VARCHAR(32) NOT NULL,     -- 'happy_agent' | 'paste_link'
    company_name         VARCHAR(255) NOT NULL,
    job_title            VARCHAR(255) NOT NULL,
    job_url              TEXT NOT NULL,
    job_description      TEXT,
    must_have_skills     TEXT,                     -- comma-separated raw text from Happy Agent
    good_to_have_skills  TEXT,
    created_at           TIMESTAMPTZ DEFAULT now(),
    UNIQUE (job_url)                               -- natural key dedupe
);

-- Each click of Run Agent on a job creates one `runs` row.
-- `channels` captures what the user picked in the modal.
CREATE TABLE runs (
    id                   SERIAL PRIMARY KEY,
    job_id               INT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
    channels             VARCHAR(16) NOT NULL,     -- 'gmail' | 'linkedin' | 'both'
    status               VARCHAR(16) NOT NULL DEFAULT 'IN_PROGRESS',
                                                   -- IN_PROGRESS | COMPLETED | FAILED
    marked_as_interview  BOOLEAN DEFAULT false,
    created_at           TIMESTAMPTZ DEFAULT now(),
    completed_at         TIMESTAMPTZ
);

CREATE INDEX idx_runs_job ON runs(job_id);

-- Contacts discovered inside a single run. 1-8 per run (user-selected).
-- Status columns are DERIVED from `events` and may be rebuilt by replaying events.
CREATE TABLE contacts (
    id                       SERIAL PRIMARY KEY,
    run_id                   INT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
    name                     VARCHAR(255) NOT NULL,
    title                    VARCHAR(255),
    tenure_hint              VARCHAR(128),         -- '2y at Appscrip' or similar
    email                    VARCHAR(255),
    email_verified           BOOLEAN DEFAULT false,
    linkedin_url             TEXT,
    selected_for_gmail       BOOLEAN DEFAULT false,
    selected_for_linkedin    BOOLEAN DEFAULT false,
    gmail_status             VARCHAR(32) DEFAULT 'PENDING',
                                            -- PENDING | QUEUED | SENT | REPLIED | BOUNCED | FAILED
    linkedin_status          VARCHAR(32) DEFAULT 'PENDING',
                                            -- PENDING | CONNECT_DRAFTED | CONNECT_SENT
                                            -- | CONNECTED | DM_DRAFTED | DM_SENT | REPLIED | DECLINED
    gmail_thread_id          VARCHAR(255),
    linkedin_dm_draft        TEXT,                 -- rendered template, ready to send
    discovered_via           VARCHAR(32),          -- which adapter produced this (D4 telemetry)
    email_found_via          VARCHAR(32),
    email_verified_via       VARCHAR(32),
    intent_label             VARCHAR(255),         -- free-form from Gemini classification
    sentiment                VARCHAR(16),          -- POSITIVE | NEGATIVE
    created_at               TIMESTAMPTZ DEFAULT now(),
    last_activity            TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_contacts_run ON contacts(run_id);
CREATE INDEX idx_contacts_gmail_thread ON contacts(gmail_thread_id);
CREATE INDEX idx_contacts_linkedin_status ON contacts(linkedin_status);

-- Append-only. Never UPDATE, never DELETE. (D3)
-- This is the source of truth; status columns are caches.
CREATE TABLE events (
    id          BIGSERIAL PRIMARY KEY,
    contact_id  INT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
    event_type  VARCHAR(64) NOT NULL,
    payload     JSONB NOT NULL DEFAULT '{}',
    created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_events_contact ON events(contact_id);
CREATE INDEX idx_events_type_time ON events(event_type, created_at);

-- Daily cap enforcement (D6).
CREATE TABLE daily_logs (
    run_date    DATE PRIMARY KEY DEFAULT CURRENT_DATE,
    runs_count  INT DEFAULT 0
);

-- Credit telemetry for the pluggable providers.
CREATE TABLE provider_credits (
    provider_name       VARCHAR(64) PRIMARY KEY,
    provider_kind       VARCHAR(32) NOT NULL,    -- 'discovery' | 'email_finder' | 'email_verifier'
    free_quota_monthly  INT,                      -- NULL if unlimited or unknown
    estimated_used      INT DEFAULT 0,
    last_reset          DATE DEFAULT date_trunc('month', now())::DATE,
    last_call_at        TIMESTAMPTZ
);
```

### Event types

Defined in `apps/server/src/core/events.ts` as a TypeScript enum + payload type map. Writing a new event type is a two-step change: add to the enum, add its payload shape.

```
contact_discovered         { discoveredVia, rawFields }
contact_selected           { gmail: boolean, linkedin: boolean }
email_find_attempted       { foundVia, success: boolean }
email_found                { email, confidence }
email_not_found            { reason }
email_verified             { verifiedVia, status: 'valid' | 'accept_all' | 'unknown' }
email_unverifiable         { verifiedVia, status, reason }
gmail_queued               { templateId }
gmail_sent                 { threadId, messageId }
gmail_bounced              { threadId, reason }
linkedin_connect_drafted   { }
linkedin_connect_sent      { }
linkedin_acceptance_detected { fromGmailMessageId }
linkedin_dm_drafted        { renderedBody }
linkedin_dm_sent           { }
reply_received             { channel: 'gmail' | 'linkedin', snippet }
reply_classified           { sentiment, intent }
marked_as_interview        { note? }
run_completed              { }
```

---

## 6. Status state machines

Status columns are derived caches. These diagrams define legal transitions. `core/stateMachines.ts` implements the transition table; it's the only code that mutates status columns.

**Gmail status**

```
PENDING ──[contact_selected gmail=true]──> QUEUED
QUEUED  ──[gmail_sent]──> SENT
QUEUED  ──[gmail_bounced]──> BOUNCED
QUEUED  ──[any failure]──> FAILED
SENT    ──[reply_received channel=gmail]──> REPLIED
SENT    ──[gmail_bounced delayed]──> BOUNCED
```

**LinkedIn status (Flow B — bare connect, DM after accept)**

```
PENDING          ──[contact_selected linkedin=true]──> CONNECT_DRAFTED
CONNECT_DRAFTED  ──[linkedin_connect_sent]──> CONNECT_SENT
CONNECT_SENT     ──[linkedin_acceptance_detected]──> CONNECTED
CONNECT_SENT     ──[30 days silent]──> DECLINED
CONNECTED        ──[linkedin_dm_drafted (auto)]──> DM_DRAFTED
DM_DRAFTED       ──[linkedin_dm_sent]──> DM_SENT
DM_SENT          ──[reply_received channel=linkedin]──> REPLIED
```

A transition that's not in the table throws — this catches bugs where we try to update status in the wrong order (e.g., `SENT → QUEUED` would be nonsense).

---

## 7. Pluggable adapter interfaces

The three interfaces live in `packages/shared-types/src/Adapter.ts` so server, extension, and web agree on shapes.

```typescript
// ─────── Discovery ───────

export interface CandidateContact {
  name: string;
  title: string;
  linkedinUrl?: string;
  tenureHint?: string;    // free-form, from source snippet
  rawSource: string;      // adapter name that produced this
}

export interface DiscoveryInput {
  companyName: string;
  jobTitle: string;
  jobDescription?: string;
  limit: number;          // caller requests up to N
}

export interface DiscoverySource {
  readonly name: string;             // e.g. 'serpapi_xray'
  readonly kind: 'discovery';
  discover(input: DiscoveryInput): Promise<CandidateContact[]>;
  estimateCreditsRemaining(): Promise<number | null>;  // null = unknown/unlimited
}

// ─────── Email finder ───────

export interface EmailFindInput {
  firstName: string;
  lastName: string;
  companyDomain: string;
  linkedinUrl?: string;    // if available, improves accuracy
}

export type EmailFindResult = {
  email: string;
  confidence: 'high' | 'medium' | 'low';
  rawSource: string;
};

export interface EmailFinder {
  readonly name: string;             // e.g. 'hunter'
  readonly kind: 'email_finder';
  find(input: EmailFindInput): Promise<EmailFindResult | null>;
  estimateCreditsRemaining(): Promise<number | null>;
}

// ─────── Email verifier ───────

export type VerifyStatus = 'valid' | 'invalid' | 'accept_all' | 'unknown';

export type VerifyResult = {
  status: VerifyStatus;
  reason?: string;
  rawSource: string;
};

export interface EmailVerifier {
  readonly name: string;             // e.g. 'reoon'
  readonly kind: 'email_verifier';
  verify(email: string): Promise<VerifyResult>;
  estimateCreditsRemaining(): Promise<number | null>;
}
```

### Adding a new adapter

1. Create `apps/server/src/adapters/<kind>/<Name>.ts` implementing the interface.
2. Register it in `apps/server/src/services/providerRegistry.ts`.
3. Add it to `provider_credits` table seed data (name, kind, free_quota_monthly).
4. Run the contract test suite — new adapter is picked up automatically.

That's the whole lift. No change to the orchestrator or any downstream code.

---

## 8. Provider registry + fallback chain

Managed by `services/providerRegistry.ts`:

```typescript
class ProviderRegistry<T extends { name: string; estimateCreditsRemaining: () => Promise<number | null> }> {
  register(adapter: T): void;
  // Returns adapters in preference order: those with known remaining credits first.
  // Within a tier, user-configured priority wins.
  fallbackChain(): Promise<T[]>;
  // Tries fallback chain in order; records which adapter resolved.
  resolve<R>(fn: (adapter: T) => Promise<R | null>): Promise<{ result: R; via: string } | null>;
}
```

Three singletons: `discoveryRegistry`, `emailFinderRegistry`, `emailVerifierRegistry`.

The orchestrator never names an adapter directly. It calls `discoveryRegistry.resolve((a) => a.discover(input))`, which iterates adapters, skips exhausted ones, and returns the first successful result tagged with which adapter produced it.

---

## 9. Run Agent lifecycle (orchestration)

The core service lives in `services/orchestrator.ts`. HTTP routes are thin wrappers. Here's the full flow in prose + state:

### Phase A — User opens the modal (`POST /api/agent/discover`)

Input: `{ jobId, channels: ['gmail' | 'linkedin' | 'both'] }`

1. Check daily cap. If `daily_logs.runs_count >= 4`, return 429 with "resumes tomorrow".
2. Insert `runs` row (`status = IN_PROGRESS`). Increment `daily_logs.runs_count` in the same transaction.
3. Call `discoveryRegistry.resolve(a => a.discover({ companyName, jobTitle, limit: 8 }))`.
4. For each returned `CandidateContact`:
   - Insert a `contacts` row (`discovered_via = via`).
   - Write `events` row: `contact_discovered` with payload.
   - If `channels` includes `gmail` and we got email+LinkedIn info:
     - Infer `companyDomain` from job metadata.
     - Call `emailFinderRegistry.resolve(a => a.find({ firstName, lastName, companyDomain, linkedinUrl }))`.
     - If found: call `emailVerifierRegistry.resolve(a => a.verify(email))`.
     - Record `email_found` / `email_verified` events; set `contact.email`, `email_verified`.
5. Return the full contact set to the UI, including quality signals.

### Phase B — User confirms selection (`POST /api/agent/send`)

Input: `{ runId, selections: [{ contactId, gmail: boolean, linkedin: boolean }] }`

1. Validate selections (user can't select gmail if `email_verified = false`).
2. For each selection:
   - Update `contacts.selected_for_gmail` / `selected_for_linkedin`.
   - Write `contact_selected` event.
3. For Gmail-selected contacts:
   - Enqueue a background task per contact (just `setImmediate` + Gmail API call).
   - On send success: `events.gmail_sent` with `threadId`, update status cache.
   - On failure: `events.gmail_bounced` or `events.gmail_failed`.
4. For LinkedIn-selected contacts:
   - Render the connection template... wait, Flow B says BARE connect. Correction:
     - For LinkedIn: do NOT render any note. Just insert `events.linkedin_connect_drafted` with empty payload. UI picks these up for the Queue → Connect tab.
5. Mark `runs.status = COMPLETED` once all Gmail dispatches complete (LinkedIn is async by nature of needing user clicks).

### Phase C — User processes LinkedIn Queue → Connect tab

For each contact in `CONNECT_DRAFTED` state:
1. UI tells extension: "navigate to this `linkedin_url` and open the Connect modal."
2. Content script detects the Connect modal is open, highlights the Send button.
3. User presses Alt+Enter → the keyboard event is forwarded to the Send button programmatically... **wait, that's a scripted click**. See D1.

**Correction:** `Alt+Enter` opens a browser confirmation ("Send this request?") in our extension popup. User's actual click on *that popup button* dispatches a `MouseEvent` to LinkedIn's Send button via `.click()`. The event is `isTrusted: false`.

**This is a gray area.** LinkedIn can detect `isTrusted: false` clicks. Pure D1 compliance means the user clicks LinkedIn's Send button directly on the LinkedIn tab. Alt+Enter is a convenience that nudges toward D1 violation.

**Final decision for v1:** Alt+Enter does NOT click LinkedIn's Send button. It only advances our Queue to the next contact AFTER the user has clicked LinkedIn's Send button themselves (detected by the content script observing the "Pending" badge appear). This keeps D1 clean. The ergonomic cost is one extra click per contact but zero account risk.

4. Content script detects `.sent-state` (DOM change to "Pending" badge). Posts to server.
5. `events.linkedin_connect_sent`. Status → `CONNECT_SENT`.

### Phase D — LinkedIn acceptance detection

The 15-min Gmail inbound poll (`jobs/inboundPoll.ts`) does two things:
1. Reads new Gmail messages matching tracked `thread_id`s → reply classification.
2. Reads new Gmail messages from LinkedIn's notification system (`noreply@linkedin.com`, subject patterns like "accepted your invitation") → map to contact via `linkedin_url`, flip status to `CONNECTED`.

On `CONNECTED`:
- Render DM template (variable substitution via `core/templating.ts`).
- Store rendered body in `contact.linkedin_dm_draft`.
- `events.linkedin_dm_drafted`. Status → `DM_DRAFTED`.
- UI's Queue → DM tab picks it up.

### Phase E — User processes LinkedIn Queue → DM tab

Same pattern as Connect tab but on the LinkedIn messaging UI. User clicks LinkedIn's Send on the DM; content script detects sent-state; server records `linkedin_dm_sent`.

### Phase F — Reply handling

For both Gmail and LinkedIn replies:
1. Message captured by poll (Gmail) or user action (LinkedIn — see "Open limitation" below).
2. Pass body text to Gemini → `{ sentiment: 'POSITIVE' | 'NEGATIVE', intent: string }`.
3. `events.reply_received` + `events.reply_classified`.
4. Contact's sentiment/intent cache updated. Shows in Responses tab.

**Open limitation**: LinkedIn DM replies have no notification polling (LinkedIn's reply notifications are inconsistent, and we don't scrape LinkedIn). For v1, the user manually marks a reply when they see one in the LinkedIn Queue, or pastes the reply text into a form. Documented as a v2 target.

---

## 10. Gmail integration

- OAuth2 scopes: `gmail.send`, `gmail.readonly` (for inbound poll).
- Setup is a one-time flow in Configure → Connected Accounts.
- `services/gmail.ts` wraps `googleapis` client; token refresh handled automatically.
- Threading: outbound sends set `In-Reply-To` / `References` headers only on follow-ups (v2 feature). First touches start a new thread; `threadId` returned by Gmail is stored.
- Inbound poll runs every 15 min via `node-cron`. Fetches `UNREAD` messages. For each:
  - If `From: noreply@linkedin.com` + subject matches `accepted|now connected` → LinkedIn acceptance path.
  - If `threadId` matches a tracked contact → reply path.
- Rate limiting: Gmail API has generous quotas; no throttling needed at 16/day.

---

## 11. LinkedIn integration (Flow B)

Zero scripted clicks on LinkedIn. The content script's job is purely:

1. **Pre-fill** — when navigated to a profile in the Queue, open the Connect modal (via LinkedIn's own URL hash or user click), do nothing further.
2. **Detect** — observe DOM mutations; when the "Pending" badge appears on a profile, POST `linkedin_connect_sent` to the server.
3. **DM pre-fill** — when navigated to a DM compose, insert the rendered template into the message input (D1-compliant: writing to a text input isn't a scripted click).
4. **Detect DM send** — observe the message appearing in the thread; POST `linkedin_dm_sent`.

Acceptance detection goes through Gmail (§10), not through LinkedIn.

---

## 12. Gemini usage

Two call sites, both in `services/gemini.ts`:

### Template rendering

Pure variable substitution — handled by `core/templating.ts` using the user's `{{var}}` syntax. No Gemini call needed. (We added "Rewrite message" as a UI button in Happy's Configure; v1 defers that AI polish.)

### Reply intent classification

```typescript
// pseudo
async function classifyReply(replyText: string): Promise<{ sentiment: 'POSITIVE' | 'NEGATIVE'; intent: string }>
```

Prompt (prompt lives in `services/gemini.ts` as a constant, versioned):

> Classify this reply to a referral outreach message. Return strict JSON:
> `{ "sentiment": "POSITIVE" | "NEGATIVE", "intent": "<short free-form label>" }`
> Example labels: "Agreed to refer", "Declined due to onsite requirement", "Interview scheduled", "Needs more info".
> Reply text: `<text>`

Retry with exponential backoff on quota errors. Fallback to `{ sentiment: 'NEGATIVE', intent: 'unclassified' }` after 3 failures (never block the flow).

---

## 13. Chrome extension architecture

MV3 service worker + two content scripts.

**`content/uplers.ts`** — injected on `platform.uplers.com/talent/*`. Adds a floating "Sync to Hired" button near the top of the jobs page. Click → scrape visible cards, POST to `http://127.0.0.1:4000/api/jobs/sync` with the shared-secret header.

**`content/linkedin.ts`** — injected on `linkedin.com/*`. Dual-mode by current URL:
- `linkedin.com/in/*` (profile) → read sent-state when queue is active.
- `linkedin.com/messaging/*` → pre-fill DM when queue says so.

**`background.ts`** — maintains the "active queue" state. Opens the next contact's profile tab when user clicks Next in the Queue UI. Reads queue state from local server via polling (every 2s while queue view is open).

**`manifest.json`** host permissions: `platform.uplers.com/*`, `linkedin.com/*`, `127.0.0.1:4000/*`.

---

## 14. Testing strategy

Three layers, all using Vitest.

### Unit tests (`__tests__/` next to source)

- `core/*` — pure functions, 100% coverage target. Easy because no I/O.
- `adapters/*/<Name>.ts` — test each adapter in isolation with mocked HTTP (via `nock` or `msw`).

### Contract tests (`adapters/<kind>/__tests__/contract.test.ts`)

A single parametrized test suite that runs against **every** registered adapter of that kind. Ensures all discovery sources return `CandidateContact[]` with required fields, all finders return `EmailFindResult | null`, etc. **This is the main guarantee that adapters are interchangeable.** Adding a new adapter means passing this suite.

### Integration tests (`test/integration/`)

- Orchestrator with mocked adapters + real test Postgres.
- Gmail service with mocked `googleapis`.
- Routes with supertest + real orchestrator (with mocked adapters).

### What we don't test automatically

- Chrome extension content scripts — manual testing checklist in `docs/testing-checklist.md`.
- Full end-to-end flow with real Gmail / SerpAPI / Reoon — manual smoke test before each v1 push.

### Running tests

- Per-package: `pnpm --filter server test`
- Everything: `pnpm test` from workspace root
- Watch mode during dev: `pnpm --filter server test:watch`

Target coverage: 80%+ on `core/`, 60%+ on `adapters/` and `services/`, zero target on routes (they're thin, covered by integration tests).

---

## 15. Observability

- **Structured logs** via Pino. Every log line has `requestId` (if HTTP) or `runId` / `contactId` (if background). No PII in log messages — reference by ID.
- **Events table IS observability**. For any contact, `SELECT * FROM events WHERE contact_id = X ORDER BY created_at` tells you the full story.
- **Dashboard shows adapter credit telemetry**. A sidebar card lists each registered adapter with "N / M credits used this month." Visual signal when a plug is about to deplete.
- **Dead-scrape alarm**. If a Happy Agent sync returns 0 jobs, raise a dashboard banner. Markup drift is the single most likely failure mode.

---

## 16. Local security

- Server binds `127.0.0.1` only, never `0.0.0.0`.
- All `/api/*` routes require `X-Hired-Secret: <token>` header. Token is in `.env`, generated once (`openssl rand -hex 32`). Extension stores it in `chrome.storage.local`.
- Gmail OAuth tokens stored in Postgres `oauth_tokens` table, column-encrypted via `pgcrypto` with a key derived from `.env`.
- `.env` is `.gitignore`d. `.env.example` lists required vars with placeholder values.
- No telemetry phones home. The only outbound HTTPS is to Gmail, Gemini, SerpAPI, Hunter, Reoon.

---

## 17. Open items (to decide before/during build)

| # | Item | Default if unresolved |
|---|---|---|
| O1 | SerpAPI X-ray query precision — exact query template per role seniority | Start with `site:linkedin.com/in "{company}" ("recruiter" OR "engineering manager" OR "tech lead")`, iterate on week-1 recall |
| O2 | Scoring weights for modal's default-select | `verified_email ? +2 : 0`, `tenure 6mo-5yr ? +1 : 0`, `title matches 'manager' or 'lead' ? +1 : 0`; select if score ≥ 2 |
| O3 | Gemini prompt tuning | Ship v1 prompt as-is, log mis-classifications, adjust in week 2 |
| O4 | LinkedIn tab lifecycle | Open profiles in a dedicated extension-managed window to isolate from main browsing session |

---

## Appendices

### A. HTTP routes (full list)

```
POST   /api/jobs/sync                 extension → server; scraped jobs batch
GET    /api/jobs                      list jobs with latest run status
GET    /api/jobs/:id                  single job detail

POST   /api/agent/discover            start a run (opens modal)   returns { runId, contacts }
POST   /api/agent/send                confirm selections, dispatch

GET    /api/contacts                  filtered by run / status
GET    /api/contacts/:id              with full event history
PATCH  /api/contacts/:id              manual overrides (sentiment correction, etc.)

GET    /api/linkedin-queue            { connectQueue: [...], dmQueue: [...] }
POST   /api/linkedin-queue/mark-sent  { contactId, kind: 'connect' | 'dm' }

GET    /api/activity                  My Activity table
PATCH  /api/activity/:runId           { markedAsInterview?: boolean }

GET    /api/provider-credits          telemetry for sidebar card

GET    /api/health                    for monitoring
```

### B. Key environment variables (`.env.example`)

```
# Server
NODE_ENV=development
PORT=4000
SHARED_SECRET=generate_with_openssl_rand_hex_32

# Postgres
DATABASE_URL=postgresql://hired:hired@localhost:5432/hired

# Google
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=http://localhost:4000/api/auth/google/callback

# Gemini
GEMINI_API_KEY=

# Discovery
SERPAPI_API_KEY=

# Email finder
HUNTER_API_KEY=

# Email verifier
REOON_API_KEY=
```

### C. Related documents

- **`requirements.md`** — scope and success criteria
- **`tasks.md`** — 6-day phased build plan
- **`.kiro/steering/coding-standards.md`** — style, naming, testing conventions
- **`Personal Referral Outreach Agent — Implementation Blueprint (1).md`** — v2 reference (frozen)
