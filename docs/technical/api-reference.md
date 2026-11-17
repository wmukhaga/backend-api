# TikoSorted API Reference

Source: the backend code (`backend-api-main`) is the source of truth for behaviour; frontend `API.md` for what the UI sends. Where they disagree, this file says what the **backend actually does** and links the entry in [known-issues.md](known-issues.md) as **KI-n**.

## Conventions

| Item | Rule |
|---|---|
| Base path | `/api` (dev: Vite proxies to `VITE_BACKEND_URL`, default `http://localhost:3000`) |
| Format | JSON request and response. Lists are plain arrays |
| Dates | ISO 8601, e.g. `2026-12-05T18:00:00Z` |
| Money | Number in whole KES, e.g. `2500` |
| Phone | `2547XXXXXXXX`, digits only, no `+` |
| Enums | UPPER_SNAKE_CASE on the wire. Database stores lowercase |
| Auth header | `Authorization: Bearer <token>`. Staff and artist tokens are different JWTs |
| Errors | non-2xx. **Backend sends `{ "error": "..." }`; the frontend expects `{ "message": "..." }` (KI-1).** `401` logs the frontend out |
| Casing | Some responses return raw DB columns (snake_case). The frontend maps them to camelCase |

## Endpoint summary

| Method | Path | Access | Purpose |
|---|---|---|---|
| GET | `/api/health` | public | Liveness: `{ "status": "ok", "app": "TikoSorted" }` |
| POST | `/api/auth/login` | public | Staff login |
| POST | `/api/auth/logout` | auth | End session |
| POST | `/api/auth/register` | manager | Create staff account |
| GET | `/api/events` | public | Sellable events with tiers |
| GET | `/api/events/:id` | public | One event |
| POST | `/api/events` | coordinator | Create event and tiers |
| PATCH | `/api/events/:id` | coordinator | Edit name, location, date |
| POST | `/api/events/:id/stage` | coordinator | Change stage |
| POST | `/api/bookings/checkout` | public, idempotent | Hold tickets |
| GET | `/api/bookings/:id/status` | public | Poll payment state |
| GET | `/api/bookings/:id/tickets` | public | E-tickets after payment |
| POST | `/api/payments/mpesa/stk-push` | public | Trigger M-Pesa prompt (implemented; body differs from frontend, KI-2) |
| POST | `/api/payments/mpesa/callback` | Safaricom webhook | Mark booking paid |
| GET | `/api/artists?eventId=` | coordinator, hospitality | List artists and entourage |
| POST | `/api/artists` | coordinator | Add artist, email link |
| POST | `/api/artists/verify/:token` | public | Verify, get artist JWT |
| POST | `/api/artists/entourage/verify/:token?artistId=` | public | Entourage member confirms email (not in frontend API.md) |
| PUT | `/api/artists/profile` | artist token | Save preferences |
| POST | `/api/artists/entourage` | artist token | Add entourage members |
| GET | `/api/checkin/manifest/:eventId` | gate_staff, logistics | Download tickets for offline use |
| POST | `/api/checkin/validate` | gate_staff, logistics | Check a ticket without using it (not in frontend API.md) |
| POST | `/api/checkin/scan` | gate_staff, logistics | Online scan |
| POST | `/api/checkin/sync` | gate_staff, logistics | Upload offline scans |
| GET | `/api/tasks?eventId=` | auth | List tasks |
| POST | `/api/tasks` | auth | Create task |
| PATCH | `/api/tasks/:id` | auth | Update task |
| DELETE | `/api/tasks/:id` | auth | Delete task |
| GET | `/api/admin/dashboard` | finance, coordinator, manager | KPIs, upcoming events, recent activity |
| GET | `/api/admin/management-team` | auth | Assignable staff |
| GET | `/api/admin/events` | auth | All events incl. drafts (dropdown) |
| GET | `/api/admin/tasks` | auth | Task board view |
| GET | `/api/admin/audit-logs?limit=` | compliance | Audit trail |
| GET | `/api/admin/events/:id/metrics` | finance, coordinator, manager | Revenue and ticket counts |
| GET | `/api/admin/events/:id/costs` | finance, coordinator, manager | Cost entries |
| POST | `/api/admin/events/:id/costs` | finance | Add cost entry |
| PATCH | `/api/admin/events/:id/costs/:costId` | finance | Edit cost entry (not in frontend API.md) |

## Role matrix

