-- One-shot: insert Vandana's actual LinkedIn DM + Gmail body templates.
-- Pairs with templates.md (source of truth). Used by Phase 5.3c to swap in
-- her text without waiting for a server restart.

INSERT INTO app_settings (key, value) VALUES
('linkedin.dm_template', $DMTEMPLATE$Hi {{outreachEmployeeName}},

I'm a full-stack developer (3+ yrs, Node.js/TypeScript/React/GraphQL) who ships production apps used by 7,000+ users, plus some hands-on AI work (agentic tools + RAG). I'm applying for {{jobTitle}} at {{companyName}} and it looks like a strong fit.

If you'd be open to referring me, I'd genuinely appreciate it — happy to share my resume too.

Here's the job link: {{jobLink}}

Thanks! Vandana$DMTEMPLATE$)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();

INSERT INTO app_settings (key, value) VALUES
('gmail.body_template', $GBTEMPLATE$Hi {{outreachEmployeeName}},

I'm reaching out personally rather than sending a generic note. I'm a full-stack developer with 3+ years of experience building and shipping production web apps used by 7,000+ users — mostly with Node.js, TypeScript, React, GraphQL, and PostgreSQL. I've also built AI features like an agentic assistant and a RAG-powered Q&A bot, and I love learning fast and working alongside strong engineers.

I'm applying for {{jobTitle}} at {{companyName}}, and it looks like a genuinely great fit for my background. If you'd be comfortable referring me, I'd truly appreciate it — I know a referral carries your name, and I'd be glad to share my resume or answer anything to make it an easy call.

Here's the link to the job: {{jobLink}}

Thanks so much for considering it!

Best, Vandana$GBTEMPLATE$)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
