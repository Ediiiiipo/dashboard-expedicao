// ============================================
// RENDERER.JS - Interface do Dashboard
// Dashboard de Expedição - Shopee Hub
// ============================================

const { ipcRenderer } = require('electron');

// ======================= ESTADO GLOBAL =======================
let dashboardData = {
    totalInitialPackages: 0,
    totalFinalPackages: 0,
    totalATTO: 0,
    validatedATTO: 0,
    missorted: 0,
    missing: 0,
    operatorProductivity: [],
    allOperatorStats: [],
    corridorStats: {}
};

let charts = {};
let taskIdAtual = '';
let pollingInterval = null;
let fetchEmAndamento = false;
let stationCallback = null; // resolve após troca de station
let rawAPIList = [];        // lista bruta da API para cálculos de produtividade

const POLLING_MS = 3 * 60 * 1000; // 3 minutos

// ======================= TEMA =======================

function aplicarTema(tema) {
    document.documentElement.setAttribute('data-theme', tema);
    const iconLua = document.getElementById('icon-lua');
    const iconSol = document.getElementById('icon-sol');
    if (iconLua) iconLua.style.display = tema === 'light' ? 'none'  : 'block';
    if (iconSol) iconSol.style.display = tema === 'light' ? 'block' : 'none';
    localStorage.setItem('tema', tema);
}

// ======================= SELETOR DE STATION =======================

function definirStationAtual(nome) {
    localStorage.setItem('stationAtual', nome);
    const el = document.getElementById('topbar-station-name');
    if (!el) return;
    el.textContent = nome;
    el.classList.add('visible');
    const banner = document.getElementById('station-banner');
    if (banner) banner.classList.add('visible');
}

let stationsCarregadas = []; // cache para filtro

async function mostrarSeletorStation() {
    const modal  = document.getElementById('modal-station');
    const lista  = document.getElementById('modal-station-list');
    const search = document.getElementById('station-search');

    lista.innerHTML = '<p style="color:var(--text-2);text-align:center">Carregando stations...</p>';
    if (search) search.value = '';
    modal.style.display = 'flex';
    if (search) setTimeout(() => search.focus(), 100);

    const res = await ipcRenderer.invoke('buscar-stations');

    if (!res.success || !res.stations.length) {
        lista.innerHTML = `<p style="color:var(--text-2);text-align:center">Erro ao carregar: ${res.error || 'nenhuma station encontrada'}</p>`;
        return;
    }

    stationsCarregadas = res.stations;
    renderStationList(stationsCarregadas);
}

function renderStationList(stations) {
    const lista = document.getElementById('modal-station-list');
    lista.innerHTML = '';

    if (!stations.length) {
        lista.innerHTML = '<p style="color:var(--text-2);text-align:center">Nenhuma station encontrada.</p>';
        return;
    }

    for (const s of stations) {
        const nome = s.station_name || s.name || 'Station';
        const item = document.createElement('div');
        item.className = 'station-item';
        item.innerHTML = `<span>${nome}</span><span class="station-id">#${s.id}</span>`;
        item.addEventListener('click', () => trocarStationESelecionada(s.id, nome));
        lista.appendChild(item);
    }
}

async function trocarStationESelecionada(stationId, stationName) {
    const modal = document.getElementById('modal-station');
    const lista = document.getElementById('modal-station-list');
    const status = document.getElementById('last-update');

    lista.innerHTML = `<p style="color:var(--text-2);text-align:center">Conectando à station "${stationName}"...</p>`;

    const res = await ipcRenderer.invoke('trocar-station', { stationId });

    if (!res.success) {
        lista.innerHTML = `<p style="color:var(--accent-danger);text-align:center">Erro: ${res.error}</p>`;
        return;
    }

    definirStationAtual(stationName);
    modal.style.display = 'none';
    if (status) status.textContent = `Station "${stationName}" ativada. Atualizando dados...`;

    // Recarrega os dados com a nova station
    fetchEmAndamento = false;
    await autoDescobrirTaskId();
}

