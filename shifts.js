"use strict";
// Yêu cầu đổi ca dạy: HLV gửi yêu cầu, quản trị viên duyệt/từ chối.
// Khi được duyệt, HLV dạy thay điểm danh bằng tài khoản của mình -> chấm công tự ghi cho người đó.
const express = require("express");
const db = require("../db");
const { requireAuth, requireRole } = require("../auth");
const { assertClassAccess } = require("../helpers");

const router = express.Router();
router.use(requireAuth);

// Danh sách HLV đang hoạt động (để chọn người đổi ca cùng)
router.get("/coaches", async (req, res) => {
  const { rows } = await db.query(
    "SELECT id, username, full_name FROM users WHERE role = 'coach' AND status = 'active' ORDER BY full_name, username"
  );
  res.json(rows);
});

// Danh sách yêu cầu (admin: tất cả; HLV: chỉ của mình)
router.get("/", async (req, res) => {
  const { branch_id, status } = req.query;
  const conds = [], vals = [];
  if (branch_id) { conds.push(`s.branch_id = $${vals.length + 1}`); vals.push(Number(branch_id)); }
  if (status) { conds.push(`s.status = $${vals.length + 1}`); vals.push(status); }
  if (req.user.role !== "admin") { conds.push(`s.requester_id = $${vals.length + 1}`); vals.push(req.user.id); }
  const where = conds.length ? "WHERE " + conds.join(" AND ") : "";
  const { rows } = await db.query(
    `SELECT s.id, s.branch_id, s.requester_id, s.class_id, s.work_date, s.swap_with_id,
            s.reason, s.status, s.reviewed_by, s.reviewed_at, s.review_note, s.created_at,
            u.full_name AS requester_name, u.username AS requester_username,
            c.name AS class_name,
            w.full_name AS swap_with_name, w.username AS swap_with_username,
            r.full_name AS reviewer_name
     FROM shift_swaps s
     JOIN users u ON u.id = s.requester_id
     JOIN classes c ON c.id = s.class_id
     LEFT JOIN users w ON w.id = s.swap_with_id
     LEFT JOIN users r ON r.id = s.reviewed_by
     ${where}
     ORDER BY s.created_at DESC LIMIT 200`, vals
  );
  res.json(rows);
});

// Gửi yêu cầu đổi ca (người gửi = tài khoản đang đăng nhập)
router.post("/", async (req, res) => {
  const { branch_id, class_id, work_date, swap_with_id, reason } = req.body || {};
  const cid = Number(class_id);
  if (!branch_id || !cid || !work_date) {
    return res.status(400).json({ error: "Thiếu chi nhánh / lớp / ngày dạy" });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(work_date)) return res.status(400).json({ error: "Ngày không hợp lệ" });
  // HLV chỉ được xin đổi ca ở lớp mình phụ trách
  if (!(await assertClassAccess(req, res, cid))) return;
  const cc = await db.query("SELECT id FROM classes WHERE id = $1 AND branch_id = $2", [cid, Number(branch_id)]);
  if (!cc.rows[0]) return res.status(400).json({ error: "Lớp không thuộc chi nhánh này" });
  const swid = Number(swap_with_id) || null;
  if (swid) {
    if (swid === req.user.id) return res.status(400).json({ error: "Không thể đổi ca với chính mình" });
    const w = await db.query("SELECT id FROM users WHERE id = $1 AND role = 'coach' AND status = 'active'", [swid]);
    if (!w.rows[0]) return res.status(400).json({ error: "HLV đổi cùng không hợp lệ" });
  }
  const { rows } = await db.query(
    `INSERT INTO shift_swaps (branch_id, requester_id, class_id, work_date, swap_with_id, reason)
     VALUES ($1,$2,$3,$4,$5,$6)
     RETURNING id, status`,
    [Number(branch_id), req.user.id, cid, work_date, swid, String(reason || "").slice(0, 300)]
  );
  res.status(201).json(rows[0]);
});

// Duyệt yêu cầu (admin)
router.put("/:id/approve", requireRole("admin"), async (req, res) => {
  const { rows } = await db.query("SELECT id, status FROM shift_swaps WHERE id = $1", [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: "Không tìm thấy yêu cầu" });
  if (rows[0].status !== "pending") return res.status(400).json({ error: "Yêu cầu đã được xử lý" });
  const note = String((req.body || {}).review_note || "").slice(0, 300);
  await db.query(
    `UPDATE shift_swaps SET status = 'approved', reviewed_by = $1, reviewed_at = NOW(), review_note = $2 WHERE id = $3`,
    [req.user.id, note, req.params.id]
  );
  res.json({ ok: true });
});

// Từ chối yêu cầu (admin)
router.put("/:id/reject", requireRole("admin"), async (req, res) => {
  const { rows } = await db.query("SELECT id, status FROM shift_swaps WHERE id = $1", [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: "Không tìm thấy yêu cầu" });
  if (rows[0].status !== "pending") return res.status(400).json({ error: "Yêu cầu đã được xử lý" });
  const note = String((req.body || {}).review_note || "").slice(0, 300);
  await db.query(
    `UPDATE shift_swaps SET status = 'rejected', reviewed_by = $1, reviewed_at = NOW(), review_note = $2 WHERE id = $3`,
    [req.user.id, note, req.params.id]
  );
  res.json({ ok: true });
});

// Hủy yêu cầu (chỉ người gửi hủy yêu cầu đang chờ, hoặc admin)
router.delete("/:id", async (req, res) => {
  const { rows } = await db.query("SELECT requester_id, status FROM shift_swaps WHERE id = $1", [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: "Không tìm thấy yêu cầu" });
  const own = rows[0].requester_id === req.user.id && rows[0].status === "pending";
  if (req.user.role !== "admin" && !own) {
    return res.status(403).json({ error: "Không có quyền hủy yêu cầu này" });
  }
  await db.query("DELETE FROM shift_swaps WHERE id = $1", [req.params.id]);
  res.json({ ok: true });
});

module.exports = router;
