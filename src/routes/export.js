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

// --- Báo cáo tài chính tháng theo chi nhánh (chỉ admin) ---
const { computePayroll } = require("./payroll");
const REV_LABEL = { tuition: "Học phí lớp", private: "Dạy 1:1", rental: "Cho thuê", performance: "Biểu diễn", other: "Thu khác" };
const EXP_LABEL_X = { salary: "Lương HLV", performance: "Chi phí biểu diễn", other: "Chi khác" };
const PAY_TYPE_LABEL_X = { hourly: "Theo giờ", fixed: "Cố định tháng", revenue_share: "% doanh thu giảng dạy" };
const dFmt = (d) => String(d).slice(0, 10).split("-").reverse().join("/");

router.get("/finance", requireRole("admin"), async (req, res) => {
  const month = req.query.month || todayStr().slice(0, 7);
  const branchId = Number(req.query.branch_id);
  if (!branchId) return res.status(400).json({ error: "Thiếu chi nhánh" });
  const [y, mo] = month.split("-").map(Number);
  if (!y || !mo || mo < 1 || mo > 12) return res.status(400).json({ error: "Tháng không hợp lệ" });
  const start = `${month}-01`;
  const end = mo === 12 ? `${y + 1}-01-01` : `${y}-${String(mo + 1).padStart(2, "0")}-01`;
  const br = await db.query("SELECT name FROM branches WHERE id = $1", [branchId]);
  const branchName = br.rows[0] ? br.rows[0].name : `Chi nhánh ${branchId}`;

  const pays = (await db.query(
    `SELECT p.*, s.full_name AS student_name, cu.full_name AS coach_name
     FROM payments p LEFT JOIN students s ON s.id = p.student_id
     LEFT JOIN users cu ON cu.id = p.coach_id
     WHERE p.branch_id = $1 AND p.paid_on >= $2 AND p.paid_on < $3
     ORDER BY p.paid_on, p.id`, [branchId, start, end])).rows;
  const exps = (await db.query(
    `SELECT e.*, cu.full_name AS coach_name FROM expenses e
     LEFT JOIN users cu ON cu.id = e.coach_id
     WHERE e.branch_id = $1 AND e.paid_on >= $2 AND e.paid_on < $3
     ORDER BY e.paid_on, e.id`, [branchId, start, end])).rows;
  const rents = (await db.query(
    `SELECT * FROM rentals WHERE branch_id = $1 AND rent_date >= $2 AND rent_date < $3
     ORDER BY rent_date, start_time`, [branchId, start, end])).rows;
  const payroll = await computePayroll(branchId, month);

  const revByCat = {}, expByCat = {};
  let totalRev = 0, totalExp = 0;
  for (const p of pays) { revByCat[p.category] = (revByCat[p.category] || 0) + Number(p.amount); totalRev += Number(p.amount); }
  for (const e of exps) { expByCat[e.category] = (expByCat[e.category] || 0) + Number(e.amount); totalExp += Number(e.amount); }
  const teaching = (revByCat.tuition || 0) + (revByCat.private || 0);

  const wb = new ExcelJS.Workbook();
  wb.creator = "CLB Vovinam";

  // Sheet 1: Tổng hợp
  const ws = wb.addWorksheet("Tong hop");
  titleRow(ws, `BÁO CÁO TÀI CHÍNH THÁNG ${month} — ${branchName}`.toUpperCase(), 2);
  ws.addRow([]);
  styleHeader(ws.addRow(["Khoản mục", "Số tiền (đ)"]));
  ws.addRow(["— DOANH THU —", ""]);
  for (const k of Object.keys(REV_LABEL)) ws.addRow([REV_LABEL[k], revByCat[k] || 0]);
  ws.addRow(["Tổng thu", totalRev]);
  ws.addRow(["Trong đó: hoạt động giảng dạy (học phí lớp + dạy 1:1)", teaching]);
  ws.addRow(["— CHI PHÍ —", ""]);
  for (const k of Object.keys(EXP_LABEL_X)) ws.addRow([EXP_LABEL_X[k], expByCat[k] || 0]);
  ws.addRow(["Tổng chi", totalExp]);
  ws.addRow(["CHÊNH LỆCH THU − CHI", totalRev - totalExp]);
  ws.addRow(["Tổng lương HLV (bảng lương)", payroll.totals ? payroll.totals.total_salary : 0]);
  ws.addRow(["Tỷ trọng lương / doanh thu giảng dạy (%)", payroll.totals ? payroll.totals.ratio : ""]);
  ws.columns = [{ width: 52 }, { width: 20 }];
  ws.eachRow((r) => r.eachCell((c) => { if (typeof c.value === "number") c.numFmt = "#,##0"; }));
  styleBody(ws);

  // Sheet 2: Chi tiết thu
  const ws2 = wb.addWorksheet("Chi tiet thu");
  titleRow(ws2, `CHI TIẾT KHOẢN THU THÁNG ${month}`.toUpperCase(), 4);
  ws2.addRow([]);
  styleHeader(ws2.addRow(["Ngày", "Nhóm", "Nội dung", "Số tiền (đ)"]));
  pays.forEach((p) => ws2.addRow([dFmt(p.paid_on), REV_LABEL[p.category] || p.category,
    p.student_name || p.note || "", Number(p.amount)]));
  ws2.addRow(["", "", "Tổng thu", totalRev]);
  ws2.columns = [{ width: 13 }, { width: 16 }, { width: 50 }, { width: 18 }];
  styleBody(ws2);

  // Sheet 3: Chi tiết chi
  const ws3 = wb.addWorksheet("Chi tiet chi");
  titleRow(ws3, `CHI TIẾT KHOẢN CHI THÁNG ${month}`.toUpperCase(), 4);
  ws3.addRow([]);
  styleHeader(ws3.addRow(["Ngày", "Nhóm", "Nội dung", "Số tiền (đ)"]));
  exps.forEach((e) => ws3.addRow([dFmt(e.paid_on), EXP_LABEL_X[e.category] || e.category,
    (e.note || "") + (e.coach_name ? ` — ${e.coach_name}` : ""), Number(e.amount)]));
  ws3.addRow(["", "", "Tổng chi", totalExp]);
  ws3.columns = [{ width: 13 }, { width: 20 }, { width: 55 }, { width: 18 }];
  styleBody(ws3);

  // Sheet 4: Bảng lương
  const ws4 = wb.addWorksheet("Bang luong");
  titleRow(ws4, `BẢNG LƯƠNG HLV THÁNG ${month}`.toUpperCase(), 7);
  ws4.addRow([]);
  styleHeader(ws4.addRow(["HLV", "Kiểu trả", "Giờ dạy", "Thu dạy 1:1", "Phân bổ học phí lớp", "Lương (đ)", "Đã chốt"]));
  (payroll.rows || []).forEach((r) => ws4.addRow([
    r.coach_name, PAY_TYPE_LABEL_X[r.pay_type] || r.pay_type, r.hours,
    r.private_revenue, r.tuition_share, r.salary == null ? "" : r.salary, r.settled ? "Đã chốt" : "Chưa chốt",
  ]));
  ws4.addRow(["", "", "", "", "Tổng lương", payroll.totals ? payroll.totals.total_salary : 0, ""]);
  ws4.columns = [{ width: 28 }, { width: 20 }, { width: 10 }, { width: 16 }, { width: 20 }, { width: 16 }, { width: 12 }];
  styleBody(ws4);

  // Sheet 5: Cho thuê
  const ws5 = wb.addWorksheet("Cho thue");
  titleRow(ws5, `LỊCH CHO THUÊ THÁNG ${month}`.toUpperCase(), 6);
  ws5.addRow([]);
  styleHeader(ws5.addRow(["Ngày", "Khách thuê", "Giờ", "Giá/giờ (đ)", "Thành tiền (đ)", "Trạng thái"]));
  rents.forEach((r) => ws5.addRow([dFmt(r.rent_date), r.renter_name || "",
    `${r.start_time}–${r.end_time}`, Number(r.price_per_hour), Number(r.total_amount),
    r.status === "cancelled" ? "Đã hủy" : r.status === "done" ? "Đã xong" : "Đã đặt"]));
  ws5.columns = [{ width: 13 }, { width: 30 }, { width: 14 }, { width: 15 }, { width: 16 }, { width: 12 }];
  styleBody(ws5);

  sendXlsx(res, wb, `bao-cao-tai-chinh-${slug(branchName)}-${month}.xlsx`);
});

module.exports = router;
