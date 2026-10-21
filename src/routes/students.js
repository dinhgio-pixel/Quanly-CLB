"use strict";
// Học viên: CRUD + tìm kiếm. HLV chỉ thao tác HV trong lớp được gán.
const express = require("express");
const db = require("../db");
const { requireAuth, requireRole } = require("../auth");
const { accessibleClassIds, classIdCondition, assertClassAccess, studentClassId, computeFeeState, todayStr } = require("../helpers");

const router = express.Router();
router.use(requireAuth);

const SELECT = `s.*, c.name AS class_name, p.name AS package_name, p.monthly_fee AS package_fee, p.sessions_per_week AS package_sessions`;

// HLV không được thấy số tiền: ẩn package_fee và amount các khoản thu
function stripMoneyForCoach(s) {
  return { ...s, package_fee: null,
    payments: (s.payments || []).map((p) => ({ ...p, amount: null })) };
}

router.get("/", async (req, res) => {
  const { branch_id, class_id, q, status } = req.query;
  const ids = await accessibleClassIds(req.user);
  const conds = [], vals = [];
  // Học viên chỉ thấy hồ sơ của chính mình
  if (req.user.role === "student") {
    if (!req.user.student_id) return res.json([]);
    conds.push(`s.id = $${vals.length + 1}`); vals.push(req.user.student_id);
  }
  if (branch_id) { conds.push(`s.branch_id = $${vals.length + 1}`); vals.push(Number(branch_id)); }
  if (class_id) { conds.push(`s.class_id = $${vals.length + 1}`); vals.push(Number(class_id)); }
  if (status) { conds.push(`s.status = $${vals.length + 1}`); vals.push(status); }
  if (q) { conds.push(`(s.full_name ILIKE $${vals.length + 1} OR s.phone ILIKE $${vals.length + 1})`); vals.push(`%${q}%`); }
  if (ids) { conds.push(classIdCondition(ids, "s.class_id")); }
  const where = conds.length ? "WHERE " + conds.join(" AND ") : "";
  const { rows } = await db.query(
    `SELECT ${SELECT} FROM students s
     LEFT JOIN classes c ON c.id = s.class_id
     LEFT JOIN packages p ON p.id = s.package_id
     ${where} ORDER BY s.full_name LIMIT 500`, vals
  );
  // Số buổi vắng không phép 30 ngày gần nhất (để HLV theo dõi nhắc nhở)
  let absentMap = {};
  if (rows.length) {
    const ids = rows.map((r) => Number(r.id)).join(",");
    const ab = await db.query(
      `SELECT r.student_id AS sid, COUNT(*)::int AS n FROM attendance_records r
       JOIN attendance_sessions ss ON ss.id = r.session_id
       WHERE r.student_id IN (${ids}) AND r.status = 'absent'
       AND ss.session_date >= CURRENT_DATE - INTERVAL '30 days'
       GROUP BY r.student_id`
    );
    for (const x of ab.rows) absentMap[x.sid] = x.n;
  }
  const today = todayStr();
  res.json(rows.map((s) => ({ ...s, absent_30d: absentMap[s.id] || 0,
    fee_state: s.status === "active" ? computeFeeState(s.paid_through, today) : s.status })));
});

// Hồ sơ của chính học viên đang đăng nhập (kèm chuyên cần cá nhân)
router.get("/me", async (req, res) => {
  if (req.user.role !== "student" || !req.user.student_id) {
    return res.status(403).json({ error: "Chỉ dành cho tài khoản học viên" });
  }
  const { rows } = await db.query(
    `SELECT s.*, c.name AS class_name, c.schedule AS class_schedule, c.room AS class_room
     FROM students s LEFT JOIN classes c ON c.id = s.class_id WHERE s.id = $1`,
    [req.user.student_id]
  );
  const s = rows[0];
  if (!s) return res.status(404).json({ error: "Không tìm thấy hồ sơ học viên" });
  const att = await db.query(
    `SELECT COUNT(r.id)::int AS total,
            SUM(CASE WHEN r.status = 'present' THEN 1 ELSE 0 END)::int AS present,
            SUM(CASE WHEN r.status = 'absent' THEN 1 ELSE 0 END)::int AS absent,
            SUM(CASE WHEN r.status = 'excused' THEN 1 ELSE 0 END)::int AS excused
     FROM attendance_records r WHERE r.student_id = $1`, [s.id]
  );
  const a = att.rows[0] || { total: 0, present: 0, absent: 0, excused: 0 };
  // Số buổi vắng không phép trong 30 ngày gần nhất (để nhắc nhở học viên)
  const recent = await db.query(
    `SELECT COUNT(r.id)::int AS absent_30d FROM attendance_records r
     JOIN attendance_sessions ss ON ss.id = r.session_id
     WHERE r.student_id = $1 AND r.status = 'absent' AND ss.session_date >= CURRENT_DATE - INTERVAL '30 days'`,
    [s.id]
  );
  res.json({ ...s,
    fee_state: s.status === "active" ? computeFeeState(s.paid_through, todayStr()) : s.status,
    attendance: { ...a, rate: a.total ? Math.round((a.present / a.total) * 100) : null,
      absent_30d: (recent.rows[0] || {}).absent_30d || 0 } });
});

