import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { closePool, getPool } from './database.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const migrationsDirectory = path.resolve(here, '../db/migrations')
const lockName = 'onyx_bot_builder_schema_migrations'

export async function runMigrations({ closeWhenDone = true } = {}) {
  const pool = getPool()
  let connection
  let locked = false

  try {
    connection = await pool.getConnection()
    const [lockRows] = await connection.query('SELECT GET_LOCK(?, 20) AS acquired', [lockName])
    if (Number(lockRows[0]?.acquired) !== 1) throw new Error('migration_lock_timeout')
    locked = true

    await connection.query(`
      CREATE TABLE IF NOT EXISTS onyx_schema_migrations (
        version VARCHAR(255) NOT NULL PRIMARY KEY,
        applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `)

    const files = (await fs.readdir(migrationsDirectory))
      .filter((file) => /^\d+_[a-z0-9_-]+\.sql$/i.test(file))
      .sort()

    for (const file of files) {
      const version = file.replace(/\.sql$/i, '')
      const [applied] = await connection.execute(
        'SELECT version FROM onyx_schema_migrations WHERE version = ?',
        [version],
      )
      if (applied.length) continue

      const sql = await fs.readFile(path.join(migrationsDirectory, file), 'utf8')
      const statements = sql.split(/;\s*(?:\r?\n|$)/).map((item) => item.trim()).filter(Boolean)
      for (const statement of statements) await connection.query(statement)
      await connection.execute(
        'INSERT INTO onyx_schema_migrations (version) VALUES (?)',
        [version],
      )
      console.log(`Applied database migration ${version}`)
    }
  } finally {
    if (connection && locked) {
      try { await connection.query('SELECT RELEASE_LOCK(?)', [lockName]) } catch {}
    }
    connection?.release()
    if (closeWhenDone) await closePool()
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runMigrations().catch(() => {
    console.error('Database migration failed; check the managed database and migration files.')
    process.exitCode = 1
  })
}
