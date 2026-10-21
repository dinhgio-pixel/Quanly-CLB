"use strict";
// Hồ sơ cá nhân của HLV: xem + gửi yêu cầu sửa (họ tên, cấp đai, SĐT) chờ admin duyệt.
const express = require("express");
const bcrypt = require("bcryptjs");
const db = require("../db");
const { requireAuth, requireRole } = require("../auth");

const router = express.Router();
router.use(requireAuth);

const PUBLIC_FIELDS = "id, username, full_name, role, belt_level, phone, status";

// Hồ sơ của chính mình
router.get("/me", async (req, res) => {
  const { rows } = await db.query(
    `SELECT ${PUBLIC_FIELDS} FROM users WHERE id = $1`, [req.user.id]
  );
  if (!rows[0]) return res.status(404).json({ error: "Không tìm thấy tài khoản" });
  const pend = await db.query(
    `SELECT id, changes, status, created_at FROM profile_change_requests
     WHERE user_id = $1 AND status = 'pending' ORDER BY id DESC LIMIT 1`, [req.user.id]
  );
  res.json({ ...rows[0], pending_request: pend.rows[0] || null });
});

// Gửi yêu cầu sửa hồ sơ (HLV; admin sửa trực tiếp ở mục Tài khoản)
router.post("/request", async (req, res) => {
  if (req.user.role === "admin") {
    return res.status(400).json({ error: "Quản trị viên sửa trực tiếp ở mục Tài khoản" });
  }
  const { full_name, belt_level, phone } = req.body || {};
  const changes = {};
  if (full_name !== undefined) changes.full_name = String(full_name).trim();
  if (belt_level !== undefined) changes.belt_level = String(belt_level).trim();
  if (phone !== undefined) changes.phone = String(phone).trim();
  if (!changes.full_name) return res.status(400).json({ error: "Họ tên không được để trống" });
  if (!Object.keys(changes).length) return res.status(400).json({ error: "Không có gì để gửi" });
  // Ghi đè yêu cầu đang chờ (nếu có) thay vì tạo nhiều yêu cầu
  const ex = await db.query(
    `SELECT id FROM profile_change_requests WHERE user_id = $1 AND status = 'pending' ORDER BY id DESC LIMIT 1`,
    [req.user.id]
  );
  if (ex.rows[0]) {
    await db.query(
      `UPDATE profile_change_requests SET changes = $1, created_at = NOW() WHERE id = $2`,
      [JSON.stringify(changes), ex.rows[0].id]
    );
    return res.json({ ok: true, id: ex.rows[0].id });
  }
  const { rows } = await db.query(
    `INSERT INTO profile_change_requests (user_id, changes) VALUES ($1, $2) RETURNING id`,
    [req.user.id, JSON.stringify(changes)]
  );
  res.status(201).json({ ok: true, id: rows[0].id });
});

// Đổi mật khẩu của chính mình (mọi vai trò; phải nhập đúng mật khẩu hiện tại, áp dụng ngay)
router.post("/change-password", async (req, res) => {
  const { current_password, new_password } = req.body || {};
  if (!current_password || !new_password) {
    return res.status(400).json({ error: "Nhập đủ mật khẩu hiện tại và mật khẩu mới" });
  }
  if (String(new_password).length < 6) {
    return res.status(400).json({ error: "Mật khẩu mới phải có ít nhất 6 ký tự" });
  }
  if (String(new_password) === String(current_password)) {
    return res.status(400).json({ error: "Mật khẩu mới phải khác mật khẩu hiện tại" });
  }
  const { rows } = await db.query("SELECT password_hash FROM users WHERE id = $1", [req.user.id]);
  if (!rows[0]) return res.status(404).json({ error: "Không tìm thấy tài khoản" });
  const ok = await bcrypt.compare(String(current_password), rows[0].password_hash);
  if (!ok) return res.status(400).json({ error: "Mật khẩu hiện tại không đúng" });
  const hash = await bcrypt.hash(String(new_password), 10);
  await db.query("UPDATE users SET password_hash = $1 WHERE id = $2", [hash, req.user.id]);
  res.json({ ok: true });
});

// Danh sách yêu cầu chờ duyệt (admin)
router.get("/requests", requireRole("admin"), async (req, res) => {
  const { rows } = await db.query(
    `SELECT r.*, u.username, u.full_name AS current_name, u.belt_level AS current_belt, u.phone AS current_phone
     FROM profile_change_requests r JOIN users u ON u.id = r.user_id
     WHERE r.status = 'pending' ORDER BY r.created_at DESC LIMIT 200`
  );
  res.json(rows.map((r) => ({ ...r,
    changes: typeof r.changes === "string" ? JSON.parse(r.changes) : r.changes })));
});

// Duyệt: áp dụng thay đổi vào users
router.put("/requests/:id/approve", requireRole("admin"), async (req, res) => {
  const { rows } = await db.query(`SELECT * FROM profile_change_requests WHERE id = $1`, [req.params.id]);
  const r = rows[0];
  if (!r) return res.status(404).json({ error: "Không tìm thấy yêu cầu" });
  if (r.status !== "pending") return res.status(400).json({ error: "Yêu cầu đã được xử lý" });
  const ch = typeof r.changes === "string" ? JSON.parse(r.changes) : r.changes;
  const sets = [], vals = [];
  for (const k of ["full_name", "belt_level", "phone"]) {
    if (ch[k] !== undefined) { sets.push(`${k} = $${sets.length + 1}`); vals.push(ch[k]); }
  }
  if (sets.length) {
    vals.push(r.user_id);
    await db.query(`UPDATE users SET ${sets.join(", ")} WHERE id = $${vals.length}`, vals);
  }
  await db.query(
    `UPDATE profile_change_requests SET status = 'approved', reviewed_at = NOW(), reviewer_id = $1 WHERE id = $2`,
    [req.user.id, r.id]
  );
  res.json({ ok: true });
});

// Từ chối
router.put("/requests/:id/reject", requireRole("admin"), async (req, res) => {
  const { note } = req.body || {};
  const { rows } = await db.query(`SELECT * FROM profile_change_requests WHERE id = $1`, [req.params.id]);
  const r = rows[0];
  if (!r) return res.status(404).json({ error: "Không tìm thấy yêu cầu" });
  if (r.status !== "pending") return res.status(400).json({ error: "Yêu cầu đã được xử lý" });
  await db.query(
    `UPDATE profile_change_requests SET status = 'rejected', reviewed_at = NOW(), reviewer_id = $1, note = $2 WHERE id = $3`,
    [req.user.id, String(note || "").trim(), r.id]
  );
  res.json({ ok: true });
});

module.exports = router;
