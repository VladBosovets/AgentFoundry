require('dotenv').config();
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const { generateBusiness, fulfillOrder } = require('./src/agents');
const { isLiveMode, createPayment, parseWebhook, verifyWebhookSignature } = require('./src/locus');
const { runAdaptation } = require('./src/lifecycle');
const store = require('./src/store');
const { migrate } = require('./src/migrate');

const app = express();
app.use(express.static('public'));
app.use('/webhooks', express.raw({ type: 'application/json' }));
app.use(express.json());

const BASE_URL = process.env.BASE_URL || `http://localhost:${process.env.PORT || 3000}`;

// ── Business ──────────────────────────────────────────────────────────────────

app.post('/api/business/create', async (req, res) => {
  const { idea } = req.body;
  if (!idea) return res.status(400).json({ error: 'idea is required' });

  try {
    const businessDef = await generateBusiness(idea);
    const business = {
      business_id: uuidv4(),
      ...businessDef,
      created_at: new Date().toISOString(),
    };
    await store.saveBusiness(business);
    console.log(`Business created: ${business.business_name} (${business.business_id})`);
    res.json(business);
  } catch (err) {
    console.error('Business generation error:', err.message);
    res.status(500).json({ error: 'Failed to generate business', message: err.message });
  }
});

app.get('/api/business/:id', async (req, res) => {
  const business = await store.getBusiness(req.params.id);
  if (!business) return res.status(404).json({ error: 'Business not found' });
  res.json(business);
});

// ── Orders ────────────────────────────────────────────────────────────────────

app.post('/api/orders/create', async (req, res) => {
  const { business_id, input_data } = req.body;
  if (!business_id || !input_data) {
    return res.status(400).json({ error: 'business_id and input_data are required' });
  }

  const business = await store.getBusiness(business_id);
  if (!business) return res.status(404).json({ error: 'Business not found' });

  const order = {
    order_id: uuidv4(),
    business_id,
    input_data,
    payment_status: 'pending',
    result: null,
    success_flag: undefined,
    fulfillment_time_seconds: null,
    created_at: new Date().toISOString(),
  };
  await store.saveOrder(order);
  console.log(`Order created: ${order.order_id}`);
  res.json(order);
});

app.get('/api/order/:id', async (req, res) => {
  const order = await store.getOrder(req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  res.json(order);
});

app.get('/api/business/:id/performance', async (req, res) => {
  const business = await store.getBusiness(req.params.id);
  if (!business) return res.status(404).json({ error: 'Business not found' });

  let perf = await store.getPerformance(req.params.id);
  if (!perf) {
    perf = {
      business_id: req.params.id,
      total_orders: 0,
      successful_orders: 0,
      failure_rate: 0,
      avg_fulfillment_time: 0,
      current_pricing_usdc: business.pricing_usdc,
      prompt_version: 1,
      last_updated: new Date().toISOString(),
      events: [],
    };
  }
  // Always reflect the current live price
  perf.current_pricing_usdc = business.pricing_usdc;
  res.json(perf);
});

// ── Checkout ──────────────────────────────────────────────────────────────────

app.post('/checkout/create', async (req, res) => {
  const { order_id, amount_usdc } = req.body;

  const order = await store.getOrder(order_id);
  if (!order) return res.status(404).json({ error: 'Order not found' });

  const business = await store.getBusiness(order.business_id);

  try {
    const payment = await createPayment({
      orderId: order_id,
      amountUsdc: amount_usdc,
      businessName: business.business_name,
      baseUrl: BASE_URL,
    });

    order.payment_id = payment.paymentId;
    await store.saveOrder(order);

    console.log(`Checkout created [${payment.mock ? 'mock' : 'live'}] for order ${order_id}`);
    res.json({
      payment_id: payment.paymentId,
      payment_url: payment.paymentUrl,
      mock: payment.mock,
    });
  } catch (err) {
    console.error('Checkout error:', err.message);
    res.status(500).json({ error: 'Failed to create checkout', message: err.message });
  }
});

// ── Fulfillment ───────────────────────────────────────────────────────────────

async function triggerFulfillment(order_id) {
  const order = await store.getOrder(order_id);
  if (!order) return;

  const business = await store.getBusiness(order.business_id);
  const startTime = Date.now();
  console.log(`Fulfilling order ${order_id}...`);

  try {
    const result = await fulfillOrder(business, order);
    const elapsed = (Date.now() - startTime) / 1000;

    order.result = result;
    order.fulfilled_at = new Date().toISOString();
    order.fulfillment_time_seconds = elapsed;
    order.success_flag = true;
    await store.saveOrder(order);
    console.log(`Order ${order_id} fulfilled in ${elapsed.toFixed(1)}s`);

    await runAdaptation(order.business_id);
  } catch (err) {
    const elapsed = (Date.now() - startTime) / 1000;
    console.error(`Fulfillment failed for ${order_id}:`, err.message);

    order.result = { error: true, message: err.message };
    order.fulfillment_time_seconds = elapsed;
    order.success_flag = false;
    await store.saveOrder(order);

    await runAdaptation(order.business_id);
  }
}

// ── Locus webhook (real payment.completed.v0) ─────────────────────────────────

app.post('/webhooks/locus', async (req, res) => {
  const signature = req.get('x-locus-signature');
  if (!verifyWebhookSignature(req.body, signature)) {
    return res.status(401).json({ error: 'Invalid webhook signature' });
  }

  let body;
  try {
    body = JSON.parse(req.body.toString());
  } catch {
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  let parsed;
  try {
    parsed = parseWebhook(body);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  const { orderId, paymentId } = parsed;
  const order = await store.getOrder(orderId);
  if (!order) return res.status(404).json({ error: 'Order not found' });

  order.payment_status = 'paid';
  order.payment_id = paymentId;
  await store.saveOrder(order);

  res.json({ success: true });
  triggerFulfillment(orderId).catch(err => console.error('Fulfillment error:', err));
});

// ── Mock webhook (demo mode) ──────────────────────────────────────────────────

app.post('/webhook/payment-success', async (req, res) => {
  if (isLiveMode()) return res.status(404).json({ error: 'Not found' });

  const { order_id, payment_id } = req.body;
  if (!order_id) return res.status(400).json({ error: 'order_id is required' });

  const order = await store.getOrder(order_id);
  if (!order) return res.status(404).json({ error: 'Order not found' });

  order.payment_status = 'paid';
  order.payment_id = payment_id || `mock_payment_${Date.now()}`;
  await store.saveOrder(order);

  res.json({ success: true, order_id });
  triggerFulfillment(order_id).catch(err => console.error('Fulfillment error:', err));
});

// ── Config ────────────────────────────────────────────────────────────────────

app.get('/api/config', (_req, res) => res.json({ live: isLiveMode() }));

// ── Frontend routes ───────────────────────────────────────────────────────────

app.get('/business/:id', (_req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'business.html'))
);
app.get('/order/:id', (_req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'order.html'))
);

// ── Start ─────────────────────────────────────────────────────────────────────

async function start() {
  // Run migrations if Postgres is configured
  if (store.pool) {
    await migrate(store.pool);
  }

  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => {
    const mode = isLiveMode() ? '🟢 LIVE (Locus payments)' : '🟡 MOCK (no LOCUS_API_KEY)';
    console.log(`\nAgentFoundry running at ${BASE_URL}`);
    console.log(`Payment mode: ${mode}\n`);
  });
}

if (require.main === module) {
  start().catch(err => {
    console.error('Startup failed:', err);
    process.exit(1);
  });
}

module.exports = { app };
