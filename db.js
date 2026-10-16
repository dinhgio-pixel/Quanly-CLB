"use strict";
// Quản lý pool kết nối Postgres. Cho phép inject pool giả trong test.
const { Pool } = require("pg");

let pool = null;

function getPool() {
  if (!pool) {
    const connStr = process.env.DATABASE_URL;
    if (!connStr) {
      throw new Error("Thiếu biến môi trường DATABASE_URL");
    }
    pool = new Pool({
      connectionString: connStr,
      // Supabase/Render yêu cầu SSL
      ssl: /localhost|127\.0\.0\.1/.test(connStr) ? false : { rejectUnauthorized: false },
      max: 10,
    });
  }
  return pool;
}

// Dùng trong test để gắn pg-mem
function setPool(p) {
  pool = p;
}

async function closePool() {
  if (pool) {
    try { await pool.end(); } catch (e) { /* bỏ qua */ }
    pool = null;
  }
}

async function query(text, params) {
  return getPool().query(text, params);
}

module.exports = { getPool, setPool, closePool, query };
