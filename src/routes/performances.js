"use strict";
// Sự kiện biểu diễn (chỉ admin): ghi 1 lần -> tự sinh khoản thu 'performance'
// và khoản chi 'performance' (chi phí nhân sự + chi phí khác) vào sổ tài chính.
const express = require("express");
const db = require("../db");
const { requireAuth, requireRole } = require("../auth");
const { dateStr } = require("../lib/slots");

const router = express.Router();
router.use(requireAuth, requireRole("admin"));

function monthBounds(month) {
  const [y, mo] = String(month || "").split("-").map(Number);
  if (!y || !mo || mo < 1 || mo > 12) return null;
  return { start: `${month}-01`, end: mo === 12 ? `${y + 1}-01-01` : `${y}-${String(mo + 1).padStart(2, "0")}-01` };
}

router.get("/", async (req, res) => {
  const { branch_id, month } = req.query;
  const conds = [], vals = [];
  if (branch_id) { conds.push(`branch_id = $${vals.length + 1}`); vals.push(Number(branch_id)); }
  if (month) {
    const b = monthBounds(month);
    if (!b) return res.status(400).json({ error: "Tháng không hợp lệ (YYYY-MM)" });
    conds.push(`event_date >= $${vals.length + 1} AND event_date < $${vals.length + 2}`);
    vals.push(b.start, b.end);
  }
  const where = conds.length ? "WHERE " + conds.join(" AND ") : "";
  const { rows } = await db.query(
    `SELECT * FROM performances ${where} ORDER BY event_date DESC, id DESC`, vals
  );
  res.json(rows.map((r) => ({
    ...r,
    profit: Number(r.revenue_fee) - Number(r.personnel_cost) - Number(r.other_cost),
  })));
});

async function createLinked(req, branchId, b) {
  let paymentId = null, expenseId = null;
  const revenue = Math.max(0, Math.round(Number(b.revenue_fee) || 0));
  const cost = Math.max(0, Math.round(Number(b.personnel_cost) || 0)) +
               Math.max(0, Math.round(Number(b.other_cost) || 0));
  if (revenue > 0) {
    const pay = await db.query(
      `INSERT INTO payments (branch_id, category, amount, paid_on, note, created_by)
       VALUES ($1, 'performance', $2, $3, $4, $5) RETURNING id`,
      [branchId, revenue, b.event_date, `Biểu diễn — ${(b.event_name || "").trim() || "sự kiện"}`, req.user.id]
    );
    paymentId = pay.rows[0].id;
  }
  if (cost > 0) {
    const ex = await db.query(
      `INSERT INTO expenses (branch_id, category, amount, paid_on, note, created_by)
       VALUES ($1, 'performance', $2, $3, $4, $5) RETURNING id`,
      [branchId, cost, b.event_date,
       `Chi biểu diễn — ${(b.event_name || "").trim() || "sự kiện"} (nhân sự ${Math.round(Number(b.personnel_cost) || 0)} + khác ${Math.round(Number(b.other_cost) || 0)})`,
       req.user.id]
    );
    expenseId = ex.rows[0].id;
  }
  return { paymentId, expenseId };
}