`requireRole` in `middleware/rbac.js` lets **manager pass every role check** (KI-23), so the manager column is yes everywhere except where a route has no role check at all.

| Capability | manager | coordinator | finance | logistics | hospitality | compliance | gate_staff | production, marketing |
|---|---|---|---|---|---|---|---|---|
| Create staff (`/auth/register`) | yes | | | | | | | |
| Create/edit event, change stage | yes | yes | | | | | | |
| Add artists | yes | yes | | | | | | |
| View artists | yes | yes | | | yes | | | |
| Dashboard, event metrics, cost list | yes | yes | yes | | | | | |
| Add and edit costs | yes | | yes | | | | | |
| Audit logs | yes | | | | | yes | | |
| Check-in endpoints | yes | | | yes | | | yes | |
| Tasks, `/admin/events`, `/admin/tasks`, `/admin/management-team` | any logged-in staff | | | | | | | |

---

## Auth

### POST `/api/auth/login`
```json
// request
{ "email": "a@b.com", "password": "secret" }
// 200
{ "token": "jwt...", "role": "manager" }
```
Errors: `401` invalid email or password.

### POST `/api/auth/logout` (auth)
`200` `{ "message": "Logged out" }`. Deactivates the current token.

### POST `/api/auth/register` (manager)
```json
{ "name": "...", "staffId": "...", "email": "...", "role": "coordinator", "password": "min 8 chars" }
// 201
{ "userId": "..." }
```
Errors: `400` missing fields, password under 8 characters, or invalid role; `403` not a manager. A duplicate email or staff id currently returns `500` (KI-27). Login keeps one active session per user: logging in again invalidates the earlier token (KI-26).

## Events

### GET `/api/events` (public)
Only `published`, `on_sale`, `sold_out`, soonest first, with tiers. `event_stage` is returned in lowercase (KI-9). The backend response also uses snake_case event keys: `event_id`, `event_date`, `event_stage`, plus `name`, `headliner`, `location`, and `tiers[]` in camelCase. There is no `posterUrl`. Example as the frontend expects it:
```json
[{ "id": "evt_1", "name": "Nairobi Jazz Night", "location": "Alchemist Bar, Westlands",
   "eventDate": "2026-12-05T18:00:00Z", "eventStage": "ON_SALE",
   "headliner": null, "posterUrl": null,
   "tiers": [{ "tierId": "tier_1", "type": "EARLY_BIRD", "price": 1500, "available": 40 }] }]
```

### GET `/api/events/:id` (public)
Returns `event_id, name, headliner, location, event_date, event_stage` and `tiers[]` (`tierId, type, price, available`). `404` if not found.

### POST `/api/events` (coordinator)
```json
{ "name": "...", "headliner": "optional", "location": "...", "eventDate": "...",
  "tiers": [{ "type": "regular", "price": 1000, "total": 500 }] }
// 201
{ "eventId": "..." }
```
One transaction: inserts the event (stage `draft`, `approver_id` = caller) and its tiers. `total` seeds both `total` and `available`. Tier `type` must be lowercase (`regular, vip, vvip, early_bird`); uppercase would fail with 400; the frontend already lowercases. Errors: `400`, `403`.

### PATCH `/api/events/:id` (coordinator)
Body `{ name, headliner, location, eventDate }` (all optional, only sent keys change). Tiers cannot change here. Only while stage is `draft` or `published`. `200` `{ "message": "Updated" }`. `409` not found or no longer editable.