// ======================= INICIALIZAÇÃO =======================
document.addEventListener('DOMContentLoaded', async () => {
    const dateOptions = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    document.getElementById('current-date').textContent = new Date().toLocaleDateString('pt-BR', dateOptions);

    // Aplica tema salvo (padrão: dark)
    aplicarTema(localStorage.getItem('tema') || 'dark');

    // Restaura nome da station
    try {
        const stationArquivo = await ipcRenderer.invoke('obter-station-atual');
        if (stationArquivo?.success && stationArquivo.name) {
            definirStationAtual(stationArquivo.name);
        } else {
            const stationSalva = localStorage.getItem('stationAtual');
            if (stationSalva) definirStationAtual(stationSalva);
        }
    } catch (e) {
        const stationSalva = localStorage.getItem('stationAtual');
        if (stationSalva) definirStationAtual(stationSalva);
    }

    // Botão de alternância de tema
    document.getElementById('btn-toggle-tema').addEventListener('click', () => {
        const atual = document.documentElement.getAttribute('data-theme');
        aplicarTema(atual === 'light' ? 'dark' : 'light');
    });

    // Botão cancelar no modal de station
    document.getElementById('btn-station-cancel').addEventListener('click', () => {
        document.getElementById('modal-station').style.display = 'none';
    });

    // Filtro de busca no modal de station
    document.getElementById('station-search').addEventListener('input', (e) => {
        const termo = e.target.value.toLowerCase().trim();
        if (!termo) { renderStationList(stationsCarregadas); return; }
        renderStationList(stationsCarregadas.filter(s => {
            const nome = (s.station_name || s.name || '').toLowerCase();
            return nome.includes(termo);
        }));
    });

    // Botão trocar station na sidebar
    document.getElementById('btn-trocar-station').addEventListener('click', () => {
        mostrarSeletorStation();
    });

    // Navegação entre views
    const viewDashboard    = document.querySelector('.kpi-row')?.closest('main') || null;
    const viewProdutividade = document.getElementById('view-produtividade');
    const sections = ['kpi-row', 'gauges-ops-row', 'tables-grid'].map(c => document.querySelector('.' + c));

    document.getElementById('btn-nav-dashboard').addEventListener('click', () => {
        sections.forEach(s => { if (s) s.style.display = ''; });
        viewProdutividade.style.display = 'none';
        document.getElementById('btn-nav-dashboard').classList.add('active');
        document.getElementById('btn-nav-produtividade').classList.remove('active');
    });

    document.getElementById('btn-nav-produtividade').addEventListener('click', () => {
        sections.forEach(s => { if (s) s.style.display = 'none'; });
        viewProdutividade.style.display = 'flex';
        document.getElementById('btn-nav-produtividade').classList.add('active');
        document.getElementById('btn-nav-dashboard').classList.remove('active');
        renderProdutividade();
    });

    // Progresso de login via IPC push do main
    ipcRenderer.on('progresso-login', (event, msg) => {
        document.getElementById('login-status').textContent = msg;
    });

    // Progresso de busca de dados (etapas 1-4)
    ipcRenderer.on('progresso-busca', (event, etapa) => {
        avancarEtapa(etapa);
    });

    // Verifica sessão ao iniciar
    await iniciarApp();
});

// ======================= FLUXO DE LOGIN =======================

async function iniciarApp() {
    mostrarTelaLogin('Verificando sessão...');

    const res = await ipcRenderer.invoke('verificar-sessao');

    if (res.valida) {
        await entrarNoDashboard();
    } else {
        mostrarTelaLogin(res.motivo || 'Faça login para continuar.');
    }
}

function mostrarTelaLogin(mensagem) {
    document.getElementById('tela-login').style.display = 'flex';
    document.getElementById('tela-dashboard').style.display = 'none';
    document.getElementById('login-status').textContent = mensagem;
    document.getElementById('btn-login').disabled = false;
    document.getElementById('btn-login').textContent = 'Entrar com conta Shopee';
}

let dashboardInicializado = false;

async function entrarNoDashboard() {
    document.getElementById('tela-login').style.display = 'none';
    document.getElementById('tela-dashboard').style.display = 'block';

    // Destrói charts existentes antes de recriar (evita "Canvas already in use")
    Object.values(charts).forEach(c => { try { c.destroy(); } catch(e) {} });
    charts = {};

    initGauges();

    if (!dashboardInicializado) {
        await carregarTaskId();
        registrarEventos();
        dashboardInicializado = true;
    }

    // Sempre busca via buscar-dados-completo ao iniciar
    // (faz warmup da sessão + pega sempre a tarefa mais recente)
    await autoDescobrirTaskId();

    iniciarPolling();
}

async function autoDescobrirTaskId() {
    if (fetchEmAndamento) return;
    fetchEmAndamento = true;

    const status = document.getElementById('last-update');
    const btn = document.getElementById('btn-refresh');

    mostrarLoading('Buscando tarefa do dia...');
    if (status) status.textContent = 'Descobrindo tarefa automaticamente...';
    if (btn) btn.disabled = true;

    try {
        // Tenta buscar dados completos via navegador (1 passo: descobre + baixa)
        const res = await ipcRenderer.invoke('buscar-dados-completo');

        if (res.taskId) {
            document.getElementById('input-task-id').value = res.taskId;
            taskIdAtual = res.taskId;
        }

        if (res.success && res.data) {
            // Dados capturados diretamente pelo navegador — processa imediatamente
            const total = res.data?.data?.list?.length ?? 0;
            console.log(`[autoDescobrirTaskId] Dados via navegador: ${total} itens | task_id=${res.taskId}`);
            processAPIData(res.data);
            if (status) status.textContent = `Atualizado: ${new Date().toLocaleTimeString('pt-BR')} — ${total} rotas`;
            esconderLoading();
        } else if (res.stationError) {
            console.warn('[autoDescobrirTaskId] Station inválida. Abrindo seletor...');
            esconderLoading();
            fetchEmAndamento = false;
            await mostrarSeletorStation();
        } else if (res.taskId) {
            // Capturou task_id mas não os dados — tenta API direta como fallback
            console.log(`[autoDescobrirTaskId] task_id=${res.taskId}, tentando API direta...`);
            fetchEmAndamento = false; // libera a flag para o fetchData conseguir rodar
            await fetchData();
        } else {
            console.log(`[autoDescobrirTaskId] Falhou: ${res.error}`);
            if (status) status.textContent = res.error || 'Preencha o Task ID manualmente.';
            esconderLoading();
        }
    } catch (err) {
        console.error('[autoDescobrirTaskId] Exceção:', err);
        if (status) status.textContent = `Erro: ${err.message}`;
        esconderLoading();
    } finally {
        fetchEmAndamento = false;
        if (btn) btn.disabled = false;
    }
}

