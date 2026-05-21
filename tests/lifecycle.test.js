// Mock Anthropic before lifecycle is required (evolvePrompt uses it)
jest.mock('@anthropic-ai/sdk', () =>
  jest.fn().mockImplementation(() => ({
    messages: {
      create: jest.fn().mockResolvedValue({
        content: [{ text: '{"updated_prompt": "Optimized prompt.", "change_reason": "Better ATS targeting"}' }],
      }),
    },
  }))
);

// Mock agents so regenerateBusiness doesn't call Claude
jest.mock('../src/agents', () => ({
  generateBusiness: jest.fn().mockResolvedValue({
    business_name: 'Regenerated Resume Co',
    tagline: 'Built better',
    service_type: 'resume_optimization',
    pricing_usdc: 4.50,
    fulfillment_prompt: 'Regenerated prompt',
  }),
  fulfillOrder: jest.fn(),
}));

const { runAdaptation } = require('../src/lifecycle');
const store = require('../src/store');

const BASE_BUSINESS = {
  business_id: 'biz_lc',
  business_name: 'Lifecycle Test Co',
  tagline: 'We test lifecycles',
  service_type: 'resume_optimization',
  pricing_usdc: 5,
  fulfillment_prompt: 'You are a resume expert.',
  created_at: new Date().toISOString(),
};

function makeOrder(id, success, time = 20) {
  return {
    order_id: id,
    business_id: 'biz_lc',
    input_data: { resume_text: 'test resume' },
    payment_status: 'paid',
    result: success
      ? { optimized_resume: 'better resume' }
      : { error: true, message: 'failed' },
    success_flag: success,
    fulfillment_time_seconds: time,
    created_at: new Date().toISOString(),
  };
}

