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

  // KHÓA CỬA PHỤ SUPABASE (khắc phục cảnh báo rls_disabled_in_public / sensitive_columns_exposed):
  // Supabase mặc định mở 1 lớp API công khai (PostgREST + khóa anon). Bật RLS cho MỌI bảng
  // (không tạo policy nào = chặn hoàn toàn anon/authenticated qua lớp API đó) và thu hồi quyền.
  // App của mình kết nối thẳng Postgres bằng tài khoản quản trị (bypass RLS) nên KHÔNG bị ảnh hưởng.
  // Bước này tự nuốt lỗi: có trục trặc cũng không được làm app không khởi động được.
  try {
    const tbl = await pool.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'"
    );
    let locked = 0;
    for (const r of tbl.rows) {
      try {
        await pool.query(`ALTER TABLE public."${r.table_name}" ENABLE ROW LEVEL SECURITY`);
        locked++;
      } catch (e) { console.log(`[init] RLS skip ${r.table_name}: ${e.message}`); }
    }
    try {
      await pool.query("REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated");
    } catch (e) { console.log("[init] REVOKE skip: " + e.message); }
    console.log(`[init] RLS lockdown OK (${locked}/${tbl.rows.length} bảng)`);
  } catch (e) {
    console.log("[init] RLS lockdown lỗi (bỏ qua, app vẫn chạy): " + e.message);
  }

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
