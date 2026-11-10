# My Activity — design brief for Phase 4.7

> **Status:** In build (phase-4.7) · **Owner:** Vandana · **Reference:** 5 Happy Agent screenshots captured Oct–Nov 2026 (initial 4 during the Phase 5.3 LinkedIn Queue UI session; 1 more during Phase 4.7 kick-off showing the Preeti popover timeline). The screenshots are the visual source of truth for layout; this file is the written capture so context compaction doesn't lose details.
>
> **Rule for the agent:** This file is authoritative. If anything differs between here and the SS when building, flag it and ask — don't guess.

The Phase 4.7 spec task says "renders runs with their contacts" at a high level. Vandana provided screenshots that show the actual UX we're mirroring, and the shape goes significantly beyond "table of runs". This file is the full design brief so a future build session hits the right target without re-asking.

---

## Changed Nov 2026 — row = job, not run

The initial build showed one row per run. Vandana ran the agent multiple times on the same job during testing and the dashboard filled with duplicate rows per company. We now **group by `jobs.job_url`** — one row per unique job, however many Run Agent clicks landed on it.

Grouping rules (locked):
- **Status** of the row = the LATEST run's status (`ORDER BY runs.created_at DESC LIMIT 1`). Where did my most recent attempt land?
- **Marked-as-interview** = true if ANY run in the group is flagged (one interview outcome belongs to the whole job).
- **Last Activity** = MAX across all runs' `last_activity` (each run's `last_activity` is already MAX of its contact timestamps).
- **Contacts** are deduped across runs by `linkedinUrl || email || name` (lowercased). The representative row = contact with the most timeline events (richest history wins); tiebreaker is latest `last_activity`.
- **Per-contact timeline** = union of events across every row that collapsed into the dedupe bucket, sorted chronologically. The user sees "this person's full outreach history across every run" instead of three disconnected mini-histories.
- **selected_for_gmail / selected_for_linkedin** = true if ANY row in the dedupe bucket was selected — so a pill appears if the user ever reached out via that channel.

Everything else in this brief still applies — only the grouping unit changed.

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

## Table — collapsed row (one per unique job)

Columns: `No. | Run By | Company | Role | Status | Last Activity`

- **No.** — 1-indexed row counter per filter result, not `job.id` or `run.id`.
- **Run By pill** — `You` (slate pill) for manual, `Auto` (teal pill) for scheduled. v1 is always `You`.
- **Company** cell — company icon + name + a chevron that expands/collapses the row's deduped contact list.
- **Role** cell — job title with external-link icon. Opens `job.job_url` in a new tab.
- **Status pill** — latest run's status: `COMPLETED` (emerald), `IN_PROGRESS` (amber), `FAILED` (rose). Matches our `shared/components/Badge.tsx` tone palette.
- **Last Activity** — two lines: date on top, time below. Right-aligned. MAX across all runs' `last_activity`.

