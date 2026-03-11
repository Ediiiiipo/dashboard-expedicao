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

// ======================= INICIALIZAÇÃO =======================
document.addEventListener('DOMContentLoaded', async () => {
    const dateOptions = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    document.getElementById('current-date').textContent = new Date().toLocaleDateString('pt-BR', dateOptions);

    // Progresso de login via IPC push do main
    ipcRenderer.on('progresso-login', (event, msg) => {
        document.getElementById('login-status').textContent = msg;
    });

    // Progresso de descoberta de task_id
    ipcRenderer.on('progresso-task', (event, msg) => {
        const sub = document.getElementById('loading-sub');
        if (sub) sub.textContent = msg;
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
        setInterval(fetchData, 5 * 60 * 1000);
        dashboardInicializado = true;
    }

    // Se não há task_id salvo, descobre automaticamente
    const taskIdInput = document.getElementById('input-task-id');
    if (!taskIdInput.value.trim()) {
        await autoDescobrirTaskId();
    } else {
        fetchData();
    }
}

async function autoDescobrirTaskId() {
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
        } else if (res.taskId) {
            // Capturou task_id mas não os dados — tenta API direta como fallback
            console.log(`[autoDescobrirTaskId] task_id=${res.taskId}, tentando API direta...`);
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

function mostrarLoading(sub = '') {
    const overlay = document.getElementById('loading-overlay');
    const subEl   = document.getElementById('loading-sub');
    if (overlay) overlay.classList.add('ativo');
    if (subEl && sub) subEl.textContent = sub;
}

function esconderLoading() {
    const overlay = document.getElementById('loading-overlay');
    if (overlay) overlay.classList.remove('ativo');
}

async function fetchData() {
    const btn    = document.getElementById('btn-refresh');
    const status = document.getElementById('last-update');
    const input  = document.getElementById('input-task-id');
    const taskId = input.value.trim();

    if (!taskId) {
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
            if (res.sessionExpired) {
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
        esconderLoading();
        if (btn) btn.disabled = false;
    }
}

// ======================= PROCESSAR DADOS =======================

function processAPIData(apiResponse) {
    const items = apiResponse.data.list || [];
    const summary = apiResponse.data;

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
