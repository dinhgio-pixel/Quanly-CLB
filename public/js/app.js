"use strict";
/* Quản lý CLB Vovinam — SPA thuần JS */

const S = {
  token: localStorage.getItem("vv_token") || "",
  user: null,
  branchId: Number(localStorage.getItem("vv_branch") || 0) || null,
  branches: [],
  classes: [],
  packages: [],
  users: [],
};

/* ---------- helpers ---------- */
const $ = (s, el) => (el || document).querySelector(s);
const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtVND = (n) => (Number(n) || 0).toLocaleString("vi-VN") + "đ";
const fmtDate = (d) => { if (!d) return "—"; const x = String(d).slice(0, 10).split("-"); return x.length === 3 ? `${x[2]}/${x[1]}/${x[0]}` : d; };
const todayInput = () => new Date().toISOString().slice(0, 10);
const isAdmin = () => S.user && S.user.role === "admin";

const FEE_LABEL = { paid: "Đã đóng", due_soon: "Sắp hết hạn", overdue: "Quá hạn", unpaid: "Chưa đóng", paused: "Tạm dừng", stopped: "Dừng học" };
const ST_LABEL = { active: "Đang học", paused: "Tạm dừng", stopped: "Dừng học" };
const CAT_LABEL = { tuition: "Học phí lớp", private: "Dạy 1:1", rental: "Cho thuê", performance: "Biểu diễn", other: "Khác" };
const ATT_LABEL = { present: "Có mặt", absent: "Vắng", excused: "Có phép" };
const feeBadge = (s) => `<span class="badge b-${esc(s)}">${esc(FEE_LABEL[s] || s)}</span>`;
const stBadge = (s) => `<span class="badge b-${esc(s)}">${esc(ST_LABEL[s] || s)}</span>`;

async function api(method, path, body) {
  const opt = { method, headers: { "Content-Type": "application/json" } };
  if (S.token) opt.headers.Authorization = "Bearer " + S.token;
  if (body !== undefined) opt.body = JSON.stringify(body);
  const r = await fetch("/api" + path, opt);
  let data = null;
  try { data = await r.json(); } catch (e) { /* empty */ }
  if (r.status === 401) { logout(); throw new Error("Hết phiên đăng nhập"); }
  if (!r.ok) throw new Error((data && data.error) || ("Lỗi " + r.status));
  return data;
}

let toastTimer = null;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg; t.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add("hidden"), 2600);
}
function openModal(html) { $("#modalBody").innerHTML = html; $("#modal").classList.remove("hidden"); }
function closeModal() { $("#modal").classList.add("hidden"); $("#modalBody").innerHTML = ""; }
async function confirmDlg(msg) { return window.confirm(msg); }

function logout() {
  S.token = ""; S.user = null;
  localStorage.removeItem("vv_token");
  location.hash = "#/login";
}

/* ---------- shell ---------- */
const NAV = [
  ["#/dashboard", "📊", "Tổng quan"],
  ["#/classes", "🏫", "Lớp học"],
  ["#/students", "🧑‍🎓", "Học viên"],
  ["#/attendance", "✅", "Điểm danh"],
  ["#/teaching-logs", "📝", "Nhật ký dạy"],
  ["#/timesheets", "⏱️", "Chấm công"],
  ["#/shift-swaps", "🔄", "Đổi ca"],
  ["#/fees", "💰", "Thu phí"],
  ["#/packages", "📦", "Gói học", true],
  ["#/branches", "🏢", "Chi nhánh", true],
  ["#/users", "👥", "Tài khoản", true],
];

function renderNav() {
  const nav = $("#sidenav");
  nav.innerHTML = `<div class="nav-user">👤 ${esc(S.user.full_name || S.user.username)}<br><span class="muted">${S.user.role === "admin" ? "Quản trị viên" : "Huấn luyện viên"}</span></div>` +
    NAV.filter((n) => !n[3] || isAdmin()).map((n) =>
      `<a href="${n[0]}" data-nav="${n[0]}">${n[1]} ${n[2]}</a>`).join("");
  $$("#sidenav a").forEach((a) => {
    if (location.hash.startsWith(a.dataset.nav)) a.classList.add("active");
  });
}

function renderBranchSel() {
  const sel = $("#branchSel");
  sel.innerHTML = S.branches.map((b) => `<option value="${b.id}">${esc(b.name)}</option>`).join("");
  if (S.branchId) sel.value = String(S.branchId);
  sel.onchange = () => {
    S.branchId = Number(sel.value);
    localStorage.setItem("vv_branch", String(S.branchId));
    route();
  };
}

async function boot() {
  try {
    S.user = await api("GET", "/auth/me");
  } catch (e) { location.hash = "#/login"; return; }
  S.branches = await api("GET", "/branches");
  if (!S.branchId || !S.branches.some((b) => b.id === S.branchId)) {
    S.branchId = S.branches[0] ? S.branches[0].id : null;
    localStorage.setItem("vv_branch", String(S.branchId || ""));
  }
  $("#topbar").classList.remove("hidden");
  $("#sidenav").classList.remove("hidden");
  renderNav(); renderBranchSel();
  await refreshLookups();
  route();
}

async function refreshLookups() {
  const q = `?branch_id=${S.branchId || ""}`;
  [S.classes, S.packages] = await Promise.all([
    api("GET", "/classes" + q).catch(() => []),
    api("GET", "/packages" + q).catch(() => []),
  ]);
  if (isAdmin()) S.users = await api("GET", "/users").catch(() => []);
}

const className = (id) => (S.classes.find((c) => c.id === Number(id)) || {}).name || "—";
const pkgName = (id) => (S.packages.find((p) => p.id === Number(id)) || {}).name || "—";
// Chuẩn hóa danh sách lớp của HLV (đề phòng dữ liệu trả về dạng chuỗi JSON)
const classIdsOf = (u) => {
  const v = u ? u.class_ids : null;
  if (Array.isArray(v)) return v.map(Number).filter((n) => Number.isInteger(n));
  try { const p = JSON.parse(v || "[]"); return Array.isArray(p) ? p.map(Number).filter((n) => Number.isInteger(n)) : []; }
  catch (e) { return []; }
};
const SWAP_LABEL = { pending: "Chờ duyệt", approved: "Đã duyệt", rejected: "Từ chối" };
const swapBadge = (s) => `<span class="badge ${s === "approved" ? "b-paid" : s === "rejected" ? "b-overdue" : "b-due_soon"}">${SWAP_LABEL[s] || s}</span>`;

/* ---------- views ---------- */
const V = $("#view");

function pageHead(title, extra) {
  return `<div class="row spread"><h1>${esc(title)}</h1><div class="row">${extra || ""}</div></div>`;
}

/* ----- login ----- */
function vLogin() {
  $("#topbar").classList.add("hidden"); $("#sidenav").classList.add("hidden");
  V.innerHTML = `<div class="login-wrap"><div class="login-box card">
    <div class="login-logo"><img src="img/vovinam-logo.webp" alt="Vovinam"></div><h1>Quản lý CLB Vovinam</h1>
    <form id="f"><label>Tên đăng nhập</label><input name="username" autocomplete="username">
    <label>Mật khẩu</label><input name="password" type="password" autocomplete="current-password">
    <div class="btnrow"><button class="btn" style="flex:1">Đăng nhập</button></div></form></div></div>`;
  $("#f").onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target);
    try {
      const r = await api("POST", "/auth/login", { username: fd.get("username"), password: fd.get("password") });
      S.token = r.token; localStorage.setItem("vv_token", r.token);
      location.hash = "#/dashboard"; await boot();
    } catch (err) { toast(err.message); }
  };
}

