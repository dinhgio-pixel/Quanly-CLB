"use strict";
// Logic dùng chung: trạng thái học phí + phân quyền HLV theo lớp.
const { getCoachClassIds } = require("./auth");

// Chuẩn hóa giá trị ngày về 'YYYY-MM-DD' (pg trả string, pg-mem có thể trả Date)
function isoDate(v) {
  if (!v) return null;
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  const s = String(v).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

// Trạng thái học phí của 1 học viên (chỉ xét khi đang học):
// paid: đã đóng | due_soon: sắp hết hạn | overdue: quá hạn | unpaid: chưa đóng
function computeFeeState(paidThrough, todayStr) {
  const pt = isoDate(paidThrough);
  if (!pt) return "unpaid";
  if (pt < todayStr) return "overdue";
  const d = new Date(todayStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + 7);
  const limit = d.toISOString().slice(0, 10);
  if (pt <= limit) return "due_soon";
  return "paid";
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

// Đọc số giờ dạy từ chuỗi lịch lớp, vd "T2/4/6 17:00–18:30 · Tầng 4" -> 1.5.
// Không đọc được -> mặc định 1.5 giờ.
function parseHours(schedule) {
  const m = String(schedule || "").match(/(\d{1,2}):(\d{2})\s*[–—-]\s*(\d{1,2}):(\d{2})/);
  if (!m) return 1.5;
  const start = Number(m[1]) * 60 + Number(m[2]);
  let end = Number(m[3]) * 60 + Number(m[4]);
  if (end <= start) end += 24 * 60; // ca qua nửa đêm
  const h = (end - start) / 60;
  if (!(h > 0) || h > 24) return 1.5;
  return Math.round(h * 10) / 10;
}

// null = admin (toàn quyền); mảng rỗng = HLV chưa được gán lớp nào
async function accessibleClassIds(user) {
  if (user.role === "admin") return null;
  return getCoachClassIds(user.id);
}

// Điều kiện SQL lọc theo lớp (dùng IN với số nguyên đã kiểm tra -> an toàn, tương thích pg-mem)
function classIdCondition(ids, col) {
  if (ids === null) return "";
  const clean = (ids || []).map(Number).filter((n) => Number.isInteger(n));
  if (!clean.length) return "1=0";
  return `${col} IN (${clean.join(",")})`;
}

async function assertClassAccess(req, res, classId) {
  if (req.user.role === "admin") return true;
  const ids = await getCoachClassIds(req.user.id);
  if (!ids.includes(Number(classId))) {
    res.status(403).json({ error: "Bạn không được phân công quản lý lớp này" });
    return false;
  }
  return true;
}

// Lấy class_id của 1 học viên (để kiểm tra quyền HLV khi thao tác theo HV)
async function studentClassId(db, studentId) {
  const { rows } = await db.query("SELECT class_id FROM students WHERE id = $1", [studentId]);
  return rows[0] ? rows[0].class_id : null;
}

module.exports = { computeFeeState, isoDate, todayStr, parseHours, accessibleClassIds, classIdCondition, assertClassAccess, studentClassId };