document.getElementById('btn-login') && document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('btn-login').addEventListener('click', async () => {
        document.getElementById('btn-login').disabled = true;
        document.getElementById('btn-login').textContent = 'Aguardando login...';
        document.getElementById('login-status').textContent = 'Abrindo navegador...';

        const res = await ipcRenderer.invoke('iniciar-login');

        if (res.success) {
            // Preenche task_id automaticamente se capturado
            if (res.taskId) {
                document.getElementById('input-task-id').value = res.taskId;
                taskIdAtual = res.taskId;
            }
            await entrarNoDashboard();
        } else {
            mostrarTelaLogin(`Erro: ${res.error}`);
        }
    });
});

// ======================= POLLING AUTOMÁTICO =======================

function iniciarPolling() {
    if (pollingInterval) clearInterval(pollingInterval);

    pollingInterval = setInterval(async () => {
        if (fetchEmAndamento) return; // já tem fetch em curso, pula
        await refreshSilencioso();
    }, POLLING_MS);

    console.log(`[polling] Monitoramento ativado — intervalo: ${POLLING_MS / 1000}s`);
}

function pararPolling() {
    if (pollingInterval) {
        clearInterval(pollingInterval);
        pollingInterval = null;
        console.log('[polling] Monitoramento pausado.');
    }
}

async function refreshSilencioso() {
    if (fetchEmAndamento) return;
    fetchEmAndamento = true;

    const status = document.getElementById('last-update');
    const indicador = document.getElementById('polling-indicator');

    if (indicador) indicador.classList.add('ativo');
    if (status) status.textContent = 'Verificando atualizações...';

    try {
        const res = await ipcRenderer.invoke('buscar-dados-completo');

        if (res.taskId) {
            document.getElementById('input-task-id').value = res.taskId;
            taskIdAtual = res.taskId;
        }

        if (res.success && res.data) {
            const total = res.data?.data?.list?.length ?? 0;
            console.log(`[polling] Dados atualizados: ${total} rotas | task_id=${res.taskId}`);
            processAPIData(res.data);
            if (status) status.textContent = `Atualizado: ${new Date().toLocaleTimeString('pt-BR')} — ${total} rotas`;
        } else if (res.stationError) {
            console.warn('[polling] Station inválida. Abrindo seletor...');
            pararPolling();
            await mostrarSeletorStation();
        } else if (res.sessionExpired) {
            console.warn('[polling] Sessão expirada. Parando monitoramento.');
            pararPolling();
            mostrarTelaLogin('Sessão expirada. Faça login novamente.');
            document.getElementById('tela-login').style.display = 'flex';
            document.getElementById('tela-dashboard').style.display = 'none';
        } else {
            console.log(`[polling] Sem novos dados: ${res.error || 'resposta vazia'}`);
            if (status) status.textContent = `Última verificação: ${new Date().toLocaleTimeString('pt-BR')} — sem alterações`;
        }
    } catch (err) {
        console.error('[polling] Erro:', err.message);
    } finally {
        fetchEmAndamento = false;
        if (indicador) indicador.classList.remove('ativo');
    }
}

// ======================= PROGRESSO DE ETAPAS =======================

const ETAPAS = [
    null,
    { id: 'step-1', label: 'Conectando ao SPX',     pct: 15 },
    { id: 'step-2', label: 'Buscando tarefa ativa', pct: 40 },
    { id: 'step-3', label: 'Baixando rotas',        pct: 70 },
    { id: 'step-4', label: 'Atualizando dashboard', pct: 95 },
];

function resetarEtapas() {
    for (let i = 1; i <= 4; i++) {
        const el = document.getElementById(`step-${i}`);
        if (!el) continue;
        el.classList.remove('ativo', 'concluido');
        el.querySelector('.step-icon').textContent = '○';
    }
    const fill = document.getElementById('progress-bar-fill');
    if (fill) fill.style.width = '0%';
}

function avancarEtapa(etapa) {
    // Marca anteriores como concluídas
    for (let i = 1; i < etapa; i++) {
        const el = document.getElementById(`step-${i}`);
        if (!el) continue;
        el.classList.remove('ativo');
        el.classList.add('concluido');
        el.querySelector('.step-icon').textContent = '✓';
    }
    // Marca a atual como ativa
    const atual = document.getElementById(`step-${etapa}`);
    if (atual) {
        atual.classList.add('ativo');
        atual.querySelector('.step-icon').textContent = '●';
    }
    // Avança barra
    const fill = document.getElementById('progress-bar-fill');
    const titulo = document.getElementById('loading-titulo');
    const info = ETAPAS[etapa];
    if (fill && info) fill.style.width = `${info.pct}%`;
    if (titulo && info) titulo.textContent = info.label + '...';
}