/* ----- dashboard ----- */
async function vDashboard() {
  V.innerHTML = "<p class='muted'>Đang tải...</p>";
  const d = await api("GET", `/dashboard?branch_id=${S.branchId}`);
  const rev = d.revenueThisMonth;
  V.innerHTML = pageHead("Tổng quan") + `
  <div class="grid kpi">
    <div class="card"><div class="num">${d.totals.activeStudents}</div><div class="lbl">HV đang học</div></div>
    <div class="card"><div class="num">${d.totals.classes}</div><div class="lbl">Lớp học</div></div>
    <div class="card"><div class="num" style="color:var(--bad)">${d.overdue.length}</div><div class="lbl">Quá hạn HP</div></div>
    <div class="card"><div class="num" style="color:var(--warn)">${d.dueSoon.length}</div><div class="lbl">Sắp hết hạn</div></div>
  </div>
  <div class="card"><h3>💰 Doanh thu tháng này: ${fmtVND(rev.tuition + rev.private + rev.rental + rev.performance + rev.other)}</h3>
    <div class="tbl-wrap"><table>
    ${Object.keys(CAT_LABEL).map((k) => `<tr><td>${CAT_LABEL[k]}</td><td style="text-align:right"><b>${fmtVND(rev[k])}</b></td></tr>`).join("")}
    </table></div></div>
  <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(280px,1fr))">
    <div class="card"><h3>⚠️ Quá hạn học phí (${d.overdue.length})</h3>${feeList(d.overdue)}</div>
    <div class="card"><h3>⏳ Sắp hết hạn (${d.dueSoon.length})</h3>${feeList(d.dueSoon)}</div>
  </div>
  <div class="card"><h3>📅 Buổi học hôm nay (${d.todaySessions.length})</h3>
    ${d.todaySessions.length ? `<div class="tbl-wrap"><table><tr><th>Lớp</th><th>Lịch</th><th>Điểm danh</th></tr>
      ${d.todaySessions.map((s) => `<tr><td>${esc(s.class_name)}</td><td class="muted">${esc(s.schedule || "")}</td>
      <td><a href="#/attendance?class=${s.class_id || ""}">${s.records} HV</a></td></tr>`).join("")}</table></div>`
      : `<p class="muted">Chưa tạo buổi điểm danh nào hôm nay.</p>`}</div>`;
  function feeList(list) {
    if (!list.length) return `<p class="muted">Không có.</p>`;
    return `<div class="tbl-wrap"><table>${list.map((s) =>
      `<tr><td><a href="#/students/${s.id}">${esc(s.full_name)}</a><br><span class="muted">${esc(s.class_name || "")} · đến ${fmtDate(s.paid_through)}</span></td>
      <td><button class="btn small" onclick="payFor(${s.id})">Thu phí</button></td></tr>`).join("")}</table></div>`;
  }
}

/* ----- branches (admin) ----- */
async function vBranches() {
  if (!isAdmin()) { location.hash = "#/dashboard"; return; }
  V.innerHTML = pageHead("Chi nhánh", `<button class="btn" onclick="branchForm()">+ Thêm</button>`) +
    `<div class="card"><div class="tbl-wrap"><table><tr><th>Tên</th><th>Loại</th><th>Địa chỉ</th><th></th></tr>
    ${S.branches.map((b) => `<tr><td><b>${esc(b.name)}</b></td><td>${b.kind === "club" ? "CLB" : "Điểm dạy"}</td>
      <td class="muted">${esc(b.address)}</td>
      <td><button class="btn small ghost" onclick="branchForm(${b.id})">Sửa</button></td></tr>`).join("")}</table></div></div>`;
}
window.branchForm = async (id) => {
  const b = id ? S.branches.find((x) => x.id === id) : {};
  openModal(`<h3>${id ? "Sửa" : "Thêm"} chi nhánh</h3><form id="f">
    <label>Tên</label><input name="name" value="${esc(b.name || "")}" required>
    <label>Loại</label><select name="kind"><option value="club" ${b.kind === "club" ? "selected" : ""}>CLB</option>
    <option value="teaching_point" ${b.kind === "teaching_point" ? "selected" : ""}>Điểm dạy độc lập</option></select>
    <label>Địa chỉ</label><input name="address" value="${esc(b.address || "")}">
    <div class="btnrow"><button class="btn">Lưu</button><button type="button" class="btn ghost" onclick="closeModal()">Hủy</button>
    ${id ? `<button type="button" class="btn danger" onclick="branchDel(${id})">Xóa</button>` : ""}</div></form>`);
  $("#f").onsubmit = async (e) => {
    e.preventDefault(); const fd = new FormData(e.target);
    const body = { name: fd.get("name"), kind: fd.get("kind"), address: fd.get("address") };
    try {
      if (id) await api("PUT", "/branches/" + id, body); else await api("POST", "/branches", body);
      closeModal(); S.branches = await api("GET", "/branches"); renderBranchSel(); vBranches(); toast("Đã lưu");
    } catch (err) { toast(err.message); }
  };
};
window.branchDel = async (id) => {
  if (!await confirmDlg("Xóa chi nhánh này? Toàn bộ dữ liệu thuộc chi nhánh sẽ mất!")) return;
  try { await api("DELETE", "/branches/" + id); closeModal(); location.reload(); } catch (err) { toast(err.message); }
};

/* ----- classes ----- */
async function vClasses() {
  V.innerHTML = pageHead("Lớp học", isAdmin() ? `<button class="btn" onclick="classForm()">+ Thêm lớp</button>` : "") +
    `<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(260px,1fr))">` +
    S.classes.map((c) => `<div class="card"><h3><a href="#/classes/${c.id}">${esc(c.name)}</a></h3>
      <div class="muted">${esc(c.schedule)}${c.room ? " · " + esc(c.room) : ""}</div>
      <div class="row spread" style="margin-top:.5rem"><span>${c.active_students} HV đang học</span>
      <b>${fmtVND(c.monthly_fee)}</b></div>
      ${c.coaches ? `<div class="muted">HLV: ${esc(c.coaches)}</div>` : ""}</div>`).join("") + `</div>` +
    (S.classes.length ? "" : `<p class="muted">Chưa có lớp nào.</p>`);
}
window.classForm = async (id) => {
  const c = id ? S.classes.find((x) => x.id === id) : {};
  openModal(`<h3>${id ? "Sửa" : "Thêm"} lớp học</h3><form id="f">
    <label>Tên lớp</label><input name="name" value="${esc(c.name || "")}" required>
    <label>Lịch học</label><input name="schedule" value="${esc(c.schedule || "")}" placeholder="VD: T2/4/6 17:00–18:30">
    <label>Phòng / Tầng</label><input name="room" value="${esc(c.room || "")}">
    <label>Học phí chuẩn (đ/tháng)</label><input name="monthly_fee" type="number" min="0" value="${c.monthly_fee || 0}">
    <div class="btnrow"><button class="btn">Lưu</button><button type="button" class="btn ghost" onclick="closeModal()">Hủy</button>
    ${id ? `<button type="button" class="btn danger" onclick="classDel(${id})">Xóa</button>` : ""}</div></form>`);
  $("#f").onsubmit = async (e) => {
    e.preventDefault(); const fd = new FormData(e.target);
    const body = { branch_id: S.branchId, name: fd.get("name"), schedule: fd.get("schedule"), room: fd.get("room"), monthly_fee: fd.get("monthly_fee") };
    try {
      if (id) await api("PUT", "/classes/" + id, body); else await api("POST", "/classes", body);
      closeModal(); await refreshLookups(); vClasses(); toast("Đã lưu");
    } catch (err) { toast(err.message); }
  };
};
window.classDel = async (id) => {
  if (!await confirmDlg("Xóa lớp này? Dữ liệu điểm danh, nhật ký của lớp sẽ mất!")) return;
  try { await api("DELETE", "/classes/" + id); closeModal(); await refreshLookups(); vClasses(); } catch (err) { toast(err.message); }
};

