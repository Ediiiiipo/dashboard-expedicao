# Diário do Projeto — Dashboard de Expedição Shopee Hub

> Documento vivo. Atualizado a cada mudança relevante no projeto.

---

## Visão Geral

App Electron para monitoramento em tempo real da conferência de expedição no SPX Shopee.
Substitui o processo manual de exportar CSV, abrindo o dashboard direto com os dados da API.

- **Stack:** Electron + Playwright-core + Chart.js + fs-extra
- **Versão atual:** 1.0.0
- **Arquivo principal:** `main.js` (processo Electron) + `renderer.js` (interface)

---

## Arquitetura

```
main.js              → Processo principal Electron (IPC handlers, fetch da API)
renderer.js          → Interface do dashboard (DOM, charts, polling)
login-shopee.js      → Módulo Playwright (login, sessão, cookies)
index.html           → Estrutura HTML do dashboard
style.css            → Estilos do dashboard
task.json            → Persiste o último task_id descoberto (ignorado pelo git)
sessao.json          → Cookies/sessão do Playwright (ignorado pelo git)
```

### Fluxo de dados

```
1. Startup
   └─ verificar-sessao (checa se sessao.json existe com cookies)
       ├─ Sessão válida → entrarNoDashboard()
       └─ Sem sessão → Tela de login (Playwright abre Chrome para login manual)

2. entrarNoDashboard()
   └─ autoDescobrirTaskId()
       └─ IPC: buscar-dados-completo (main.js)
           ├─ GET audit/task/list → descobre validation_task_id da tarefa atual
           └─ GET audit/target/list?task_id=VT... → baixa todos AT/TOs
               └─ processAPIData() → updateUI() → renderTables()

3. Polling automático (a cada 3 min)
   └─ refreshSilencioso() → mesmo fluxo do passo 2, sem bloquear UI
```

---

## Endpoints da API Shopee SPX

| Endpoint | Uso |
|---|---|
| `GET /api/in-station/lmhub/audit/task/list?page_no=1&count=1` | Descobre tarefa atual (`validation_task_id`) |
| `GET /api/in-station/lmhub/audit/target/list?page_no=1&count=9999&task_id=VT...` | Baixa todos AT/TOs da tarefa |

**Base URL:** `https://spx.shopee.com.br`

### Headers obrigatórios

```js
{
  'accept': 'application/json, text/plain, */*',
  'app': 'FMS Portal',
  'cookie': '<cookie da sessão>',
  'origin': 'https://spx.shopee.com.br',
  'referer': 'https://spx.shopee.com.br/',
  'sec-fetch-dest': 'empty',       // ← sem esses 3, retorna 403
  'sec-fetch-mode': 'cors',
  'sec-fetch-site': 'same-origin',
  'x-csrftoken': '<token da sessão>',
}
```

> **Importante:** chamar `audit/task/list` antes de `audit/target/list` é necessário como "warmup" para evitar 403 na segunda chamada.

### Campos relevantes da resposta

| Campo API | Significado |
|---|---|
| `validation_task_id` | ID da tarefa (formato `VT202603100BBWT`) |
| `target_id` | Identificador do AT/TO |
| `binding_entity` | Corredor (ex: "A-001" → rua "A") |
| `initial_qty` | Pacotes iniciais na rota |
| `final_qty` | Pacotes conferidos |
| `missort_qty` | Pacotes missort |
| `missing_qty` | Pacotes faltantes |
| `validation_status` | `4` = conferência validada |
| `validation_operator` | Nome do operador (remover prefixo `[xxx]`) |
| `validation_start_time` / `validation_end_time` | Unix timestamp da conferência |

---

## Sessão / Login

- **Módulo:** `login-shopee.js`
- **Sessão salva em:** `%APPDATA%/shopee-dashboard-expedicao/session.json` (storageState do Playwright)
- **Verificação:** apenas checa se o arquivo existe e tem cookies (sem abrir browser)
- **Login:** abre Chrome/Edge via Playwright, aguarda o usuário fazer login manualmente, captura cookies automaticamente
- **Duração da sessão:** variável — quando expirar, o polling detecta e volta para tela de login

---

## Redesign Visual (2026-03-11)

Redesign completo de `index.html` e `style.css` no estilo do vídeo de referência:

**Layout:**
- Sidebar de ícones fixo (56px) com navegação visual
- Topbar com título, controles de Ops Clock, Task ID, botão Atualizar, status e last-update
- KPI row: 4 cards com ícone colorido + número grande
- Gauges row: 5 gauges semicirculares + card de meta separado
- Tables grid: 5 tabelas em grid 3 colunas

**Paleta:**
- Fundo: `#0b0d12` (quase preto com tom azulado)
- Cards: `#141820`
- Accent: `#00c896` (ciano/teal) com glow
- Danger: `#ef4444`, Warning: `#f59e0b`, Success: `#22c55e`

