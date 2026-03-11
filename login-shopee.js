// ============================================
// LOGIN-SHOPEE.JS - Sessão Persistente via Playwright
// Baseado no padrão do Planejamento Fluxo Integrado
// ============================================

const { chromium } = require('playwright-core');
const fs = require('fs-extra');
const path = require('path');
const os = require('os');

// Sessão salva no APPDATA (fora da pasta do projeto)
const SESSION_FILE = path.join(
  process.env.APPDATA || os.homedir(),
  'shopee-dashboard-expedicao',
  'session.json'
);

const URL_HOME = 'https://spx.shopee.com.br/#/index';

// =================== DETECTAR NAVEGADOR DO SISTEMA ===================

async function detectarNavegador() {
  const caminhos = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe'),
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  ];

  for (const p of caminhos) {
    if (await fs.pathExists(p)) {
      console.log(`[detectarNavegador] Encontrado: ${p}`);
      return p;
    }
  }

  throw new Error('Nenhum navegador encontrado. Instale o Google Chrome ou Microsoft Edge.');
}

// =================== VERIFICAR SESSÃO SALVA ===================
// Apenas checa se o arquivo existe — validade real confirmada pela API

async function verificarSessao() {
  try {
    if (!(await fs.pathExists(SESSION_FILE))) {
      return { valida: false, motivo: 'Primeira vez? Faça login para continuar.' };
    }

    const sessao = await fs.readJson(SESSION_FILE);
    const cookies = sessao.cookies || [];

    if (cookies.length === 0) {
      return { valida: false, motivo: 'Sessão inválida. Faça login novamente.' };
    }

    console.log(`[verificarSessao] Sessão encontrada (${cookies.length} cookies), abrindo dashboard...`);
    return { valida: true };

  } catch (err) {
    return { valida: false, motivo: `Erro ao ler sessão: ${err.message}` };
  }
}

// =================== REALIZAR LOGIN MANUAL ===================

async function realizarLogin(onProgresso) {
  try {
    const browserPath = await detectarNavegador();

    onProgresso && onProgresso('Abrindo navegador para login...');
    console.log('[realizarLogin] Iniciando login manual...');

    const browser = await chromium.launch({
      executablePath: browserPath,
      headless: false,
      args: ['--start-maximized']
    });

    const context = await browser.newContext({ viewport: null });
    const page = await context.newPage();

    await page.goto(URL_HOME, { waitUntil: 'networkidle', timeout: 60000 });

    // Verifica popup de sessão duplicada (Reset)
    try {
      const popupReset = await page.locator('text=selecting reset will log you out').isVisible({ timeout: 3000 });
      if (popupReset) {
        console.log('[realizarLogin] Popup de Reset detectado, fechando...');
        await page.click('button:has-text("Reset")', { timeout: 5000 }).catch(() => {});
        await page.waitForTimeout(3000);
      }
    } catch (e) {}

    onProgresso && onProgresso('Aguardando login no navegador (até 10 min)...');
    console.log('[realizarLogin] Aguardando login do usuário...');

    // Aguarda URL mudar para fora da tela de login — waitForURL recebe objeto URL
    await page.waitForURL(
      url => !url.href.includes('login') && !url.href.includes('authenticate'),
      { timeout: 600_000 }
    );

    onProgresso && onProgresso('Login detectado! Capturando task ID...');
    console.log('[realizarLogin] Login detectado pela URL!');

    await page.waitForTimeout(2000);

    // Fecha popup obstrutivo se houver
    try {
      await page.click('.ssc-dialog-close-icon-wrapper', { timeout: 3000 });
    } catch (e) {}

    // =================== CAPTURAR TASK ID AUTOMATICAMENTE ===================
    let taskIdCapturado = null;

    // Intercepta qualquer requisição que contenha task_id
    page.on('request', request => {
      const url = request.url();
      if (url.includes('task_id=')) {
        const match = url.match(/task_id=(\d+)/);
        if (match && match[1]) {
          taskIdCapturado = match[1];
          console.log(`[realizarLogin] Task ID capturado: ${taskIdCapturado}`);
        }
      }
    });

    // Navega para a página de auditoria do SPX para disparar as requisições
    onProgresso && onProgresso('Acessando página de auditoria...');
    const URLS_AUDITORIA = [
      'https://spx.shopee.com.br/#/lmhub/audit',
      'https://spx.shopee.com.br/#/audit',
      'https://spx.shopee.com.br/#/lmhub',
    ];

    for (const auditUrl of URLS_AUDITORIA) {
      try {
        await page.goto(auditUrl, { waitUntil: 'networkidle', timeout: 15000 });
        await page.waitForTimeout(3000);
        if (taskIdCapturado) break;
      } catch (e) {}
    }

    if (taskIdCapturado) {
      console.log(`[realizarLogin] Task ID capturado com sucesso: ${taskIdCapturado}`);
      onProgresso && onProgresso(`Task ID capturado: ${taskIdCapturado}`);
    } else {
      console.log('[realizarLogin] Task ID não capturado automaticamente.');
    }
    // =========================================================================

    // Salva storageState completo (cookies + localStorage) no APPDATA
    await fs.ensureDir(path.dirname(SESSION_FILE));
    await context.storageState({ path: SESSION_FILE });

    const sessao = await fs.readJson(SESSION_FILE);
    console.log(`[realizarLogin] Sessão salva: ${sessao.cookies?.length || 0} cookies em ${SESSION_FILE}`);

    await context.close();
    await browser.close();

    return { success: true, taskId: taskIdCapturado };

  } catch (err) {
    if (err.message.includes('Timeout') || err.message.includes('timeout')) {
      return { success: false, error: 'Tempo limite atingido (10 min). Tente novamente.' };
    }
    return { success: false, error: `Erro durante login: ${err.message}` };
  }
}

