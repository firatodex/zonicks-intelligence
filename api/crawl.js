// api/crawl.js — Vercel serverless function
// Mirrors gpt-crawler logic: fetch pages, extract text, follow links

export const config = { maxDuration: 25 };

function extractText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\s{2,}/g, ' ').trim();
}

function extractLinks(html, baseUrl) {
  const base = new URL(baseUrl);
  const links = new Set();
  const re = /href=["']([^"'#?]+)["']/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    try {
      const url = new URL(m[1], baseUrl);
      if (url.hostname === base.hostname &&
          !m[1].match(/\.(pdf|jpg|jpeg|png|gif|svg|css|js|ico|xml|zip|mp4|woff|ttf)$/i)) {
        links.add(url.origin + url.pathname);
      }
    } catch {}
  }
  return [...links];
}

function extractTitle(html) {
  const m = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return m ? m[1].trim() : 'Page';
}

function extractMeta(html) {
  const m = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i)
    || html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*name=["']description["']/i);
  return m ? m[1].trim() : '';
}

async function fetchPage(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      }
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('text/html')) return null;
    return await res.text();
  } catch { clearTimeout(timer); return null; }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch {} }

  const { url, maxPagesToCrawl = 5 } = body || {};
  if (!url) return res.status(400).json({ error: 'url required' });

  let startUrl;
  try { startUrl = new URL(url); }
  catch { return res.status(400).json({ error: 'Invalid URL' }); }

  const visited = new Set();
  const queue = [startUrl.href];
  const results = [];
  const max = Math.min(Number(maxPagesToCrawl) || 5, 6);

  while (queue.length > 0 && results.length < max) {
    const current = queue.shift();
    if (visited.has(current)) continue;
    visited.add(current);

    const html = await fetchPage(current);
    if (!html) continue;

    const text = extractText(html);
    results.push({
      title: extractTitle(html),
      url: current,
      html: text.substring(0, 3000),
      meta: extractMeta(html),
    });

    if (results.length < max) {
      const links = extractLinks(html, current);
      const sorted = links.sort((a, b) => {
        const imp = /about|product|service|contact|work|client|portfolio/i;
        return (imp.test(b) ? 1 : 0) - (imp.test(a) ? 1 : 0);
      });
      for (const link of sorted.slice(0, 8)) {
        if (!visited.has(link) && !queue.includes(link)) queue.push(link);
      }
    }
  }

  return res.status(200).json({
    pages: results,
    stats: {
      pagesFound: results.length,
      wordsScanned: results.reduce((a, p) => a + p.html.split(' ').length, 0),
      domain: startUrl.hostname,
    }
  });
}
