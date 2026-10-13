"use strict";
// Học viên: CRUD + tìm kiếm. HLV chỉ thao tác HV trong lớp được gán.
const express = require("express");
const db = require("../db");
const { requireAuth } = require("../auth");
const { accessibleClassIds, classIdCondition, assertClassAccess, studentClassId, computeFeeState, todayStr } = require("../helpers");

const router = express.Router();
router.use(requireAuth);

const SELECT = `s.*, c.name AS class_name, p.name AS package_name, p.monthly_fee AS package_fee`;

router.get("/", async (req, res) => {
  const { branch_id, class_id, q, status } = req.query;
  const ids = await accessibleClassIds(req.user);
  const conds = [], vals = [];
  if (branch_id) { conds.push(`s.branch_id = $${vals.length + 1}`); vals.push(Number(branch_id)); }
  if (class_id) { conds.push(`s.class_id = $${vals.length + 1}`); vals.push(Number(class_id)); }
  if (status) { conds.push(`s.status = $${vals.length + 1}`); vals.push(status); }
  if (q) { conds.push(`(s.full_name ILIKE $${vals.length + 1} OR s.phone ILIKE $${vals.length + 1})`); vals.push(`%${q}%`); }
  if (ids) { conds.push(classIdCondition(ids, "s.class_id")); }
  const where = conds.length ? "WHERE " + conds.join(" AND ") : "";
  const { rows } = await db.query(
    `SELECT ${SELECT} FROM students s
     LEFT JOIN classes c ON c.id = s.class_id
     LEFT JOIN packages p ON p.id = s.package_id
     ${where} ORDER BY s.full_name LIMIT 500`, vals
  );
  const today = todayStr();
  res.json(rows.map((s) => ({ ...s, fee_state: s.status === "active" ? computeFeeState(s.paid_through, today) : s.status })));
});

router.get("/:id", async (req, res) => {
  const { rows } = await db.query(
    `SELECT ${SELECT} FROM students s
     LEFT JOIN classes c ON c.id = s.class_id
     LEFT JOIN packages p ON p.id = s.package_id
     WHERE s.id = $1`, [req.params.id]
  );
  const s = rows[0];
  if (!s) return res.status(404).json({ error: "Không tìm thấy học viên" });
  if (!(await assertClassAccess(req, res, s.class_id))) return;
  const pays = await db.query(
    "SELECT * FROM payments WHERE student_id = $1 ORDER BY paid_on DESC, id DESC", [s.id]
  );
  res.json({
    ...s,
    fee_state: s.status === "active" ? computeFeeState(s.paid_through, todayStr()) : s.status,
    payments: pays.rows,
  });
});

function pickStudentBody(b) {
  return {
    branch_id: b.branch_id !== undefined ? Number(b.branch_id) : undefined,
    class_id: b.class_id === null || b.class_id === "" || b.class_id === undefined ? null : Number(b.class_id),
    package_id: b.package_id === null || b.package_id === "" || b.package_id === undefined ? null : Number(b.package_id),
    full_name: b.full_name !== undefined ? String(b.full_name).trim() : undefined,
    dob: b.dob || null,
    phone: b.phone !== undefined ? String(b.phone).trim() : undefined,
    joined_on: b.joined_on || undefined,
    paid_through: b.paid_through === undefined ? undefined : (b.paid_through || null),
    height_cm: b.height_cm === undefined || b.height_cm === "" ? undefined : Number(b.height_cm),
    weight_kg: b.weight_kg === undefined || b.weight_kg === "" ? undefined : Number(b.weight_kg),
    health_note: b.health_note !== undefined ? String(b.health_note) : undefined,
    status: b.status,
  };
}

router.post("/", async (req, res) => {
  const b = pickStudentBody(req.body || {});
  if (!b.branch_id || !b.full_name || !b.joined_on) {
    return res.status(400).json({ error: "Thiếu chi nhánh / họ tên / ngày vào lớp" });
  }
  if (b.class_id && !(await assertClassAccess(req, res, b.class_id))) return;
  if (b.status && !["active", "paused", "stopped"].includes(b.status)) {
    return res.status(400).json({ error: "Trạng thái không hợp lệ" });
  }
  const { rows } = await db.query(
    `INSERT INTO students (branch_id, class_id, package_id, full_name, dob, phone, joined_on,
      paid_through, height_cm, weight_kg, health_note, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
    [b.branch_id, b.class_id, b.package_id, b.full_name, b.dob, b.phone || "",
     b.joined_on, b.paid_through === undefined ? null : b.paid_through,
     b.height_cm === undefined ? null : b.height_cm,
     b.weight_kg === undefined ? null : b.weight_kg,
     b.health_note || "", b.status || "active"]
  );
  res.status(201).json(rows[0]);
});

router.put("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const cls = await studentClassId(db, id);
  if (cls === undefined) return res.status(404).json({ error: "Không tìm thấy học viên" });
  if (req.user.role !== "admin" && !cls) {
    return res.status(403).json({ error: "Bạn không được phân công quản lý học viên này" });
  }
  if (cls && !(await assertClassAccess(req, res, cls))) return;
  const b = pickStudentBody(req.body || {});
  if (b.class_id && !(await assertClassAccess(req, res, b.class_id))) return;
  const sets = [], vals = [];
  const push = (col, v) => { sets.push(`${col} = $${sets.length + 1}`); vals.push(v); };
  if (b.branch_id !== undefined) push("branch_id", b.branch_id);
  if (b.class_id !== undefined) push("class_id", b.class_id);
  if (b.package_id !== undefined) push("package_id", b.package_id);
  if (b.full_name !== undefined) push("full_name", b.full_name);
  if (b.dob !== undefined) push("dob", b.dob);
  if (b.phone !== undefined) push("phone", b.phone);
  if (b.joined_on !== undefined) push("joined_on", b.joined_on);
  if (b.paid_through !== undefined) push("paid_through", b.paid_through);
  if (b.height_cm !== undefined) push("height_cm", b.height_cm);
  if (b.weight_kg !== undefined) push("weight_kg", b.weight_kg);
  if (b.health_note !== undefined) push("health_note", b.health_note);
  if (b.status && ["active", "paused", "stopped"].includes(b.status)) push("status", b.status);
  if (!sets.length) return res.status(400).json({ error: "Không có gì để cập nhật" });
  vals.push(id);
  const { rows } = await db.query(
    `UPDATE students SET ${sets.join(", ")} WHERE id = $${vals.length} RETURNING *`, vals
  );
  res.json(rows[0]);
});

router.delete("/:id", async (req, res) => {
  const id = Number(req.params.id);
  const cls = await studentClassId(db, id);
  if (cls === undefined) return res.status(404).json({ error: "Không tìm thấy học viên" });
  if (req.user.role !== "admin" && !cls) {
    return res.status(403).json({ error: "Bạn không được phân công quản lý học viên này" });
  }
  if (cls && !(await assertClassAccess(req, res, cls))) return;
  await db.query("DELETE FROM students WHERE id = $1", [id]);
  res.json({ ok: true });
});

module.exports = router;
