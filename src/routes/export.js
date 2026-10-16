"use strict";
// Xuất file Excel (.xlsx): danh sách lớp, bảng điểm danh, chấm công HLV
const express = require("express");
const ExcelJS = require("exceljs");
const db = require("../db");
const { requireAuth, requireRole } = require("../auth");
const { assertClassAccess, todayStr } = require("../helpers");

const router = express.Router();
router.use(requireAuth);

function slug(s) {
  return String(s || "export")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase() || "export";
}

function styleHeader(row) {
  row.eachCell((c) => {
    c.font = { bold: true, color: { argb: "FFFFFFFF" } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1B5FCC" } };
    c.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    c.border = { top: { style: "thin" }, left: { style: "thin" }, bottom: { style: "thin" }, right: { style: "thin" } };
  });
  row.height = 28;
}

function styleBody(ws) {
  ws.eachRow((row, n) => {
    if (n === 1) return;
    row.eachCell((c) => {
      c.border = { top: { style: "thin" }, left: { style: "thin" }, bottom: { style: "thin" }, right: { style: "thin" } };
      c.alignment = { vertical: "middle", wrapText: true };
    });
  });
}

async function sendXlsx(res, wb, filename) {
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  await wb.xlsx.write(res);
  res.end();
}

function titleRow(ws, text, ncols) {
  ws.mergeCells(1, 1, 1, ncols);
  const c = ws.getCell(1, 1);
  c.value = text;
  c.font = { bold: true, size: 14, color: { argb: "FF1B5FCC" } };
  c.alignment = { horizontal: "center", vertical: "middle" };
  ws.getRow(1).height = 30;
}

// --- Danh sách học viên của lớp ---
router.get("/students", async (req, res) => {
  const cid = Number(req.query.class_id);
  if (!cid) return res.status(400).json({ error: "Thiếu lớp" });
  if (!(await assertClassAccess(req, res, cid))) return;
  const cls = await db.query("SELECT name, schedule FROM classes WHERE id = $1", [cid]);
  const { rows } = await db.query(
    `SELECT s.full_name, s.dob, s.phone, s.joined_on, s.belt_level, s.status,
            p.name AS package_name, s.paid_through
     FROM students s LEFT JOIN packages p ON p.id = s.package_id
     WHERE s.class_id = $1 AND s.status = 'active' ORDER BY s.full_name`, [cid]
  );
  const wb = new ExcelJS.Workbook();
  wb.creator = "CLB Vovinam";
  const ws = wb.addWorksheet("Danh sach lop");
  const head = ["STT", "Họ tên", "Ngày sinh", "SĐT phụ huynh", "Ngày vào lớp", "Gói", "Cấp đai", "HP đến ngày"];
  titleRow(ws, `DANH SÁCH LỚP ${(cls.rows[0] || {}).name || ""} — ${todayStr()}`.toUpperCase(), head.length);
  ws.addRow([]);
  const hr = ws.addRow(head);
  styleHeader(hr);
  rows.forEach((s, i) => {
    ws.addRow([i + 1, s.full_name, s.dob ? String(s.dob).slice(0, 10) : "",
      s.phone, s.joined_on ? String(s.joined_on).slice(0, 10) : "",
      s.package_name || "", s.belt_level || "",
      s.paid_through ? String(s.paid_through).slice(0, 10) : ""]);
  });
  ws.columns = [{ width: 6 }, { width: 28 }, { width: 13 }, { width: 16 }, { width: 13 }, { width: 16 }, { width: 12 }, { width: 13 }];
  styleBody(ws);
  sendXlsx(res, wb, `danh-sach-lop-${slug((cls.rows[0] || {}).name)}.xlsx`);
});

// --- Bảng điểm danh theo tháng/khoảng ngày ---
router.get("/attendance", async (req, res) => {
  const cid = Number(req.query.class_id);
  if (!cid) return res.status(400).json({ error: "Thiếu lớp" });
  if (!(await assertClassAccess(req, res, cid))) return;
  const month = req.query.month; // YYYY-MM
  const from = req.query.from || (month ? month + "-01" : todayStr().slice(0, 7) + "-01");
  const to = req.query.to || (month ? month + "-31" : todayStr());
  const cls = await db.query("SELECT name FROM classes WHERE id = $1", [cid]);
  const students = await db.query(
    "SELECT id, full_name FROM students WHERE class_id = $1 AND status = 'active' ORDER BY full_name", [cid]
  );
  const sessions = await db.query(
    `SELECT s.id, s.session_date FROM attendance_sessions s
     WHERE s.class_id = $1 AND s.session_date >= $2 AND s.session_date <= $3 ORDER BY s.session_date`,
    [cid, from, to]
  );
  const recs = sessions.rows.length ? (await db.query(
    `SELECT r.session_id, r.student_id, r.status FROM attendance_records r
     WHERE r.session_id = ANY($1::int[])`, [sessions.rows.map((x) => x.id)]
  )).rows : [];
  const bySession = {};
  for (const r of recs) { (bySession[r.session_id] = bySession[r.session_id] || {})[r.student_id] = r.status; }
  const sym = { present: "C", absent: "V", excused: "P" };

  const wb = new ExcelJS.Workbook();
  wb.creator = "CLB Vovinam";
  const ws = wb.addWorksheet("Diem danh");
  const ncols = 2 + sessions.rows.length + 3;
  titleRow(ws, `BẢNG ĐIỂM DANH LỚP ${(cls.rows[0] || {}).name || ""} (${from} → ${to})`.toUpperCase(), ncols);
  ws.addRow([`Chú thích: C = Có mặt, V = Vắng, P = Có phép`]);
  const hr = ws.addRow(["STT", "Họ tên",
    ...sessions.rows.map((s) => String(s.session_date).slice(0, 10).split("-").reverse().join("/")),
    "Có mặt", "Vắng", "Phép"]);
  styleHeader(hr);
  students.rows.forEach((st, i) => {
    let p = 0, a = 0, e = 0;
    const cells = sessions.rows.map((s) => {
      const v = (bySession[s.id] || {})[st.id];
      if (v === "present") p++;
      else if (v === "absent") a++;
      else if (v === "excused") e++;
      return v ? sym[v] : "";
    });
    ws.addRow([i + 1, st.full_name, ...cells, p, a, e]);
  });
  ws.columns = [{ width: 6 }, { width: 28 },
    ...sessions.rows.map(() => ({ width: 9 })), { width: 9 }, { width: 9 }, { width: 9 }];
  styleBody(ws);
  sendXlsx(res, wb, `diem-danh-${slug((cls.rows[0] || {}).name)}-${from.slice(0, 7)}.xlsx`);
});

// --- Chấm công HLV theo tháng (chỉ admin) ---
router.get("/timesheets", requireRole("admin"), async (req, res) => {
  const month = req.query.month || todayStr().slice(0, 7);
  const branchId = Number(req.query.branch_id) || null;
  const vals = [month + "-01", month + "-31"];
  let where = "t.work_date >= $1 AND t.work_date <= $2";
  if (branchId) { vals.push(branchId); where += ` AND t.branch_id = $${vals.length}`; }
  const { rows } = await db.query(
    `SELECT t.work_date, u.full_name AS coach_name, c.name AS class_name, t.hours, t.note
     FROM coach_timesheets t
     JOIN users u ON u.id = t.user_id
     LEFT JOIN classes c ON c.id = t.class_id
     WHERE ${where} ORDER BY u.full_name, t.work_date`, vals
  );
  const sum = {};
  for (const r of rows) {
    const k = r.coach_name || "(không tên)";
    sum[k] = sum[k] || { sessions: 0, hours: 0 };
    sum[k].sessions++;
    sum[k].hours += Number(r.hours);
  }
  const wb = new ExcelJS.Workbook();
  wb.creator = "CLB Vovinam";
  const ws1 = wb.addWorksheet("Tong hop");
  const h1 = ["HLV", "Số buổi", "Tổng giờ"];
  titleRow(ws1, `TỔNG HỢP CHẤM CÔNG THÁNG ${month}`.toUpperCase(), h1.length);
  ws1.addRow([]);
  styleHeader(ws1.addRow(h1));
  Object.entries(sum).sort().forEach(([k, v]) => ws1.addRow([k, v.sessions, Math.round(v.hours * 100) / 100]));
  ws1.columns = [{ width: 30 }, { width: 12 }, { width: 12 }];
  styleBody(ws1);

  const ws2 = wb.addWorksheet("Chi tiet");
  const h2 = ["Ngày", "HLV", "Lớp", "Số giờ", "Ghi chú"];
  titleRow(ws2, `CHI TIẾT CHẤM CÔNG THÁNG ${month}`.toUpperCase(), h2.length);
  ws2.addRow([]);
  styleHeader(ws2.addRow(h2));
  rows.forEach((r) => ws2.addRow([
    String(r.work_date).slice(0, 10).split("-").reverse().join("/"),
    r.coach_name, r.class_name || "", Number(r.hours), r.note || "",
  ]));
  ws2.columns = [{ width: 13 }, { width: 28 }, { width: 22 }, { width: 10 }, { width: 40 }];
  styleBody(ws2);
  sendXlsx(res, wb, `cham-cong-${month}.xlsx`);
});

module.exports = router;