// =================== CARREGAR CREDENCIAIS DA SESSÃO ===================
// Extrai cookie string, csrfToken e deviceId do storageState salvo

async function carregarSessao() {
  try {
    if (!(await fs.pathExists(SESSION_FILE))) return null;

    const sessao = await fs.readJson(SESSION_FILE);
    const cookies = sessao.cookies || [];

    // Monta string de cookies: "key=value; key2=value2"
    const cookieStr = cookies.map(c => `${c.name}=${c.value}`).join('; ');

    // Extrai csrftoken dos cookies
    const csrfToken = cookies.find(c => c.name === 'csrftoken')?.value || '';

    // Extrai device-id do localStorage salvo pelo storageState
    const spxOrigin = (sessao.origins || []).find(o => o.origin && o.origin.includes('shopee'));
    const localStorage = spxOrigin?.localStorage || [];
    const deviceId = localStorage.find(item =>
      item.name === 'spx-admin-device-id' ||
      item.name === 'device_id' ||
      item.name === 'deviceId'
    )?.value || '';

    return { cookie: cookieStr, csrfToken, deviceId };

  } catch (err) {
    console.error('[carregarSessao] Erro:', err.message);
    return null;
  }
}

// =================== DESCOBRIR TASK ID AUTOMATICAMENTE ===================
// Fluxo: audit-list → captura vt_task_id da 1ª linha → navega ao detalhe →
// intercepta chamada audit/target/list → extrai task_id numérico

