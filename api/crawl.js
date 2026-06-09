// api/crawl.js
// Mirrors gpt-crawler's core.ts logic as a Vercel serverless function
// Uses fetch + HTML parsing instead of Playwright (serverless-compatible)

export const config = { maxDuration: 30 };

// Strip HTML to clean text, mirroring getPageHtml() from gpt-crawler
function extractText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// Extract all internal links from HTML, mirroring enqueueLinks() from gpt-crawler
function extractLinks(html, baseUrl) {
  const base = new URL(baseUrl);
  const links = new Set();
  const hrefRegex = /href=["']([^"'#?]+)["']/gi;
  let match;
  while ((match = hrefRegex.exec(html)) !== null) {
    try {
      const href = match[1];
      const url = new URL(href, baseUrl);
      // Only same-domain links, no files
      if (
        url.hostname === base.hostname &&
        !href.match(/\.(pdf|jpg|jpeg|png|gif|svg|css|js|ico|xml|zip|mp4|woff|ttf)$/i)
      ) {
        links.add(url.origin + url.pathname);
      }
    } catch {}
  }
  return [...links];
}

// Extract page title
function extractTitle(html) {
  const m = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  return m ? m[1].trim() : 'Untitled';
}

// Extract meta description
function extractMeta(html) {
  const m = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i)
    || html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*name=["']description["']/i);
  return m ? m[1].trim() : '';
}

// Fetch a single page with timeout
async function fetchPage(url, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; ZonicksCrawler/1.0)',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      redirect: 'follow',
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('text/html')) return null;
    const html = await res.text();
    return html;
  } catch {
    clearTimeout(timer);
    return null;
  }
}

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { url, maxPagesToCrawl = 5, match } = req.body || {};

  if (!url) return res.status(400).json({ error: 'url is required' });

  let startUrl;
  try { startUrl = new URL(url); }
  catch { return res.status(400).json({ error: 'Invalid URL' }); }

  // Crawl — mirrors gpt-crawler's PlaywrightCrawler logic
  const visited = new Set();
  const queue = [startUrl.href];
  const results = []; // matches gpt-crawler output: [{title, url, html}]
  const max = Math.min(maxPagesToCrawl, 8);

  while (queue.length > 0 && results.length < max) {
    const current = queue.shift();
    if (visited.has(current)) continue;
    visited.add(current);

    const html = await fetchPage(current);
    if (!html) continue;

    const title = extractTitle(html);
    const text = extractText(html);
    const meta = extractMeta(html);

    // Push data — same structure as gpt-crawler's pushData()
    results.push({
      title,
      url: current,
      html: text.substring(0, 3000), // token limit equivalent
      meta,
    });

    // Enqueue links — same as gpt-crawler's enqueueLinks()
    if (results.length < max) {
      const links = extractLinks(html, current);
      // Prioritise important pages like gpt-crawler's match pattern
      const prioritised = links.sort((a, b) => {
        const important = /about|product|service|contact|portfolio|work|client/i;
        return (important.test(b) ? 1 : 0) - (important.test(a) ? 1 : 0);
      });
      for (const link of prioritised) {
        if (!visited.has(link) && !queue.includes(link)) {
          queue.push(link);
        }
      }
    }
  }

  // Return gpt-crawler compatible output
  return res.status(200).json({
    pages: results,
    stats: {
      pagesFound: results.length,
      wordsScanned: results.reduce((acc, p) => acc + p.html.split(' ').length, 0),
      domain: startUrl.hostname,
    }
  });
}