router.post("/", async (req, res) => {
  const b = req.body || {};
  const branch_id = Number(b.branch_id);
  if (!branch_id || !b.event_date) return res.status(400).json({ error: "Thiếu chi nhánh / ngày diễn" });
  const { paymentId, expenseId } = await createLinked(req, branch_id, b);
  const { rows } = await db.query(
    `INSERT INTO performances (branch_id, event_name, partner, event_date, personnel,
       revenue_fee, personnel_cost, other_cost, payment_id, expense_id, note, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
    [branch_id, (b.event_name || "").trim(), (b.partner || "").trim(), b.event_date,
     (b.personnel || "").trim(), Math.max(0, Math.round(Number(b.revenue_fee) || 0)),
     Math.max(0, Math.round(Number(b.personnel_cost) || 0)),
     Math.max(0, Math.round(Number(b.other_cost) || 0)),
     paymentId, expenseId, (b.note || "").trim(), req.user.id]
  );
  res.status(201).json({ ...rows[0], profit: rows[0].revenue_fee - rows[0].personnel_cost - rows[0].other_cost });
});

router.put("/:id", async (req, res) => {
  const cur = await db.query("SELECT * FROM performances WHERE id = $1", [req.params.id]);
  const old = cur.rows[0];
  if (!old) return res.status(404).json({ error: "Không tìm thấy sự kiện" });
  const b = { ...old, ...(req.body || {}) };
  const newStatus = ["done", "cancelled"].includes(b.status) ? b.status : old.status;
  const eventDate = dateStr(b.event_date);
  let paymentId = old.payment_id, expenseId = old.expense_id;
  if (newStatus === "cancelled") {
    if (paymentId) { await db.query("DELETE FROM payments WHERE id = $1", [paymentId]); paymentId = null; }
    if (expenseId) { await db.query("DELETE FROM expenses WHERE id = $1", [expenseId]); expenseId = null; }
  } else {
    const revenue = Math.max(0, Math.round(Number(b.revenue_fee) || 0));
    const cost = Math.max(0, Math.round(Number(b.personnel_cost) || 0)) + Math.max(0, Math.round(Number(b.other_cost) || 0));
    if (paymentId && revenue > 0) {
      await db.query("UPDATE payments SET amount = $1, paid_on = $2 WHERE id = $3", [revenue, eventDate, paymentId]);
    } else if (paymentId && revenue <= 0) {
      await db.query("DELETE FROM payments WHERE id = $1", [paymentId]); paymentId = null;
    } else if (!paymentId && revenue > 0) {
      const pay = await db.query(
        `INSERT INTO payments (branch_id, category, amount, paid_on, note, created_by)
         VALUES ($1, 'performance', $2, $3, $4, $5) RETURNING id`,
        [old.branch_id, revenue, eventDate, `Biểu diễn — ${(b.event_name || "").trim() || "sự kiện"}`, req.user.id]
      );
      paymentId = pay.rows[0].id;
    }
    if (expenseId && cost > 0) {
      await db.query("UPDATE expenses SET amount = $1, paid_on = $2 WHERE id = $3", [cost, eventDate, expenseId]);
    } else if (expenseId && cost <= 0) {
      await db.query("DELETE FROM expenses WHERE id = $1", [expenseId]); expenseId = null;
    } else if (!expenseId && cost > 0) {
      const ex = await db.query(
        `INSERT INTO expenses (branch_id, category, amount, paid_on, note, created_by)
         VALUES ($1, 'performance', $2, $3, $4, $5) RETURNING id`,
        [old.branch_id, cost, eventDate, `Chi biểu diễn — ${(b.event_name || "").trim() || "sự kiện"}`, req.user.id]
      );
      expenseId = ex.rows[0].id;
    }
  }
  const { rows } = await db.query(
    `UPDATE performances SET event_name = $1, partner = $2, event_date = $3, personnel = $4,
       revenue_fee = $5, personnel_cost = $6, other_cost = $7, payment_id = $8, expense_id = $9,
       status = $10, note = $11 WHERE id = $12 RETURNING *`,
    [(b.event_name || "").trim(), (b.partner || "").trim(), eventDate, (b.personnel || "").trim(),
     Math.max(0, Math.round(Number(b.revenue_fee) || 0)),
     Math.max(0, Math.round(Number(b.personnel_cost) || 0)),
     Math.max(0, Math.round(Number(b.other_cost) || 0)),
     paymentId, expenseId, newStatus, (b.note || "").trim(), old.id]
  );
  res.json({ ...rows[0], profit: rows[0].revenue_fee - rows[0].personnel_cost - rows[0].other_cost });
});

router.delete("/:id", async (req, res) => {
  const cur = await db.query("SELECT * FROM performances WHERE id = $1", [req.params.id]);
  if (!cur.rows[0]) return res.status(404).json({ error: "Không tìm thấy sự kiện" });
  const p = cur.rows[0];
  if (p.payment_id) await db.query("DELETE FROM payments WHERE id = $1", [p.payment_id]);
  if (p.expense_id) await db.query("DELETE FROM expenses WHERE id = $1", [p.expense_id]);
  await db.query("DELETE FROM performances WHERE id = $1", [req.params.id]);
  res.json({ ok: true });
});

module.exports = router;