// Danh sách yêu cầu xóa học viên (admin: tất cả; HLV: của mình)
router.get("/delete-requests", async (req, res) => {
  if (req.user.role === "student") return res.status(403).json({ error: "Không có quyền" });
  const { branch_id, status } = req.query;
  const conds = [], vals = [];
  if (branch_id) { conds.push(`d.branch_id = $${vals.length + 1}`); vals.push(Number(branch_id)); }
  if (status) { conds.push(`d.status = $${vals.length + 1}`); vals.push(status); }
  if (req.user.role !== "admin") { conds.push(`d.requester_id = $${vals.length + 1}`); vals.push(req.user.id); }
  const where = conds.length ? "WHERE " + conds.join(" AND ") : "";
  const { rows } = await db.query(
    `SELECT d.*, st.full_name AS student_name, c.name AS class_name,
            u.full_name AS requester_name, u.username AS requester_username
     FROM student_delete_requests d
     JOIN students st ON st.id = d.student_id
     LEFT JOIN classes c ON c.id = st.class_id
     JOIN users u ON u.id = d.requester_id
     ${where} ORDER BY d.created_at DESC LIMIT 200`, vals
  );
  res.json(rows);
});

// HLV gửi yêu cầu xóa học viên (kèm giải trình nguyên nhân)
router.post("/delete-requests", async (req, res) => {
  if (req.user.role === "student") return res.status(403).json({ error: "Không có quyền" });
  const { branch_id, student_id, reason } = req.body || {};
  const sid = Number(student_id);
  if (!sid || !String(reason || "").trim()) {
    return res.status(400).json({ error: "Thiếu học viên / nguyên nhân" });
  }
  const cls = await studentClassId(db, sid);
  if (cls === undefined) return res.status(404).json({ error: "Không tìm thấy học viên" });
  if (cls && !(await assertClassAccess(req, res, cls))) return;
  if (req.user.role !== "admin" && !cls) {
    return res.status(403).json({ error: "Bạn không được phân công quản lý học viên này" });
  }
  const dup = await db.query(
    "SELECT id FROM student_delete_requests WHERE student_id = $1 AND status = 'pending'", [sid]
  );
  if (dup.rows[0]) return res.status(400).json({ error: "Đã có yêu cầu đang chờ duyệt cho học viên này" });
  const { rows } = await db.query(
    `INSERT INTO student_delete_requests (branch_id, student_id, requester_id, reason)
     VALUES ($1,$2,$3,$4) RETURNING id, status`,
    [Number(branch_id) || null, sid, req.user.id, String(reason).trim().slice(0, 300)]
  );
  res.status(201).json(rows[0]);
});

// Duyệt yêu cầu xóa (admin) -> HV chuyển sang "đã nghỉ", vào danh sách HV cũ
router.put("/delete-requests/:id/approve", requireRole("admin"), async (req, res) => {
  const { rows } = await db.query("SELECT * FROM student_delete_requests WHERE id = $1", [req.params.id]);
  const d = rows[0];
  if (!d) return res.status(404).json({ error: "Không tìm thấy yêu cầu" });
  if (d.status !== "pending") return res.status(400).json({ error: "Yêu cầu đã được xử lý" });
  const note = String((req.body || {}).review_note || "").slice(0, 300);
  await db.query("UPDATE student_delete_requests SET status='approved', reviewed_by=$1, reviewed_at=NOW(), review_note=$2 WHERE id=$3",
    [req.user.id, note, d.id]);
  await db.query("UPDATE students SET status='stopped', stopped_at=CURRENT_DATE, leave_reason=$1 WHERE id=$2",
    [d.reason, d.student_id]);
  res.json({ ok: true });
});

