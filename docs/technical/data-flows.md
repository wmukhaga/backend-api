# Data Flows, Middleware and Call Mechanics

Verified against `backend-api-main` (Express 4, ES modules, PostgreSQL via `pg`). Diagrams for these flows are in [diagrams.md](diagrams.md). Problems found while verifying are numbered and listed in [known-issues.md](known-issues.md), e.g. **(KI-14)**.

## 1. How a call happens

1. A page component calls a hook in `src/hooks/` (shared loading and error state in `useRequest.js`).
2. The hook calls a function in `src/utils/api.js`, the only place backend calls are made.
3. `api.js` sends `fetch('/api/...')` with JSON and, for staff routes, `Authorization: Bearer <token>`.
4. In dev, Vite forwards `/api/*` to `VITE_BACKEND_URL` (default `http://localhost:3000`). In Docker, Nginx serves the app and `config.js` carries the backend URL set at container start.
5. Backend: `server.js` -> `helmet`, `cors`, `morgan`, `express.json` -> `routes/index.js` -> a feature router -> route middleware (`requireAuth` -> `requireRole` -> `audit`) -> handler -> `db.js` -> PostgreSQL.
6. The response returns as JSON. `api.js` maps snake_case to camelCase. On `401` the frontend logs out. Errors currently arrive as `{ error }`, but the frontend reads `message` **(KI-1)**.

Backend folder map: `src/server.js` (app and startup), `src/db.js` (pool, `query`, `withTransaction`), `src/routes/*` (one router per feature), `src/middleware/*`, `src/utils/*` (`tickets.js` QR signing, `eventStages.js`), `src/jobs/releaseExpiredHolds.js`, `schema.sql`.

## 2. Reveller booking and payment pipeline

1. **Browse**: `GET /api/events` returns events in `published`, `on_sale`, `sold_out`, with tiers.
2. **Checkout**: frontend creates a UUID `Idempotency-Key` (backend requires at least 16 characters) and calls `POST /api/bookings/checkout`.
   - Checks: `tierId`, `quantity` 1 to 10, `phone`, `email` present. Formats are not checked **(KI-28)**.
   - If the key already exists, the stored booking is returned with `200`.
   - Otherwise, in one transaction: `UPDATE ticket_tiers SET available = available - qty ... WHERE available >= qty AND event_stage = 'on_sale'`. No row means `409 Not enough tickets available` (also returned for an unknown tier or an event that is not on sale).
   - Insert booking (`held`, `amount = price x qty`, `hold_expires_at = now + HOLD_TTL_SECONDS`, default 600) and one `tickets` row per seat (`held`). Returns `201` and the booking row.
3. **Pay**: `POST /api/payments/mpesa/stk-push`. Backend calls Daraja `stkpush` (OAuth token cached in memory). If Daraja answers `ResponseCode '0'`, it inserts `transaction_details` (`request_id = CheckoutRequestID`, `reference = booking id`, `result_code` null). The raw Daraja response goes back to the browser. The `payments` table is not written **(KI-19)**. Amount and reference come from the request body **(KI-14)**, and the frontend always sends `amount: 2` **(KI-48)**.
4. **Poll**: frontend calls `GET /api/bookings/:id/status` every 2.5 s for up to 5 min. Stops on `paid`, `expired`, `cancelled`.
5. **Webhook**: Safaricom calls `POST /api/payments/mpesa/callback`.
   - Missing `Body.stkCallback`: `400`.
   - `ResultCode != 0`: logged, responds with the same code, nothing stored **(KI-18)**.
   - `ResultCode = 0`: `transaction_details` is updated (result code, description, M-Pesa receipt number), then `markBookingPaid`:
     in one transaction find the booking id from `transaction_details.reference`, `UPDATE bookings SET status='paid' WHERE status='held'`, set all its tickets `paid`, and give each ticket `qr_payload = ticketId.eventId.signature` (HMAC-SHA256 with `TICKET_SIGNING_SECRET`, first 16 hex chars).
     After commit it emails the QR codes to `booker_email` (failures are logged and never fail the payment).
   - Responds `{ "ResultCode": 0, "ResultDesc": "Accepted" }`.
   - Safety: the booking update only matches `held`, so a repeat callback changes nothing, but it re-sends the email **(KI-17)**. The callback is unauthenticated and the paid amount is not compared **(KI-14, KI-15)**. A payment arriving after expiry is not handled **(KI-16)**.
6. **Hold expiry**: `startHoldSweeper()` runs every 45 s inside the server process. In a transaction with `FOR UPDATE SKIP LOCKED` it finds `held` bookings past `hold_expires_at`, adds the quantity back to `ticket_tiers.available`, sets the booking `expired`, and deletes its `held` tickets.
7. **Ticket**: `GET /api/bookings/:id/tickets` returns `paid | verified | used` tickets with `event_name` and `type`. The ticket email links to `${FRONTEND_URL}/ticket/:bookingId`.

