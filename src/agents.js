const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

async function generateBusiness(idea) {
  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 2048,
    messages: [
      {
        role: 'user',
        content: `You are a business architect AI. A user wants to start: "${idea}".

Generate a business definition and return ONLY valid JSON (no markdown, no code fences, no explanation):
{
  "business_name": "creative and professional name for the business",
  "tagline": "one compelling sentence about the value proposition",
  "service_type": "resume_optimization",
  "pricing_usdc": 5,
  "inputs_required": ["resume_text"],
  "output_format": "optimized_resume",
  "fulfillment_prompt": "detailed system prompt for the AI fulfillment agent that rewrites resumes"
}

The fulfillment_prompt must be a concise system prompt (2-3 sentences) instructing an AI agent to rewrite resumes for clarity, impact, and ATS compatibility.`,
      },
    ],
  });

  const text = response.content[0].text.trim();
  console.log('[generateBusiness] raw response:\n', text.slice(0, 300));

  // 1. Try parsing the whole response directly
  try { return JSON.parse(text); } catch {}

  // 2. Try extracting from a ```json ... ``` code fence
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    try { return JSON.parse(fenceMatch[1].trim()); } catch {}
  }

  // 3. Try extracting the first {...} object
  const braceMatch = text.match(/\{[\s\S]*\}/);
  if (braceMatch) {
    try { return JSON.parse(braceMatch[0]); } catch (e) {
      throw new Error(`JSON parse failed: ${e.message}`);
    }
  }

  throw new Error(`No JSON found in response. Got: ${text.slice(0, 120)}`);
}

async function fulfillOrder(business, order) {
  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4096,
    system: business.fulfillment_prompt,
    messages: [
      {
        role: 'user',
        content: `Please optimize this resume:\n\n${order.input_data.resume_text}`,
      },
    ],
  });

  return {
    optimized_resume: response.content[0].text,
  };
}

module.exports = { generateBusiness, fulfillOrder };
