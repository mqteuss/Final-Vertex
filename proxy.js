// api/proxy.js — Vercel Serverless Function
// Proxy para o StatusInvest com headers de browser real para contornar Cloudflare

module.exports = async function handler(req, res) {
  // Permite CORS para o frontend
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const { url } = req.query;

  if (!url) {
    return res.status(400).json({ error: 'Parâmetro "url" obrigatório.' });
  }

  // Valida que só permitimos requests para o StatusInvest (segurança)
  let targetUrl;
  try {
    targetUrl = decodeURIComponent(url);
    const parsed = new URL(targetUrl);
    if (!parsed.hostname.endsWith('statusinvest.com.br')) {
      return res.status(403).json({ error: 'Domínio não permitido.' });
    }
  } catch {
    return res.status(400).json({ error: 'URL inválido.' });
  }

  try {
    const response = await fetch(targetUrl, {
      method: 'GET',
      headers: {
        // Headers que imitam um browser real — essencial para passar pelo Cloudflare
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
        'Accept-Encoding': 'gzip, deflate, br',
        'Referer': 'https://statusinvest.com.br/',
        'Origin': 'https://statusinvest.com.br',
        'X-Requested-With': 'XMLHttpRequest',
        'sec-ch-ua': '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
        'Sec-Fetch-Dest': 'empty',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Site': 'same-origin',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });

    if (!response.ok) {
      return res.status(response.status).json({
        error: `StatusInvest retornou ${response.status}`,
        status: response.status,
      });
    }

    const contentType = response.headers.get('content-type') || '';
    
    // Se for HTML (Cloudflare challenge page), retorna erro claro
    if (contentType.includes('text/html')) {
      return res.status(503).json({
        error: 'Cloudflare challenge page detectada. Tente novamente.',
        blocked: true,
      });
    }

    const data = await response.json();

    // Cache de 5 minutos no CDN da Vercel para reduzir requests
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=60');
    res.setHeader('Content-Type', 'application/json');

    return res.status(200).json(data);
  } catch (err) {
    console.error('[proxy] Erro:', err.message);
    return res.status(500).json({ error: 'Erro interno no proxy.', details: err.message });
  }
}
