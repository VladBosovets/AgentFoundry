# AgentFoundry

**PayWithLocus Week 4 — LocusFounder Hackathon**

An AI agent that creates and operates a business autonomously. Give it an idea — it generates a storefront, accepts orders, processes payments, and fulfills them using Claude.

## The Loop

```
Idea → Business Generation → Storefront → Order → Payment → AI Fulfillment → Output
```

1. User describes a business idea
2. Agent generates a structured business definition (name, tagline, pricing, fulfillment prompt)
3. A live storefront is created at `/business/:id`
4. User submits their resume + pays (mocked USDC)
5. Payment webhook fires → AI fulfillment agent runs
6. Optimized resume delivered at `/order/:id`

## Stack

- **Backend** — Node.js + Express
- **AI** — Claude (`claude-sonnet-4-6`) via Anthropic SDK
- **Storage** — In-memory (Map)
- **Payments** — Mocked (compatible with CheckoutWithLocus webhooks)
- **Frontend** — Vanilla HTML/CSS/JS

## Setup

```bash
git clone https://github.com/VladBosovets/AgentFoundry.git
cd AgentFoundry
npm install
cp .env.example .env
# Add your ANTHROPIC_API_KEY to .env
npm start
```

Open [http://localhost:3000](http://localhost:3000)

## API

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/business/create` | Generate business from idea |
| `GET` | `/api/business/:id` | Get business definition |
| `POST` | `/api/orders/create` | Create an order |
| `POST` | `/checkout/create` | Mock checkout session |
| `POST` | `/webhook/payment-success` | Mock payment webhook → triggers fulfillment (demo mode only) |
| `POST` | `/webhooks/locus` | Real Locus payment webhook → triggers fulfillment (requires `LOCUS_WEBHOOK_SECRET`) |
| `GET` | `/api/order/:id` | Get order + result |

## Architecture Notes

- `/webhook/payment-success` responds immediately and runs fulfillment async — compatible with real webhook delivery from CheckoutWithLocus. It only works in demo mode (no `LOCUS_API_KEY`) — once live payments are configured it returns 404 so payment can't be bypassed.
- `/webhooks/locus` verifies an HMAC-SHA256 signature (`x-locus-signature` header) against `LOCUS_WEBHOOK_SECRET` before trusting the payload; requests without a valid signature are rejected with 401.
- Business and order storage uses `Map` — drop-in replaceable with any DB
- Fulfillment prompt is generated per-business by the agent, not hardcoded

## Future Integrations

- **BuildWithLocus** — deploy storefronts to production URLs
- **CheckoutWithLocus** — real USDC payments + webhook signing
- **Locus Wallet** — revenue tracking per business
