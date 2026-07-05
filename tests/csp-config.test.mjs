import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const indexHtml = readFileSync(new URL('../www/index.html', import.meta.url), 'utf8')

test('content security policy allows local Supabase storage images', () => {
  assert.match(indexHtml, /img-src[^;]*http:\/\/localhost:8000/)
  assert.match(indexHtml, /img-src[^;]*http:\/\/127\.0\.0\.1:8000/)
})

test('manage storage form labels and explains every field', () => {
  assert.match(indexHtml, /<label[^>]+for="newStorageNameInManage"[^>]*>Storage name/)
  assert.match(indexHtml, /<label[^>]+for="newStorageAddressInManage"[^>]*>Address/)
  assert.match(indexHtml, /<label[^>]+for="newStorageDescriptionInManage"[^>]*>Description/)
  assert.match(indexHtml, /<label[^>]+for="newStorageRatingInManage"[^>]*>Rating/)
  assert.match(indexHtml, /Used in storage filters and item cards/)
  assert.match(indexHtml, /Optional physical location/)
  assert.match(indexHtml, /Short note shown in storage management/)
  assert.match(indexHtml, /0 means unrated, 5 means best/)
})

test('edit storage form exposes the same fields as add storage', () => {
  assert.match(indexHtml, /<label[^>]+for="editStorageNameInput"[^>]*>Storage name/)
  assert.match(indexHtml, /<label[^>]+for="editStorageAddressInput"[^>]*>Address/)
  assert.match(indexHtml, /<label[^>]+for="editStorageDescriptionInput"[^>]*>Description/)
  assert.match(indexHtml, /<label[^>]+for="editStorageRatingInput"[^>]*>Rating/)
})

test('storage rating uses five star controls instead of a visible numeric field', () => {
  assert.match(indexHtml, /class="storage-rating-stars"[^>]+data-rating-input="newStorageRatingInManage"/)
  assert.match(indexHtml, /class="storage-rating-stars"[^>]+data-rating-input="editStorageRatingInput"/)
  assert.match(indexHtml, /data-rating-value="5"[^>]*>★/)
  assert.doesNotMatch(indexHtml, /id="newStorageRatingInManage"[^>]+type="number"/)
  assert.doesNotMatch(indexHtml, /id="editStorageRatingInput"[^>]+type="number"/)
})

test('add storage form is collapsed by default and ordered by requested rows', () => {
  assert.match(indexHtml, /<details id="addStorageForm" class="manage-storage-form add-storage-form">/)
  assert.doesNotMatch(indexHtml, /<details id="addStorageForm" class="manage-storage-form add-storage-form" open>/)
  assert.match(indexHtml, /<div class="add-storage-row add-storage-name-rating-row">/)
  assert.match(indexHtml, /<div class="manage-storage-field add-storage-address-field">/)
  assert.match(indexHtml, /<div class="manage-storage-field manage-storage-field-description add-storage-description-field">/)
  assert.match(indexHtml, /<div class="manage-storage-field manage-storage-action add-storage-action">/)
})
