"use strict";
// Quản lý tài khoản người dùng (chỉ admin)
const express = require("express");
const bcrypt = require("bcryptjs");
const db = require("../db");
const { requireAuth, requireRole } = require("../auth");

const router = express.Router();
router.use(requireAuth, requireRole("admin"));

router.get("/", async (req, res) => {
  const { rows } = await db.query(
    `SELECT u.id, u.username, u.role, u.full_name, u.status, u.created_at,
            COALESCE(json_agg(cc.class_id) FILTER (WHERE cc.class_id IS NOT NULL), '[]') AS class_ids
     FROM users u LEFT JOIN coach_classes cc ON cc.user_id = u.id
     GROUP BY u.id ORDER BY u.id`
  );
  res.json(rows);
});

router.post("/", async (req, res) => {
  try {
    const { username, password, role, full_name } = req.body || {};
    if (!username || !password) return res.status(400).json({ error: "Thiếu tên đăng nhập/mật khẩu" });
    if (!["admin", "coach"].includes(role)) return res.status(400).json({ error: "Vai trò không hợp lệ" });
    const hash = await bcrypt.hash(password, 10);
    const { rows } = await db.query(
      "INSERT INTO users (username, password_hash, role, full_name) VALUES ($1,$2,$3,$4) RETURNING id, username, role, full_name, status",
      [username.trim(), hash, role, (full_name || "").trim()]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    if (e.code === "23505") return res.status(400).json({ error: "Tên đăng nhập đã tồn tại" });
    res.status(500).json({ error: "Không tạo được tài khoản" });
  }
});

router.put("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { password, role, full_name, status } = req.body || {};
    if (id === req.user.id && status === "inactive") {
      return res.status(400).json({ error: "Không thể khóa chính tài khoản của mình" });
    }
    const sets = [], vals = [];
    if (password) { sets.push(`password_hash = $${sets.length + 1}`); vals.push(await bcrypt.hash(password, 10)); }
    if (role && ["admin", "coach"].includes(role)) { sets.push(`role = $${sets.length + 1}`); vals.push(role); }
    if (full_name !== undefined) { sets.push(`full_name = $${sets.length + 1}`); vals.push(String(full_name).trim()); }
    if (status && ["active", "inactive"].includes(status)) { sets.push(`status = $${sets.length + 1}`); vals.push(status); }
    if (!sets.length) return res.status(400).json({ error: "Không có gì để cập nhật" });
    vals.push(id);
    const { rows } = await db.query(
      `UPDATE users SET ${sets.join(", ")} WHERE id = $${vals.length}
       RETURNING id, username, role, full_name, status`,
      vals
    );
    if (!rows[0]) return res.status(404).json({ error: "Không tìm thấy tài khoản" });
    res.json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: "Không cập nhật được tài khoản" });
  }
});

router.delete("/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user.id) return res.status(400).json({ error: "Không thể xóa chính tài khoản của mình" });
  const c = await db.query("SELECT COUNT(*)::int AS n FROM users WHERE role = 'admin' AND status = 'active'");
  const target = await db.query("SELECT role FROM users WHERE id = $1", [id]);
  if (target.rows[0] && target.rows[0].role === "admin" && c.rows[0].n <= 1) {
    return res.status(400).json({ error: "Không thể xóa admin cuối cùng" });
  }
  await db.query("DELETE FROM users WHERE id = $1", [id]);
  res.json({ ok: true });
});

// Gán lớp cho HLV
router.get("/:id/classes", async (req, res) => {
  const { rows } = await db.query("SELECT class_id FROM coach_classes WHERE user_id = $1", [req.params.id]);
  res.json(rows.map((r) => r.class_id));
});

router.put("/:id/classes", async (req, res) => {
  const userId = Number(req.params.id);
  const classIds = Array.isArray(req.body.classIds) ? req.body.classIds.map(Number).filter(Boolean) : [];
  await db.query("DELETE FROM coach_classes WHERE user_id = $1", [userId]);
  for (const cid of classIds) {
    await db.query("INSERT INTO coach_classes (user_id, class_id) VALUES ($1,$2)", [userId, cid]);
  }
  res.json({ ok: true, classIds });
});

module.exports = router;
