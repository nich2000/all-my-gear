import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'

const scriptPath = new URL('../scripts/migrate_gear_image_data_urls.py', import.meta.url)

test('gear image migration script uses storage API and item-id object paths', () => {
  assert.equal(existsSync(scriptPath), true, 'scripts/migrate_gear_image_data_urls.py must exist')

  const source = readFileSync(scriptPath, 'utf8')

  assert.match(source, /DEFAULT_SUPABASE_URL = "http:\/\/127\.0\.0\.1:8000"/)
  assert.match(source, /SERVICE_ROLE_KEY/)
  assert.match(source, /def parse_data_url\(data_url\):/)
  assert.match(source, /base64\.b64decode/)
  assert.match(source, /def target_object_path\(item_id\):/)
  assert.match(source, /return f"\{item_id\}\/image\.jpg"/)
  assert.match(source, /\/storage\/v1\/object\/\{bucket\}\/\{quote\(path,\s*safe='\/'\)\}/)
  assert.match(source, /"x-upsert": "true"/)
  assert.match(source, /\/rest\/v1\/gear_items\?id=eq\.\{quote\(item_id\)/)
  assert.match(source, /--dry-run/)
  assert.match(source, /--include-legacy-paths/)
  assert.doesNotMatch(source, /volumes\/storage/)
})
