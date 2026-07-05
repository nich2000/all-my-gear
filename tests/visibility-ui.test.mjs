import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import test from 'node:test'

const require = createRequire(import.meta.url)
const {
  buildResourceSavePayload,
  canEditResource,
  canSelectVisibility,
  getSearchResultBadges,
  mapChecklistRowToModel,
  mapGearRowToModel,
  mapStorageRowToModel,
  sanitizeChecklistPublicSnapshot
} = require('../www/js/visibility-ui.js')

test('free users can only select public visibility', () => {
  const freeEntitlements = { canUsePrivateVisibility: false }

  assert.equal(canSelectVisibility('public', freeEntitlements), true)
  assert.equal(canSelectVisibility('private', freeEntitlements), false)
  assert.equal(canSelectVisibility('shared', freeEntitlements), false)
})

test('subscribed users can select private and shared visibility', () => {
  const paidEntitlements = { canUsePrivateVisibility: true }

  assert.equal(canSelectVisibility('private', paidEntitlements), true)
  assert.equal(canSelectVisibility('shared', paidEntitlements), true)
})

test('only own resources can be edited', () => {
  assert.equal(canEditResource({ accessSource: 'mine' }), true)
  assert.equal(canEditResource({ access_source: 'mine' }), true)
  assert.equal(canEditResource({ accessSource: 'public' }), false)
  assert.equal(canEditResource({ accessSource: 'shared' }), false)
  assert.equal(canEditResource({ access_source: 'shared_with_me' }), false)
  assert.equal(canEditResource({ visibility: 'private' }), false)
})

test('maps database rows to frontend models with visibility fields', () => {
  assert.deepEqual(mapGearRowToModel({
    id: 'gear-1',
    user_id: 'user-1',
    image_path: 'user-1/gear-1.jpg',
    storage_id: 'storage-1',
    visibility: 'shared',
    published_at: '2026-07-04T10:00:00.000Z',
    access_source: 'shared'
  }).visibility, 'shared')

  assert.equal(mapGearRowToModel({ id: 'gear-2' }).visibility, 'public')
  assert.equal(mapChecklistRowToModel({ id: 'checklist-1', activities: ['trip'] }).tags[0], 'trip')
  assert.equal(mapStorageRowToModel({ id: 'storage-1', address: 'Main st.' }).address, 'Main st.')
})

test('builds save payload without persisting read-only access source', () => {
  assert.deepEqual(buildResourceSavePayload({
    visibility: 'public',
    publishedAt: '2026-07-04T10:00:00.000Z',
    accessSource: 'mine'
  }), {
    visibility: 'public',
    published_at: '2026-07-04T10:00:00.000Z'
  })
})

test('search result badges identify visibility and source', () => {
  assert.deepEqual(getSearchResultBadges({ visibility: 'public', accessSource: 'public' }), {
    visibility: 'Public',
    source: 'Public'
  })

  assert.deepEqual(getSearchResultBadges({ visibility: 'shared', access_source: 'shared' }), {
    visibility: 'Shared',
    source: 'Shared with me'
  })
})

test('public checklist snapshots omit private item fields', () => {
  const snapshot = sanitizeChecklistPublicSnapshot({
    items: [{
      id: 'internal-row-id',
      itemId: 'gear-1',
      name: 'Tent',
      category: 'Shelter',
      weight: 1200,
      price: 100,
      comment: 'private note',
      storageId: 'storage-1',
      image_path: 'secret/path.jpg',
      checked: false
    }]
  })

  assert.deepEqual(snapshot.items, [{
    itemId: 'gear-1',
    name: 'Tent',
    category: 'Shelter',
    brand: '',
    model: '',
    weight: 1200,
    rating: 0,
    checked: false
  }])
})
