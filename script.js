// URL do CSV publicado no Google Sheets - substitua após publicar a planilha
const SHEETS_CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQFqXTf8tvQCq5IScsrMrwUuB8xKeCeFKnJme3f5160M4fV68QTQHdg-n3rHKifV45gz3wLsTcZGNLV/pub?gid=0&single=true&output=csv';

document.addEventListener('DOMContentLoaded', () => {
    // Current Date
    const dateOptions = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    document.getElementById('current-date').textContent = new Date().toLocaleDateString('pt-BR', dateOptions);

    // Initial Mock Data (Refined to match user's real baseline)
    let dashboardData = {
        totalInitialPackages: 10119,
        totalFinalPackages: 9726, // Estimated (Total - Errors - Missing)
        totalATTO: 120,           // Estimated total routes
        validatedATTO: 98,
        missorted: 85,
        missing: 308,
        operatorProductivity: [
            { operator: 'João Silva', routes: 24 },
            { operator: 'Maria Santos', routes: 22 },
            { operator: 'Pedro Alves', routes: 19 },
            { operator: 'Ana Costa', routes: 18 },
            { operator: 'Lucas Oliveira', routes: 15 },
            { operator: 'Carla Dias', routes: 14 },
            { operator: 'Marcos Souza', routes: 14 },
            { operator: 'Fernanda Lima', routes: 12 },
            { operator: 'Ricardo Melo', routes: 11 },
            { operator: 'Beatriz Rocha', routes: 10 },
            { operator: 'Gabriel Silva', routes: 9 },
            { operator: 'Luiza Ferreira', routes: 8 }
        ]
    };

    // Chart instances
    let charts = {};

    function initGauges() {
        const gaugeOptions = (color) => ({
            type: 'doughnut',
            data: {
                datasets: [{
                    data: [0, 100],
                    backgroundColor: [color, 'rgba(255, 255, 255, 0.05)'],
                    borderWidth: 0,
                    circumference: 180,
                    rotation: 270,
                    cutout: '85%',
                    borderRadius: 10
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false }, tooltip: { enabled: false } },
                events: []
            }
        });

        charts.total = new Chart(document.getElementById('gaugeTotal'), gaugeOptions('#38bdf8'));
        charts.routes = new Chart(document.getElementById('gaugeRoutes'), gaugeOptions('#22c55e'));
        charts.benchTurnover = new Chart(document.getElementById('gaugeBenchTurnover'), gaugeOptions('#a78bfa'));
        charts.accuracy = new Chart(document.getElementById('gaugeAccuracy'), gaugeOptions('#eab308'));
        charts.expedition = new Chart(document.getElementById('gaugeExpedition'), gaugeOptions('#ef4444'));
        charts.targetTurnover = new Chart(document.getElementById('gaugeTargetTurnover'), gaugeOptions('#f0f'));
    }


    function updateUI() {
        // Update Scorecards
        document.getElementById('statTotalPackages').textContent = (dashboardData.totalInitialPackages || 0).toLocaleString();
        document.getElementById('statTotalRoutes').textContent = (dashboardData.totalATTO || 0).toLocaleString();
        document.getElementById('statMissorted').textContent = (dashboardData.missorted || 0).toLocaleString();
        document.getElementById('statMissing').textContent = (dashboardData.missing || 0).toLocaleString();

        // Update Gauge Percentages
        const shipPct = Math.round((dashboardData.totalFinalPackages / dashboardData.totalInitialPackages) * 100) || 0;
        const routePct = Math.round((dashboardATTOValidated(dashboardData) / dashboardData.totalATTO) * 100) || 0;

        const procRate = ((dashboardData.totalInitialPackages - dashboardData.missorted) / dashboardData.totalInitialPackages) * 100 || 0;
        const expRate = ((dashboardData.totalInitialPackages - dashboardData.missing) / dashboardData.totalInitialPackages) * 100 || 0;

        const procPct = procRate.toFixed(1);
        const expPct = expRate.toFixed(1);

        document.getElementById('valTotal').textContent = `${shipPct}%`;
        document.getElementById('valRoutes').textContent = `${routePct}%`;
        document.getElementById('valAccuracy').textContent = `${procPct}%`;
        document.getElementById('valExpedition').textContent = `${expPct}%`;

        // Update Gauge Charts
        charts.total.data.datasets[0].data = [shipPct, 100 - shipPct];
        charts.routes.data.datasets[0].data = [routePct, 100 - routePct];
        charts.accuracy.data.datasets[0].data = [procRate, 100 - procRate];
        charts.expedition.data.datasets[0].data = [expRate, 100 - expRate];

        // Update Bench Turnover (average routes/hour)
        const allOps = dashboardData.allOperatorStats || [];
        let totalRoutesPerHour = 0;
        let opsWithRate = 0;

        allOps.forEach(op => {
            if (op.firstStartTime && op.lastEndTime && op.lastEndTime > op.firstStartTime) {
                const hours = (op.lastEndTime - op.firstStartTime) / 3600;
                if (hours > 0) {
                    const rate = op.routes / hours;
                    totalRoutesPerHour += rate;
                    opsWithRate++;
                }
            }
        });

        const avgTurnover = opsWithRate > 0 ? (totalRoutesPerHour / opsWithRate).toFixed(1) : 0;
        document.getElementById('valBenchTurnover').textContent = avgTurnover;
        // Gauge for turnover is just visual here - let's set it to full if > 0 or normalize it? 
        // For simplicity let's make it a scale of 0-20? Or just show the value text and full circle.
        // Let's assume a target of 10 routes/hour for the gauge percentage (e.g. 5 = 50%)
        const turnoverPct = Math.min(Math.round((avgTurnover / 15) * 100), 100);
        charts.benchTurnover.data.datasets[0].data = [turnoverPct, 100 - turnoverPct];

        charts.total.update();
        charts.routes.update();
        charts.benchTurnover.update();
        charts.accuracy.update();
        charts.accuracy.update();
        charts.expedition.update();
        charts.targetTurnover.update();

        updateOpsTarget();


        // Render Tables
        renderTables();
    }

    function renderTables() {
        const productivityBody = document.querySelector('#productivityTable tbody');
        const accuracyBody = document.querySelector('#accuracyTable tbody');
        const timeBody = document.querySelector('#timeTable tbody');
        const corridorBody = document.querySelector('#corridorTable tbody');
        const waveBody = document.querySelector('#waveTable tbody');

        if (!productivityBody || !accuracyBody || !timeBody || !corridorBody) return;

        // 1. Productivity Table (All Operators) with Routes/Hour
        productivityBody.innerHTML = (dashboardData.operatorProductivity || [])
            .slice(0, 1000) // Show all (limit 1000 for sanity)
            .map(op => {
                // Calculate routes per hour based on work span (first start to last end)
                let routesPerHour = '0.0';
                if (op.firstStartTime && op.lastEndTime && op.lastEndTime > op.firstStartTime) {
                    const workSpanSeconds = op.lastEndTime - op.firstStartTime;
                    const workSpanHours = workSpanSeconds / 3600;
                    routesPerHour = (op.routes / workSpanHours).toFixed(1);
                }

                return `
                    <tr>
                        <td>${op.operator}</td>
                        <td><strong>${op.routes}</strong></td>
                        <td><strong>${routesPerHour}</strong></td>
                    </tr>
                `;
            }).join('');

        // 2. Average Loading Time Table (All Operators)
        const timeData = (dashboardData.allOperatorStats || [])
            .filter(op => op.totalTime > 0)
            .sort((a, b) => (a.totalTime / a.routes) - (b.totalTime / b.routes));

        timeBody.innerHTML = timeData
            .slice(0, 1000)
            .map(op => {
                const avgSeconds = Math.round(op.totalTime / op.routes);
                const minutes = Math.floor(avgSeconds / 60);
                const seconds = avgSeconds % 60;
                const timeStr = `${minutes}m ${seconds}s`;
                return `
                    <tr>
                        <td>${op.operator}</td>
                        <td><strong>${timeStr}</strong></td>
                    </tr>
                `;
            }).join('');

        // 3. Corridor Accuracy Table (Problematic Corridors)
        const corridorData = Object.values(dashboardData.corridorStats || {})
            .sort((a, b) => {
                const accA = (1 - (a.missorted / (a.initial || 1)));
                const accB = (1 - (b.missorted / (b.initial || 1)));
                return accA - accB; // Worst first
            });

        corridorBody.innerHTML = corridorData
            .slice(0, 10)
            .map(c => {
                const acc = Math.round((1 - (c.missorted / (c.initial || 1))) * 100);
                const accClass = acc < 95 ? 'text-danger' : (acc < 98 ? 'text-warning' : 'text-success');
                return `
                    <tr>
                        <td>Rua ${c.name}</td>
                        <td>${c.missorted}</td>
                        <td class="${accClass}"><strong>${acc}%</strong></td>
                    </tr>
                `;
            }).join('');

        // 4. Wave Loading Table (Progress per Corridor)
        if (waveBody) {
            const waveData = Object.values(dashboardData.corridorStats || {})
                .sort((a, b) => a.name.localeCompare(b.name));

            waveBody.innerHTML = waveData.map(c => {
                const totalRoutes = c.routesSet ? c.routesSet.size : 0;
                const validatedRoutes = c.validatedRoutesSet ? c.validatedRoutesSet.size : 0;
                const progress = totalRoutes > 0 ? Math.round((validatedRoutes / totalRoutes) * 100) : 0;

                const progressClass = progress === 100 ? 'text-success' : '';

                return `
                    <tr>
                        <td>Rua ${c.name}</td>
                        <td>${validatedRoutes} / ${totalRoutes}</td>
                        <td class="${progressClass}"><strong>${progress}%</strong></td>
                    </tr>
                `;
            }).join('');
        }

        // 5. Accuracy Table (Problematic Operators)
        const statsArray = dashboardData.allOperatorStats || [];
        const sortedForAccuracy = [...statsArray].sort((a, b) => {
            const ratioA = a.missing / (a.final || 1);
            const ratioB = b.missing / (b.final || 1);
            return ratioB - ratioA; // Most problematic first
        });

        accuracyBody.innerHTML = sortedForAccuracy
            .slice(0, 1000) // Show all
            .map(op => {
                const acc = Math.round((1 - (op.missing / (op.final || 1))) * 100);
                const accClass = acc < 95 ? 'text-danger' : (acc < 98 ? 'text-warning' : 'text-success');
                return `
                    <tr>
                        <td>${op.operator}</td>
                        <td>${op.missing}</td>
                        <td>${op.routes}</td>
                        <td class="${accClass}"><strong>${acc}%</strong></td>
                    </tr>
                `;
            }).join('');
    }

    function dashboardATTOValidated(data) {
        return data.validatedATTO;
    }

    // Helper for time parsing - returns Unix timestamp in seconds for accurate duration calc
    function parseTimeToSeconds(timeStr) {
        if (!timeStr) return 0;
        try {
            // PRIORITY: Try parsing as full date/time first (e.g., "2024-01-15 14:30:00" or ISO)
            const d = new Date(timeStr);
            if (!isNaN(d.getTime())) {
                return d.getTime() / 1000; // Return Unix timestamp in seconds
            }

            // FALLBACK: If it's just "HH:MM:SS" without date (less accurate for cross-day)
            const parts = timeStr.trim().split(':');
            if (parts.length >= 2) {
                const h = parseInt(parts[0]) || 0;
                const m = parseInt(parts[1]) || 0;
                const s = parseInt(parts[2]) || 0;
                return (h * 3600) + (m * 60) + s;
            }
        } catch (e) { return 0; }
        return 0;
    }

    // Processa resposta da API Shopee e atualiza o dashboard
    function processAPIData(apiResponse) {
        const items = apiResponse.data.list || [];
        const summary = apiResponse.data;

        let stats = {
            totalInitialPackages: 0,
            totalFinalPackages: 0,
            missorted: 0,
            missing: 0,
            attoSet: new Set(),
            validatedAttoSet: new Set(),
            opStatsMap: {},
            corridorMap: {}
        };

        items.forEach(item => {
            const initial   = item.initial_qty || 0;
            const final     = item.final_qty || 0;
            const mssorted  = item.missort_qty || 0;
            const mssing    = item.missing_qty || 0;
            const atto      = item.target_id || '';
            const corridor  = item.binding_entity || ''; // ex: "N-1", "M-12"
            const startTime = item.validation_start_time || 0; // Unix timestamp (s)
            const endTime   = item.validation_end_time || 0;
            const status    = item.validation_status; // 2=em andamento, 4=validado

            // Remove prefixo do operador: "[ops102547]NOME" → "NOME"
            const rawOp  = item.validation_operator || '';
            const operator = rawOp.replace(/^\[.*?\]/, '').trim() || 'N/A';

            stats.totalInitialPackages += initial;
            if (status === 4) stats.totalFinalPackages += final;
            stats.missorted += mssorted;
            stats.missing   += mssing;

            if (atto) {
                stats.attoSet.add(atto);
                if (status === 4) stats.validatedAttoSet.add(atto);
            }

            // Corredor: primeira letra de binding_entity ("N" de "N-1")
            if (corridor) {
                const street = corridor.charAt(0).toUpperCase();
                if (!stats.corridorMap[street]) {
                    stats.corridorMap[street] = {
                        name: street,
                        missorted: 0,
                        initial: 0,
                        routesSet: new Set(),
                        validatedRoutesSet: new Set()
                    };
                }
                stats.corridorMap[street].missorted += mssorted;
                stats.corridorMap[street].initial   += initial;
                if (atto) {
                    stats.corridorMap[street].routesSet.add(atto);
                    if (status === 4) stats.corridorMap[street].validatedRoutesSet.add(atto);
                }
            }

            // Duração em segundos
            const duration = (startTime && endTime && endTime > startTime) ? (endTime - startTime) : 0;

            if (operator && operator !== 'N/A') {
                if (!stats.opStatsMap[operator]) {
                    stats.opStatsMap[operator] = {
                        operator,
                        routes: 0,
                        final: 0,
                        missing: 0,
                        totalTime: 0,
                        firstStartTime: null,
                        lastEndTime: null
                    };
                }
                const op = stats.opStatsMap[operator];
                op.routes++;
                op.final   += final;
                op.missing += mssing;
                op.totalTime += duration;

                if (startTime > 0 && (!op.firstStartTime || startTime < op.firstStartTime)) {
                    op.firstStartTime = startTime;
                }
                if (endTime > 0 && (!op.lastEndTime || endTime > op.lastEndTime)) {
                    op.lastEndTime = endTime;
                }
            }
        });

        const opStatsArray  = Object.values(stats.opStatsMap);
        const sortedByRoutes = [...opStatsArray].sort((a, b) => b.routes - a.routes);

        dashboardData = {
            totalInitialPackages: stats.totalInitialPackages,
            totalFinalPackages:   stats.totalFinalPackages,
            totalATTO:     summary.all_qty      || stats.attoSet.size || 1,
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

    // Converte "HH:MM:SS" ou "HH:MM" para Unix timestamp em segundos (data de hoje)
    function timeToTimestamp(timeStr) {
        if (!timeStr || timeStr === '0') return 0;
        if (!isNaN(timeStr) && timeStr !== '') return parseFloat(timeStr);
        const parts = timeStr.trim().split(':');
        if (parts.length >= 2) {
            const d = new Date();
            d.setHours(parseInt(parts[0]) || 0, parseInt(parts[1]) || 0, parseInt(parts[2]) || 0, 0);
            return d.getTime() / 1000;
        }
        return 0;
    }

    // Parser robusto de linha CSV (lida com aspas e vírgulas dentro de campos)
    function parseCsvLine(line) {
        const result = [];
        let cur = '';
        let inQuotes = false;
        for (let i = 0; i < line.length; i++) {
            const c = line[i];
            if (c === '"') { inQuotes = !inQuotes; continue; }
            if (c === ',' && !inQuotes) { result.push(cur); cur = ''; continue; }
            cur += c;
        }
        result.push(cur);
        return result;
    }

    // Converte texto CSV para o formato esperado por processAPIData
    function parseCsvToAPIData(csvText) {
        const lines = csvText.trim().split('\n').filter(l => l.trim());
        if (lines.length < 2) throw new Error('Planilha vazia ou sem dados.');

        const headers = parseCsvLine(lines[0]).map(h => h.trim().replace(/"/g, ''));

        const list = lines.slice(1).map(line => {
            const values = parseCsvLine(line);
            const item = {};
            headers.forEach((h, i) => { item[h] = (values[i] || '').trim().replace(/"/g, ''); });

            item.initial_qty           = parseInt(item.initial_qty) || 0;
            item.final_qty             = parseInt(item.final_qty) || 0;
            item.missort_qty           = parseInt(item.missort_qty) || 0;
            item.missing_qty           = parseInt(item.missing_qty) || 0;
            item.validation_status     = parseInt(item.validation_status) || 0;
            item.validation_start_time = timeToTimestamp(item.validation_start_time);
            item.validation_end_time   = timeToTimestamp(item.validation_end_time);

            return item;
        }).filter(item => item.target_id);

        const allQty       = new Set(list.map(r => r.target_id)).size;
        const validatedQty = new Set(list.filter(r => r.validation_status === 4).map(r => r.target_id)).size;

        return { retcode: 0, data: { list, all_qty: allQty, validated_qty: validatedQty } };
    }

    // Busca CSV via proxy Vercel e atualiza o dashboard
    async function fetchData() {
        const btn = document.getElementById('btn-refresh');
        const status = document.getElementById('last-update');

        if (btn) { btn.textContent = 'Atualizando...'; btn.disabled = true; }
        if (status) status.textContent = 'Buscando dados...';

        try {
            const res = await fetch('/api/dados');
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const csvText = await res.text();
            const data = parseCsvToAPIData(csvText);
            processAPIData(data);
            if (status) status.textContent = `Atualizado: ${new Date().toLocaleTimeString('pt-BR')}`;
        } catch (err) {
            console.error('Erro ao buscar dados:', err);
            if (status) status.textContent = `Erro: ${err.message}`;
        } finally {
            if (btn) { btn.textContent = 'Atualizar Dados'; btn.disabled = false; }
        }
    }

    // Botão de atualização manual
    const btnRefresh = document.getElementById('btn-refresh');
    if (btnRefresh) btnRefresh.addEventListener('click', fetchData);

    // Auto-refresh a cada 5 minutos
    setInterval(fetchData, 5 * 60 * 1000);

    // Ops Clock Logic
    function updateOpsTarget() {
        const startInput = document.getElementById('opsStart').value;
        const endInput = document.getElementById('opsEnd').value;

        if (!startInput || !endInput) {
            document.getElementById('valTargetTurnover').textContent = "0";
            charts.targetTurnover.data.datasets[0].data = [0, 100];
            charts.targetTurnover.update();
            return;
        }

        const now = new Date(); // Use current system time for calculation relative to now
        // To accurately calculate duration remaining, we need to create Date objects for today with the input times
        const startDate = new Date();
        const [startH, startM] = startInput.split(':');
        startDate.setHours(startH, startM, 0, 0);

        const endDate = new Date();
        const [endH, endM] = endInput.split(':');
        endDate.setHours(endH, endM, 0, 0);

        // Logic: 
        // We need to finish 'remainingRoutes' between NOW and END_TIME.
        // However, if NOW < START_TIME, we count from START_TIME.
        // If NOW > END_TIME, time is up (0 remaining).

        let effectiveStartTime = now > startDate ? now : startDate;
        let timeRemainingMs = endDate - effectiveStartTime;

        // If time is negative (already passed end time or end < start), 0
        if (timeRemainingMs <= 0) {
            document.getElementById('valTargetTurnover').textContent = "N/A"; // Or handle as overdue
            charts.targetTurnover.data.datasets[0].data = [0, 100];
            charts.targetTurnover.update();
            return;
        }

        const timeRemainingHours = timeRemainingMs / (1000 * 60 * 60);

        // Remaining Routes = Total Routes - Validated Routes
        const totalRoutes = dashboardData.totalATTO || 0;
        const validatedRoutes = dashboardATTOValidated(dashboardData) || 0;
        const remainingRoutes = totalRoutes - validatedRoutes;

        if (remainingRoutes <= 0) {
            document.getElementById('valTargetTurnover').textContent = "Done";
            charts.targetTurnover.data.datasets[0].data = [100, 0];
            charts.targetTurnover.update();
            return;
        }

        // Calculate Global Target Rate (rotas/hora needed for the whole hub)
        const globalTargetRate = remainingRoutes / timeRemainingHours;

        // Calculate Target Per Operator
        // Get active operators from input (user manual correction) or default to data length
        const manualOpCount = parseInt(document.getElementById('opsCount').value) || 0;
        const dataOpCount = (dashboardData.operatorProductivity || []).length || 1;

        const activeOperatorsCount = manualOpCount > 0 ? manualOpCount : dataOpCount;

        // Avoid division by zero
        const targetPerOperator = activeOperatorsCount > 0 ? (globalTargetRate / activeOperatorsCount).toFixed(1) : globalTargetRate.toFixed(1);

        document.getElementById('valTargetTurnover').textContent = targetPerOperator;

        // --- Status Traffic Light Logic ---
        const currentRateStr = document.getElementById('valBenchTurnover').textContent;
        const currentRate = parseFloat(currentRateStr) || 0;
        const targetRate = parseFloat(targetPerOperator) || 0;

        const lightEl = document.getElementById('statusLight');
        const textEl = document.getElementById('statusText');

        // Reset classes
        lightEl.className = 'status-light';

        if (targetRate === 0) {
            // No target yet or invalid
            textEl.textContent = "--";
        } else if (currentRate >= targetRate * 1.05) {
            // Green: Above expected (5% buffer)
            lightEl.classList.add('status-green');
            textEl.textContent = "Acima do esperado";
            textEl.style.color = "var(--accent-success)";
        } else if (currentRate >= targetRate) {
            // Yellow: On target but risky (0-5% buffer)
            lightEl.classList.add('status-yellow');
            textEl.textContent = "Atenção";
            textEl.style.color = "var(--accent-warning)";
        } else {
            // Red: Below target
            lightEl.classList.add('status-red');
            textEl.textContent = "Abaixo do esperado";
            textEl.style.color = "var(--accent-danger)";
        }

        // Gauge visualization: 
        // Scale 0-20 like the Bench Turnover gauge
        const gaugePct = Math.min(Math.round((targetPerOperator / 20) * 100), 100);

        charts.targetTurnover.data.datasets[0].data = [gaugePct, 100 - gaugePct];
        charts.targetTurnover.update();
    }

    document.getElementById('opsStart').addEventListener('change', updateUI);
    document.getElementById('opsEnd').addEventListener('change', updateUI);
    document.getElementById('opsCount').addEventListener('change', updateUI);

    // Initialize
    initGauges();

    // Carrega dados reais da API ao iniciar
    fetchData();
});
