# Diagrams

All diagrams are Mermaid, so they render directly on GitHub. The ERD source is also in [schema.dbml](schema.dbml) for dbdiagram.io.

## 1. Use case diagram

Actors (stick figures) sit outside the system boundary. Each use case is an oval inside the system rectangle. The dashed arrow means "Book tickets" includes "Pay by M-Pesa".

![Use case diagram](usecase.svg)

PNG copy: [usecase.png](usecase.png). The Mermaid version below draws the same model if you prefer to edit it as text (ovals inside the TikoSorted rectangle, actors as plain boxes, because Mermaid cannot draw stick figures):

```mermaid
flowchart LR
  Rev[Reveller]
  Art[Artist]
  Mgr[Manager]
  Coo[Coordinator]
  Fin[Finance]
  Hos[Hospitality]
  Com[Compliance]
  Gate[Gate staff / Logistics]
  Saf[Safaricom M-Pesa]

  subgraph System[TikoSorted]
    U1([Browse events])
    U2([Book tickets and hold stock])
    U3([Pay by M-Pesa])
    U4([View e-ticket QR])
    U5([Verify via email link])
    U6([Save preferences])
    U7([Add entourage])
    U8([Create staff accounts])
    U9([Create and edit event])
    U10([Change event stage])
    U11([Add artists])
    U12([Manage tasks])
    U13([Record costs])
    U14([View dashboard and metrics])
    U15([View artists and entourage])
    U16([View audit logs])
    U17([Download manifest])
    U18([Scan tickets])
    U19([Sync offline scans])
    U20([Log in and out])
    U21([Validate ticket without using it])
    U22([Confirm entourage email])
    U23([Edit cost entries])
  end

  Rev --> U1
  Rev --> U2
  Rev --> U3
  Rev --> U4
  Art --> U5
  Art --> U6
  Art --> U7
  Mgr --> U8
  Mgr --> U14
  Coo --> U9
  Coo --> U10
  Coo --> U11
  Coo --> U12
  Coo --> U14
  Coo --> U15
  Fin --> U13
  Fin --> U14
  Hos --> U15
  Com --> U16
  Gate --> U17
  Gate --> U18
  Gate --> U19
  Gate --> U21
  Art -.invites.-> U22
  Fin --> U23
  Mgr --> U20
  Coo --> U20
  Fin --> U20
  Com --> U20
  Gate --> U20
  Saf -.confirms payment.-> U3
  U2 -.includes.-> U3
  U3 -.includes.-> U4
```

## 2. Sequence: booking and M-Pesa payment

Matches the backend code. Known problems in this flow (client-chosen amount, unauthenticated callback, late payments) are in [known-issues.md](known-issues.md).

```mermaid
sequenceDiagram
  actor R as Reveller
  participant FE as Frontend
  participant API as Backend
  participant DB as PostgreSQL
  participant MP as Safaricom Daraja

  R->>FE: Pick tier, quantity, phone, email
  FE->>API: POST /bookings/checkout (Idempotency-Key)
  API->>DB: Find booking by idempotency key
  alt key already used
    API-->>FE: 200 same booking
  else new key
    API->>DB: BEGIN, UPDATE ticket_tiers available - qty WHERE available >= qty AND event on_sale
    alt no row updated
      API-->>FE: 409 Not enough tickets available
    else stock held
      API->>DB: Insert booking (held, hold_expires_at) and one ticket per seat (held), COMMIT
      API-->>FE: 201 booking row
    end
  end
  FE->>API: POST /payments/mpesa/stk-push
  API->>MP: STK push (amount and reference from request body, frontend sends 2)
  MP-->>API: ResponseCode 0 and CheckoutRequestID
  API->>DB: Insert transaction_details (request_id, reference = booking id)
  API-->>FE: raw Daraja response
  MP-->>R: M-Pesa PIN prompt
  loop every 2.5 s, up to 5 min
    FE->>API: GET /bookings/:id/status
    API-->>FE: held
  end
  R->>MP: Enter PIN
  MP->>API: POST /payments/mpesa/callback
  alt ResultCode not 0
    API-->>MP: echo result, nothing stored
  else ResultCode 0
    API->>DB: Update transaction_details (result, receipt)
    API->>DB: BEGIN, booking held to paid, tickets to paid, set signed qr_payload, COMMIT
    API-->>R: Email tickets with QR codes
    API-->>MP: ResultCode 0 Accepted
  end
  FE->>API: GET /bookings/:id/status
  API-->>FE: paid
  FE->>API: GET /bookings/:id/tickets
  API-->>FE: tickets with qr_payload
  FE-->>R: Show QR e-tickets
```

## 3. Sequence: hold expiry (runs every 45 s inside the server)

