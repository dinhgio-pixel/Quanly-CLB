"use strict";
// Book lịch cho thuê sân (chỉ admin): kiểm tra trùng với lịch thuê khác + giờ học của lớp,
// lưu xong tự sinh khoản thu 'rental' liên kết qua payment_id.
const express = require("express");
const db = require("../db");
const { requireAuth, requireRole } = require("../auth");
const { toMin, overlaps, weekdayOf, parseSchedule, dateStr } = require("../lib/slots");

const router = express.Router();
router.use(requireAuth, requireRole("admin"));

// Tìm xung đột cho 1 khung giờ thuê. excludeId: bỏ qua chính booking đang sửa.
async function findConflicts({ branch_id, rent_date, startMin, endMin, excludeId }) {
  const conflicts = [];
  const others = await db.query(
    `SELECT id, renter_name, start_time, end_time FROM rentals
     WHERE branch_id = $1 AND rent_date = $2 AND status <> 'cancelled' AND id <> $3`,
    [branch_id, rent_date, excludeId || -1]
  );
  for (const r of others.rows) {
    if (overlaps(startMin, endMin, toMin(r.start_time), toMin(r.end_time))) {
      conflicts.push(`đã có lịch thuê của "${r.renter_name || "khách"}" lúc ${r.start_time}–${r.end_time}`);
    }
  }
  const wd = weekdayOf(rent_date);
  if (wd !== null) {
    const classes = await db.query(
      `SELECT name, schedule, room FROM classes WHERE branch_id = $1 AND status = 'active'`, [branch_id]
    );
    for (const c of classes.rows) {
      const p = parseSchedule(c.schedule);
      if (p && p.days.has(wd) && overlaps(startMin, endMin, p.start, p.end)) {
        conflicts.push(`trùng giờ học của lớp "${c.name}" (${c.schedule})`);
      }
    }
  }
  return conflicts;
}

router.get("/", async (req, res) => {
  const { branch_id, date, month } = req.query;
  const conds = [], vals = [];
  if (branch_id) { conds.push(`r.branch_id = $${vals.length + 1}`); vals.push(Number(branch_id)); }
  if (date) { conds.push(`r.rent_date = $${vals.length + 1}`); vals.push(String(date)); }
  else if (month) {
    conds.push(`r.rent_date >= $${vals.length + 1} AND r.rent_date < $${vals.length + 2}`);
    const [y, mo] = String(month).split("-").map(Number);
    vals.push(`${month}-01`, mo === 12 ? `${y + 1}-01-01` : `${y}-${String(mo + 1).padStart(2, "0")}-01`);
  }
  const where = conds.length ? "WHERE " + conds.join(" AND ") : "";
  const { rows } = await db.query(
    `SELECT r.*, cu.full_name AS coach_name FROM rentals r
     LEFT JOIN users cu ON cu.id = r.coach_id
     ${where} ORDER BY r.rent_date, r.start_time`, vals
  );
  res.json(rows);
});

// Khung giờ bận trong ngày: các lớp có buổi học hôm đó (để admin thấy ca nào đã kín)
router.get("/day", async (req, res) => {
  const branch_id = Number(req.query.branch_id);
  const date = String(req.query.date || "");
  if (!branch_id || !date) return res.status(400).json({ error: "Thiếu chi nhánh / ngày" });
  const wd = weekdayOf(date);
  const classes = await db.query(
    `SELECT id, name, schedule, room FROM classes WHERE branch_id = $1 AND status = 'active' ORDER BY id`, [branch_id]
  );
  const busy = [];
  for (const c of classes.rows) {
    const p = parseSchedule(c.schedule);
    if (p && wd !== null && p.days.has(wd)) {
      busy.push({ class_id: c.id, name: c.name, schedule: c.schedule, room: c.room,
                  start: p.start, end: p.end });
    }
  }
  const rentals = await db.query(
    `SELECT r.*, cu.full_name AS coach_name FROM rentals r
     LEFT JOIN users cu ON cu.id = r.coach_id
     WHERE r.branch_id = $1 AND r.rent_date = $2 AND r.status <> 'cancelled'
     ORDER BY r.start_time`, [branch_id, date]
  );
  res.json({ date, busy_classes: busy, rentals: rentals.rows });
});

