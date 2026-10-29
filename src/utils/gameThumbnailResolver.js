'use strict'

const LOOKUP_TIMEOUT_MS = 4500
const POSITIVE_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000
const NEGATIVE_CACHE_TTL_MS = 24 * 60 * 60 * 1000
const MEMO = new Map()

function safeHttpsUrl(value, { wikipediaOnly = false } = {}) {
  const text = String(value ?? '').trim()
  if (!text) return null
  try {
    const url = new URL(text)
    if (url.protocol !== 'https:') return null
    if (wikipediaOnly && !/(^|\.)wikimedia\.org$/i.test(url.hostname)) return null
    return url.toString()
  } catch (_) { return null }
}

function pickImageUrl(source) {
  if (!source || typeof source !== 'object') return null
  const candidates = [
    source.thumbnail_url, source.thumbnailUrl, source.image_url, source.imageUrl,
    source.icon_url, source.iconUrl, source.logo_url, source.logoUrl,
    source.cover_url, source.coverUrl, source.thumbnail, source.image, source.icon, source.logo,
  ]
  for (const candidate of candidates) {
    const value = typeof candidate === 'string' ? candidate : candidate && typeof candidate === 'object'
      ? (candidate.url || candidate.src || candidate.href) : null
    const safe = safeHttpsUrl(value)
    if (safe) return safe
  }
  return null
}

function normalizeWords(value) {
  return String(value ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean)
}

function meaningfulGameWords(value) {
  const noise = new Set(['game', 'games', 'video', 'mobile', 'online', 'gift', 'card', 'cards', 'top', 'up', 'recharge', 'recharges', 'diamonds', 'diamond', 'coins', 'coin', 'credits', 'credit', 'points', 'point', 'voucher', 'vouchers', 'robux', 'gems', 'gold', 'uc', 'cp', 'pack', 'packs'])
  const words = normalizeWords(value)
  const filtered = words.filter(word => !noise.has(word))
  return filtered.length ? filtered : words
}

function relevanceScore(gameName, pageTitle) {
  const target = meaningfulGameWords(gameName)
  const title = normalizeWords(pageTitle)
  if (!target.length || !title.length) return 0
  if (title.join(' ') === target.join(' ')) return 1
  const titleSet = new Set(title)
  const tokenCoverage = target.filter(token => titleSet.has(token)).length / target.length
  const targetPhrase = target.join(' ')
  const titlePhrase = title.join(' ')
  if (titlePhrase.includes(targetPhrase) || targetPhrase.includes(titlePhrase)) return Math.max(0.8, tokenCoverage)
  return tokenCoverage
}

async function lookupWikipediaThumbnail(name, fetchImpl = global.fetch) {
  const trimmedName = String(name || '').trim()
  if (!trimmedName || typeof fetchImpl !== 'function') return null
  const cacheKey = trimmedName.toLocaleLowerCase('en-US')
  const cached = MEMO.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) return cached.value
  if (cached) MEMO.delete(cacheKey)
  let result = null
  try {
    const url = new URL('https://en.wikipedia.org/w/api.php')
    url.search = new URLSearchParams({
      action: 'query', generator: 'search', gsrsearch: trimmedName,
      gsrnamespace: '0', gsrwhat: 'text', gsrlimit: '5',
      prop: 'pageimages', piprop: 'thumbnail', pithumbsize: '512', format: 'json',
    }).toString()
    const response = await fetchImpl(url, {
      method: 'GET', redirect: 'error',
      headers: { Accept: 'application/json', 'User-Agent': 'SynthesisOneGameCatalog/1.0' },
      signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
    })
    if (!response.ok) throw new Error(`Wikimedia HTTP ${response.status}`)
    const payload = await response.json()
    const pages = Object.values(payload?.query?.pages || {})
      .map(page => ({ page, score: relevanceScore(trimmedName, page?.title) }))
      .filter(row => row.score >= 0.5 && row.page?.thumbnail?.source)
      .sort((a, b) => b.score - a.score)
    if (pages.length) result = safeHttpsUrl(pages[0].page.thumbnail.source, { wikipediaOnly: true })
  } catch (_) {
    // Thumbnail resolution is best-effort and must never make the provider catalog fail.
  }
  // Cache both successful and empty results. Without negative caching, every
  // scheduled 3-hour catalog sync repeated the same Wikipedia search for games
  // that have no suitable thumbnail.
  MEMO.set(cacheKey, {
    value: result,
    expiresAt: Date.now() + (result ? POSITIVE_CACHE_TTL_MS : NEGATIVE_CACHE_TTL_MS),
  })
  return result
}

async function mapWithConcurrency(items, concurrency, worker) {
  const result = new Array(items.length)
  let cursor = 0
  const runners = Array.from({ length: Math.min(Math.max(1, concurrency), items.length) }, async () => {
    while (true) {
      const index = cursor++
      if (index >= items.length) return
      result[index] = await worker(items[index], index)
    }
  })
  await Promise.all(runners)
  return result
}

module.exports = { safeHttpsUrl, pickImageUrl, relevanceScore, lookupWikipediaThumbnail, mapWithConcurrency }
