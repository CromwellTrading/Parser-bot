const MAX_ITEMS = 200

const inbox = []
let nextId = 1

function pushInbox(entry) {
  const item = {
    id: nextId++,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: 'received',
    ...entry
  }
  inbox.unshift(item)
  if (inbox.length > MAX_ITEMS) inbox.length = MAX_ITEMS
  return item.id
}

function patchInbox(id, patch) {
  const item = inbox.find(entry => entry.id === id)
  if (!item) return null
  Object.assign(item, patch, { updatedAt: new Date().toISOString() })
  return item
}

function listInbox(limit = 50) {
  return inbox.slice(0, Math.max(0, limit))
}

module.exports = {
  pushInbox,
  patchInbox,
  listInbox
}
