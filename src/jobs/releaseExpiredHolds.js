// Every 30s: tickets still HELD after the TTL go back to stock.
// This is what prevents "ghost bookings" (stock locked forever by abandoned checkouts).
import { withTransaction } from '../db.js';

export async function releaseExpiredHolds() {
  await withTransaction(async (c) => {
    const { rows } = await c.query(
      `SELECT booking_id, tier_id, no_of_tickets FROM bookings
       WHERE status = 'held' AND hold_expires_at < now() FOR UPDATE SKIP LOCKED`
    );
    for (const b of rows) {
      await c.query('UPDATE ticket_tiers SET available = available + $1 WHERE tier_id = $2',
        [b.no_of_tickets, b.tier_id]);
      await c.query(`UPDATE bookings SET status = 'expired' WHERE booking_id = $1`, [b.booking_id]);
      await c.query(`DELETE FROM tickets WHERE booking_id = $1 AND status = 'held'`, [b.booking_id]);
    }
  });
}

export const startHoldSweeper = () =>
  setInterval(() => releaseExpiredHolds().catch((e) => console.error('sweeper', e.message)), 30_000);
