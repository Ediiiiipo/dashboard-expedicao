const SHEETS_CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQFqXTf8tvQCq5IScsrMrwUuB8xKeCeFKnJme3f5160M4fV68QTQHdg-n3rHKifV45gz3wLsTcZGNLV/pub?gid=0&single=true&output=csv';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const response = await fetch(SHEETS_CSV_URL);

    if (!response.ok) {
      return res.status(502).json({ error: `Erro ao buscar planilha: HTTP ${response.status}` });
    }

    const csvText = await response.text();
    return res.status(200).send(csvText);

  } catch (err) {
    return res.status(500).json({ error: `Erro interno: ${err.message}` });
  }
}
