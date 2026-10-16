"use strict";
// Nhật ký giảng dạy theo lớp + ngày
const express = require("express");
const db = require("../db");
const { requireAuth } = require("../auth");
const { accessibleClassIds, classIdCondition, assertClassAccess } = require("../helpers");

const router = express.Router();
router.use(requireAuth);

router.get("/", async (req, res) => {
  const { class_id, from, to } = req.query;
  const ids = await accessibleClassIds(req.user);
  const conds = [], vals = [];
  // Học viên chỉ xem nhật ký của lớp mình
  if (req.user.role === "student") {
    if (!req.user.student_id) return res.json([]);
    const me = await db.query("SELECT class_id FROM students WHERE id = $1", [req.user.student_id]);
    const myClass = me.rows[0] ? me.rows[0].class_id : -1;
    if (class_id && Number(class_id) !== myClass) return res.status(403).json({ error: "Không có quyền" });
    conds.push(`l.class_id = $${vals.length + 1}`); vals.push(myClass);
  } else {
    if (class_id) { conds.push(`l.class_id = $${vals.length + 1}`); vals.push(Number(class_id)); }
  }
  if (from) { conds.push(`l.log_date >= $${vals.length + 1}`); vals.push(from); }
  if (to) { conds.push(`l.log_date <= $${vals.length + 1}`); vals.push(to); }
  if (ids) { conds.push(classIdCondition(ids, "l.class_id")); }
  const where = conds.length ? "WHERE " + conds.join(" AND ") : "";
  const { rows } = await db.query(
    `SELECT l.*, c.name AS class_name, u.full_name AS author
     FROM teaching_logs l JOIN classes c ON c.id = l.class_id
     LEFT JOIN users u ON u.id = l.created_by
     ${where} ORDER BY l.log_date DESC, l.id DESC LIMIT 200`, vals
  );
  res.json(rows);
});

router.post("/", async (req, res) => {
  const { class_id, log_date, content, details, note } = req.body || {};
  const classId = Number(class_id);
  if (!classId || !log_date || !content || !String(content).trim()) {
    return res.status(400).json({ error: "Thiếu lớp/ngày/nội dung" });
  }
  if (!(await assertClassAccess(req, res, classId))) return;
  const { rows } = await db.query(
    "INSERT INTO teaching_logs (class_id, log_date, content, details, note, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *",
    [classId, log_date, String(content).trim(), String(details || "").trim(), String(note || "").trim().slice(0, 300), req.user.id]
  );
  res.status(201).json(rows[0]);
});

router.put("/:id", async (req, res) => {
  const cur = await db.query("SELECT class_id FROM teaching_logs WHERE id = $1", [req.params.id]);
  if (!cur.rows[0]) return res.status(404).json({ error: "Không tìm thấy nhật ký" });
  if (!(await assertClassAccess(req, res, cur.rows[0].class_id))) return;
  const { log_date, content, details, note } = req.body || {};
  const { rows } = await db.query(
    `UPDATE teaching_logs SET log_date = COALESCE($1, log_date), content = COALESCE($2, content),
      details = COALESCE($3, details), note = COALESCE($4, note)
     WHERE id = $5 RETURNING *`,
    [log_date || null, content ? String(content).trim() : null,
     details !== undefined ? String(details).trim() : null,
     note !== undefined ? String(note).trim().slice(0, 300) : null, req.params.id]
  );
  res.json(rows[0]);
});

router.delete("/:id", async (req, res) => {
  const cur = await db.query("SELECT class_id FROM teaching_logs WHERE id = $1", [req.params.id]);
  if (!cur.rows[0]) return res.status(404).json({ error: "Không tìm thấy nhật ký" });
  if (!(await assertClassAccess(req, res, cur.rows[0].class_id))) return;
  await db.query("DELETE FROM teaching_logs WHERE id = $1", [req.params.id]);
  res.json({ ok: true });
});

module.exports = router;
