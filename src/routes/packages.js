"use strict";
// Gói học: xem (mọi user), CRUD linh động (admin)
const express = require("express");
const db = require("../db");
const { requireAuth, requireRole } = require("../auth");

const router = express.Router();
router.use(requireAuth);

router.get("/", async (req, res) => {
  const branchId = req.query.branch_id ? Number(req.query.branch_id) : null;
  const { rows } = await db.query(
    `SELECT p.id, p.branch_id, p.name, p.sessions_per_week, p.training_format,
            p.monthly_fee, p.status, p.created_at,
            COUNT(CASE WHEN s.status = 'active' THEN 1 END)::int AS active_students
     FROM packages p LEFT JOIN students s ON s.package_id = p.id
     ${branchId ? "WHERE p.branch_id = $1" : ""}
     GROUP BY p.id, p.branch_id, p.name, p.sessions_per_week, p.training_format,
              p.monthly_fee, p.status, p.created_at
     ORDER BY p.monthly_fee, p.id`,
    branchId ? [branchId] : []
  );
  res.json(rows);
});

router.post("/", requireRole("admin"), async (req, res) => {
  const { branch_id, name, sessions_per_week, training_format, monthly_fee } = req.body || {};
  if (!branch_id || !name || !name.trim()) return res.status(400).json({ error: "Thiếu chi nhánh/tên gói" });
  if (!["group", "private"].includes(training_format)) return res.status(400).json({ error: "Hình thức không hợp lệ" });
  const { rows } = await db.query(
    "INSERT INTO packages (branch_id, name, sessions_per_week, training_format, monthly_fee) VALUES ($1,$2,$3,$4,$5) RETURNING *",
    [branch_id, name.trim(), sessions_per_week || null, training_format, Number(monthly_fee) || 0]
  );
  res.status(201).json(rows[0]);
});

router.put("/:id", requireRole("admin"), async (req, res) => {
  const { name, sessions_per_week, training_format, monthly_fee, status } = req.body || {};
  const sets = [], vals = [];
  const push = (col, v) => { sets.push(`${col} = $${sets.length + 1}`); vals.push(v); };
  if (name !== undefined) push("name", String(name).trim());
  if (sessions_per_week !== undefined) push("sessions_per_week", sessions_per_week || null);
  if (training_format && ["group", "private"].includes(training_format)) push("training_format", training_format);
  if (monthly_fee !== undefined) push("monthly_fee", Number(monthly_fee) || 0);
  if (status && ["active", "inactive"].includes(status)) push("status", status);
  if (!sets.length) return res.status(400).json({ error: "Không có gì để cập nhật" });
  vals.push(req.params.id);
  const { rows } = await db.query(
    `UPDATE packages SET ${sets.join(", ")} WHERE id = $${vals.length} RETURNING *`, vals
  );
  if (!rows[0]) return res.status(404).json({ error: "Không tìm thấy gói" });
  res.json(rows[0]);
});

router.delete("/:id", requireRole("admin"), async (req, res) => {
  const c = await db.query("SELECT COUNT(*)::int AS n FROM students WHERE package_id = $1 AND status = 'active'", [req.params.id]);
  if (c.rows[0].n > 0) return res.status(400).json({ error: `Đang có ${c.rows[0].n} học viên dùng gói này` });
  await db.query("DELETE FROM packages WHERE id = $1", [req.params.id]);
  res.json({ ok: true });
});

module.exports = router;
