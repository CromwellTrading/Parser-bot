const express = require('express')
const router = express.Router()
const crypto = require('crypto')
const supabase = require('../supabase')

function adminAuth(req, res, next) {
  const secret = req.headers['x-admin-secret']
  if (secret !== process.env.ADMIN_SECRET) {
    return res.status(401).json({ error: 'No autorizado' })
  }
  next()
}

router.use(adminAuth)

router.get('/clients', async (req, res) => {
  const { data, error } = await supabase
    .from('clients')
    .select('id, name, token, active, token_used, webhook_url, webhook_url_2, webhook_url_3, phone_number, card1, card2, card3, wallet, device_id, created_at, expires_at')
    .order('created_at', { ascending: false })

  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

router.post('/clients', async (req, res) => {
  const { name, webhook_url, webhook_url_2, webhook_url_3, phone_number, card1, card2, card3, wallet, device_id, expires_at, plan, expires_in_days } = req.body

  if (!name) return res.status(400).json({ error: 'Nombre requerido' })

  const token = crypto.randomBytes(32).toString('hex')
  const days = Number.isFinite(Number(expires_in_days)) ? Number(expires_in_days) : (plan === 'trial' ? 3 : 30)
  const defaultExpiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString()

  const { data, error } = await supabase
    .from('clients')
    .insert({
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
    })
    .select()
    .single()

  if (error) return res.status(500).json({ error: error.message })
  console.log(`✅ Cliente creado: ${name} | Token: ${token}`)
  res.status(201).json(data)
})

router.put('/clients/:id/toggle', async (req, res) => {
  const { data: client, error: fetchError } = await supabase
    .from('clients')
    .select('active, name')
    .eq('id', req.params.id)
    .single()

  if (fetchError || !client) return res.status(404).json({ error: 'Cliente no encontrado' })

  const { data, error } = await supabase
    .from('clients')
    .update({ active: !client.active })
    .eq('id', req.params.id)
    .select()
    .single()

  if (error) return res.status(500).json({ error: error.message })
  console.log(`🔄 Cliente "${client.name}" → ${data.active ? 'ACTIVO' : 'INACTIVO'}`)
  res.json(data)
})

router.put('/clients/:id/profile', async (req, res) => {
  const { phone_number, card1, card2, card3, wallet, device_id } = req.body

  const { data, error } = await supabase
    .from('clients')
    .update({
      phone_number: phone_number || null,
      card1: card1 || null,
      card2: card2 || null,
      card3: card3 || null,
      wallet: wallet || null,
      device_id: device_id || null,
    })
    .eq('id', req.params.id)
    .select()
    .single()

  if (error) return res.status(500).json({ error: error.message })
  res.json(data)
})

router.put('/clients/:id/renew-token', async (req, res) => {
  const newToken = crypto.randomBytes(32).toString('hex')
  const expiresInDays = Number.isFinite(Number(req.body?.expires_in_days)) ? Number(req.body.expires_in_days) : 30
  const expiresAt = req.body?.expires_at || new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000).toISOString()

  const { data, error } = await supabase
    .from('clients')
    .update({ token: newToken, token_used: false, device_id: null, expires_at: expiresAt })
    .eq('id', req.params.id)
    .select()
    .single()

  if (error) return res.status(500).json({ error: error.message })
  console.log(`🔄 Token renovado para cliente ${data.name}`)
  res.json(data)
})

router.delete('/clients/:id', async (req, res) => {  // ← RUTA CORREGIDA
  try {
    // 1. Obtener el token del cliente
    const { data: client } = await supabase
      .from('clients')
      .select('token')
      .eq('id', req.params.id)
      .single();

    // 2. Invalidar el token (guardarlo en blacklist)
    if (client?.token) {
      const { error: blacklistError } = await supabase
        .from('token_blacklist')
        .insert({ token: client.token, invalidated_at: new Date().toISOString() });
      
      if (blacklistError) {
        console.error('Error al invalidar token:', blacklistError);
      } else {
        console.log(`✅ Token invalidado para cliente ${req.params.id}`);
      }
    }

    // 3. Eliminar logs del cliente
    await supabase
      .from('sms_logs')
      .delete()
      .eq('client_id', req.params.id);

    // 4. Eliminar el cliente
    const { error: deleteError } = await supabase
      .from('clients')
      .delete()
      .eq('id', req.params.id);

    if (deleteError) throw deleteError;

    console.log(`✅ Cliente ${req.params.id} eliminado correctamente`);
    res.json({ ok: true, message: 'Cliente eliminado y token invalidado' });
  } catch (error) {
    console.error('Error al eliminar cliente:', error);
    res.status(500).json({ error: error.message });
  }
});

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
