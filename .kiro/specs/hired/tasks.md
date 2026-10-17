# Hired — Build Tasks (v1)

> **Status:** Final · **Companion to:** `requirements.md`, `design.md` · **Target:** first human reply by day 4-5, first interview conversation by day 6

Each phase is a vertical slice that ends in something testable. Each task is scoped small enough to commit on its own. Each task lists its test criteria — nothing moves to "done" without a green test. Phases 1-6 fit in a 6-day calendar window; phase 7 and beyond is post-v1 polish.

Checkbox discipline: tick a task only when its tests pass locally. "Done" phase requires every task checked AND the phase acceptance criteria pass.

---

## Phase 0 — Prerequisites (before Day 1)

**Goal:** every external account exists, every tool is installed. 30-60 min.

### 0.1 Install local tooling

- [ ] Node.js 20 LTS installed, `node --version` reports v20.x
- [ ] pnpm 9+ installed, `pnpm --version` reports 9.x (`npm install -g pnpm`)
- [ ] PostgreSQL 15+ installed and running locally; `psql --version` works
- [ ] Git installed; a `.gitconfig` with user set
- [ ] Chrome browser installed (dev profile recommended, not main profile)
- [ ] VS Code or editor of choice; Kiro installed (already true)

### 0.2 Create Postgres DB

- [ ] Create role: `CREATE USER hired WITH PASSWORD 'hired';`
- [ ] Create DB: `CREATE DATABASE hired OWNER hired;`
- [ ] Confirm connection: `psql -U hired -d hired -h 127.0.0.1 -c '\dt'`

### 0.3 Register API keys (all free tier)

- [ ] **Google Cloud Console**: create project `hired-agent-local`, enable Gmail API, create OAuth 2.0 Client (Desktop app type initially — faster than Web for dev). Record `client_id`, `client_secret`.
- [ ] **Gemini API key**: `aistudio.google.com` → Get API Key (free tier)
- [ ] **SerpAPI**: signup at `serpapi.com` → Dashboard → copy API key (250 searches/mo free, **no card required**)
- [ ] **Snov.io**: signup at `app.snov.io` → Account → API tab → copy **User ID** and **API Secret** (OAuth2 client credentials, not a single key). 50 credits/mo free. Hunter was the original plan but requires a business email; Snov accepts gmail.
- [ ] **Reoon**: signup at `emailverifier.reoon.com` → Dashboard → API key (600 verifications/mo free)

**Phase 0 done when:** all five API keys are in a scratch file you'll paste into `.env` in Phase 1.

---

## Phase 1 — Foundation (Day 1, ~4 hours)

**Goal:** workspace builds, server boots, DB schema applied, Chrome extension loads a hello-world content script.

### 1.1 Workspace scaffold

- [ ] At workspace root, `pnpm init` → set `"name": "hired"`, `"private": true`
- [ ] Create `pnpm-workspace.yaml`:
  ```yaml
  packages:
    - 'apps/*'
    - 'packages/*'
  ```
- [ ] Create `tsconfig.base.json` with strict mode, moduleResolution bundler, target ES2022, lib ES2022 + DOM where needed
- [ ] Create `.gitignore` (node_modules, dist, .env, .vscode/, coverage, *.log)
- [ ] Create `.env.example` with all vars listed in `design.md § appendix B`
- [ ] Create `.env` from `.env.example`, fill in Phase 0 keys
- [ ] **Generate shared secret**: `openssl rand -hex 32` → paste into `.env` as `SHARED_SECRET`
- [ ] First commit: `baseline: workspace scaffold`

**Test:** `pnpm install` succeeds. `cat .env | wc -l` ≥ 8.

### 1.2 Shared-types package

- [ ] Create `packages/shared-types/` with `package.json` (`"name": "@hired/types"`, `"version": "0.0.0"`, `"main": "src/index.ts"`)
- [ ] Create `packages/shared-types/tsconfig.json` extending base
- [ ] Create `packages/shared-types/src/{Job.ts, Contact.ts, Event.ts, Adapter.ts, index.ts}` — just stubs for now
- [ ] From workspace root: `pnpm --filter @hired/types build` should succeed (even with empty exports)

**Test:** empty package compiles.

### 1.3 Server scaffold

