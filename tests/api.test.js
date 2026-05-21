jest.mock('../src/agents', () => ({
  generateBusiness: jest.fn().mockResolvedValue({
    business_name: 'Test Resume Co',
    tagline: 'We fix resumes',
    service_type: 'resume_optimization',
    pricing_usdc: 5.00,
    fulfillment_prompt: 'You are a resume expert.',
  }),
  fulfillOrder: jest.fn().mockResolvedValue({ optimized_resume: 'Better resume here.' }),
}));

jest.mock('../src/lifecycle', () => ({
  runAdaptation: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../src/locus', () => ({
  isLiveMode: () => false,
  createPayment: jest.fn().mockResolvedValue({
    mock: true,
    paymentId: 'mock_pay_xyz',
    paymentUrl: null,
  }),
  parseWebhook: jest.requireActual('../src/locus').parseWebhook,
}));

const request = require('supertest');
const { app } = require('../server');
const store = require('../src/store');

beforeEach(() => store._reset());

// ── POST /api/business/create ─────────────────────────────────────────────────

describe('POST /api/business/create', () => {
  test('creates a business and returns it with a generated id', async () => {
    const res = await request(app)
      .post('/api/business/create')
      .send({ idea: 'resume optimization service' });

    expect(res.status).toBe(200);
    expect(res.body.business_name).toBe('Test Resume Co');
    expect(res.body.business_id).toBeDefined();
  });

  test('persists the business in the store', async () => {
    const res = await request(app)
      .post('/api/business/create')
      .send({ idea: 'resume optimization service' });

    const stored = await store.getBusiness(res.body.business_id);
    expect(stored).not.toBeNull();
    expect(stored.business_name).toBe('Test Resume Co');
  });

  test('returns 400 when idea is missing', async () => {
    const res = await request(app).post('/api/business/create').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
  });
});

// ── GET /api/business/:id ─────────────────────────────────────────────────────

describe('GET /api/business/:id', () => {
  test('returns the business when it exists', async () => {
    await store.saveBusiness({
      business_id: 'biz_api_1',
      business_name: 'API Test Co',
      tagline: 'testing',
      service_type: 'resume_optimization',
      pricing_usdc: 5,
      fulfillment_prompt: 'You are expert.',
      created_at: new Date().toISOString(),
    });

    const res = await request(app).get('/api/business/biz_api_1');
    expect(res.status).toBe(200);
    expect(res.body.business_name).toBe('API Test Co');
  });

  test('returns 404 for unknown business id', async () => {
    const res = await request(app).get('/api/business/nonexistent');
    expect(res.status).toBe(404);
  });
});

// ── POST /api/orders/create ───────────────────────────────────────────────────

describe('POST /api/orders/create', () => {
  const BIZ = {
    business_id: 'biz_order_test',
    business_name: 'Order Test Co',
    tagline: 'test',
    service_type: 'resume_optimization',
    pricing_usdc: 5,
    fulfillment_prompt: 'You are expert.',
    created_at: new Date().toISOString(),
  };

  beforeEach(() => store.saveBusiness(BIZ));

  test('creates an order with pending payment status', async () => {
    const res = await request(app)
      .post('/api/orders/create')
      .send({ business_id: 'biz_order_test', input_data: { resume_text: 'my resume' } });

    expect(res.status).toBe(200);
    expect(res.body.order_id).toBeDefined();
    expect(res.body.payment_status).toBe('pending');
  });

  test('persists the order in the store', async () => {
    const res = await request(app)
      .post('/api/orders/create')
      .send({ business_id: 'biz_order_test', input_data: { resume_text: 'my resume' } });

    const stored = await store.getOrder(res.body.order_id);
    expect(stored).not.toBeNull();
    expect(stored.business_id).toBe('biz_order_test');
  });

  test('returns 404 when business does not exist', async () => {
    const res = await request(app)
      .post('/api/orders/create')
      .send({ business_id: 'unknown_biz', input_data: { resume_text: 'my resume' } });

    expect(res.status).toBe(404);
  });

  test('returns 400 when business_id is missing', async () => {
    const res = await request(app)
      .post('/api/orders/create')
      .send({ input_data: { resume_text: 'my resume' } });

    expect(res.status).toBe(400);
  });

  test('returns 400 when input_data is missing', async () => {
    const res = await request(app)
      .post('/api/orders/create')
      .send({ business_id: 'biz_order_test' });

    expect(res.status).toBe(400);
  });
});

// ── GET /api/order/:id ────────────────────────────────────────────────────────

describe('GET /api/order/:id', () => {
  test('returns the order when it exists', async () => {
    await store.saveOrder({
      order_id: 'ord_api_1',
      business_id: 'biz_x',
      input_data: {},
      payment_status: 'pending',
      result: null,
      success_flag: undefined,
      fulfillment_time_seconds: null,
      created_at: new Date().toISOString(),
    });

    const res = await request(app).get('/api/order/ord_api_1');
    expect(res.status).toBe(200);
    expect(res.body.order_id).toBe('ord_api_1');
  });

  test('returns 404 for unknown order id', async () => {
    const res = await request(app).get('/api/order/nonexistent');
    expect(res.status).toBe(404);
  });
});

