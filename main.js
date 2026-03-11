// ============================================
// MAIN.JS - Electron Principal
// Dashboard de Expedição - Shopee Hub
// ============================================

const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs-extra');
const packageJson = require('./package.json');
const { verificarSessao, realizarLogin, carregarSessao, limparSessao } = require('./login-shopee');

let mainWindow;

const TASK_FILE = path.join(__dirname, 'task.json');

// =================== CRIAR JANELA ===================
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    title: `Shopee Hub - Dashboard Expedição v${packageJson.version}`,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  mainWindow.loadFile('index.html');

  mainWindow.on('closed', () => { mainWindow = null; });
}

// =================== INICIALIZAÇÃO ===================
app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// =================== IPC: LOGIN / SESSÃO ===================

ipcMain.handle('verificar-sessao', async () => {
  return await verificarSessao();
});

ipcMain.handle('iniciar-login', async () => {
  const resultado = await realizarLogin((msg) => {
    if (mainWindow) mainWindow.webContents.send('progresso-login', msg);
  });

  // Se capturou task_id automaticamente, salva
  if (resultado.success && resultado.taskId) {
    try {
      await fs.writeJson(TASK_FILE, { taskId: resultado.taskId }, { spaces: 2 });
      console.log(`[iniciar-login] Task ID salvo automaticamente: ${resultado.taskId}`);
    } catch (e) {}
  }

  return resultado;
});

ipcMain.handle('limpar-sessao', async () => {
  return await limparSessao();
});

// =================== IPC: TASK ID ===================

ipcMain.handle('carregar-task', async () => {
  try {
    if (await fs.pathExists(TASK_FILE)) {
      return { success: true, taskId: (await fs.readJson(TASK_FILE)).taskId || '' };
    }
    return { success: true, taskId: '' };
  } catch (err) {
    return { success: false, taskId: '' };
  }
});