- [ ] Create `apps/server/` with `package.json` depending on: express, pg, zod, pino, node-cron, @google/generative-ai, googleapis, dotenv, @hired/types
- [ ] Dev deps: typescript, vitest, @types/node, @types/express, tsx, nock
- [ ] Create `apps/server/tsconfig.json` extending base, `outDir: "./dist"`, `rootDir: "./src"`
- [ ] Create `apps/server/src/config/index.ts` — loads and validates env with Zod, exposes typed config object
- [ ] Create `apps/server/src/index.ts` with minimal Express app: `app.get('/api/health', (req, res) => res.json({ ok: true }))`, binds to `127.0.0.1:4000`
- [ ] Create `apps/server/src/middleware/sharedSecret.ts` — rejects requests without correct `X-Hired-Secret`
- [ ] Add `scripts`: `dev` (tsx watch src/index.ts), `test` (vitest run), `test:watch` (vitest), `build` (tsc)
- [ ] Boot server: `pnpm --filter server dev`
- [ ] `curl -H "X-Hired-Secret: <token>" http://127.0.0.1:4000/api/health` returns `{"ok":true}`

**Test:** health endpoint responds 200 with secret, 401 without.

### 1.4 DB schema + client

- [ ] Create `apps/server/src/db/schema.sql` with all 6 tables from `design.md § 5`
- [ ] Create `apps/server/src/db/migrations/0001_init.sql` with the same schema (migrations will matter in v2+)
- [ ] Create `apps/server/src/db/client.ts` exporting a configured `pg.Pool`
- [ ] Create `apps/server/scripts/migrate.ts` that reads migrations folder and applies in order
- [ ] Run `pnpm --filter server migrate` → all tables created
- [ ] `psql -U hired -d hired -c '\dt'` shows all 6 tables

**Test:** migration script is idempotent (re-run returns clean "already applied").

### 1.5 Web scaffold (React + Vite + Tailwind)

- [ ] Create `apps/web/` using `pnpm create vite . --template react-ts`
- [ ] Add Tailwind: `pnpm add -D tailwindcss postcss autoprefixer`, run `tailwindcss init -p`
- [ ] Add dependencies: react-router-dom@6, @tanstack/react-query, lucide-react, @hired/types
- [ ] Create `apps/web/src/app/{layout.tsx, router.tsx}` with left sidebar + top bar skeleton. Per D10 (no Jobs browser), nav items are: **Dashboard, My Activity, LinkedIn Queue, Configure**. (Resumes/Help/Upgrade/Reminders/Jobs hidden — Jobs tab was Happy Agent's; we don't rebuild it.)
- [ ] Create placeholder pages for each nav item ("coming in Phase N")
- [ ] Set up a `/run/:jobId` route — the Run Agent modal will mount here when the extension opens the dashboard tab post-Alt+H (Phase 3)
- [ ] Boot web: `pnpm --filter web dev` → `localhost:5173` loads the shell

**Test:** every nav link renders its placeholder page without a crash. Tailwind classes apply.

### 1.6 Extension scaffold ✓ (shipped with Phase 2.3)

Scaffold was folded into Phase 2.3 since the stealth model (D9) replaced the originally planned always-visible button. See Phase 2.3 for the full built state.

Historical reference for what was planned:
- [x] Create `apps/extension/` with `package.json`
- [x] Install: `@crxjs/vite-plugin`, `vite`, `typescript`, `@hired/types`
- [x] Create `apps/extension/manifest.json` (MV3, permissions for `platform.uplers.com/*`, `linkedin.com/*`, `127.0.0.1:4000/*`, storage) — plus `commands.run-via-hired` for Alt+H
- [x] Create `apps/extension/src/background.ts` — now also acts as fetch proxy for CORS
- [x] Create `apps/extension/src/content/uplers.ts` — now the full stealth scraper, not a smoke-test log
- [ ] Build: `pnpm --filter extension build` → outputs `apps/extension/dist/`
- [ ] Chrome → Extensions → Developer mode ON → Load unpacked → point at `dist/`
- [ ] Open any `platform.uplers.com` page → console shows the log

**Test:** extension loads without errors. Content script fires on the right origin.

### 1.7 Vitest setup

- [ ] In `apps/server`: `vitest.config.ts` with coverage reporter, test env `node`
- [ ] Write first test: `apps/server/src/config/__tests__/config.test.ts` — asserts env parsing throws on missing required var
- [ ] In `apps/web`: `vitest.config.ts` with jsdom env, @testing-library/react
- [ ] Write first test: a trivial `<Button>` smoke test
- [ ] `pnpm test` at workspace root runs both suites

**Test:** both initial tests pass.

### Phase 1 acceptance criteria

