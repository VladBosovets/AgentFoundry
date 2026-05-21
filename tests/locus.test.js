const { parseWebhook, isLiveMode } = require('../src/locus');

const VALID_PAYLOAD = {
  eventType: 'payment.completed.v0',
  eventId: 'evt_test_abc',
  timestamp: '2026-05-20T10:00:00.000Z',
  data: {
    paymentId: 'pay_test_xyz',
    merchantId: 'org_test',
    customerId: 'cus_test',
    amount: '5.00',
    currency: 'USD',
    reference: 'order_id_123',
    completedAt: '2026-05-20T10:00:00.000Z',
  },
};

// ── parseWebhook ──────────────────────────────────────────────────────────────

describe('parseWebhook', () => {
  test('extracts orderId from data.reference', () => {
    const result = parseWebhook(VALID_PAYLOAD);
    expect(result.orderId).toBe('order_id_123');
  });

  test('extracts paymentId from data.paymentId', () => {
    const result = parseWebhook(VALID_PAYLOAD);
    expect(result.paymentId).toBe('pay_test_xyz');
  });

  test('throws on payment.failed.v0', () => {
    expect(() =>
      parseWebhook({ ...VALID_PAYLOAD, eventType: 'payment.failed.v0' })
    ).toThrow('Unexpected event type: payment.failed.v0');
  });

  test('throws on payment.expired.v0', () => {
    expect(() =>
      parseWebhook({ ...VALID_PAYLOAD, eventType: 'payment.expired.v0' })
    ).toThrow('Unexpected event type');
  });

  test('throws on unrelated subscription events', () => {
    expect(() =>
      parseWebhook({ ...VALID_PAYLOAD, eventType: 'subscription.created.v0' })
    ).toThrow('Unexpected event type');
  });

  test('works with different order id values', () => {
    const result = parseWebhook({
      ...VALID_PAYLOAD,
      data: { ...VALID_PAYLOAD.data, reference: 'different-order-id' },
    });
    expect(result.orderId).toBe('different-order-id');
  });
});

// ── isLiveMode ────────────────────────────────────────────────────────────────

describe('isLiveMode', () => {
  const saved = process.env.LOCUS_API_KEY;
  afterEach(() => {
    if (saved === undefined) delete process.env.LOCUS_API_KEY;
    else process.env.LOCUS_API_KEY = saved;
  });

  test('returns false when LOCUS_API_KEY is not set', () => {
    delete process.env.LOCUS_API_KEY;
    expect(isLiveMode()).toBe(false);
  });

  test('returns false when LOCUS_API_KEY is empty string', () => {
    process.env.LOCUS_API_KEY = '';
    expect(isLiveMode()).toBe(false);
  });

  test('returns true when LOCUS_API_KEY has a value', () => {
    process.env.LOCUS_API_KEY = 'locus_test_key_123';
    expect(isLiveMode()).toBe(true);
  });
});