// Từ chối yêu cầu xóa (admin)
router.put("/delete-requests/:id/reject", requireRole("admin"), async (req, res) => {
  const { rows } = await db.query("SELECT id, status FROM student_delete_requests WHERE id = $1", [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: "Không tìm thấy yêu cầu" });
  if (rows[0].status !== "pending") return res.status(400).json({ error: "Yêu cầu đã được xử lý" });
  const note = String((req.body || {}).review_note || "").slice(0, 300);
  await db.query("UPDATE student_delete_requests SET status='rejected', reviewed_by=$1, reviewed_at=NOW(), review_note=$2 WHERE id=$3",
    [req.user.id, note, req.params.id]);
  res.json({ ok: true });
});

router.get("/:id", async (req, res) => {
  const { rows } = await db.query(
    `SELECT ${SELECT} FROM students s
     LEFT JOIN classes c ON c.id = s.class_id
     LEFT JOIN packages p ON p.id = s.package_id
     WHERE s.id = $1`, [req.params.id]
  );
  const s = rows[0];
  if (!s) return res.status(404).json({ error: "Không tìm thấy học viên" });
  if (req.user.role === "student") {
    if (Number(req.params.id) !== req.user.student_id) {
      return res.status(403).json({ error: "Không có quyền xem hồ sơ này" });
    }
  } else if (!(await assertClassAccess(req, res, s.class_id))) return;
  const pays = await db.query(
    "SELECT * FROM payments WHERE student_id = $1 ORDER BY paid_on DESC, id DESC", [s.id]
  );
  let out = {
    ...s,
    fee_state: s.status === "active" ? computeFeeState(s.paid_through, todayStr()) : s.status,
    payments: pays.rows,
  };
  if (req.user.role === "coach") out = stripMoneyForCoach(out);
  res.json(out);
});

function pickStudentBody(b) {
  // undefined = không gửi -> không động tới; null = xóa trắng có chủ đích
  const numOrNull = (v) => v === undefined ? undefined : (v === null || v === "" ? null : Number(v));
  const dateOrNull = (v) => v === undefined ? undefined : (v || null);
  return {
    branch_id: b.branch_id !== undefined ? Number(b.branch_id) : undefined,
    class_id: numOrNull(b.class_id),
    package_id: numOrNull(b.package_id),
    full_name: b.full_name !== undefined ? String(b.full_name).trim() : undefined,
    dob: dateOrNull(b.dob),
    phone: b.phone !== undefined ? String(b.phone).trim() : undefined,
    joined_on: dateOrNull(b.joined_on),
    paid_through: dateOrNull(b.paid_through),
    height_cm: b.height_cm === undefined || b.height_cm === "" ? undefined : Number(b.height_cm),
    weight_kg: b.weight_kg === undefined || b.weight_kg === "" ? undefined : Number(b.weight_kg),
    health_note: b.health_note !== undefined ? String(b.health_note) : undefined,
    belt_level: b.belt_level !== undefined ? String(b.belt_level).trim() : undefined,
    leave_reason: b.leave_reason !== undefined ? String(b.leave_reason).trim() : undefined,
    status: b.status,
  };
}

