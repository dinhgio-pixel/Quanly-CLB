"use strict";
// Dashboard: tổng quan nhanh cho trang chủ
const express = require("express");
const db = require("../db");
const { requireAuth } = require("../auth");
const { accessibleClassIds, classIdCondition, computeFeeState, todayStr } = require("../helpers");

const router = express.Router();
router.use(requireAuth);

router.get("/", async (req, res) => {
  try {
    const branchId = req.query.branch_id ? Number(req.query.branch_id) : null;
    const ids = await accessibleClassIds(req.user); // null = admin
    const today = todayStr();
    const firstOfMonth = today.slice(0, 7) + "-01";

    const bParam = (vals) => { vals.push(branchId); return `$${vals.length}`; };

    // --- Tổng HV đang học / tạm dừng + tổng lớp ---
    let vals = [];
    let where = "WHERE 1=1";
    if (branchId) where += ` AND s.branch_id = ${bParam(vals)}`;
    if (ids) where += ` AND ${classIdCondition(ids, "s.class_id")}`;
    const tot = await db.query(
      `SELECT SUM(CASE WHEN s.status = 'active' THEN 1 ELSE 0 END)::int AS students,
              SUM(CASE WHEN s.status = 'paused' THEN 1 ELSE 0 END)::int AS paused
       FROM students s ${where}`, vals
    );

    vals = [];
    where = "WHERE 1=1";
    if (branchId) where += ` AND c.branch_id = ${bParam(vals)}`;
    if (ids) where += ` AND ${classIdCondition(ids, "c.id")}`;
    const cls = await db.query(`SELECT COUNT(*)::int AS n FROM classes c ${where}`, vals);

    // --- HV sắp hết hạn / quá hạn (đang học) ---
    vals = [];
    where = "WHERE s.status = 'active'";
    if (branchId) where += ` AND s.branch_id = ${bParam(vals)}`;
    if (ids) where += ` AND ${classIdCondition(ids, "s.class_id")}`;
    const { rows: actives } = await db.query(
      `SELECT s.id, s.full_name, s.paid_through, s.phone, c.name AS class_name
       FROM students s LEFT JOIN classes c ON c.id = s.class_id ${where}
       ORDER BY s.paid_through NULLS LAST`, vals
    );
    const dueSoon = [], overdue = [];
    for (const s of actives) {
      const fs = computeFeeState(s.paid_through, today);
      if (fs === "due_soon") dueSoon.push(s);
      else if (fs === "overdue" || fs === "unpaid") overdue.push(s);
    }

    // --- Doanh thu tháng này theo nhóm (chỉ admin được xem) ---
    let revenue = null;
    if (req.user.role === "admin") {
      vals = [firstOfMonth];
      where = "paid_on >= $1";
      if (branchId) { vals.push(branchId); where += ` AND branch_id = $${vals.length}`; }
      const rev = await db.query(
        `SELECT category, COALESCE(SUM(amount),0)::int AS total FROM payments
         WHERE ${where} GROUP BY category`, vals
      );
      revenue = { tuition: 0, private: 0, rental: 0, performance: 0, other: 0 };
      for (const r of rev.rows) if (revenue[r.category] !== undefined) revenue[r.category] = r.total;
    }

    // --- Buổi điểm danh hôm nay ---
    vals = [today];
    where = "s.session_date = $1";
    if (branchId) { vals.push(branchId); where += ` AND c.branch_id = $${vals.length}`; }
    if (ids) where += ` AND ${classIdCondition(ids, "s.class_id")}`;
    const sess = await db.query(
      `SELECT s.id, s.session_date, s.note, c.name AS class_name, c.schedule,
        COUNT(r.id)::int AS records
       FROM attendance_sessions s JOIN classes c ON c.id = s.class_id
       LEFT JOIN attendance_records r ON r.session_id = s.id
       WHERE ${where}
       GROUP BY s.id, s.session_date, s.note, c.name, c.schedule
       ORDER BY c.name`, vals
    );

    res.json({
      totals: { activeStudents: tot.rows[0].students, pausedStudents: tot.rows[0].paused, classes: cls.rows[0].n },
      dueSoon: dueSoon.slice(0, 50),
      overdue: overdue.slice(0, 50),
      revenueThisMonth: revenue,
      todaySessions: sess.rows,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Không tải được dashboard" });
  }
});

// Tổng quan TẤT CẢ chi nhánh trong 1 tháng (chỉ admin): doanh thu tách giảng dạy/khác, chi, chênh lệch
router.get("/branches", async (req, res) => {
  if (req.user.role !== "admin") return res.status(403).json({ error: "Chỉ dành cho quản trị viên" });
  const month = String(req.query.month || todayStr().slice(0, 7));
  const [y, mo] = month.split("-").map(Number);
  if (!y || !mo || mo < 1 || mo > 12) return res.status(400).json({ error: "Tháng không hợp lệ (YYYY-MM)" });
  const start = `${month}-01`;
  const end = mo === 12 ? `${y + 1}-01-01` : `${y}-${String(mo + 1).padStart(2, "0")}-01`;
  const branches = (await db.query("SELECT id, name, kind FROM branches ORDER BY id")).rows;
  const out = [];
  for (const b of branches) {
    const st = await db.query(
      `SELECT COUNT(*)::int AS n FROM students WHERE branch_id = $1 AND status = 'active'`, [b.id]);
    const cl = await db.query(
      `SELECT COUNT(*)::int AS n FROM classes WHERE branch_id = $1 AND status = 'active'`, [b.id]);
    const rev = await db.query(
      `SELECT category, COALESCE(SUM(amount), 0)::bigint AS total FROM payments
       WHERE branch_id = $1 AND paid_on >= $2 AND paid_on < $3 GROUP BY category`, [b.id, start, end]);
    let teaching = 0, other = 0;
    for (const r of rev.rows) {
      if (r.category === "tuition" || r.category === "private") teaching += Number(r.total);
      else other += Number(r.total);
    }
    const exp = await db.query(
      `SELECT COALESCE(SUM(amount), 0)::bigint AS total FROM expenses
       WHERE branch_id = $1 AND paid_on >= $2 AND paid_on < $3`, [b.id, start, end]);
    const expenses = Number(exp.rows[0].total);
    out.push({
      branch_id: b.id, branch_name: b.name, kind: b.kind,
      students: st.rows[0].n, classes: cl.rows[0].n,
      teaching_revenue: teaching, other_revenue: other,
      total_revenue: teaching + other, expenses,
      balance: teaching + other - expenses,
    });
  }
  res.json({ month, branches: out });
});

module.exports = router;