function concluirEtapas() {
    for (let i = 1; i <= 4; i++) {
        const el = document.getElementById(`step-${i}`);
        if (!el) continue;
        el.classList.remove('ativo');
        el.classList.add('concluido');
        el.querySelector('.step-icon').textContent = '✓';
    }
    const fill = document.getElementById('progress-bar-fill');
    if (fill) fill.style.width = '100%';
}

// ======================= TASK ID =======================

async function carregarTaskId() {
    const res = await ipcRenderer.invoke('carregar-task');
    if (res.success && res.taskId) {
        taskIdAtual = res.taskId;
        document.getElementById('input-task-id').value = res.taskId;
    }
}

async function salvarTaskId() {
    const val = document.getElementById('input-task-id').value.trim();
    if (!val) return;
    taskIdAtual = val;
    await ipcRenderer.invoke('salvar-task', val);
}

// ======================= EVENTOS =======================

function registrarEventos() {
    document.getElementById('btn-refresh').addEventListener('click', fetchData);
    document.getElementById('btn-login-novo').addEventListener('click', async () => {
        pararPolling();
        await ipcRenderer.invoke('limpar-sessao');
        mostrarTelaLogin('Sessão encerrada. Faça login novamente.');
        document.getElementById('tela-login').style.display = 'flex';
        document.getElementById('tela-dashboard').style.display = 'none';

        const res = await ipcRenderer.invoke('iniciar-login');
        if (res.success) {
            await entrarNoDashboard();
        } else {
            mostrarTelaLogin(`Erro: ${res.error}`);
        }
    });

    const taskInput = document.getElementById('input-task-id');
    taskInput.addEventListener('change', async () => {
        await salvarTaskId();
        fetchData();
    });

    document.getElementById('opsStart').addEventListener('change', updateUI);
    document.getElementById('opsEnd').addEventListener('change', updateUI);
    document.getElementById('opsCount').addEventListener('change', updateUI);
}

// ======================= BUSCAR DADOS =======================

function mostrarLoading(titulo = 'Carregando...') {
    const overlay  = document.getElementById('loading-overlay');
    const tituloEl = document.getElementById('loading-titulo');
    if (overlay) overlay.classList.add('ativo');
    if (tituloEl) tituloEl.textContent = titulo;
    resetarEtapas();
}

function esconderLoading() {
    concluirEtapas();
    // Pequeno delay para o usuário ver o 100% antes de fechar
    setTimeout(() => {
        const overlay = document.getElementById('loading-overlay');
        if (overlay) overlay.classList.remove('ativo');
    }, 500);
}

async function fetchData() {
    if (fetchEmAndamento) return;
    fetchEmAndamento = true;

    const btn    = document.getElementById('btn-refresh');
    const status = document.getElementById('last-update');
    const input  = document.getElementById('input-task-id');
    const taskId = input.value.trim();

    if (!taskId) {
        fetchEmAndamento = false;
        // Destaca o campo e mostra mensagem
        input.classList.add('erro');
        setTimeout(() => input.classList.remove('erro'), 600);
        input.focus();
        if (status) status.textContent = 'Preencha o Task ID antes de atualizar.';
        return;
    }

    if (btn) btn.disabled = true;
    mostrarLoading(`Task ID: ${taskId}`);
    if (status) status.textContent = 'Baixando relatório...';

    try {
        console.log(`[fetchData] Buscando Task ID: ${taskId}`);
        const res = await ipcRenderer.invoke('buscar-dados-shopee', { taskId });
        console.log('[fetchData] Resposta:', res.success ? 'OK' : `ERRO: ${res.error}`);

        if (!res.success) {
            if (res.stationError) {
                fetchEmAndamento = false;
                await mostrarSeletorStation();
            } else if (res.sessionExpired) {
                mostrarTelaLogin('Sessão expirada. Faça login novamente.');
                document.getElementById('tela-login').style.display = 'flex';
                document.getElementById('tela-dashboard').style.display = 'none';
            } else {
                if (status) status.textContent = `Erro: ${res.error}`;
            }
            return;
        }

        const total = res.data?.data?.list?.length ?? 0;
        console.log(`[fetchData] Rotas recebidas: ${total}`);
        processAPIData(res.data);
        if (status) status.textContent = `Atualizado: ${new Date().toLocaleTimeString('pt-BR')} — ${total} rotas`;
    } catch (err) {
        console.error('[fetchData] Exceção:', err);
        if (status) status.textContent = `Erro: ${err.message}`;
    } finally {
        fetchEmAndamento = false;
        esconderLoading();
        if (btn) btn.disabled = false;
    }
}

// ======================= PROCESSAR DADOS =======================