**Detalhes técnicos:**
- Aliases `--accent-primary/success/warning/danger` mantidos no CSS para compatibilidade com `renderer.js`
- IDs duplicados de `statusLight`/`statusText` corrigidos (ficam apenas no topbar)
- Todos os IDs originais do `renderer.js` preservados

## Funcionalidades Implementadas

### Barra de progresso por etapas
Ao carregar dados, o overlay exibe 4 etapas com indicador visual (ícone + barra de progresso):
1. Conectando ao SPX
2. Buscando tarefa ativa
3. Baixando rotas
4. Atualizando dashboard

Implementação: `main.js` envia `event.sender.send('progresso-busca', etapa)` a cada passo do `buscar-dados-completo`. O renderer escuta via `ipcRenderer.on('progresso-busca')` e chama `avancarEtapa(n)`. Ao concluir, todas as etapas ficam com ✓ por 500ms antes do overlay fechar.

### Dashboard
- Gauges semicirculares (Chart.js doughnut 180°) para: pacotes expedidos, rotas validadas, benchmark de giro, acurácia, giro alvo
- Tabelas: produtividade por operador, tempo médio por rota, erros por corredor, progresso por rua (wave)
- Status operacional: verde/amarelo/vermelho com base em ritmo atual vs. meta
- Cálculo de meta dinâmica: rotas restantes / tempo restante / nº de operadores

### Automações
- **Auto-descoberta de task_id:** ao abrir, busca a tarefa mais recente via API (sem input manual)
- **Polling automático:** atualiza o dashboard a cada **3 minutos** em background
  - Pontinho pulsante azul indica quando está verificando
  - Não bloqueia a interface (sem loading overlay)
  - Para automaticamente se sessão expirar

### Proteções
- Flag `fetchEmAndamento` evita chamadas simultâneas (polling + botão manual)
- `AbortController` com timeout de 15–20s em cada fetch
- `AUTH_ERRORS = [1, 4, 401, 403, 100001, 100002]` — retcodes que indicam sessão expirada
- Polling pausado ao trocar de conta

---

## Histórico de Problemas e Soluções

### `url.includes is not a function`
- **Causa:** `page.waitForURL()` passa objeto URL, não string
- **Fix:** usar `url.href.includes()` no callback

### Canvas already in use
- **Causa:** `initGauges()` chamado múltiplas vezes sem destruir charts anteriores
- **Fix:** destruir todos os charts antes de recriar + flag `dashboardInicializado`

### HTTP 403 em `audit/target/list`
- **Causa:** faltavam headers `sec-fetch-*` + não havia warmup prévio
- **Fix:** adicionar os 3 headers e sempre chamar `audit/task/list` antes

### `retcode != 0` tratado como sessão expirada
- **Causa:** lista de erros de auth muito ampla / genérica
- **Fix:** lista explícita `AUTH_ERRORS`, outros retcodes exibem mensagem descritiva

### `verificarSessao` abrindo browser headless
- **Causa:** verificação desnecessariamente complexa
- **Fix:** só checar se `session.json` existe e tem cookies

### Dashboard não atualizava ao clicar "Atualizar"
- **Causa:** delay do `buscar-dados-completo` + UI sem feedback
- **Fix:** loading overlay + desabilitar botão durante fetch

### `fetchData()` retornava imediatamente no fallback
- **Causa:** `fetchEmAndamento` ainda era `true` quando `autoDescobrirTaskId` chamava `fetchData()` como fallback (caso raro onde task_id é descoberto mas dados não vêm)
- **Fix:** resetar `fetchEmAndamento = false` antes da chamada de fallback

### Task ID numérico vs. string
- **Causa:** API retorna `validation_task_id` (ex: `VT202603100BBWT`), não ID numérico
- **Fix:** priorizar `validation_task_id` no campo correto da resposta

---

## Configurações do Build (electron-builder)

```
Targets:
  - NSIS installer (.exe com wizard de instalação)
  - Portable (.exe standalone)

Output: dist/
Arch: x64
```

Comandos:
```bash
npm start          # rodar em desenvolvimento
npm run build:win  # gerar instalador + portable
```

---

## Arquivos ignorados pelo Git

```
node_modules/
dist/
sessao.json        # cookies de sessão
sessao_state.json
session.json
task.json          # task_id descoberto automaticamente
*.log
```

---

## Próximos Passos / Ideias

- [ ] Notificação de desktop quando 100% das rotas forem validadas
- [ ] Histórico de sessões por data (comparativo diário)
- [ ] Exportar relatório PDF do dashboard
- [ ] Configuração do intervalo de polling via interface
- [ ] Modo escuro / claro alternável

---

*Última atualização: 2026-03-10*