- [ ] Server boots and health-checks on 127.0.0.1:4000 with secret
- [ ] DB has all 6 tables
- [ ] Web app shell renders with sidebar + top bar
- [ ] Chrome extension loads and logs from a content script
- [ ] First commit is clean: `pnpm test` green, `pnpm --filter server build` + `pnpm --filter web build` + `pnpm --filter extension build` all succeed

---

## Phase 2 — On-demand job capture via Alt+H (shipped)

**Goal:** `Alt+H` on a focused Happy Agent job detail captures that one job into Postgres, with full metadata. No batch sync, no Jobs browser page (per D10 + D9).

### 2.1 Shared types ✓

- [x] `packages/shared-types/src/Job.ts` — `Job`, `JobSource`, `RunViaHiredPayload`, `RunViaHiredResponse` types
- [x] Export from `src/index.ts`

**Note:** `exactOptionalPropertyTypes: true` means payload fields use `?: T | undefined` (not `?: T`) because Zod's parse produces explicit undefined.

### 2.2 Server: run-via-hired endpoint ✓

- [x] Migration `0002_job_extra_fields.sql` adds `happy_job_id`, `experience_range`, `location_hint`, `posted_hint`
- [x] `apps/server/src/db/repositories/job.repo.ts` — `upsertByUrl(payload)` uses `ON CONFLICT (job_url) DO UPDATE` and returns `{ job, isNew }` via `(xmax = 0) AS was_insert`
- [x] `apps/server/src/routes/jobs.routes.ts` — `POST /api/jobs/run-via-hired` (Zod-validated), `GET /api/jobs`, `GET /api/jobs/:id`
- [x] Mount in `src/index.ts`
- [x] CORS middleware allow-list for `chrome-extension://*` and `localhost:5173`

**Tests passing:** 7 config unit tests + manual curl verification (valid payload → `{jobId, isNew: true}`; same URL again → `isNew: false`; malformed → 400 with Zod errors).

### 2.3 Extension: Alt+H hotkey, stealth scraper, popup for secret ✓

- [x] `apps/extension/manifest.json` — MV3, `host_permissions` for `platform.uplers.com/*` and `127.0.0.1:4000/*`, `commands.run-via-hired` bound to `Alt+H`, `action.default_popup = popup.html`
- [x] `apps/extension/src/content/uplers.ts` — **no DOM injection by default** (D9). Scrapes focused detail pane on message. Anchors: `#jobDetailSectionHead` for the pane, `.job-role-title-link[href]` for jobTitle + LinkedIn URL, `.companyName` for company, `.must_have` + `.good_to_have > div` for skills, `.attrib` for experience/location, `.earlyApplicant` for posted hint, `#hsContent` for description (HTML-stripped to plain text preserving paragraph breaks).
- [x] Closed Shadow DOM toast (`attachShadow({ mode: 'closed' })`) — Happy's `querySelector` cannot reach into it.
- [x] `apps/extension/src/background.ts` — `chrome.commands` listener forwards hotkey; `chrome.runtime.onMessage` listener acts as fetch proxy to localhost (bypasses MV3 content-script CORS). Silently ignores hotkey on non-Happy tabs (D9).
- [x] `apps/extension/popup.html` + `src/popup/index.ts` — password input for the shared secret → `chrome.storage.local`; "Test server" button hits `/api/health`.

**Tests:** manual E2E — `Alt+H` on a focused Happy job → DB row with full fields. Re-pressing on same job → `isNew: false`. Alt+H on non-Happy tab (e.g. google.com) → no toast, no network activity.

### Phase 2 acceptance criteria

- [x] Alt+H on a focused Happy Agent job detail inserts one row with full metadata
- [x] Re-pressing on the same job updates the row in place (dedup via `job_url`)
- [x] Extension injects nothing into Happy's DOM until Alt+H
- [x] Toast confirms success/failure, lives inside closed Shadow DOM
- [x] All server tests + manual E2E green

**Shipped on branch `feat/jobs-capture`, merged to main in PR #1.**

---

## Phase 3 — Discovery + email path (Day 2 afternoon / Day 3, ~6-8 hours)

**Goal:** Click Run Agent → modal opens → discovers contacts via SerpAPI X-ray → finds emails via Snov (with `PatternHeuristicFinder` fallback through Reoon) → verifies via Reoon → user sees modal with signals.

### 3.1 Core domain modules

