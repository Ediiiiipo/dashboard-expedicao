module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const taskId   = process.env.SHOPEE_TASK_ID;
  const cookie   = process.env.SHOPEE_COOKIE;
  const csrf     = process.env.SHOPEE_CSRF_TOKEN;
  const deviceId = process.env.SHOPEE_DEVICE_ID;

  if (!taskId || !cookie || !csrf || !deviceId) {
    return res.status(500).json({
      error: 'Configuração incompleta. Verifique as variáveis de ambiente no Vercel: SHOPEE_TASK_ID, SHOPEE_COOKIE, SHOPEE_CSRF_TOKEN, SHOPEE_DEVICE_ID.'
    });
  }

  try {
    const url = `https://spx.shopee.com.br/api/in-station/lmhub/audit/target/list?page_no=1&count=9999&task_id=${taskId}`;

    const response = await fetch(url, {
      headers: {
        'accept': 'application/json, text/plain, */*',
        'accept-language': 'pt-PT,pt;q=0.9,en-US;q=0.8,en;q=0.7',
        'app': 'FMS Portal',
        'cookie': cookie,
        'device-id': deviceId,
        'referer': 'https://spx.shopee.com.br/',
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36',
        'x-csrftoken': csrf,
      }
    });

    if (!response.ok) {
      return res.status(response.status).json({ error: `Shopee API retornou status ${response.status}` });
    }

    const data = await response.json();

    if (data.retcode !== 0) {
      return res.status(401).json({
        error: 'Sessão expirada ou inválida. Atualize os cookies nas variáveis de ambiente do Vercel.'
      });
    }

    return res.status(200).json(data);

  } catch (err) {
    return res.status(500).json({ error: `Erro interno: ${err.message}` });
  }
}