/* ----- class detail ----- */
async function vClassDetail(id, tab) {
  tab = tab || "students";
  const c = S.classes.find((x) => x.id === Number(id));
  if (!c) { location.hash = "#/classes"; return; }
  const TABS = [["students", "🧑‍🎓 Học viên"], ["attendance", "✅ Điểm danh"], ["logs", "📝 Nhật ký"], ["fees", "💰 Thu phí"]];
  if (isAdmin()) TABS.push(["coach", "👥 HLV"]);
  let body = `<div class="tabs">${TABS.map((t) => `<button class="${tab === t[0] ? "active" : ""}" onclick="location.hash='#/classes/${id}/${t[0]}'">${t[1]}</button>`).join("")}</div><div id="tabBody"><p class="muted">Đang tải...</p></div>`;
  V.innerHTML = pageHead(c.name, isAdmin() ? `<button class="btn ghost" onclick="classForm(${c.id})">Sửa lớp</button>` : "") +
    `<p class="muted">${esc(c.schedule)}${c.room ? " · " + esc(c.room) : ""} · ${fmtVND(c.monthly_fee)}/tháng</p>` + body;
  const el = $("#tabBody");
  if (tab === "students") {
    const list = await api("GET", `/students?class_id=${id}`);
    el.innerHTML = `<div class="row spread"><b>${list.length} học viên</b><button class="btn small" onclick="studentForm(null,${id})">+ Thêm HV</button></div>
    <div class="tbl-wrap"><table><tr><th>Họ tên</th><th>Gói</th><th>HP đến ngày</th><th>Trạng thái</th></tr>
    ${list.map((s) => `<tr class="clickable" onclick="location.hash='#/students/${s.id}'"><td><b>${esc(s.full_name)}</b><br><span class="muted">${esc(s.phone || "")}</span></td>
      <td class="muted">${esc(s.package_name || "—")}</td><td>${fmtDate(s.paid_through)}</td><td>${feeBadge(s.fee_state)}</td></tr>`).join("")}</table></div>`;
  } else if (tab === "attendance") {
    el.innerHTML = `<div class="row"><input type="date" id="attDate" value="${todayInput()}" style="width:auto">
      <button class="btn" onclick="takeAttendance(${id})">Điểm danh</button>
      <button class="btn ghost" onclick="attSummary(${id})">% Chuyên cần</button></div><div id="attList" style="margin-top:.7rem"></div>`;
    const ss = await api("GET", `/attendance/sessions?class_id=${id}`);
    $("#attList").innerHTML = ss.length ? `<div class="tbl-wrap"><table><tr><th>Ngày</th><th>Có mặt</th><th></th></tr>
      ${ss.map((s) => `<tr><td>${fmtDate(s.session_date)}</td><td>${s.present_count}/${s.total_count}</td>
      <td><button class="btn small ghost" onclick="takeAttendance(${id},'${s.session_date}')">Sửa</button></td></tr>`).join("")}</table></div>`
      : `<p class="muted">Chưa có buổi điểm danh nào.</p>`;
  } else if (tab === "logs") {
    const logs = await api("GET", `/teaching-logs?class_id=${id}`);
    el.innerHTML = `<div class="row spread"><b>${logs.length} ghi chép</b><button class="btn small" onclick="logForm(${id})">+ Ghi nhật ký</button></div>` +
      (logs.map((l) => `<div class="card"><div class="row spread"><b>${fmtDate(l.log_date)}</b>
        <span class="muted">${esc(l.author || "")}</span></div><p>${esc(l.content)}</p>
        <div class="btnrow"><button class="btn small ghost" onclick="logForm(${id},${l.id})">Sửa</button>
        <button class="btn small danger" onclick="logDel(${l.id},${id})">Xóa</button></div></div>`).join("") ||
        `<p class="muted">Chưa có nhật ký.</p>`);
  } else if (tab === "fees") {
    const ov = await api("GET", `/classes/${id}/fee-overview`);
    const sm = ov.summary;
    el.innerHTML = `<div class="grid kpi">
      <div class="card"><div class="num" style="color:var(--ok)">${sm.paid || 0}</div><div class="lbl">Đã đóng</div></div>
      <div class="card"><div class="num" style="color:var(--bad)">${(sm.overdue || 0) + (sm.unpaid || 0)}</div><div class="lbl">Chưa/chậm đóng</div></div>
      <div class="card"><div class="num" style="color:var(--warn)">${sm.due_soon || 0}</div><div class="lbl">Sắp hết hạn</div></div>
      <div class="card"><div class="num" style="color:var(--muted)">${(sm.paused || 0) + (sm.stopped || 0)}</div><div class="lbl">Tạm dừng/Dừng</div></div></div>
      <div class="tbl-wrap"><table><tr><th>Học viên</th><th>Gói</th><th>HP đến ngày</th><th>Trạng thái</th><th></th></tr>
      ${ov.students.map((s) => `<tr><td><b>${esc(s.full_name)}</b></td><td class="muted">${esc(s.package_name || "—")}<br>${fmtVND(s.package_fee || 0)}</td>
      <td>${fmtDate(s.paid_through)}</td><td>${feeBadge(s.fee_state)}</td>
      <td>${["paid"].includes(s.fee_state) ? "" : `<button class="btn small" onclick="payFor(${s.id},${id})">Thu phí</button>`}</td></tr>`).join("")}</table></div>`;
  } else if (tab === "coach" && isAdmin()) {
    try {
      const assigned = await api("GET", "/users");
      const coaches = assigned.filter((u) => u.role === "coach");
      el.innerHTML = `<p class="muted">Chọn HLV phụ trách lớp này (có thể gán nhiều HLV cùng 1 lớp; HLV chỉ thấy và quản lý lớp được gán):</p>` +
        coaches.map((u) => { const has = classIdsOf(u).includes(Number(id)); return `
        <div class="att-row"><div class="nm"><b>${esc(u.full_name || u.username)}</b> <span class="muted">@${esc(u.username)}</span></div>
        <button class="btn small ${has ? "danger" : "ok"}" onclick="toggleCoach(${u.id},${id},${has})">${has ? "Gỡ" : "Gán"}</button></div>`; }).join("") +
        (coaches.length ? "" : `<p class="muted">Chưa có tài khoản HLV nào. Tạo ở mục Tài khoản.</p>`);
    } catch (err) {
      el.innerHTML = `<p style="color:var(--bad)">Không tải được danh sách HLV: ${esc(err.message)}</p>`;
    }
  }
}
window.toggleCoach = async (uid, cid, has) => {
  try {
    const cur = await api("GET", `/users/${uid}/classes`);
    const next = has ? cur.filter((x) => x !== cid) : [...cur, cid];
    await api("PUT", `/users/${uid}/classes`, { classIds: next });
    toast(has ? "Đã gỡ HLV" : "Đã gán HLV");
    vClassDetail(cid, "coach");
  } catch (err) { toast("Lỗi: " + err.message); }
};

