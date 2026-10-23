"use strict";
// Buổi dạy 1:1 (chỉ admin): chống trùng lịch cho HLV (buổi 1:1 khác / lịch thuê phụ trách / giờ lớp),
// lưu xong tự sinh khoản thu 'private' + dòng chấm công theo giờ lương thỏa thuận (nếu có).
const express = require("express");
const db = require("../db");
const { requireAuth, requireRole } = require("../auth");
const { toMin, overlaps, weekdayOf, parseSchedule, dateStr } = require("../lib/slots");

const router = express.Router();
router.use(requireAuth, requireRole("admin"));

async function findCoachConflicts({ coach_id, session_date, startMin, endMin, excludeId }) {
  const conflicts = [];
  const others = await db.query(
    `SELECT id, student_name, start_time, end_time FROM private_sessions
     WHERE coach_id = $1 AND session_date = $2 AND status <> 'cancelled' AND id <> $3`,
    [coach_id, session_date, excludeId || -1]
  );
  for (const r of others.rows) {
    if (overlaps(startMin, endMin, toMin(r.start_time), toMin(r.end_time))) {
      conflicts.push(`HLV đã có buổi 1:1 với "${r.student_name || "học viên"}" lúc ${r.start_time}–${r.end_time}`);
    }
  }
  const rents = await db.query(
    `SELECT id, renter_name, start_time, end_time FROM rentals
     WHERE coach_id = $1 AND rent_date = $2 AND status <> 'cancelled'`,
    [coach_id, session_date]
  );
  for (const r of rents.rows) {
    if (overlaps(startMin, endMin, toMin(r.start_time), toMin(r.end_time))) {
      conflicts.push(`HLV đang phụ trách lịch thuê của "${r.renter_name || "khách"}" lúc ${r.start_time}–${r.end_time}`);
    }
  }
  const wd = weekdayOf(session_date);
  if (wd !== null) {
    const classes = await db.query(
      `SELECT c.name, c.schedule FROM classes c
       JOIN coach_classes cc ON cc.class_id = c.id
       WHERE cc.user_id = $1 AND c.status = 'active'`, [coach_id]
    );
    for (const c of classes.rows) {
      const p = parseSchedule(c.schedule);
      if (p && p.days.has(wd) && overlaps(startMin, endMin, p.start, p.end)) {
        conflicts.push(`trùng giờ lớp "${c.name}" (${c.schedule})`);
      }
    }
  }
  return conflicts;
}

router.get("/", async (req, res) => {
  const { branch_id, month, coach_id } = req.query;
  const conds = [], vals = [];
  if (branch_id) { conds.push(`ps.branch_id = $${vals.length + 1}`); vals.push(Number(branch_id)); }
  if (coach_id) { conds.push(`ps.coach_id = $${vals.length + 1}`); vals.push(Number(coach_id)); }
  if (month) {
    const [y, mo] = String(month).split("-").map(Number);
    conds.push(`ps.session_date >= $${vals.length + 1} AND ps.session_date < $${vals.length + 2}`);
    vals.push(`${month}-01`, mo === 12 ? `${y + 1}-01-01` : `${y}-${String(mo + 1).padStart(2, "0")}-01`);
  }
  const where = conds.length ? "WHERE " + conds.join(" AND ") : "";
  const { rows } = await db.query(
    `SELECT ps.*, cu.full_name AS coach_name FROM private_sessions ps
     JOIN users cu ON cu.id = ps.coach_id
     ${where} ORDER BY ps.session_date DESC, ps.start_time`, vals
  );
  res.json(rows);
});

