"use strict";
// Thu phí: ghi nhận khoản thu linh động + tổng quan doanh thu theo nhóm.
const express = require("express");
const db = require("../db");
const { requireAuth, requireRole } = require("../auth");
const { accessibleClassIds, classIdCondition, assertClassAccess, studentClassId, isoDate } = require("../helpers");

const router = express.Router();
router.use(requireAuth);

const CATEGORIES = ["tuition", "private", "rental", "performance", "other"];

router.get("/", async (req, res) => {
  const { branch_id, category, from, to, student_id } = req.query;
  const ids = await accessibleClassIds(req.user);
  const conds = [], vals = [];
  if (branch_id) { conds.push(`p.branch_id = $${vals.length + 1}`); vals.push(Number(branch_id)); }
  if (category) { conds.push(`p.category = $${vals.length + 1}`); vals.push(category); }
  if (from) { conds.push(`p.paid_on >= $${vals.length + 1}`); vals.push(from); }
  if (to) { conds.push(`p.paid_on <= $${vals.length + 1}`); vals.push(to); }
  if (student_id) { conds.push(`p.student_id = $${vals.length + 1}`); vals.push(Number(student_id)); }
  if (ids) {
    // HLV chỉ thấy khoản thu gắn với HV trong lớp được gán
    conds.push(`(p.student_id IS NOT NULL AND p.student_id IN (
      SELECT id FROM students WHERE ${classIdCondition(ids, "class_id")}))`);
  }
  const where = conds.length ? "WHERE " + conds.join(" AND ") : "";
  const { rows } = await db.query(
    `SELECT p.*, s.full_name AS student_name, u.full_name AS created_by_name
     FROM payments p
     LEFT JOIN students s ON s.id = p.student_id
     LEFT JOIN users u ON u.id = p.created_by
     ${where} ORDER BY p.paid_on DESC, p.id DESC LIMIT 500`, vals
  );
  res.json(rows);
});

router.post("/", async (req, res) => {
  const { branch_id, student_id, category, amount, paid_on, paid_through, note } = req.body || {};
  if (!branch_id || !amount || Number(amount) <= 0 || !paid_on) {
    return res.status(400).json({ error: "Thiếu chi nhánh / số tiền / ngày thu" });
  }
  if (!CATEGORIES.includes(category)) return res.status(400).json({ error: "Nhóm khoản thu không hợp lệ" });
  const sid = student_id ? Number(student_id) : null;
  if (sid) {
    const cls = await studentClassId(db, sid);
    if (cls === undefined) return res.status(404).json({ error: "Không tìm thấy học viên" });
    if (req.user.role !== "admin" && !cls) {
      return res.status(403).json({ error: "Bạn không được phân công quản lý học viên này" });
    }
    if (cls && !(await assertClassAccess(req, res, cls))) return;
  } else if (req.user.role !== "admin") {
    return res.status(403).json({ error: "Chỉ admin ghi nhận khoản thu không gắn học viên" });
  }
  const { rows } = await db.query(
    `INSERT INTO payments (branch_id, student_id, category, amount, paid_on, paid_through, note, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [Number(branch_id), sid, category, Math.round(Number(amount)), paid_on,
     paid_through || null, (note || "").trim(), req.user.id]
  );
  // Nếu là học phí lớp và có ngày đóng đến -> cập nhật luôn cho HV (lấy ngày xa nhất)
  if (sid && category === "tuition" && paid_through) {
    const cur = await db.query("SELECT paid_through FROM students WHERE id = $1", [sid]);
    const curPt = isoDate(cur.rows[0] && cur.rows[0].paid_through);
    if (!curPt || paid_through > curPt) {
      await db.query("UPDATE students SET paid_through = $1 WHERE id = $2", [paid_through, sid]);
    }
  }
  res.status(201).json(rows[0]);
});

router.put("/:id", async (req, res) => {
  const cur = await db.query("SELECT * FROM payments WHERE id = $1", [req.params.id]);
  const pay = cur.rows[0];
  if (!pay) return res.status(404).json({ error: "Không tìm thấy khoản thu" });
  if (req.user.role !== "admin" && pay.created_by !== req.user.id) {
    return res.status(403).json({ error: "Không có quyền sửa khoản thu này" });
  }
  const { category, amount, paid_on, paid_through, note } = req.body || {};
  const sets = [], vals = [];
  const push = (col, v) => { sets.push(`${col} = $${sets.length + 1}`); vals.push(v); };
  if (category && CATEGORIES.includes(category)) push("category", category);
  if (amount !== undefined && Number(amount) > 0) push("amount", Math.round(Number(amount)));
  if (paid_on) push("paid_on", paid_on);
  if (paid_through !== undefined) push("paid_through", paid_through || null);
  if (note !== undefined) push("note", String(note).trim());
  if (!sets.length) return res.status(400).json({ error: "Không có gì để cập nhật" });
  vals.push(req.params.id);
  const { rows } = await db.query(
    `UPDATE payments SET ${sets.join(", ")} WHERE id = $${vals.length} RETURNING *`, vals
  );
  res.json(rows[0]);
});

router.delete("/:id", async (req, res) => {
  const cur = await db.query("SELECT created_by FROM payments WHERE id = $1", [req.params.id]);
  if (!cur.rows[0]) return res.status(404).json({ error: "Không tìm thấy khoản thu" });
  if (req.user.role !== "admin" && cur.rows[0].created_by !== req.user.id) {
    return res.status(403).json({ error: "Không có quyền xóa khoản thu này" });
  }
  await db.query("DELETE FROM payments WHERE id = $1", [req.params.id]);
  res.json({ ok: true });
});

// Tổng quan doanh thu theo nhóm (chỉ admin)
router.get("/revenue/summary", requireRole("admin"), async (req, res) => {
  const { branch_id, from, to } = req.query;
  const conds = [], vals = [];
  if (branch_id) { conds.push(`branch_id = $${vals.length + 1}`); vals.push(Number(branch_id)); }
  if (from) { conds.push(`paid_on >= $${vals.length + 1}`); vals.push(from); }
  if (to) { conds.push(`paid_on <= $${vals.length + 1}`); vals.push(to); }
  const where = conds.length ? "WHERE " + conds.join(" AND ") : "";
  const { rows } = await db.query(
    `SELECT category, COUNT(*)::int AS count, COALESCE(SUM(amount),0)::int AS total
     FROM payments ${where} GROUP BY category`, vals
  );
  const byCategory = {};
  for (const c of CATEGORIES) byCategory[c] = { count: 0, total: 0 };
  for (const r of rows) byCategory[r.category] = { count: r.count, total: r.total };
  const grand = rows.reduce((a, r) => a + r.total, 0);
  res.json({ byCategory, grandTotal: grand });
});

module.exports = router;
