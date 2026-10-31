import mysql from 'mysql2/promise'

let pool

export function getPool() {
  if (pool) return pool
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) throw new Error('database_url_missing')

  const url = new URL(connectionString)
  if (!['mysql:', 'mysql2:'].includes(url.protocol)) {
    throw new Error('database_url_invalid')
  }

  pool = mysql.createPool({
    host: url.hostname,
    port: Number(url.port) || 3306,
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: decodeURIComponent(url.pathname.replace(/^\//, '')),
    ssl: { rejectUnauthorized: true },
    waitForConnections: true,
    connectionLimit: 8,
    maxIdle: 4,
    idleTimeout: 60_000,
    enableKeepAlive: true,
    timezone: 'Z',
  })
  return pool
}

export async function closePool() {
  if (!pool) return
  const current = pool
  pool = undefined
  await current.end()
}
