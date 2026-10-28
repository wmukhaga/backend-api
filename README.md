# TikoSorted Backend - Explainer

## 1. How a request flows
Browser -> server.js -> global middleware (helmet, cors, json) -> routes/index.js -> a router
-> route middleware (requireAuth -> requireRole -> audit) -> handler -> db.js -> PostgreSQL -> JSON back.

## 2. Folder map
| Path | Purpose |
|---|---|
| src/server.js | Creates app, mounts middleware, serves `public/`, mounts `/api`, starts server |
| src/db.js | PostgreSQL pool, `query()`, `withTransaction()` |
| src/routes/ | One file per feature (auth, events, bookings, payments, artists, checkin, todo, admin) |
| src/middleware/ | auth (JWT), rbac (roles), idempotency, audit, errorHandler |
| src/utils, src/jobs | Helpers (QR signing, event stages) and background jobs (release expired holds) |
| schema.sql | The database (run once: `psql -d tikosorted -f schema.sql`) |
| public/ | HTML front-end (`/`) and admin panel (`/admin`) |

## 3. HTML vs JSON vs status code
- Page URLs (`/`, `/admin`) -> HTML from `public/` via `express.static`.
- `/api/*` -> JSON. The page JavaScript uses `fetch()` to call it.
- Status codes ride along with every JSON response: 200 OK, 201 created, 400 bad input, 401 not logged in, 403 wrong role, 404 missing, 409 conflict (sold out, bad stage jump).

## 4. Endpoints
| Method | URL | Who | Purpose |
|---|---|---|---|
| POST | /api/auth/login | staff | get JWT |
| POST | /api/auth/register | manager | create staff |
| POST | /api/auth/logout | staff | end session |
| GET | /api/events | public | browse events |
| GET | /api/events/:id | public | event detail |
| POST | /api/events | coordinator | create event + tiers |
| PATCH | /api/events/:id | coordinator | edit (draft/published only) |
| POST | /api/events/:id/stage | coordinator | move life-cycle stage / cancel |
| POST | /api/bookings/checkout | public | hold tickets (needs `Idempotency-Key` header) |
| GET | /api/bookings/:id/status | public | polling |
| GET | /api/bookings/:id/tickets | public | e-tickets after payment |
| POST | /api/payments/mpesa/stk-push | public | start M-Pesa (TODO) |
| POST | /api/payments/mpesa/callback | Safaricom | webhook (TODO) |
| GET/POST | /api/artists | coordinator | manage artists (TODO) |
| POST | /api/artists/verify/:token | artist | verify link (TODO) |
| PUT | /api/artists/me/profile | artist | preferences (TODO) |
| POST | /api/artists/me/entourage | artist | add entourage (TODO) |
| GET | /api/checkin/manifest/:eventId | gate_staff | download tickets for offline DB |
| POST | /api/checkin/scan | gate_staff | online scan |
| POST | /api/checkin/sync | gate_staff | upload offline scans |
| GET/POST/PATCH/DELETE | /api/tasks | staff | task tracking |
| GET | /api/admin/events/:id/metrics | finance, coordinator | dashboard |
| GET/POST | /api/admin/events/:id/costs | finance | costs |
| GET | /api/admin/audit-logs | compliance | audit trail |

## 5. How each non-functional requirement is met
- **Idempotency:** client sends a unique `Idempotency-Key`; `bookings.idempotency_key` is UNIQUE; repeat key returns the same booking. `payments.provider_ref` UNIQUE stops duplicate callbacks; `markBookingPaid` only acts on `held` bookings.
- **Concurrency:** `UPDATE ticket_tiers SET available = available - n WHERE available >= n` is atomic, plus a DB CHECK constraint. Holds expire after `HOLD_TTL_SECONDS`; `releaseExpiredHolds` job returns stock.
- **Offline:** `/checkin/manifest` -> local DB on device; scans queued; `/checkin/sync` reconciles, flagging duplicate scans as conflicts.
- **Privacy:** `audit()` middleware logs actor/action/time. TODO job: null booker PII after the event.

## 6. Run it
1. `npm install`
2. Create DB `tikosorted`, run `schema.sql`
3. Copy `.env.example` to `.env`, fill in values
4. `npm run dev`, open http://localhost:3000/api/health
5. Insert the first manager manually (hash a password with bcryptjs), since /register needs a manager.

## 7. Build order (suggested)
1. DB + schema -> 2. auth -> 3. events -> 4. checkout (bookings) -> 5. M-Pesa -> 6. check-in -> 7. artists -> 8. dashboard/reports -> 9. Docker.
