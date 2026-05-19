require('dotenv').config();
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const { generateBusiness, fulfillOrder } = require('./src/agents');
const db = require('./src/db');

const app = express();
app.use(express.json());
app.use(express.static('public'));

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

// ── Checkout (mocked) ─────────────────────────────────────────────────────────

app.post('/checkout/create', (req, res) => {
  const { order_id, amount_usdc } = req.body;
  res.json({
    checkout_session_id: `mock_session_${Date.now()}`,
    status: 'created',
    order_id,
    amount_usdc,
  });
});

// ── Payment Webhook → triggers fulfillment ────────────────────────────────────

app.post('/webhook/payment-success', async (req, res) => {
  const { order_id, payment_id } = req.body;
  if (!order_id) return res.status(400).json({ error: 'order_id is required' });

  const order = db.orders.get(order_id);
  if (!order) return res.status(404).json({ error: 'Order not found' });

  order.payment_status = 'paid';
  order.payment_id = payment_id || `mock_payment_${Date.now()}`;
  db.orders.set(order_id, order);

  // Respond immediately — fulfillment runs in background
  res.json({ success: true, order_id });

  const business = db.businesses.get(order.business_id);
  console.log(`Fulfilling order ${order_id}...`);

  fulfillOrder(business, order)
    .then((result) => {
      order.result = result;
      order.fulfilled_at = new Date().toISOString();
      db.orders.set(order_id, order);
      console.log(`Order ${order_id} fulfilled successfully`);
    })
    .catch((err) => {
      console.error(`Fulfillment failed for order ${order_id}:`, err.message);
      order.result = { error: true, message: err.message };
      db.orders.set(order_id, order);
    });
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
  console.log(`\nAgentFoundry running at http://localhost:${PORT}\n`);
});
