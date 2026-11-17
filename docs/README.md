# TikoSorted

Event ticketing and event-operations platform for Kenyan events. Revellers browse events and pay by M-Pesa without creating an account. Management staff run events from an admin panel. Artists onboard through an emailed link. Gate staff scan QR tickets online or offline.

## Contents

| Doc | What it covers |
|---|---|
| [technical/api-reference.md](technical/api-reference.md) | Every endpoint, request/response, roles, errors, and which page uses what |
| [technical/data-flows.md](technical/data-flows.md) | Booking, event setup, tasks, artist, gate flows, state machines, middleware |
| [technical/diagrams.md](technical/diagrams.md) | Use case, sequence diagrams, stage state machine, ERD (Mermaid, renders on GitHub) |
| [technical/known-issues.md](technical/known-issues.md) | 47 problems found by comparing the backend code with the frontend contract, with fixes |
| [technical/schema.dbml](technical/schema.dbml) | Database schema (paste into dbdiagram.io) |
| [DOCUMENTATION_PLAN.md](DOCUMENTATION_PLAN.md) | How two people split user docs vs technical docs |

## Architecture at a glance

```
Browser (React + Vite)  --/api/*-->  Backend (Express 4, Node 24, port 3000)  -->  PostgreSQL
                                          |-- Safaricom Daraja (STK push + callback webhook)
                                          |-- SMTP email (artist links, e-tickets with QR)
                                          |-- Hold sweeper (setInterval, every 45 s, in the same process)
```

- Frontend repo: https://github.com/lumbasi-wabomba/tikosorted-frontend (React + Vite, all calls in `src/utils/api.js`)
- Backend repo: `backend-api-main` (Express, ES modules, `pg`, JWT, bcryptjs, helmet, morgan, nodemailer, qrcode)
- Auth: staff JWT (`JWT_SECRET`, 8 h, one active session per user, checked against `mgt_auth`), artist JWT (`ARTIST_TOKEN_SECRET`, 2 h), no login for revellers.
- Tickets carry an HMAC-signed QR payload: `ticketId.eventId.signature`.

## Run the backend

```bash
npm install
createdb tikosorted && psql -d tikosorted -f schema.sql
# create .env with the variables in technical/data-flows.md section 8 (the repo has no .env.example yet)
npm run dev          # http://localhost:3000/api/health
```
There is no seed script. Insert the first manager by hand with a bcrypt hash, because `POST /api/auth/register` needs a logged-in manager. For local work you can set `BYPASS_AUTH=true` (ignored in production).

## Run the frontend

```bash
npm install
cp .env.example .env.local   # set VITE_BACKEND_URL to your backend
npm run dev
```

In dev, Vite proxies `/api/*` to `VITE_BACKEND_URL` (default `http://localhost:3000`). In Docker, `VITE_BACKEND_URL` is read when Nginx starts and written to `config.js`.

## Roles

`manager`, `coordinator`, `finance`, `logistics`, `production`, `marketing`, `hospitality`, `compliance`, `gate_staff`. See the role matrix in [api-reference.md](technical/api-reference.md#role-matrix).

## Conventions (apply to every endpoint)

- Base path `/api`. JSON in and out. Lists are plain arrays.
- Dates ISO 8601. Money is a whole-KES number. Phones `2547XXXXXXXX`.
- Enums are UPPER_SNAKE_CASE on the API (the database stores lowercase).
- Errors: non-2xx. The frontend expects `{ "message": "..." }`; the backend currently sends `{ "error": "..." }` (known issue KI-1). A `401` logs the user out of the frontend.

## Known gaps

Full list with fixes: [technical/known-issues.md](technical/known-issues.md) (checked against both repos). Items that matter most:

1. **Every payment is KES 2.** The frontend hard-codes `amount: 2` in the STK push, and the backend trusts the amount it is sent (KI-48, KI-14).
2. **Users never see the real error.** The backend sends `{ error }`, the frontend reads `message` (KI-1).
3. The M-Pesa callback is unauthenticated, late payments after hold expiry are lost, and the rate limiter is not mounted (KI-15, KI-16, KI-22).
4. The UI ignores roles, so staff see links they cannot use (KI-51).
5. Event headliner and poster, and task notes, are collected but never saved (KI-49, KI-50).

Already fixed in the latest frontend: lowercase stage and tier values, STK push field names, and the scan payload.