## 3. Admin sets up an event

1. Coordinator (or manager) `POST /api/events` with `name`, `location`, `eventDate`, `tiers[]` and optional `headliner`. One transaction inserts the event (`draft`, `approver_id` = the creating user) and each tier (`available = total`). Duplicate tier types fail on `UNIQUE(event_id, type)`.
2. `PATCH /api/events/:id` updates name, headliner, location, date, only while `draft` or `published`; otherwise `409`.
3. `POST /api/events/:id/stage` moves the event. Illegal jumps return `409 Cannot move from X to Y`. Setting `cancelled` also sets `is_cancelled = true`. Nothing else happens on cancel yet **(KI-35)**.
4. Finance adds cost lines (`POST /api/admin/events/:id/costs`), can edit them (`PATCH .../costs/:costId`), and reads metrics.
5. Every write route that uses the `audit()` middleware writes an `audit_logs` row after a successful response.

### Event stage state machine (from `utils/eventStages.js`)

| From | Allowed next |
|---|---|
| draft | published, cancelled |
| published | on_sale, cancelled |
| on_sale | sold_out, ongoing, cancelled |
| sold_out | on_sale, ongoing, cancelled |
| ongoing | completed, cancelled |
| completed | none |
| cancelled | none |

Stage changes are manual. Checkout only works in `on_sale`. `sold_out` is not set automatically **(KI-34)**.

## 4. Tasks pipeline

- Any logged-in staff can use `/api/tasks`.
- Create: `eventId` and `title` required; `assignedTo` (a `mgt_users.user_id`, from `GET /admin/management-team`), `deadline`, `resource` optional. Status defaults to `todo`.
- Update: `PATCH` changes only the keys sent, from `status`, `title`, `deadline`, `resource`. A status outside `todo | in_progress | done` fails the CHECK constraint and returns 500 **(KI-28)**.
- Board: `GET /admin/tasks` returns `COMPLETED` for `done`, otherwise uppercase status, with the assignee name in `teamOnboard`.
- Dashboard: `openTasks` = status not `done`; `completedTasks` = `done`.

## 5. Artist pipeline

1. Coordinator `POST /api/artists` -> insert artist with a token of the form `<issued-at base36>.<64 hex>` and `verification_sent = true`, then email `${FRONTEND_URL}/artist/verify/<token>`. If the email cannot be sent the artist row is deleted and the call returns `502`. Duplicate `(event, email)` returns `409`; unknown event `404`.
2. Artist opens the link; the frontend calls `POST /api/artists/verify/:token`. Links older than 72 h return `410`. Otherwise `is_verified = true`, the token is cleared, and an artist JWT is returned (payload `artistId`, `type: artist`, signed with `ARTIST_TOKEN_SECRET`, lifetime 2 h). A used or unknown token returns `404`.
3. `PUT /api/artists/profile` stores the text as `{ "notes": "..." }` in the `preference` JSONB column. `GET /api/artists` returns it as the string `preferences`.
4. `POST /api/artists/entourage` with `members[]`. All members are validated first, then each is inserted and sent an email link `${FRONTEND_URL}/entourage/verify/<jwt>?artistId=...` (72 h). A failed email deletes that member and returns `502`; members saved earlier in the loop stay saved **(KI-38)**.
5. The member opens the link: `POST /api/artists/entourage/verify/:token?artistId=...` sets `entourage.is_verified = true`. This endpoint is not in the frontend `API.md`.
6. Coordinator and hospitality read everything with `GET /api/artists?eventId=`.

## 6. Gate check-in pipeline

All check-in routes require login and role `gate_staff` or `logistics` (managers pass every role check).

- **Manifest**: `GET /checkin/manifest/:eventId` returns tickets with status `paid` or `verified` (with tier type, price, event name) for local storage on the device.
- **Validate**: `POST /checkin/validate` checks a ticket without consuming it.
- **Scan (online)**: `POST /checkin/scan` with `{ payload }` (verifies the HMAC, then marks the ticket used) or `{ ticketId, eventId }`. The atomic `UPDATE ... WHERE status IN ('paid','verified')` guarantees only one scan wins; otherwise `409`. No audit row and no `offline_sync_logs` row is written.
- **Sync (offline)**: `POST /checkin/sync` with `{ deviceId, scans: [{ ticketId, scannedAt }] }`. For each scan it tries the same update, then inserts an `offline_sync_logs` row with `conflict = (no row updated)` and `is_reconciled = true`. Winner is the first scan processed, not necessarily the earliest `scannedAt` **(KI-33)**. Signatures are not re-verified **(KI-29)**.
- QR payload format: `<ticketId>.<eventId>.<16 hex signature>`.

