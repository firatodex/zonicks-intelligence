// api/claude.js — proxies Claude API calls server-side (key stays secret)
export const config = { maxDuration: 25 };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'API key not configured' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch {} }

  const { messages, system } = body || {};
  if (!messages) return res.status(400).json({ error: 'messages required' });

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        system: system || 'You are a helpful assistant.',
        messages
      })
    });
    const data = await response.json();
    return res.status(200).json({ text: data.content?.[0]?.text || '' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
