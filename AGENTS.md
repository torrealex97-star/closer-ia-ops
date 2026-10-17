# Career Platform

Read docs/PLAN.md, docs/STATUS.md and docs/spec/15_PRODUCT_VISION_AND_BOUNDARIES.md before work.
This repository is independent of Scalix. Never use its secrets, database or deployment.
Deliver one bounded, tested increment at a time. Read the relevant original spec and ADR before changing contracts.
Keep raw evidence immutable and separate from processing state. Connectors return raw candidates, never write jobs.
Always scope data access by organization; local single-operator mode is not hosted authentication.
No invented listings, salaries, dates or eligibility. Expose unknowns. A failed source must not hide successful results.
OpenAPI generates frontend types. Keep providers replaceable and paid integrations opt-in.
Run backend tests, web typecheck/build and relevant browser checks. Record evidence and limitations in docs/STATUS.md.
Do not deploy local mode publicly. Do not send messages or applications automatically without explicit configuration and authorization.

Architecture revision: docs/decisions/ADR-007-groq-opportunity-surfaces.md and docs/spec/16_LLM_PROVIDER_GROQ.md define Groq as the target default behind LLMProvider. Current runtime status remains in STATUS. Student WDCOpportunity is a separate allowlisted projection; never remove admin provenance or infer a direct WDC relationship from a public company URL. Documentation-only changes require link/consistency verification; do not claim runtime tests were run.

## Learned rules (adopted 2026-10-17; rationale in docs/LEARNINGS_GROWTH_OPS.md)

- Cron/serverless budgets: the sum of internal deadlines stays far below `maxDuration`. One shared clock per invocation; every external call checks it; a cut is declared (`truncated`) and the work is idempotent and resumable.
- Irreversible external effects (sending, publishing, deleting): atomic claim first (`UPDATE … WHERE status='draft'`, continue only if the row is yours). Always consume the result of every write (`ok`/`error`); a failed write is never counted as done.
- Paid scraping (Apify): estimate cost before running (per-result price × count); warn above 5 USD, require explicit confirmation above 20 USD; read the actor's input schema instead of guessing it.
- Every migration: behaviour test with `BEGIN … ROLLBACK` (saved under `tests/db/`) and Supabase advisors afterwards; version the SQL in `supabase/migrations/` in the same PR that applies it.
- Student data: never send student profile data to an LLM without a processing agreement and zero retention. Matching stays deterministic.
- Evidence wording in STATUS and PRs: *inspected* (read), *tested* (executed in a controlled or simulated environment), *verified* (confirmed against the real service). Never claim a higher level than was reached.

## Design and charts

- Before creating or changing any dashboard, KPI, chart, table or empty state in `apps/web`, read `.agents/skills/dashboard-design/SKILL.md` (and `docs/DESIGN.md`); theory in `data-visualization-pro`. Student-facing pages (`/alumna`, opportunities view) use `design-taste-frontend` within `docs/DESIGN.md`. No hex colors outside the tokens in `globals.css` (`npm run design`).
- A gap is not a zero: unknown / failed / unconfigured / empty are shown differently ("—" plus the cause). Color is never the only encoding. Every non-trivial chart has a text or table alternative.

## Working with several agents

- Read `docs/ACTIVE_HANDOFF.md` and run `node scripts/handoff.mjs list` before starting. One claim file per live job in `docs/handoff/claims/`; do not touch what another claim lists in `touches`. `npm run handoff` must pass. Rules and template: `docs/handoff/README.md`.
- One `in_progress` job per agent; stacked branches declare `depends_on`. Never delete or replace another agent's unmerged work. Without a merge-base there is no merge.
- At the end of a session leave either: validated (pushed, PR open, claim `validated`) or blocked (pushed, claim `blocked` with the exact next action). Do not merge dubious code just to close a session. Agents do not merge their own PRs unless the owner says so.

