# Outreach templates — source of truth

> **Owner:** Vandana · **Last confirmed:** Nov 3, 2026 (phase-5.3c) · **Rule:** This file is authoritative. If anything about these templates needs to change, edit here FIRST, then sync to:
>   1. `apps/server/src/services/settingsSeeder.ts` (seeded defaults for new installs / fresh DBs)
>   2. The running DB via `PUT /api/settings/:key` (so already-booted servers pick up the change without reseeding)
>
> **Rule for the agent:** Never invent template text. Never guess template text. If a template is missing in context, STOP and ask the user to paste it before writing or seeding.

---

## 1. LinkedIn connect note — NOT USED

Flow B (design.md § 11) sends BARE LinkedIn connect requests. No custom note is rendered on the connect leg. See the `⚠ FLOW B INVARIANT ⚠` comment in `settingsSeeder.ts`. A `linkedin.connect_template` setting IS seeded for a possible future "noted connect" option but nothing reads it.

If you ever wire this to a render path, that's a spec change — update `design.md § 11` first.

## 2. LinkedIn DM template (after acceptance) — ACTIVE

Setting key: `linkedin.dm_template`

```
Hi {{outreachEmployeeName}},

I'm a full-stack developer (3+ yrs, Node.js/TypeScript/React/GraphQL) who ships production apps used by 7,000+ users, plus some hands-on AI work (agentic tools + RAG). I'm applying for {{jobTitle}} at {{companyName}} and it looks like a strong fit.

If you'd be open to referring me, I'd genuinely appreciate it — happy to share my resume too.

Here's the job link: {{jobLink}}

Thanks! Vandana
```

**Variables used:**
- `{{outreachEmployeeName}}` — full name from `contacts.name` (post Q1 fix, Nov 3). No name splitting; the full name as discovered. This correctly handles honorific prefixes like "Md", "Er.", "Dr." which the splitter was mangling.
- `{{jobTitle}}` — from `jobs.job_title`
- `{{companyName}}` — from `jobs.company_name`
- `{{jobLink}}` — from `jobs.job_url`

## 3. Gmail body template — SEEDED, dispatch lands in Phase 4.4

Setting key: `gmail.body_template`

```
Hi {{outreachEmployeeName}},

I'm reaching out personally rather than sending a generic note. I'm a full-stack developer with 3+ years of experience building and shipping production web apps used by 7,000+ users — mostly with Node.js, TypeScript, React, GraphQL, and PostgreSQL. I've also built AI features like an agentic assistant and a RAG-powered Q&A bot, and I love learning fast and working alongside strong engineers.

I'm applying for {{jobTitle}} at {{companyName}}, and it looks like a genuinely great fit for my background. If you'd be comfortable referring me, I'd truly appreciate it — I know a referral carries your name, and I'd be glad to share my resume or answer anything to make it an easy call.

Here's the link to the job: {{jobLink}}

Thanks so much for considering it!

Best, Vandana
```

**Variables used:** same four as the LinkedIn DM (`outreachEmployeeName`, `jobTitle`, `companyName`, `jobLink`).

**Open items (ASK Vandana, do not guess):**
- `gmail.subject_template` — the Gmail subject line. Not provided yet. Needs to be a separate setting with its own placeholder set (same four variables plus whatever else makes sense for a subject). ⚠ do NOT seed a default guess for this.

## 4. Resume handling

Deferred. Three paths captured in the Phase 5.3c conversation (resume URL in body / manual LinkedIn attach via paperclip / Gmail MIME attachment in Phase 4.4). Discuss separately before adding any `{{resumeLink}}` variable or `user.resume_url` setting.

---

## Audit trail

| Date | Change | Confirmed by |
|------|--------|--------------|
| 2026-10-30 | Initial seeder defaults (my invention, generic). Variables used: firstName/myName. | — (drift, not confirmed) |
| 2026-11-02 | Drift fix: variable names aligned to spec (outreachEmployeeName/jobLink), seeded defaults rewritten by me. Still my copy, not Vandana's. | — (drift, not confirmed) |
| 2026-11-03 | **Vandana pasted her actual LinkedIn DM + Gmail body templates. Saved here verbatim. Seeder and DB updated to match.** | ✓ Vandana, phase-5.3c |
