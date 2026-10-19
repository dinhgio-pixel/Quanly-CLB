"use strict";
// Thu phí: ghi nhận khoản thu linh động + tổng quan doanh thu theo nhóm.
const express = require("express");
const db = require("../db");
const { requireAuth, requireRole } = require("../auth");
const { accessibleClassIds, classIdCondition, assertClassAccess, studentClassId, isoDate } = require("../helpers");

const router = express.Router();
router.use(requireAuth);

const CATEGORIES = ["tuition", "private", "rental", "performance", "other"];

router.get("/", async (req, res) => {
  const { branch_id, category, from, to, student_id } = req.query;
  const ids = await accessibleClassIds(req.user);
  const conds = [], vals = [];
  if (branch_id) { conds.push(`p.branch_id = $${vals.length + 1}`); vals.push(Number(branch_id)); }
  if (category) { conds.push(`p.category = $${vals.length + 1}`); vals.push(category); }
  if (from) { conds.push(`p.paid_on >= $${vals.length + 1}`); vals.push(from); }
  if (to) { conds.push(`p.paid_on <= $${vals.length + 1}`); vals.push(to); }
  if (student_id) { conds.push(`p.student_id = $${vals.length + 1}`); vals.push(Number(student_id)); }
  if (ids) {
    // HLV chỉ thấy khoản thu gắn với HV trong lớp được gán
    conds.push(`(p.student_id IS NOT NULL AND p.student_id IN (
      SELECT id FROM students WHERE ${classIdCondition(ids, "class_id")}))`);
  }
  const where = conds.length ? "WHERE " + conds.join(" AND ") : "";
  const { rows } = await db.query(
    `SELECT p.*, s.full_name AS student_name, u.full_name AS created_by_name
     FROM payments p
     LEFT JOIN students s ON s.id = p.student_id
     LEFT JOIN users u ON u.id = p.created_by
     ${where} ORDER BY p.paid_on DESC, p.id DESC LIMIT 500`, vals
  );
  // HLV không thấy số tiền
  res.json(req.user.role === "coach" ? rows.map((p) => ({ ...p, amount: null })) : rows);
});

// Admin đánh dấu tháng đã đóng / chưa đóng cho học viên (đồng bộ với payments)
// paid=true: tạo khoản thu học phí cho đúng tháng đó; paid=false: xóa khoản thu
// do chức năng này tạo (chỉ xóa đúng khoản đã đánh dấu, không động vào khoản thu tay)
router.post("/fee-month", requireRole("admin"), async (req, res) => {
  const { student_id, year, month, paid } = req.body || {};
  const sid = Number(student_id), y = Number(year), m = Number(month);
  if (!sid || !y || !m || m < 1 || m > 12 || typeof paid !== "boolean") {
    return res.status(400).json({ error: "Thiếu học viên / năm / tháng / trạng thái" });
  }
  const st = await db.query(
    `SELECT s.*, p.monthly_fee AS pkg_fee, c.monthly_fee AS class_fee
     FROM students s
     LEFT JOIN packages p ON p.id = s.package_id
     LEFT JOIN classes c ON c.id = s.class_id
     WHERE s.id = $1`, [sid]
  );
  const s = st.rows[0];
  if (!s) return res.status(404).json({ error: "Không tìm thấy học viên" });
  const first = `${y}-${String(m).padStart(2, "0")}-01`;
  const lastDay = new Date(y, m, 0).getDate();
  const last = `${y}-${String(m).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  const NOTE_PREFIX = "Đánh dấu đóng học phí";
  // Các khoản học phí đang bao phủ tháng này
  const cov = await db.query(
    `SELECT * FROM payments WHERE student_id = $1 AND category = 'tuition'
     AND paid_on <= $2 AND COALESCE(paid_through, paid_on) >= $3 ORDER BY id`, [sid, last, first]
  );
  if (paid) {
    if (cov.rows.length) return res.json({ ok: true, already: true });
    const amount = Math.round(Number(s.pkg_fee || s.class_fee || 0));
    if (!(amount > 0)) return res.status(400).json({ error: "Chưa cấu hình học phí cho gói/lớp của học viên" });
    await db.query(
      `INSERT INTO payments (branch_id, student_id, category, amount, paid_on, paid_through, note, created_by)
       VALUES ($1,$2,'tuition',$3,$4,$5,$6,$7)`,
      [s.branch_id, sid, amount, first, last, `${NOTE_PREFIX} T${m}/${y}`, req.user.id]
    );
    const curPt = isoDate(s.paid_through);
    if (!curPt || last > curPt) {
      await db.query("UPDATE students SET paid_through = $1 WHERE id = $2", [last, sid]);
    }
    return res.json({ ok: true });
  }
  // paid=false: chỉ xóa khoản do chức năng đánh dấu tạo ra và khớp đúng tháng
  const marked = cov.rows.filter((p) =>
    isoDate(p.paid_on) === first && isoDate(p.paid_through) === last &&
    String(p.note || "").startsWith(NOTE_PREFIX));
  if (!marked.length) {
    const other = cov.rows[0];
    return res.status(400).json({ error: other
      ? `Tháng này thuộc khoản thu ngày ${isoDate(other.paid_on)} — hãy sửa/xóa ở Lịch sử thu phí`
      : "Tháng này chưa được đánh dấu đóng" });
  }
  await db.query(`DELETE FROM payments WHERE id IN (${marked.map((p) => Number(p.id)).join(",")})`);
  // Tính lại paid_through từ các khoản học phí còn lại
  const rest = await db.query(
    `SELECT paid_on, paid_through FROM payments WHERE student_id = $1 AND category = 'tuition'`, [sid]
  );
  let pt = null;
  for (const r of rest.rows) {
    const d = isoDate(r.paid_through) || isoDate(r.paid_on);
    if (d && (!pt || d > pt)) pt = d;
  }
  await db.query("UPDATE students SET paid_through = $1 WHERE id = $2", [pt, sid]);
  res.json({ ok: true });
});

router.post("/", async (req, res) => {
  const { branch_id, student_id, category, amount, paid_on, paid_through, note } = req.body || {};
  if (!branch_id || !amount || Number(amount) <= 0 || !paid_on) {
    return res.status(400).json({ error: "Thiếu chi nhánh / số tiền / ngày thu" });
  }
  if (!CATEGORIES.includes(category)) return res.status(400).json({ error: "Nhóm khoản thu không hợp lệ" });
  const sid = student_id ? Number(student_id) : null;
  if (sid) {
    const cls = await studentClassId(db, sid);
    if (cls === undefined) return res.status(404).json({ error: "Không tìm thấy học viên" });
    if (req.user.role !== "admin" && !cls) {
      return res.status(403).json({ error: "Bạn không được phân công quản lý học viên này" });
    }
    if (cls && !(await assertClassAccess(req, res, cls))) return;
  } else if (req.user.role !== "admin") {
    return res.status(403).json({ error: "Chỉ admin ghi nhận khoản thu không gắn học viên" });
  }
  const { rows } = await db.query(
    `INSERT INTO payments (branch_id, student_id, category, amount, paid_on, paid_through, note, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [Number(branch_id), sid, category, Math.round(Number(amount)), paid_on,
     paid_through || null, (note || "").trim(), req.user.id]
  );
  // Nếu là học phí lớp -> tính lại "HP đến ngày" cho HV
  if (sid && category === "tuition") await recalcPaidThrough(sid);
  res.status(201).json(rows[0]);
});

