const express = require('express')
const router = express.Router()
const crypto = require('crypto')
const supabase = require('../supabase')

router.get('/', (req, res) => res.send(PANEL_HTML))

function adminAuth(req, res, next) {
  const secret = req.headers['x-admin-secret']
  if (secret !== process.env.ADMIN_SECRET) return res.status(401).json({ error: 'No autorizado' })
  next()
}

router.use('/api', adminAuth)

// ── Clients CRUD ──────────────────────────────────────────────────────────────

router.get('/api/clients', async (req, res) => {
  const { data, error } = await supabase
    .from('clients')
    .select('id, name, token, active, token_used, webhook_url, webhook_url_2, webhook_url_3, phone_number, card1, card2, card3, wallet, device_id, created_at, expires_at')
    .order('created_at', { ascending: false })
  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

router.post('/api/clients', async (req, res) => {
  const { name, webhook_url, webhook_url_2, webhook_url_3, phone_number, card1, card2, card3, wallet, device_id, expires_at, plan, expires_in_days } = req.body
  if (!name) return res.status(400).json({ error: 'Nombre requerido' })
  const token = crypto.randomBytes(32).toString('hex')
  const days = Number.isFinite(Number(expires_in_days)) ? Number(expires_in_days) : (plan === 'trial' ? 3 : 30)
  const defaultExpiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString()
  const payload = {
    name,
    token,
    webhook_url: webhook_url || null,
    webhook_url_2: webhook_url_2 || null,
    webhook_url_3: webhook_url_3 || null,
    phone_number: phone_number || null,
    card1: card1 || null,
    card2: card2 || null,
    card3: card3 || null,
    wallet: wallet || null,
    device_id: device_id || null,
    expires_at: expires_at || defaultExpiresAt,
    active: true,
    token_used: false,
  }
  const { data, error } = await supabase
    .from('clients').insert(payload).select().single()
  if (error) return res.status(500).json({ error: error.message })
  res.status(201).json(data)
})

router.put('/api/clients/:id/toggle', async (req, res) => {
  const { data: client } = await supabase.from('clients').select('active').eq('id', req.params.id).single()
  if (!client) return res.status(404).json({ error: 'No encontrado' })
  const { data, error } = await supabase.from('clients').update({ active: !client.active }).eq('id', req.params.id).select().single()
  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

router.put('/api/clients/:id/webhooks', async (req, res) => {
  const { webhook_url, webhook_url_2, webhook_url_3 } = req.body
  const { data, error } = await supabase
    .from('clients')
    .update({ webhook_url: webhook_url || null, webhook_url_2: webhook_url_2 || null, webhook_url_3: webhook_url_3 || null })
    .eq('id', req.params.id).select().single()
  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

router.put('/api/clients/:id/profile', async (req, res) => {
  const { phone_number, card1, card2, card3, wallet, device_id } = req.body
  const patch = {
    phone_number: phone_number || null,
    card1: card1 || null,
    card2: card2 || null,
    card3: card3 || null,
    wallet: wallet || null,
    device_id: device_id || null,
  }
  const { data, error } = await supabase
    .from('clients')
    .update(patch)
    .eq('id', req.params.id).select().single()
  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

router.put('/api/clients/:id/renew-token', async (req, res) => {
  const newToken = crypto.randomBytes(32).toString('hex')
  const expiresInDays = Number.isFinite(Number(req.body?.expires_in_days)) ? Number(req.body.expires_in_days) : 30
  const expiresAt = req.body?.expires_at || new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000).toISOString()
  const { data, error } = await supabase
    .from('clients')
    .update({ token: newToken, token_used: false, device_id: null, expires_at: expiresAt })
    .eq('id', req.params.id).select().single()
  if (error) return res.status(500).json({ error: error.message })
  console.log(`🔄 Token renovado para cliente ${data.name}`)
  res.json(data)
})

router.delete('/api/clients/:id', async (req, res) => {
  await supabase.from('sms_logs').delete().eq('client_id', req.params.id)
  const { error } = await supabase.from('clients').delete().eq('id', req.params.id)
  if (error) return res.status(500).json({ error: error.message })
  res.json({ ok: true })
})

router.get('/api/logs', async (req, res) => {
  const { client_id, limit = 50 } = req.query
  let query = supabase
    .from('sms_logs').select('*, clients(name)')
    .order('created_at', { ascending: false }).limit(parseInt(limit))
  if (client_id) query = query.eq('client_id', client_id)
  const { data, error } = await query
  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

// ── Auth verify (used by Android app) ────────────────────────────────────────

router.post('/api/auth/verify', async (req, res) => {
  const { token } = req.body
  if (!token) return res.status(400).json({ error: 'Token requerido' })
  const { data, error } = await supabase
    .from('clients').select('id, active, token_used').eq('token', token).single()
  if (error || !data) return res.status(401).json({ error: 'Token inválido' })
  if (!data.active) return res.status(403).json({ error: 'Licencia inactiva' })
  if (data.token_used) return res.status(403).json({ error: 'Token en uso' })
  await supabase.from('clients').update({ token_used: true }).eq('token', token)
  res.status(200).json({ ok: true })
})

// ── HTML ──────────────────────────────────────────────────────────────────────

const PANEL_HTML = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>SynthesisOne</title>
<link href="https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=Syne:wght@400;600;800&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}
:root{
  --bg:#0a0a0f;--surface:#111118;--surface2:#1a1a24;--border:#1e1e2e;
  --red:#cc0033;--purple:#7b2fbe;--green:#00c853;--error:#ff1744;
  --text:#e8e8f0;--muted:#555570;--text2:#9999bb;
}
body{background:var(--bg);color:var(--text);font-family:'Syne',sans-serif;min-height:100vh}

/* LOGIN */
#login{min-height:100vh;display:flex;align-items:center;justify-content:center;
  background:radial-gradient(ellipse at 50% 0%,#cc003318 0%,transparent 60%)}
.login-box{width:100%;max-width:420px;padding:48px 40px;background:var(--surface);
  border:1px solid var(--border);position:relative}
.login-box::before{content:'';position:absolute;top:0;left:0;right:0;height:2px;
  background:linear-gradient(90deg,var(--red),var(--purple))}
.logo{font-size:10px;letter-spacing:4px;color:var(--red);font-family:'Space Mono',monospace;margin-bottom:28px}
.login-box h1{font-size:26px;font-weight:800;margin-bottom:6px}
.login-box p{color:var(--muted);font-size:14px;margin-bottom:32px}
input{width:100%;background:var(--bg);border:1px solid var(--border);color:var(--text);
  padding:14px 16px;font-family:'Space Mono',monospace;font-size:13px;outline:none;
  transition:border-color .2s;border-radius:4px}
input:focus{border-color:var(--red)}
input::placeholder{color:var(--muted)}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;
  padding:13px 24px;font-family:'Syne',sans-serif;font-weight:700;font-size:13px;
  cursor:pointer;border:none;border-radius:4px;transition:all .2s;letter-spacing:.5px}
.btn-primary{background:linear-gradient(90deg,var(--red),var(--purple));color:#fff;width:100%;margin-top:14px}
.btn-primary:hover{opacity:.9}
.btn-primary:disabled{opacity:.5;cursor:not-allowed}
.btn-sm{padding:7px 14px;font-size:11px;font-family:'Space Mono',monospace}
.btn-green{background:#00c85322;color:var(--green);border:1px solid #00c85344}
.btn-green:hover{background:#00c85333}
.btn-red{background:#ff174422;color:var(--error);border:1px solid #ff174444}
.btn-red:hover{background:#ff174433}
.btn-blue{background:#0088ff22;color:#4db8ff;border:1px solid #0088ff44}
.btn-blue:hover{background:#0088ff33}
.btn-purple{background:#7b2fbe22;color:var(--purple);border:1px solid #7b2fbe44}
.btn-purple:hover{background:#7b2fbe33}
.err{color:var(--error);font-size:12px;font-family:'Space Mono',monospace;margin-top:10px;display:none}

/* DASHBOARD */
#dash{display:none}
header{background:var(--surface);border-bottom:1px solid var(--border);
  padding:16px 24px;display:flex;align-items:center;justify-content:space-between;
  position:sticky;top:0;z-index:10}
.h-logo{font-size:10px;letter-spacing:3px;color:var(--red);font-family:'Space Mono',monospace}
.h-right{display:flex;align-items:center;gap:12px}
.dot{width:8px;height:8px;border-radius:50%;background:var(--green);
  box-shadow:0 0 8px var(--green);animation:pulse 2s infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
.dot-label{font-size:11px;color:var(--muted);font-family:'Space Mono',monospace}

main{padding:24px;max-width:1100px;margin:0 auto}

/* TABS */
.tabs{display:flex;border-bottom:1px solid var(--border);margin-bottom:28px}
.tab{padding:12px 20px;font-size:11px;font-weight:700;letter-spacing:1.5px;
  text-transform:uppercase;color:var(--muted);cursor:pointer;
  border-bottom:2px solid transparent;transition:all .2s}
.tab.on{color:var(--red);border-bottom-color:var(--red)}

/* STATS */
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:14px;margin-bottom:28px}
.stat{background:var(--surface);border:1px solid var(--border);padding:20px 18px;position:relative;border-radius:4px}
.stat::after{content:'';position:absolute;bottom:0;left:0;right:0;height:2px;
  background:linear-gradient(90deg,var(--red),transparent)}
.stat-label{font-size:9px;letter-spacing:2px;color:var(--muted);font-family:'Space Mono',monospace;margin-bottom:10px;text-transform:uppercase}
.stat-val{font-size:32px;font-weight:800;color:var(--red)}

/* SECTION */
.sec-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:18px;flex-wrap:wrap;gap:10px}
.sec-title{font-size:10px;letter-spacing:2px;color:var(--muted);font-family:'Space Mono',monospace;text-transform:uppercase}

/* FORM */
.form-panel{background:var(--surface);border:1px solid var(--border);border-radius:4px;
  padding:20px;margin-bottom:20px;display:none}
.form-panel.open{display:block}
.form-row{display:grid;grid-template-columns:1fr auto;gap:12px;align-items:end}
@media(max-width:600px){.form-row{grid-template-columns:1fr}}
label{display:block;font-size:9px;letter-spacing:2px;color:var(--muted);
  font-family:'Space Mono',monospace;margin-bottom:6px;text-transform:uppercase}

/* TABLE */
.tbl-wrap{background:var(--surface);border:1px solid var(--border);border-radius:4px;overflow:hidden;overflow-x:auto}
table{width:100%;border-collapse:collapse;min-width:600px}
th{text-align:left;padding:12px 16px;font-size:9px;letter-spacing:2px;color:var(--muted);
  font-family:'Space Mono',monospace;border-bottom:1px solid var(--border);background:var(--bg);text-transform:uppercase}
td{padding:14px 16px;font-size:13px;border-bottom:1px solid var(--border);vertical-align:middle}
tr:last-child td{border-bottom:none}
tr:hover td{background:#ffffff04}
.badge{display:inline-flex;align-items:center;gap:5px;padding:3px 9px;
  font-size:10px;font-family:'Space Mono',monospace;border-radius:2px}
.badge-on{background:#00c85320;color:var(--green)}
.badge-off{background:#ff174420;color:var(--error)}
.badge-used{background:#7b2fbe20;color:var(--purple)}
.token-cell{font-family:'Space Mono',monospace;font-size:11px;color:var(--muted);
  cursor:pointer;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.token-cell:hover{color:var(--text)}
.acts{display:flex;gap:6px;flex-wrap:wrap}

/* MODAL */
.modal-bg{position:fixed;inset:0;background:#000000cc;display:flex;align-items:center;
  justify-content:center;z-index:100;display:none;padding:16px}
.modal-bg.open{display:flex}
.modal{background:var(--surface);border:1px solid var(--border);border-radius:4px;
  padding:28px;width:100%;max-width:480px;position:relative}
.modal::before{content:'';position:absolute;top:0;left:0;right:0;height:2px;
  background:linear-gradient(90deg,var(--red),var(--purple))}
.modal h3{font-size:18px;font-weight:800;margin-bottom:20px}
.modal-footer{display:flex;gap:10px;margin-top:20px;flex-wrap:wrap}
.inp-group{margin-bottom:14px}

/* LOGS */
.log-card{background:var(--surface);border:1px solid var(--border);border-radius:4px;
  border-left:3px solid var(--red);padding:16px 18px;margin-bottom:10px}
.log-card.enviado{border-left-color:var(--purple)}
.log-card.desconocido{border-left-color:var(--muted)}
.log-top{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:8px;flex-wrap:wrap}
.log-amount{font-size:22px;font-weight:800;color:var(--red)}
.log-amount.enviado{color:var(--purple)}
.log-time{font-size:11px;color:var(--muted);font-family:'Space Mono',monospace}
.log-client{font-size:11px;color:#4db8ff;font-family:'Space Mono',monospace;margin-bottom:4px}
.log-type{font-size:10px;color:var(--muted);font-family:'Space Mono',monospace;margin-bottom:8px}
.log-body{font-size:12px;color:var(--text2);line-height:1.6;font-family:'Space Mono',monospace}
.empty{padding:48px 20px;text-align:center;color:var(--muted);font-family:'Space Mono',monospace;font-size:12px}

/* TOAST */
#toast{position:fixed;bottom:24px;right:24px;background:var(--green);color:#000;
  padding:12px 20px;font-family:'Space Mono',monospace;font-size:12px;font-weight:700;
  opacity:0;transform:translateY(8px);transition:all .3s;pointer-events:none;z-index:200;border-radius:4px}
#toast.show{opacity:1;transform:translateY(0)}
#toast.err{background:var(--error);color:#fff}

.loading{color:var(--muted);font-family:'Space Mono',monospace;font-size:12px;padding:40px;text-align:center}
</style>
</head>
<body>

<!-- LOGIN -->
<div id="login">
  <div class="login-box">
    <div class="logo">SYNTHESISONE</div>
    <h1>Panel Admin</h1>
    <p>Acceso restringido</p>
    <input type="password" id="sec-in" placeholder="Clave de administrador" />
    <button class="btn btn-primary" onclick="login()">Acceder →</button>
    <div class="err" id="login-err">Clave incorrecta</div>
  </div>
</div>

<!-- DASHBOARD -->
<div id="dash">
  <header>
    <div class="h-logo">SYNTHESISONE / ADMIN</div>
    <div class="h-right">
      <div class="dot"></div>
      <span class="dot-label">Online</span>
      <button class="btn btn-sm btn-red" onclick="logout()">Salir</button>
    </div>
  </header>

  <main>
    <div class="stats">
      <div class="stat"><div class="stat-label">Activos</div><div class="stat-val" id="s-active">—</div></div>
      <div class="stat"><div class="stat-label">Total</div><div class="stat-val" id="s-total">—</div></div>
      <div class="stat"><div class="stat-label">SMS hoy</div><div class="stat-val" id="s-sms">—</div></div>
    </div>

    <div class="tabs">
      <div class="tab on" onclick="tab('clients')">Clientes</div>
      <div class="tab" onclick="tab('logs')">SMS Logs</div>
    </div>

    <!-- CLIENTES -->
    <div id="tab-clients">
      <div class="sec-head">
        <span class="sec-title">Licencias</span>
        <button class="btn btn-sm btn-green" onclick="toggleForm()">+ Nuevo</button>
      </div>

      <div class="form-panel" id="new-form">
        <div class="form-row">
          <div class="inp-group" style="margin:0">
            <label>Nombre del cliente</label>
            <input type="text" id="new-name" placeholder="Ej: Juan Pérez" />
          </div>
          <button class="btn btn-primary btn-sm" style="margin:0;width:auto" onclick="createClient()">Crear</button>
        </div>
      </div>

      <div class="tbl-wrap">
        <table>
          <thead><tr>
            <th>Cliente</th><th>Token</th><th>Estado</th><th>Token</th><th>Creado</th><th>Acciones</th>
          </tr></thead>
          <tbody id="clients-tb"><tr><td colspan="6"><div class="loading">Cargando...</div></td></tr></tbody>
        </table>
      </div>
    </div>

    <!-- LOGS -->
    <div id="tab-logs" style="display:none">
      <div class="sec-head">
        <span class="sec-title">SMS Recibidos</span>
        <button class="btn btn-sm btn-blue" onclick="loadLogs()">↻ Actualizar</button>
      </div>
      <div id="logs-cont"><div class="loading">Cargando...</div></div>
    </div>
  </main>
</div>

<!-- MODAL WEBHOOKS -->
<div class="modal-bg" id="wh-modal">
  <div class="modal">
    <h3>Webhooks del cliente</h3>
    <input type="hidden" id="wh-client-id" />
    <div class="inp-group"><label>Webhook 1</label><input type="url" id="wh-1" placeholder="https://..." /></div>
    <div class="inp-group"><label>Webhook 2 (opcional)</label><input type="url" id="wh-2" placeholder="https://..." /></div>
    <div class="inp-group"><label>Webhook 3 (opcional)</label><input type="url" id="wh-3" placeholder="https://..." /></div>
    <div class="modal-footer">
      <button class="btn btn-primary btn-sm" style="width:auto" onclick="saveWebhooks()">Guardar</button>
      <button class="btn btn-sm btn-red" onclick="closeModal('wh-modal')">Cancelar</button>
    </div>
  </div>
</div>

<!-- MODAL INFO CLIENTE -->
<div class="modal-bg" id="info-modal">
  <div class="modal">
    <h3 id="info-name"></h3>
    <div id="info-body" style="font-family:'Space Mono',monospace;font-size:12px;line-height:1.8;color:var(--text2)"></div>
    <div class="modal-footer">
      <button class="btn btn-sm btn-red" onclick="closeModal('info-modal')">Cerrar</button>
    </div>
  </div>
</div>

<div id="toast"></div>

<script>
let SECRET = ''

// ── Auth ──────────────────────────────────────────────────────────────────────
function login() {
  const s = document.getElementById('sec-in').value.trim()
  if (!s) return
  SECRET = s
  api('/clients').then(r => {
    if (r.error) { document.getElementById('login-err').style.display='block'; SECRET=''; return }
    document.getElementById('login').style.display='none'
    document.getElementById('dash').style.display='block'
    loadAll()
  })
}
function logout() {
  SECRET=''
  document.getElementById('login').style.display='flex'
  document.getElementById('dash').style.display='none'
  document.getElementById('sec-in').value=''
}
document.getElementById('sec-in').addEventListener('keydown', e => { if(e.key==='Enter') login() })

// ── API ───────────────────────────────────────────────────────────────────────
async function api(path, opts={}) {
  const r = await fetch('/panel/api'+path, {
    ...opts,
    headers:{'Content-Type':'application/json','x-admin-secret':SECRET,...(opts.headers||{})}
  })
  return r.json()
}

// ── Load ──────────────────────────────────────────────────────────────────────
async function loadAll() { await Promise.all([loadClients(), loadLogs()]) }

async function loadClients() {
  const clients = await api('/clients')
  if (!Array.isArray(clients)) return
  document.getElementById('s-total').textContent = clients.length
  document.getElementById('s-active').textContent = clients.filter(c=>c.active).length
  renderClients(clients)
}

async function loadLogs() {
  const logs = await api('/logs?limit=100')
  document.getElementById('s-sms').textContent = Array.isArray(logs) ? logs.length : '—'
  renderLogs(logs)
}

// ── Clients ───────────────────────────────────────────────────────────────────
function renderClients(clients) {
  const tb = document.getElementById('clients-tb')
  if (!clients.length) { tb.innerHTML='<tr><td colspan="6"><div class="empty">Sin clientes</div></td></tr>'; return }
  tb.innerHTML = clients.map(c => \`
    <tr>
      <td><strong>\${c.name}</strong></td>
      <td><div class="token-cell" onclick="copyT('\${c.token}')" title="Click para copiar">\${c.token.slice(0,12)}...</div></td>
      <td><span class="badge \${c.active?'badge-on':'badge-off'}">\${c.active?'● ACTIVO':'○ INACTIVO'}</span></td>
      <td><span class="badge \${c.token_used?'badge-used':'badge-on'}">\${c.token_used?'EN USO':'LIBRE'}</span></td>
      <td style="font-family:'Space Mono',monospace;font-size:11px;color:var(--muted)">\${new Date(c.created_at).toLocaleDateString('es')}</td>
      <td>
        <div class="acts">
          <button class="btn btn-sm \${c.active?'btn-red':'btn-green'}" onclick="toggle('\${c.id}')">\${c.active?'Desactivar':'Activar'}</button>
          <button class="btn btn-sm btn-blue" onclick="openWebhooks(\${JSON.stringify(c).replace(/"/g,'&quot;')})">Webhooks</button>
          <button class="btn btn-sm btn-purple" onclick="renewToken('\${c.id}','\${c.name}')">↺ Token</button>
          <button class="btn btn-sm btn-blue" onclick="showInfo(\${JSON.stringify(c).replace(/"/g,'&quot;')})">Info</button>
          <button class="btn btn-sm btn-red" onclick="deleteClient('\${c.id}','\${c.name}')">Eliminar</button>
        </div>
      </td>
    </tr>
  \`).join('')
}

async function createClient() {
  const name = document.getElementById('new-name').value.trim()
  if (!name) return toast('Nombre requerido', true)
  const c = await api('/clients', { method:'POST', body: JSON.stringify({ name }) })
  if (c.error) return toast(c.error, true)
  copyT(c.token, false)
  toast('Cliente creado — token copiado')
  document.getElementById('new-name').value=''
  document.getElementById('new-form').classList.remove('open')
  loadClients()
}

async function toggle(id) {
  await api('/clients/'+id+'/toggle', {method:'PUT'})
  toast('Estado actualizado')
  loadClients()
}

async function renewToken(id, name) {
  if (!confirm(\`¿Renovar token de "\${name}"? El usuario deberá activar de nuevo con el nuevo token.\`)) return
  const c = await api('/clients/'+id+'/renew-token', {method:'PUT'})
  if (c.error) return toast(c.error, true)
  copyT(c.token, false)
  toast('Token renovado — nuevo token copiado')
  loadClients()
}

async function deleteClient(id, name) {
  if (!confirm(\`¿Eliminar "\${name}" y todos sus SMS? Esta acción no se puede deshacer.\`)) return
  const r = await api('/clients/'+id, {method:'DELETE'})
  if (r.error) return toast(r.error, true)
  toast('Cliente eliminado')
  loadClients()
}

function showInfo(c) {
  document.getElementById('info-name').textContent = c.name
  const cards = [c.card1, c.card2, c.card3].filter(Boolean)
  document.getElementById('info-body').innerHTML = \`
    <div>📱 Monedero: \${c.wallet || c.phone_number || '—'}</div>
    <div>💳 Tarjetas: \${cards.length ? cards.join(', ') : '—'}</div>
    <div>🔗 Webhook 1: \${c.webhook_url || '—'}</div>
    <div>🔗 Webhook 2: \${c.webhook_url_2 || '—'}</div>
    <div>🔗 Webhook 3: \${c.webhook_url_3 || '—'}</div>
    <div>🆔 Dispositivo: \${c.device_id || '—'}</div>
    <div>📅 Creado: \${new Date(c.created_at).toLocaleString('es')}</div>
    <div>⏳ Vence: \${c.expires_at ? new Date(c.expires_at).toLocaleDateString('es') : 'Sin límite'}</div>
  \`
  document.getElementById('info-modal').classList.add('open')
}

// ── Webhooks modal ────────────────────────────────────────────────────────────
function openWebhooks(c) {
  document.getElementById('wh-client-id').value = c.id
  document.getElementById('wh-1').value = c.webhook_url || ''
  document.getElementById('wh-2').value = c.webhook_url_2 || ''
  document.getElementById('wh-3').value = c.webhook_url_3 || ''
  document.getElementById('wh-modal').classList.add('open')
}

async function saveWebhooks() {
  const id = document.getElementById('wh-client-id').value
  const r = await api('/clients/'+id+'/webhooks', {
    method:'PUT',
    body: JSON.stringify({
      webhook_url: document.getElementById('wh-1').value.trim(),
      webhook_url_2: document.getElementById('wh-2').value.trim(),
      webhook_url_3: document.getElementById('wh-3').value.trim()
    })
  })
  if (r.error) return toast(r.error, true)
  toast('Webhooks guardados')
  closeModal('wh-modal')
  loadClients()
}

function closeModal(id) { document.getElementById(id).classList.remove('open') }

// ── Logs ──────────────────────────────────────────────────────────────────────
function renderLogs(logs) {
  const cont = document.getElementById('logs-cont')
  if (!Array.isArray(logs) || !logs.length) { cont.innerHTML='<div class="empty">Sin SMS recibidos aún</div>'; return }
  cont.innerHTML = logs.map(l => {
    const p = l.parsed || {}
    const incoming = p.direction === 'RECIBIDO'
    const amount = p.amount ? \`\${p.amount} \${p.currency||''}\` : 'Monto no detectado'
    const typeLabel = p.type ? p.type.replace(/_/g,' ') : 'DESCONOCIDO'
    return \`
      <div class="log-card \${incoming?'':'enviado'}">
        <div class="log-client">\${l.clients?.name||'—'}</div>
        <div class="log-top">
          <div>
            <div class="log-amount \${incoming?'':'enviado'}">\${incoming?'↓ ':'↑ '}\${amount}</div>
            <div class="log-type">\${typeLabel}</div>
          </div>
          <div class="log-time">\${new Date(l.created_at).toLocaleString('es')}</div>
        </div>
        <div class="log-body">\${l.body}</div>
      </div>
    \`
  }).join('')
}

// ── Tabs ──────────────────────────────────────────────────────────────────────
function tab(name) {
  document.querySelectorAll('.tab').forEach((t,i)=>t.classList.toggle('on',['clients','logs'][i]===name))
  document.getElementById('tab-clients').style.display = name==='clients'?'block':'none'
  document.getElementById('tab-logs').style.display = name==='logs'?'block':'none'
  if (name==='logs') loadLogs()
}

function toggleForm() { document.getElementById('new-form').classList.toggle('open') }

// ── Utils ─────────────────────────────────────────────────────────────────────
function copyT(t, notify=true) {
  navigator.clipboard.writeText(t)
  if (notify) toast('Token copiado')
}

function toast(msg, isErr=false) {
  const t = document.getElementById('toast')
  t.textContent=msg; t.className='show'+(isErr?' err':'')
  setTimeout(()=>t.className='',3000)
}
</script>
</body>
</html>`

module.exports = router