ipcMain.handle('salvar-task', async (event, taskId) => {
  try {
    await fs.writeJson(TASK_FILE, { taskId }, { spaces: 2 });
    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// =================== IPC: BUSCAR DADOS COMPLETO (fetch direto, sem browser) ===================
// 1. Chama audit/task/list → pega validation_task_id da 1ª tarefa
// 2. Chama audit/target/list com esse ID → retorna dados prontos para o dashboard

ipcMain.handle('buscar-dados-completo', async () => {
  const sessao = await carregarSessao();
  if (!sessao || !sessao.cookie) {
    return { success: false, error: 'Sessão não encontrada. Faça login primeiro.' };
  }

  const { cookie, csrfToken, deviceId } = sessao;

  const headers = {
    'accept': 'application/json, text/plain, */*',
    'accept-language': 'pt-BR,pt;q=0.9,en-US;q=0.8',
    'app': 'FMS Portal',
    'cache-control': 'no-cache',
    'cookie': cookie,
    'device-id': deviceId || '',
    'origin': 'https://spx.shopee.com.br',
    'referer': 'https://spx.shopee.com.br/',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-origin',
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36',
    'x-csrftoken': csrfToken || '',
  };

  // Helper: fetch com timeout
  async function fetchComTimeout(url, options, ms = 15000) {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), ms);
    try {
      const r = await fetch(url, { ...options, signal: ctrl.signal });
      return r;
    } finally {
      clearTimeout(tid);
    }
  }

  // ── PASSO 1: busca a lista de tarefas para pegar a mais recente ──
  try {
    const listUrl = 'https://spx.shopee.com.br/api/in-station/lmhub/audit/task/list?page_no=1&count=1';
    console.log('[buscar-dados-completo] Buscando lista de tarefas...');

    let listRes;
    try {
      listRes = await fetchComTimeout(listUrl, { headers }, 15000);
    } catch (fetchErr) {
      const msg = fetchErr.name === 'AbortError' ? 'Timeout (15s) ao buscar lista de tarefas.' : `Erro de rede: ${fetchErr.message}`;
      console.error(`[buscar-dados-completo] ${msg}`);
      return { success: false, error: msg };
    }

    if (!listRes.ok) {
      return { success: false, error: `HTTP ${listRes.status} ao buscar lista de tarefas.` };
    }

    const listData = await listRes.json();
    console.log(`[buscar-dados-completo] task/list retcode=${listData.retcode} | total=${listData.data?.total}`);

    if (listData.retcode !== 0) {
      const AUTH_ERRORS = [1, 4, 401, 403, 100001, 100002];
      if (AUTH_ERRORS.includes(listData.retcode)) {
        return { success: false, error: 'Sessão expirada. Use "Trocar conta" para renovar.', sessionExpired: true };
      }
      return { success: false, error: `Erro ao listar tarefas (retcode ${listData.retcode}): ${listData.message || ''}` };
    }

    const tarefas = listData.data?.list || [];
    if (tarefas.length === 0) {
      return { success: false, error: 'Nenhuma tarefa de conferência encontrada.' };
    }

    const primeiraTarefa = tarefas[0];

    // Tenta encontrar o task_id numérico
    const taskIdNumerico = primeiraTarefa.task_id || primeiraTarefa.id || primeiraTarefa.audit_task_id || null;
    const validationTaskId = primeiraTarefa.validation_task_id || primeiraTarefa.task_code || '';

    console.log(`[buscar-dados-completo] validation_task_id=${validationTaskId} | task_id_numerico=${taskIdNumerico}`);

    if (!validationTaskId && !taskIdNumerico) {
      return { success: false, error: 'ID da tarefa não encontrado na resposta.' };
    }

    // Salva o task_id descoberto (prefere numérico)
    const taskIdParaSalvar = taskIdNumerico ? String(taskIdNumerico) : validationTaskId;
    try {
      await fs.writeJson(TASK_FILE, { taskId: taskIdParaSalvar }, { spaces: 2 });
    } catch (e) {}

    // ── PASSO 2: tenta buscar dados com task_id numérico ou VT ──
    // Tenta as variações de parâmetro que a API pode aceitar
    const tentativas = [];
    if (taskIdNumerico) tentativas.push(`task_id=${taskIdNumerico}`);
    tentativas.push(`validation_task_id=${validationTaskId}`);
    tentativas.push(`task_id=${validationTaskId}`);

    let targetData = null;
    let taskIdUsado = taskIdParaSalvar;

    for (const param of tentativas) {
      const targetUrl = `https://spx.shopee.com.br/api/in-station/lmhub/audit/target/list?page_no=1&count=9999&${param}`;
      console.log(`[buscar-dados-completo] Tentando: ${targetUrl}`);

      let targetRes;
      try {
        targetRes = await fetchComTimeout(targetUrl, { headers }, 20000);
      } catch (e) {
        console.log(`[buscar-dados-completo] Erro na tentativa: ${e.message}`);
        continue;
      }

      if (!targetRes.ok) {
        console.log(`[buscar-dados-completo] HTTP ${targetRes.status} com ${param}`);
        continue;
      }

      const d = await targetRes.json();
      console.log(`[buscar-dados-completo] retcode=${d.retcode} com ${param}`);

      if (d.retcode === 0) {
        targetData = d;
        taskIdUsado = param.split('=')[1];
        break;
      }
    }

    if (!targetData) {
      return {
        success: false,
        taskId: taskIdParaSalvar,
        error: 'Não foi possível buscar os dados da tarefa. Verifique o Task ID.'
      };
    }

    // Atualiza task_id salvo com o que funcionou
    try { await fs.writeJson(TASK_FILE, { taskId: taskIdUsado }, { spaces: 2 }); } catch(e) {}

    const total = targetData.data?.list?.length ?? 0;
    console.log(`[buscar-dados-completo] OK — ${total} AT/TOs | task_id=${taskIdUsado}`);
    return { success: true, taskId: taskIdUsado, data: targetData };

  } catch (err) {
    return { success: false, error: `Erro de conexão: ${err.message}` };
  }
});

// =================== IPC: BUSCAR DADOS SHOPEE ===================

ipcMain.handle('buscar-dados-shopee', async (event, { taskId }) => {
  if (!taskId) {
    return { success: false, error: 'Informe o Task ID da operação.' };
  }

  const sessao = await carregarSessao();
  if (!sessao || !sessao.cookie) {
    return { success: false, error: 'Sessão não encontrada. Faça login primeiro.' };
  }

  const { cookie, csrfToken, deviceId } = sessao;

  const url = `https://spx.shopee.com.br/api/in-station/lmhub/audit/target/list?page_no=1&count=9999&task_id=${taskId}`;

  console.log(`[buscar-dados-shopee] task_id=${taskId} | cookie=${cookie.substring(0, 30)}...`);

  try {
    const res = await fetch(url, {
      headers: {
        'accept': 'application/json, text/plain, */*',
        'accept-language': 'pt-BR,pt;q=0.9,en-US;q=0.8',
        'app': 'FMS Portal',
        'cache-control': 'no-cache',
        'cookie': cookie,
        'device-id': deviceId || '',
        'origin': 'https://spx.shopee.com.br',
        'referer': 'https://spx.shopee.com.br/',
        'sec-fetch-dest': 'empty',
        'sec-fetch-mode': 'cors',
        'sec-fetch-site': 'same-origin',
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/145.0.0.0 Safari/537.36',
        'x-csrftoken': csrfToken || '',
      }
    });

    if (!res.ok) {
      return { success: false, error: `Shopee retornou HTTP ${res.status}` };
    }

    const data = await res.json();

    if (data.retcode !== 0) {
      // Retcodes de autenticação inválida (sessão expirada)
      const AUTH_ERRORS = [1, 4, 401, 403, 100001, 100002];
      const sessionExpired = AUTH_ERRORS.includes(data.retcode);

      console.log(`[buscar-dados-shopee] retcode=${data.retcode} | sessionExpired=${sessionExpired} | msg=${data.message || ''}`);

      const errorMsg = sessionExpired
        ? 'Sessão expirada. Clique em "Trocar conta" para renovar.'
        : `Erro da API (retcode ${data.retcode}): ${data.message || 'Task ID inválido ou sem dados.'}`;

      return { success: false, error: errorMsg, sessionExpired };
    }

    const count = data?.data?.list?.length ?? 0;
    console.log(`[buscar-dados-shopee] OK — ${count} rotas recebidas`);
    return { success: true, data };

  } catch (err) {
    return { success: false, error: `Erro de conexão: ${err.message}` };
  }
});
