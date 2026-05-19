const LOCUS_API_BASE = 'https://api.paygentic.io';

function isLiveMode() {
  return !!process.env.LOCUS_API_KEY;
}

async function createPayment({ orderId, amountUsdc, businessName, baseUrl }) {
  if (!isLiveMode()) {
    return { mock: true, paymentId: `mock_pay_${Date.now()}`, paymentUrl: null };
  }

  const res = await fetch(`${LOCUS_API_BASE}/v0/payments`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.LOCUS_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      amount: amountUsdc.toFixed(2),
      currency: 'USD',
      reference: orderId,
      metadata: { order_id: orderId },
      lineItems: [{ description: businessName, amount: amountUsdc.toFixed(2), quantity: 1 }],
      successRedirectUrl: `${baseUrl}/order/${orderId}`,
      failureRedirectUrl: `${baseUrl}/order/${orderId}?failed=1`,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Locus payment creation failed (${res.status}): ${body}`);
  }

  const data = await res.json();
  return { mock: false, paymentId: data.id, paymentUrl: data.paymentUrl };
}

// Parses a real payment.completed.v0 webhook from Paygentic.
// Returns { orderId, paymentId } or throws if the event type is unexpected.
function parseWebhook(body) {
  if (body.eventType !== 'payment.completed.v0') {
    throw new Error(`Unexpected event type: ${body.eventType}`);
  }
  return {
    orderId: body.data.reference,
    paymentId: body.data.paymentId,
  };
}

module.exports = { isLiveMode, createPayment, parseWebhook };
