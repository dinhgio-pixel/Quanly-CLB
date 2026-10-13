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
    const gone = await request(app).get("/api/students/" + id).set(auth);
    assert.equal(gone.status, 404);
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
});
