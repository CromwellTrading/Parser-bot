const express = require('express')
const router = express.Router()
const crypto = require('crypto')
const supabase = require('../supabase')

// Middleware: solo tú puedes acceder al panel admin
function adminAuth(req, res, next) {
  const secret = req.headers['x-admin-secret']
  if (secret !== process.env.ADMIN_SECRET) {
    return res.status(401).json({ error: 'No autorizado' })
  }
  next()
}

router.use(adminAuth)

/**
 * GET /api/admin/clients
 * Lista todos los clientes con su estado
 */
router.get('/clients', async (req, res) => {
  const { data, error } = await supabase
    .from('clients')
    .select('id, name, token, active, webhook_url, created_at, expires_at')
    .order('created_at', { ascending: false })

  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

/**
 * POST /api/admin/clients
 * Crear nuevo cliente y generar token único
 * Body: { name, webhook_url (opcional), expires_at (opcional) }
 */
router.post('/clients', async (req, res) => {
  const { name, webhook_url, expires_at } = req.body

  if (!name) return res.status(400).json({ error: 'Nombre requerido' })

  // Generar token único de 32 bytes
  const token = crypto.randomBytes(32).toString('hex')

  const { data, error } = await supabase
    .from('clients')
    .insert({ name, token, webhook_url, expires_at })
    .select()
    .single()

  if (error) return res.status(500).json({ error: error.message })

  console.log(`✅ Cliente creado: ${name} | Token: ${token}`)
  res.status(201).json(data)
})

/**
 * PUT /api/admin/clients/:id/toggle
 * Activar o desactivar un cliente
 */
router.put('/clients/:id/toggle', async (req, res) => {
  const { id } = req.params

  // Obtener estado actual
  const { data: client, error: fetchError } = await supabase
    .from('clients')
    .select('active, name')
    .eq('id', id)
    .single()

  if (fetchError || !client) return res.status(404).json({ error: 'Cliente no encontrado' })

  // Invertir estado
  const { data, error } = await supabase
    .from('clients')
    .update({ active: !client.active })
    .eq('id', id)
    .select()
    .single()

  if (error) return res.status(500).json({ error: error.message })

  console.log(`🔄 Cliente "${client.name}" → ${data.active ? 'ACTIVO' : 'INACTIVO'}`)
  res.json(data)
})

/**
 * DELETE /api/admin/clients/:id
 * Eliminar cliente
 */
router.delete('/clients/:id', async (req, res) => {
  const { id } = req.params

  const { error } = await supabase
    .from('clients')
    .delete()
    .eq('id', id)

  if (error) return res.status(500).json({ error: error.message })
  res.json({ ok: true })
})

/**
 * GET /api/admin/logs
 * Ver SMS recibidos (con filtro opcional por cliente)
 */
router.get('/logs', async (req, res) => {
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

module.exports = router