// ── GET /api/business/:id/performance ────────────────────────────────────────

describe('GET /api/business/:id/performance', () => {
  const BIZ = {
    business_id: 'biz_perf_test',
    business_name: 'Perf Test Co',
    tagline: 'test',
    service_type: 'resume_optimization',
    pricing_usdc: 5,
    fulfillment_prompt: 'You are expert.',
    created_at: new Date().toISOString(),
  };

  beforeEach(() => store.saveBusiness(BIZ));

  test('returns default performance when no adaptation has run', async () => {
    const res = await request(app).get('/api/business/biz_perf_test/performance');
    expect(res.status).toBe(200);
    expect(res.body.total_orders).toBe(0);
    expect(res.body.prompt_version).toBe(1);
    expect(res.body.events).toEqual([]);
  });

  test('reflects current pricing from the business', async () => {
    const res = await request(app).get('/api/business/biz_perf_test/performance');
    expect(res.body.current_pricing_usdc).toBe(5);
  });

  test('returns 404 when business does not exist', async () => {
    const res = await request(app).get('/api/business/nonexistent/performance');
    expect(res.status).toBe(404);
  });
});

// ── POST /webhook/payment-success (mock mode) ─────────────────────────────────

describe('POST /webhook/payment-success', () => {
  const BIZ = {
    business_id: 'biz_wh_test',
    business_name: 'Webhook Test Co',
    tagline: 'test',
    service_type: 'resume_optimization',
    pricing_usdc: 5,
    fulfillment_prompt: 'You are expert.',
    created_at: new Date().toISOString(),
  };
  const ORDER = {
    order_id: 'ord_wh_1',
    business_id: 'biz_wh_test',
    input_data: { resume_text: 'test resume' },
    payment_status: 'pending',
    result: null,
    success_flag: undefined,
    fulfillment_time_seconds: null,
    created_at: new Date().toISOString(),
  };

  beforeEach(async () => {
    await store.saveBusiness(BIZ);
    await store.saveOrder(ORDER);
  });

  test('marks the order as paid', async () => {
    const res = await request(app)
      .post('/webhook/payment-success')
      .send({ order_id: 'ord_wh_1' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // Give triggerFulfillment a tick to run
    await new Promise(r => setTimeout(r, 50));

    const order = await store.getOrder('ord_wh_1');
    expect(order.payment_status).toBe('paid');
  });

  test('uses provided payment_id when given', async () => {
    await request(app)
      .post('/webhook/payment-success')
      .send({ order_id: 'ord_wh_1', payment_id: 'pay_custom_123' });

    await new Promise(r => setTimeout(r, 50));

    const order = await store.getOrder('ord_wh_1');
    expect(order.payment_id).toBe('pay_custom_123');
  });

  test('returns 400 when order_id is missing', async () => {
    const res = await request(app).post('/webhook/payment-success').send({});
    expect(res.status).toBe(400);
  });

  test('returns 404 for unknown order', async () => {
    const res = await request(app)
      .post('/webhook/payment-success')
      .send({ order_id: 'no_such_order' });

    expect(res.status).toBe(404);
  });
});

// ── POST /checkout/create ─────────────────────────────────────────────────────

describe('POST /checkout/create', () => {
  const BIZ = {
    business_id: 'biz_co_test',
    business_name: 'Checkout Test Co',
    tagline: 'test',
    service_type: 'resume_optimization',
    pricing_usdc: 5,
    fulfillment_prompt: 'You are expert.',
    created_at: new Date().toISOString(),
  };
  const ORDER = {
    order_id: 'ord_co_1',
    business_id: 'biz_co_test',
    input_data: {},
    payment_status: 'pending',
    result: null,
    success_flag: undefined,
    fulfillment_time_seconds: null,
    created_at: new Date().toISOString(),
  };

  beforeEach(async () => {
    await store.saveBusiness(BIZ);
    await store.saveOrder(ORDER);
  });

  test('returns a mock payment in demo mode', async () => {
    const res = await request(app)
      .post('/checkout/create')
      .send({ order_id: 'ord_co_1', amount_usdc: 5 });

    expect(res.status).toBe(200);
    expect(res.body.payment_id).toBe('mock_pay_xyz');
    expect(res.body.mock).toBe(true);
  });

  test('returns 404 when order does not exist', async () => {
    const res = await request(app)
      .post('/checkout/create')
      .send({ order_id: 'no_such_order', amount_usdc: 5 });

    expect(res.status).toBe(404);
  });
});

// ── GET /api/config ───────────────────────────────────────────────────────────

describe('GET /api/config', () => {
  test('returns live: false in demo mode', async () => {
    const res = await request(app).get('/api/config');
    expect(res.status).toBe(200);
    expect(res.body.live).toBe(false);
  });
});