router.put("/:id", async (req, res) => {
  const cur = await db.query("SELECT * FROM payments WHERE id = $1", [req.params.id]);
  const pay = cur.rows[0];
  if (!pay) return res.status(404).json({ error: "Không tìm thấy khoản thu" });
  if (req.user.role !== "admin" && pay.created_by !== req.user.id) {
    return res.status(403).json({ error: "Không có quyền sửa khoản thu này" });
  }
  const { category, amount, paid_on, paid_through, note } = req.body || {};
  const sets = [], vals = [];
  const push = (col, v) => { sets.push(`${col} = $${sets.length + 1}`); vals.push(v); };
  if (category && CATEGORIES.includes(category)) push("category", category);
  if (amount !== undefined && Number(amount) > 0) push("amount", Math.round(Number(amount)));
  if (paid_on) push("paid_on", paid_on);
  if (paid_through !== undefined) push("paid_through", paid_through || null);
  if (note !== undefined) push("note", String(note).trim());
  if (!sets.length) return res.status(400).json({ error: "Không có gì để cập nhật" });
  vals.push(req.params.id);
  const { rows } = await db.query(
    `UPDATE payments SET ${sets.join(", ")} WHERE id = $${vals.length} RETURNING *`, vals
  );
  if (pay.student_id) await recalcPaidThrough(pay.student_id);
  res.json(rows[0]);
});

router.delete("/:id", async (req, res) => {
  const cur = await db.query("SELECT id, student_id, created_by FROM payments WHERE id = $1", [req.params.id]);
  if (!cur.rows[0]) return res.status(404).json({ error: "Không tìm thấy khoản thu" });
  if (req.user.role !== "admin" && cur.rows[0].created_by !== req.user.id) {
    return res.status(403).json({ error: "Không có quyền xóa khoản thu này" });
  }
  const sid = cur.rows[0].student_id;
  await db.query("DELETE FROM payments WHERE id = $1", [req.params.id]);
  if (sid) await recalcPaidThrough(sid);
  res.json({ ok: true });
});

// Tính lại "HP đến ngày" của HV từ các khoản học phí còn lại
async function recalcPaidThrough(sid) {
  const r = await db.query(
    `SELECT paid_on, paid_through FROM payments WHERE student_id = $1 AND category = 'tuition'`, [sid]
  );
  let pt = null;
  for (const p of r.rows) {
    const d = isoDate(p.paid_through) || isoDate(p.paid_on);
    if (d && (!pt || d > pt)) pt = d;
  }
  await db.query("UPDATE students SET paid_through = $1 WHERE id = $2", [pt, sid]);
}

// Tổng quan doanh thu theo nhóm (chỉ admin)
router.get("/revenue/summary", requireRole("admin"), async (req, res) => {
  const { branch_id, from, to } = req.query;
  const conds = [], vals = [];
  if (branch_id) { conds.push(`branch_id = $${vals.length + 1}`); vals.push(Number(branch_id)); }
  if (from) { conds.push(`paid_on >= $${vals.length + 1}`); vals.push(from); }
  if (to) { conds.push(`paid_on <= $${vals.length + 1}`); vals.push(to); }
  const where = conds.length ? "WHERE " + conds.join(" AND ") : "";
  const { rows } = await db.query(
    `SELECT category, COUNT(*)::int AS count, COALESCE(SUM(amount),0)::int AS total
     FROM payments ${where} GROUP BY category`, vals
  );
  const byCategory = {};
  for (const c of CATEGORIES) byCategory[c] = { count: 0, total: 0 };
  for (const r of rows) byCategory[r.category] = { count: r.count, total: r.total };
  const grand = rows.reduce((a, r) => a + r.total, 0);
  res.json({ byCategory, grandTotal: grand });
});

module.exports = router;
