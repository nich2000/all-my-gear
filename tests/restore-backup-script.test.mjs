import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'

const scriptPath = new URL('../scripts/restore-backup.sh', import.meta.url)

test('restore backup script requires explicit confirmation and restores database plus storage archives', () => {
  assert.equal(existsSync(scriptPath), true, 'scripts/restore-backup.sh must exist')

  const source = readFileSync(scriptPath, 'utf8')

  assert.match(source, /set -Eeuo pipefail/)
  assert.match(source, /BACKUP_DIR="\$\{BACKUP_DIR:-\}"/)
  assert.match(source, /RESTORE_CONFIRM="\$\{RESTORE_CONFIRM:-\}"/)
  assert.match(source, /RESTORE_CONFIRM=restore-all-my-gear/)
  assert.match(source, /DB_CONTAINER="\$\{DB_CONTAINER:-supabase-db\}"/)
  assert.match(source, /pg_restore --clean --if-exists --no-owner --no-privileges -U "\$DB_USER" -d "\$DB_NAME"/)
  assert.match(source, /supabase_storage_\*\.tar\.gz/)
  assert.match(source, /supabase_minio_\*\.tar\.gz/)
  assert.match(source, /RESTORE_FILES="\$\{RESTORE_FILES:-false\}"/)
})