```mermaid
sequenceDiagram
  participant Job as Hold sweeper
  participant DB as PostgreSQL
  Job->>DB: BEGIN, select held bookings where hold_expires_at < now FOR UPDATE SKIP LOCKED
  DB-->>Job: expired bookings
  loop each booking
    Job->>DB: ticket_tiers.available += no_of_tickets
    Job->>DB: booking status = expired
    Job->>DB: delete its held tickets
  end
  Job->>DB: COMMIT
```

## 4. Sequence: staff login and admin creates an event

```mermaid
sequenceDiagram
  actor C as Coordinator
  participant FE as Frontend
  participant API as Backend
  participant DB as PostgreSQL

  C->>FE: Enter email and password
  FE->>API: POST /auth/login
  API->>DB: Load mgt_users and mgt_auth
  API->>DB: Set is_active, new token_id (replaces any earlier session), last_login, expires_at 8 h
  API->>DB: Insert audit_logs login
  API-->>FE: token and role
  FE->>FE: Store token, show role menu

  C->>FE: Fill event form with tiers
  FE->>API: POST /events (Bearer token)
  API->>API: authenticate, requireRole coordinator, validate
  API->>DB: BEGIN, insert event (draft, approver = caller), insert tiers, COMMIT
  API-->>FE: 201 eventId

  C->>FE: Publish, then start sales
  FE->>API: POST /events/:id/stage published
  API->>DB: Check allowed jump (409 if illegal), update event_stage
  API->>DB: Insert audit_logs change_event_stage
  API-->>FE: 200 Event is now published
  FE->>API: POST /events/:id/stage on_sale
  API-->>FE: 200 Event is now on_sale
```

## 5. Sequence: tasks

```mermaid
sequenceDiagram
  actor S as Staff
  participant FE as Frontend
  participant API as Backend
  participant DB as PostgreSQL

  FE->>API: GET /admin/management-team and GET /admin/events
  API-->>FE: assignable users and events
  S->>FE: New task (event, title, assignee, deadline)
  FE->>API: POST /tasks
  API->>DB: Insert task (todo)
  API-->>FE: 201 task row
  S->>FE: Drag to In progress
  FE->>API: PATCH /tasks/:id status in_progress
  API->>DB: Update only sent fields
  API-->>FE: 200 Updated
  FE->>API: GET /admin/tasks
  API-->>FE: board data
```

## 5b. Event stage state machine

```mermaid
stateDiagram-v2
  [*] --> draft
  draft --> published
  draft --> cancelled
  published --> on_sale
  published --> cancelled
  on_sale --> sold_out
  on_sale --> ongoing
  on_sale --> cancelled
  sold_out --> on_sale
  sold_out --> ongoing
  sold_out --> cancelled
  ongoing --> completed
  ongoing --> cancelled
  completed --> [*]
  cancelled --> [*]
```

## 6. Sequence: artist and entourage onboarding

```mermaid
sequenceDiagram
  actor C as Coordinator
  actor A as Artist
  actor M as Entourage member
  participant FE as Frontend
  participant API as Backend
  participant DB as PostgreSQL
  participant Mail as Email (SMTP)

  C->>FE: Add artist name and email
  FE->>API: POST /artists
  API->>DB: Insert artist with verification token
  API->>Mail: Send link /artist/verify/token
  alt email fails
    API->>DB: Delete artist
    API-->>FE: 502
  else sent
    API-->>FE: 201 isVerified false
  end
  A->>FE: Click emailed link
  FE->>API: POST /artists/verify/:token
  alt link older than 72 h
    API-->>FE: 410 expired
  else valid
    API->>DB: is_verified true, clear token
    API-->>FE: artist JWT (2 h)
  end
  A->>FE: Save preferences
  FE->>API: PUT /artists/profile (artist token)
  API->>DB: preference = notes text
  API-->>FE: 200 Profile saved
  A->>FE: Add band and crew
  FE->>API: POST /artists/entourage
  API->>API: Validate every member
  loop each member
    API->>DB: Insert entourage row
    API->>Mail: Send link /entourage/verify/token
  end
  API-->>FE: 201 saved members
  M->>FE: Click emailed link
  FE->>API: POST /artists/entourage/verify/:token?artistId=
  API->>DB: entourage is_verified true
  API-->>FE: 200 member
```

## 7. Sequence: gate check-in (online and offline)

```mermaid
sequenceDiagram
  actor G as Gate staff
  participant Dev as Scanner device
  participant API as Backend
  participant DB as PostgreSQL

  Dev->>API: GET /checkin/manifest/:eventId
  API-->>Dev: paid and verified tickets
  Dev->>Dev: Store manifest locally

  alt online
    G->>Dev: Scan QR
    Dev->>API: POST /checkin/scan with payload
    API->>API: Verify HMAC signature in payload
    alt forged or unreadable
      API-->>Dev: 400 Invalid ticket
    else signature ok
      API->>DB: UPDATE tickets to used WHERE status paid or verified
      alt one row updated
        API-->>Dev: valid true
      else none updated
        API-->>Dev: 409 already used or not valid
      end
    end
  else offline
    G->>Dev: Scan QR
    Dev->>Dev: Look up in manifest, save scan with scannedAt
    Dev->>API: POST /checkin/sync deviceId and scans
    loop each scan in arrival order
      API->>DB: UPDATE tickets to used WHERE status paid or verified
      API->>DB: Insert offline_sync_logs with conflict = no row updated
    end
    API-->>Dev: results with conflict flags
  end
```

