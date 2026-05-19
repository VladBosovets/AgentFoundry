require('dotenv').config();
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const { generateBusiness, fulfillOrder } = require('./src/agents');
const { isLiveMode, createPayment, parseWebhook } = require('./src/locus');
const db = require('./src/db');

const app = express();
app.use(express.static('public'));

// Raw body needed for Svix webhook signature verification
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
    db.businesses.set(business.business_id, business);
    console.log(`Business created: ${business.business_name} (${business.business_id})`);
    res.json(business);
  } catch (err) {
    console.error('Business generation error:', err.message);
    res.status(500).json({ error: 'Failed to generate business', message: err.message });
  }
});

app.get('/api/business/:id', (req, res) => {
  const business = db.businesses.get(req.params.id);
  if (!business) return res.status(404).json({ error: 'Business not found' });
  res.json(business);
});

// ── Orders ────────────────────────────────────────────────────────────────────

app.post('/api/orders/create', (req, res) => {
  const { business_id, input_data } = req.body;
  if (!business_id || !input_data) {
    return res.status(400).json({ error: 'business_id and input_data are required' });
  }

  const business = db.businesses.get(business_id);
  if (!business) return res.status(404).json({ error: 'Business not found' });

  const order = {
    order_id: uuidv4(),
    business_id,
    input_data,
    payment_status: 'pending',
    result: null,
    created_at: new Date().toISOString(),
  };
  db.orders.set(order.order_id, order);
  console.log(`Order created: ${order.order_id}`);
  res.json(order);
});

app.get('/api/order/:id', (req, res) => {
  const order = db.orders.get(req.params.id);
  if (!order) return res.status(404).json({ error: 'Order not found' });
  res.json(order);
});

// ── Checkout ──────────────────────────────────────────────────────────────────
// In live mode: creates a real Locus payment and returns the hosted paymentUrl.
// In mock mode: returns paymentUrl: null so the frontend fires the mock webhook.

app.post('/checkout/create', async (req, res) => {
  const { order_id, amount_usdc } = req.body;

  const order = db.orders.get(order_id);
  if (!order) return res.status(404).json({ error: 'Order not found' });

  const business = db.businesses.get(order.business_id);

  try {
    const payment = await createPayment({
      orderId: order_id,
      amountUsdc: amount_usdc,
      businessName: business.business_name,
      baseUrl: BASE_URL,
    });

    order.payment_id = payment.paymentId;
    db.orders.set(order_id, order);

    const mode = payment.mock ? 'mock' : 'live';
    console.log(`Checkout created [${mode}] for order ${order_id}`);

    res.json({
      payment_id: payment.paymentId,
      payment_url: payment.paymentUrl, // null in mock mode
      mock: payment.mock,
    });
  } catch (err) {
    console.error('Checkout error:', err.message);
    res.status(500).json({ error: 'Failed to create checkout', message: err.message });
  }
});

// ── Fulfillment helper ────────────────────────────────────────────────────────

function triggerFulfillment(order_id) {
  const order = db.orders.get(order_id);
  if (!order) return;

  const business = db.businesses.get(order.business_id);
  console.log(`Fulfilling order ${order_id}...`);

  fulfillOrder(business, order)
    .then((result) => {
      order.result = result;
      order.fulfilled_at = new Date().toISOString();
      db.orders.set(order_id, order);
      console.log(`Order ${order_id} fulfilled`);
    })
    .catch((err) => {
      console.error(`Fulfillment failed for ${order_id}:`, err.message);
      order.result = { error: true, message: err.message };
      db.orders.set(order_id, order);
    });
}

// ── Locus (Paygentic) webhook — real payment.completed.v0 events ──────────────

app.post('/webhooks/locus', (req, res) => {
  // req.body is a Buffer here (raw middleware) — parse it
  let body;
  try {
    body = JSON.parse(req.body.toString());
  } catch {
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  // TODO: verify Svix signature with process.env.LOCUS_WEBHOOK_SECRET
  // const wh = new Webhook(process.env.LOCUS_WEBHOOK_SECRET);
  // wh.verify(req.body, { 'svix-id': ..., 'svix-timestamp': ..., 'svix-signature': ... });

  let parsed;
  try {
    parsed = parseWebhook(body);
  } catch (err) {
    console.warn('Webhook parse error:', err.message);
    return res.status(400).json({ error: err.message });
  }

  const { orderId, paymentId } = parsed;
  const order = db.orders.get(orderId);
  if (!order) {
    console.warn(`Webhook: order ${orderId} not found`);
    return res.status(404).json({ error: 'Order not found' });
  }

  order.payment_status = 'paid';
  order.payment_id = paymentId;
  db.orders.set(orderId, order);

  res.json({ success: true });          // Respond to Locus within 15s
  triggerFulfillment(orderId);          // Run fulfillment async
});

// ── Mock webhook (dev/demo mode) ──────────────────────────────────────────────

app.post('/webhook/payment-success', (req, res) => {
  const { order_id, payment_id } = req.body;
  if (!order_id) return res.status(400).json({ error: 'order_id is required' });

  const order = db.orders.get(order_id);
  if (!order) return res.status(404).json({ error: 'Order not found' });

  order.payment_status = 'paid';
  order.payment_id = payment_id || `mock_payment_${Date.now()}`;
  db.orders.set(order_id, order);

  res.json({ success: true, order_id });
  triggerFulfillment(order_id);
});

// ── Config endpoint (lets frontend know the mode) ─────────────────────────────

app.get('/api/config', (_req, res) => {
  res.json({ live: isLiveMode() });
});

// ── Frontend page routes ───────────────────────────────────────────────────────

app.get('/business/:id', (_req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'business.html'))
);

app.get('/order/:id', (_req, res) =>
  res.sendFile(path.join(__dirname, 'public', 'order.html'))
);

// ── Start ─────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  const mode = isLiveMode() ? '🟢 LIVE (Locus payments)' : '🟡 MOCK (no LOCUS_API_KEY)';
  console.log(`\nAgentFoundry running at ${BASE_URL}`);
  console.log(`Payment mode: ${mode}\n`);
});
