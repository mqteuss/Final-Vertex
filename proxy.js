// api/proxy.js — Vercel Serverless Function

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  // O Vercel já decodifica o query string — NÃO usar decodeURIComponent outra vez
  const { url } = req.query;

  if (!url) return res.status(400).json({ error: 'Parâmetro "url" obrigatório.' });

  // Valida domínio permitido
  let targetUrl;
  try {
    targetUrl = url; // já vem decodificado pelo Vercel
    const parsed = new URL(targetUrl);
    if (!parsed.hostname.endsWith('statusinvest.com.br')) {
      return res.status(403).json({ error: 'Domínio não permitido.' });
    }
  } catch {
    return res.status(400).json({ error: `URL inválido: ${url}` });
  }

  console.log('[proxy] Fetching:', targetUrl);

  try {
    const response = await fetch(targetUrl, {
      method: 'GET',
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'pt-BR,pt;q=0.9',
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
      },
    });

    const contentType = response.headers.get('content-type') || '';
    console.log('[proxy] Response status:', response.status, '| Content-Type:', contentType);

    // Lê o body uma só vez
    const rawText = await response.text();

    // Detecta Cloudflare / challenge page
    if (
      !response.ok ||
      contentType.includes('text/html') ||
      rawText.trimStart().startsWith('<!') ||
      rawText.trimStart().startsWith('<html')
    ) {
      console.error('[proxy] Recebeu HTML em vez de JSON. Primeiros 300 chars:', rawText.slice(0, 300));
      return res.status(503).json({
        error: 'StatusInvest devolveu HTML (possível bloqueio Cloudflare).',
        httpStatus: response.status,
        preview: rawText.slice(0, 200),
      });
    }

    // Tenta fazer parse do JSON
    let data;
    try {
      data = JSON.parse(rawText);
    } catch (parseErr) {
      console.error('[proxy] JSON inválido. Primeiros 300 chars:', rawText.slice(0, 300));
      return res.status(502).json({
        error: 'Resposta não é JSON válido.',
        preview: rawText.slice(0, 200),
      });
    }

    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=60');
    res.setHeader('Content-Type', 'application/json');
    return res.status(200).json(data);

  } catch (err) {
    console.error('[proxy] Erro de rede:', err.message);
    return res.status(500).json({ error: 'Erro interno no proxy.', details: err.message });
  }
};
