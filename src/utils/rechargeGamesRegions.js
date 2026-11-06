'use strict'

function slugifyRegion(value) {
  return String(value ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .trim().toLowerCase().replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

const REGION_ALIASES = Object.freeze({
  latam: 'LATAM',
  'latin-america': 'LATAM',
  'latin-america-latam': 'LATAM',
  brazil: 'Brazil',
  br: 'Brazil',
  eu: 'EU',
  europe: 'EU',
  'europe-eu': 'EU',
  mena: 'MENA',
  'middle-east-north-africa-mena': 'MENA',
  cis: 'CIS',
  global: 'Global',
  bangladesh: 'Bangladesh',
  bd: 'Bangladesh',
  pakistan: 'Pakistan',
  indonesia: 'Indonesia',
  vietnam: 'Vietnam',
  philippines: 'Philippines',
  taiwan: 'Taiwan',
  thailand: 'Thailand',
  'singapore-malaysia': 'Singapore / Malaysia',
  'singapore-malaysia-sg-my': 'Singapore / Malaysia',
  'sg-my-kh-first-recharge-bonus': 'SG/MY/KH First Recharge Bonus',
  'south-korea': 'South Korea',
  japan: 'Japan',
  'hong-kong': 'Hong Kong',
  'united-states': 'United States',
  'united-kingdom': 'United Kingdom',
})

/**
 * Convert a catalog region slug or display label to the canonical value expected
 * by RechargeGames API fields such as `region`. Keep unknown provider values intact
 * rather than guessing a different server.
 */
function canonicalRechargeGamesRegion(value, displayName = '') {
  const candidates = [value, displayName].map(v => String(v ?? '').trim()).filter(Boolean)
  for (const candidate of candidates) {
    const normalized = slugifyRegion(candidate)
    if (REGION_ALIASES[normalized]) return REGION_ALIASES[normalized]
    // Explicit display labels may wrap the canonical code in explanatory text.
    if (/\blatam\b/i.test(candidate)) return 'LATAM'
    if (/\b(europe|eu)\b/i.test(candidate)) return 'EU'
    if (/\bmena\b/i.test(candidate)) return 'MENA'
    if (/\bcis\b/i.test(candidate)) return 'CIS'
  }
  return candidates[0] || ''
}

module.exports = { canonicalRechargeGamesRegion, slugifyRegion }
