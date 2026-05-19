const { createInMemoryStore } = require('./store.memory');
const { createPgStore } = require('./store.pg');

const store = process.env.DATABASE_URL
  ? createPgStore(process.env.DATABASE_URL)
  : createInMemoryStore();

if (process.env.DATABASE_URL) {
  console.log('[store] Using PostgreSQL');
} else {
  console.log('[store] Using in-memory store (set DATABASE_URL to persist data)');
}

module.exports = store;