describe('lifecycle', () => {
  beforeEach(async () => {
    store._reset();
    await store.saveBusiness({ ...BASE_BUSINESS });
  });

  // ── Metrics ───────────────────────────────────────────────────────────────────

  describe('metrics', () => {
    test('counts total and successful orders', async () => {
      await store.saveOrder(makeOrder('o1', true));
      await store.saveOrder(makeOrder('o2', true));
      await store.saveOrder(makeOrder('o3', false));

      await runAdaptation('biz_lc');

      const perf = await store.getPerformance('biz_lc');
      expect(perf.total_orders).toBe(3);
      expect(perf.successful_orders).toBe(2);
    });

    test('computes failure_rate as a percentage', async () => {
      await store.saveOrder(makeOrder('o1', false));
      await store.saveOrder(makeOrder('o2', false));
      await store.saveOrder(makeOrder('o3', true));

      await runAdaptation('biz_lc');

      const perf = await store.getPerformance('biz_lc');
      expect(perf.failure_rate).toBeCloseTo(66.7, 0);
    });

    test('computes average fulfillment time', async () => {
      await store.saveOrder(makeOrder('o1', true, 10));
      await store.saveOrder(makeOrder('o2', true, 30));

      await runAdaptation('biz_lc');

      const perf = await store.getPerformance('biz_lc');
      expect(perf.avg_fulfillment_time).toBe(20);
    });

    test('initializes default performance for a new business', async () => {
      // No orders — runAdaptation still initialises via recomputeMetrics
      await runAdaptation('biz_lc');

      const perf = await store.getPerformance('biz_lc');
      expect(perf).not.toBeNull();
      expect(perf.total_orders).toBe(0);
      expect(perf.prompt_version).toBe(1);
      expect(perf.events).toEqual([]);
    });
  });

  // ── Pricing adaptation ────────────────────────────────────────────────────────

  describe('pricing', () => {
    test('increases price when success rate is above 80%', async () => {
      await store.saveOrder(makeOrder('o1', true)); // 100% success

      await runAdaptation('biz_lc');

      const business = await store.getBusiness('biz_lc');
      expect(business.pricing_usdc).toBeGreaterThan(5);
    });

    test('price increase stays within the 10–25% band', async () => {
      await store.saveOrder(makeOrder('o1', true));

      await runAdaptation('biz_lc');

      const business = await store.getBusiness('biz_lc');
      expect(business.pricing_usdc).toBeGreaterThanOrEqual(5.50); // +10%
      expect(business.pricing_usdc).toBeLessThanOrEqual(6.25);    // +25%
    });

    test('decreases price when success rate is below 50%', async () => {
      await store.saveOrder(makeOrder('o1', false)); // 0% success

      await runAdaptation('biz_lc');

      const business = await store.getBusiness('biz_lc');
      expect(business.pricing_usdc).toBeLessThan(5);
    });

    test('price decrease stays within the 10–20% band', async () => {
      await store.saveOrder(makeOrder('o1', false));

      await runAdaptation('biz_lc');

      const business = await store.getBusiness('biz_lc');
      expect(business.pricing_usdc).toBeGreaterThanOrEqual(4.00); // -20%
      expect(business.pricing_usdc).toBeLessThanOrEqual(4.50);    // -10%
    });

    test('does not change price when success rate is between 50% and 80%', async () => {
      // 3 success + 2 fail = 60% — above decrease threshold, below increase threshold
      await store.saveOrder(makeOrder('o1', true));
      await store.saveOrder(makeOrder('o2', true));
      await store.saveOrder(makeOrder('o3', true));
      await store.saveOrder(makeOrder('o4', false));
      await store.saveOrder(makeOrder('o5', false));

      await runAdaptation('biz_lc');

      const business = await store.getBusiness('biz_lc');
      expect(business.pricing_usdc).toBe(5);
    });

    test('price never drops below $1 regardless of failure rate', async () => {
      await store.saveBusiness({ ...BASE_BUSINESS, pricing_usdc: 1.05 });
      await store.saveOrder(makeOrder('o1', false));

      await runAdaptation('biz_lc');

      const business = await store.getBusiness('biz_lc');
      expect(business.pricing_usdc).toBeGreaterThanOrEqual(1);
    });

    test('logs a pricing_up event when price increases', async () => {
      await store.saveOrder(makeOrder('o1', true));
      await runAdaptation('biz_lc');

      const perf = await store.getPerformance('biz_lc');
      expect(perf.events.some(e => e.type === 'pricing_up')).toBe(true);
    });

    test('logs a pricing_down event when price decreases', async () => {
      await store.saveOrder(makeOrder('o1', false));
      await runAdaptation('biz_lc');

      const perf = await store.getPerformance('biz_lc');
      expect(perf.events.some(e => e.type === 'pricing_down')).toBe(true);
    });

    test('pricing event message includes old and new price', async () => {
      await store.saveOrder(makeOrder('o1', true));
      await runAdaptation('biz_lc');

      const perf = await store.getPerformance('biz_lc');
      const event = perf.events.find(e => e.type === 'pricing_up');
      expect(event.message).toContain('$5');
    });
  });

  // ── Prompt evolution ──────────────────────────────────────────────────────────

  describe('prompt evolution', () => {
    test('does not evolve prompt on the first evaluation', async () => {
      await store.saveOrder(makeOrder('o1', true));
      await runAdaptation('biz_lc'); // eval 1 — 1 % 2 ≠ 0, no evolution

      const perf = await store.getPerformance('biz_lc');
      expect(perf.prompt_version).toBe(1);
    });

    test('evolves prompt on the second evaluation', async () => {
      await store.saveOrder(makeOrder('o1', true));
      await runAdaptation('biz_lc'); // eval 1

      await store.saveOrder(makeOrder('o2', true));
      await runAdaptation('biz_lc'); // eval 2 — 2 % 2 = 0, evolve

      const perf = await store.getPerformance('biz_lc');
      expect(perf.prompt_version).toBe(2);
    });

    test('updates fulfillment_prompt on the business after evolution', async () => {
      await store.saveOrder(makeOrder('o1', true));
      await runAdaptation('biz_lc');
      await store.saveOrder(makeOrder('o2', true));
      await runAdaptation('biz_lc');

      const business = await store.getBusiness('biz_lc');
      expect(business.fulfillment_prompt).toBe('Optimized prompt.');
    });

    test('logs a prompt_evolved event with the change reason', async () => {
      await store.saveOrder(makeOrder('o1', true));
      await runAdaptation('biz_lc');
      await store.saveOrder(makeOrder('o2', true));
      await runAdaptation('biz_lc');

      const perf = await store.getPerformance('biz_lc');
      const event = perf.events.find(e => e.type === 'prompt_evolved');
      expect(event).toBeDefined();
      expect(event.message).toContain('v2');
    });
  });

  // ── Business regeneration ─────────────────────────────────────────────────────

  describe('regeneration', () => {
    test('regenerates business when failure rate > 60% after 5+ orders', async () => {
      for (let i = 1; i <= 5; i++) {
        await store.saveOrder(makeOrder(`o${i}`, false)); // 0% success
      }
      await runAdaptation('biz_lc');

      const business = await store.getBusiness('biz_lc');
      expect(business.business_name).toBe('Regenerated Resume Co');
      expect(business.generation).toBe(2);
    });

    test('preserves business_id after regeneration', async () => {
      for (let i = 1; i <= 5; i++) {
        await store.saveOrder(makeOrder(`o${i}`, false));
      }
      await runAdaptation('biz_lc');

      const business = await store.getBusiness('biz_lc');
      expect(business.business_id).toBe('biz_lc');
    });

    test('logs regenerated event after regeneration', async () => {
      for (let i = 1; i <= 5; i++) {
        await store.saveOrder(makeOrder(`o${i}`, false));
      }
      await runAdaptation('biz_lc');

      const perf = await store.getPerformance('biz_lc');
      expect(perf.events.some(e => e.type === 'regenerated')).toBe(true);
    });

    test('does not regenerate with fewer than 5 orders even at 0% success', async () => {
      for (let i = 1; i <= 4; i++) {
        await store.saveOrder(makeOrder(`o${i}`, false));
      }
      await runAdaptation('biz_lc');

      const business = await store.getBusiness('biz_lc');
      expect(business.business_name).toBe('Lifecycle Test Co'); // unchanged
    });

    test('does not regenerate when success rate is above 40%', async () => {
      // 3 success, 2 fail = 60% success — above the 40% regeneration threshold
      for (let i = 1; i <= 3; i++) await store.saveOrder(makeOrder(`s${i}`, true));
      for (let i = 1; i <= 2; i++) await store.saveOrder(makeOrder(`f${i}`, false));
      await runAdaptation('biz_lc');

      const business = await store.getBusiness('biz_lc');
      expect(business.business_name).toBe('Lifecycle Test Co'); // unchanged
    });
  });
});
