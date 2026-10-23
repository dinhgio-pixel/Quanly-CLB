"use strict";
// Bảng lương HLV theo tháng + chi nhánh (chỉ admin).
// 3 kiểu trả: hourly (giờ x đơn giá), fixed (cố định tháng), revenue_share (% doanh thu giảng dạy của HLV).
// Doanh thu giảng dạy của HLV = doanh thu dạy 1:1 (payments.private gắn coach_id)
//   + phần học phí lớp phân bổ theo tỷ lệ giờ chấm công của HLV ở từng lớp.
// Tỷ trọng lương = tổng lương / doanh thu khối giảng dạy (tuition + private) của chi nhánh. Ngưỡng cảnh báo 40%.
const express = require("express");
const db = require("../db");
const { requireAuth, requireRole } = require("../auth");

const router = express.Router();
router.use(requireAuth, requireRole("admin"));

const WARN_RATIO = 40; // %

function monthRange(month) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(month || ""));
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]);
  if (mo < 1 || mo > 12) return null;
  const start = `${y}-${String(mo).padStart(2, "0")}-01`;
  const ny = mo === 12 ? y + 1 : y, nm = mo === 12 ? 1 : mo + 1;
  const end = `${ny}-${String(nm).padStart(2, "0")}-01`;
  const lastDay = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  const endOfMonth = `${y}-${String(mo).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  return { start, end, endOfMonth };
}

async function computePayroll(branchId, month) {
  const range = monthRange(month);
  if (!range) return { error: "Tháng không hợp lệ (YYYY-MM)" };
  const { start, end } = range;

  const coaches = (await db.query(
    `SELECT id, username, full_name, pay_type, hourly_rate, fixed_salary, revenue_share_pct
     FROM users WHERE role = 'coach' AND status = 'active' ORDER BY id`
  )).rows;
  const coachById = new Map(coaches.map((c) => [c.id, c]));

  // Giờ chấm công theo HLV (chi nhánh + tháng)
  const hoursRows = (await db.query(
    `SELECT user_id, COALESCE(SUM(hours), 0)::float AS h FROM coach_timesheets
     WHERE branch_id = $1 AND work_date >= $2 AND work_date < $3 GROUP BY user_id`,
    [branchId, start, end]
  )).rows;
  const hoursByCoach = new Map(hoursRows.map((r) => [r.user_id, Number(r.h)]));

  // Giờ theo HLV x lớp -> phân bổ doanh thu học phí lớp
  const classHours = (await db.query(
    `SELECT user_id, class_id, COALESCE(SUM(hours), 0)::float AS h FROM coach_timesheets
     WHERE branch_id = $1 AND class_id IS NOT NULL AND work_date >= $2 AND work_date < $3
     GROUP BY user_id, class_id`,
    [branchId, start, end]
  )).rows;
  const classTotalHours = new Map();
  for (const r of classHours) {
    classTotalHours.set(r.class_id, (classTotalHours.get(r.class_id) || 0) + Number(r.h));
  }
  // Doanh thu học phí theo lớp (qua học viên đang thuộc lớp)
  const classRev = (await db.query(
    `SELECT s.class_id, COALESCE(SUM(p.amount), 0)::bigint AS total
     FROM payments p JOIN students s ON s.id = p.student_id
     WHERE p.category = 'tuition' AND p.branch_id = $1 AND p.paid_on >= $2 AND p.paid_on < $3
       AND s.class_id IS NOT NULL
     GROUP BY s.class_id`,
    [branchId, start, end]
  )).rows;
  const classRevById = new Map(classRev.map((r) => [r.class_id, Number(r.total)]));
  const tuitionShareByCoach = new Map();
  for (const r of classHours) {
    const totalH = classTotalHours.get(r.class_id) || 0;
    const rev = classRevById.get(r.class_id) || 0;
    if (totalH > 0 && rev > 0) {
      const share = rev * (Number(r.h) / totalH);
      tuitionShareByCoach.set(r.user_id, (tuitionShareByCoach.get(r.user_id) || 0) + share);
    }
  }

  // Doanh thu dạy 1:1 theo HLV
  const privRows = (await db.query(
    `SELECT coach_id, COALESCE(SUM(amount), 0)::bigint AS total FROM payments
     WHERE category = 'private' AND coach_id IS NOT NULL AND branch_id = $1
       AND paid_on >= $2 AND paid_on < $3 GROUP BY coach_id`,
    [branchId, start, end]
  )).rows;
  const privateByCoach = new Map(privRows.map((r) => [r.coach_id, Number(r.total)]));

  // HLV thuộc chi nhánh (gán trực tiếp hoặc có lớp ở chi nhánh)
  const memberRows = (await db.query(
    `SELECT user_id FROM coach_branches WHERE branch_id = $1`, [branchId]
  )).rows;
  const memberSet = new Set(memberRows.map((r) => r.user_id));
  const classMemberRows = (await db.query(
    `SELECT DISTINCT cc.user_id FROM coach_classes cc JOIN classes c ON c.id = cc.class_id
     WHERE c.branch_id = $1`, [branchId]
  )).rows;
  for (const r of classMemberRows) memberSet.add(r.user_id);

  // Doanh thu chi nhánh theo nhóm
  const revRows = (await db.query(
    `SELECT category, COALESCE(SUM(amount), 0)::bigint AS total FROM payments
     WHERE branch_id = $1 AND paid_on >= $2 AND paid_on < $3 GROUP BY category`,
    [branchId, start, end]
  )).rows;
  let teachingRevenue = 0, totalRevenue = 0;
  for (const r of revRows) {
    totalRevenue += Number(r.total);
    if (r.category === "tuition" || r.category === "private") teachingRevenue += Number(r.total);
  }

  // Đã chốt lương chưa (expenses category=salary + ref_key)
  const settledRows = (await db.query(
    `SELECT id, coach_id, amount, ref_key FROM expenses
     WHERE category = 'salary' AND branch_id = $1 AND ref_key LIKE $2`,
    [branchId, `salary-${branchId}-${month}-%`]
  )).rows;
  const settledByCoach = new Map(settledRows.map((r) => [r.coach_id, r]));

  const rows = [];
  for (const c of coaches) {
    const hours = hoursByCoach.get(c.id) || 0;
    const privateRevenue = privateByCoach.get(c.id) || 0;
    const tuitionShare = Math.round(tuitionShareByCoach.get(c.id) || 0);
    const teachingRevenueCoach = privateRevenue + tuitionShare;
    const involved = hours > 0 || privateRevenue > 0 || tuitionShare > 0 || memberSet.has(c.id);
    if (!involved) continue;
    let salary = null, note = "";
    if (c.pay_type === "fixed") {
      salary = c.fixed_salary != null ? Number(c.fixed_salary) : null;
      if (salary == null) note = "Chưa đặt lương cố định";
    } else if (c.pay_type === "revenue_share") {
      const pct = c.revenue_share_pct != null ? Number(c.revenue_share_pct) : 40;
      salary = Math.round(teachingRevenueCoach * pct / 100);
      note = `${pct}% doanh thu giảng dạy`;
    } else {
      // hourly
      if (c.hourly_rate == null) { salary = null; note = "Chưa đặt đơn giá giờ"; }
      else salary = Math.round(hours * Number(c.hourly_rate));
    }
    const settled = settledByCoach.get(c.id) || null;
    rows.push({
      coach_id: c.id, coach_name: c.full_name || c.username, username: c.username,
      pay_type: c.pay_type || "hourly",
      hourly_rate: c.hourly_rate != null ? Number(c.hourly_rate) : null,
      fixed_salary: c.fixed_salary != null ? Number(c.fixed_salary) : null,
      revenue_share_pct: c.revenue_share_pct != null ? Number(c.revenue_share_pct) : null,
      hours, private_revenue: privateRevenue, tuition_share: tuitionShare,
      teaching_revenue: teachingRevenueCoach,
      salary, note,
      settled: settled ? { expense_id: settled.id, amount: Number(settled.amount) } : null,
    });
  }

  const totalSalary = rows.reduce((s, r) => s + (r.salary || 0), 0);
  const ratio = teachingRevenue > 0 ? Math.round(totalSalary / teachingRevenue * 1000) / 10 : null;
  return {
    branch_id: branchId, month,
    rows,
    totals: {
      total_salary: totalSalary,
      teaching_revenue: teachingRevenue,
      total_revenue: totalRevenue,
      ratio,
      warn_ratio: WARN_RATIO,
      over_warn: ratio != null && ratio > WARN_RATIO,
    },
  };
}

router.get("/", async (req, res) => {
  const branchId = Number(req.query.branch_id);
  const month = String(req.query.month || "");
  if (!branchId) return res.status(400).json({ error: "Thiếu chi nhánh" });
  const out = await computePayroll(branchId, month);
  if (out.error) return res.status(400).json({ error: out.error });
  res.json(out);
});

// Chốt lương: ghi khoản chi salary cho từng HLV chưa chốt trong tháng/chi nhánh
router.post("/settle", async (req, res) => {
  const branchId = Number((req.body || {}).branch_id);
  const month = String((req.body || {}).month || "");
  if (!branchId) return res.status(400).json({ error: "Thiếu chi nhánh" });
  const range = monthRange(month);
  if (!range) return res.status(400).json({ error: "Tháng không hợp lệ (YYYY-MM)" });
  const out = await computePayroll(branchId, month);
  if (out.error) return res.status(400).json({ error: out.error });
  let created = 0, skipped = 0;
  for (const r of out.rows) {
    if (!r.salary || r.salary <= 0) { skipped++; continue; }
    if (r.settled) { skipped++; continue; }
    const refKey = `salary-${branchId}-${month}-${r.coach_id}`;
    await db.query(
      `INSERT INTO expenses (branch_id, category, amount, paid_on, note, coach_id, ref_key, created_by)
       VALUES ($1, 'salary', $2, $3, $4, $5, $6, $7)`,
      [branchId, r.salary, range.endOfMonth,
       `Lương tháng ${month.slice(5)}/${month.slice(0, 4)} — ${r.coach_name}`, r.coach_id, refKey, req.user.id]
    );
    created++;
  }
  res.json({ ok: true, created, skipped });
});

module.exports = router;
module.exports.computePayroll = computePayroll;
