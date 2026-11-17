# Documentation plan: two people, no overlap

## Split

| | Person A: Technical docs | Person B: User docs |
|---|---|---|
| Audience | Backend and frontend developers, future maintainers, examiners | Revellers, artists, and each management role |
| Source of truth | `API.md`, `schema.dbml`, backend code, this folder | The running app (click through every screen) |
| Deliverables | README, API reference, data flows, middleware, use case, sequence, ERD | Reveller guide, artist guide, admin role guides, FAQ, troubleshooting |
| Tools | Mermaid (renders on GitHub), dbdiagram.io, Postman/Swagger | Screenshots, short step lists, a glossary |

## Person A checklist (technical)

1. The docs are already checked against the backend code. Re-verify after each backend merge, and walk through `known-issues.md` with the backend developer so each item becomes a fix or a documented decision.
2. Export the ERD image from dbdiagram.io and drop it in `technical/`.
3. Check each page in `src/pages` against the "Page data map" in `api-reference.md`. Correct the inferred rows.
4. Import the endpoints into Postman (one folder per section: Auth, Events, Bookings, Payments, Artists, Check-in, Tasks, Admin). Save example responses.
5. Close items in `known-issues.md` as they are fixed, and update `api-reference.md` in the same commit.
6. Re-check docs after every backend merge. Owner of each file: README = A, api-reference = A, data-flows = A.

## Person B checklist (user)

Write one short guide per audience, task-first ("How do I buy a ticket"), with screenshots:

0. Source for screens: the page tables in `technical/api-reference.md` list every route and what each screen does. Take screenshots from the running app to match.
1. **Reveller**: find an event, choose tier and quantity, enter phone and email, approve the M-Pesa prompt, what the 10 minute hold means, where the e-ticket appears, what to show at the gate.
2. **Artist**: open the emailed link, save preferences (stage plot, riders), add entourage members, what "verified" means.
3. **Management, by role**: manager (create staff accounts), coordinator (create event, edit, change stage, add artists, tasks), finance (costs, revenue metrics), compliance (audit logs), gate staff and logistics (scanner, offline mode, sync), hospitality (artist list).
4. **FAQ and troubleshooting**: payment prompt did not arrive, booking expired, ticket already used, forgot password, scanner offline.
5. **Glossary**: event stages, ticket tiers (regular, VIP, VVIP, early bird), booking vs ticket status.

## Shared rules

- Same names everywhere: use the exact UI labels and enum names from `api-reference.md`.
- One file per topic, plain Markdown, committed to `docs/` in the repo.
- Person A sends Person B a heads-up when a flow changes (stage rules, hold time, roles).
- Review each other's docs once: A checks user docs for factual accuracy, B checks technical docs for readability.

## Suggested timeline

| Day | A | B |
|---|---|---|
| 1 | Review known-issues with backend dev | Click through app, capture screenshots |
| 2 | Postman collection, ERD export | Reveller + artist guides |
| 3 | Update docs for fixed issues | Role guides for management |
| 4 | Cross-review | Cross-review, FAQ |
