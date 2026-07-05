import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import test from 'node:test'

const require = createRequire(import.meta.url)
const { getCacheablePhotoUrls, isStorageImagePath } = require('../www/js/photo-url-cache.js')

test('detects only Supabase storage object paths as cacheable', () => {
  assert.equal(isStorageImagePath('user-id/item-id.jpg'), true)
  assert.equal(isStorageImagePath('data:image/jpeg;base64,abc'), false)
  assert.equal(isStorageImagePath('http://localhost:8000/storage/v1/object/sign/file.jpg'), false)
  assert.equal(isStorageImagePath('https://example.com/file.jpg'), false)
  assert.equal(isStorageImagePath(''), false)
  assert.equal(isStorageImagePath(null), false)
})

test('keeps data URLs available for rendering but excludes them from persisted cache', () => {
  const dataUrl = 'data:image/jpeg;base64,large-photo-payload'
  const storagePath = 'a8cf0468-ac26-4897-97a1-68fbac9d5364/item.jpg'
  const externalUrl = 'https://example.com/photo.jpg'

  const result = getCacheablePhotoUrls(
    {
      [dataUrl]: dataUrl,
      [storagePath]: 'http://localhost:8000/storage/v1/object/sign/item.jpg?token=abc',
      [externalUrl]: externalUrl,
      'old-user/old-item.jpg': 'stale-url'
    },
    [dataUrl, storagePath, externalUrl]
  )

  assert.deepEqual(result, {
    [storagePath]: 'http://localhost:8000/storage/v1/object/sign/item.jpg?token=abc'
  })
})