- [ ] `apps/server/src/core/events.ts` — `EventType` string enum + typed payload map (see design.md § 5)
- [ ] `apps/server/src/core/stateMachines.ts` — `transitionGmail(current, event)` and `transitionLinkedin(current, event)` functions; throw on invalid transitions
- [ ] `apps/server/src/core/scoring.ts` — `scoreContact(contact): { score, reasons }` with default-select logic (verified email +2, title matches manager/lead +1, tenure 6mo-5yr +1; select if ≥ 2)
- [ ] `apps/server/src/core/templating.ts` — `render(template, vars)` with `{{var}}` substitution; throws on unresolved vars

**Tests (unit, 100% coverage target on core/):**
- State machine transition tables (every legal transition succeeds, every illegal throws)
- Scoring: boundary cases (score = 1, score = 2, missing fields)
- Templating: substitution, escaping, unresolved-var error

### 3.2 Adapter interfaces

- [ ] `packages/shared-types/src/Adapter.ts` — exports `DiscoverySource`, `EmailFinder`, `EmailVerifier` interfaces and their input/output types (see design.md § 7)
- [ ] Export from `src/index.ts`

**Test:** types compile from server consumers.

### 3.3 Discovery: SerpAPI X-ray adapter

- [ ] `apps/server/src/adapters/discovery/DiscoverySource.ts` — re-exports interface from shared-types
- [ ] `apps/server/src/adapters/discovery/SerpApiXRaySource.ts` — implementation:
  - Builds query: `site:linkedin.com/in "{companyName}" ("recruiter" OR "engineering manager" OR "tech lead" OR "staff engineer")`
  - Calls `https://serpapi.com/search.json` with `engine=google`, `q=<query>`, `num=<limit>`, `api_key=<SERPAPI_API_KEY>`
  - Parses `organic_results[]`: extract `name` (from `title` before " - " or " | "), `title` (from `snippet` or `title` after " - "), `linkedinUrl` (from `link`), `tenureHint` (regex "N y[ea]r at X" from snippet)
  - Returns `CandidateContact[]`
  - `estimateCreditsRemaining()` — hits `https://serpapi.com/account?api_key=KEY`; returns `total_searches_left` from the response. Also mirror to `provider_credits` table.
- [ ] Register in `services/providerRegistry.ts`

**Tests:**
- Unit with `nock`: mock SerpAPI response → asserts parsing extracts right fields
- Edge cases: results missing snippet, non-English profiles, URLs with query params, 401 (bad API key), 429 (quota exceeded)

### 3.4 Email finder: Snov adapter (primary) + PatternHeuristicFinder (fallback)

#### 3.4a Snov adapter

- [ ] Add `SNOV_CLIENT_ID` and `SNOV_CLIENT_SECRET` to `config/index.ts` Zod schema (both optional with empty-string preprocessing, like Hunter was)
- [ ] `apps/server/src/adapters/emailFinder/EmailFinder.ts` — re-export interface
- [ ] `apps/server/src/adapters/emailFinder/SnovFinder.ts` — OAuth2 client-credentials flow:
  - Exchange `client_id` + `client_secret` for a bearer token at `https://api.snov.io/v1/oauth/access_token`. Cache the token for its TTL.
  - Call `POST https://api.snov.io/v1/get-emails-by-domain` (or the current find-by-name endpoint — verify in Snov docs when building) with first_name + last_name + domain
  - Parse response → `EmailFindResult | null` with confidence mapped from Snov's status (`valid` → `high`, `catchall` → `medium`, else `low`)
  - `estimateCreditsRemaining()` hits Snov's balance endpoint; mirror to `provider_credits` table
- [ ] Register in registry (will be skipped automatically when credentials are missing)

**Tests:**
- Unit with nock: successful find, 404 not found, 401 (bad credentials refresh), 429 rate-limit
- Credit telemetry increments per find call

#### 3.4b PatternHeuristicFinder (fallback, no external API)

- [ ] `apps/server/src/adapters/emailFinder/PatternHeuristicFinder.ts` — no signup needed, uses the existing Reoon verifier:
  - Generate patterns from first + last + companyDomain: `first.last@`, `first@`, `flast@`, `firstlast@`, `first_last@` (short-circuit on first `valid` from verifier)
  - **Bonus hybrid**: before trying patterns, scan the SerpAPI snippet text (if available for this contact) for a `/[\w.-]+@[\w-]+\.[\w.-]+/` match — many LinkedIn profiles / team pages that Google indexes include the real email directly. Verify it; if `valid`, return with `confidence: 'high'`.
  - Returns `EmailFindResult | null`
  - `estimateCreditsRemaining()` returns `null` (unlimited at this layer; the real cost is Reoon verifier credits consumed inside)
