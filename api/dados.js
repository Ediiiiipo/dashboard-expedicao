const SHEETS_CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQFqXTf8tvQCq5IScsrMrwUuB8xKeCeFKnJme3f5160M4fV68QTQHdg-n3rHKifV45gz3wLsTcZGNLV/pub?gid=0&single=true&output=csv';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const response = await fetch(SHEETS_CSV_URL, {
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0',
        'Accept': 'text/csv,text/plain,*/*'
      }
    });

    if (!response.ok) {
      let body = '';
      try { body = await response.text(); } catch (_) {}
      return res.status(502).json({
        error: `Erro ao buscar planilha: HTTP ${response.status}`,
        url: response.url,
        detail: body.slice(0, 300)
      });
    }

    const csvText = await response.text();

    if (!csvText || csvText.trim().length === 0) {
      return res.status(502).json({ error: 'Planilha retornou conteúdo vazio. Verifique se ela está publicada.' });
    }

    return res.status(200).send(csvText);

  } catch (err) {
    return res.status(500).json({ error: `Erro interno: ${err.message}`, stack: err.stack });
  }
}