async function descobrirTaskId(onProgresso) {
  let browser = null;

  try {
    if (!(await fs.pathExists(SESSION_FILE))) {
      return { success: false, error: 'Sessão não encontrada. Faça login primeiro.' };
    }

    const browserPath = await detectarNavegador();

    onProgresso && onProgresso('Abrindo navegador para descobrir tarefa do dia...');
    console.log('[descobrirTaskId] Iniciando browser headless...');

    browser = await chromium.launch({
      executablePath: browserPath,
      headless: true,
      args: ['--no-sandbox', '--disable-gpu']
    });

    const context = await browser.newContext({
      storageState: SESSION_FILE,
      viewport: { width: 1280, height: 800 }
    });

    const page = await context.newPage();

    let vtTaskId = null;      // Ex: "VT202603100BBWT" — da lista
    let taskIdNumerico = null; // Ex: "12345" — da chamada audit/target/list

    // ── PASSO 1: intercepta a lista de tarefas para pegar o vt_task_id ──
    const coletarListaHandler = async (response) => {
      if (vtTaskId) return;
      const url = response.url();
      if (!url.includes('/api/') || !url.includes('audit')) return;
      try {
        const body = await response.json().catch(() => null);
        if (!body || body.retcode !== 0 || !body.data) return;

        const list = body.data.list || body.data.records || body.data.task_list || [];
        if (list.length > 0) {
          const first = list[0];
          // Prefere vt_task_id; fallback para task_id numérico
          vtTaskId = first.vt_task_id || first.task_code || null;
          if (!vtTaskId && first.task_id) taskIdNumerico = String(first.task_id);
          if (vtTaskId) console.log(`[descobrirTaskId] vt_task_id: ${vtTaskId}`);
          if (taskIdNumerico) console.log(`[descobrirTaskId] task_id numérico (lista): ${taskIdNumerico}`);
        }
      } catch (e) {}
    };
    page.on('response', coletarListaHandler);

    onProgresso && onProgresso('Acessando lista de conferências...');
    try {
      await page.goto('https://spx.shopee.com.br/#/mercadao/audit-list', {
        waitUntil: 'networkidle', timeout: 25000
      });
      await page.waitForTimeout(3000);
    } catch (e) {
      console.log(`[descobrirTaskId] Timeout na lista, continuando: ${e.message}`);
    }

    page.off('response', coletarListaHandler);

    // ── PASSO 2: navega ao detalhe para interceptar o task_id numérico ──
    if (!taskIdNumerico) {
      const vtParaNavegar = vtTaskId;

      // Intercepta requisições — o audit/target/list contém task_id numérico
      const coletarDetalheHandler = (request) => {
        if (taskIdNumerico) return;
        const url = request.url();
        if (url.includes('audit/target/list') && url.includes('task_id=')) {
          const match = url.match(/[?&]task_id=([^&]+)/);
          if (match && match[1]) {
            taskIdNumerico = match[1];
            console.log(`[descobrirTaskId] task_id da chamada de detalhe: ${taskIdNumerico}`);
          }
        }
        // Também aceita qualquer task_id numérico de URLs de audit
        if (!taskIdNumerico && url.includes('task_id=') && url.includes('/api/')) {
          const match = url.match(/[?&]task_id=(\d+)/);
          if (match && match[1]) {
            taskIdNumerico = match[1];
            console.log(`[descobrirTaskId] task_id numérico (req): ${taskIdNumerico}`);
          }
        }
      };

      // Também captura do body das respostas de detalhe
      const coletarDetalheBodyHandler = async (response) => {
        if (taskIdNumerico) return;
        const url = response.url();
        if (!url.includes('audit/target/list') && !url.includes('audit') ) return;
        try {
          const body = await response.json().catch(() => null);
          if (!body || body.retcode !== 0 || !body.data) return;
          const list = body.data.list || [];
          if (list.length > 0 && list[0]?.task_id) {
            taskIdNumerico = String(list[0].task_id);
            console.log(`[descobrirTaskId] task_id do body de detalhe: ${taskIdNumerico}`);
          }
        } catch (e) {}
      };

      page.on('request', coletarDetalheHandler);
      page.on('response', coletarDetalheBodyHandler);

      if (vtParaNavegar) {
        onProgresso && onProgresso(`Abrindo detalhe da tarefa ${vtParaNavegar}...`);
        const detalheUrl = `https://spx.shopee.com.br/#/mercadao/audit-list/vt-detail?vt-task-id=${vtParaNavegar}`;
        console.log(`[descobrirTaskId] Navegando para detalhe: ${detalheUrl}`);
        try {
          await page.goto(detalheUrl, { waitUntil: 'networkidle', timeout: 25000 });
          await page.waitForTimeout(4000);
        } catch (e) {
          console.log(`[descobrirTaskId] Timeout no detalhe: ${e.message}`);
        }
      } else {
        // Sem vt_task_id, tenta URLs antigas como fallback
        for (const fallbackUrl of [
          'https://spx.shopee.com.br/#/lmhub/audit',
          'https://spx.shopee.com.br/#/lmhub',
        ]) {
          if (taskIdNumerico) break;
          try {
            await page.goto(fallbackUrl, { waitUntil: 'networkidle', timeout: 15000 });
            await page.waitForTimeout(3000);
          } catch (e) {}
        }
      }

      page.off('request', coletarDetalheHandler);
      page.off('response', coletarDetalheBodyHandler);
    }

    await context.close();
    await browser.close();
    browser = null;

    // Usa task_id numérico se disponível; caso contrário usa vt_task_id
    const taskIdFinal = taskIdNumerico || vtTaskId;

    if (!taskIdFinal) {
      console.log('[descobrirTaskId] Nenhum Task ID encontrado.');
      return { success: false, error: 'Tarefa não encontrada. Preencha o Task ID manualmente.' };
    }

    console.log(`[descobrirTaskId] Task ID final: ${taskIdFinal}`);
    return { success: true, taskId: taskIdFinal };

  } catch (err) {
    console.error('[descobrirTaskId] Erro:', err.message);
    if (browser) { try { await browser.close(); } catch(e) {} }
    return { success: false, error: `Erro ao descobrir Task ID: ${err.message}` };
  }
}