- [ ] Register in registry *after* Snov so the fallback chain tries Snov first

**Tests:**
- Unit: pattern generation produces expected ordered list for various name shapes (single-name, hyphenated, non-ASCII)
- Unit: snippet-regex extracts email, rejects obvious noise (`example@example.com`, `noreply@`)
- Unit with mocked verifier: short-circuits on first valid, returns null when all patterns `invalid`
- Integration: full fallback chain — Snov exhausted → PatternHeuristicFinder picks up

### 3.5 Email verifier: Reoon adapter

- [ ] `apps/server/src/adapters/emailVerifier/EmailVerifier.ts` — re-export interface
- [ ] `apps/server/src/adapters/emailVerifier/ReoonVerifier.ts` — calls Reoon's `/api/verify/single` endpoint; maps response to `VerifyStatus`
- [ ] Status mapping: Reoon's `safe` → `valid`, `invalid` → `invalid`, `catch_all` → `accept_all`, `unknown`/`disposable`/`role` → `unknown`

**Tests:**
- Unit with nock: all 4 status mappings
- Catch-all handling: result has reason text

### 3.6 Contract test suites

- [ ] `apps/server/src/adapters/discovery/__tests__/contract.test.ts` — parametrized over all registered DiscoverySource adapters; asserts interface conformance (returns array, every item has `name`, `title`, `rawSource`; respects `limit`)
- [ ] Same for `emailFinder/__tests__/contract.test.ts`
- [ ] Same for `emailVerifier/__tests__/contract.test.ts`

**Test:** adding SerpApiXRaySource makes the discovery contract test parametrize over 1 adapter and pass.

### 3.7 Provider registry

- [ ] `apps/server/src/services/providerRegistry.ts` — generic `ProviderRegistry<T>` class per design.md § 8
- [ ] Three module-level singletons exported: `discoveryRegistry`, `emailFinderRegistry`, `emailVerifierRegistry`
- [ ] On server boot (`index.ts`), register the three day-1 adapters

**Tests:**
- Unit: `fallbackChain()` orders by remaining credits
- Unit: `resolve()` iterates until success, skips exhausted adapters

### 3.8 Orchestrator — Phase A (discovery)

- [ ] `apps/server/src/db/repositories/run.repo.ts` + `contact.repo.ts` + `event.repo.ts`
- [ ] `apps/server/src/db/repositories/dailyLog.repo.ts` — `incrementIfUnderCap(cap)` returns `{ allowed: boolean, current: number }` in a single transaction (row-locking)
- [ ] `apps/server/src/services/orchestrator.ts` — `runDiscoverPhase({ jobId, channels })`:
  - Daily cap check (abort if full)
  - Insert run row
  - Call `discoveryRegistry.resolve()`
  - For each candidate: insert contact row + `contact_discovered` event
  - If `channels` includes gmail: resolve email finder, record events, set `contact.email`
  - If email found: resolve verifier, record events, set `email_verified`
  - Return `{ runId, contacts }`
- [ ] `apps/server/src/routes/agent.routes.ts` — `POST /api/agent/discover`

**Tests:**
- Integration: `/api/agent/discover` with mocked adapters → correct contacts in DB, correct events written
- Integration: 5th call in a day returns 429
- Integration: discovery fails → run marked FAILED

### 3.9 Web: Run Agent modal

- [ ] `features/run-agent/RunAgentModal.tsx` — modal shell with channel checkboxes at top
- [ ] `features/run-agent/useRunAgent.ts` — mutation hook that POSTs to `/api/agent/discover`
- [ ] `features/run-agent/ContactRow.tsx` — per-contact row with checkbox, name/title, verified badge, LinkedIn URL, two channel pills (`[Gmail] [LI]`)
- [ ] Default-select logic: run `core/scoring.ts` equivalent client-side (or trust the server to return a `defaultSelected` flag per contact — simpler, less duplicated logic)
- [ ] Loading state: "Discovering contacts via SerpAPI X-ray…" with spinner
- [ ] Error state: adapter failure → "Discovery failed. [Retry]"
- [ ] Attach to `JobDetail.tsx`'s Run Agent button

**Tests:**
- Component: renders with mocked contact list, selections toggle correctly
- Component: default-selected count matches scoring

### Phase 3 acceptance criteria

- [ ] Clicking Run Agent on a real job opens the modal and populates with SerpAPI results in < 10s
- [ ] Emails are found and verified where possible; row shows verification badge
- [ ] Daily cap enforcement works end-to-end
- [ ] All contract tests + unit tests + integration tests green