router.post("/", async (req, res) => {
  const b = req.body || {};
  const branch_id = Number(b.branch_id), coach_id = Number(b.coach_id);
  const startMin = toMin(b.start_time), endMin = toMin(b.end_time);
  if (!branch_id || !coach_id || !b.session_date) {
    return res.status(400).json({ error: "Thiếu chi nhánh / HLV / ngày dạy" });
  }
  if (startMin === null || endMin === null || endMin <= startMin) {
    return res.status(400).json({ error: "Giờ bắt đầu/kết thúc không hợp lệ" });
  }
  const conflicts = await findCoachConflicts({ coach_id, session_date: b.session_date, startMin, endMin });
  if (conflicts.length) return res.status(409).json({ error: "Trùng lịch: " + conflicts.join("; ") });
  const fee = Math.max(0, Math.round(Number(b.fee) || 0));
  let paymentId = null;
  if (fee > 0) {
    const pay = await db.query(
      `INSERT INTO payments (branch_id, category, amount, paid_on, note, created_by, coach_id)
       VALUES ($1, 'private', $2, $3, $4, $5, $6) RETURNING id`,
      [branch_id, fee, b.session_date, `Dạy 1:1 — ${(b.student_name || "").trim() || "học viên"}`, req.user.id, coach_id]
    );
    paymentId = pay.rows[0].id;
  }
  let timesheetId = null;
  const payHours = b.pay_hours === undefined || b.pay_hours === null || b.pay_hours === "" ? null : Number(b.pay_hours);
  if (payHours && payHours > 0) {
    const ts = await db.query(
      `INSERT INTO coach_timesheets (branch_id, user_id, class_id, work_date, hours, note, created_by)
       VALUES ($1,$2,NULL,$3,$4,$5,$6) RETURNING id`,
      [branch_id, coach_id, b.session_date, payHours, `Dạy 1:1 — ${(b.student_name || "").trim()}`, req.user.id]
    );
    timesheetId = ts.rows[0].id;
  }
  const { rows } = await db.query(
    `INSERT INTO private_sessions (branch_id, coach_id, student_name, student_phone, session_date,
       start_time, end_time, fee, pay_hours, payment_id, timesheet_id, note, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
    [branch_id, coach_id, (b.student_name || "").trim(), (b.student_phone || "").trim(), b.session_date,
     b.start_time, b.end_time, fee, payHours, paymentId, timesheetId, (b.note || "").trim(), req.user.id]
  );
  res.status(201).json(rows[0]);
});

router.put("/:id", async (req, res) => {
  const cur = await db.query("SELECT * FROM private_sessions WHERE id = $1", [req.params.id]);
  const old = cur.rows[0];
  if (!old) return res.status(404).json({ error: "Không tìm thấy buổi dạy" });
  const b = { ...old, ...(req.body || {}) };
  const sessionDate = dateStr(b.session_date);
  const startMin = toMin(b.start_time), endMin = toMin(b.end_time);
  if (startMin === null || endMin === null || endMin <= startMin) {
    return res.status(400).json({ error: "Giờ bắt đầu/kết thúc không hợp lệ" });
  }
  const newStatus = ["done", "cancelled"].includes(b.status) ? b.status : old.status;
  const coachId = Number(b.coach_id);
  if (newStatus !== "cancelled") {
    const conflicts = await findCoachConflicts({
      coach_id: coachId, session_date: sessionDate, startMin, endMin, excludeId: old.id,
    });
    if (conflicts.length) return res.status(409).json({ error: "Trùng lịch: " + conflicts.join("; ") });
  }
  const fee = Math.max(0, Math.round(Number(b.fee) || 0));
  let paymentId = old.payment_id, timesheetId = old.timesheet_id;
  if (newStatus === "cancelled") {
    if (paymentId) { await db.query("DELETE FROM payments WHERE id = $1", [paymentId]); paymentId = null; }
    if (timesheetId) { await db.query("DELETE FROM coach_timesheets WHERE id = $1", [timesheetId]); timesheetId = null; }
  } else {
    if (paymentId) {
      await db.query("UPDATE payments SET amount = $1, paid_on = $2, coach_id = $3 WHERE id = $4",
        [fee, sessionDate, coachId, paymentId]);
    } else if (fee > 0) {
      const pay = await db.query(
        `INSERT INTO payments (branch_id, category, amount, paid_on, note, created_by, coach_id)
         VALUES ($1, 'private', $2, $3, $4, $5, $6) RETURNING id`,
        [old.branch_id, fee, sessionDate, `Dạy 1:1 — ${(b.student_name || "").trim() || "học viên"}`, req.user.id, coachId]
      );
      paymentId = pay.rows[0].id;
    }
    const payHours = b.pay_hours === undefined || b.pay_hours === null || b.pay_hours === "" ? null : Number(b.pay_hours);
    if (timesheetId && payHours && payHours > 0) {
      await db.query("UPDATE coach_timesheets SET hours = $1, work_date = $2, user_id = $3 WHERE id = $4",
        [payHours, sessionDate, coachId, timesheetId]);
    } else if (timesheetId && (!payHours || payHours <= 0)) {
      await db.query("DELETE FROM coach_timesheets WHERE id = $1", [timesheetId]);
      timesheetId = null;
    } else if (!timesheetId && payHours && payHours > 0) {
      const ts = await db.query(
        `INSERT INTO coach_timesheets (branch_id, user_id, class_id, work_date, hours, note, created_by)
         VALUES ($1,$2,NULL,$3,$4,$5,$6) RETURNING id`,
        [old.branch_id, coachId, sessionDate, payHours, `Dạy 1:1 — ${(b.student_name || "").trim()}`, req.user.id]
      );
      timesheetId = ts.rows[0].id;
    }
    b.pay_hours = payHours;
  }
  const { rows } = await db.query(
    `UPDATE private_sessions SET coach_id = $1, student_name = $2, student_phone = $3, session_date = $4,
       start_time = $5, end_time = $6, fee = $7, pay_hours = $8, payment_id = $9, timesheet_id = $10,
       status = $11, note = $12 WHERE id = $13 RETURNING *`,
    [coachId, (b.student_name || "").trim(), (b.student_phone || "").trim(), sessionDate,
     b.start_time, b.end_time, fee, newStatus === "cancelled" ? old.pay_hours : (b.pay_hours ?? null),
     paymentId, timesheetId, newStatus, (b.note || "").trim(), old.id]
  );
  res.json(rows[0]);
});

router.delete("/:id", async (req, res) => {
  const cur = await db.query("SELECT * FROM private_sessions WHERE id = $1", [req.params.id]);
  if (!cur.rows[0]) return res.status(404).json({ error: "Không tìm thấy buổi dạy" });
  const s = cur.rows[0];
  if (s.payment_id) await db.query("DELETE FROM payments WHERE id = $1", [s.payment_id]);
  if (s.timesheet_id) await db.query("DELETE FROM coach_timesheets WHERE id = $1", [s.timesheet_id]);
  await db.query("DELETE FROM private_sessions WHERE id = $1", [req.params.id]);
  res.json({ ok: true });
});

module.exports = router;
