# Things corrected from the design documents
1. ERD `no_vvip decimal` -> should be an int. Better: replace the 6 columns (no_vip, no_regular, no_vvip, 3 prices) with a `ticket_tiers` table (fully normalized, needed for atomic stock updates).
2. `bookings.ticket_id` holds ONE ticket but a booking has many -> new `tickets` table (one row per seat). It was in the class diagram but missing from the ERD.
3. Missing from ERD: tickets, payments, offline_sync_logs, ticket reservation holds (now handled with bookings.hold_expires_at), tasks ("Track tasks" requirement).
4. Class diagram enum typo: `ONGOING_CANCELLED` -> two states `ONGOING` and `CANCELLED`. Also `HOSPITATILITY` -> `HOSPITALITY`.
5. Cost classification differs between ERD and class diagram (ON_GROUND only in one). Unified.
6. `gate_staff` is in the use-case diagram but not in the user role enum. Added.
7. Artist <-> entourage was `<>` (many-to-many) but entourage email is unique with a single artist_id -> modeled one-to-many.
8. Events had no name/title column.
9. `mgt_users.id` renamed `staff_id` (clearer than a second "id").
10. Ticket states `Paid -> Verified -> Used`: "Verified" is unclear. We treat verified = validated at a gate before final use; you can drop it if you prefer.
11. Event stage `sold_out` can return to `on_sale` (expired holds free stock).
12. Prices should be NUMERIC(10,2), never float.
13. Revellers don't log in, so booking endpoints are public. Protect them with idempotency keys, rate limiting (TODO: express-rate-limit) and validation.