/* ----- students ----- */
async function vStudents() {
  V.innerHTML = pageHead("Học viên", `<button class="btn" onclick="studentForm()">+ Thêm HV</button>`) +
    `<div class="card"><div class="row">
      <input id="q" placeholder="Tìm tên / SĐT..." style="flex:1;min-width:160px">
      <select id="fClass" style="width:auto"><option value="">Tất cả lớp</option>${S.classes.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join("")}</select>
      <select id="fFee" style="width:auto"><option value="">Mọi trạng thái HP</option>
        <option value="paid">Đã đóng</option><option value="due_soon">Sắp hết hạn</option>
        <option value="overdue">Quá hạn</option><option value="unpaid">Chưa đóng</option></select>
      <button class="btn" onclick="studentSearch()">Tìm</button></div>
      <div id="sList" style="margin-top:.6rem"></div></div>`;
  $("#q").addEventListener("keydown", (e) => { if (e.key === "Enter") studentSearch(); });
  studentSearch();
}
window.studentSearch = async () => {
  const q = $("#q").value.trim(), fc = $("#fClass").value, ff = $("#fFee").value;
  let url = `/students?branch_id=${S.branchId}`;
  if (q) url += `&q=${encodeURIComponent(q)}`;
  if (fc) url += `&class_id=${fc}`;
  const list = await api("GET", url);
  const rows = ff ? list.filter((s) => s.fee_state === ff) : list;
  $("#sList").innerHTML = `<p class="muted">${rows.length} kết quả</p><div class="tbl-wrap"><table>
    <tr><th>Họ tên</th><th>Lớp</th><th>HP đến ngày</th><th>Trạng thái</th></tr>
    ${rows.map((s) => `<tr class="clickable" onclick="location.hash='#/students/${s.id}'">
      <td><b>${esc(s.full_name)}</b><br><span class="muted">${esc(s.phone || "")}</span></td>
      <td class="muted">${esc(s.class_name || "—")}</td><td>${fmtDate(s.paid_through)}</td><td>${feeBadge(s.fee_state)}</td></tr>`).join("")}</table></div>`;
};
window.studentForm = async (id, presetClass) => {
  const s = id ? await api("GET", "/students/" + id) : {};
  const clsOpts = S.classes.map((c) => `<option value="${c.id}" ${(s.class_id || presetClass) == c.id ? "selected" : ""}>${esc(c.name)}</option>`).join("");
  const pkgOpts = `<option value="">—</option>` + S.packages.filter((p) => p.status === "active").map((p) =>
    `<option value="${p.id}" ${s.package_id == p.id ? "selected" : ""}>${esc(p.name)} (${fmtVND(p.monthly_fee)})</option>`).join("");
  openModal(`<h3>${id ? "Sửa" : "Thêm"} học viên</h3><form id="f">
    <div class="grid" style="grid-template-columns:1fr 1fr;gap:.4rem .6rem">
    <div><label>Họ tên *</label><input name="full_name" value="${esc(s.full_name || "")}" required></div>
    <div><label>SĐT phụ huynh</label><input name="phone" value="${esc(s.phone || "")}"></div>
    <div><label>Ngày sinh</label><input name="dob" type="date" value="${(s.dob || "").slice(0, 10)}"></div>
    <div><label>Ngày vào lớp *</label><input name="joined_on" type="date" value="${(s.joined_on || todayInput()).slice(0, 10)}" required></div>
    <div><label>Lớp</label><select name="class_id"><option value="">—</option>${clsOpts}</select></div>
    <div><label>Gói học</label><select name="package_id">${pkgOpts}</select></div>
    <div><label>HP đã đóng đến ngày</label><input name="paid_through" type="date" value="${(s.paid_through || "").slice(0, 10)}"></div>
    <div><label>Trạng thái</label><select name="status">
      ${["active", "paused", "stopped"].map((x) => `<option value="${x}" ${s.status === x ? "selected" : ""}>${ST_LABEL[x]}</option>`).join("")}</select></div>
    <div><label>Chiều cao (cm)</label><input name="height_cm" type="number" step="0.1" value="${s.height_cm || ""}"></div>
    <div><label>Cân nặng (kg)</label><input name="weight_kg" type="number" step="0.1" value="${s.weight_kg || ""}"></div>
    </div>
    <label>Lưu ý sức khỏe</label><textarea name="health_note">${esc(s.health_note || "")}</textarea>
    <div class="btnrow"><button class="btn">Lưu</button><button type="button" class="btn ghost" onclick="closeModal()">Hủy</button>
    ${id ? `<button type="button" class="btn danger" onclick="studentDel(${id})">Xóa</button>` : ""}</div></form>`);
  $("#f").onsubmit = async (e) => {
    e.preventDefault(); const fd = new FormData(e.target);
    const body = {
      branch_id: S.branchId, full_name: fd.get("full_name"), phone: fd.get("phone"), dob: fd.get("dob") || null,
      joined_on: fd.get("joined_on"), class_id: fd.get("class_id") || null, package_id: fd.get("package_id") || null,
      paid_through: fd.get("paid_through") || null, status: fd.get("status"),
      height_cm: fd.get("height_cm") || "", weight_kg: fd.get("weight_kg") || "", health_note: fd.get("health_note"),
    };
    try {
      if (id) await api("PUT", "/students/" + id, body); else await api("POST", "/students", body);
      closeModal(); toast("Đã lưu");
      if (location.hash.startsWith("#/students/") && id) vStudentDetail(id); else route();
    } catch (err) { toast(err.message); }
  };
};
window.studentDel = async (id) => {
  if (!await confirmDlg("Xóa học viên này?")) return;
  try { await api("DELETE", "/students/" + id); closeModal(); location.hash = "#/students"; route(); } catch (err) { toast(err.message); }
};

async function vStudentDetail(id) {
  const s = await api("GET", "/students/" + id);
  V.innerHTML = pageHead(s.full_name, `<button class="btn ghost" onclick="studentForm(${s.id})">Sửa</button>`) +
    `<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(280px,1fr))">
    <div class="card"><h3>Thông tin</h3>
      <table>
      <tr><td class="muted">Lớp</td><td><b>${esc(s.class_name || "—")}</b></td></tr>
      <tr><td class="muted">Gói</td><td>${esc(s.package_name || "—")} ${s.package_fee ? "(" + fmtVND(s.package_fee) + ")" : ""}</td></tr>
      <tr><td class="muted">Ngày sinh</td><td>${fmtDate(s.dob)}</td></tr>
      <tr><td class="muted">SĐT phụ huynh</td><td>${esc(s.phone || "—")}</td></tr>
      <tr><td class="muted">Ngày vào lớp</td><td>${fmtDate(s.joined_on)}</td></tr>
      <tr><td class="muted">Trạng thái học</td><td>${stBadge(s.status)}</td></tr>
      <tr><td class="muted">Học phí</td><td>${feeBadge(s.fee_state)} <span class="muted">đến ${fmtDate(s.paid_through)}</span></td></tr>
      </table></div>
    <div class="card"><h3>Thể trạng & sức khỏe</h3>
      <table>
      <tr><td class="muted">Chiều cao</td><td>${s.height_cm ? s.height_cm + " cm" : "—"}</td></tr>
      <tr><td class="muted">Cân nặng</td><td>${s.weight_kg ? s.weight_kg + " kg" : "—"}</td></tr>
      </table>
      <p>${esc(s.health_note || "Chưa có lưu ý sức khỏe.")}</p>
      <div class="btnrow"><button class="btn small" onclick="payFor(${s.id})">Thu học phí</button></div></div>
    </div>
    <div class="card"><h3>Lịch sử thu phí</h3>
      ${s.payments.length ? `<div class="tbl-wrap"><table><tr><th>Ngày</th><th>Nhóm</th><th>Số tiền</th><th>Đến ngày</th><th>Ghi chú</th></tr>
      ${s.payments.map((p) => `<tr><td>${fmtDate(p.paid_on)}</td><td>${CAT_LABEL[p.category] || p.category}</td>
      <td><b>${fmtVND(p.amount)}</b></td><td>${fmtDate(p.paid_through)}</td><td class="muted">${esc(p.note || "")}</td></tr>`).join("")}</table></div>`
      : `<p class="muted">Chưa có khoản thu nào.</p>`}</div>`;
}

