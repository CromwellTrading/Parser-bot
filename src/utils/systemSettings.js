const supabase = require('../supabase')

const DEFAULT_AUTOMATION = {
  enabled: true,
  message: 'La automatización está disponible.',
  updated_at: null,
}

async function getAutomationAvailability() {
  const { data, error } = await supabase
    .from('synthesisone_settings')
    .select('value, updated_at')
    .eq('key', 'automation_availability')
    .maybeSingle()

  if (error) {
    // Fail closed: if the setting cannot be read, do not tell users to pay.
    console.error('No se pudo leer automation_availability:', error.message)
    return {
      enabled: false,
      message: 'No se pudo comprobar la disponibilidad automática. Inténtalo más tarde.',
      updated_at: null,
      config_error: true,
    }
  }

  const value = data?.value && typeof data.value === 'object' ? data.value : DEFAULT_AUTOMATION
  return {
    enabled: value.enabled !== false,
    message: String(value.message || (value.enabled === false ? 'La automatización está temporalmente desactivada.' : 'La automatización está disponible.')),
    updated_at: data?.updated_at || null,
    config_error: false,
  }
}

async function setAutomationAvailability({ enabled, message }) {
  const value = {
    enabled: Boolean(enabled),
    message: String(message || '').trim().slice(0, 500) || (enabled ? 'La automatización está disponible.' : 'La automatización está temporalmente desactivada.'),
  }
  const { data, error } = await supabase
    .from('synthesisone_settings')
    .upsert({ key: 'automation_availability', value, updated_at: new Date().toISOString() }, { onConflict: 'key' })
    .select('value, updated_at')
    .single()
  if (error) throw error
  return {
    enabled: data.value?.enabled !== false,
    message: String(data.value?.message || ''),
    updated_at: data.updated_at || null,
    config_error: false,
  }
}

module.exports = { getAutomationAvailability, setAutomationAvailability }
