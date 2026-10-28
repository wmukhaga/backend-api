// db.js - one shared PostgreSQL connection pool for the whole app
import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

// Always use parameters ($1, $2...) -> prepared statements -> no SQL injection
export const query = (text, params) => pool.query(text, params);

// Runs several queries as ONE all-or-nothing transaction.
// Used for checkout: reduce stock + create booking + create tickets together.
export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
  