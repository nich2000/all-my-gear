import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import test from 'node:test'

const require = createRequire(import.meta.url)
const {
  buildChecklistShareData,
  buildChecklistShareUrl,
  normalizeCategoryOrder,
  normalizeGearCategory,
  getRenderableGearCategories,
  getStorageFilterLabel,
  shouldProcessImageFileBeforePreview,
  matchesStorageFilter,
  shouldRefreshImageUrlOnError,
  shouldCollapseCategory,
  shouldCollapseChecklist
} = require('../www/js/app-helpers.js')

test('normalizes legacy category order without adding frontend categories', () => {
  assert.deepEqual(
    normalizeCategoryOrder(['Shelter', '', '  ', 'Consumables']),
    ['Shelter', 'Consumables']
  )

  assert.deepEqual(
    normalizeCategoryOrder(['Shelter', 'Ride Gear']),
    ['Shelter', 'Ride Gear']
  )
})

test('normalizes individual gear category whitespace only', () => {
  assert.equal(normalizeGearCategory('Kitchen'), 'Kitchen')
  assert.equal(normalizeGearCategory(' kitchen '), 'kitchen')
  assert.equal(normalizeGearCategory('Lighting'), 'Lighting')
  assert.equal(normalizeGearCategory(null), '')
})

test('orders non-empty gear categories before optional empty categories', () => {
  const categories = ['Shelter', 'Sleep System', 'Cooking', 'Lighting']
  const grouped = {
    Cooking: [{ id: 'stove' }],
    Shelter: [{ id: 'tent' }]
  }

  assert.deepEqual(
    getRenderableGearCategories(categories, grouped, false),
    ['Shelter', 'Cooking']
  )

  assert.deepEqual(
    getRenderableGearCategories(categories, grouped, true),
    ['Shelter', 'Cooking', 'Sleep System', 'Lighting']
  )
})

test('renders non-empty gear categories missing from the saved category order', () => {
  const categories = ['Shelter', 'Sleep System']
  const grouped = {
    Shelter: [{ id: 'tent' }],
    Electronics: [{ id: 'gps' }]
  }

  assert.deepEqual(
    getRenderableGearCategories(categories, grouped, false),
    ['Shelter', 'Electronics']
  )

  assert.deepEqual(
    getRenderableGearCategories(categories, grouped, true),
    ['Shelter', 'Electronics', 'Sleep System']
  )
})

test('matches gear items against multiple selected storages', () => {
  assert.equal(matchesStorageFilter('storage-1', []), true)
  assert.equal(matchesStorageFilter(null, []), true)
  assert.equal(matchesStorageFilter('storage-1', ['storage-1', 'storage-2']), true)
  assert.equal(matchesStorageFilter('storage-3', ['storage-1', 'storage-2']), false)
  assert.equal(matchesStorageFilter(null, ['storage-1']), false)
})

test('builds compact storage filter labels', () => {
  const storages = [
    { id: 'storage-1', name: 'Garage' },
    { id: 'storage-2', name: 'Closet' },
    { id: 'storage-3', name: 'Car' }
  ]

  assert.equal(getStorageFilterLabel([], storages), 'All storages')
  assert.equal(getStorageFilterLabel(['storage-2'], storages), 'Closet')
  assert.equal(getStorageFilterLabel(['storage-1', 'storage-3'], storages), '2 storages')
  assert.equal(getStorageFilterLabel(['missing'], storages), '1 storage')
})

test('builds share URL on the current app path', () => {
  assert.equal(
    buildChecklistShareUrl('https://all-my-gear.pro', '/inventory', 'abc123'),
    'https://all-my-gear.pro/inventory?checklist=abc123'
  )
})

test('maps checklist data into the share record payload shape', () => {
  const checklist = {
    name: 'Weekend',
    created: '2026-07-03T10:00:00.000Z',
    startDate: '2026-07-10',
    endDate: '2026-07-12',
    tags: ['camping'],
    items: [{ itemId: 'gear-1', checked: false }]
  }

  assert.deepEqual(buildChecklistShareData(checklist), {
    name: 'Weekend',
    created_at: '2026-07-03T10:00:00.000Z',
    start_date: '2026-07-10',
    end_date: '2026-07-12',
    tags: ['camping'],
    items: [{ itemId: 'gear-1', checked: false }]
  })
})

test('collapses category sections by default while preserving explicit state', () => {
  assert.equal(shouldCollapseCategory(0, {}, 'Shelter'), true)
  assert.equal(shouldCollapseCategory(3, {}, 'Shelter'), true)
  assert.equal(shouldCollapseCategory(3, { Shelter: false }, 'Shelter'), false)
  assert.equal(shouldCollapseCategory(3, { Shelter: true }, 'Shelter'), true)
})

test('collapses checklist sections by default while preserving explicit state', () => {
  assert.equal(shouldCollapseChecklist({}, 'checklist-1'), true)
  assert.equal(shouldCollapseChecklist({ 'checklist-1': false }, 'checklist-1'), false)
  assert.equal(shouldCollapseChecklist({ 'checklist-1': true }, 'checklist-1'), true)
})

test('processes HEIC files before preview even when they are under the size limit', () => {
  assert.equal(shouldProcessImageFileBeforePreview({
    name: 'IMG_0001.HEIC',
    type: 'image/heic',
    size: 24 * 1024
  }, 1024 * 1024), true)

  assert.equal(shouldProcessImageFileBeforePreview({
    name: 'photo.jpg',
    type: 'image/jpeg',
    size: 24 * 1024
  }, 1024 * 1024), false)
})

test('does not refresh inline data image URLs after image load errors', () => {
  assert.equal(shouldRefreshImageUrlOnError('data:image/heic;base64,abc'), false)
  assert.equal(shouldRefreshImageUrlOnError('data:image/jpeg;base64,abc'), false)
  assert.equal(shouldRefreshImageUrlOnError('users/user-1/item-1.jpg'), true)
})