/* ----- packages (admin) ----- */
async function vPackages() {
  if (!isAdmin()) { location.hash = "#/dashboard"; return; }
  V.innerHTML = pageHead("Gói học", `<button class="btn" onclick="pkgForm()">+ Thêm gói</button>`) +
    `<div class="card"><div class="tbl-wrap"><table><tr><th>Tên gói</th><th>Số buổi/tuần</th><th>Hình thức</th><th>Học phí</th><th>HV</th><th>TT</th><th></th></tr>
    ${S.packages.map((p) => `<tr><td><b>${esc(p.name)}</b></td><td>${p.sessions_per_week || "—"}</td>
      <td>${p.training_format === "private" ? "Kèm 1:1" : "Nhóm"}</td><td><b>${fmtVND(p.monthly_fee)}</b></td>
      <td>${p.active_students}</td><td>${p.status === "active" ? `<span class="badge b-active">Mở</span>` : `<span class="badge b-inactive">Ngừng</span>`}</td>
      <td><button class="btn small ghost" onclick="pkgForm(${p.id})">Sửa</button></td></tr>`).join("")}</table></div></div>`;
}
window.pkgForm = async (id) => {
  const p = id ? S.packages.find((x) => x.id === id) : {};
  openModal(`<h3>${id ? "Sửa" : "Thêm"} gói học</h3><form id="f">
    <label>Tên gói</label><input name="name" value="${esc(p.name || "")}" required>
    <div class="grid" style="grid-template-columns:1fr 1fr;gap:.4rem .6rem">
    <div><label>Số buổi/tuần</label><input name="sessions_per_week" type="number" min="1" value="${p.sessions_per_week || ""}"></div>
    <div><label>Hình thức</label><select name="training_format">
      <option value="group" ${p.training_format === "group" ? "selected" : ""}>Nhóm</option>
      <option value="private" ${p.training_format === "private" ? "selected" : ""}>Kèm 1:1</option></select></div>
    </div>
    <label>Học phí (đ/tháng)</label><input name="monthly_fee" type="number" min="0" value="${p.monthly_fee || 0}">
    <label>Trạng thái</label><select name="status"><option value="active" ${p.status !== "inactive" ? "selected" : ""}>Đang mở</option>
      <option value="inactive" ${p.status === "inactive" ? "selected" : ""}>Ngừng áp dụng</option></select>
    <div class="btnrow"><button class="btn">Lưu</button><button type="button" class="btn ghost" onclick="closeModal()">Hủy</button>
    ${id ? `<button type="button" class="btn danger" onclick="pkgDel(${id})">Xóa</button>` : ""}</div></form>`);
  $("#f").onsubmit = async (e) => {
    e.preventDefault(); const fd = new FormData(e.target);
    const body = { branch_id: S.branchId, name: fd.get("name"), sessions_per_week: fd.get("sessions_per_week") || null,
      training_format: fd.get("training_format"), monthly_fee: fd.get("monthly_fee"), status: fd.get("status") };
    try {
      if (id) await api("PUT", "/packages/" + id, body); else await api("POST", "/packages", body);
      closeModal(); await refreshLookups(); vPackages(); toast("Đã lưu");
    } catch (err) { toast(err.message); }
  };
};
window.pkgDel = async (id) => {
  if (!await confirmDlg("Xóa gói này?")) return;
  try { await api("DELETE", "/packages/" + id); closeModal(); await refreshLookups(); vPackages(); } catch (err) { toast(err.message); }
};

