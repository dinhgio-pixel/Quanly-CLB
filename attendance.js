"use strict";
// Điểm danh: tạo buổi theo lớp+ngày, đánh dấu từng HV, xem % chuyên cần.
const express = require("express");
const db = require("../db");
const { requireAuth } = require("../auth");
const { accessibleClassIds, classIdCondition, assertClassAccess, parseHours } = require("../helpers");

const router = express.Router();
router.use(requireAuth);

// Lấy/cập nhật buổi điểm danh (upsert theo class_id + session_date)
router.post("/sessions", async (req, res) => {
  const { class_id, session_date, note, records } = req.body || {};
  const classId = Number(class_id);
  if (!classId || !session_date) return res.status(400).json({ error: "Thiếu lớp/ngày điểm danh" });
  if (!(await assertClassAccess(req, res, classId))) return;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(session_date)) return res.status(400).json({ error: "Ngày không hợp lệ" });

  let sess = await db.query(
    "SELECT id FROM attendance_sessions WHERE class_id = $1 AND session_date = $2",
    [classId, session_date]
  );
  let sessionId;
  if (sess.rows[0]) {
    sessionId = sess.rows[0].id;
    if (note !== undefined) {
      await db.query("UPDATE attendance_sessions SET note = $1 WHERE id = $2", [String(note), sessionId]);
    }
  } else {
    const ins = await db.query(
      "INSERT INTO attendance_sessions (class_id, session_date, note, created_by) VALUES ($1,$2,$3,$4) RETURNING id",
      [classId, session_date, note || "", req.user.id]
    );
    sessionId = ins.rows[0].id;
  }

  if (Array.isArray(records)) {
    // Chỉ nhận HV thuộc lớp này
    const st = await db.query("SELECT id FROM students WHERE class_id = $1 AND status = 'active'", [classId]);
    const valid = new Set(st.rows.map((r) => r.id));
    for (const r of records) {
      const sid = Number(r.student_id);
      if (!valid.has(sid)) continue;
      const stt = ["present", "absent", "excused"].includes(r.status) ? r.status : "present";
      await db.query(
        `INSERT INTO attendance_records (session_id, student_id, status) VALUES ($1,$2,$3)`,
        [sessionId, sid, stt]
      ).catch(async (e) => {
        // đã có dòng -> cập nhật (tránh ON CONFLICT để tương thích pg-mem)
        if (e.code === "23505") {
          await db.query("UPDATE attendance_records SET status = $1 WHERE session_id = $2 AND student_id = $3", [stt, sessionId, sid]);
        } else throw e;
      });
    }
  }
  // Đồng bộ chấm công HLV: HLV bấm lưu điểm danh = xác nhận buổi dạy.
  // Mỗi HLV/lớp/ngày chỉ ghi 1 lần (tránh trùng khi lưu lại).
  if (req.user.role === "coach") {
    const cls = await db.query("SELECT schedule, branch_id FROM classes WHERE id = $1", [classId]);
    if (cls.rows[0]) {
      const exists = await db.query(
        "SELECT id FROM coach_timesheets WHERE user_id = $1 AND class_id = $2 AND work_date = $3",
        [req.user.id, classId, session_date]
      );
      if (!exists.rows[0]) {
        await db.query(
          `INSERT INTO coach_timesheets (branch_id, user_id, class_id, work_date, hours, note, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [cls.rows[0].branch_id, req.user.id, classId, session_date,
           parseHours(cls.rows[0].schedule), "Tự động từ điểm danh", req.user.id]
        );
      }
    }
  }

  res.json({ ok: true, session_id: sessionId });
});

router.get("/sessions", async (req, res) => {
  const { class_id, from, to } = req.query;
  const ids = await accessibleClassIds(req.user);
  const conds = [], vals = [];
  if (class_id) { conds.push(`s.class_id = $${vals.length + 1}`); vals.push(Number(class_id)); }
  if (from) { conds.push(`s.session_date >= $${vals.length + 1}`); vals.push(from); }
  if (to) { conds.push(`s.session_date <= $${vals.length + 1}`); vals.push(to); }
  if (ids) { conds.push(classIdCondition(ids, "s.class_id")); }
  const where = conds.length ? "WHERE " + conds.join(" AND ") : "";
  const { rows } = await db.query(
    `SELECT s.id, s.class_id, s.session_date, s.note, s.created_by, s.created_at,
      c.name AS class_name,
      SUM(CASE WHEN r.status = 'present' THEN 1 ELSE 0 END)::int AS present_count,
      COUNT(r.id)::int AS total_count
     FROM attendance_sessions s JOIN classes c ON c.id = s.class_id
     LEFT JOIN attendance_records r ON r.session_id = s.id
     ${where}
     GROUP BY s.id, s.class_id, s.session_date, s.note, s.created_by, s.created_at, c.name
     ORDER BY s.session_date DESC, s.id DESC LIMIT 200`, vals
  );
  res.json(rows);
});

router.get("/sessions/:id", async (req, res) => {
  const { rows } = await db.query(
    `SELECT s.*, c.name AS class_name FROM attendance_sessions s
     JOIN classes c ON c.id = s.class_id WHERE s.id = $1`, [req.params.id]
  );
  const sess = rows[0];
  if (!sess) return res.status(404).json({ error: "Không tìm thấy buổi điểm danh" });
  if (!(await assertClassAccess(req, res, sess.class_id))) return;
  const recs = await db.query(
    `SELECT r.student_id, r.status, st.full_name FROM attendance_records r
     JOIN students st ON st.id = r.student_id WHERE r.session_id = $1 ORDER BY st.full_name`,
    [sess.id]
  );
  const roster = await db.query(
    "SELECT id, full_name FROM students WHERE class_id = $1 AND status = 'active' ORDER BY full_name",
    [sess.class_id]
  );
  res.json({ ...sess, records: recs.rows, roster: roster.rows });
});

router.delete("/sessions/:id", async (req, res) => {
  const { rows } = await db.query("SELECT class_id FROM attendance_sessions WHERE id = $1", [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: "Không tìm thấy buổi điểm danh" });
  if (!(await assertClassAccess(req, res, rows[0].class_id))) return;
  await db.query("DELETE FROM attendance_sessions WHERE id = $1", [req.params.id]);
  res.json({ ok: true });
});

// % chuyên cần từng HV của 1 lớp
router.get("/summary", async (req, res) => {
  const classId = Number(req.query.class_id);
  if (!classId) return res.status(400).json({ error: "Thiếu lớp" });
  if (!(await assertClassAccess(req, res, classId))) return;
  const { rows } = await db.query(
    `SELECT st.id, st.full_name,
      COUNT(r.id)::int AS total,
      SUM(CASE WHEN r.status = 'present' THEN 1 ELSE 0 END)::int AS present,
      SUM(CASE WHEN r.status = 'excused' THEN 1 ELSE 0 END)::int AS excused
     FROM students st
     LEFT JOIN attendance_records r ON r.student_id = st.id
     LEFT JOIN attendance_sessions s ON s.id = r.session_id AND s.class_id = $1
     WHERE st.class_id = $1 AND st.status = 'active'
     GROUP BY st.id, st.full_name ORDER BY st.full_name`,
    [classId]
  );
  res.json(rows.map((r) => ({
    ...r,
    rate: r.total ? Math.round((r.present / r.total) * 100) : null,
  })));
});

module.exports = router;