## 7. Middleware and request pipeline (what actually exists)

| Order | Component | File | What it does |
|---|---|---|---|
| 1 | `helmet` | `server.js` | Security headers, with the Content-Security-Policy turned off |
| 2 | `cors()` | `server.js` | Allows every origin **(KI-25)** |
| 3 | `morgan('dev')` | `server.js` | Logs each request to the console |
| 4 | `express.json()` | `server.js` | Parses JSON bodies into `req.body` (default 100 kB limit) |
| 5 | Router | `routes/index.js` | Mounts `/health`, `/auth`, `/events`, `/bookings`, `/payments`, `/artists`, `/checkin`, `/tasks`, `/admin` under `/api` |
| route | `requireAuth` | `middleware/auth.js` | Reads Bearer token, verifies the JWT with `JWT_SECRET`, then checks `mgt_auth` for a matching `token_id` with `is_active` and unexpired `expires_at`. Fails with `401` (Login required, Invalid or expired token, Session ended). Dev-only bypass with `BYPASS_AUTH=true` when `NODE_ENV` is not production |
| route | `requireRole(...roles)` | `middleware/rbac.js` | `403` unless the user role is listed. **Managers always pass** **(KI-23)** |
| route | `requireArtist` | `routes/artistRoutes.js` | Verifies the artist JWT (`ARTIST_TOKEN_SECRET`, `type = artist`) and sets `req.artistId`. `401` otherwise |
| route | `requireIdempotencyKey` | `middleware/idempotency.js` | Requires an `Idempotency-Key` header of 16+ characters (`400` otherwise). Replay logic lives in the checkout handler |
| route | `audit(action, resource)` | `middleware/audit.js` | After the response finishes with status below 400, inserts an `audit_logs` row: actor, action, resource (table name), metadata (method, URL, IP, params) |
| after routes | `notFound` | `middleware/errorHandler.js` | Unknown `/api/*` route returns `404` |
| last | `errorHandler` | `middleware/errorHandler.js` | Maps errors to `{ error }` with the thrown status. Postgres code `22P02` becomes `400 Invalid ID or value format`. Everything else becomes `500 Internal server error` |
| helper | `wrap`, `httpError` | `middleware/errorHandler.js` | `wrap` forwards async errors to `errorHandler`. `httpError(status, msg)` creates the error |

Utilities in `middleware/` that are services, not request middleware: `email.js` (Nodemailer SMTP, ticket and verification emails, dev mode logs emails to the console), `mpesa.js` (Daraja token, `stkpush`, `requestUpdate`).

Not applied: `rateLimit.js` is written (100 requests per 15 min per IP) but never mounted **(KI-22)**. `apiSecurity.js` is empty and unused **(KI-30)**.

Audit actions written today: `login`, `create_user`, `create_event`, `update_event`, `change_event_stage`, `add_artist`, `create_task`, `update_task`, `delete_task`, `add_cost`, `edit_cost`.

## 8. Environment variables

| Variable | Used for |
|---|---|
| `PORT` | HTTP port (default 3000) |
| `NODE_ENV` | `production` disables the auth bypass and makes missing SMTP an error |
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_SECRET`, `JWT_EXPIRES_IN` | Staff JWT signing and lifetime (default 8h) |
| `ARTIST_TOKEN_SECRET` | Artist and entourage JWTs |
| `TICKET_SIGNING_SECRET` | HMAC for QR payloads |
| `HOLD_TTL_SECONDS` | Booking hold time (default 600) |
| `BYPASS_AUTH` | Dev only: skip login |
| `MPESA_CONSUMER_KEY`, `MPESA_CONSUMER_SECRET`, `MPESA_BASE_URL`, `MPESA_SHORTCODE`, `MPESA_PASSKEY`, `MPESA_CALLBACK_URL`, `MPESA_TRANSACTION_TYPE` | Daraja STK push (callback URL must be public HTTPS) |
| `EMAIL_HOST` (or `SMTP_HOST`), `EMAIL_PORT`, `EMAIL_USER`, `EMAIL_PASS`, `EMAIL_SECURE`, `MAIL_FROM`, `APP_NAME` | Outgoing email |
| `FRONTEND_URL` | Base for links in emails (`/artist/verify`, `/entourage/verify`, `/ticket`) |

## 9. Database constraints that DBML does not show

`schema.sql` adds rules the DBML omits: `price >= 0`; `total >= 0`; `available >= 0 and available <= total` (the last guard against overselling); `no_of_tickets > 0`; `payments.method in ('mpesa','card')`; `payments.status in ('pending','success','failed')`; `tasks.status in ('todo','in_progress','done')`; `costs.amount >= 0`; `ON DELETE CASCADE` from users to auth, events to tiers, artists, costs and tasks, bookings to tickets, and artists to entourage.