/* ----- attendance ----- */
async function vAttendance() {
  const params = new URLSearchParams(location.hash.split("?")[1] || "");
  const preClass = params.get("class") || (S.classes[0] ? S.classes[0].id : "");
  V.innerHTML = pageHead("Điểm danh") +
    `<div class="card"><div class="row">
      <select id="aClass" style="flex:1;min-width:150px">${S.classes.map((c) => `<option value="${c.id}" ${c.id == preClass ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select>
      <input type="date" id="aDate" value="${todayInput()}" style="width:auto">
      <button class="btn" onclick="takeAttendance()">Điểm danh</button>
      <button class="btn ghost" onclick="attSummary()">% Chuyên cần</button></div>
      <div id="aList" style="margin-top:.7rem"></div></div>`;
  $("#aClass").onchange = loadAttSessions; loadAttSessions();
}
async function loadAttSessions() {
  const cid = $("#aClass").value;
  const ss = await api("GET", `/attendance/sessions?class_id=${cid}`);
  $("#aList").innerHTML = ss.length ? `<div class="tbl-wrap"><table><tr><th>Ngày</th><th>Có mặt</th><th></th></tr>
    ${ss.map((s) => `<tr><td>${fmtDate(s.session_date)}</td><td>${s.present_count}/${s.total_count}</td>
    <td><button class="btn small ghost" onclick="takeAttendance(${s.class_id},'${s.session_date}')">Sửa</button></td></tr>`).join("")}</table></div>`
    : `<p class="muted">Chưa có buổi điểm danh nào.</p>`;
}
window.takeAttendance = async (cid, date) => {
  cid = cid || $("#aClass").value; date = date || $("#aDate").value;
  const ss = await api("GET", `/attendance/sessions?class_id=${cid}`);
  const hit = ss.find((s) => String(s.session_date).slice(0, 10) === date);
  let roster = [];
  if (hit) {
    const full = await api("GET", `/attendance/sessions/${hit.id}`);
    roster = full.roster.map((r) => ({ ...r, status: (full.records.find((x) => x.student_id === r.id) || {}).status || "present" }));
  } else {
    roster = (await api("GET", `/students?class_id=${cid}`)).map((s) => ({ id: s.id, full_name: s.full_name, status: "present" }));
  }
  openModal(`<h3>Điểm danh — ${esc(className(cid))} · ${fmtDate(date)}</h3>
    ${roster.map((r) => `<div class="att-row"><div class="nm">${esc(r.full_name)}</div>
      <div class="seg" data-sid="${r.id}">
        <button data-v="present" class="${r.status === "present" ? "on-p" : ""}">Có mặt</button>
        <button data-v="absent" class="${r.status === "absent" ? "on-a" : ""}">Vắng</button>
        <button data-v="excused" class="${r.status === "excused" ? "on-e" : ""}">Có phép</button>
      </div></div>`).join("")}
    <div class="btnrow"><button class="btn" onclick="saveAttendance(${cid},'${date}')">Lưu điểm danh</button>
    <button class="btn ghost" onclick="closeModal()">Hủy</button></div>`);
  $$("#modalBody .seg button").forEach((b) => b.onclick = () => {
    const seg = b.parentElement;
    $$("button", seg).forEach((x) => x.className = "");
    b.className = b.dataset.v === "present" ? "on-p" : b.dataset.v === "absent" ? "on-a" : "on-e";
    seg.dataset.sel = b.dataset.v;
  });
  $$("#modalBody .seg").forEach((seg) => { if (!seg.dataset.sel) seg.dataset.sel = "present"; });
};
window.saveAttendance = async (cid, date) => {
  const records = $$("#modalBody .seg").map((seg) => ({ student_id: Number(seg.dataset.sid), status: seg.dataset.sel || "present" }));
  try {
    await api("POST", "/attendance/sessions", { class_id: cid, session_date: date, records });
    closeModal(); toast("Đã lưu điểm danh"); route();
  } catch (err) { toast(err.message); }
};
window.attSummary = async (cid) => {
  cid = cid || ($("#aClass") ? $("#aClass").value : null) || (S.classes[0] && S.classes[0].id);
  const rows = await api("GET", `/attendance/summary?class_id=${cid}`);
  openModal(`<h3>% Chuyên cần — ${esc(className(cid))}</h3>
    <div class="tbl-wrap"><table><tr><th>Học viên</th><th>Buổi</th><th>Có mặt</th><th>%</th></tr>
    ${rows.map((r) => `<tr><td>${esc(r.full_name)}</td><td>${r.total}</td><td>${r.present}</td>
    <td>${r.rate === null ? "—" : `<div class="progress ${r.rate < 70 ? "low" : ""}"><div style="width:${r.rate}%"></div></div> ${r.rate}%`}</td></tr>`).join("")}</table></div>
    <div class="btnrow"><button class="btn ghost" onclick="closeModal()">Đóng</button></div>`);
};

/* ----- teaching logs ----- */
async function vTeachingLogs() {
  V.innerHTML = pageHead("Nhật ký giảng dạy", `<button class="btn" onclick="logForm()">+ Ghi nhật ký</button>`) +
    `<div class="card"><div class="row"><select id="lClass" style="width:auto"><option value="">Tất cả lớp</option>
    ${S.classes.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join("")}</select>
    <button class="btn" onclick="loadLogs()">Lọc</button></div><div id="logList" style="margin-top:.6rem"></div></div>`;
  loadLogs();
}
window.loadLogs = async () => {
  const cid = $("#lClass").value;
  const logs = await api("GET", `/teaching-logs${cid ? "?class_id=" + cid : ""}`);
  $("#logList").innerHTML = logs.map((l) => `<div class="card"><div class="row spread"><b>${esc(l.class_name)} · ${fmtDate(l.log_date)}</b>
    <span class="muted">${esc(l.author || "")}</span></div><p>${esc(l.content)}</p>
    <div class="btnrow"><button class="btn small ghost" onclick="logForm(null,${l.id})">Sửa</button>
    <button class="btn small danger" onclick="logDel(${l.id})">Xóa</button></div></div>`).join("") ||
    `<p class="muted">Chưa có nhật ký.</p>`;
};
window.logForm = async (presetClass, id) => {
  let l = {};
  if (id) { const all = await api("GET", "/teaching-logs"); l = all.find((x) => x.id === id) || {}; }
  openModal(`<h3>${id ? "Sửa" : "Ghi"} nhật ký giảng dạy</h3><form id="f">
    <label>Lớp</label><select name="class_id">${S.classes.map((c) => `<option value="${c.id}" ${(l.class_id || presetClass) == c.id ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select>
    <label>Ngày</label><input name="log_date" type="date" value="${(l.log_date || todayInput()).slice(0, 10)}">
    <label>Nội dung buổi dạy</label><textarea name="content">${esc(l.content || "")}</textarea>
    <div class="btnrow"><button class="btn">Lưu</button><button type="button" class="btn ghost" onclick="closeModal()">Hủy</button></div></form>`);
  $("#f").onsubmit = async (e) => {
    e.preventDefault(); const fd = new FormData(e.target);
    const body = { class_id: fd.get("class_id"), log_date: fd.get("log_date"), content: fd.get("content") };
    try {
      if (id) await api("PUT", "/teaching-logs/" + id, body); else await api("POST", "/teaching-logs", body);
      closeModal(); toast("Đã lưu"); route();
    } catch (err) { toast(err.message); }
  };
};
window.logDel = async (id) => {
  if (!await confirmDlg("Xóa nhật ký này?")) return;
  try { await api("DELETE", "/teaching-logs/" + id); toast("Đã xóa"); route(); } catch (err) { toast(err.message); }
};

/* ----- chấm công HLV ----- */
let TS_CACHE = [];
async function vTimesheets() {
  const m = todayInput().slice(0, 7);
  const coachOpts = isAdmin()
    ? `<select id="tsCoach" style="width:auto"><option value="">Tất cả HLV</option>${
        S.users.filter((u) => u.role === "coach" && u.status === "active")
          .map((u) => `<option value="${u.id}">${esc(u.full_name || u.username)}</option>`).join("")}</select>`
    : "";
  V.innerHTML = pageHead("Chấm công HLV", isAdmin() ? `<button class="btn" onclick="tsForm()">+ Chấm công</button>` : "") +
    `<div class="card"><div class="row"><input id="tsMonth" type="month" value="${m}" style="width:auto">${coachOpts}
    <button class="btn" onclick="loadTimesheets()">Xem</button></div></div>
    <div id="tsSummary"></div>
    <div class="card"><h3>Buổi dạy trong tháng</h3><div id="tsList"><p class="muted">Đang tải...</p></div></div>`;
  loadTimesheets();
}
window.loadTimesheets = async () => {
  const month = $("#tsMonth").value || todayInput().slice(0, 7);
  const uid = isAdmin() && $("#tsCoach") ? $("#tsCoach").value : "";
  const q = `?branch_id=${S.branchId}&month=${month}${uid ? "&user_id=" + uid : ""}`;
  try {
    const [summary, list] = await Promise.all([
      api("GET", "/timesheets/summary" + q),
      api("GET", "/timesheets" + q),
    ]);
    TS_CACHE = list;
    $("#tsSummary").innerHTML = `<div class="grid kpi">` + summary.map((s) =>
      `<div class="card"><div class="num">${s.total_hours}</div><div class="lbl">${esc(s.full_name || s.username)} · ${s.sessions} buổi</div></div>`
    ).join("") + `</div>`;
    $("#tsList").innerHTML = list.length
      ? `<div class="tbl-wrap"><table><tr><th>Ngày</th><th>HLV</th><th>Lớp</th><th style="text-align:right">Giờ</th><th>Ghi chú</th>${isAdmin() ? "<th></th>" : ""}</tr>` +
        list.map((t) => `<tr><td>${fmtDate(t.work_date)}</td><td>${esc(t.coach_name)}</td><td>${esc(t.class_name || "—")}</td>` +
          `<td style="text-align:right"><b>${t.hours}</b></td><td class="muted">${esc(t.note || "")}</td>` +
          (isAdmin() ? `<td><div class="btnrow" style="margin:0;flex-wrap:nowrap"><button class="btn small ghost" onclick="tsForm(${t.id})">Sửa</button>` +
            `<button class="btn small danger" onclick="tsDel(${t.id})">Xóa</button></div></td>` : "") + `</tr>`).join("") + `</table></div>`
      : `<p class="muted">Chưa có buổi dạy nào trong tháng này.</p>`;
  } catch (err) {
    $("#tsList").innerHTML = `<p style="color:var(--bad)">${esc(err.message)}</p>`;
  }
};
window.tsForm = async (id) => {
  const t = id ? (TS_CACHE.find((x) => x.id === id) || {}) : {};
  const coaches = S.users.filter((u) => u.role === "coach" && u.status === "active");
  openModal(`<h3>${id ? "Sửa" : "Thêm"} chấm công HLV</h3><form id="f">
    <label>Huấn luyện viên</label><select name="user_id">${
      coaches.map((u) => `<option value="${u.id}" ${t.user_id == u.id ? "selected" : ""}>${esc(u.full_name || u.username)}</option>`).join("")}</select>
    <label>Lớp dạy</label><select name="class_id"><option value="">— Ngoài lớp / khác —</option>${
      S.classes.map((c) => `<option value="${c.id}" ${t.class_id == c.id ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select>
    <label>Ngày dạy</label><input name="work_date" type="date" value="${(t.work_date || todayInput()).slice(0, 10)}">
    <label>Số giờ dạy</label><input name="hours" type="number" step="0.5" min="0.5" max="24" value="${t.hours || 1.5}">
    <label>Ghi chú</label><input name="note" value="${esc(t.note || "")}">
    <div class="btnrow"><button class="btn">Lưu</button><button type="button" class="btn ghost" onclick="closeModal()">Hủy</button></div></form>`);
  $("#f").onsubmit = async (e) => {
    e.preventDefault(); const fd = new FormData(e.target);
    const body = { branch_id: S.branchId, user_id: fd.get("user_id"), class_id: fd.get("class_id") || null,
      work_date: fd.get("work_date"), hours: fd.get("hours"), note: fd.get("note") };
    try {
      if (id) await api("PUT", "/timesheets/" + id, body); else await api("POST", "/timesheets", body);
      closeModal(); toast("Đã lưu"); route();
    } catch (err) { toast(err.message); }
  };
};
window.tsDel = async (id) => {
  if (!await confirmDlg("Xóa buổi chấm công này?")) return;
  try { await api("DELETE", "/timesheets/" + id); toast("Đã xóa"); route(); } catch (err) { toast(err.message); }
};

/* ----- đổi ca dạy ----- */
async function vShiftSwaps() {
  V.innerHTML = pageHead("Đổi ca dạy", `<button class="btn" onclick="shiftForm()">+ Yêu cầu đổi ca</button>`) +
    (isAdmin()
      ? `<div class="card"><div class="row"><select id="swStatus" style="width:auto"><option value="">Tất cả trạng thái</option><option value="pending" selected>Chờ duyệt</option><option value="approved">Đã duyệt</option><option value="rejected">Từ chối</option></select><button class="btn" onclick="loadShifts()">Lọc</button></div></div>`
      : `<div class="card"><p class="muted">HLV nào dạy thay sẽ điểm danh bằng tài khoản của mình — buổi dạy tự ghi chấm công cho người đó.</p></div>`) +
    `<div class="card"><div id="swList"><p class="muted">Đang tải...</p></div></div>`;
  loadShifts();
}
window.loadShifts = async () => {
  try {
    const st = isAdmin() && $("#swStatus") ? $("#swStatus").value : "";
    const list = await api("GET", `/shift-swaps?branch_id=${S.branchId}${st ? "&status=" + st : ""}`);
    $("#swList").innerHTML = list.length ? `<div class="tbl-wrap"><table>
      <tr><th>Ngày</th><th>Lớp</th><th>Người xin</th><th>Đổi với</th><th>Lý do</th><th>Trạng thái</th><th></th></tr>` +
      list.map((s) => `<tr><td>${fmtDate(s.work_date)}</td><td>${esc(s.class_name)}</td>
        <td>${esc(s.requester_name || s.requester_username)}</td>
        <td>${esc(s.swap_with_name || s.swap_with_username || "—")}</td>
        <td class="muted">${esc(s.reason || "")}${s.review_note ? `<br><b>Phản hồi:</b> ${esc(s.review_note)}` : ""}</td>
        <td>${swapBadge(s.status)}</td><td>` +
        (isAdmin() && s.status === "pending"
          ? `<div class="btnrow" style="margin:0;flex-wrap:nowrap"><button class="btn small ok" onclick="shiftReview(${s.id},true)">Duyệt</button><button class="btn small danger" onclick="shiftReview(${s.id},false)">Từ chối</button></div>`
          : (!isAdmin() && s.status === "pending" ? `<button class="btn small ghost" onclick="shiftCancel(${s.id})">Hủy</button>` : "")) +
        `</td></tr>`).join("") + `</table></div>`
      : `<p class="muted">Chưa có yêu cầu đổi ca.</p>`;
  } catch (err) {
    $("#swList").innerHTML = `<p style="color:var(--bad)">${esc(err.message)}</p>`;
  }
};
window.shiftForm = async () => {
  const coaches = await api("GET", "/shift-swaps/coaches").catch(() => []);
  const others = coaches.filter((c) => c.id !== S.user.id);
  openModal(`<h3>Yêu cầu đổi ca dạy</h3><form id="f">
    <label>Lớp</label><select name="class_id">${S.classes.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join("")}</select>
    <label>Ngày dạy cần đổi</label><input name="work_date" type="date" value="${todayInput()}" required>
    <label>Muốn đổi với HLV</label><select name="swap_with_id"><option value="">— Nhờ quản trị viên sắp xếp —</option>${
      others.map((c) => `<option value="${c.id}">${esc(c.full_name || c.username)}</option>`).join("")}</select>
    <label>Lý do</label><input name="reason" maxlength="300" placeholder="VD: bận việc gia đình">
    <div class="btnrow"><button class="btn">Gửi yêu cầu</button><button type="button" class="btn ghost" onclick="closeModal()">Hủy</button></div></form>`);
  $("#f").onsubmit = async (e) => {
    e.preventDefault(); const fd = new FormData(e.target);
    try {
      await api("POST", "/shift-swaps", { branch_id: S.branchId, class_id: fd.get("class_id"),
        work_date: fd.get("work_date"), swap_with_id: fd.get("swap_with_id") || null, reason: fd.get("reason") });
      closeModal(); toast("Đã gửi yêu cầu"); route();
    } catch (err) { toast(err.message); }
  };
};
window.shiftReview = async (id, ok) => {
  let note = "";
  if (!ok) {
    const r = window.prompt("Lý do từ chối (không bắt buộc):");
    if (r === null) return;
    note = r;
  }
  try {
    await api("PUT", `/shift-swaps/${id}/${ok ? "approve" : "reject"}`, { review_note: note });
    toast(ok ? "Đã duyệt đổi ca" : "Đã từ chối"); route();
  } catch (err) { toast(err.message); }
};
window.shiftCancel = async (id) => {
  if (!await confirmDlg("Hủy yêu cầu đổi ca này?")) return;
  try { await api("DELETE", "/shift-swaps/" + id); toast("Đã hủy"); route(); } catch (err) { toast(err.message); }
};

/* ----- fees ----- */
async function vFees() {
  V.innerHTML = pageHead("Thu phí", `<button class="btn" onclick="payFor()">+ Ghi nhận thu</button>`) + `<div id="feeBody"><p class="muted">Đang tải...</p></div>`;
  const m = todayInput().slice(0, 7);
  const sum = await api("GET", `/payments/revenue/summary?branch_id=${S.branchId}&from=${m}-01&to=${m}-31`);
  const grand = sum.grandTotal;
  $("#feeBody").innerHTML = `
  <div class="card"><h3>💰 Tổng quan tháng ${m.slice(5)}/${m.slice(0, 4)}: ${fmtVND(grand)}</h3>
    <div class="tbl-wrap"><table><tr><th>Nhóm</th><th style="text-align:right">Số khoản</th><th style="text-align:right">Tổng</th></tr>
    ${Object.keys(CAT_LABEL).map((k) => `<tr><td>${CAT_LABEL[k]}</td><td style="text-align:right">${sum.byCategory[k].count}</td>
    <td style="text-align:right"><b>${fmtVND(sum.byCategory[k].total)}</b></td></tr>`).join("")}</table></div></div>
  <div class="card"><h3>Theo lớp</h3>
    ${S.classes.map((c) => `<div class="att-row"><div class="nm"><b>${esc(c.name)}</b><br><span class="muted">${c.active_students} HV</span></div>
    <button class="btn small" onclick="location.hash='#/classes/${c.id}/fees'">Xem thu phí</button></div>`).join("")}</div>
  <div class="card"><h3>Khoản thu gần đây</h3><div id="payList"></div></div>`;
  const pays = await api("GET", `/payments?branch_id=${S.branchId}`);
  $("#payList").innerHTML = pays.length ? `<div class="tbl-wrap"><table><tr><th>Ngày</th><th>Học viên / Nội dung</th><th>Nhóm</th><th style="text-align:right">Số tiền</th></tr>
    ${pays.slice(0, 30).map((p) => `<tr><td>${fmtDate(p.paid_on)}</td><td>${esc(p.student_name || p.note || "—")}</td>
    <td class="muted">${CAT_LABEL[p.category] || p.category}</td><td style="text-align:right"><b>${fmtVND(p.amount)}</b></td></tr>`).join("")}</table></div>`
    : `<p class="muted">Chưa có khoản thu nào.</p>`;
}
window.payFor = async (studentId, classId) => {
  let s = null;
  if (studentId) s = await api("GET", "/students/" + studentId).catch(() => null);
  const pkgFee = s && s.package_fee ? s.package_fee : "";
  openModal(`<h3>Ghi nhận thu phí${s ? " — " + esc(s.full_name) : ""}</h3><form id="f">
    <label>Nhóm khoản thu</label><select name="category">
    ${Object.keys(CAT_LABEL).map((k) => `<option value="${k}">${CAT_LABEL[k]}</option>`).join("")}</select>
    <label>Số tiền (đ) — tự điền theo gói, sửa linh động được</label>
    <input name="amount" type="number" min="1" value="${pkgFee}" required>
    <label>Ngày thu</label><input name="paid_on" type="date" value="${todayInput()}" required>
    <label>HP đóng đến ngày (nếu là học phí)</label><input name="paid_through" type="date" value="${s && s.paid_through ? String(s.paid_through).slice(0, 10) : ""}">
    <label>Ghi chú</label><input name="note">
    <div class="btnrow"><button class="btn">Lưu</button><button type="button" class="btn ghost" onclick="closeModal()">Hủy</button></div></form>`);
  $("#f").onsubmit = async (e) => {
    e.preventDefault(); const fd = new FormData(e.target);
    try {
      await api("POST", "/payments", { branch_id: S.branchId, student_id: studentId || null,
        category: fd.get("category"), amount: fd.get("amount"), paid_on: fd.get("paid_on"),
        paid_through: fd.get("paid_through") || null, note: fd.get("note") });
      closeModal(); toast("Đã ghi nhận"); route();
    } catch (err) { toast(err.message); }
  };
};

/* ----- users (admin) ----- */
async function vUsers() {
  if (!isAdmin()) { location.hash = "#/dashboard"; return; }
  const users = await api("GET", "/users");
  V.innerHTML = pageHead("Tài khoản", `<button class="btn" onclick="userForm()">+ Thêm</button>`) +
    `<div class="card"><div class="tbl-wrap"><table><tr><th>Tên đăng nhập</th><th>Họ tên</th><th>Vai trò</th><th>Lớp phụ trách</th><th>TT</th><th></th></tr>
    ${users.map((u) => `<tr><td><b>${esc(u.username)}</b></td><td>${esc(u.full_name || "—")}</td>
      <td>${u.role === "admin" ? "Quản trị" : "HLV"}</td>
      <td class="muted">${classIdsOf(u).map((cid) => esc(className(cid))).join(", ") || "—"}</td>
      <td>${u.status === "active" ? `<span class="badge b-active">Mở</span>` : `<span class="badge b-inactive">Khóa</span>`}</td>
      <td><button class="btn small ghost" onclick="userForm(${u.id})">Sửa</button></td></tr>`).join("")}</table></div>
      <p class="muted">Gán lớp cho HLV: vào Lớp học → mở lớp → tab HLV.</p></div>`;
}
window.userForm = async (id) => {
  const users = await api("GET", "/users");
  const u = id ? users.find((x) => x.id === id) : {};
  openModal(`<h3>${id ? "Sửa" : "Thêm"} tài khoản</h3><form id="f">
    <label>Tên đăng nhập</label><input name="username" value="${esc(u.username || "")}" ${id ? "disabled" : "required"}>
    <label>Họ tên</label><input name="full_name" value="${esc(u.full_name || "")}">
    <label>Mật khẩu ${id ? "(để trống nếu không đổi)" : ""}</label><input name="password" type="password" ${id ? "" : "required"}>
    <label>Vai trò</label><select name="role"><option value="coach" ${u.role === "coach" ? "selected" : ""}>Huấn luyện viên</option>
      <option value="admin" ${u.role === "admin" ? "selected" : ""}>Quản trị viên</option></select>
    <label>Lớp phụ trách (chỉ áp dụng cho HLV — có thể chọn nhiều lớp)</label>
    <div>${S.classes.map((c) => `<label style="display:flex;gap:.45rem;align-items:center;margin:.3rem 0;font-size:.95rem;color:var(--ink)"><input type="checkbox" name="class_id" value="${c.id}" style="width:auto" ${classIdsOf(u).includes(c.id) ? "checked" : ""}> ${esc(c.name)}</label>`).join("") || `<p class="muted">Chưa có lớp nào.</p>`}</div>
    <label>Trạng thái</label><select name="status"><option value="active" ${u.status !== "inactive" ? "selected" : ""}>Đang mở</option>
      <option value="inactive" ${u.status === "inactive" ? "selected" : ""}>Khóa</option></select>
    <div class="btnrow"><button class="btn">Lưu</button><button type="button" class="btn ghost" onclick="closeModal()">Hủy</button>
    ${id ? `<button type="button" class="btn danger" onclick="userDel(${id})">Xóa</button>` : ""}</div></form>`);
  $("#f").onsubmit = async (e) => {
    e.preventDefault(); const fd = new FormData(e.target);
    const body = { full_name: fd.get("full_name"), role: fd.get("role"), status: fd.get("status") };
    if (fd.get("password")) body.password = fd.get("password");
    if (!id) body.username = fd.get("username");
    try {
      let uid = id;
      if (id) await api("PUT", "/users/" + id, body);
      else { const created = await api("POST", "/users", body); uid = created.id; }
      // Lưu lớp phụ trách cho HLV
      if (uid && body.role === "coach") {
        const checked = $$("#f input[name=class_id]:checked").map((x) => Number(x.value));
        await api("PUT", `/users/${uid}/classes`, { classIds: checked });
      }
      closeModal(); toast("Đã lưu"); vUsers();
    } catch (err) { toast(err.message); }
  };
};
window.userDel = async (id) => {
  if (!await confirmDlg("Xóa tài khoản này?")) return;
  try { await api("DELETE", "/users/" + id); closeModal(); vUsers(); } catch (err) { toast(err.message); }
};

/* ---------- router ---------- */
function closeNav() { $("#sidenav").classList.remove("open"); $("#navOverlay").classList.add("hidden"); }
$("#menuBtn").onclick = () => { $("#sidenav").classList.add("open"); $("#navOverlay").classList.remove("hidden"); };
$("#navOverlay").onclick = closeNav;
$("#logoutBtn").onclick = logout;
$("#modal").addEventListener("click", (e) => { if (e.target.id === "modal") closeModal(); });

async function route() {
  closeNav();
  if (!S.token) { vLogin(); return; }
  if (!S.user) { await boot(); return; }
  renderNav();
  const h = location.hash || "#/dashboard";
  const [path] = h.split("?");
  const seg = path.replace("#/", "").split("/");
  try {
    if (seg[0] === "login") vLogin();
    else if (seg[0] === "dashboard" || seg[0] === "") await vDashboard();
    else if (seg[0] === "branches") await vBranches();
    else if (seg[0] === "classes" && seg[1]) await vClassDetail(seg[1], seg[2]);
    else if (seg[0] === "classes") await vClasses();
    else if (seg[0] === "students" && seg[1]) await vStudentDetail(seg[1]);
    else if (seg[0] === "students") await vStudents();
    else if (seg[0] === "packages") await vPackages();
    else if (seg[0] === "attendance") await vAttendance();
    else if (seg[0] === "teaching-logs") await vTeachingLogs();
    else if (seg[0] === "timesheets") await vTimesheets();
    else if (seg[0] === "shift-swaps") await vShiftSwaps();
    else if (seg[0] === "fees") await vFees();
    else if (seg[0] === "users") await vUsers();
    else await vDashboard();
  } catch (err) {
    V.innerHTML = `<div class="card"><p style="color:var(--bad)">${esc(err.message)}</p>
      <button class="btn ghost" onclick="route()">Thử lại</button></div>`;
  }
  window.scrollTo(0, 0);
}

window.addEventListener("hashchange", route);
if (!location.hash) location.hash = "#/dashboard";
route();
