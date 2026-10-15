"use strict";
// Chấm công HLV theo buổi và giờ dạy.
// Quyền: admin CRUD toàn bộ; HLV chỉ xem giờ của chính mình.
const express = require("express");
const db = require("../db");
const { requireAuth, requireRole } = require("../auth");

const router = express.Router();
router.use(requireAuth);

function monthRange(month) {
  // "2026-10" -> [2026-10-01, 2026-11-01)
  const m = /^\d{4}-\d{2}$/.test(month || "") ? month : new Date().toISOString().slice(0, 7);
  const [y, mo] = m.split("-").map(Number);
  const start = `${m}-01`;
  const next = mo === 12 ? `${y + 1}-01-01` : `${y}-${String(mo + 1).padStart(2, "0")}-01`;
  return [start, next];
}

async function scopedUserId(req) {
  // HLV chỉ được xem của chính mình
  return req.user.role === "admin" ? null : req.user.id;
}

// Danh sách buổi dạy
router.get("/", async (req, res) => {
  const { branch_id, user_id, class_id, month } = req.query;
  const own = await scopedUserId(req);
  const [from, to] = monthRange(month);
  const conds = [`t.work_date >= $1`, `t.work_date < $2`];
  const vals = [from, to];
  if (branch_id) { conds.push(`t.branch_id = $${vals.length + 1}`); vals.push(Number(branch_id)); }
  const uid = own || Number(user_id) || 0;
  if (uid) { conds.push(`t.user_id = $${vals.length + 1}`); vals.push(uid); }
  if (class_id) { conds.push(`t.class_id = $${vals.length + 1}`); vals.push(Number(class_id)); }
  const { rows } = await db.query(
    `SELECT t.id, t.branch_id, t.user_id, t.class_id, t.work_date, t.hours, t.note,
            t.created_by, t.created_at,
            u.full_name AS coach_name, u.username AS coach_username,
            c.name AS class_name
     FROM coach_timesheets t
     JOIN users u ON u.id = t.user_id
     LEFT JOIN classes c ON c.id = t.class_id
     WHERE ${conds.join(" AND ")}
     ORDER BY t.work_date DESC, t.id DESC LIMIT 500`, vals
  );
  res.json(rows);
});

// Tổng hợp giờ dạy theo HLV trong 1 tháng
router.get("/summary", async (req, res) => {
  const { branch_id, month } = req.query;
  const own = await scopedUserId(req);
  const [from, to] = monthRange(month);
  const vals = [from, to];
  let joinExtra = "";
  if (branch_id) { vals.push(Number(branch_id)); joinExtra = `AND t.branch_id = $${vals.length}`; }
  const conds = ["u.role = 'coach'", "u.status = 'active'"];
  if (own) { vals.push(own); conds.push(`u.id = $${vals.length}`); }
  const { rows } = await db.query(
    `SELECT u.id, u.username, u.full_name,
            COUNT(t.id)::int AS sessions,
            COALESCE(SUM(t.hours), 0)::float AS total_hours
     FROM users u
     LEFT JOIN coach_timesheets t
       ON t.user_id = u.id AND t.work_date >= $1 AND t.work_date < $2 ${joinExtra}
     WHERE ${conds.join(" AND ")}
     GROUP BY u.id, u.username, u.full_name
     ORDER BY u.full_name, u.username`, vals
  );
  res.json(rows);
});

// Thêm buổi dạy (admin)
router.post("/", requireRole("admin"), async (req, res) => {
  const { branch_id, user_id, class_id, work_date, hours, note } = req.body || {};
  const uid = Number(user_id);
  const h = Number(hours);
  if (!branch_id || !uid || !work_date) {
    return res.status(400).json({ error: "Thiếu chi nhánh / HLV / ngày dạy" });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(work_date)) return res.status(400).json({ error: "Ngày không hợp lệ" });
  if (!(h > 0) || h > 24) return res.status(400).json({ error: "Số giờ phải từ 0.5 đến 24" });
  // HLV phải là tài khoản coach còn hoạt động
  const cu = await db.query("SELECT id FROM users WHERE id = $1 AND role = 'coach' AND status = 'active'", [uid]);
  if (!cu.rows[0]) return res.status(400).json({ error: "HLV không hợp lệ" });
  // Lớp (nếu có) phải thuộc chi nhánh
  const cid = Number(class_id) || null;
  if (cid) {
    const cc = await db.query("SELECT id FROM classes WHERE id = $1 AND branch_id = $2", [cid, Number(branch_id)]);
    if (!cc.rows[0]) return res.status(400).json({ error: "Lớp không thuộc chi nhánh này" });
  }
  const { rows } = await db.query(
    `INSERT INTO coach_timesheets (branch_id, user_id, class_id, work_date, hours, note, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     RETURNING id, branch_id, user_id, class_id, work_date, hours, note`,
    [Number(branch_id), uid, cid, work_date, h, String(note || ""), req.user.id]
  );
  res.status(201).json(rows[0]);
});

// Sửa buổi dạy (admin)
router.put("/:id", requireRole("admin"), async (req, res) => {
  const { rows } = await db.query("SELECT id FROM coach_timesheets WHERE id = $1", [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: "Không tìm thấy bản chấm công" });
  const { class_id, work_date, hours, note } = req.body || {};
  const sets = [], vals = [];
  if (class_id !== undefined) { sets.push(`class_id = $${sets.length + 1}`); vals.push(Number(class_id) || null); }
  if (work_date !== undefined) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(work_date)) return res.status(400).json({ error: "Ngày không hợp lệ" });
    sets.push(`work_date = $${sets.length + 1}`); vals.push(work_date);
  }
  if (hours !== undefined) {
    const h = Number(hours);
    if (!(h > 0) || h > 24) return res.status(400).json({ error: "Số giờ phải từ 0.5 đến 24" });
    sets.push(`hours = $${sets.length + 1}`); vals.push(h);
  }
  if (note !== undefined) { sets.push(`note = $${sets.length + 1}`); vals.push(String(note)); }
  if (!sets.length) return res.status(400).json({ error: "Không có gì để sửa" });
  vals.push(req.params.id);
  const upd = await db.query(
    `UPDATE coach_timesheets SET ${sets.join(", ")} WHERE id = $${vals.length}
     RETURNING id, branch_id, user_id, class_id, work_date, hours, note`, vals
  );
  res.json(upd.rows[0]);
});

// Xóa buổi dạy (admin)
router.delete("/:id", requireRole("admin"), async (req, res) => {
  const { rows } = await db.query("SELECT id FROM coach_timesheets WHERE id = $1", [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: "Không tìm thấy bản chấm công" });
  await db.query("DELETE FROM coach_timesheets WHERE id = $1", [req.params.id]);
  res.json({ ok: true });
});

module.exports = router;
