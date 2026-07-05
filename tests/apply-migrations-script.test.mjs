import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'

const scriptPath = new URL('../scripts/apply-migrations.sh', import.meta.url)

test('apply migrations script applies SQL files safely through supabase-db', () => {
  assert.equal(existsSync(scriptPath), true, 'scripts/apply-migrations.sh must exist')

  const source = readFileSync(scriptPath, 'utf8')

  assert.match(source, /set -Eeuo pipefail/)
  assert.match(source, /DB_CONTAINER="\$\{DB_CONTAINER:-supabase-db\}"/)
  assert.match(source, /MIGRATIONS_DIR="\$\(detect_migrations_dir\)"/)
  assert.match(source, /find "\$MIGRATIONS_DIR" -maxdepth 1 -type f -name '\*\.sql' \| sort/)
  assert.match(source, /migration_name="\$\(basename "\$migration"\)"/)
  assert.match(source, /migration_checksum="\$\(migration_checksum "\$migration"\)"/)
  assert.match(source, /select 1 from public\.schema_migrations where filename = :'migration_name'/)
  assert.match(source, /insert into public\.schema_migrations \(filename, checksum_sha256\)/)
  assert.match(source, /docker exec -i "\$DB_CONTAINER" psql -U "\$DB_USER" -d "\$DB_NAME" -v ON_ERROR_STOP=1 -v migration_name="\$migration_name" -v migration_checksum="\$migration_checksum" < "\$migration"/)
  assert.match(source, /select n\.nspname as schema,/)
  assert.match(source, /public_gear_shares/)
})
