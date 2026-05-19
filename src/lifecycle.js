const Anthropic = require('@anthropic-ai/sdk');
const db = require('./db');

// Run adaptation check after every completed order.
// Set higher (e.g. 3) to only adapt every N orders.
const EVAL_INTERVAL = 1;
const PROMPT_EVAL_INTERVAL = 2; // evolve prompt every 2nd evaluation

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── Performance state ─────────────────────────────────────────────────────────

function getPerformance(businessId) {
  if (!db.performance.has(businessId)) {
    const business = db.businesses.get(businessId);
    db.performance.set(businessId, {
      business_id: businessId,
      total_orders: 0,
      successful_orders: 0,
      failure_rate: 0,
      avg_fulfillment_time: 0,
      current_pricing_usdc: business?.pricing_usdc || 5,
      prompt_version: 1,
      last_updated: new Date().toISOString(),
      events: [],
    });
  }
  return db.performance.get(businessId);
}

function addEvent(perf, type, message) {
  perf.events.unshift({ timestamp: new Date().toISOString(), type, message });
  perf.events = perf.events.slice(0, 30);
  console.log(`[Lifecycle:${perf.business_id.slice(0, 8)}] ${message}`);
}

// ── Metrics recalculation ─────────────────────────────────────────────────────

function recomputeMetrics(businessId) {
  const perf = getPerformance(businessId);

  const orders = [];
  for (const o of db.orders.values()) {
    if (o.business_id === businessId && o.success_flag !== undefined) {
      orders.push(o);
    }
  }

  perf.total_orders = orders.length;
  perf.successful_orders = orders.filter(o => o.success_flag).length;
  perf.failure_rate = perf.total_orders > 0
    ? +((1 - perf.successful_orders / perf.total_orders) * 100).toFixed(1)
    : 0;

  const times = orders
    .filter(o => o.fulfillment_time_seconds > 0)
    .map(o => o.fulfillment_time_seconds);
  perf.avg_fulfillment_time = times.length
    ? +(times.reduce((a, b) => a + b, 0) / times.length).toFixed(1)
    : 0;

  perf.last_updated = new Date().toISOString();
  db.performance.set(businessId, perf);
  return perf;
}

// ── Pricing adaptation ────────────────────────────────────────────────────────

function adaptPricing(business, perf, successRate) {
  const old = business.pricing_usdc;

  if (successRate > 0.8) {
    const factor = 1 + (0.10 + Math.random() * 0.15); // +10–25%
    business.pricing_usdc = Math.round(business.pricing_usdc * factor * 100) / 100;
    perf.current_pricing_usdc = business.pricing_usdc;
    addEvent(perf, 'pricing_up',
      `📈 High demand (${(successRate * 100).toFixed(0)}% success). Price raised $${old} → $${business.pricing_usdc} USDC`);
  } else if (successRate < 0.5) {
    const factor = 1 - (0.10 + Math.random() * 0.10); // −10–20%
    business.pricing_usdc = Math.round(Math.max(1, business.pricing_usdc * factor) * 100) / 100;
    perf.current_pricing_usdc = business.pricing_usdc;
    addEvent(perf, 'pricing_down',
      `📉 Low performance (${(successRate * 100).toFixed(0)}% success). Price reduced $${old} → $${business.pricing_usdc} USDC`);
  }
}

// ── Prompt evolution ──────────────────────────────────────────────────────────

async function evolvePrompt(business, perf, successRate) {
  const context = successRate < 0.6
    ? `The business has a ${(successRate * 100).toFixed(0)}% success rate. Focus on reliability and quality.`
    : `The business is performing well. Optimize for speed and output quality.`;

  try {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 400,
      messages: [{
        role: 'user',
        content: `Improve this AI fulfillment agent's system prompt.

Current prompt: "${business.fulfillment_prompt}"
Context: ${context}
Avg fulfillment time: ${perf.avg_fulfillment_time}s

Return ONLY valid JSON (no markdown):
{"updated_prompt": "...", "change_reason": "brief reason"}`,
      }],
    });

    const text = response.content[0].text.trim();
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return;

    const { updated_prompt, change_reason } = JSON.parse(match[0]);
    if (!updated_prompt) return;

    business.fulfillment_prompt = updated_prompt;
    perf.prompt_version += 1;
    addEvent(perf, 'prompt_evolved',
      `🧠 Prompt evolved to v${perf.prompt_version}: ${change_reason}`);
  } catch (err) {
    console.error('[Lifecycle] Prompt evolution error:', err.message);
  }
}

// ── Business regeneration ─────────────────────────────────────────────────────

async function regenerateBusiness(business, perf) {
  addEvent(perf, 'regenerating',
    `⚠️ Failure rate ${perf.failure_rate}% after ${perf.total_orders} orders. Agent is rethinking the business...`);

  try {
    const { generateBusiness } = require('./agents');
    const newDef = await generateBusiness(
      `${business.service_type} — improved, more reliable version`
    );

    const generation = (business.generation || 1) + 1;
    Object.assign(business, {
      ...newDef,
      business_id: business.business_id,
      generation,
      regenerated_at: new Date().toISOString(),
    });
    perf.prompt_version = 1;
    perf.current_pricing_usdc = business.pricing_usdc;

    addEvent(perf, 'regenerated',
      `🔄 Business regenerated (gen ${generation}): now "${business.business_name}" at $${business.pricing_usdc} USDC`);

    db.businesses.set(business.business_id, business);
  } catch (err) {
    console.error('[Lifecycle] Regeneration error:', err.message);
  }
}

// ── Main lifecycle entrypoint ─────────────────────────────────────────────────

async function runAdaptation(businessId) {
  const perf = recomputeMetrics(businessId);
  const business = db.businesses.get(businessId);
  if (!business) return;

  // Only run full evaluation every EVAL_INTERVAL orders
  if (perf.total_orders === 0 || perf.total_orders % EVAL_INTERVAL !== 0) return;

  const successRate = perf.total_orders > 0
    ? perf.successful_orders / perf.total_orders
    : 0;

  console.log(
    `[Lifecycle] Evaluating "${business.business_name}" — ` +
    `${(successRate * 100).toFixed(0)}% success, ` +
    `${perf.total_orders} orders, ` +
    `$${business.pricing_usdc} USDC`
  );

  // Regenerate on critical failure (takes precedence)
  if (successRate < 0.4 && perf.total_orders >= 5) {
    await regenerateBusiness(business, perf);
    db.businesses.set(businessId, business);
    db.performance.set(businessId, perf);
    return;
  }

  // Adapt pricing
  adaptPricing(business, perf, successRate);

  // Evolve prompt every PROMPT_EVAL_INTERVAL evaluations
  const evalCount = perf.total_orders / EVAL_INTERVAL;
  if (evalCount % PROMPT_EVAL_INTERVAL === 0 || successRate < 0.6) {
    await evolvePrompt(business, perf, successRate);
  }

  db.businesses.set(businessId, business);
  db.performance.set(businessId, perf);
}

module.exports = { runAdaptation, getPerformance, recomputeMetrics };