---

## Phase 4 — Gmail dispatch + inbound + classification (Day 3 evening / Day 4, ~6-8 hours)

**Goal:** Hit Send in the modal → verified emails go out → replies come in → Gemini classifies them.

### 4.1 Gmail OAuth

- [ ] `apps/server/src/routes/auth.routes.ts` — `GET /api/auth/google/start` (redirects to Google OAuth consent), `GET /api/auth/google/callback` (exchanges code for tokens, stores encrypted)
- [ ] Add `oauth_tokens` table (migration 0003) with pgcrypto column encryption
- [ ] `apps/server/src/services/gmail.ts` — client factory that pulls stored token, handles refresh
- [ ] `apps/web/src/features/configure/ConnectedAccountsTab.tsx` — "Connect Gmail" button → opens OAuth flow in popup → polls for success

**Tests:**
- Integration: callback stores token, `/api/auth/google/status` returns connected
- Manual: click button, go through consent, see "Gmail connected" state

### 4.2 Gmail send

- [ ] `services/gmail.ts` → `sendEmail({ to, subject, body, htmlBody? })` — returns `{ threadId, messageId }`
- [ ] Build MIME message with proper headers (From defaults to the connected account)
- [ ] Error handling: distinguish network error vs API error vs rate-limit

**Tests:**
- Unit with nock: successful send parses response, retrieves threadId
- Unit: rate-limit backoff

### 4.3 Templates: Configure tab

- [ ] `features/configure/TemplatesTab.tsx` — two tabs (Gmail / LinkedIn), rich-text editor (contentEditable or TipTap), Variables dropdown that inserts `{{outreachEmployeeName}}` etc.
- [ ] `settings` table (migration 0004) with `key, value` columns; routes `GET/PUT /api/settings/:key`
- [ ] Pre-seed with the user's provided templates from the planning conversation

**Tests:**
- Component: variable insertion works
- Integration: PUT persists, GET returns stored

### 4.4 Orchestrator — Phase B (send) + templating

- [ ] Extend `services/orchestrator.ts` → `runSendPhase({ runId, selections })`:
  - Validate: selection with gmail requires `email_verified = true`
  - Write `contact_selected` event per contact
  - For gmail selections: render template → `gmail.sendEmail` → write `gmail_sent` or `gmail_failed`
  - For LinkedIn selections: write `linkedin_connect_drafted` event, no further work (Queue picks up)
- [ ] `POST /api/agent/send` route
- [ ] Mark `runs.status = COMPLETED` when done

**Tests:**
- Integration: send with 2 gmail + 1 linkedin → 2 emails sent (mocked), 1 draft queued
- Integration: send with unverified-email + gmail = true → 400 validation error

### 4.5 Gemini intent classification

- [ ] `services/gemini.ts` → `classifyReply(text): Promise<{ sentiment, intent }>`
- [ ] Prompt lives as a versioned constant
- [ ] Zod-validate the JSON response from Gemini
- [ ] Fallback: 3 retries with exponential backoff → return `{ sentiment: 'NEGATIVE', intent: 'unclassified' }`

**Tests:**
- Unit: parse Gemini's response format
- Unit: fallback after 3 failures
- Unit: Zod rejects malformed response

### 4.6 Inbound poll

- [ ] `apps/server/src/jobs/inboundPoll.ts` — cron every 15 min:
  1. List UNREAD messages via Gmail API
  2. For each: if `From` matches `noreply@linkedin.com` AND subject matches `(accepted|now connected)` → look up contact by linkedin URL in message body, flip to CONNECTED, auto-draft DM, write events
  3. Else: look up contact by `threadId`. If found, classify body via Gemini, write `reply_received` + `reply_classified` events, update sentiment/intent cache
  4. Mark message read
- [ ] `apps/server/src/jobs/index.ts` registers cron
- [ ] Start cron in `index.ts` after server boots

**Tests:**
- Unit: LinkedIn notification parser (regex extracts the right URL)
- Integration: poll with fixture inbox → correct DB state after

### 4.7 Web: My Activity (minimal)

- [ ] `features/my-activity/MyActivityPage.tsx` — table (number, company, role, status, last activity)
- [ ] Expandable row: shows contacts with per-channel status, verified badges, contact links
- [ ] `GET /api/activity` endpoint feeds this
- [ ] Tabs scaffold at top: All Activity, Responses, Interviews (Responses + Interviews stubbed, filled Phase 6)