// =================== BUSCAR DADOS COMPLETOS VIA NAVEGADOR ===================
// Navega até audit-list → 1ª tarefa → captura dados completos da API
// Retorna { success, taskId, data } onde data tem o mesmo formato da API

async function buscarDadosCompleto(onProgresso) {
  let browser = null;

  try {
    if (!(await fs.pathExists(SESSION_FILE))) {
      return { success: false, error: 'Sessão não encontrada. Faça login primeiro.' };
    }

    const browserPath = await detectarNavegador();

    onProgresso && onProgresso('Abrindo navegador para buscar dados...');
    console.log('[buscarDadosCompleto] Iniciando browser headless...');

    browser = await chromium.launch({
      executablePath: browserPath,
      headless: true,
      args: ['--no-sandbox', '--disable-gpu']
    });

    const context = await browser.newContext({
      storageState: SESSION_FILE,
      viewport: { width: 1280, height: 800 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });

    const page = await context.newPage();

    let vtTaskId = null;
    let taskIdCapturado = null;
    let dadosCapturados = null;

    // ── Logging diagnóstico: registra TODAS chamadas de API ──
    page.on('response', async (response) => {
      const url = response.url();
      if (!url.includes('spx.shopee.com.br') || !url.includes('/api/')) return;
      const status = response.status();
      try {
        const text = await response.text().catch(() => '');
        const preview = text.substring(0, 300).replace(/\n/g, ' ');
        console.log(`[API] ${status} ${url.split('?')[0]}`);
        if (status !== 200) {
          console.log(`[API] body: ${preview}`);
        } else if (text.includes('"retcode"')) {
          const retMatch = text.match(/"retcode"\s*:\s*(-?\d+)/);
          const retcode = retMatch ? retMatch[1] : '?';
          console.log(`[API] retcode=${retcode} | preview: ${preview.substring(0, 150)}`);
        }
      } catch (e) {}
    });

    // ── Logging de requests ──
    page.on('request', (request) => {
      const url = request.url();
      if (!url.includes('spx.shopee.com.br') || !url.includes('/api/')) return;
      console.log(`[REQ] ${request.method()} ${url.substring(0, 120)}`);
      // Captura task_id de qualquer request
      if (url.includes('task_id=')) {
        const match = url.match(/[?&]task_id=([^&]+)/);
        if (match && match[1] && !taskIdCapturado) {
          taskIdCapturado = match[1];
          console.log(`[buscarDadosCompleto] task_id capturado da URL: ${taskIdCapturado}`);
        }
      }
    });

    // ── PASSO 1: captura a lista de tarefas, pega a 1ª ──
    onProgresso && onProgresso('Acessando lista de conferências...');
    console.log('[buscarDadosCompleto] Navegando para audit-list...');

    // Listener separado para capturar resposta da lista
    const capturaLista = async (response) => {
      if (vtTaskId || taskIdCapturado) return;
      const url = response.url();
      if (!url.includes('/api/')) return;
      try {
        const body = await response.json().catch(() => null);
        if (!body || !body.data) return;
        // Tenta encontrar lista de tarefas em qualquer campo de data
        const possiveisListas = [
          body.data.list, body.data.records, body.data.task_list,
          body.data.vt_list, body.data.audit_list, body.data.items
        ];
        for (const lista of possiveisListas) {
          if (Array.isArray(lista) && lista.length > 0) {
            const first = lista[0];
            console.log(`[buscarDadosCompleto] primeira tarefa: ${JSON.stringify(first).substring(0, 200)}`);
            vtTaskId = first.vt_task_id || first.task_code || first.vt_id || null;
            if (!vtTaskId && first.task_id) taskIdCapturado = String(first.task_id);
            console.log(`[buscarDadosCompleto] vt_task_id=${vtTaskId} | task_id=${taskIdCapturado}`);
            break;
          }
        }
      } catch (e) {}
    };
    page.on('response', capturaLista);

    try {
      await page.goto('https://spx.shopee.com.br/#/mercadao/audit-list', {
        waitUntil: 'networkidle', timeout: 30000
      });
    } catch (e) {
      console.log(`[buscarDadosCompleto] timeout/erro na lista: ${e.message}`);
    }
    await page.waitForTimeout(4000);
    page.off('response', capturaLista);

    console.log(`[buscarDadosCompleto] Após lista: vtTaskId=${vtTaskId} taskId=${taskIdCapturado}`);

    if (!vtTaskId && !taskIdCapturado) {
      // Tenta verificar se está logado
      const currentUrl = page.url();
      console.log(`[buscarDadosCompleto] URL atual: ${currentUrl}`);
      await context.close();
      await browser.close();
      browser = null;
      const msg = currentUrl.includes('login') || currentUrl.includes('authenticate')
        ? 'Sessão expirada. Use "Trocar conta" para fazer login novamente.'
        : 'Nenhuma tarefa encontrada. Verifique a sessão ou preencha o Task ID manualmente.';
      return { success: false, error: msg };
    }

    // ── PASSO 2: navega ao detalhe e captura dados completos ──
    if (vtTaskId) {
      onProgresso && onProgresso(`Carregando dados da tarefa ${vtTaskId}...`);
    }

    const capturaDetalhe = async (response) => {
      if (dadosCapturados) return;
      const url = response.url();
      if (!url.includes('/api/')) return;
      try {
        const body = await response.json().catch(() => null);
        if (!body || !body.data) return;
        const list = body.data.list || body.data.records || body.data.items || [];
        if (list.length > 0) {
          const first = list[0];
          // Confirma que são dados de AT/TO
          const ehDadosAT = first.target_id !== undefined || first.initial_qty !== undefined
            || first.at_id !== undefined || first.binding_entity !== undefined;
          if (ehDadosAT) {
            dadosCapturados = body;
            const matchUrl = url.match(/[?&]task_id=([^&]+)/);
            if (matchUrl && !taskIdCapturado) taskIdCapturado = matchUrl[1];
            console.log(`[buscarDadosCompleto] dados AT/TO capturados: ${list.length} itens | URL: ${url.split('?')[0]}`);
          } else {
            console.log(`[buscarDadosCompleto] lista descartada (campos: ${Object.keys(first).slice(0,5).join(',')})`);
          }
        }
      } catch (e) {}
    };
    page.on('response', capturaDetalhe);

    const detalheUrl = vtTaskId
      ? `https://spx.shopee.com.br/#/mercadao/audit-list/vt-detail?vt-task-id=${vtTaskId}`
      : 'https://spx.shopee.com.br/#/mercadao/audit-list';

    console.log(`[buscarDadosCompleto] Navegando para: ${detalheUrl}`);
    try {
      await page.goto(detalheUrl, { waitUntil: 'networkidle', timeout: 30000 });
    } catch (e) {
      console.log(`[buscarDadosCompleto] timeout no detalhe: ${e.message}`);
    }
    await page.waitForTimeout(5000);
    page.off('response', capturaDetalhe);

    await context.close();
    await browser.close();
    browser = null;

    const taskIdFinal = taskIdCapturado || vtTaskId;

    if (!dadosCapturados) {
      if (taskIdFinal) {
        console.log(`[buscarDadosCompleto] Dados não capturados, mas task_id=${taskIdFinal}`);
        return { success: false, taskId: taskIdFinal, error: 'Usando task_id descoberto com API direta...' };
      }
      return { success: false, error: 'Nenhum dado capturado. Preencha o Task ID manualmente.' };
    }

    console.log(`[buscarDadosCompleto] OK — task_id=${taskIdFinal}`);
    return { success: true, taskId: taskIdFinal, data: dadosCapturados };

  } catch (err) {
    console.error('[buscarDadosCompleto] Erro:', err.message);
    if (browser) { try { await browser.close(); } catch(e) {} }
    return { success: false, error: `Erro ao buscar dados: ${err.message}` };
  }
}

// =================== LIMPAR SESSÃO ===================

async function limparSessao() {
  try {
    if (await fs.pathExists(SESSION_FILE)) {
      await fs.remove(SESSION_FILE);
      console.log('[limparSessao] Sessão removida.');
    }
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

module.exports = { verificarSessao, realizarLogin, carregarSessao, limparSessao, descobrirTaskId, buscarDadosCompleto };
