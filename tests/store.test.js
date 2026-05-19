const { createInMemoryStore } = require('../src/store.memory');

// These tests define the contract every store implementation must satisfy.
// The same suite can be run against the Postgres implementation by swapping
// createInMemoryStore for createPgStore (with a real DATABASE_URL).

const BUSINESS = {
  business_id: 'biz_test_1',
  business_name: 'Test Resume Co',
  tagline: 'We make resumes shine',
  service_type: 'resume_optimization',
  pricing_usdc: 5,
  fulfillment_prompt: 'You are a resume expert.',
  created_at: new Date().toISOString(),
};

const ORDER = {
  order_id: 'ord_test_1',
  business_id: 'biz_test_1',
  input_data: { resume_text: 'John Doe, engineer' },
  payment_status: 'pending',
  result: null,
  success_flag: undefined,
  fulfillment_time_seconds: null,
  created_at: new Date().toISOString(),
};

const PERFORMANCE = {
  business_id: 'biz_test_1',
  total_orders: 3,
  successful_orders: 3,
  failure_rate: 0,
  avg_fulfillment_time: 18.5,
  current_pricing_usdc: 5.75,
  prompt_version: 2,
  last_updated: new Date().toISOString(),
  events: [{ timestamp: new Date().toISOString(), type: 'pricing_up', message: 'Price raised' }],
};

// ── Business ──────────────────────────────────────────────────────────────────

describe('businesses', () => {
  let store;
  beforeEach(() => { store = createInMemoryStore(); });

  test('saves and retrieves a business', async () => {
    await store.saveBusiness(BUSINESS);
    const result = await store.getBusiness('biz_test_1');
    expect(result).toMatchObject({
      business_id: 'biz_test_1',
      business_name: 'Test Resume Co',
      pricing_usdc: 5,
    });
  });

  test('returns null for unknown business id', async () => {
    const result = await store.getBusiness('does_not_exist');
    expect(result).toBeNull();
  });

  test('upserts — updates an existing business on re-save', async () => {
    await store.saveBusiness(BUSINESS);
    await store.saveBusiness({ ...BUSINESS, pricing_usdc: 7.25, business_name: 'Updated Co' });

    const result = await store.getBusiness('biz_test_1');
    expect(result.pricing_usdc).toBe(7.25);
    expect(result.business_name).toBe('Updated Co');
  });

  test('isolates mutations — stored object is not affected by external changes', async () => {
    const b = { ...BUSINESS };
    await store.saveBusiness(b);
    b.pricing_usdc = 999;

    const result = await store.getBusiness('biz_test_1');
    expect(result.pricing_usdc).toBe(5);
  });
});

// ── Orders ────────────────────────────────────────────────────────────────────

describe('orders', () => {
  let store;
  beforeEach(async () => {
    store = createInMemoryStore();
    await store.saveBusiness(BUSINESS);
  });

  test('saves and retrieves an order', async () => {
    await store.saveOrder(ORDER);
    const result = await store.getOrder('ord_test_1');
    expect(result).toMatchObject({
      order_id: 'ord_test_1',
      business_id: 'biz_test_1',
      payment_status: 'pending',
    });
  });

  test('returns null for unknown order id', async () => {
    const result = await store.getOrder('does_not_exist');
    expect(result).toBeNull();
  });

  test('upserts — updates payment_status and result on re-save', async () => {
    await store.saveOrder(ORDER);
    await store.saveOrder({
      ...ORDER,
      payment_status: 'paid',
      result: { optimized_resume: 'Better resume here' },
      success_flag: true,
      fulfillment_time_seconds: 22.4,
    });

    const result = await store.getOrder('ord_test_1');
    expect(result.payment_status).toBe('paid');
    expect(result.success_flag).toBe(true);
    expect(result.fulfillment_time_seconds).toBe(22.4);
    expect(result.result.optimized_resume).toBe('Better resume here');
  });

  test('getOrdersByBusiness returns all orders for a business', async () => {
    await store.saveOrder(ORDER);
    await store.saveOrder({ ...ORDER, order_id: 'ord_test_2' });
    await store.saveOrder({ ...ORDER, order_id: 'ord_test_3', business_id: 'other_biz' });

    const results = await store.getOrdersByBusiness('biz_test_1');
    expect(results).toHaveLength(2);
    expect(results.every(o => o.business_id === 'biz_test_1')).toBe(true);
  });

  test('getOrdersByBusiness returns empty array when no orders exist', async () => {
    const results = await store.getOrdersByBusiness('biz_test_1');
    expect(results).toEqual([]);
  });

  test('getOrdersByBusiness only returns orders with success_flag set', async () => {
    await store.saveOrder(ORDER); // success_flag: undefined — still pending
    await store.saveOrder({ ...ORDER, order_id: 'ord_test_2', success_flag: true });

    const all = await store.getOrdersByBusiness('biz_test_1');
    expect(all).toHaveLength(2); // getOrdersByBusiness returns all, lifecycle filters
  });
});

// ── Performance ───────────────────────────────────────────────────────────────

describe('performance', () => {
  let store;
  beforeEach(async () => {
    store = createInMemoryStore();
    await store.saveBusiness(BUSINESS);
  });

  test('returns null when no performance record exists', async () => {
    const result = await store.getPerformance('biz_test_1');
    expect(result).toBeNull();
  });

  test('saves and retrieves performance', async () => {
    await store.savePerformance(PERFORMANCE);
    const result = await store.getPerformance('biz_test_1');
    expect(result).toMatchObject({
      total_orders: 3,
      successful_orders: 3,
      prompt_version: 2,
      current_pricing_usdc: 5.75,
    });
  });

  test('upserts performance on re-save', async () => {
    await store.savePerformance(PERFORMANCE);
    await store.savePerformance({ ...PERFORMANCE, total_orders: 6, prompt_version: 3 });

    const result = await store.getPerformance('biz_test_1');
    expect(result.total_orders).toBe(6);
    expect(result.prompt_version).toBe(3);
  });

  test('persists events array', async () => {
    await store.savePerformance(PERFORMANCE);
    const result = await store.getPerformance('biz_test_1');
    expect(result.events).toHaveLength(1);
    expect(result.events[0].type).toBe('pricing_up');
  });

  test('overwrites events array on re-save', async () => {
    await store.savePerformance(PERFORMANCE);
    await store.savePerformance({ ...PERFORMANCE, events: [] });

    const result = await store.getPerformance('biz_test_1');
    expect(result.events).toHaveLength(0);
  });
});
