import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const serviceSource = readFileSync(new URL('../www/js/supabase-service.js', import.meta.url), 'utf8')

test('supabase service exposes entitlement API across browser scripts', () => {
  assert.match(serviceSource, /async getCurrentUserEntitlements\(\)/)
  assert.match(serviceSource, /window\.SupabaseService\s*=\s*SupabaseService/)
})

test('missing entitlements schema uses quiet free-plan fallback', () => {
  assert.match(serviceSource, /isMissingEntitlementsSchemaError\(error\)/)
  assert.match(serviceSource, /error\.code\s*===\s*'PGRST205'/)
  assert.match(serviceSource, /console\.info\('Entitlements schema is not available; using free visibility defaults'/)
})

test('missing visible search RPCs use quiet empty-result fallback', () => {
  assert.match(serviceSource, /isMissingVisibleSearchRpcError\(error,\s*rpcName\)/)
  assert.match(serviceSource, /error\.code\s*===\s*'PGRST202'/)
  assert.match(serviceSource, /return this\.handleVisibleSearchError\(error,\s*'search_visible_gear'\)/)
  assert.match(serviceSource, /return this\.handleVisibleSearchError\(error,\s*'search_visible_checklists'\)/)
  assert.match(serviceSource, /return this\.handleVisibleSearchError\(error,\s*'search_visible_storages'\)/)
})
