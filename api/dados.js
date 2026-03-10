// Lê dados do JSONBin (publicados pelo pusher.js rodando no hub)
const JSONBIN_BIN_ID  = process.env.JSONBIN_BIN_ID;
const JSONBIN_API_KEY = process.env.JSONBIN_API_KEY;

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (!JSONBIN_BIN_ID) {
    return res.status(500).json({ error: 'JSONBIN_BIN_ID não configurado nas variáveis de ambiente do Vercel.' });
  }

  try {
    const headers = { 'X-Bin-Meta': 'false' };
    if (JSONBIN_API_KEY) headers['X-Access-Key'] = JSONBIN_API_KEY;

    const response = await fetch(`https://api.jsonbin.io/v3/b/${JSONBIN_BIN_ID}/latest`, { headers });

    if (!response.ok) {
      return res.status(502).json({ error: `JSONBin retornou HTTP ${response.status}` });
    }

    const result = await response.json();
    // JSONBin envolve os dados em { record: {...} }
    const data = result.record || result;

    return res.status(200).json(data);

  } catch (err) {
    return res.status(500).json({ error: `Erro interno: ${err.message}` });
  }
}
