const mysql = require('mysql2/promise');
const config = require('./config');

const poolOptions = {
  user: config.db.user,
  password: config.db.password,
  database: config.db.database,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  charset: 'utf8mb4',
  timezone: 'Z',
  dateStrings: false,
};

if (config.db.socket) {
  // Unix socket — preferred on Hostinger where users have @localhost socket grants.
  poolOptions.socketPath = config.db.socket;
} else {
  poolOptions.host = config.db.host;
  poolOptions.port = config.db.port;
}

const pool = mysql.createPool(poolOptions);

async function query(sql, params) {
  const [rows] = await pool.execute(sql, params);
  return rows;
}

async function queryOne(sql, params) {
  const rows = await query(sql, params);
  return rows[0] || null;
}

async function tx(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

module.exports = { pool, query, queryOne, tx };