**Tests:**
- Component: renders runs with their contacts
- Component: status badges color correctly

### Phase 4 acceptance criteria

- [ ] First real Gmail outreach lands in a recipient's inbox (self-test to your own secondary email)
- [ ] A reply you send to yourself shows up in dashboard with intent classified
- [ ] My Activity shows the full run → contact → status tree
- [ ] 5 total messages sent manually by this point (warm-up ramp per D6)

---

## Phase 5 — LinkedIn Queue (Day 5, ~5-6 hours)

**Goal:** Connect requests + DM-after-accept flow works end-to-end via the Queue + extension.

### 5.1 LinkedIn Queue API

- [ ] `GET /api/linkedin-queue` → `{ connect: ContactWithProfile[], dm: ContactWithProfileAndDraft[] }`
- [ ] `POST /api/linkedin-queue/mark-sent` → body `{ contactId, kind: 'connect' | 'dm' }` → writes event, transitions status

**Tests:**
- Integration: queue returns only CONNECT_DRAFTED / DM_DRAFTED contacts
- Integration: mark-sent flips status correctly

### 5.2 Extension: LinkedIn content script

- [ ] `apps/extension/src/content/linkedin.ts`:
  - On `linkedin.com/in/*` pages: if background says this profile is in the active queue, visually highlight the Connect button (e.g., CSS outline). Observe DOM for `aria-label="Pending"` → POST mark-sent for the current contact.
  - On `linkedin.com/messaging/*`: if background says a DM for this recipient is drafted, inject the draft text into the message input (writes to `.value` only; no click). Observe sent message appearing → POST mark-sent for the DM.
- [ ] `apps/extension/src/background.ts`: polls `GET /api/linkedin-queue` every 2s while queue tab is open in dashboard; keeps current state in memory; exposes `getCurrent()` via messaging to content scripts

**Tests:**
- Unit (jsdom): DOM observer fires on Pending badge appearance
- Manual: load extension, open a LinkedIn profile that's in queue, see highlight; actually send a real connection to yourself/alt — verify Pending triggers mark-sent

### 5.3 Web: LinkedIn Queue page

- [ ] `features/linkedin-queue/LinkedinQueuePage.tsx` — top tabs: `Connect (N)` / `DM (N)` / `Done`
- [ ] Current contact pane: profile summary + LinkedIn URL open button; for DM tab, show the drafted message in a read-only preview
- [ ] "Open on LinkedIn" button opens the profile/DM in a new Chrome tab; extension picks it up
- [ ] "Skip" button marks contact as skipped (event: `queue_skipped`); "Next" button after mark-sent advances
- [ ] Hotkey: Alt+Right → Next, Alt+Left → Previous (no scripted clicks on LinkedIn itself)

**Tests:**
- Component: tabs render counts, Next advances
- Manual: full flow — open queue, open profile in LinkedIn, click Send on LinkedIn (your real click), queue advances, contact marked

### 5.4 Full Flow B exercise

- [ ] Manually self-test: Run Agent on one job → modal → select 1 LinkedIn contact (yourself from an alt account) → Send → Connect from Queue → in alt account accept the request → wait up to 15 min for Gmail poll to detect "X accepted" → DM auto-drafts → Queue → DM tab → Send DM → verify receiver

**Test:** full round-trip from Run Agent click to DM delivered logs out expected events for the contact.

### Phase 5 acceptance criteria

- [ ] LinkedIn Queue correctly shows pending Connects, hotkey navigation works
- [ ] Clicking Send on LinkedIn is detected and queue advances
- [ ] Gmail poll detects LinkedIn acceptance email → contact flips to CONNECTED → DM auto-drafted
- [ ] DM tab works the same way
- [ ] Zero scripted LinkedIn clicks executed by our code (verified by review of linkedin.ts)

---

## Phase 6 — Responses, Interviews, polish (Day 6, ~4-5 hours)

**Goal:** Full UI parity with Happy Agent (for in-scope features). Dashboard is dense enough to use daily.

### 6.1 Responses tab

- [ ] `features/my-activity/ResponsesTab.tsx` — grouped by job, each group shows positive/negative counts, expandable to show each reply with intent label and View Thread link
- [ ] `GET /api/activity?filter=replied` endpoint
- [ ] Filter: Reply Type (Positive / Negative / All)
- [ ] "View thread" opens Gmail web interface (or links to LinkedIn if that channel)

