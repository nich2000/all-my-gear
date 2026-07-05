import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const indexHtml = readFileSync(new URL('../www/index.html', import.meta.url), 'utf8')
const appJs = readFileSync(new URL('../www/js/app.js', import.meta.url), 'utf8')

test('content security policy allows local Supabase storage images', () => {
  assert.match(indexHtml, /img-src[^;]*http:\/\/localhost:8000/)
  assert.match(indexHtml, /img-src[^;]*http:\/\/127\.0\.0\.1:8000/)
})

test('manage storage form labels and explains every field', () => {
  assert.match(indexHtml, /<label[^>]+for="newStorageNameInManage"[^>]*>Storage name/)
  assert.match(indexHtml, /<label[^>]+for="newStorageAddressInManage"[^>]*>Address/)
  assert.match(indexHtml, /<label[^>]+for="newStorageDescriptionInManage"[^>]*>Description/)
  assert.match(indexHtml, /id="newStorageRatingLabel"[^>]*>Rating/)
  assert.match(indexHtml, /class="storage-rating-stars"[^>]+aria-labelledby="newStorageRatingLabel"/)
  assert.match(indexHtml, /Used in storage filters and item cards/)
  assert.match(indexHtml, /Optional physical location/)
  assert.match(indexHtml, /Short note shown in storage management/)
  assert.match(indexHtml, /0 means unrated, 5 means best/)
})

test('edit storage form exposes the same fields as add storage', () => {
  assert.match(indexHtml, /<label[^>]+for="editStorageNameInput"[^>]*>Storage name/)
  assert.match(indexHtml, /<label[^>]+for="editStorageAddressInput"[^>]*>Address/)
  assert.match(indexHtml, /<label[^>]+for="editStorageDescriptionInput"[^>]*>Description/)
  assert.match(indexHtml, /id="editStorageRatingLabel"[^>]*>Rating/)
  assert.match(indexHtml, /class="storage-rating-stars"[^>]+aria-labelledby="editStorageRatingLabel"/)
})

test('storage rating uses five star controls instead of a visible numeric field', () => {
  assert.match(indexHtml, /class="storage-rating-stars"[^>]+data-rating-input="newStorageRatingInManage"/)
  assert.match(indexHtml, /class="storage-rating-stars"[^>]+data-rating-input="editStorageRatingInput"/)
  assert.match(indexHtml, /data-rating-value="5"[^>]*>★/)
  assert.doesNotMatch(indexHtml, /id="newStorageRatingInManage"[^>]+type="number"/)
  assert.doesNotMatch(indexHtml, /id="editStorageRatingInput"[^>]+type="number"/)
})

test('storage rating initialization repairs stale labels pointing at hidden inputs', () => {
  assert.match(appJs, /normalizeStorageRatingAccessibility/)
  assert.match(appJs, /label\[for="\$\{inputId\}"\]/)
  assert.match(appJs, /label\.removeAttribute\('for'\)/)
  assert.match(appJs, /group\.setAttribute\('aria-labelledby', labelId\)/)
})

test('add storage form is collapsed by default and ordered by requested rows', () => {
  assert.match(indexHtml, /<details id="addStorageForm" class="manage-storage-form add-storage-form">/)
  assert.doesNotMatch(indexHtml, /<details id="addStorageForm" class="manage-storage-form add-storage-form" open>/)
  assert.match(indexHtml, /<div class="add-storage-row add-storage-name-rating-row">/)
  assert.match(indexHtml, /<div class="manage-storage-field add-storage-address-field">/)
  assert.match(indexHtml, /<div class="manage-storage-field manage-storage-field-description add-storage-description-field">/)
  assert.match(indexHtml, /<div class="manage-storage-field manage-storage-action add-storage-action">/)
})

test('storage details summary does not contain interactive label elements', () => {
  const summaryMatch = indexHtml.match(/<summary class="manage-storage-form-header">[\s\S]*?<\/summary>/)
  assert.ok(summaryMatch)
  assert.doesNotMatch(summaryMatch[0], /<label\b/)
})

test('auth fields declare browser autocomplete behavior', () => {
  assert.match(indexHtml, /id="authNickname"[^>]+autocomplete="name"/)
  assert.match(indexHtml, /id="authEmail"[^>]+autocomplete="email"/)
  assert.match(indexHtml, /id="authPassword"[^>]+autocomplete="current-password"/)
})

test('inline gear edit controls expose accessible names without relying on adjacent labels', () => {
  const inlineControls = [
    'data-field="name"',
    'data-field="brand"',
    'data-field="model"',
    'data-field="weight"',
    'data-field="price"',
    'data-field="year"',
    'data-field="category"',
    'data-field="storageId"',
    'data-field="comment"'
  ]

  inlineControls.forEach(marker => {
    const pattern = new RegExp(`<(?:input|select|textarea)[^>]+${marker}[^>]+aria-label=`)
    assert.match(appJs, pattern)
  })
})

test('generated form controls include an id or name for browser tooling', () => {
  assert.doesNotMatch(appJs, /<(?:input|select|textarea)(?![^>]*\b(?:id|name)=)/)
})

test('generated sort selects are normalized at runtime for stale DOM', () => {
  assert.match(appJs, /normalizeGeneratedFormControlNames/)
  assert.match(appJs, /select\.classList\.contains\('checklist-sort-select'\)/)
  assert.match(appJs, /select\.name = 'categorySort'/)
})
