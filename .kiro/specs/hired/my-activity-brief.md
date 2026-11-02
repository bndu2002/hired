# My Activity — design brief for Phase 4.7

> **Status:** Pending build · **Owner:** Vandana · **Reference:** screenshots captured from Happy Agent (Oct 2026) during the Phase 5.3 LinkedIn Queue UI session. The screenshots are the source of truth for layout; this file is the written capture so context compaction doesn't lose details.

The Phase 4.7 spec task says "renders runs with their contacts" at a high level. Vandana provided four Happy Agent screenshots that show the actual UX we're mirroring, and the shape goes significantly beyond "table of runs". This file is the full design brief so a future build session hits the right target without re-asking.

---

## Page layout

Top row (above the table):
- Page title: `Job Referral Activity` on the left.
- Search box on the right: placeholder `Company or role…`. Filters the table client-side on `company_name` + `job_title` substring.
- (Happy Agent has a `+ Paste Job Link` button here. We don't carry it — `requirements.md § 5` defers paste-link to v2.)

Tab strip:
- `All Activity (N)` · `Responses (N)` · `Interviews (N)`
- Counts in parens, pulled from the same response.
- **v1 scope:** only wire `All Activity`. The other two tabs render a placeholder count and empty state until Phase 6.1 and 6.2.

Filter row:
- `Run by [All runs ▾]` — options `All runs / Manual / Auto`. v1 is always Manual (D7, no auto-run), so this filter is a UI placeholder.
- `Referral Status [Success ▾]` — maps to our `runs.status`: `Success → COMPLETED`, plus `In progress → IN_PROGRESS`, `Failed → FAILED`, `All`.
- `Last Activity [dd-mm-yyyy] to [dd-mm-yyyy]` — date range filter on the derived "last activity" timestamp per run.

## Table — collapsed row (one per run)

Columns: `No. | Run By | Company | Role | Status | Last Activity`

- **No.** — 1-indexed row counter, not `run.id`. Resets per filter result.
- **Run By pill** — `You` (slate pill) for manual, `Auto` (teal pill) for scheduled. v1 is always `You`.
- **Company** cell — company icon + name + a people-group icon with a chevron that expands/collapses the row's contact list.
- **Role** cell — job title with external-link icon. Opens `job.job_url` in a new tab.
- **Status pill** — `COMPLETED` (emerald), `IN_PROGRESS` (amber), `FAILED` (rose). Matches our `shared/components/Badge.tsx` tone palette.
- **Last Activity** — two lines: date on top, time below. Right-aligned.

Derivation:
- `last_activity` per run = `MAX(contacts.last_activity) WHERE contacts.run_id = run.id`. We already maintain the column everywhere the orchestrator / poller touches a contact.

## Table — expanded row (contacts under the run)

When the user clicks the chevron, the row expands to show the 1-8 contacts in that run, nested under the parent row.

Per contact:
- `01, 02, 03…` numbered within the run (not `contact.id`).
- **Name** (bold) — pulled from `contact.name`.
- **Title line** (small gray, below name) — pulled from `contact.title`.
- Right side: label `Contacted Via:` followed by one or more channel pills.

Channel pills shown ONLY for channels the contact was selected for:
- `selected_for_gmail = true` → render email pill
- `selected_for_linkedin = true` → render LinkedIn pill
- Both true → render both

### Email pill shape
`[📧 email@domain.com ✓]` where the ✓ ring is green when `email_verified = true` and amber when false. The address text is small-slate; the ring is the status signal.

### LinkedIn pill shape
`[in LinkedIn ↗  <status badge>]` where:
- Clicking the pill does TWO things (see below): opens the message viewer AND, as a side effect of the `↗`, could open the profile — but to avoid ambiguity we open the message viewer on pill click and expose "Open on LinkedIn" inside the popover.
- Status badge is a small circle inside the pill with a count/dot that reflects `linkedin_status`:
  - CONNECT_DRAFTED / CONNECT_SENT → amber dot
  - CONNECTED / DM_DRAFTED → amber dot (still pending from user's perspective)
  - DM_SENT → emerald dot
  - REPLIED → emerald dot + a small count
  - DECLINED → rose dot

The exact badge content is a UX nicety — in v1 keep it simple with just the status color.

## The message viewer (THE big feature of this page)

This is the piece that makes My Activity more than a status table. Clicking a channel pill opens a popover anchored to the pill. Clicking anywhere in the popover's message body pins it inline — the popover closes and the message becomes a persistent expanded panel attached to the contact row.

### Popover contents

**Timeline section** (bulleted list, chronological):
- `✓ Message sent — Done` (date/time on the right of the row)
- `✓ Follow-up — Done` (date/time — v1 doesn't send follow-ups, so hide this row entirely unless a `followup_sent` event exists)
- Future rows as more events accumulate (`✓ Reply received`, intent tag, etc.)

For LinkedIn in v1 this reads from these events:
- `linkedin_connect_sent` → "Connect sent"
- `linkedin_dm_sent` → "DM sent"
- `reply_received` channel=linkedin → "Reply received"

**MESSAGE section** (below the timeline):
- Label: `MESSAGE` (small uppercase)
- Body: the actual sent text. For LinkedIn this is `contact.linkedin_dm_draft` (we already store it at auto-draft time). For Gmail it's the email body — not stored today, Phase 4.4 blocker.
- The body wraps naturally; max ~8 lines before an in-popover scroll kicks in.
- Footer link: `Click to pin full message` → promotes the popover content into an inline expanded panel below the contact row.

### Pinned (inline) view

Same timeline + message content, but rendered as an attached panel below the row instead of a popover. Multiple contacts can be pinned simultaneously — gives Vandana a side-by-side view of several outreach messages at once. Clicking the pill again (or an explicit close affordance on the pinned panel) collapses it back.

---

## Data model implications

### Backend

- `GET /api/activity` — returns `{ runs: [{ runId, no, runBy, company, jobTitle, jobUrl, status, lastActivity, counts: { contactsTotal, replied, interviews } }] }`. The counts drive the tab headers. This payload does NOT include per-contact detail.
- `GET /api/activity/runs/:runId/contacts` — called when a user expands a row. Returns `[{ contactId, no, name, title, selectedForGmail, selectedForLinkedin, email, emailVerified, linkedinUrl, gmailStatus, linkedinStatus }]`.
- `GET /api/contacts/:id/history?channel=linkedin|gmail` — called when a user clicks a channel pill or expands the pinned panel. Returns `{ timeline: [{ eventType, at, label }], message: { body, renderedAt } | null }`. Lazy-loaded so the main /activity response stays tight.

### Scope note

Three endpoints is a lot. Pragmatic v1: fold them into `/api/activity?include=contacts,history` returning everything up front. The main dashboard is only going to be a few dozen runs in week 1; profiling says "do the simple thing until it's slow". Keep `GET /api/contacts/:id/history` on the roadmap for when the list is 100+ rows.

### Database — nothing new needed

Every field above is already in the schema:
- Runs → company + role via `jobs` join.
- Status + last_activity → `runs` + `contacts.last_activity`.
- Timeline → `events` table (filter by `contact_id` and event type).
- Message body → `contact.linkedin_dm_draft` for LinkedIn (populated by inbound poller auto-draft).

The one gap: **Gmail body isn't stored anywhere.** When Phase 4.4 (Gmail dispatch) lands, we need to persist the rendered body somewhere — either a new `contact.gmail_body` column (symmetric with `linkedin_dm_draft`) or a new `event_payloads` field. Flagged for the Phase 4.4 build.

---

## Template extension (parallel sub-task)

Vandana's actual LinkedIn DM template references more context than our current 4-variable set (`outreachEmployeeName / jobTitle / companyName / jobLink`). Example from the screenshot:

> I'm applying for **AI Full Stack Developer | Java, Spring Boot, React and GenAI | 2 - 4 Years | 100% Remote (Work from Home)** at Avensys Consulting

The bold string is `jobTitle | mustHaveSkills | experienceRange | locationHint` joined with ` | `. Our current render can't produce this.

**Proposed extension (needs its own small slice OR fold into Phase 4.7):**
- Add `{{jobTitleFull}}` — computed in the render context, format: non-null fields of `jobTitle / mustHaveSkills / experienceRange / locationHint` joined by ` | `.
- Update `settingsSeeder.ts` default DM template to use it.
- Update `gmailInboundPoller.ts::autoDraftDmForContact` render context.
- Document in `requirements.md § 4.6` and `design.md § 12` as a spec extension, not a drift.

If the user wants a different pitch per contact, the DM auto-draft is still a "starting draft" — the Queue UI's `Copy draft` makes it easy to edit before pasting to LinkedIn. No per-contact AI rewriting is in scope for v1.

---

## v1 scope cut

Build in Phase 4.7:
- `/api/activity` endpoint returning runs + contacts + per-contact event timeline + stored message bodies, in one payload (small-volume shortcut, split later).
- `features/my-activity/MyActivityPage.tsx` with the table, filters, expand/collapse.
- Message popover on channel-pill click.
- Pin → inline panel (local component state).
- `All Activity` tab wired; `Responses` and `Interviews` tabs stubbed with counts only.

Deferred (named owners / phases below):
- Date range server-side filter pushdown (Phase 6 if needed).
- Responses tab actual contents (Phase 6.1).
- Interviews tab actual contents + "Mark as Interview" button (Phase 6.2).
- Gmail body display in message viewer (needs Phase 4.4 to actually persist Gmail body).
- Reply classification sentiment+intent in the timeline (Phase 4.5).
- `{{jobTitleFull}}` template variable — ideally fold into Phase 4.7 if small enough; else its own slice.