**Tests:**
- Integration: endpoint filters correctly
- Component: expand/collapse groups, filter changes list

### 6.2 Interviews tab

- [ ] `features/my-activity/InterviewsTab.tsx` — list of runs where `marked_as_interview = true`
- [ ] On My Activity row: "Mark as Interview" button → `PATCH /api/activity/:runId` with `{ markedAsInterview: true }` → writes `marked_as_interview` event
- [ ] "Unmark" to toggle back

**Tests:**
- Integration: PATCH toggles field
- Component: button state reflects marking

### 6.3 Daily cap counter

- [ ] Top bar shows `N/4 today` with info tooltip explaining the cap
- [ ] `GET /api/daily-cap` returns `{ used, max }`
- [ ] Run Agent button disabled when `used >= max`, tooltip explains "Resets tomorrow at midnight local"

**Tests:**
- Component: counter updates after each run
- Component: button disabled state

### 6.4 Provider credits telemetry card

- [ ] Sidebar card below nav items: list each registered adapter with `used / monthly_quota` or "unlimited"
- [ ] `GET /api/provider-credits` returns the `provider_credits` table
- [ ] Visual: progress bar per provider, red at > 80% used

**Tests:**
- Component: renders known provider list
- Integration: endpoint returns correct current state

### 6.5 Toast notifications (dashboard side)

- [ ] `shared/components/Toast.tsx` + `useToast` hook (the extension has its own Shadow-DOM toast; this is for in-dashboard events)
- [ ] Fire toast on Send success/failure, on queue mark-sent, on reply classification

(The old "dead-scrape alarm banner" item was removed with D10 — the on-demand capture model surfaces scrape failures in the extension toast immediately; no separate dashboard alarm needed.)

**Tests:**
- Component: toast shows, auto-dismisses after 5s

### 6.6 First real batch

- [ ] Alt+H on your top-3 Happy Agent jobs that match your profile best (hand-picked, not the first 3 you see)
- [ ] Run Agent on each from the dashboard; review modal, send to high-quality contacts only (5-8 total messages across 3 jobs — stay within week-1 warm-up per D6)
- [ ] Process the LinkedIn Queue (if any LinkedIn selections)
- [ ] Monitor Responses tab over day 7-9 for replies

**No automated tests — this is the live calibration.**

### Phase 6 acceptance criteria

- [ ] All v1 UI tabs are functional and populated with real data
- [ ] First batch of real outreach has gone out
- [ ] Dashboard is usable as a daily driver in ≤ 15 min of attention

---

## Phase 7 — Post-v1 polish (Day 7+)

Not blocking the 6-day interview target. Order these by whatever's biting hardest after week 1.

- [ ] **Follow-up CRON**: 3-business-day threaded nudges on silent Gmail threads. Uses `date-fns-business-days`. Logs `followup_sent` events.
- [ ] **Second DiscoverySource adapter**: `ServlyXRaySource` (2,500 one-time credits) or `ScrapflyXRaySource` (1,000 one-time credits, no card) as fallback when SerpAPI's monthly 250 depletes
- [ ] **Additional EmailFinder adapter**: `ProspeoFinder` or another (Snov is already day-1 per Phase 3.4a; Apollo is explicitly excluded per owner decision)
- [ ] **Second EmailVerifier adapter**: `ZeroBounceVerifier` as spill-over to Reoon
- [ ] **Reminder Alerts tab**: show overdue follow-ups and un-replied inbound messages
- [ ] **Resume tailoring**: AI-rewrite CV per job (Gemini call site)
- [ ] **LinkedIn reply detection**: poll user's LinkedIn messaging inbox (needs careful DOM-reading via content script; D1-compliant since read-only)
- [ ] **Scheduled runs** (Auto Run tab in Configure)
- [ ] **Blocked Companies list**
- [ ] **Dockerize** for easier re-deploy on a new machine

---

## Daily commit discipline

- One task per commit. Message format: `phase-<N>.<task>: <short description>`.
  Example: `phase-3.3: serpapi x-ray discovery adapter`
- Pre-commit: run `pnpm test` for the affected package.
- Branch `main` always boots. If a task leaves the system non-bootable, finish it before committing.
- Weekly: tag `v0.<phase>` when a phase completes.

---

## Living log

Keep a running log at `docs/log.md` noting:
- Which tasks took longer than estimated
- Any adapter free-tier numbers that drift from this doc
- Prompt refinements for Gemini classification
- UX decisions made during build that deviate from design.md (and why)

This becomes the real evidence that informs v2 planning.