function processAPIData(apiResponse) {
    const items = apiResponse.data.list || [];
    const summary = apiResponse.data;
    rawAPIList = items; // salva para cálculos de produtividade

    let stats = {
        totalInitialPackages: 0, totalFinalPackages: 0,
        missorted: 0, missing: 0,
        attoSet: new Set(), validatedAttoSet: new Set(),
        opStatsMap: {}, corridorMap: {}
    };

    items.forEach(item => {
        const initial   = item.initial_qty || 0;
        const final     = item.final_qty || 0;
        const mssorted  = item.missort_qty || 0;
        const mssing    = item.missing_qty || 0;
        const atto      = item.target_id || '';
        const corridor  = item.binding_entity || '';
        const startTime = item.validation_start_time || 0;
        const endTime   = item.validation_end_time || 0;
        const status    = item.validation_status;

        const operator = (item.validation_operator || '').replace(/^\[.*?\]/, '').trim() || 'N/A';

        stats.totalInitialPackages += initial;
        if (status === 4) stats.totalFinalPackages += final;
        stats.missorted += mssorted;
        stats.missing   += mssing;

        if (atto) {
            stats.attoSet.add(atto);
            if (status === 4) stats.validatedAttoSet.add(atto);
        }

        if (corridor) {
            const street = corridor.charAt(0).toUpperCase();
            if (!stats.corridorMap[street]) {
                stats.corridorMap[street] = { name: street, missorted: 0, initial: 0, routesSet: new Set(), validatedRoutesSet: new Set() };
            }
            stats.corridorMap[street].missorted += mssorted;
            stats.corridorMap[street].initial   += initial;
            if (atto) {
                stats.corridorMap[street].routesSet.add(atto);
                if (status === 4) stats.corridorMap[street].validatedRoutesSet.add(atto);
            }
        }

        const duration = (startTime && endTime && endTime > startTime) ? (endTime - startTime) : 0;

        if (operator && operator !== 'N/A') {
            if (!stats.opStatsMap[operator]) {
                stats.opStatsMap[operator] = { operator, routes: 0, final: 0, missing: 0, totalTime: 0, firstStartTime: null, lastEndTime: null };
            }
            const op = stats.opStatsMap[operator];
            op.routes++;
            op.final   += final;
            op.missing += mssing;
            op.totalTime += duration;
            if (startTime > 0 && (!op.firstStartTime || startTime < op.firstStartTime)) op.firstStartTime = startTime;
            if (endTime > 0 && (!op.lastEndTime || endTime > op.lastEndTime)) op.lastEndTime = endTime;
        }
    });

    const opStatsArray   = Object.values(stats.opStatsMap);
    const sortedByRoutes = [...opStatsArray].sort((a, b) => b.routes - a.routes);

    dashboardData = {
        totalInitialPackages: stats.totalInitialPackages,
        totalFinalPackages:   stats.totalFinalPackages,
        totalATTO:     summary.all_qty       || stats.attoSet.size || 1,
        validatedATTO: summary.validated_qty || stats.validatedAttoSet.size,
        missorted: stats.missorted,
        missing:   stats.missing,
        operatorProductivity: sortedByRoutes,
        allOperatorStats:     opStatsArray,
        corridorStats:        stats.corridorMap
    };

    updateUI();

    const opCount = dashboardData.operatorProductivity ? dashboardData.operatorProductivity.length : 1;
    document.getElementById('opsCount').value = opCount;
    updateOpsTarget();

    // Atualiza view de produtividade se estiver visível
    if (document.getElementById('view-produtividade').style.display !== 'none') {
        renderProdutividade();
    }
}

// ======================= PRODUTIVIDADE =======================

function calcularProdutividade(list) {
    const validados = list.filter(item => item.validation_status === 4);
    const map = {};

    for (const item of validados) {
        const rawOp = item.validation_operator || '';
        const match = rawOp.match(/\[([^\]]+)\](.*)/);
        const op = match ? match[2].trim() : rawOp.trim();
        if (!op) continue;

        const scanned  = (item.final_qty || 0);
        const missort  = (item.missort_qty || 0);
        const missing  = (item.missing_qty || 0);
        const start    = item.validation_start_time || 0;
        const end      = item.validation_end_time || 0;
        const durMin   = (start && end && end > start) ? (end - start) / 60 : 0;

        if (!map[op]) {
            map[op] = { operator: op, totalATs: 0, totalScanned: 0, totalMissorted: 0, totalMissing: 0, totalDurationMin: 0 };
        }
        map[op].totalATs++;
        map[op].totalScanned     += scanned;
        map[op].totalMissorted   += missort;
        map[op].totalMissing     += missing;
        map[op].totalDurationMin += durMin;
    }

    const r = (v, d) => Math.round(v * 10 ** d) / 10 ** d;

    let ops = Object.values(map).map(op => {
        const opm        = op.totalDurationMin > 0 ? r(op.totalScanned / op.totalDurationMin, 2) : 0;
        const avgDur     = op.totalATs > 0 ? r(op.totalDurationMin / op.totalATs, 1) : 0;
        const missortPct = op.totalScanned > 0 ? r(op.totalMissorted / op.totalScanned * 100, 2) : 0;
        const missingPct = op.totalScanned > 0 ? r(op.totalMissing   / op.totalScanned * 100, 2) : 0;
        const errorRate  = op.totalScanned > 0 ? (op.totalMissorted + op.totalMissing) / op.totalScanned : 0;
        return { ...op, opm, avgDur, missortPct, missingPct, errorRate };
    });

    if (ops.length === 0) return [];

    const maxOPM     = Math.max(...ops.map(o => o.opm));
    const minError   = Math.min(...ops.map(o => o.errorRate));
    const maxError   = Math.max(...ops.map(o => o.errorRate));
    const errorRange = maxError - minError;

    ops = ops.map(op => {
        const prodScore = maxOPM > 0 ? r(op.opm / maxOPM * 100, 1) : 0;
        const qualScore = errorRange > 0 ? r((1 - (op.errorRate - minError) / errorRange) * 100, 1) : 100;
        const combined  = r(prodScore * 0.6 + qualScore * 0.4, 1);
        return { ...op, prodScore, qualScore, combined };
    });

    return ops.sort((a, b) => b.combined - a.combined);
}