## 8. Entity relationship diagram

Exported from dbdiagram.io (source in [schema.dbml](schema.dbml)):

![ERD from dbdiagram.io](erd.png)

The same model as Mermaid, which renders on GitHub:

```mermaid
erDiagram
  mgt_users ||--o| mgt_auth : has
  mgt_users ||--o{ events : approves
  mgt_users ||--o{ tasks : assigned
  mgt_users ||--o{ audit_logs : acts
  events ||--o{ ticket_tiers : offers
  events ||--o{ bookings : receives
  events ||--o{ tickets : issues
  events ||--o{ artists : books
  events ||--o{ costs : incurs
  events ||--o{ tasks : has
  ticket_tiers ||--o{ bookings : chosen_in
  ticket_tiers ||--o{ tickets : typed_as
  bookings ||--o{ payments : paid_by
  bookings ||--o{ tickets : contains
  tickets ||--o{ offline_sync_logs : scanned_in
  artists ||--o{ entourage : brings

  mgt_users {
    uuid user_id PK
    varchar name
    varchar staff_id UK
    varchar email UK
    user_role role
    timestamptz joined_at
  }
  mgt_auth {
    uuid auth_id PK
    uuid user_id FK
    varchar password_hash
    boolean is_active
    timestamptz last_login
    jsonb device_metadata
    uuid token_id
    timestamptz expires_at
  }
  events {
    uuid event_id PK
    varchar name
    varchar headliner
    uuid approver_id FK
    varchar location
    timestamptz event_date
    event_stage event_stage
    boolean is_cancelled
  }
  ticket_tiers {
    uuid tier_id PK
    uuid event_id FK
    ticket_type type
    numeric price
    int total
    int available
  }
  bookings {
    uuid booking_id PK
    varchar idempotency_key UK
    uuid event_id FK
    uuid tier_id FK
    int no_of_tickets
    numeric amount
    varchar booker_phone
    varchar booker_email
    booking_status status
    timestamptz hold_expires_at
    timestamptz booked_at
  }
  payments {
    uuid payment_id PK
    uuid booking_id FK
    varchar method
    varchar provider_ref UK
    numeric amount
    varchar status
    timestamptz created_at
  }
  transaction_details {
    uuid transaction_id PK
    varchar merchant_id
    varchar request_id UK
    numeric amount
    varchar phone_no
    int result_code
    varchar receipt_no
    timestamptz transaction_timestamp
    varchar reference
    varchar description
  }
  tickets {
    uuid ticket_id PK
    uuid booking_id FK
    uuid event_id FK
    uuid tier_id FK
    ticket_status status
    text qr_payload UK
    timestamptz used_at
  }
  offline_sync_logs {
    uuid sync_id PK
    uuid ticket_id FK
    varchar scanner_device_id
    timestamptz scanned_at
    boolean is_reconciled
    boolean conflict
  }
  artists {
    uuid artist_id PK
    uuid event_id FK
    varchar name
    varchar email
    jsonb preference
    varchar verification_token
    boolean verification_sent
    boolean is_verified
  }
  entourage {
    uuid entourage_id PK
    uuid artist_id FK
    varchar name
    varchar email
    boolean is_verified
  }
  costs {
    uuid cost_id PK
    uuid event_id FK
    varchar name
    cost_class classification
    timestamptz cost_date
    numeric amount
  }
  tasks {
    uuid task_id PK
    uuid event_id FK
    varchar title
    uuid assigned_to FK
    text resource
    timestamptz deadline
    varchar status
  }
  audit_logs {
    uuid log_id PK
    uuid actor_id FK
    varchar action
    varchar resource
    timestamptz log_timestamp
    jsonb log_metadata
  }
```

`transaction_details` has no foreign key in the schema. It links to a payment only through `reference` and `request_id`, so it is drawn without a relationship line.

## Enums

| Enum | Values |
|---|---|
| user_role | manager, coordinator, finance, logistics, production, marketing, hospitality, compliance, gate_staff |
| event_stage | draft, published, on_sale, sold_out, ongoing, completed, cancelled |
| ticket_type | regular, vip, vvip, early_bird |
| ticket_status | held, paid, verified, used |
| booking_status | held, paid, expired, cancelled |
| cost_class | marketing, sound_equipment, artist, on_ground |
