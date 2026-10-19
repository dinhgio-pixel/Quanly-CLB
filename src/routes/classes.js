"use strict";
// Lớp học: HLV chỉ thấy lớp được gán; thêm/sửa/xóa do admin.
// GET /api/classes/:id/fee-overview: tình trạng thu phí từng HV trong lớp.
const express = require("express");
const db = require("../db");
const { requireAuth, requireRole } = require("../auth");
const { accessibleClassIds, classIdCondition, assertClassAccess, computeFeeState, todayStr } = require("../helpers");

const router = express.Router();
router.use(requireAuth);

router.get("/", async (req, res) => {
  const branchId = req.query.branch_id ? Number(req.query.branch_id) : null;
  const ids = await accessibleClassIds(req.user);
  const conds = [], vals = [];
  if (branchId) { conds.push(`c.branch_id = $${vals.length + 1}`); vals.push(branchId); }
  if (ids) { conds.push(classIdCondition(ids, "c.id")); }
  const where = conds.length ? "WHERE " + conds.join(" AND ") : "";
  const { rows } = await db.query(
    `SELECT c.id, c.branch_id, c.name, c.schedule, c.room, c.monthly_fee, c.status, c.created_at,
            b.name AS branch_name,
            COUNT(CASE WHEN s.status = 'active' THEN 1 END)::int AS active_students
     FROM classes c JOIN branches b ON b.id = c.branch_id
     LEFT JOIN students s ON s.class_id = c.id
     ${where}
     GROUP BY c.id, c.branch_id, c.name, c.schedule, c.room, c.monthly_fee, c.status, c.created_at, b.name
     ORDER BY c.branch_id, c.id`,
    vals
  );
  // HLV phụ trách từng lớp (query riêng cho tương thích pg-mem)
  let coachMap = {};
  if (rows.length) {
    const ids = rows.map((r) => r.id).join(",");
    const cc = await db.query(
      `SELECT cc.class_id, u.full_name, u.username FROM coach_classes cc
       JOIN users u ON u.id = cc.user_id WHERE cc.class_id IN (${ids})`
    );
    for (const r of cc.rows) {
      (coachMap[r.class_id] = coachMap[r.class_id] || []).push(`${r.full_name} (${r.username})`);
    }
  }
  res.json(rows.map((c) => ({ ...c, coaches: (coachMap[c.id] || []).join(", ") || null })));
});

// Danh mục tất cả lớp trên hệ thống (kèm HLV + cấp đai HLV, số HV) — mọi vai trò đều xem được
router.get("/catalog", async (req, res) => {
  const { rows } = await db.query(
    `SELECT c.id, c.branch_id, c.name, c.schedule, c.room, c.status, b.name AS branch_name,
            COUNT(CASE WHEN s.status = 'active' THEN 1 END)::int AS active_students
     FROM classes c JOIN branches b ON b.id = c.branch_id
     LEFT JOIN students s ON s.class_id = c.id
     GROUP BY c.id, c.branch_id, c.name, c.schedule, c.room, c.status, b.name
     ORDER BY b.name, c.name`
  );
  let coachMap = {};
  if (rows.length) {
    const ids = rows.map((r) => r.id).join(",");
    const cc = await db.query(
      `SELECT cc.class_id, u.full_name, u.username, u.belt_level FROM coach_classes cc
       JOIN users u ON u.id = cc.user_id WHERE cc.class_id IN (${ids})`
    );
    for (const r of cc.rows) {
      (coachMap[r.class_id] = coachMap[r.class_id] || []).push({
        name: r.full_name || r.username, belt_level: r.belt_level || "",
      });
    }
  }
  res.json(rows.map((c) => ({ ...c, coaches: coachMap[c.id] || [] })));
});

router.post("/", requireRole("admin"), async (req, res) => {
  const { branch_id, name, schedule, room, monthly_fee } = req.body || {};
  if (!branch_id || !name || !name.trim()) return res.status(400).json({ error: "Thiếu chi nhánh/tên lớp" });
  const { rows } = await db.query(
    "INSERT INTO classes (branch_id, name, schedule, room, monthly_fee) VALUES ($1,$2,$3,$4,$5) RETURNING *",
    [branch_id, name.trim(), schedule || "", room || "", Number(monthly_fee) || 0]
  );
  res.status(201).json(rows[0]);
});

router.put("/:id", requireRole("admin"), async (req, res) => {
  const { name, schedule, room, monthly_fee, status, branch_id } = req.body || {};
  const sets = [], vals = [];
  const push = (col, v) => { sets.push(`${col} = $${sets.length + 1}`); vals.push(v); };
  if (name !== undefined) push("name", String(name).trim());
  if (schedule !== undefined) push("schedule", String(schedule));
  if (room !== undefined) push("room", String(room));
  if (monthly_fee !== undefined) push("monthly_fee", Number(monthly_fee) || 0);
  if (status && ["active", "inactive"].includes(status)) push("status", status);
  if (branch_id !== undefined) push("branch_id", Number(branch_id));
  if (!sets.length) return res.status(400).json({ error: "Không có gì để cập nhật" });
  vals.push(req.params.id);
  const { rows } = await db.query(
    `UPDATE classes SET ${sets.join(", ")} WHERE id = $${vals.length} RETURNING *`, vals
  );
  if (!rows[0]) return res.status(404).json({ error: "Không tìm thấy lớp" });
  res.json(rows[0]);
});

router.delete("/:id", requireRole("admin"), async (req, res) => {
  await db.query("DELETE FROM classes WHERE id = $1", [req.params.id]);
  res.json({ ok: true });
});

// Tổng quan thu phí của lớp: từng HV + đếm theo nhóm trạng thái
router.get("/:id/fee-overview", async (req, res) => {
  const classId = Number(req.params.id);
  if (!(await assertClassAccess(req, res, classId))) return;
  const today = todayStr();
  const { rows } = await db.query(
    `SELECT s.id, s.full_name, s.status, s.paid_through, s.phone,
            p.name AS package_name, p.monthly_fee AS package_fee,
            p.sessions_per_week AS package_sessions
     FROM students s LEFT JOIN packages p ON p.id = s.package_id
     WHERE s.class_id = $1 ORDER BY s.full_name`,
    [classId]
  );
  const students = rows.map((s) => {
    let fee;
    if (s.status === "paused") fee = "paused";
    else if (s.status === "stopped") fee = "stopped";
    else fee = computeFeeState(s.paid_through, today);
    const row = { ...s, fee_state: fee };
    if (req.user.role === "coach") row.package_fee = null; // HLV không thấy số tiền
    return row;
  });
  const summary = { paid: 0, unpaid: 0, overdue: 0, due_soon: 0, paused: 0, stopped: 0 };
  for (const s of students) summary[s.fee_state] = (summary[s.fee_state] || 0) + 1;
  res.json({ students, summary });
});

module.exports = router;