Derivation:
- Per-run `last_activity` = `MAX(contacts.last_activity) WHERE contacts.run_id = run.id`. We already maintain the column everywhere the orchestrator / poller touches a contact. Per-job `last_activity` = MAX across runs.

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
`[in LinkedIn ↗  ●]` where:
- Clicking anywhere on the pill opens the message viewer popover. The `↗` glyph is cosmetic in this slice — "open profile on LinkedIn" is exposed as a link INSIDE the popover (so clicking the pill isn't ambiguous).
- The dot (`●`) at the right of the pill is a status indicator — a small filled circle, not a numeric badge. v1 color map (locked in Nov 2026 — Happy's own badge shows a numeric reply count, but our reply model only yields 0 or 1, so dot-only is strictly more useful):
  - PENDING, CONNECT_DRAFTED, CONNECT_SENT → amber (in flight, awaiting external action)
  - CONNECTED, DM_DRAFTED → amber (still pending from user's perspective — DM not yet sent)
  - DM_SENT → emerald (we're done; waiting for reply)
  - REPLIED → emerald (they replied; good outcome)
  - DECLINED → rose (external no-go)
  - SKIPPED → slate (user explicitly skipped)
- When Phase 4.5 reply classification lands, the dot can split into sentiment-aware tones (POSITIVE / NEGATIVE). Not v1.

## The message viewer (THE big feature of this page)

This is what makes My Activity more than a status table. Clicking a channel pill opens a popover anchored to the pill. Clicking the "Click to pin full message" footer promotes the popover content to a persistent inline panel below the contact row. Multiple contacts can be pinned at once.

### Popover contents

**Timeline section** — one row per outreach-lifecycle milestone, in chronological order. Each row: green `✓` icon on the left, label, `Done` tag (slate) on the right. Terminal states use their own icon + tone (see below).

**v1 vocabulary (locked in from Happy's SS, Nov 2026):**

| Event source | Timeline row label |
|---|---|
| `linkedin_connect_sent` | `Connection sent` |
| `linkedin_acceptance_detected` | `Connection accepted` |
| `linkedin_dm_sent` | `Message sent` |
| `gmail_sent` (Phase 4.4) | `Message sent` |
| `reply_received` | `Reply received` |
| `queue_skipped` | `Skipped` (slate ✘, no "Done" tag) |
| future `followup_sent` | `Follow-up` — hidden row until the event exists |
| future `30-day silent` derivation | `Declined` (rose ○) |

**Filtered OUT** of the timeline (noise for a user-facing view):
`contact_discovered`, `email_find_attempted`, `email_found`, `email_not_found`, `email_verified`, `email_unverifiable`, `contact_selected`, `linkedin_connect_drafted`, `linkedin_dm_drafted`, `gmail_queued`.

These are internal workflow states; the user only cares about world-visible milestones.

**MESSAGE section** (below the timeline):
- Label: `MESSAGE` (small uppercase)
- Body: the actual sent text.
  - LinkedIn → `contact.linkedin_dm_draft` (stored at auto-draft time)
  - Gmail → **not stored today, Phase 4.4 blocker.** v1 popover shows the greyed-out placeholder: `Email not dispatched yet. Gmail dispatch arrives in Phase 4.4.`
- Body scrolls inside the popover (max ~8 lines before scroll).
- Footer link: `Click to pin full message` → the pinned panel takes over below the row and the popover closes.

### Pinned (inline) view

Same timeline + message content, rendered as an attached panel below the contact row instead of as a floating popover. Multiple contacts can be pinned simultaneously (side-by-side comparison). Click the pill again (or an `×` affordance on the pinned panel) to collapse.

**Pin state is local component state in `MyActivityPage.tsx`** — lost on page refresh. Keeps the slice small; if we want cross-session persistence later we add `localStorage` or a user preference.

---

## Data model implications

### Backend (as shipped)

Single endpoint: `GET /api/activity` returns `{ tabCounts: {...}, jobs: [{ jobKey, runBy, status, markedAsInterview, lastActivity, company, jobTitle, jobUrl, runIds[], contacts: [{...contactView, timeline: {linkedin, gmail}}] }] }`. Contacts are already deduped and timelines unioned per the grouping rules above.

Three queries composed in `services/activity.ts`:
1. `listRunsWithJob()` — one row per run with job inlined, newest-first.
2. `listContactsForRuns(runIds)` — all contacts across those runs.
3. `listTimelineEventsForContacts(contactIds)` — only outreach-lifecycle events (TIMELINE_EVENT_TYPES in the repo).

Grouping + dedup happens in the service layer. Everything up-front; filters are client-side in v1. When the list exceeds ~100 jobs we'll push filters server-side with query params and consider lazy-loading contacts.

### Database — nothing new needed

Every field above is already in the schema:
- Runs → company + role via `jobs` join.
- Status + last_activity → `runs` + `contacts.last_activity`.
- Timeline → `events` table (filter by `contact_id` and event type).
- Message body → `contact.linkedin_dm_draft` for LinkedIn (populated by inbound poller auto-draft).

The one gap: **Gmail body isn't stored anywhere.** When Phase 4.4 (Gmail dispatch) lands, we need to persist the rendered body somewhere — either a new `contact.gmail_body` column (symmetric with `linkedin_dm_draft`) or a new `event_payloads` field. Flagged for the Phase 4.4 build.

---

## Template extension — resolved (not needed)

Earlier draft of this brief proposed a `{{jobTitleFull}}` variable (concatenate `jobTitle | mustHaveSkills | experienceRange | locationHint`) based on an interpretation of one Happy screenshot. When Vandana pasted her actual LinkedIn DM template in phase-5.3c, it uses just `{{jobTitle}}` — not the concatenated form. **No template extension needed in Phase 4.7.** Templates work as-is from the spec's four-variable set.

---

## v1 scope cut

Build in Phase 4.7:
- `/api/activity` endpoint returning runs + contacts + per-contact event timeline + stored message bodies, in one payload (small-volume shortcut, split later).
- `features/my-activity/MyActivityPage.tsx` with the table, filters, expand/collapse.
- Message popover on channel-pill click.
- Pin → inline panel (local component state).
- `All Activity` tab wired; `Responses` and `Interviews` tabs stubbed with counts only.

Deferred (named owners / phases below):
- Date range server-side filter pushdown (Phase 6 if needed; v1 keeps client-side).
- Responses tab actual contents (Phase 6.1).
- Interviews tab actual contents + "Mark as Interview" button (Phase 6.2).
- Gmail body display in message viewer with real text (needs Phase 4.4 to persist Gmail body on send). v1 popover shows the "Email not dispatched yet" placeholder.
- Reply classification sentiment+intent as a sub-row under `Reply received` (Phase 4.5).
- Cross-session pin persistence (localStorage or user prefs — only if the UX friction surfaces).
- Numeric reply-count badge on the LinkedIn pill (Happy's version). v1 ships a status-color dot; swap or augment when Phase 4.5 ships multiple-reply tracking.
- Column header `(?)` tooltips (Happy shows `Status (?)` and `Run By (?)`). Nice-to-have; skip in v1 unless the labels are ambiguous in use.