router.post("/", async (req, res) => {
  if (req.user.role === "student") return res.status(403).json({ error: "Không có quyền" });
  const b = pickStudentBody(req.body || {});
  if (!b.branch_id || !b.full_name || !b.joined_on) {
    return res.status(400).json({ error: "Thiếu chi nhánh / họ tên / ngày vào lớp" });
  }
  if (b.class_id && !(await assertClassAccess(req, res, b.class_id))) return;
  if (b.status && !["active", "paused", "stopped"].includes(b.status)) {
    return res.status(400).json({ error: "Trạng thái không hợp lệ" });
  }
  const { rows } = await db.query(
    `INSERT INTO students (branch_id, class_id, package_id, full_name, dob, phone, joined_on,
      paid_through, height_cm, weight_kg, health_note, belt_level, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
    [b.branch_id, b.class_id ?? null, b.package_id ?? null, b.full_name, b.dob ?? null, b.phone || "",
     b.joined_on, b.paid_through ?? null,
     b.height_cm ?? null,
     b.weight_kg ?? null,
     b.health_note || "", b.belt_level || "", b.status || "active"]
  );
  res.status(201).json(rows[0]);
});

router.put("/:id", async (req, res) => {
  if (req.user.role === "student") return res.status(403).json({ error: "Không có quyền" });
  const id = Number(req.params.id);
  const cls = await studentClassId(db, id);
  if (cls === undefined) return res.status(404).json({ error: "Không tìm thấy học viên" });
  if (req.user.role !== "admin" && !cls) {
    return res.status(403).json({ error: "Bạn không được phân công quản lý học viên này" });
  }
  if (cls && !(await assertClassAccess(req, res, cls))) return;
  const b = pickStudentBody(req.body || {});
  if (b.class_id && !(await assertClassAccess(req, res, b.class_id))) return;
  const sets = [], vals = [];
  const push = (col, v) => { sets.push(`${col} = $${sets.length + 1}`); vals.push(v); };
  if (b.branch_id !== undefined) push("branch_id", b.branch_id);
  if (b.class_id !== undefined) push("class_id", b.class_id);
  if (b.package_id !== undefined) push("package_id", b.package_id);
  if (b.full_name !== undefined) push("full_name", b.full_name);
  if (b.dob !== undefined) push("dob", b.dob);
  if (b.phone !== undefined) push("phone", b.phone);
  if (b.joined_on !== undefined) push("joined_on", b.joined_on);
  if (b.paid_through !== undefined) push("paid_through", b.paid_through);
  if (b.height_cm !== undefined) push("height_cm", b.height_cm);
  if (b.weight_kg !== undefined) push("weight_kg", b.weight_kg);
  if (b.health_note !== undefined) push("health_note", b.health_note);
  if (b.belt_level !== undefined) push("belt_level", b.belt_level);
  if (b.leave_reason !== undefined) push("leave_reason", b.leave_reason);
  if (b.status && ["active", "paused", "stopped"].includes(b.status)) {
    push("status", b.status);
    // Chuyển sang nghỉ -> ghi ngày nghỉ
    if (b.status === "stopped") push("stopped_at", todayStr());
    if (b.status !== "stopped") push("stopped_at", null);
  }
  if (!sets.length) return res.status(400).json({ error: "Không có gì để cập nhật" });
  vals.push(id);
  const { rows } = await db.query(
    `UPDATE students SET ${sets.join(", ")} WHERE id = $${vals.length} RETURNING *`, vals
  );
  res.json(rows[0]);
});

// Chuyển lớp cho học viên (admin tự do; HLV chỉ chuyển HV thuộc lớp mình dạy, lớp đích bất kỳ đang hoạt động)
router.post("/:id/transfer", async (req, res) => {
  if (req.user.role === "student") return res.status(403).json({ error: "Không có quyền" });
  const id = Number(req.params.id);
  const targetId = Number((req.body || {}).class_id);
  if (!targetId) return res.status(400).json({ error: "Chưa chọn lớp đích" });
  const cur = await db.query("SELECT id, class_id FROM students WHERE id = $1", [id]);
  const st = cur.rows[0];
  if (!st) return res.status(404).json({ error: "Không tìm thấy học viên" });
  if (Number(st.class_id) === targetId) return res.status(400).json({ error: "Học viên đã ở lớp này" });
  if (req.user.role !== "admin" && !(await assertClassAccess(req, res, st.class_id))) return;
  const tc = await db.query("SELECT id, branch_id, status FROM classes WHERE id = $1", [targetId]);
  const tcls = tc.rows[0];
  if (!tcls) return res.status(404).json({ error: "Không tìm thấy lớp đích" });
  if (tcls.status !== "active") return res.status(400).json({ error: "Lớp đích không còn hoạt động" });
  const { rows } = await db.query(
    "UPDATE students SET class_id = $1, branch_id = $2 WHERE id = $3 RETURNING *",
    [targetId, tcls.branch_id, id]
  );
  res.json(rows[0]);
});

router.delete("/:id", requireRole("admin"), async (req, res) => {
  const id = Number(req.params.id);
  const { rows } = await db.query("SELECT id FROM students WHERE id = $1", [id]);
  if (!rows[0]) return res.status(404).json({ error: "Không tìm thấy học viên" });
  // Xóa mềm: chuyển sang "đã nghỉ" để lưu vào danh sách học viên cũ (giữ lịch sử thu phí)
  const reason = String((req.body || {}).reason || "").trim().slice(0, 300);
  await db.query(
    "UPDATE students SET status = 'stopped', stopped_at = CURRENT_DATE, leave_reason = $1 WHERE id = $2",
    [reason, id]
  );
  res.json({ ok: true });
});

module.exports = router;