function scoreColor(score) {
    if (score >= 80) return '#22c55e';
    if (score >= 60) return '#f59e0b';
    return '#ef4444';
}

function fmtMin(min) {
    const m = Math.floor(min);
    const s = Math.round((min - m) * 60);
    return `${m}m ${String(s).padStart(2,'0')}s`;
}

function renderProdutividade() {
    const ops = calcularProdutividade(rawAPIList);

    // KPIs
    const totalATs   = ops.reduce((s, o) => s + o.totalATs, 0);
    const avgOPM     = ops.length ? (ops.reduce((s, o) => s + o.opm, 0) / ops.length) : 0;
    const avgAcur    = ops.length ? (ops.reduce((s, o) => s + (100 - o.errorRate * 100), 0) / ops.length) : 0;

    document.getElementById('prod-kpi-ops').textContent      = ops.length;
    document.getElementById('prod-kpi-ats').textContent      = totalATs;
    document.getElementById('prod-kpi-giro').textContent     = avgOPM.toFixed(1);
    document.getElementById('prod-kpi-acuracia').textContent = avgAcur.toFixed(1);
    document.getElementById('prod-subtitle').textContent     = `${totalATs} ATs validados — ${ops.length} operadores ativos`;

    // Insights
    if (ops.length > 0) {
        const fastest   = [...ops].sort((a, b) => b.opm - a.opm)[0];
        const bestBal   = ops[0]; // já ordenado por combined
        const lowMiss   = [...ops].sort((a, b) => a.missortPct - b.missortPct)[0];
        const slowest   = [...ops].sort((a, b) => b.avgDur - a.avgDur)[0];
        const mostATs   = [...ops].sort((a, b) => b.totalATs - a.totalATs)[0];
        const avgDurAll = ops.reduce((s, o) => s + o.avgDur, 0) / ops.length;
        const shortName = n => n.split(' ').slice(0, 2).join(' ');

        document.getElementById('ins-fast-name').textContent = shortName(fastest.operator);
        document.getElementById('ins-fast-val').textContent  = `${fastest.opm.toFixed(2)} ped/min`;

        document.getElementById('ins-best-name').textContent = shortName(bestBal.operator);
        document.getElementById('ins-best-val').textContent  = `Score ${bestBal.combined.toFixed(0)} — ${bestBal.opm.toFixed(2)} ped/min`;

        document.getElementById('ins-qual-name').textContent = shortName(lowMiss.operator);
        document.getElementById('ins-qual-val').textContent  = `${lowMiss.missortPct.toFixed(2)}% missort`;

        document.getElementById('ins-attn-name').textContent = shortName(slowest.operator);
        document.getElementById('ins-attn-val').textContent  = `${fmtMin(slowest.avgDur)}/AT (média ${fmtMin(avgDurAll)})`;

        document.getElementById('ins-vol-name').textContent  = shortName(mostATs.operator);
        document.getElementById('ins-vol-val').textContent   = `${mostATs.totalATs} ATs gerenciados`;
    }

    const tbody = document.querySelector('#prodTable tbody');
    tbody.innerHTML = '';

    ops.forEach((op, i) => {
        const rank = i + 1;
        const badgeClass = rank === 1 ? 'gold' : rank === 2 ? 'silver' : rank === 3 ? 'bronze' : '';
        const color = scoreColor(op.combined);

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><span class="rank-badge ${badgeClass}">${rank}</span></td>
            <td style="font-weight:500">${op.operator}</td>
            <td>${op.totalATs}</td>
            <td>${op.totalScanned.toLocaleString('pt-BR')}</td>
            <td>${fmtMin(op.avgDur)}</td>
            <td style="font-weight:600">${op.opm.toFixed(2)}</td>
            <td style="color:${op.missortPct > 3 ? 'var(--accent-danger)' : 'var(--text-1)'}">${op.missortPct.toFixed(1)}%</td>
            <td style="color:${op.missingPct > 3 ? 'var(--accent-danger)' : 'var(--text-1)'}">${op.missingPct.toFixed(1)}%</td>
            <td>${op.prodScore.toFixed(0)}</td>
            <td>${op.qualScore.toFixed(0)}</td>
            <td>
                <div class="score-bar-wrap">
                    <div class="score-bar">
                        <div class="score-bar-fill" style="width:${op.combined}%;background:${color}"></div>
                    </div>
                    <span class="score-val" style="color:${color}">${op.combined.toFixed(0)}</span>
                </div>
            </td>`;
        tbody.appendChild(tr);
    });

    if (ops.length === 0) {
        tbody.innerHTML = '<tr><td colspan="11" style="text-align:center;color:var(--text-2)">Nenhum AT validado ainda.</td></tr>';
    }
}

// ======================= ATUALIZAR UI =======================

function updateUI() {
    document.getElementById('statTotalPackages').textContent = (dashboardData.totalInitialPackages || 0).toLocaleString();
    document.getElementById('statTotalRoutes').textContent   = (dashboardData.totalATTO || 0).toLocaleString();
    document.getElementById('statMissorted').textContent     = (dashboardData.missorted || 0).toLocaleString();
    document.getElementById('statMissing').textContent       = (dashboardData.missing || 0).toLocaleString();

    const shipPct  = Math.round((dashboardData.totalFinalPackages / dashboardData.totalInitialPackages) * 100) || 0;
    const routePct = Math.round((dashboardData.validatedATTO / dashboardData.totalATTO) * 100) || 0;
    const procRate = ((dashboardData.totalInitialPackages - dashboardData.missorted) / dashboardData.totalInitialPackages) * 100 || 0;
    const expRate  = ((dashboardData.totalInitialPackages - dashboardData.missing)   / dashboardData.totalInitialPackages) * 100 || 0;

    document.getElementById('valTotal').textContent      = `${shipPct}%`;
    document.getElementById('valRoutes').textContent     = `${routePct}%`;
    document.getElementById('valAccuracy').textContent   = `${procRate.toFixed(1)}%`;
    document.getElementById('valExpedition').textContent = `${expRate.toFixed(1)}%`;

    charts.total.data.datasets[0].data      = [shipPct, 100 - shipPct];
    charts.routes.data.datasets[0].data     = [routePct, 100 - routePct];
    charts.accuracy.data.datasets[0].data   = [procRate, 100 - procRate];
    charts.expedition.data.datasets[0].data = [expRate, 100 - expRate];

    const allOps = dashboardData.allOperatorStats || [];
    let totalRoutesPerHour = 0, opsWithRate = 0;
    allOps.forEach(op => {
        if (op.firstStartTime && op.lastEndTime && op.lastEndTime > op.firstStartTime) {
            const hours = (op.lastEndTime - op.firstStartTime) / 3600;
            if (hours > 0) { totalRoutesPerHour += op.routes / hours; opsWithRate++; }
        }
    });

    const avgTurnover = opsWithRate > 0 ? (totalRoutesPerHour / opsWithRate).toFixed(1) : 0;
    document.getElementById('valBenchTurnover').textContent = avgTurnover;
    charts.benchTurnover.data.datasets[0].data = [Math.min(Math.round((avgTurnover / 15) * 100), 100), 100 - Math.min(Math.round((avgTurnover / 15) * 100), 100)];

    charts.total.update();
    charts.routes.update();
    charts.benchTurnover.update();
    charts.accuracy.update();
    charts.expedition.update();
    charts.targetTurnover.update();

    updateOpsTarget();
    renderTables();
}

function renderTables() {
    const productivityBody = document.querySelector('#productivityTable tbody');
    const accuracyBody     = document.querySelector('#accuracyTable tbody');
    const timeBody         = document.querySelector('#timeTable tbody');
    const corridorBody     = document.querySelector('#corridorTable tbody');
    const waveBody         = document.querySelector('#waveTable tbody');

    if (!productivityBody || !accuracyBody || !timeBody || !corridorBody) return;

    productivityBody.innerHTML = (dashboardData.operatorProductivity || []).map(op => {
        let routesPerHour = '0.0';
        if (op.firstStartTime && op.lastEndTime && op.lastEndTime > op.firstStartTime) {
            routesPerHour = (op.routes / ((op.lastEndTime - op.firstStartTime) / 3600)).toFixed(1);
        }
        return `<tr><td>${op.operator}</td><td><strong>${op.routes}</strong></td><td><strong>${routesPerHour}</strong></td></tr>`;
    }).join('');

    const timeData = (dashboardData.allOperatorStats || []).filter(op => op.totalTime > 0)
        .sort((a, b) => (a.totalTime / a.routes) - (b.totalTime / b.routes));
    timeBody.innerHTML = timeData.map(op => {
        const avg = Math.round(op.totalTime / op.routes);
        return `<tr><td>${op.operator}</td><td><strong>${Math.floor(avg/60)}m ${avg%60}s</strong></td></tr>`;
    }).join('');

    const corridorData = Object.values(dashboardData.corridorStats || {})
        .sort((a, b) => (a.missorted/(a.initial||1)) - (b.missorted/(b.initial||1)));
    corridorBody.innerHTML = corridorData.slice(0, 10).map(c => {
        const acc = Math.round((1 - (c.missorted / (c.initial || 1))) * 100);
        const cls = acc < 95 ? 'text-danger' : (acc < 98 ? 'text-warning' : 'text-success');
        return `<tr><td>Rua ${c.name}</td><td>${c.missorted}</td><td class="${cls}"><strong>${acc}%</strong></td></tr>`;
    }).join('');

    if (waveBody) {
        waveBody.innerHTML = Object.values(dashboardData.corridorStats || {}).sort((a,b) => a.name.localeCompare(b.name)).map(c => {
            const total = c.routesSet ? c.routesSet.size : 0;
            const validated = c.validatedRoutesSet ? c.validatedRoutesSet.size : 0;
            const pct = total > 0 ? Math.round((validated / total) * 100) : 0;
            return `<tr><td>Rua ${c.name}</td><td>${validated} / ${total}</td><td class="${pct===100?'text-success':''}"><strong>${pct}%</strong></td></tr>`;
        }).join('');
    }

    accuracyBody.innerHTML = [...(dashboardData.allOperatorStats || [])].sort((a,b) => (b.missing/(b.final||1)) - (a.missing/(a.final||1))).map(op => {
        const acc = Math.round((1 - (op.missing / (op.final || 1))) * 100);
        const cls = acc < 95 ? 'text-danger' : (acc < 98 ? 'text-warning' : 'text-success');
        return `<tr><td>${op.operator}</td><td>${op.missing}</td><td>${op.routes}</td><td class="${cls}"><strong>${acc}%</strong></td></tr>`;
    }).join('');
}

// ======================= GAUGES =======================

function initGauges() {
    const opt = (color) => ({
        type: 'doughnut',
        data: { datasets: [{ data: [0, 100], backgroundColor: [color, 'rgba(255,255,255,0.05)'], borderWidth: 0, circumference: 180, rotation: 270, cutout: '85%', borderRadius: 10 }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { enabled: false } }, events: [] }
    });

    charts.total          = new Chart(document.getElementById('gaugeTotal'),          opt('#38bdf8'));
    charts.routes         = new Chart(document.getElementById('gaugeRoutes'),         opt('#22c55e'));
    charts.benchTurnover  = new Chart(document.getElementById('gaugeBenchTurnover'),  opt('#a78bfa'));
    charts.accuracy       = new Chart(document.getElementById('gaugeAccuracy'),       opt('#eab308'));
    charts.expedition     = new Chart(document.getElementById('gaugeExpedition'),     opt('#ef4444'));
    charts.targetTurnover = new Chart(document.getElementById('gaugeTargetTurnover'), opt('#f0f'));
}

// ======================= OPS CLOCK =======================

function updateOpsTarget() {
    const startInput = document.getElementById('opsStart').value;
    const endInput   = document.getElementById('opsEnd').value;

    if (!startInput || !endInput) {
        document.getElementById('valTargetTurnover').textContent = "0";
        charts.targetTurnover.data.datasets[0].data = [0, 100];
        charts.targetTurnover.update();
        return;
    }

    const now = new Date();
    const startDate = new Date(); startDate.setHours(...startInput.split(':'), 0, 0);
    const endDate   = new Date(); endDate.setHours(...endInput.split(':'), 0, 0);

    const timeRemainingMs = endDate - (now > startDate ? now : startDate);

    if (timeRemainingMs <= 0) {
        document.getElementById('valTargetTurnover').textContent = "N/A";
        charts.targetTurnover.data.datasets[0].data = [0, 100];
        charts.targetTurnover.update();
        return;
    }

    const remainingRoutes = (dashboardData.totalATTO || 0) - (dashboardData.validatedATTO || 0);
    if (remainingRoutes <= 0) {
        document.getElementById('valTargetTurnover').textContent = "Done";
        charts.targetTurnover.data.datasets[0].data = [100, 0];
        charts.targetTurnover.update();
        return;
    }

    const globalRate   = remainingRoutes / (timeRemainingMs / (1000 * 60 * 60));
    const manualOps    = parseInt(document.getElementById('opsCount').value) || 0;
    const dataOps      = (dashboardData.operatorProductivity || []).length || 1;
    const activeOps    = manualOps > 0 ? manualOps : dataOps;
    const targetPerOp  = (globalRate / activeOps).toFixed(1);

    document.getElementById('valTargetTurnover').textContent = targetPerOp;

    const currentRate = parseFloat(document.getElementById('valBenchTurnover').textContent) || 0;
    const targetRate  = parseFloat(targetPerOp) || 0;
    const lightEl = document.getElementById('statusLight');
    const textEl  = document.getElementById('statusText');
    lightEl.className = 'status-light';

    if (targetRate === 0) {
        textEl.textContent = "--";
    } else if (currentRate >= targetRate * 1.05) {
        lightEl.classList.add('status-green');
        textEl.textContent = "Acima do esperado";
        textEl.style.color = "var(--accent-success)";
    } else if (currentRate >= targetRate) {
        lightEl.classList.add('status-yellow');
        textEl.textContent = "Atenção";
        textEl.style.color = "var(--accent-warning)";
    } else {
        lightEl.classList.add('status-red');
        textEl.textContent = "Abaixo do esperado";
        textEl.style.color = "var(--accent-danger)";
    }

    charts.targetTurnover.data.datasets[0].data = [Math.min(Math.round((targetPerOp / 20) * 100), 100), 100 - Math.min(Math.round((targetPerOp / 20) * 100), 100)];
    charts.targetTurnover.update();
}
