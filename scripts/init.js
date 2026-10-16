"use strict";
// Khởi tạo DB khi deploy: chạy schema, seed CHỈ khi chưa có dữ liệu.
// An toàn khi container restart (không bao giờ xóa dữ liệu đã có).
const fs = require("fs");
const path = require("path");
const { getPool } = require("../src/db");

(async () => {
  const pool = getPool();
  const schema = fs.readFileSync(path.join(__dirname, "..", "schema.sql"), "utf8");
  await pool.query(schema);
  console.log("[init] schema OK");

  // Mở rộng vai trò users thêm 'student' cho DB đã tạo từ trước
  // (pg-mem trong test không chạy được DO block nên làm bằng JS tại đây)
  await pool.query("ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check");
  await pool.query("ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('admin','coach','student'))");
  console.log("[init] users role check OK");

  const { rows } = await pool.query("SELECT COUNT(*)::int AS n FROM branches");
  if (rows[0].n === 0) {
    const seed = fs.readFileSync(path.join(__dirname, "..", "seed.sql"), "utf8");
    await pool.query(seed);
    console.log("[init] seed OK (38 học viên + tài khoản admin/admin123)");
  } else {
    console.log(`[init] DB đã có dữ liệu (${rows[0].n} chi nhánh) -> bỏ qua seed`);
  }
  process.exit(0);
})().catch((e) => { console.error("[init] " + e.message); process.exit(1); });
