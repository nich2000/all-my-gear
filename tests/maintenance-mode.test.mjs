import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'

const nginxConfig = readFileSync(new URL('../nginx/all-my-gear', import.meta.url), 'utf8')
const maintenancePage = readFileSync(new URL('../nginx/maintenance.html', import.meta.url), 'utf8')
const maintenanceScriptUrl = new URL('../scripts/maintenance.sh', import.meta.url)
const maintenanceScript = readFileSync(maintenanceScriptUrl, 'utf8')

test('nginx maintenance mode blocks the app and Supabase routes with HTTP 503', () => {
  assert.match(nginxConfig, /if \(-f \/var\/lib\/all-my-gear\/maintenance\.enabled\)/)
  assert.match(nginxConfig, /if \(\$maintenance_mode = 1\)\s*\{\s*return 503;/)
  assert.match(nginxConfig, /error_page 503 =503 \/maintenance\.html;/)
  assert.match(nginxConfig, /location = \/maintenance\.html\s*\{\s*internal;/)
})

test('maintenance page is autonomous and automatically retries', () => {
  assert.match(maintenancePage, /Ведутся регламентные работы/)
  assert.match(maintenancePage, /http-equiv="refresh" content="60"/)
  assert.doesNotMatch(maintenancePage, /<script\b/i)
  assert.doesNotMatch(maintenancePage, /https?:\/\//i)
})

test('maintenance helper installs the page and toggles the exact nginx flag', () => {
  assert.equal(existsSync(maintenanceScriptUrl), true)
  assert.match(maintenanceScript, /maintenance\.enabled/)
  assert.match(maintenanceScript, /touch "\$MAINTENANCE_FLAG"/)
  assert.match(maintenanceScript, /rm -f "\$MAINTENANCE_FLAG"/)
  assert.match(maintenanceScript, /"\$NGINX_BIN" -t/)
})
