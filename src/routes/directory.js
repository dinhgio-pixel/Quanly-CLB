"use strict";
// Tra cứu: cho HLV xem thông tin cơ bản các lớp/CLB khác (chỉ đọc).
// Danh sách học viên chỉ trả Họ tên + Cấp đai (không SĐT, không học phí).
const express = require("express");
const db = require("../db");
const { requireAuth } = require("../auth");

const router = express.Router();
router.use(requireAuth);

// Học viên không được tra cứu
router.use((req, res, next) => {
  if (req.user.role === "student") return res.status(403).json({ error: "Không có quyền" });
  next();
});

// Tất cả lớp (kèm CLB, HLV đứng lớp, số HV đang học)
router.get("/classes", async (req, res) => {
  const branchId = req.query.branch_id ? Number(req.query.branch_id) : null;
  const vals = [];
  const where = branchId ? "WHERE c.branch_id = $1" : "";
  if (branchId) vals.push(branchId);
  const { rows } = await db.query(
    `SELECT c.id, c.branch_id, c.name, c.schedule, c.room, c.status, b.name AS branch_name,
            COUNT(CASE WHEN s.status = 'active' THEN 1 END)::int AS active_students
     FROM classes c JOIN branches b ON b.id = c.branch_id
     LEFT JOIN students s ON s.class_id = c.id
     ${where}
     GROUP BY c.id, c.branch_id, c.name, c.schedule, c.room, c.status, b.name
     ORDER BY b.name, c.name`, vals
  );
  let coachMap = {};
  if (rows.length) {
    const ids = rows.map((r) => r.id).join(",");
    const cc = await db.query(
      `SELECT cc.class_id, u.full_name, u.username FROM coach_classes cc
       JOIN users u ON u.id = cc.user_id WHERE cc.class_id IN (${ids})`
    );
    for (const r of cc.rows) {
      (coachMap[r.class_id] = coachMap[r.class_id] || []).push(r.full_name || r.username);
    }
  }
  res.json(rows.map((c) => ({ ...c, coaches: coachMap[c.id] || [] })));
});

// Học viên của 1 lớp (chỉ họ tên + cấp đai)
router.get("/classes/:id/students", async (req, res) => {
  const { rows } = await db.query(
    `SELECT s.id, s.full_name, s.belt_level FROM students s
     WHERE s.class_id = $1 AND s.status = 'active' ORDER BY s.full_name`,
    [req.params.id]
  );
  res.json(rows);
});

// Học viên toàn CLB (chỉ họ tên + cấp đai + lớp)
router.get("/branches/:id/students", async (req, res) => {
  const { rows } = await db.query(
    `SELECT s.id, s.full_name, s.belt_level, c.name AS class_name FROM students s
     LEFT JOIN classes c ON c.id = s.class_id
     WHERE s.branch_id = $1 AND s.status = 'active'
     ORDER BY c.name, s.full_name`,
    [req.params.id]
  );
  res.json(rows);
});

module.exports = router;
