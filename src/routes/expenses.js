"use strict";
// Sổ chi (chỉ admin): lương HLV, chi phí biểu diễn, chi khác.
// Báo cáo tài chính = tổng thu (payments) - tổng chi (expenses) theo chi nhánh/tháng.
const express = require("express");
const db = require("../db");
const { requireAuth, requireRole } = require("../auth");

const router = express.Router();
router.use(requireAuth, requireRole("admin"));

const CATEGORIES = ["salary", "performance", "other"];

// "YYYY-MM" -> [ngày đầu tháng, ngày đầu tháng sau)
function monthBounds(month) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(month || ""));
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]);
  if (mo < 1 || mo > 12) return null;
  const start = `${y}-${String(mo).padStart(2, "0")}-01`;
  const end = mo === 12 ? `${y + 1}-01-01` : `${y}-${String(mo + 1).padStart(2, "0")}-01`;
  return { start, end };
}

router.get("/", async (req, res) => {
  const { branch_id, month } = req.query;
  const conds = [], vals = [];
  if (branch_id) { conds.push(`e.branch_id = $${vals.length + 1}`); vals.push(Number(branch_id)); }
  if (month) {
    const b = monthBounds(month);
    if (!b) return res.status(400).json({ error: "Tháng không hợp lệ (YYYY-MM)" });
    conds.push(`e.paid_on >= $${vals.length + 1} AND e.paid_on < $${vals.length + 2}`);
    vals.push(b.start, b.end);
  }
  const where = conds.length ? "WHERE " + conds.join(" AND ") : "";
  const { rows } = await db.query(
    `SELECT e.*, cu.full_name AS coach_name
     FROM expenses e LEFT JOIN users cu ON cu.id = e.coach_id
     ${where} ORDER BY e.paid_on DESC, e.id DESC LIMIT 500`, vals
  );
  res.json(rows);
});

router.post("/", async (req, res) => {
  const { branch_id, category, amount, paid_on, note, coach_id } = req.body || {};
  if (!branch_id || !amount || Number(amount) <= 0 || !paid_on) {
    return res.status(400).json({ error: "Thiếu chi nhánh / số tiền / ngày chi" });
  }
  if (!CATEGORIES.includes(category)) return res.status(400).json({ error: "Nhóm khoản chi không hợp lệ" });
  const { rows } = await db.query(
    `INSERT INTO expenses (branch_id, category, amount, paid_on, note, coach_id, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [Number(branch_id), category, Math.round(Number(amount)), paid_on,
     (note || "").trim(), coach_id ? Number(coach_id) : null, req.user.id]
  );
  res.status(201).json(rows[0]);
});

router.put("/:id", async (req, res) => {
  const cur = await db.query("SELECT * FROM expenses WHERE id = $1", [req.params.id]);
  if (!cur.rows[0]) return res.status(404).json({ error: "Không tìm thấy khoản chi" });
  const { category, amount, paid_on, note, coach_id } = req.body || {};
  const sets = [], vals = [];
  const push = (col, v) => { sets.push(`${col} = $${sets.length + 1}`); vals.push(v); };
  if (category && CATEGORIES.includes(category)) push("category", category);
  if (amount !== undefined && Number(amount) > 0) push("amount", Math.round(Number(amount)));
  if (paid_on) push("paid_on", paid_on);
  if (note !== undefined) push("note", String(note).trim());
  if (coach_id !== undefined) push("coach_id", coach_id ? Number(coach_id) : null);
  if (!sets.length) return res.status(400).json({ error: "Không có gì để cập nhật" });
  vals.push(req.params.id);
  const { rows } = await db.query(
    `UPDATE expenses SET ${sets.join(", ")} WHERE id = $${vals.length} RETURNING *`, vals
  );
  res.json(rows[0]);
});

router.delete("/:id", async (req, res) => {
  const cur = await db.query("SELECT id FROM expenses WHERE id = $1", [req.params.id]);
  if (!cur.rows[0]) return res.status(404).json({ error: "Không tìm thấy khoản chi" });
  await db.query("DELETE FROM expenses WHERE id = $1", [req.params.id]);
  res.json({ ok: true });
});

// Tổng chi theo tháng (cho báo cáo)
router.get("/summary", async (req, res) => {
  const { branch_id, month } = req.query;
  if (!month) return res.status(400).json({ error: "Thiếu tháng" });
  const b = monthBounds(month);
  if (!b) return res.status(400).json({ error: "Tháng không hợp lệ (YYYY-MM)" });
  const conds = ["paid_on >= $1 AND paid_on < $2"], vals = [b.start, b.end];
  if (branch_id) { conds.push(`branch_id = $${vals.length + 1}`); vals.push(Number(branch_id)); }
  const { rows } = await db.query(
    `SELECT category, COUNT(*)::int AS count, COALESCE(SUM(amount), 0)::bigint AS total
     FROM expenses WHERE ${conds.join(" AND ")} GROUP BY category`, vals
  );
  const byCategory = {};
  let grandTotal = 0;
  for (const c of CATEGORIES) byCategory[c] = { count: 0, total: 0 };
  for (const r of rows) {
    byCategory[r.category] = { count: r.count, total: Number(r.total) };
    grandTotal += Number(r.total);
  }
  res.json({ byCategory, grandTotal });
});

module.exports = router;
