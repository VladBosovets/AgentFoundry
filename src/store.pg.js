const { Pool } = require('pg');

function createPgStore(connectionString) {
  const pool = new Pool({ connectionString });

  return {
    // ── Businesses ────────────────────────────────────────────────────────────
    async saveBusiness(business) {
      await pool.query(
        `INSERT INTO businesses (business_id, data)
         VALUES ($1, $2)
         ON CONFLICT (business_id) DO UPDATE SET data = $2, updated_at = NOW()`,
        [business.business_id, JSON.stringify(business)]
      );
    },
    async getBusiness(id) {
      const { rows } = await pool.query(
        'SELECT data FROM businesses WHERE business_id = $1',
        [id]
      );
      return rows[0]?.data ?? null;
    },

    // ── Orders ────────────────────────────────────────────────────────────────
    async saveOrder(order) {
      await pool.query(
        `INSERT INTO orders (order_id, business_id, data)
         VALUES ($1, $2, $3)
         ON CONFLICT (order_id) DO UPDATE SET data = $3, updated_at = NOW()`,
        [order.order_id, order.business_id, JSON.stringify(order)]
      );
    },
    async getOrder(id) {
      const { rows } = await pool.query(
        'SELECT data FROM orders WHERE order_id = $1',
        [id]
      );
      return rows[0]?.data ?? null;
    },
    async getOrdersByBusiness(businessId) {
      const { rows } = await pool.query(
        'SELECT data FROM orders WHERE business_id = $1 ORDER BY created_at ASC',
        [businessId]
      );
      return rows.map(r => r.data);
    },

    // ── Performance ───────────────────────────────────────────────────────────
    async savePerformance(perf) {
      await pool.query(
        `INSERT INTO performance (business_id, data)
         VALUES ($1, $2)
         ON CONFLICT (business_id) DO UPDATE SET data = $2, updated_at = NOW()`,
        [perf.business_id, JSON.stringify(perf)]
      );
    },
    async getPerformance(businessId) {
      const { rows } = await pool.query(
        'SELECT data FROM performance WHERE business_id = $1',
        [businessId]
      );
      return rows[0]?.data ?? null;
    },

    // Expose pool so migrate.js can use the same connection
    pool,
  };
}

module.exports = { createPgStore };
