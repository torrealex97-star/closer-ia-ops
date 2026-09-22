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
