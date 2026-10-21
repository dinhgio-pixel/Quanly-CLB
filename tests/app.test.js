"use strict";
// Test end-to-end trên pg-mem (không cần Postgres thật):
// migrate schema -> seed -> login admin -> CRUD học viên -> thu phí ->
// điểm danh -> tổng quan doanh thu -> phân quyền HLV.
const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const { newDb } = require("pg-mem");
const request = require("supertest");
const { setPool } = require("../src/db");
const { createApp } = require("../src/app");

process.env.JWT_SECRET = "test-secret-khong-dung-production";

let app, adminToken, coachToken;

async function loginAs(username, password) {
  const r = await request(app).post("/api/auth/login").send({ username, password });
  assert.equal(r.status, 200, "login " + username);
  return r.body.token;
}

describe("Quản lý CLB Vovinam (production)", () => {
  before(async () => {
    const mem = newDb();
    const pg = mem.adapters.createPg();
    setPool(new pg.Pool());
    app = createApp();
    const { query } = require("../src/db");
    await query(fs.readFileSync(path.join(__dirname, "..", "schema.sql"), "utf8"));
    await query(fs.readFileSync(path.join(__dirname, "..", "seed.sql"), "utf8"));
    adminToken = await loginAs("admin", "admin123");
  });

  after(async () => {
    const { closePool } = require("../src/db");
    await closePool();
  });

  it("seed đủ 38 học viên / 3 lớp / 4 gói", async () => {
    const { query } = require("../src/db");
    const s = await query("SELECT COUNT(*)::int n FROM students");
    const c = await query("SELECT COUNT(*)::int n FROM classes");
    const p = await query("SELECT COUNT(*)::int n FROM packages");
    assert.equal(s.rows[0].n, 38);
    assert.equal(c.rows[0].n, 3);
    assert.equal(p.rows[0].n, 4);
  });

  it("sai mật khẩu -> 401; không token -> 401", async () => {
    const bad = await request(app).post("/api/auth/login").send({ username: "admin", password: "sai" });
    assert.equal(bad.status, 401);
    const noAuth = await request(app).get("/api/students");
    assert.equal(noAuth.status, 401);
  });

  it("CRUD học viên", async () => {
    const auth = { Authorization: "Bearer " + adminToken };
    const created = await request(app).post("/api/students").set(auth).send({
      branch_id: 1, class_id: 2, package_id: 1, full_name: "HV Test",
      phone: "0900000000", joined_on: "2026-10-13", paid_through: "2026-10-31",
    });
    assert.equal(created.status, 201);
    const id = created.body.id;

    const got = await request(app).get("/api/students/" + id).set(auth);
    assert.equal(got.status, 200);
    assert.equal(got.body.full_name, "HV Test");
    assert.equal(got.body.fee_state, "paid");

    const upd = await request(app).put("/api/students/" + id).set(auth).send({
      package_id: 3, height_cm: 120, weight_kg: 25, health_note: "Dị ứng nhẹ",
    });
    assert.equal(upd.status, 200);
    assert.equal(upd.body.package_id, 3);

    const search = await request(app).get("/api/students?q=HV%20Test").set(auth);
    assert.ok(search.body.some((s) => s.id === id));

    const del = await request(app).delete("/api/students/" + id).set(auth);
    assert.equal(del.status, 200);
    // Xóa mềm: HV chuyển sang "đã nghỉ", vẫn xem được nhưng không còn trong danh sách đang học
    const gone = await request(app).get("/api/students/" + id).set(auth);
    assert.equal(gone.status, 200);
    assert.equal(gone.body.status, "stopped");
    const former = await request(app).get("/api/students?branch_id=1&status=stopped").set(auth);
    assert.ok(former.body.some((s) => s.id === id));
  });

  it("ghi nhận thu phí + cập nhật HP đã đóng + tổng quan doanh thu", async () => {
    const auth = { Authorization: "Bearer " + adminToken };
    const pay = await request(app).post("/api/payments").set(auth).send({
      branch_id: 1, student_id: 1, category: "tuition",
      amount: 600000, paid_on: "2026-10-13", paid_through: "2026-11-30", note: "test",
    });
    assert.equal(pay.status, 201);

    const st = await request(app).get("/api/students/1").set(auth);
    assert.equal(String(st.body.paid_through).slice(0, 10), "2026-11-30");

    const sum = await request(app)
      .get("/api/payments/revenue/summary?branch_id=1&from=2026-10-01&to=2026-10-31").set(auth);
    assert.equal(sum.body.byCategory.tuition.total, 600000);
    assert.equal(sum.body.grandTotal, 600000);
  });

  it("điểm danh + % chuyên cần", async () => {
    const auth = { Authorization: "Bearer " + adminToken };
    const date = "2026-10-13";
    const save = await request(app).post("/api/attendance/sessions").set(auth).send({
      class_id: 2, session_date: date,
      records: [
        { student_id: 9, status: "present" },
        { student_id: 10, status: "absent" },
        { student_id: 11, status: "excused" },
      ],
    });
    assert.equal(save.status, 200);

    const sum = await request(app).get("/api/attendance/summary?class_id=2").set(auth);
    const r9 = sum.body.find((r) => r.id === 9);
    assert.equal(r9.present, 1);
    assert.equal(r9.rate, 100);
  });

  it("nhật ký giảng dạy CRUD", async () => {
    const auth = { Authorization: "Bearer " + adminToken };
    const c = await request(app).post("/api/teaching-logs").set(auth).send({
      class_id: 2, log_date: "2026-10-13", content: "Ôn đòn tay 1-5",
    });
    assert.equal(c.status, 201);
    const list = await request(app).get("/api/teaching-logs?class_id=2").set(auth);
    assert.ok(list.body.some((l) => l.id === c.body.id));
    const del = await request(app).delete("/api/teaching-logs/" + c.body.id).set(auth);
    assert.equal(del.status, 200);
  });

  it("phân quyền HLV theo lớp", async () => {
    const auth = { Authorization: "Bearer " + adminToken };
    // tạo HLV + gán lớp Kid 1 (id 2)
    const u = await request(app).post("/api/users").set(auth).send({
      username: "hlv_test", password: "hlv123", role: "coach", full_name: "HLV Test",
    });
    assert.equal(u.status, 201);
    await request(app).put(`/api/users/${u.body.id}/classes`).set(auth).send({ classIds: [2] });
    coachToken = await loginAs("hlv_test", "hlv123");
    const cauth = { Authorization: "Bearer " + coachToken };

    const classes = await request(app).get("/api/classes").set(cauth);
    assert.equal(classes.body.length, 1);
    assert.equal(classes.body[0].id, 2);

    const students = await request(app).get("/api/students").set(cauth);
    assert.ok(students.body.length > 0);
    assert.ok(students.body.every((s) => s.class_id === 2));

    // HLV không được thêm HV vào lớp khác
    const denied = await request(app).post("/api/students").set(cauth).send({
      branch_id: 1, class_id: 3, full_name: "Không được", joined_on: "2026-10-13",
    });
    assert.equal(denied.status, 403);

    // HLV không vào được mục quản trị
    const noAdmin = await request(app).get("/api/users").set(cauth);
    assert.equal(noAdmin.status, 403);
  });

  it("dashboard trả đủ số liệu", async () => {
    const auth = { Authorization: "Bearer " + adminToken };
    const d = await request(app).get("/api/dashboard?branch_id=1").set(auth);
    assert.equal(d.status, 200);
    assert.equal(d.body.totals.activeStudents, 38);
    assert.equal(d.body.totals.classes, 3);
    assert.ok(Array.isArray(d.body.overdue));
    assert.ok(d.body.revenueThisMonth);
  });

  it("chấm công HLV: admin CRUD + tổng hợp tháng; HLV chỉ xem giờ của mình", async () => {
    const auth = { Authorization: "Bearer " + adminToken };
    const cauth = { Authorization: "Bearer " + coachToken };
    const { query } = require("../src/db");
    const cu = await query("SELECT id FROM users WHERE username = 'hlv_test'");
    assert.ok(cu.rows[0], "có HLV test");
    const coachId = cu.rows[0].id;

    // admin chấm công cho HLV
    const t1 = await request(app).post("/api/timesheets").set(auth).send({
      branch_id: 1, user_id: coachId, class_id: 2, work_date: "2026-10-15", hours: 1.5, note: "Dạy Kid 1",
    });
    assert.equal(t1.status, 201);
    assert.equal(Number(t1.body.hours), 1.5);

    // giờ không hợp lệ -> 400
    const bad = await request(app).post("/api/timesheets").set(auth).send({
      branch_id: 1, user_id: coachId, work_date: "2026-10-15", hours: 30,
    });
    assert.equal(bad.status, 400);

    // HLV không được tự chấm công
    const denied = await request(app).post("/api/timesheets").set(cauth).send({
      branch_id: 1, user_id: coachId, work_date: "2026-10-15", hours: 2,
    });
    assert.equal(denied.status, 403);

    // HLV xem được danh sách giờ của mình
    const list = await request(app).get("/api/timesheets?month=2026-10").set(cauth);
    assert.equal(list.status, 200);
    assert.ok(list.body.length > 0);
    assert.ok(list.body.every((r) => r.user_id === coachId));
    assert.equal(list.body[0].coach_name, "HLV Test");
    assert.equal(list.body[0].class_name, "Kid 1");

    // HLV chỉ thấy tổng hợp của mình
    const csum = await request(app).get("/api/timesheets/summary?month=2026-10&branch_id=1").set(cauth);
    assert.equal(csum.status, 200);
    assert.ok(csum.body.every((r) => r.id === coachId));

    // admin thấy tổng hợp tất cả, đúng 1.5 giờ / 1 buổi
    const sum = await request(app).get("/api/timesheets/summary?month=2026-10&branch_id=1").set(auth);
    assert.equal(sum.status, 200);
    const row = sum.body.find((r) => r.id === coachId);
    assert.ok(row);
    assert.equal(row.sessions, 1);
    assert.equal(Number(row.total_hours), 1.5);

    // admin sửa giờ -> 2, rồi xóa
    const upd = await request(app).put("/api/timesheets/" + t1.body.id).set(auth).send({ hours: 2 });
    assert.equal(upd.status, 200);
    assert.equal(Number(upd.body.hours), 2);
    const del = await request(app).delete("/api/timesheets/" + t1.body.id).set(auth);
    assert.equal(del.status, 200);
    const sum2 = await request(app).get("/api/timesheets/summary?month=2026-10&branch_id=1").set(auth);
    const row2 = sum2.body.find((r) => r.id === coachId);
    assert.equal(Number(row2.total_hours), 0);
    assert.equal(row2.sessions, 0);
  });

  it("điểm danh tự đồng bộ chấm công HLV", async () => {
    const { parseHours } = require("../src/helpers");
    assert.equal(parseHours("T2/4/6 17:00–18:30 · Tầng 4"), 1.5);
    assert.equal(parseHours("T3/5 18:00-19:30"), 1.5);
    assert.equal(parseHours("không có giờ"), 1.5);

    const auth = { Authorization: "Bearer " + adminToken };
    const cauth = { Authorization: "Bearer " + coachToken };
    const { query } = require("../src/db");
    const cu = await query("SELECT id FROM users WHERE username = 'hlv_test'");
    const coachId = cu.rows[0].id;
    const st = await query("SELECT id FROM students WHERE class_id = 2 AND status = 'active' LIMIT 2");
    const date = "2026-10-16";

    // HLV lưu điểm danh -> tự tạo 1 dòng chấm công 1.5 giờ (lịch Kid 1: 17:00–18:30)
    const save = await request(app).post("/api/attendance/sessions").set(cauth).send({
      class_id: 2, session_date: date,
      records: st.rows.map((r) => ({ student_id: r.id, status: "present" })),
    });
    assert.equal(save.status, 200);
    let ts = await query(
      "SELECT hours, note FROM coach_timesheets WHERE user_id = $1 AND class_id = 2 AND work_date = $2",
      [coachId, date]
    );
    assert.equal(ts.rows.length, 1);
    assert.equal(Number(ts.rows[0].hours), 1.5);
    assert.equal(ts.rows[0].note, "Tự động từ điểm danh");

    // lưu lại lần nữa -> không tạo trùng
    await request(app).post("/api/attendance/sessions").set(cauth).send({
      class_id: 2, session_date: date, records: [],
    });
    ts = await query(
      "SELECT COUNT(*)::int n FROM coach_timesheets WHERE user_id = $1 AND class_id = 2 AND work_date = $2",
      [coachId, date]
    );
    assert.equal(ts.rows[0].n, 1);

    // admin lưu điểm danh -> không tự tạo chấm công (tránh ghi nhầm)
    const date2 = "2026-10-17";
    const asave = await request(app).post("/api/attendance/sessions").set(auth).send({
      class_id: 2, session_date: date2, records: [],
    });
    assert.equal(asave.status, 200);
    const ts2 = await query("SELECT COUNT(*)::int n FROM coach_timesheets WHERE work_date = $1", [date2]);
    assert.equal(ts2.rows[0].n, 0);
  });

  it("nhiều HLV cùng lớp: ai điểm danh bằng tài khoản mình thì người đó được chấm công", async () => {
    const auth = { Authorization: "Bearer " + adminToken };
    const { query } = require("../src/db");
    // tạo HLV thứ 2, gán cùng lớp Kid 1 (id 2)
    const u2 = await request(app).post("/api/users").set(auth).send({
      username: "hlv_test2", password: "hlv123", role: "coach", full_name: "HLV Test 2",
    });
    assert.equal(u2.status, 201);
    await request(app).put(`/api/users/${u2.body.id}/classes`).set(auth).send({ classIds: [2] });
    const login2 = await request(app).post("/api/auth/login").send({ username: "hlv_test2", password: "hlv123" });
    const c2auth = { Authorization: "Bearer " + login2.body.token };
    const cauth = { Authorization: "Bearer " + coachToken };
    const st = await query("SELECT id FROM students WHERE class_id = 2 AND status = 'active' LIMIT 1");

    // HLV 1 điểm danh ngày 18/10 -> chấm công cho HLV 1
    const s1 = await request(app).post("/api/attendance/sessions").set(cauth).send({
      class_id: 2, session_date: "2026-10-18",
      records: [{ student_id: st.rows[0].id, status: "present" }],
    });
    assert.equal(s1.status, 200);
    // HLV 2 điểm danh ngày 19/10 -> chấm công cho HLV 2
    const s2 = await request(app).post("/api/attendance/sessions").set(c2auth).send({
      class_id: 2, session_date: "2026-10-19",
      records: [{ student_id: st.rows[0].id, status: "present" }],
    });
    assert.equal(s2.status, 200);

    const cu1 = await query("SELECT id FROM users WHERE username = 'hlv_test'");
    const t1 = await query("SELECT COUNT(*)::int n FROM coach_timesheets WHERE user_id = $1 AND work_date = '2026-10-18'", [cu1.rows[0].id]);
    const t2 = await query("SELECT COUNT(*)::int n FROM coach_timesheets WHERE user_id = $1 AND work_date = '2026-10-19'", [u2.body.id]);
    assert.equal(t1.rows[0].n, 1);
    assert.equal(t2.rows[0].n, 1);
    // không ghi nhầm cho người còn lại
    const cross = await query("SELECT COUNT(*)::int n FROM coach_timesheets WHERE user_id = $1 AND work_date = '2026-10-19'", [cu1.rows[0].id]);
    assert.equal(cross.rows[0].n, 0);
  });

  it("đổi ca dạy: HLV gửi yêu cầu, admin duyệt/từ chối", async () => {
    const auth = { Authorization: "Bearer " + adminToken };
    const cauth = { Authorization: "Bearer " + coachToken };
    const { query } = require("../src/db");
    const cu = await query("SELECT id FROM users WHERE username = 'hlv_test'");
    const cu2 = await query("SELECT id FROM users WHERE username = 'hlv_test2'");
    const coachId = cu.rows[0].id;

    // HLV gửi yêu cầu đổi ca (đổi với HLV 2)
    const r1 = await request(app).post("/api/shift-swaps").set(cauth).send({
      branch_id: 1, class_id: 2, work_date: "2026-10-20", swap_with_id: cu2.rows[0].id, reason: "Bận việc gia đình",
    });
    assert.equal(r1.status, 201);
    assert.equal(r1.body.status, "pending");

    // HLV không được tự duyệt
    const denied = await request(app).put(`/api/shift-swaps/${r1.body.id}/approve`).set(cauth);
    assert.equal(denied.status, 403);

    // HLV chỉ thấy yêu cầu của mình
    const mine = await request(app).get("/api/shift-swaps?branch_id=1").set(cauth);
    assert.equal(mine.status, 200);
    assert.ok(mine.body.every((x) => x.requester_id === coachId));

    // admin thấy tất cả và duyệt được
    const all = await request(app).get("/api/shift-swaps?branch_id=1&status=pending").set(auth);
    assert.ok(all.body.some((x) => x.id === r1.body.id));
    const ap = await request(app).put(`/api/shift-swaps/${r1.body.id}/approve`).set(auth).send({ review_note: "OK" });
    assert.equal(ap.status, 200);
    const st = await query("SELECT status, review_note FROM shift_swaps WHERE id = $1", [r1.body.id]);
    assert.equal(st.rows[0].status, "approved");

    // không duyệt 2 lần
    const ap2 = await request(app).put(`/api/shift-swaps/${r1.body.id}/approve`).set(auth);
    assert.equal(ap2.status, 400);

    // yêu cầu đổi với chính mình -> 400
    const bad = await request(app).post("/api/shift-swaps").set(cauth).send({
      branch_id: 1, class_id: 2, work_date: "2026-10-21", swap_with_id: coachId,
    });
    assert.equal(bad.status, 400);

    // admin từ chối 1 yêu cầu khác
    const r2 = await request(app).post("/api/shift-swaps").set(cauth).send({
      branch_id: 1, class_id: 2, work_date: "2026-10-22", reason: "Xin nghỉ",
    });
    assert.equal(r2.status, 201);
    const rj = await request(app).put(`/api/shift-swaps/${r2.body.id}/reject`).set(auth).send({ review_note: "Không đủ người" });
    assert.equal(rj.status, 200);
    const st2 = await query("SELECT status FROM shift_swaps WHERE id = $1", [r2.body.id]);
    assert.equal(st2.rows[0].status, "rejected");
  });

  it("cấp đai: admin sửa được, hiển thị trong hồ sơ", async () => {
    const auth = { Authorization: "Bearer " + adminToken };
    const upd = await request(app).put("/api/students/1").set(auth).send({ belt_level: "Đai vàng" });
    assert.equal(upd.status, 200);
    assert.equal(upd.body.belt_level, "Đai vàng");
    const s = await request(app).get("/api/students/1").set(auth);
    assert.equal(s.body.belt_level, "Đai vàng");
  });

  it("HLV không xem được doanh thu (dashboard + revenue/summary)", async () => {
    const cauth = { Authorization: "Bearer " + coachToken };
    const d = await request(app).get("/api/dashboard?branch_id=1").set(cauth);
    assert.equal(d.status, 200);
    assert.equal(d.body.revenueThisMonth, null);
    const rev = await request(app).get("/api/payments/revenue/summary?branch_id=1").set(cauth);
    assert.equal(rev.status, 403);
  });

  it("yêu cầu xóa HV: HLV gửi kèm lý do, admin duyệt -> vào HV cũ", async () => {
    const auth = { Authorization: "Bearer " + adminToken };
    const cauth = { Authorization: "Bearer " + coachToken };
    const { query } = require("../src/db");
    // tạo HV trong lớp của HLV
    const c = await request(app).post("/api/students").set(auth).send({
      branch_id: 1, class_id: 2, full_name: "HV Xin Xoa", joined_on: "2026-10-01",
    });
    assert.equal(c.status, 201);
    const sid = c.body.id;

    // HLV gửi yêu cầu xóa kèm giải trình
    const r = await request(app).post("/api/students/delete-requests").set(cauth).send({
      branch_id: 1, student_id: sid, reason: "Gia đình chuyển nhà",
    });
    assert.equal(r.status, 201);
    assert.equal(r.body.status, "pending");

    // HLV chưa được xóa trực tiếp
    const direct = await request(app).delete("/api/students/" + sid).set(cauth);
    assert.equal(direct.status, 403);

    // admin thấy yêu cầu chờ duyệt
    const pend = await request(app).get("/api/students/delete-requests?branch_id=1&status=pending").set(auth);
    assert.ok(pend.body.some((x) => x.student_id === sid));

    // admin duyệt -> HV thành "đã nghỉ" + nguyên nhân
    const ap = await request(app).put(`/api/students/delete-requests/${r.body.id}/approve`).set(auth);
    assert.equal(ap.status, 200);
    const s = await request(app).get("/api/students/" + sid).set(auth);
    assert.equal(s.body.status, "stopped");
    assert.equal(s.body.leave_reason, "Gia đình chuyển nhà");
    assert.ok(s.body.stopped_at);
    // HV không còn trong danh sách đang học
    const act = await request(app).get("/api/students?branch_id=1&class_id=2").set(auth);
    assert.ok(!act.body.some((x) => x.id === sid && x.status === "active"));
  });

  it("tài khoản học viên: đăng nhập xem được Tổng quan của mình", async () => {
    const auth = { Authorization: "Bearer " + adminToken };
    const { query } = require("../src/db");
    // tạo tài khoản HV gắn với học viên id 1
    const u = await request(app).post("/api/users").set(auth).send({
      username: "hv_test", password: "hv123", role: "student", full_name: "HV Test Acc", student_id: 1,
    });
    assert.equal(u.status, 201);
    assert.equal(u.body.role, "student");
    // thiếu student_id -> 400
    const bad = await request(app).post("/api/users").set(auth).send({
      username: "hv_bad", password: "hv123", role: "student", full_name: "Bad",
    });
    assert.equal(bad.status, 400);

    const login = await request(app).post("/api/auth/login").send({ username: "hv_test", password: "hv123" });
    assert.equal(login.status, 200);
    const sauth = { Authorization: "Bearer " + login.body.token };

    // /me trả hồ sơ + chuyên cần cá nhân
    const me = await request(app).get("/api/students/me").set(sauth);
    assert.equal(me.status, 200);
    assert.equal(me.body.id, 1);
    assert.ok(me.body.class_name);
    assert.ok(me.body.attendance);
    const myClass = me.body.class_id;

    // HV chỉ thấy hồ sơ của mình trong danh sách
    const list = await request(app).get("/api/students?branch_id=1").set(sauth);
    assert.ok(list.body.every((x) => x.id === 1));

    // HV không xem được hồ sơ người khác
    const other = await request(app).get("/api/students/2").set(sauth);
    assert.equal(other.status, 403);

    // HV xem được nhật ký lớp mình, không xem được lớp khác
    const logs = await request(app).get(`/api/teaching-logs?class_id=${myClass}`).set(sauth);
    assert.equal(logs.status, 200);
    const otherClass = myClass === 1 ? 2 : 1;
    const denied = await request(app).get(`/api/teaching-logs?class_id=${otherClass}`).set(sauth);
    assert.equal(denied.status, 403);
  });

  it("nhật ký dạy: lưu được Nội dung + Chi tiết + Ghi chú", async () => {
    const auth = { Authorization: "Bearer " + adminToken };
    const c = await request(app).post("/api/teaching-logs").set(auth).send({
      class_id: 2, log_date: "2026-10-16", content: "Ôn đòn chân số 3",
      details: "Tách từng nhịp, ghép đôi", note: "Lớp đi đủ",
    });
    assert.equal(c.status, 201);
    assert.equal(c.body.details, "Tách từng nhịp, ghép đôi");
    assert.equal(c.body.note, "Lớp đi đủ");
    const u = await request(app).put("/api/teaching-logs/" + c.body.id).set(auth).send({ note: "Vắng 2 bạn" });
    assert.equal(u.body.note, "Vắng 2 bạn");
  });

  it("tra cứu: HLV xem được lớp/CLB khác, HV chỉ thấy họ tên + cấp đai", async () => {
    const auth = { Authorization: "Bearer " + adminToken };
    const cauth = { Authorization: "Bearer " + coachToken };
    // HLV chỉ được gán lớp 2 nhưng tra cứu thấy cả 3 lớp
    const cls = await request(app).get("/api/directory/classes?branch_id=1").set(cauth);
    assert.equal(cls.status, 200);
    assert.ok(cls.body.length >= 3);
    const c1 = cls.body.find((c) => c.id === 1);
    assert.ok(c1.branch_name);
    assert.ok(Array.isArray(c1.coaches));
    assert.ok(Number.isInteger(c1.active_students));

    // DS học viên của lớp khác: chỉ họ tên + cấp đai, không SĐT
    const st = await request(app).get("/api/directory/classes/1/students").set(cauth);
    assert.equal(st.status, 200);
    assert.ok(st.body.length > 0);
    assert.ok(st.body[0].full_name);
    assert.ok(!("phone" in st.body[0]));

    // DS học viên toàn CLB
    const all = await request(app).get("/api/directory/branches/1/students").set(cauth);
    assert.equal(all.status, 200);
    assert.ok(all.body.length > 0);
    assert.ok(all.body[0].class_name !== undefined);

    // tài khoản học viên không được tra cứu
    const login = await request(app).post("/api/auth/login").send({ username: "hv_test", password: "hv123" });
    const denied = await request(app).get("/api/directory/classes?branch_id=1")
      .set({ Authorization: "Bearer " + login.body.token });
    assert.equal(denied.status, 403);
  });

  it("xuất Excel: danh sách lớp, điểm danh, chấm công", async () => {
    const auth = { Authorization: "Bearer " + adminToken };
    const cauth = { Authorization: "Bearer " + coachToken };
    const xlsx = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    const e1 = await request(app).get("/api/export/students?class_id=2").set(cauth);
    assert.equal(e1.status, 200);
    assert.ok(e1.headers["content-type"].includes(xlsx));
    const e2 = await request(app).get("/api/export/attendance?class_id=2&month=2026-10").set(cauth);
    assert.equal(e2.status, 200);
    assert.ok(e2.headers["content-type"].includes(xlsx));
    // HLV không export được chấm công
    const e3 = await request(app).get("/api/export/timesheets?month=2026-10&branch_id=1").set(cauth);
    assert.equal(e3.status, 403);
    const e4 = await request(app).get("/api/export/timesheets?month=2026-10&branch_id=1").set(auth);
    assert.equal(e4.status, 200);
    assert.ok(e4.headers["content-type"].includes(xlsx));
  });

  it("HLV không thấy số tiền (hồ sơ HV, fee-overview, danh sách thu)", async () => {
    const cauth = { Authorization: "Bearer " + coachToken };
    const list = await request(app).get("/api/students?class_id=2").set(cauth);
    assert.ok(list.body.length > 0);
    const d = await request(app).get("/api/students/" + list.body[0].id).set(cauth);
    assert.equal(d.status, 200);
    assert.equal(d.body.package_fee, null);
    assert.ok("package_sessions" in d.body);
    for (const p of d.body.payments) assert.equal(p.amount, null);

    const ov = await request(app).get("/api/classes/2/fee-overview").set(cauth);
    assert.equal(ov.status, 200);
    for (const s of ov.body.students) assert.equal(s.package_fee, null);

    const pays = await request(app).get("/api/payments?branch_id=1").set(cauth);
    assert.equal(pays.status, 200);
    for (const p of pays.body) assert.equal(p.amount, null);
  });

  it("admin đánh dấu tháng học phí: toggle tạo/xóa khoản thu, đồng bộ paid_through", async () => {
    const auth = { Authorization: "Bearer " + adminToken };
    const cauth = { Authorization: "Bearer " + coachToken };
    const denied = await request(app).post("/api/payments/fee-month").set(cauth)
      .send({ student_id: 1, year: 2026, month: 5, paid: true });
    assert.equal(denied.status, 403);

    const on = await request(app).post("/api/payments/fee-month").set(auth)
      .send({ student_id: 1, year: 2026, month: 5, paid: true });
    assert.equal(on.status, 200);
    const d1 = await request(app).get("/api/students/1").set(auth);
    const cov = d1.body.payments.find((p) => p.category === "tuition" &&
      String(p.paid_on).slice(0, 7) <= "2026-05" && String(p.paid_through || p.paid_on).slice(0, 7) >= "2026-05");
    assert.ok(cov);
    assert.equal(cov.amount, 600000);
    assert.ok(String(d1.body.paid_through).slice(0, 10) >= "2026-05-31");

    const again = await request(app).post("/api/payments/fee-month").set(auth)
      .send({ student_id: 1, year: 2026, month: 5, paid: true });
    assert.equal(again.body.already, true);

    const off = await request(app).post("/api/payments/fee-month").set(auth)
      .send({ student_id: 1, year: 2026, month: 5, paid: false });
    assert.equal(off.status, 200);
    const d2 = await request(app).get("/api/students/1").set(auth);
    assert.ok(!d2.body.payments.some((p) => p.id === cov.id));

    // tháng thuộc khoản thu tay -> toggle không được xóa
    const real = await request(app).post("/api/payments").set(auth).send({
      branch_id: 1, student_id: 1, category: "tuition", amount: 600000,
      paid_on: "2026-06-01", paid_through: "2026-08-31", note: "đóng 3 tháng" });
    assert.equal(real.status, 201);
    const offReal = await request(app).post("/api/payments/fee-month").set(auth)
      .send({ student_id: 1, year: 2026, month: 7, paid: false });
    assert.equal(offReal.status, 400);
  });

  it("học viên nghỉ 3 buổi trong 30 ngày -> /me trả absent_30d", async () => {
    const auth = { Authorization: "Bearer " + adminToken };
    for (const dt of ["2026-10-14", "2026-10-15", "2026-10-16"]) {
      const sv = await request(app).post("/api/attendance/sessions").set(auth).send({
        class_id: 1, session_date: dt, records: [{ student_id: 1, status: "absent" }] });
      assert.equal(sv.status, 200);
    }
    const login = await request(app).post("/api/auth/login").send({ username: "hv_test", password: "hv123" });
    const me = await request(app).get("/api/students/me")
      .set({ Authorization: "Bearer " + login.body.token });
    assert.equal(me.status, 200);
    assert.ok(me.body.attendance.absent_30d >= 3);
  });

  it("HLV sửa hồ sơ -> gửi admin duyệt", async () => {
    const auth = { Authorization: "Bearer " + adminToken };
    const cauth = { Authorization: "Bearer " + coachToken };
    // HLV xem hồ sơ của mình
    const me = await request(app).get("/api/profile/me").set(cauth);
    assert.equal(me.status, 200);
    assert.equal(me.body.pending_request, null);
    // HLV gửi yêu cầu sửa
    const req1 = await request(app).post("/api/profile/request").set(cauth)
      .send({ full_name: "HLV Test Mới", belt_level: "Hoàng đai", phone: "0900000001" });
    assert.ok([200, 201].includes(req1.status));
    const me2 = await request(app).get("/api/profile/me").set(cauth);
    assert.ok(me2.body.pending_request);
    // HLV không được tự duyệt
    const selfApprove = await request(app).put(`/api/profile/requests/${req1.body.id}/approve`).set(cauth);
    assert.equal(selfApprove.status, 403);
    // admin thấy yêu cầu chờ duyệt
    const list = await request(app).get("/api/profile/requests").set(auth);
    assert.equal(list.status, 200);
    assert.ok(list.body.some((r) => r.id === req1.body.id));
    // admin duyệt -> áp dụng vào users
    const ap = await request(app).put(`/api/profile/requests/${req1.body.id}/approve`).set(auth);
    assert.equal(ap.status, 200);
    const users = await request(app).get("/api/users").set(auth);
    const hlv = users.body.find((u) => u.username === "hlv_test");
    assert.equal(hlv.full_name, "HLV Test Mới");
    assert.equal(hlv.belt_level, "Hoàng đai");
    assert.equal(hlv.phone, "0900000001");
    // duyệt lại -> 400
    const ap2 = await request(app).put(`/api/profile/requests/${req1.body.id}/approve`).set(auth);
    assert.equal(ap2.status, 400);
    // từ chối yêu cầu mới
    const req2 = await request(app).post("/api/profile/request").set(cauth)
      .send({ full_name: "Tên Sai", belt_level: "", phone: "" });
    const rej = await request(app).put(`/api/profile/requests/${req2.body.id}/reject`).set(auth).send({ note: "sai tên" });
    assert.equal(rej.status, 200);
    const users2 = await request(app).get("/api/users").set(auth);
    assert.equal(users2.body.find((u) => u.username === "hlv_test").full_name, "HLV Test Mới");
  });

  it("catalog lớp: học viên xem được tất cả lớp + HLV + cấp đai HLV", async () => {
    const login = await request(app).post("/api/auth/login").send({ username: "hv_test", password: "hv123" });
    const sauth = { Authorization: "Bearer " + login.body.token };
    const cat = await request(app).get("/api/classes/catalog").set(sauth);
    assert.equal(cat.status, 200);
    assert.ok(cat.body.length >= 3);
    assert.ok(cat.body[0].branch_name);
    assert.ok(Array.isArray(cat.body[0].coaches));
    // HLV cũng xem được
    const cauth = { Authorization: "Bearer " + coachToken };
    const cat2 = await request(app).get("/api/classes/catalog").set(cauth);
    assert.equal(cat2.status, 200);
  });

  it("admin sửa/xóa khoản thu: paid_through của HV được tính lại", async () => {
    const auth = { Authorization: "Bearer " + adminToken };
    const created = await request(app).post("/api/students").set(auth).send({
      branch_id: 1, class_id: 2, full_name: "HV Test Thu Phí", joined_on: "2026-01-05" });
    assert.equal(created.status, 201);
    const sid = created.body.id;
    const p1 = await request(app).post("/api/payments").set(auth).send({
      branch_id: 1, student_id: sid, category: "tuition", amount: 400000,
      paid_on: "2026-11-01", paid_through: "2026-11-30", note: "test" });
    assert.equal(p1.status, 201);
    let d = await request(app).get("/api/students/" + sid).set(auth);
    assert.equal(String(d.body.paid_through).slice(0, 10), "2026-11-30");
    // sửa đến ngày -> HV cập nhật theo
    const u = await request(app).put("/api/payments/" + p1.body.id).set(auth).send({ paid_through: "2026-12-31" });
    assert.equal(u.status, 200);
    d = await request(app).get("/api/students/" + sid).set(auth);
    assert.equal(String(d.body.paid_through).slice(0, 10), "2026-12-31");
    // xóa -> tính lại (không còn khoản học phí nào -> null)
    const del = await request(app).delete("/api/payments/" + p1.body.id).set(auth);
    assert.equal(del.status, 200);
    d = await request(app).get("/api/students/" + sid).set(auth);
    assert.equal(d.body.paid_through, null);
  });

  it("chuyển lớp: admin tự do, HLV chỉ chuyển HV lớp mình dạy sang lớp bất kỳ", async () => {
    const auth = { Authorization: "Bearer " + adminToken };
    const cauth = { Authorization: "Bearer " + coachToken };
    const created = await request(app).post("/api/students").set(auth).send({
      branch_id: 1, class_id: 2, full_name: "HV Chuyen Lop", joined_on: "2026-01-05" });
    assert.equal(created.status, 201);
    const sid = created.body.id;
    // HLV test dạy lớp 2 -> chuyển HV lớp 2 sang lớp 1 được (lớp đích không cần là lớp mình dạy)
    const byCoach = await request(app).post(`/api/students/${sid}/transfer`).set(cauth).send({ class_id: 1 });
    assert.equal(byCoach.status, 200);
    assert.equal(byCoach.body.class_id, 1);
    // giờ HV ở lớp 1 (không phải lớp HLV) -> HLV chuyển tiếp bị chặn
    const blocked = await request(app).post(`/api/students/${sid}/transfer`).set(cauth).send({ class_id: 3 });
    assert.equal(blocked.status, 403);
    // admin chuyển tự do; chuyển về đúng lớp hiện tại -> 400
    const same = await request(app).post(`/api/students/${sid}/transfer`).set(auth).send({ class_id: 1 });
    assert.equal(same.status, 400);
    const ok = await request(app).post(`/api/students/${sid}/transfer`).set(auth).send({ class_id: 3 });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.class_id, 3);
  });

  it("gán chi nhánh cho HLV: lưu branch_ids kể cả chi nhánh chưa có lớp", async () => {
    const auth = { Authorization: "Bearer " + adminToken };
    const br = await request(app).post("/api/branches").set(auth).send({ name: "Chi nhánh Test Mới", kind: "teaching_point" });
    assert.equal(br.status, 201);
    const bid = br.body.id;
    const { query } = require("../src/db");
    const cu = await query("SELECT id FROM users WHERE username = 'hlv_test'");
    const coachId = cu.rows[0].id;
    const put = await request(app).put(`/api/users/${coachId}/classes`).set(auth)
      .send({ classIds: [2], branchIds: [1, bid] });
    assert.equal(put.status, 200);
    const users = await request(app).get("/api/users").set(auth);
    const u = users.body.find((x) => x.id === coachId);
    assert.ok(u.branch_ids.includes(1) && u.branch_ids.includes(bid));
    assert.deepEqual(u.class_ids, [2]);
  });
});
