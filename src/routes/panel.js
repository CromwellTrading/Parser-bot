const express = require('express')
const router = express.Router()
const crypto = require('crypto')
const supabase = require('../supabase')

// ─── Panel HTML ────────────────────────────────────────────────────────────────

router.get('/', (req, res) => {
  res.send(PANEL_HTML)
})

// ─── API Routes (usadas por el panel) ─────────────────────────────────────────

function adminAuth(req, res, next) {
  const secret = req.headers['x-admin-secret']
  if (secret !== process.env.ADMIN_SECRET) {
    return res.status(401).json({ error: 'No autorizado' })
  }
  next()
}

router.use('/api', adminAuth)

router.get('/api/clients', async (req, res) => {
  const { data, error } = await supabase
    .from('clients')
    .select('id, name, token, active, webhook_url, created_at, expires_at')
    .order('created_at', { ascending: false })
  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

router.post('/api/clients', async (req, res) => {
  const { name, webhook_url, expires_at } = req.body
  if (!name) return res.status(400).json({ error: 'Nombre requerido' })
  const token = crypto.randomBytes(32).toString('hex')
  const { data, error } = await supabase
    .from('clients')
    .insert({ name, token, webhook_url, expires_at })
    .select()
    .single()
  if (error) return res.status(500).json({ error: error.message })
  res.status(201).json(data)
})

router.put('/api/clients/:id/toggle', async (req, res) => {
  const { id } = req.params
  const { data: client, error: fetchError } = await supabase
    .from('clients').select('active, name').eq('id', id).single()
  if (fetchError || !client) return res.status(404).json({ error: 'No encontrado' })
  const { data, error } = await supabase
    .from('clients').update({ active: !client.active }).eq('id', id).select().single()
  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

router.delete('/api/clients/:id', async (req, res) => {
  const { error } = await supabase.from('clients').delete().eq('id', req.params.id)
  if (error) return res.status(500).json({ error: error.message })
  res.json({ ok: true })
})

router.get('/api/logs', async (req, res) => {
  const { client_id, limit = 50 } = req.query
  let query = supabase
    .from('sms_logs')
    .select('*, clients(name)')
    .order('created_at', { ascending: false })
    .limit(parseInt(limit))
  if (client_id) query = query.eq('client_id', client_id)
  const { data, error } = await query
  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

// ─── HTML del panel ───────────────────────────────────────────────────────────

const PANEL_HTML = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>SynthesisOne — Panel</title>
<link href="https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=Syne:wght@400;600;800&display=swap" rel="stylesheet">
<style>
  :root {
    --bg: #0a0a0f;
    --surface: #111118;
    --border: #1e1e2e;
    --accent: #00ff88;
    --accent2: #0088ff;
    --danger: #ff3355;
    --text: #e8e8f0;
    --muted: #555570;
  }

  * { margin: 0; padding: 0; box-sizing: border-box; }

  body {
    background: var(--bg);
    color: var(--text);
    font-family: 'Syne', sans-serif;
    min-height: 100vh;
  }

  /* ── Login ── */
  #login-screen {
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    background: radial-gradient(ellipse at 50% 0%, #00ff8820 0%, transparent 60%);
  }

  .login-box {
    width: 100%;
    max-width: 400px;
    padding: 48px;
    border: 1px solid var(--border);
    background: var(--surface);
    position: relative;
  }

  .login-box::before {
    content: '';
    position: absolute;
    top: 0; left: 0; right: 0;
    height: 2px;
    background: linear-gradient(90deg, var(--accent), var(--accent2));
  }

  .logo {
    font-size: 11px;
    letter-spacing: 4px;
    text-transform: uppercase;
    color: var(--accent);
    font-family: 'Space Mono', monospace;
    margin-bottom: 32px;
  }

  .login-title {
    font-size: 28px;
    font-weight: 800;
    margin-bottom: 8px;
  }

  .login-sub {
    color: var(--muted);
    font-size: 14px;
    margin-bottom: 32px;
  }

  input {
    width: 100%;
    background: var(--bg);
    border: 1px solid var(--border);
    color: var(--text);
    padding: 14px 16px;
    font-family: 'Space Mono', monospace;
    font-size: 13px;
    outline: none;
    transition: border-color 0.2s;
  }

  input:focus { border-color: var(--accent); }

  input::placeholder { color: var(--muted); }

  .btn {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 14px 24px;
    font-family: 'Syne', sans-serif;
    font-weight: 600;
    font-size: 14px;
    cursor: pointer;
    border: none;
    transition: all 0.2s;
    letter-spacing: 0.5px;
  }

  .btn-primary {
    background: var(--accent);
    color: #000;
    width: 100%;
    justify-content: center;
    margin-top: 16px;
  }

  .btn-primary:hover { background: #00cc70; }

  .btn-sm {
    padding: 6px 14px;
    font-size: 12px;
    font-family: 'Space Mono', monospace;
  }

  .btn-green { background: #00ff8822; color: var(--accent); border: 1px solid #00ff8844; }
  .btn-green:hover { background: #00ff8833; }
  .btn-red { background: #ff335522; color: var(--danger); border: 1px solid #ff335544; }
  .btn-red:hover { background: #ff335533; }
  .btn-blue { background: #0088ff22; color: var(--accent2); border: 1px solid #0088ff44; }
  .btn-blue:hover { background: #0088ff33; }

  .error-msg {
    color: var(--danger);
    font-size: 12px;
    font-family: 'Space Mono', monospace;
    margin-top: 12px;
    display: none;
  }

  /* ── Dashboard ── */
  #dashboard { display: none; }

  header {
    border-bottom: 1px solid var(--border);
    padding: 20px 40px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    background: var(--surface);
    position: sticky;
    top: 0;
    z-index: 10;
  }

  .header-logo {
    font-size: 10px;
    letter-spacing: 4px;
    color: var(--accent);
    font-family: 'Space Mono', monospace;
    text-transform: uppercase;
  }

  .header-right {
    display: flex;
    align-items: center;
    gap: 16px;
  }

  .status-dot {
    width: 8px; height: 8px;
    border-radius: 50%;
    background: var(--accent);
    box-shadow: 0 0 8px var(--accent);
    animation: pulse 2s infinite;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.4; }
  }

  .status-text {
    font-size: 12px;
    color: var(--muted);
    font-family: 'Space Mono', monospace;
  }

  main { padding: 40px; max-width: 1200px; margin: 0 auto; }

  .tabs {
    display: flex;
    gap: 0;
    border-bottom: 1px solid var(--border);
    margin-bottom: 40px;
  }

  .tab {
    padding: 12px 24px;
    font-size: 13px;
    font-weight: 600;
    color: var(--muted);
    cursor: pointer;
    border-bottom: 2px solid transparent;
    transition: all 0.2s;
    letter-spacing: 1px;
    text-transform: uppercase;
    font-size: 11px;
  }

  .tab.active {
    color: var(--accent);
    border-bottom-color: var(--accent);
  }

  .tab-content { display: none; }
  .tab-content.active { display: block; }

  /* ── Stats ── */
  .stats {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 16px;
    margin-bottom: 40px;
  }

  .stat-card {
    background: var(--surface);
    border: 1px solid var(--border);
    padding: 24px;
    position: relative;
    overflow: hidden;
  }

  .stat-card::after {
    content: '';
    position: absolute;
    bottom: 0; left: 0;
    width: 100%; height: 1px;
    background: linear-gradient(90deg, var(--accent), transparent);
  }

  .stat-label {
    font-size: 10px;
    letter-spacing: 2px;
    text-transform: uppercase;
    color: var(--muted);
    font-family: 'Space Mono', monospace;
    margin-bottom: 12px;
  }

  .stat-value {
    font-size: 36px;
    font-weight: 800;
    color: var(--accent);
    line-height: 1;
  }

  /* ── Section header ── */
  .section-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 24px;
  }

  .section-title {
    font-size: 11px;
    letter-spacing: 3px;
    text-transform: uppercase;
    color: var(--muted);
    font-family: 'Space Mono', monospace;
  }

  /* ── New client form ── */
  .new-client-form {
    background: var(--surface);
    border: 1px solid var(--border);
    padding: 24px;
    margin-bottom: 24px;
    display: none;
  }

  .new-client-form.open { display: block; }

  .form-row {
    display: grid;
    grid-template-columns: 1fr 1fr auto;
    gap: 12px;
    align-items: end;
  }

  .form-group label {
    display: block;
    font-size: 10px;
    letter-spacing: 2px;
    color: var(--muted);
    font-family: 'Space Mono', monospace;
    margin-bottom: 8px;
    text-transform: uppercase;
  }

  /* ── Table ── */
  .table-wrap {
    background: var(--surface);
    border: 1px solid var(--border);
    overflow: hidden;
  }

  table { width: 100%; border-collapse: collapse; }

  th {
    text-align: left;
    padding: 14px 20px;
    font-size: 10px;
    letter-spacing: 2px;
    text-transform: uppercase;
    color: var(--muted);
    font-family: 'Space Mono', monospace;
    border-bottom: 1px solid var(--border);
    background: var(--bg);
  }

  td {
    padding: 16px 20px;
    font-size: 13px;
    border-bottom: 1px solid var(--border);
    vertical-align: middle;
  }

  tr:last-child td { border-bottom: none; }
  tr:hover td { background: #ffffff05; }

  .badge {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px;
    font-size: 11px;
    font-family: 'Space Mono', monospace;
    border-radius: 2px;
  }

  .badge-active { background: #00ff8820; color: var(--accent); }
  .badge-inactive { background: #ff335520; color: var(--danger); }

  .token-cell {
    font-family: 'Space Mono', monospace;
    font-size: 11px;
    color: var(--muted);
    max-width: 200px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    cursor: pointer;
  }

  .token-cell:hover { color: var(--text); }

  .actions { display: flex; gap: 8px; }

  /* ── Logs ── */
  .log-entry {
    background: var(--surface);
    border: 1px solid var(--border);
    border-left: 3px solid var(--accent);
    padding: 16px 20px;
    margin-bottom: 12px;
    font-family: 'Space Mono', monospace;
    font-size: 12px;
  }

  .log-entry.type-pago { border-left-color: var(--accent); }
  .log-entry.type-transferencia { border-left-color: var(--accent2); }
  .log-entry.type-desconocido { border-left-color: var(--muted); }

  .log-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 8px;
  }

  .log-amount { font-size: 20px; font-weight: 700; color: var(--accent); font-family: 'Syne', sans-serif; }
  .log-time { color: var(--muted); font-size: 11px; }
  .log-body { color: var(--muted); font-size: 11px; line-height: 1.6; }
  .log-client { color: var(--accent2); margin-bottom: 4px; }

  .empty {
    padding: 60px 20px;
    text-align: center;
    color: var(--muted);
    font-family: 'Space Mono', monospace;
    font-size: 12px;
  }

  /* ── Toast ── */
  #toast {
    position: fixed;
    bottom: 32px; right: 32px;
    background: var(--accent);
    color: #000;
    padding: 14px 24px;
    font-family: 'Space Mono', monospace;
    font-size: 12px;
    font-weight: 700;
    opacity: 0;
    transform: translateY(10px);
    transition: all 0.3s;
    pointer-events: none;
    z-index: 100;
  }

  #toast.show { opacity: 1; transform: translateY(0); }
  #toast.error { background: var(--danger); color: #fff; }

  .loading { color: var(--muted); font-family: 'Space Mono', monospace; font-size: 12px; padding: 40px; text-align: center; }
</style>
</head>
<body>

<!-- LOGIN -->
<div id="login-screen">
  <div class="login-box">
    <div class="logo">SynthesisOne</div>
    <h1 class="login-title">Panel de Control</h1>
    <p class="login-sub">Acceso restringido — solo administradores</p>
    <input type="password" id="secret-input" placeholder="Clave de administrador" />
    <button class="btn btn-primary" onclick="login()">Acceder →</button>
    <div class="error-msg" id="login-error">Clave incorrecta</div>
  </div>
</div>

<!-- DASHBOARD -->
<div id="dashboard">
  <header>
    <div class="header-logo">SynthesisOne / Admin</div>
    <div class="header-right">
      <div class="status-dot"></div>
      <span class="status-text">Sistema activo</span>
      <button class="btn btn-sm btn-red" onclick="logout()">Salir</button>
    </div>
  </header>

  <main>
    <div class="stats">
      <div class="stat-card">
        <div class="stat-label">Clientes activos</div>
        <div class="stat-value" id="stat-active">—</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Total clientes</div>
        <div class="stat-value" id="stat-total">—</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">SMS recibidos</div>
        <div class="stat-value" id="stat-sms">—</div>
      </div>
    </div>

    <div class="tabs">
      <div class="tab active" onclick="switchTab('clients')">Clientes</div>
      <div class="tab" onclick="switchTab('logs')">SMS Logs</div>
    </div>

    <!-- CLIENTES -->
    <div class="tab-content active" id="tab-clients">
      <div class="section-header">
        <span class="section-title">Licencias</span>
        <button class="btn btn-sm btn-green" onclick="toggleNewForm()">+ Nuevo cliente</button>
      </div>

      <div class="new-client-form" id="new-client-form">
        <div class="form-row">
          <div class="form-group">
            <label>Nombre del cliente</label>
            <input type="text" id="new-name" placeholder="Ej: Juan Pérez" />
          </div>
          <div class="form-group">
            <label>Webhook URL (opcional)</label>
            <input type="text" id="new-webhook" placeholder="https://..." />
          </div>
          <button class="btn btn-primary btn-sm" style="margin-top:0" onclick="createClient()">Crear</button>
        </div>
      </div>

      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Cliente</th>
              <th>Token</th>
              <th>Estado</th>
              <th>Creado</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody id="clients-tbody">
            <tr><td colspan="5"><div class="loading">Cargando...</div></td></tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- LOGS -->
    <div class="tab-content" id="tab-logs">
      <div class="section-header">
        <span class="section-title">SMS recibidos</span>
        <button class="btn btn-sm btn-blue" onclick="loadLogs()">↻ Actualizar</button>
      </div>
      <div id="logs-container"><div class="loading">Cargando...</div></div>
    </div>
  </main>
</div>

<div id="toast"></div>

<script>
  let ADMIN_SECRET = ''

  // ── Auth ──────────────────────────────────────────────────────────────────

  function login() {
    const secret = document.getElementById('secret-input').value.trim()
    if (!secret) return
    ADMIN_SECRET = secret
    fetch('/panel/api/clients', { headers: { 'x-admin-secret': secret } })
      .then(r => {
        if (r.status === 401) throw new Error('unauthorized')
        return r.json()
      })
      .then(() => {
        document.getElementById('login-screen').style.display = 'none'
        document.getElementById('dashboard').style.display = 'block'
        loadAll()
      })
      .catch(() => {
        document.getElementById('login-error').style.display = 'block'
        ADMIN_SECRET = ''
      })
  }

  function logout() {
    ADMIN_SECRET = ''
    document.getElementById('login-screen').style.display = 'flex'
    document.getElementById('dashboard').style.display = 'none'
    document.getElementById('secret-input').value = ''
  }

  document.getElementById('secret-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') login()
  })

  // ── API ───────────────────────────────────────────────────────────────────

  async function api(path, options = {}) {
    const res = await fetch('/panel/api' + path, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'x-admin-secret': ADMIN_SECRET,
        ...(options.headers || {})
      }
    })
    return res.json()
  }

  // ── Load ──────────────────────────────────────────────────────────────────

  async function loadAll() {
    await Promise.all([loadClients(), loadLogs()])
  }

  async function loadClients() {
    const clients = await api('/clients')
    updateStats(clients)
    renderClients(clients)
  }

  async function loadLogs() {
    const logs = await api('/logs?limit=50')
    renderLogs(logs)
    document.getElementById('stat-sms').textContent = Array.isArray(logs) ? logs.length : '—'
  }

  // ── Stats ─────────────────────────────────────────────────────────────────

  function updateStats(clients) {
    if (!Array.isArray(clients)) return
    document.getElementById('stat-total').textContent = clients.length
    document.getElementById('stat-active').textContent = clients.filter(c => c.active).length
  }

  // ── Render clients ────────────────────────────────────────────────────────

  function renderClients(clients) {
    const tbody = document.getElementById('clients-tbody')
    if (!Array.isArray(clients) || clients.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5"><div class="empty">Sin clientes aún. Crea el primero.</div></td></tr>'
      return
    }
    tbody.innerHTML = clients.map(c => \`
      <tr>
        <td><strong>\${c.name}</strong></td>
        <td>
          <div class="token-cell" onclick="copyToken('\${c.token}')" title="Click para copiar">
            \${c.token.slice(0, 16)}...\${c.token.slice(-8)}
          </div>
        </td>
        <td>
          <span class="badge \${c.active ? 'badge-active' : 'badge-inactive'}">
            \${c.active ? '● ACTIVO' : '○ INACTIVO'}
          </span>
        </td>
        <td style="color:var(--muted);font-family:'Space Mono',monospace;font-size:11px">
          \${new Date(c.created_at).toLocaleDateString('es')}
        </td>
        <td>
          <div class="actions">
            <button class="btn btn-sm \${c.active ? 'btn-red' : 'btn-green'}"
              onclick="toggleClient('\${c.id}')">
              \${c.active ? 'Desactivar' : 'Activar'}
            </button>
            <button class="btn btn-sm btn-blue" onclick="copyToken('\${c.token}')">Copiar token</button>
          </div>
        </td>
      </tr>
    \`).join('')
  }

  // ── Render logs ───────────────────────────────────────────────────────────

  function renderLogs(logs) {
    const container = document.getElementById('logs-container')
    if (!Array.isArray(logs) || logs.length === 0) {
      container.innerHTML = '<div class="empty">Sin SMS recibidos aún.</div>'
      return
    }
    container.innerHTML = logs.map(l => {
      const p = l.parsed || {}
      const type = p.type || 'desconocido'
      const amount = p.amount ? \`\${p.amount} \${p.currency || ''}\` : 'Monto no detectado'
      const time = new Date(l.created_at).toLocaleString('es')
      return \`
        <div class="log-entry type-\${type}">
          <div class="log-header">
            <div>
              <div class="log-client">\${l.clients?.name || 'Cliente desconocido'}</div>
              <div class="log-amount">\${amount}</div>
            </div>
            <div class="log-time">\${time}</div>
          </div>
          <div class="log-body">\${l.body}</div>
        </div>
      \`
    }).join('')
  }

  // ── Actions ───────────────────────────────────────────────────────────────

  async function toggleClient(id) {
    await api('/clients/' + id + '/toggle', { method: 'PUT' })
    toast('Estado actualizado')
    loadClients()
  }

  async function createClient() {
    const name = document.getElementById('new-name').value.trim()
    const webhook_url = document.getElementById('new-webhook').value.trim()
    if (!name) return toast('Nombre requerido', true)
    const client = await api('/clients', {
      method: 'POST',
      body: JSON.stringify({ name, webhook_url: webhook_url || null })
    })
    if (client.error) return toast(client.error, true)
    toast('Cliente creado — token copiado al portapapeles')
    copyToken(client.token, false)
    document.getElementById('new-name').value = ''
    document.getElementById('new-webhook').value = ''
    document.getElementById('new-client-form').classList.remove('open')
    loadClients()
  }

  function copyToken(token, notify = true) {
    navigator.clipboard.writeText(token)
    if (notify) toast('Token copiado')
  }

  function toggleNewForm() {
    document.getElementById('new-client-form').classList.toggle('open')
  }

  // ── Tabs ──────────────────────────────────────────────────────────────────

  function switchTab(name) {
    document.querySelectorAll('.tab').forEach((t, i) => {
      t.classList.toggle('active', ['clients','logs'][i] === name)
    })
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'))
    document.getElementById('tab-' + name).classList.add('active')
    if (name === 'logs') loadLogs()
  }

  // ── Toast ─────────────────────────────────────────────────────────────────

  function toast(msg, isError = false) {
    const t = document.getElementById('toast')
    t.textContent = msg
    t.className = 'show' + (isError ? ' error' : '')
    setTimeout(() => t.className = '', 3000)
  }
</script>
</body>
</html>`

module.exports = router
