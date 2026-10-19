'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { pickImageUrl, relevanceScore, lookupWikipediaThumbnail } = require('./src/utils/gameThumbnailResolver')

test('extracts safe thumbnail URLs from optional provider metadata fields', () => {
  assert.equal(pickImageUrl({ thumbnail_url: 'https://cdn.example.test/game.png' }), 'https://cdn.example.test/game.png')
  assert.equal(pickImageUrl({ image: { src: 'https://cdn.example.test/game.webp' } }), 'https://cdn.example.test/game.webp')
  assert.equal(pickImageUrl({ image_url: 'http://unsafe.example/game.png' }), null)
  assert.equal(pickImageUrl({ image_url: 'javascript:alert(1)' }), null)
})

test('ranks Wikipedia pages by name relevance before returning an image', () => {
  assert.equal(relevanceScore('Free Fire', 'Garena Free Fire'), 1)
  assert.equal(relevanceScore('Mobile Legends', 'Cooking Recipes'), 0)
  assert.equal(relevanceScore('Roblox Gift Card', 'Roblox'), 1)
})

test('finds and validates a Wikimedia thumbnail using an injected fetch function', async () => {
  const fetchImpl = async () => new Response(JSON.stringify({ query: { pages: {
    1: { title: 'Unique Resolver Game', thumbnail: { source: 'https://upload.wikimedia.org/wikipedia/en/a/a7/cover.jpg' } },
  } } }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  assert.equal(await lookupWikipediaThumbnail('Unique Resolver Game', fetchImpl), 'https://upload.wikimedia.org/wikipedia/en/a/a7/cover.jpg')
})