router.post("/", async (req, res) => {
  const b = req.body || {};
  const branch_id = Number(b.branch_id);
  const startMin = toMin(b.start_time), endMin = toMin(b.end_time);
  if (!branch_id || !b.rent_date) return res.status(400).json({ error: "Thiếu chi nhánh / ngày thuê" });
  if (startMin === null || endMin === null || endMin <= startMin) {
    return res.status(400).json({ error: "Giờ bắt đầu/kết thúc không hợp lệ" });
  }
  const price = Math.max(0, Math.round(Number(b.price_per_hour) || 0));
  const total = Math.round((endMin - startMin) / 60 * price);
  const conflicts = await findConflicts({ branch_id, rent_date: b.rent_date, startMin, endMin });
  if (conflicts.length) {
    return res.status(409).json({ error: "Trùng lịch: " + conflicts.join("; ") });
  }
  let paymentId = null;
  if (total > 0) {
    const pay = await db.query(
      `INSERT INTO payments (branch_id, category, amount, paid_on, note, created_by, coach_id)
       VALUES ($1, 'rental', $2, $3, $4, $5, $6) RETURNING id`,
      [branch_id, total, b.rent_date, `Cho thuê sân — ${(b.renter_name || "").trim() || "khách thuê"}`, req.user.id,
       b.coach_id ? Number(b.coach_id) : null]
    );
    paymentId = pay.rows[0].id;
  }
  const { rows } = await db.query(
    `INSERT INTO rentals (branch_id, renter_name, renter_phone, rent_date, start_time, end_time,
                          price_per_hour, total_amount, coach_id, status, payment_id, note, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
    [branch_id, (b.renter_name || "").trim(), (b.renter_phone || "").trim(), b.rent_date,
     b.start_time, b.end_time, price, total, b.coach_id ? Number(b.coach_id) : null,
     b.status === "done" ? "done" : "booked", paymentId, (b.note || "").trim(), req.user.id]
  );
  res.status(201).json(rows[0]);
});

router.put("/:id", async (req, res) => {
  const cur = await db.query("SELECT * FROM rentals WHERE id = $1", [req.params.id]);
  const old = cur.rows[0];
  if (!old) return res.status(404).json({ error: "Không tìm thấy lịch thuê" });
  const b = { ...old, ...(req.body || {}) };
  const startMin = toMin(b.start_time), endMin = toMin(b.end_time);
  if (startMin === null || endMin === null || endMin <= startMin) {
    return res.status(400).json({ error: "Giờ bắt đầu/kết thúc không hợp lệ" });
  }
  const price = Math.max(0, Math.round(Number(b.price_per_hour) || 0));
  const total = Math.round((endMin - startMin) / 60 * price);
  const newStatus = ["booked", "done", "cancelled"].includes(b.status) ? b.status : old.status;
  if (newStatus !== "cancelled") {
    const conflicts = await findConflicts({
      branch_id: old.branch_id, rent_date: dateStr(b.rent_date),
      startMin, endMin, excludeId: old.id,
    });
    if (conflicts.length) return res.status(409).json({ error: "Trùng lịch: " + conflicts.join("; ") });
  }
  // Đồng bộ khoản thu liên kết
  let paymentId = old.payment_id;
  if (newStatus === "cancelled") {
    if (paymentId) { await db.query("DELETE FROM payments WHERE id = $1", [paymentId]); paymentId = null; }
  } else if (paymentId) {
    await db.query("UPDATE payments SET amount = $1, paid_on = $2 WHERE id = $3",
      [total, dateStr(b.rent_date), paymentId]);
  } else if (total > 0) {
    const pay = await db.query(
      `INSERT INTO payments (branch_id, category, amount, paid_on, note, created_by, coach_id)
       VALUES ($1, 'rental', $2, $3, $4, $5, $6) RETURNING id`,
      [old.branch_id, total, dateStr(b.rent_date), `Cho thuê sân — ${(b.renter_name || "").trim() || "khách thuê"}`, req.user.id,
       b.coach_id ? Number(b.coach_id) : null]
    );
    paymentId = pay.rows[0].id;
  }
  const { rows } = await db.query(
    `UPDATE rentals SET renter_name = $1, renter_phone = $2, rent_date = $3, start_time = $4, end_time = $5,
       price_per_hour = $6, total_amount = $7, coach_id = $8, status = $9, payment_id = $10, note = $11
     WHERE id = $12 RETURNING *`,
    [(b.renter_name || "").trim(), (b.renter_phone || "").trim(), dateStr(b.rent_date),
     b.start_time, b.end_time, price, total, b.coach_id ? Number(b.coach_id) : null,
     newStatus, paymentId, (b.note || "").trim(), old.id]
  );
  res.json(rows[0]);
});

router.delete("/:id", async (req, res) => {
  const cur = await db.query("SELECT * FROM rentals WHERE id = $1", [req.params.id]);
  if (!cur.rows[0]) return res.status(404).json({ error: "Không tìm thấy lịch thuê" });
  if (cur.rows[0].payment_id) {
    await db.query("DELETE FROM payments WHERE id = $1", [cur.rows[0].payment_id]);
  }
  await db.query("DELETE FROM rentals WHERE id = $1", [req.params.id]);
  res.json({ ok: true });
});

module.exports = router;
