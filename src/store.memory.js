function createInMemoryStore() {
  const businesses = new Map();
  const orders = new Map();
  const performance = new Map();

  return {
    // ── Businesses ────────────────────────────────────────────────────────────
    async saveBusiness(business) {
      businesses.set(business.business_id, { ...business });
    },
    async getBusiness(id) {
      return businesses.has(id) ? { ...businesses.get(id) } : null;
    },

    // ── Orders ────────────────────────────────────────────────────────────────
    async saveOrder(order) {
      orders.set(order.order_id, { ...order });
    },
    async getOrder(id) {
      return orders.has(id) ? { ...orders.get(id) } : null;
    },
    async getOrdersByBusiness(businessId) {
      return [...orders.values()]
        .filter(o => o.business_id === businessId)
        .map(o => ({ ...o }));
    },

    // ── Performance ───────────────────────────────────────────────────────────
    async savePerformance(perf) {
      performance.set(perf.business_id, { ...perf, events: [...perf.events] });
    },
    async getPerformance(businessId) {
      if (!performance.has(businessId)) return null;
      const p = performance.get(businessId);
      return { ...p, events: [...p.events] };
    },

    // Test helper — clears all data between tests
    _reset() {
      businesses.clear();
      orders.clear();
      performance.clear();
    },
  };
}

module.exports = { createInMemoryStore };
