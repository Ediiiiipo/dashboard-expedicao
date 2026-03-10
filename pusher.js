// ============================================================
// PUSHER - Roda no PC do hub para atualizar o dashboard
// Execute: node pusher.js
// ============================================================

const SHOPEE_TASK_ID    = '';  // Ex: '123456'
const SHOPEE_COOKIE     = '';  // Cookie completo da sessão Shopee
const SHOPEE_CSRF_TOKEN = '';  // Valor do csrftoken
const SHOPEE_DEVICE_ID  = '';  // spx-admin-device-id

const JSONBIN_BIN_ID    = '';  // ID do bin no jsonbin.io
const JSONBIN_API_KEY   = '';  // API Key do jsonbin.io

// ============================================================

async function main() {
    if (!SHOPEE_TASK_ID || !SHOPEE_COOKIE || !SHOPEE_CSRF_TOKEN || !SHOPEE_DEVICE_ID) {
        console.error('Configure as variáveis SHOPEE_* no início do arquivo.');
        process.exit(1);
    }
    if (!JSONBIN_BIN_ID || !JSONBIN_API_KEY) {
        console.error('Configure as variáveis JSONBIN_* no início do arquivo.');
        process.exit(1);
    }

    console.log(`[${new Date().toLocaleTimeString('pt-BR')}] Buscando dados do Shopee...`);

    const url = `https://spx.shopee.com.br/api/in-station/lmhub/audit/target/list?page_no=1&count=9999&task_id=${SHOPEE_TASK_ID}`;

    const shopeeRes = await fetch(url, {
        headers: {
            'accept': 'application/json, text/plain, */*',
            'accept-language': 'pt-BR,pt;q=0.9,en-US;q=0.8',
            'app': 'FMS Portal',
            'cache-control': 'no-cache',
            'cookie': SHOPEE_COOKIE,
            'device-id': SHOPEE_DEVICE_ID,
            'origin': 'https://spx.shopee.com.br',
            'referer': 'https://spx.shopee.com.br/',
            'sec-fetch-dest': 'empty',
            'sec-fetch-mode': 'cors',
            'sec-fetch-site': 'same-origin',
            'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36',
            'x-csrftoken': SHOPEE_CSRF_TOKEN,
        }
    });

    if (!shopeeRes.ok) {
        console.error(`Erro Shopee: HTTP ${shopeeRes.status}`);
        process.exit(1);
    }

    const data = await shopeeRes.json();

    if (data.retcode !== 0) {
        console.error('Sessão Shopee expirada. Atualize os cookies no script.');
        process.exit(1);
    }

    const total = (data.data && data.data.list) ? data.data.list.length : 0;
    console.log(`Dados recebidos: ${total} rotas. Enviando ao JSONBin...`);

    const binRes = await fetch(`https://api.jsonbin.io/v3/b/${JSONBIN_BIN_ID}`, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json',
            'X-Access-Key': JSONBIN_API_KEY,
        },
        body: JSON.stringify(data)
    });

    if (!binRes.ok) {
        const err = await binRes.text();
        console.error(`Erro JSONBin: ${binRes.status} - ${err}`);
        process.exit(1);
    }

    console.log(`Dashboard atualizado com sucesso! (${new Date().toLocaleTimeString('pt-BR')})`);
}

main().catch(err => {
    console.error('Erro inesperado:', err.message);
    process.exit(1);
});
