const SQL = `
  CREATE TABLE IF NOT EXISTS businesses (
    business_id TEXT PRIMARY KEY,
    data        JSONB        NOT NULL,
    updated_at  TIMESTAMPTZ  DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS orders (
    order_id    TEXT PRIMARY KEY,
    business_id TEXT         NOT NULL,
    data        JSONB        NOT NULL,
    created_at  TIMESTAMPTZ  DEFAULT NOW(),
    updated_at  TIMESTAMPTZ  DEFAULT NOW()
  );

  CREATE INDEX IF NOT EXISTS idx_orders_business_id ON orders (business_id);

  CREATE TABLE IF NOT EXISTS performance (
    business_id TEXT PRIMARY KEY,
    data        JSONB        NOT NULL,
    updated_at  TIMESTAMPTZ  DEFAULT NOW()
  );
`;

async function migrate(pool) {
  await pool.query(SQL);
  console.log('[migrate] Tables ready');
}

module.exports = { migrate };