### POST `/api/events/:id/stage` (coordinator)
Body `{ "stage": "on_sale" }` (lowercase; the frontend lowercases it for you). `200` `{ "message": "Event is now on_sale" }`. `404` not found, `409 Cannot move from X to Y`. See the [state machine](data-flows.md#event-stage-state-machine-from-utilseventstagesjs).

## Booking and payment (public)

### POST `/api/bookings/checkout`
Header `Idempotency-Key: <uuid>` (required, 16+ characters; the same key returns the same booking with status `200`; a new booking returns `201`).
```json
{ "tierId": "tier_1", "quantity": 2, "phone": "254712345678", "email": "buyer@example.com" }
```
`201` returns the booking row:
```json
{ "booking_id": "bkg_1", "event_id": "evt_1", "tier_id": "tier_1", "no_of_tickets": 2,
  "amount": 3000, "booker_phone": "254712345678", "booker_email": "buyer@example.com",
  "status": "held", "hold_expires_at": "2026-12-05T18:05:00Z" }
```
Rules: quantity 1 to 10, tier stock is held for `HOLD_TTL_SECONDS` (default 600). The event must be `on_sale`. Errors: `400` bad input or missing idempotency key, `409` not enough tickets (also unknown tier or event not on sale). Phone and email formats are not validated.

### GET `/api/bookings/:id/status`
Frontend polls every 2.5 s for up to 5 min.
`{ "booking_id": "...", "status": "held", "hold_expires_at": "..." }`. Backend returns lowercase `held | paid | expired | cancelled` (KI-9). `404` not found.

### GET `/api/bookings/:id/tickets`
`[ { "ticket_id", "qr_payload", "status", "event_name", "type" } ]`. Only `paid | verified | used` tickets. `qr_payload` is `ticketId.eventId.signature`. The scanner sends it back as `payload`.

### POST `/api/payments/mpesa/stk-push`
**Backend expects:**
```json
{ "bookingId": "<uuid>", "phoneNumber": "254712345678", "amount": 3000, "reference": "<booking uuid>", "description": "optional" }
```
`400` if `bookingId`, `phoneNumber`, `amount` or `reference` is missing. The current frontend sends `{ bookingId, phoneNumber, amount: 2, reference: bookingId }`, so the amount is always KES 2 (KI-48). `reference` must equal the booking id, because the callback finds the booking through it. Amount and reference should come from the booking, not the client (KI-14). Response: the raw Daraja JSON (`MerchantRequestID`, `CheckoutRequestID`, `ResponseCode`, `CustomerMessage`). On `ResponseCode "0"` a `transaction_details` row is stored.

### POST `/api/payments/mpesa/callback` (Safaricom webhook)
Must be public HTTPS (ngrok in dev). Body is Safaricom's `Body.stkCallback`. On success (`ResultCode 0`) it records the receipt, marks the booking `paid`, tickets `paid`, signs each `qr_payload`, and emails the tickets. Responds `{ "ResultCode": 0, "ResultDesc": "Accepted" }`. A non-zero code is echoed back and nothing is saved. Unauthenticated (KI-15); the amount is not checked (KI-14). Only this webhook may mark a booking paid; the browser is never trusted.

## Artists

### GET `/api/artists?eventId=...` (coordinator, hospitality)
```json
[{ "id": "art_1", "name": "DJ Karaba", "email": "dj@example.com", "isVerified": true,
   "preferences": "",
   "entourage": [{ "id": "...", "artistId": "art_1", "name": "Jane", "email": "jane@example.com", "isVerified": false }] }]
```
`400` if `eventId` missing.

### POST `/api/artists` (coordinator)
`{ "eventId", "name", "email" }` -> `201 { id, name, email, isVerified: false }`. Emails a link to `${FRONTEND_URL}/artist/verify/<token>`. Errors: `409` already added, `404` event not found, `400` invalid name/email, `502` email could not be sent (the artist is not saved).

### POST `/api/artists/verify/:token` (public)
`200 { "token": "jwt...", "artist": { "id", "eventId", "name" } }`. Token lifetime 2 h. `410` link older than 72 h, `404` invalid or already used link.

### POST `/api/artists/entourage/verify/:token?artistId=...` (public)
Not in frontend `API.md`. Opened from the email sent to each entourage member. `200 { "member": { "id", "name" } }`. `410` invalid or expired token, `404` not valid or already verified.

### PUT `/api/artists/profile` (artist token)
`{ "preferences": "Stage plot, 2 monitors" }` (non-empty string) -> `200 { "message": "Profile saved" }`. Stored as `{ "notes": "..." }` in the JSONB column. `400` missing, `401` bad/expired token.

### POST `/api/artists/entourage` (artist token)
`{ "members": [{ "name": "Jane Doe", "email": "jane@example.com" }] }` -> `201` array of `{ id, name, email }`. Every member is validated first (`400` empty list, missing name, invalid email), then saved and emailed one by one. If an email fails the request returns `502` and members saved earlier remain (KI-38).

## Gate scanner (gate_staff, logistics)

### GET `/api/checkin/manifest/:eventId`
`[ { "ticket_id", "qr_payload", "status", "tier_id", "type", "price", "event_name" } ]` (status `paid` or `verified`) for the device to store locally.

### POST `/api/checkin/validate`
Same body as scan. Checks the ticket without using it. `200 { "valid": true, "ticket": { ticket_id, status, type, price, event_name } }`, `409` not valid, `400` invalid ticket.

### POST `/api/checkin/scan`
Body `{ "payload": "<qr_payload>" }` (signature verified), or `{ "ticketId", "eventId" }`. A `ticketId` without `eventId` never matches. `200 { "valid": true }`, ticket becomes `used`, `used_at = now()`. `400` invalid or forged payload, `409` already used or not valid.

### POST `/api/checkin/sync`
```json
{ "deviceId": "SCAN-4F2A", "scans": [{ "ticketId": "tkt_1", "scannedAt": "2026-12-05T20:14:03Z" }] }
// 200
{ "results": [{ "ticketId": "tkt_1", "conflict": false }] }
```
The first scan *processed* wins (not necessarily the earliest `scannedAt`, KI-33). `conflict: true` means the ticket was already used. Every scan, conflict or not, is recorded in `offline_sync_logs`. `deviceId` is generated once per browser.

## Tasks (auth)

| Call | Body | Response |
|---|---|---|
| GET `/api/tasks?eventId=` | `eventId` optional | rows by deadline: `task_id, title, assigned_to, deadline, status, resource` |
| POST `/api/tasks` | `{ eventId, title, assignedTo, deadline, resource }` | `201` task row. `400` if eventId/title missing |
| PATCH `/api/tasks/:id` | any of `status` (`todo / in_progress / done`), `title`, `deadline`, `resource`. An invalid status returns 500 (KI-28) | `200 { "message": "Updated" }`. `404` |
| DELETE `/api/tasks/:id` | | `204` (even if the task does not exist, KI-41) |

The frontend maps UI `TODO / IN_PROGRESS / COMPLETED` to `todo / in_progress / done`.

## Admin (auth, role based)

**GET `/api/admin/dashboard`** (finance, coordinator, manager)
```json
{ "kpis": { "totalEvents": 12, "liveEvents": 3, "openTasks": 7, "completedTasks": 20, "totalRevenue": 1250000 },
  "upcomingEvents": [{ "id": "evt_1", "name": "...", "eventDate": "...", "eventStage": "ON_SALE" }],
  "recentActivity": [{ "id": "log_1", "timestamp": "...", "actorName": "Jane", "action": "EVENT_PUBLISHED" }] }
```
`liveEvents` = `published`, `on_sale` or `ongoing`. `upcomingEvents` = next 5 future, non-cancelled events by date. `recentActivity` = latest 5 audit logs. `totalRevenue` = sum of `paid` bookings.

**GET `/api/admin/management-team`**: `[ { "id", "name" } ]` for every staff user (all roles)
**GET `/api/admin/events`**: `[ { "id", "name" } ]` including drafts.
**GET `/api/admin/tasks`**: `[ { "id", "title", "teamOnboard", "resources", "dueDate", "status" } ]`, status `TODO | IN_PROGRESS | COMPLETED` (`BLOCKED` is not possible with the current schema, KI-6). `teamOnboard` is the assignee's name, or null.
**GET `/api/admin/audit-logs?limit=200`** (compliance): newest first, limit max 500. Fields `id, timestamp, actorName, action, resource, metadata`. `action` values are lowercase verbs such as `create_event`, `change_event_stage`, `login`. `resource` is a table name such as `events`. `metadata` holds `method`, `path`, `ip`, `params`. There are no `SYSTEM` actors yet (KI-37).
**GET `/api/admin/events/:id/metrics`** (finance, coordinator, manager)
```json
{ "netRevenue": 450000, "revenue": 500000, "totalCosts": 50000,
  "tickets": { "total": 320, "byTier": { "EARLY_BIRD": 100, "REGULAR": 150, "VIP": 60, "VVIP": 10 } } }
```
**GET `/api/admin/events/:id/costs`** (finance, coordinator, manager): `[ { "id", "name", "classification", "amount", "costDate" } ]`
**POST `/api/admin/events/:id/costs`** (finance): `{ "name", "classification", "amount", "costDate" }` -> `201` cost row. `classification` input must be the DB value: `marketing | sound_equipment | artist | on_ground`. GET returns `MARKETING | SOUND_EQUIP | ARTISTS | ON_GROUND`. There is no `SALES` (KI-12). `costDate` defaults to now.
**PATCH `/api/admin/events/:id/costs/:costId`** (finance): any of `name, classification, amount, costDate`. `200` updated row, `404` cost not found.

---

## Page data map (confirmed from the frontend source)

Routes are from `src/App.js`. Staff routes sit behind `ProtectedRoute`, which only checks that a login token exists; the backend enforces roles (KI-51). All calls go through `src/utils/api.js`.

### Public

| Route | Page | Calls | Data used |
|---|---|---|---|
| `/` | CatalogPage | `GET /events` | name, location, eventDate, eventStage, headliner, tiers (id, type, price, available) |
| `/event/:id` | EventDetailPage | `GET /events/:id`, `GET /artists?eventId=` | event + tiers, artists and entourage names. The artists call needs staff login, so for public visitors it fails and the module is hidden |
| `/checkout` | CheckoutPage | `POST /bookings/checkout`, `POST /payments/mpesa/stk-push`, polls `GET /bookings/:id/status` every 2.5 s until `hold_expires_at` | needs `{ event, tier, quantity, total }` passed from the event page (opening the URL directly shows "No tickets selected"). Phone is normalised to `2547XXXXXXXX`. A new idempotency key per attempt. On `PAID` it redirects to `/ticket/:bookingId` |
| `/ticket/:bookingId` | TicketPage | `GET /bookings/:id/tickets` | ticket_id, event_name, type, status, qr_payload. The same link is in the ticket email |
| `/artist/verify/:token` | ArtistRegisterPage | `POST /artists/verify/:token`, `PUT /artists/profile`, `POST /artists/entourage` | artist JWT kept in page state, preferences text, entourage `[{ name, email }]`. Then goes to `/register/success` |
| `/entourage/verify/:token?artistId=` | EntourageVerifyPage | `POST /artists/entourage/verify/:token?artistId=` | success or error |
| `/register/success` | inline component | none | |
| `/admin/login` | AdminLoginPage | `POST /auth/login` | stores `token` in `sessionStorage`; `role` is ignored |

### Staff (login required)

| Route | Page | Calls | Backend role needed |
|---|---|---|---|
| `/admin` | AdminDashboardPage | `GET /admin/dashboard`; logout calls `POST /auth/logout` | manager, coordinator, finance |
| `/admin/events/create` | EventCreatePage | `POST /events` | coordinator |
| `/admin/events/edit/:eventId` | EventEditPage | `GET /events/:id`, `PATCH /events/:id`, `POST /events/:id/stage` | coordinator |
| `/admin/events/:eventId/artists` | EventArtistsPage | `GET /events/:id`, `GET /artists?eventId=`, `POST /artists` | coordinator (add), coordinator or hospitality (list) |
| `/admin/events/:eventId/costs` | CostsPage | `GET /events/:id`, `GET /admin/events/:id/costs`, `POST` and `PATCH .../costs` | manager, coordinator, finance read; finance write |
| `/admin/events/:eventId` and `/admin/report` | AdminReportPage | `GET /admin/events`, `GET /admin/events/:id/metrics`, `GET /admin/events/:id/costs` | manager, coordinator, finance |
| `/admin/tasks` | AdminTasksPage | `GET /admin/tasks` | any staff |
| `/admin/taskcreate` | TaskCreatePage | `GET /admin/events`, `GET /admin/management-team`, `POST /tasks` | any staff |
| `/admin/tasks/:id` | TaskDetailPage | `GET /admin/tasks` (finds the task by id), `PATCH /tasks/:id` | any staff |
| `/admin/tasks/:id/edit` | TaskEditPage | `GET /admin/tasks`, `PATCH /tasks/:id` | any staff |
| `/admin/audit` | AdminAuditPage | `GET /admin/audit-logs?limit=200` | compliance (and manager) |
| `/checkin/:eventId` | GateScannerPage | `GET /checkin/manifest/:eventId`, `POST /checkin/validate`, `POST /checkin/scan`, `POST /checkin/sync` | gate_staff, logistics (and manager) |

There is no page for `POST /auth/register`, so staff accounts are created only through the API.

### Gate scanner behaviour (hooks/Scanner.js)

- Manifest is cached per event in `localStorage` (`tiko_manifest_<eventId>`); offline scans queue in `tiko_offline_scans_<eventId>`; a device id like `SCAN-4F2A` is stored in `tiko_device_id`.
- Two steps: **validate** (does not use the ticket), then staff **confirm entry**, which calls `scan` online or queues the scan offline.
- Offline checks only the cached list, not the QR signature. Queued scans sync automatically when the browser comes back online.

### Event stage dropdown (EventEditPage)

The dropdown offers the same transitions as the backend table, with the current stage as the first choice. The stage call is sent only if the stage changed.
