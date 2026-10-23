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
const isCoach = () => S.user && S.user.role === "coach";
const isStudent = () => S.user && S.user.role === "student";
const roleLabel = (r) => r === "admin" ? "Quản trị viên" : r === "student" ? "Học viên" : "Huấn luyện viên";

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

/* ----- tự động đăng xuất sau 30 phút không hoạt động ----- */
const IDLE_LIMIT = 30 * 60 * 1000;      // 30 phút
const IDLE_WARN_BEFORE = 2 * 60 * 1000; // cảnh báo trước 2 phút
let idleTimer = null, idleWarnTimer = null, lastIdleReset = 0;
function resetIdle() {
  if (!S.token) return;
  clearTimeout(idleTimer); clearTimeout(idleWarnTimer);
  const w = document.getElementById("idleWarn");
  if (w) w.style.display = "none";
  idleWarnTimer = setTimeout(showIdleWarn, IDLE_LIMIT - IDLE_WARN_BEFORE);
  idleTimer = setTimeout(doIdleLogout, IDLE_LIMIT);
}
function showIdleWarn() {
  if (!S.token) return;
  let w = document.getElementById("idleWarn");
  if (!w) {
    w = document.createElement("div");
    w.id = "idleWarn";
    w.style.cssText = "position:fixed;top:0;left:0;right:0;z-index:9999;background:#fff7e6;color:#7a4d00;padding:.6rem 1rem;text-align:center;font-size:.95rem;border-bottom:2px solid #f0b429;display:none";
    w.innerHTML = `⏳ Bạn đã không hoạt động gần 30 phút — hệ thống sẽ tự đăng xuất sau 2 phút nữa. <button class="btn small" style="margin-left:.5rem" onclick="resetIdle()">Tôi vẫn đang làm việc</button>`;
    document.body.prepend(w);
  }
  w.style.display = "";
}
function doIdleLogout() {
  if (!S.token) return;
  clearTimeout(idleTimer); clearTimeout(idleWarnTimer);
  const w = document.getElementById("idleWarn");
  if (w) w.style.display = "none";
  logout();
  toast("Đã tự động đăng xuất do không hoạt động 30 phút");
}
function watchIdle() {
  const onAct = () => {
    const now = Date.now();
    if (now - lastIdleReset < 2000) return; // chống spam sự kiện chuột
    lastIdleReset = now;
    resetIdle();
  };
  ["click", "keydown", "scroll", "touchstart", "mousemove"].forEach((ev) =>
    document.addEventListener(ev, onAct, { passive: true }));
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
  ["#/directory", "🔍", "Tra cứu"],
  ["#/fees", "💰", "Thu phí"],
  ["#/payroll", "💵", "Lương HLV", true],
  ["#/activities", "🏟️", "Hoạt động", true],
  ["#/profile", "👤", "Hồ sơ", false, "coach"],
  ["#/former-students", "🗂️", "Học viên cũ", true],
  ["#/packages", "📦", "Gói học", true],
  ["#/branches", "🏢", "Chi nhánh", true],
  ["#/users", "👥", "Tài khoản", true],
];

function renderNav() {
  const nav = $("#sidenav");
  const items = isStudent()
    ? [["#/dashboard", "📊", "Tổng quan"], ["#/classes", "🏫", "Lớp học"], ["#/curriculum", "📚", "Chương trình học"]]
    : NAV.filter((n) => (!n[3] || isAdmin()) && (!n[4] || S.user.role === n[4]));
  nav.innerHTML = `<div class="nav-user">👤 ${esc(S.user.full_name || S.user.username)}<br><span class="muted">${roleLabel(S.user.role)}</span></div>` +
    items.map((n) =>
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
  if (isStudent()) $("#branchSel").style.display = "none";
  resetIdle(); // bắt đầu đếm 30 phút không hoạt động
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
// Danh sách chi nhánh HLV trực thuộc
const branchIdsOf = (u) => {
  const v = u ? u.branch_ids : null;
  if (Array.isArray(v)) return v.map(Number).filter((n) => Number.isInteger(n));
  try { const p = JSON.parse(v || "[]"); return Array.isArray(p) ? p.map(Number).filter((n) => Number.isInteger(n)) : []; }
  catch (e) { return []; }
};
// Tick/bỏ tick chi nhánh ở form Tài khoản -> tick/bỏ tick tất cả lớp trong chi nhánh đó
window.toggleBranchClasses = (box) => {
  const block = box.closest(".branch-block");
  if (!block) return;
  block.querySelectorAll("input[name=class_id]").forEach((x) => { x.checked = box.checked; });
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

/* ----- tổng quan học viên ----- */
async function vStudentDash() {
  V.innerHTML = "<p class='muted'>Đang tải...</p>";
  try {
    const s = await api("GET", "/students/me");
    const a = s.attendance || { total: 0, present: 0, rate: null };
    // Nhắc nhở khi nghỉ từ 3 buổi không phép trong 30 ngày gần nhất
    const absentWarn = (a.absent_30d || 0) >= 3
      ? `<div class="card" style="border-left:4px solid var(--warn)"><b>⚠️ Nhắc nhở:</b> bạn đã nghỉ <b>${a.absent_30d} buổi</b> trong 30 ngày gần đây. Hãy cố gắng đi tập đều đặn để không bị gián đoạn chương trình nhé!</div>`
      : "";
    V.innerHTML = pageHead(`Chào ${esc(s.full_name)} 👋`) + absentWarn + `
    <div class="grid kpi">
      <div class="card"><div class="num">${a.total || 0}</div><div class="lbl">Buổi đã điểm danh</div></div>
      <div class="card"><div class="num" style="color:var(--ok)">${a.rate === null ? "—" : a.rate + "%"}</div><div class="lbl">Chuyên cần</div></div>
      <div class="card"><div class="num" style="color:var(--vovinam)">🥋</div><div class="lbl">${esc(s.belt_level || "Chưa xếp đai")}</div></div>
    </div>
    <div class="card"><h3>🏫 Lớp của tôi</h3>
      <table>
      <tr><td class="muted">Lớp</td><td><b>${esc(s.class_name || "—")}</b></td></tr>
      <tr><td class="muted">Lịch học</td><td>${esc(s.class_schedule || "—")}</td></tr>
      <tr><td class="muted">Phòng</td><td>${esc(s.class_room || "—")}</td></tr>
      <tr><td class="muted">Cấp đai hiện tại</td><td><b>${esc(s.belt_level || "—")}</b></td></tr>
      <tr><td class="muted">Học phí</td><td>${feeBadge(s.fee_state || s.status)} <span class="muted">đến ${fmtDate(s.paid_through)}</span></td></tr>
      </table></div>
    <div class="card"><h3>📊 Chuyên cần cá nhân</h3>
      <table>
      <tr><td class="muted">Có mặt</td><td><b style="color:var(--ok)">${a.present || 0}</b> buổi</td></tr>
      <tr><td class="muted">Vắng</td><td><b style="color:var(--bad)">${a.absent || 0}</b> buổi</td></tr>
      <tr><td class="muted">Có phép</td><td><b>${a.excused || 0}</b> buổi</td></tr>
      </table></div>`;
  } catch (err) {
    V.innerHTML = pageHead("Tổng quan") + `<div class="card"><p style="color:var(--bad)">${esc(err.message)}</p></div>`;
  }
}

/* ----- chương trình học (học viên) ----- */
async function vCurriculum() {
  V.innerHTML = "<p class='muted'>Đang tải...</p>";
  try {
    const s = await api("GET", "/students/me");
    const logs = s.class_id ? await api("GET", `/teaching-logs?class_id=${s.class_id}`) : [];
    V.innerHTML = pageHead("Chương trình học") + `
    <div class="card"><h3>🏫 ${esc(s.class_name || "—")}</h3>
      <p class="muted">${esc(s.class_schedule || "")}${s.class_room ? " · " + esc(s.class_room) : ""}</p></div>
    <div class="card"><h3>📚 Nội dung đã học (${logs.length})</h3>
      ${logs.length ? logs.map((l) => `<div class="card" style="margin:.5rem 0">
        <div class="row spread"><b>${fmtDate(l.log_date)}</b><span class="muted">${esc(l.author || "")}</span></div>
        <p><b>${esc(l.content)}</b></p>
        ${l.details ? `<p class="muted">${esc(l.details)}</p>` : ""}</div>`).join("")
      : `<p class="muted">Chưa có nội dung nào.</p>`}</div>`;
  } catch (err) {
    V.innerHTML = pageHead("Chương trình học") + `<div class="card"><p style="color:var(--bad)">${esc(err.message)}</p></div>`;
  }
}

/* ----- tải file excel ----- */
async function downloadXlsx(url, filename) {
  const r = await fetch("/api" + url, { headers: { Authorization: "Bearer " + S.token } });
  if (!r.ok) throw new Error("Không xuất được file");
  const blob = await r.blob();
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
window.exportStudents = (cid) => downloadXlsx(`/export/students?class_id=${cid}`, "danh-sach-lop.xlsx").catch((e) => toast(e.message));
window.exportAttendance = (cid) => {
  const m = ($("#attMonth") || {}).value || todayInput().slice(0, 7);
  downloadXlsx(`/export/attendance?class_id=${cid}&month=${m}`, "diem-danh.xlsx").catch((e) => toast(e.message));
};
window.exportTimesheets = () => {
  const m = ($("#tsMonth") || {}).value || todayInput().slice(0, 7);
  downloadXlsx(`/export/timesheets?month=${m}&branch_id=${S.branchId}`, `cham-cong-${m}.xlsx`).catch((e) => toast(e.message));
};
window.exportFinance = (m) => {
  downloadXlsx(`/export/finance?branch_id=${S.branchId}&month=${m}`, `bao-cao-tai-chinh-${m}.xlsx`).catch((e) => toast(e.message));
};
// Tổng quan mọi chi nhánh trong tháng (chỉ admin) — hiện ở cuối trang Tổng quan
async function loadDashBranches() {
  const el = document.getElementById("dashBranches");
  if (!el) return;
  const m = todayInput().slice(0, 7);
  try {
    const d = await api("GET", `/dashboard/branches?month=${m}`);
    el.innerHTML = `<div class="card"><h3>🏢 Tổng quan các chi nhánh — tháng ${m.slice(5)}/${m.slice(0, 4)}</h3>
    <div class="tbl-wrap"><table><tr><th>Chi nhánh</th><th style="text-align:right">HV</th><th style="text-align:right">Lớp</th>
    <th style="text-align:right">Thu giảng dạy</th><th style="text-align:right">Thu khác</th>
    <th style="text-align:right">Chi</th><th style="text-align:right">Chênh lệch</th></tr>
    ${d.branches.map((b) => `<tr><td><b>${esc(b.branch_name)}</b></td>
      <td style="text-align:right">${b.students}</td><td style="text-align:right">${b.classes}</td>
      <td style="text-align:right">${fmtVND(b.teaching_revenue)}</td>
      <td style="text-align:right">${fmtVND(b.other_revenue)}</td>
      <td style="text-align:right">${fmtVND(b.expenses)}</td>
      <td style="text-align:right"><b style="color:${b.balance >= 0 ? "var(--ok)" : "var(--bad)"}">${fmtVND(b.balance)}</b></td></tr>`).join("")}
    </table></div>
    <p class="muted">Đổi chi nhánh ở thanh trên để xem chi tiết từng nơi. Báo cáo đầy đủ: mục Lương HLV → nút Xuất Excel.</p></div>`;
  } catch (e) { el.innerHTML = ""; }
}

/* ----- dashboard ----- */
async function vDashboard() {
  if (isStudent()) { await vStudentDash(); return; }
  V.innerHTML = "<p class='muted'>Đang tải...</p>";
  const d = await api("GET", `/dashboard?branch_id=${S.branchId}`);
  const rev = d.revenueThisMonth; // null với HLV (đã ẩn ở backend)
  V.innerHTML = pageHead("Tổng quan") + `
  <div class="grid kpi">
    <div class="card"><div class="num">${d.totals.activeStudents}</div><div class="lbl">HV đang học</div></div>
    <div class="card"><div class="num">${d.totals.classes}</div><div class="lbl">Lớp học</div></div>
    <div class="card"><div class="num" style="color:var(--bad)">${d.overdue.length}</div><div class="lbl">Quá hạn HP</div></div>
    <div class="card"><div class="num" style="color:var(--warn)">${d.dueSoon.length}</div><div class="lbl">Sắp hết hạn</div></div>
  </div>
  ${rev ? `<div class="card"><h3>💰 Doanh thu tháng này: ${fmtVND(rev.tuition + rev.private + rev.rental + rev.performance + rev.other)}</h3>
    <div class="tbl-wrap"><table>
    ${Object.keys(CAT_LABEL).map((k) => `<tr><td>${CAT_LABEL[k]}</td><td style="text-align:right"><b>${fmtVND(rev[k])}</b></td></tr>`).join("")}
    </table></div></div>` : ""}
  <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(280px,1fr))">
    <div class="card"><h3>⚠️ Quá hạn học phí (${d.overdue.length})</h3>${feeList(d.overdue)}</div>
    <div class="card"><h3>⏳ Sắp hết hạn (${d.dueSoon.length})</h3>${feeList(d.dueSoon)}</div>
  </div>
  <div class="card"><h3>📅 Buổi học hôm nay (${d.todaySessions.length})</h3>
    ${d.todaySessions.length ? `<div class="tbl-wrap"><table><tr><th>Lớp</th><th>Lịch</th><th>Điểm danh</th></tr>
      ${d.todaySessions.map((s) => `<tr><td>${esc(s.class_name)}</td><td class="muted">${esc(s.schedule || "")}</td>
      <td><a href="#/attendance?class=${s.class_id || ""}">${s.records} HV</a></td></tr>`).join("")}</table></div>`
      : `<p class="muted">Chưa tạo buổi điểm danh nào hôm nay.</p>`}</div>
  ${isAdmin() ? `<div id="dashBranches"></div>` : ""}`;
  if (isAdmin()) loadDashBranches();
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
  // Hiện lớp theo từng chi nhánh. HLV: lớp mình dạy bấm vào làm việc được, lớp khác chỉ xem
  const all = await api("GET", "/classes").catch(() => S.classes);
  const mineIds = new Set(all.map((c) => c.id));
  let extras = [];
  if (isCoach()) {
    const cat = await api("GET", "/classes/catalog").catch(() => []);
    extras = cat.filter((c) => !mineIds.has(c.id) && c.status === "active");
  }
  const workCard = (c) => `<div class="card"><h3><a href="#/classes/${c.id}">${esc(c.name)}</a></h3>
      <div class="muted">${esc(c.schedule || "")}${c.room ? " · " + esc(c.room) : ""}</div>
      <div class="row spread" style="margin-top:.5rem"><span>${c.active_students} HV đang học</span>
      ${isAdmin() ? `<b>${fmtVND(c.monthly_fee)}</b>` : ""}</div>
      ${c.coaches ? `<div class="muted">HLV: ${esc(c.coaches)}</div>` : ""}</div>`;
  const viewCard = (c) => `<div class="card"><h3>${esc(c.name)}</h3>
      <div class="muted">${esc(c.schedule || "—")}${c.room ? " · " + esc(c.room) : ""}</div>
      <div class="row spread" style="margin-top:.5rem"><span>${c.active_students} HV đang học</span><span class="muted">👁 Chỉ xem</span></div>
      ${c.coaches && c.coaches.length ? `<div class="muted">HLV: ${c.coaches.map((h) => esc(h.name)).join(", ")}</div>` : ""}</div>`;
  const sections = S.branches.map((b) => {
    const cards = [
      ...all.filter((c) => c.branch_id === b.id).map(workCard),
      ...extras.filter((c) => c.branch_id === b.id).map(viewCard),
    ].join("");
    return `<div class="row spread" style="margin:1.1rem 0 .2rem"><h3 style="margin:0">🏢 ${esc(b.name)}</h3>
      ${isAdmin() ? `<button class="btn small" onclick="classForm(null,${b.id})">+ Thêm lớp</button>` : ""}</div>
      ${b.address ? `<p class="muted" style="margin:.1rem 0 .4rem">${esc(b.address)}</p>` : ""}
      ${cards ? `<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(260px,1fr))">${cards}</div>`
              : `<p class="muted">Chưa có lớp nào ở chi nhánh này.</p>`}`;
  }).join("");
  V.innerHTML = pageHead("Lớp học") + (sections || `<p class="muted">Chưa có chi nhánh nào.</p>`);
}
window.classForm = async (id, presetBranchId) => {
  let c = {};
  if (id) c = S.classes.find((x) => x.id === id) || await api("GET", "/classes/" + id).catch(() => ({}));
  const selBranch = id ? (c.branch_id || S.branchId) : (presetBranchId || S.branchId);
  openModal(`<h3>${id ? "Sửa" : "Thêm"} lớp học</h3><form id="f">
    <label>Chi nhánh</label><select name="branch_id">
      ${S.branches.map((b) => `<option value="${b.id}" ${selBranch === b.id ? "selected" : ""}>${esc(b.name)}</option>`).join("")}
    </select>
    <label>Tên lớp</label><input name="name" value="${esc(c.name || "")}" required>
    <label>Lịch học</label><input name="schedule" value="${esc(c.schedule || "")}" placeholder="VD: T2/4/6 17:00–18:30">
    <label>Phòng / Tầng</label><input name="room" value="${esc(c.room || "")}">
    <label>Học phí chuẩn (đ/tháng)</label><input name="monthly_fee" type="number" min="0" value="${c.monthly_fee || 0}">
    <div class="btnrow"><button class="btn">Lưu</button><button type="button" class="btn ghost" onclick="closeModal()">Hủy</button>
    ${id ? `<button type="button" class="btn danger" onclick="classDel(${id})">Xóa</button>` : ""}</div></form>`);
  $("#f").onsubmit = async (e) => {
    e.preventDefault(); const fd = new FormData(e.target);
    const body = { branch_id: fd.get("branch_id"), name: fd.get("name"), schedule: fd.get("schedule"), room: fd.get("room"), monthly_fee: fd.get("monthly_fee") };
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
    `<p class="muted">${esc(c.schedule)}${c.room ? " · " + esc(c.room) : ""}${isAdmin() ? ` · ${fmtVND(c.monthly_fee)}/tháng` : ""}</p>` + body;
  const el = $("#tabBody");
  if (tab === "students") {
    const list = await api("GET", `/students?class_id=${id}`);
    el.innerHTML = `<div class="row spread"><b>${list.length} học viên</b><div class="btnrow" style="margin:0">
      <button class="btn small ghost" onclick="exportStudents(${id})">⬇ Xuất Excel</button>
      <button class="btn small" onclick="studentForm(null,${id})">+ Thêm HV</button></div></div>
    <div class="tbl-wrap"><table><tr><th>Họ tên</th><th>Cấp đai</th><th>Gói</th><th>HP đến ngày</th><th>Vắng 30N</th><th>Trạng thái</th><th></th></tr>
    ${list.map((s) => `<tr class="clickable" onclick="location.hash='#/students/${s.id}'"><td><b>${esc(s.full_name)}</b><br><span class="muted">${esc(s.phone || "")}</span></td>
      <td>🥋 ${esc(s.belt_level || "—")}</td>
      <td class="muted">${esc(s.package_name || "—")}</td><td>${fmtDate(s.paid_through)}</td>
      <td>${(s.absent_30d || 0) >= 3 ? `<b style="color:var(--bad)">⚠️ ${s.absent_30d}</b>` : (s.absent_30d || 0)}</td>
      <td>${feeBadge(s.fee_state)}</td>
      <td><button class="btn small ghost" onclick="event.stopPropagation();transferStudent(${s.id})">🔀 Chuyển lớp</button></td></tr>`).join("")}</table></div>`;
  } else if (tab === "attendance") {
    el.innerHTML = `<div class="row"><input type="date" id="attDate" value="${todayInput()}" style="width:auto">
      <button class="btn" onclick="takeAttendance(${id})">Điểm danh</button>
      <button class="btn ghost" onclick="attSummary(${id})">% Chuyên cần</button></div>
      <div class="row" style="margin-top:.5rem"><input type="month" id="attMonth" value="${todayInput().slice(0, 7)}" style="width:auto">
      <button class="btn ghost" onclick="exportAttendance(${id})">⬇ Xuất Excel điểm danh</button></div>
      <div id="attList" style="margin-top:.7rem"></div>`;
    const ss = await api("GET", `/attendance/sessions?class_id=${id}`);
    $("#attList").innerHTML = ss.length ? `<div class="tbl-wrap"><table><tr><th>Ngày</th><th>Có mặt</th><th></th></tr>
      ${ss.map((s) => `<tr><td><a href="javascript:void(0)" onclick="viewSession(${s.id})">${fmtDate(s.session_date)}</a></td><td>${s.present_count}/${s.total_count}</td>
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
      <div class="tbl-wrap"><table><tr><th>Học viên</th><th>Gói</th><th>HP đến ngày</th><th>Trạng thái</th>${isAdmin() ? "<th></th>" : ""}</tr>
      ${ov.students.map((s) => `<tr><td><b>${esc(s.full_name)}</b></td>
      <td class="muted">${esc(s.package_name || "—")}<br>${isAdmin() ? fmtVND(s.package_fee || 0) : (s.package_sessions ? s.package_sessions + " buổi/tuần" : "—")}</td>
      <td>${fmtDate(s.paid_through)}</td><td>${feeBadge(s.fee_state)}</td>
      ${isAdmin() ? `<td>${["paid"].includes(s.fee_state) ? "" : `<button class="btn small" onclick="payFor(${s.id},${id})">Thu phí</button>`}</td>` : ""}</tr>`).join("")}</table></div>`;
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
    `<div id="delReqBox"></div>` +
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
  if (isAdmin()) loadDelRequests();
}
// Yêu cầu xóa HV đang chờ duyệt (admin)
window.loadDelRequests = async () => {
  try {
    const list = await api("GET", `/students/delete-requests?branch_id=${S.branchId}&status=pending`);
    if (!list.length) { $("#delReqBox").innerHTML = ""; return; }
    $("#delReqBox").innerHTML = `<div class="card" style="border-left:4px solid var(--warn)"><h3>⏳ Yêu cầu xóa học viên chờ duyệt (${list.length})</h3>
      ${list.map((d) => `<div class="att-row"><div class="nm"><b>${esc(d.student_name)}</b>
        <span class="muted">${esc(d.class_name || "")} · người gửi: ${esc(d.requester_name || d.requester_username)}</span><br>
        <span class="muted">Lý do: ${esc(d.reason)}</span></div>
        <div class="btnrow" style="margin:0;flex-wrap:nowrap">
        <button class="btn small ok" onclick="delReqReview(${d.id},true)">Xác nhận xóa</button>
        <button class="btn small danger" onclick="delReqReview(${d.id},false)">Từ chối</button></div></div>`).join("")}</div>`;
  } catch (e) { /* bỏ qua */ }
};
window.delReqReview = async (id, ok) => {
  let note = "";
  if (!ok) { const r = window.prompt("Lý do từ chối (không bắt buộc):"); if (r === null) return; note = r; }
  try {
    await api("PUT", `/students/delete-requests/${id}/${ok ? "approve" : "reject"}`, { review_note: note });
    toast(ok ? "Đã xóa học viên (chuyển vào HV cũ)" : "Đã từ chối");
    route();
  } catch (err) { toast(err.message); }
};
// Danh sách học viên cũ (đã từng tập và nghỉ)
async function vFormerStudents() {
  if (!isAdmin()) { location.hash = "#/dashboard"; return; }
  V.innerHTML = pageHead("Học viên cũ") + `<div id="fsBody"><p class="muted">Đang tải...</p></div>`;
  const list = await api("GET", `/students?branch_id=${S.branchId}&status=stopped`);
  $("#fsBody").innerHTML = list.length ? `<div class="card"><div class="tbl-wrap"><table>
    <tr><th>Họ tên</th><th>Lớp</th><th>SĐT</th><th>Ngày vào</th><th>Ngày nghỉ</th><th>Nguyên nhân nghỉ</th></tr>
    ${list.map((s) => `<tr><td><b>${esc(s.full_name)}</b></td><td>${esc(s.class_name || "—")}</td>
      <td class="muted">${esc(s.phone || "—")}</td><td>${fmtDate(s.joined_on)}</td><td>${fmtDate(s.stopped_at)}</td>
      <td class="muted">${esc(s.leave_reason || "—")}</td></tr>`).join("")}</table></div></div>`
    : `<div class="card"><p class="muted">Chưa có học viên cũ.</p></div>`;
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
    `<option value="${p.id}" ${s.package_id == p.id ? "selected" : ""}>${esc(p.name)}${isAdmin() ? ` (${fmtVND(p.monthly_fee)})` : (p.sessions_per_week ? ` (${p.sessions_per_week} buổi/tuần)` : "")}</option>`).join("");
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
    <div><label>Cấp đai hiện tại</label><input name="belt_level" value="${esc(s.belt_level || "")}" placeholder="VD: Đai xanh, Đai vàng..."></div>
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
      belt_level: fd.get("belt_level"),
    };
    try {
      if (id) await api("PUT", "/students/" + id, body); else await api("POST", "/students", body);
      closeModal(); toast("Đã lưu");
      if (location.hash.startsWith("#/students/") && id) vStudentDetail(id); else route();
    } catch (err) { toast(err.message); }
  };
};
window.studentDel = async (id) => {
  // HLV: gửi yêu cầu xóa kèm giải trình -> admin duyệt. Admin: xóa trực tiếp (chuyển vào HV cũ).
  openModal(`<h3>${isAdmin() ? "Xóa học viên" : "Yêu cầu xóa học viên"}</h3><form id="f">
    <label>Nguyên nhân ${isAdmin() ? "(lưu vào hồ sơ học viên cũ)" : "(gửi quản trị viên duyệt)"} *</label>
    <textarea name="reason" required placeholder="VD: Gia đình chuyển nhà, không sắp xếp được lịch học..."></textarea>
    ${isAdmin() ? "" : `<p class="muted">Học viên chỉ bị xóa khỏi danh sách khi quản trị viên ấn xác nhận, sau đó chuyển vào danh sách học viên cũ.</p>`}
    <div class="btnrow"><button class="btn danger">${isAdmin() ? "Xóa khỏi danh sách" : "Gửi yêu cầu"}</button>
    <button type="button" class="btn ghost" onclick="closeModal()">Hủy</button></div></form>`);
  $("#f").onsubmit = async (e) => {
    e.preventDefault(); const fd = new FormData(e.target);
    const reason = fd.get("reason");
    try {
      if (isAdmin()) {
        await api("DELETE", "/students/" + id, { reason });
        closeModal(); toast("Đã chuyển học viên vào danh sách cũ");
        location.hash = "#/students"; route();
      } else {
        await api("POST", "/students/delete-requests", { branch_id: S.branchId, student_id: id, reason });
        closeModal(); toast("Đã gửi yêu cầu xóa tới quản trị viên");
      }
    } catch (err) { toast(err.message); }
  };
};

let feeYearSel = null;
async function vStudentDetail(id, yr) {
  const s = await api("GET", "/students/" + id);
  const year = String(yr || feeYearSel || todayInput().slice(0, 4));
  feeYearSel = year;
  V.innerHTML = pageHead(s.full_name, `${!isStudent() ? `<button class="btn ghost" onclick="transferStudent(${s.id})">🔀 Chuyển lớp</button> ` : ""}<button class="btn ghost" onclick="studentForm(${s.id})">Sửa</button>`) +
    `<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(280px,1fr))">
    <div class="card"><h3>Thông tin</h3>
      <table>
      <tr><td class="muted">Lớp</td><td><b>${esc(s.class_name || "—")}</b></td></tr>
      <tr><td class="muted">Gói</td><td>${esc(s.package_name || "—")}${isAdmin() ? (s.package_fee ? " (" + fmtVND(s.package_fee) + ")" : "") : (s.package_sessions ? " (" + s.package_sessions + " buổi/tuần)" : "")}</td></tr>
      <tr><td class="muted">Cấp đai hiện tại</td><td><b>🥋 ${esc(s.belt_level || "—")}</b></td></tr>
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
      ${isAdmin() ? `<div class="btnrow"><button class="btn small" onclick="payFor(${s.id})">Thu học phí</button></div>` : ""}</div>
    </div>
    <div class="card"><h3>📅 Thu phí năm <input type="number" id="feeYear" value="${year}" min="2020" max="2100" style="width:5.5rem" onchange="vStudentDetail(${s.id}, this.value)">
      <span class="muted" style="font-weight:normal">✓ = đã đóng${isAdmin() ? " · bấm vào ô để đánh dấu" : ""}</span></h3>
      <div class="tbl-wrap"><table><tr>${Array.from({ length: 12 }, (_, i) => `<th style="text-align:center">T${i + 1}</th>`).join("")}</tr>
      <tr>${yearFeeCells(s, year).map((c, i) => {
        const inner = c.paid ? `<b style="color:var(--ok)">✓</b>` : `<span class="muted">—</span>`;
        return isAdmin()
          ? `<td style="text-align:center;cursor:pointer" title="Bấm để ${c.paid ? "bỏ đánh dấu" : "đánh dấu đã đóng"}${c.title ? " — " + esc(c.title) : ""}" onclick="toggleFeeMonth(${s.id},'${year}',${i + 1},${!c.paid})">${inner}</td>`
          : `<td style="text-align:center" title="${esc(c.title || "")}">${inner}</td>`;
      }).join("")}</tr>
      </table></div></div>
    ${isAdmin() ? `<div class="card"><h3>Lịch sử thu phí</h3>
      ${s.payments.length ? `<div class="tbl-wrap"><table><tr><th>Ngày</th><th>Nhóm</th><th>Số tiền</th><th>Đến ngày</th><th>Ghi chú</th><th></th></tr>
      ${s.payments.map((p) => `<tr><td>${fmtDate(p.paid_on)}</td><td>${CAT_LABEL[p.category] || p.category}</td>
      <td><b>${fmtVND(p.amount)}</b></td><td>${fmtDate(p.paid_through)}</td><td class="muted">${esc(p.note || "")}</td>
      <td><div class="btnrow" style="margin:0"><button class="btn small ghost" onclick="payEdit(${p.id},${s.id})">Sửa</button><button class="btn small danger" onclick="payDel(${p.id},${s.id})">Xóa</button></div></td></tr>`).join("")}</table></div>`
      : `<p class="muted">Chưa có khoản thu nào.</p>`}</div>` : ""}`;
}
// Chuyển lớp cho học viên (admin + HLV): chọn lớp đích ở bất kỳ chi nhánh nào
window.transferStudent = async (sid) => {
  const s = await api("GET", "/students/" + sid).catch(() => null);
  if (!s) { toast("Không tải được học viên"); return; }
  const cat = await api("GET", "/classes/catalog").catch(() => []);
  const targets = cat.filter((c) => c.status === "active" && c.id !== Number(s.class_id));
  if (!targets.length) { toast("Không có lớp đích nào khác đang hoạt động"); return; }
  const byBranch = {};
  targets.forEach((c) => { (byBranch[c.branch_name] = byBranch[c.branch_name] || []).push(c); });
  openModal(`<h3>🔀 Chuyển lớp</h3>
    <p>Chuyển học viên <b>${esc(s.full_name)}</b> từ lớp <b>${esc(s.class_name || "—")}</b> sang lớp khác. Học phí và lịch sử học tập được giữ nguyên.</p>
    <form id="f"><label>Lớp đích</label><select name="class_id" required>
    ${Object.keys(byBranch).map((b) => `<optgroup label="${esc(b)}">${byBranch[b].map((c) => `<option value="${c.id}">${esc(c.name)} — ${esc(c.schedule || "")}</option>`).join("")}</optgroup>`).join("")}
    </select>
    <div class="btnrow"><button class="btn">Chuyển lớp</button><button type="button" class="btn ghost" onclick="closeModal()">Hủy</button></div></form>`);
  $("#f").onsubmit = async (e) => {
    e.preventDefault(); const fd = new FormData(e.target);
    try {
      await api("POST", `/students/${sid}/transfer`, { class_id: fd.get("class_id") });
      closeModal(); toast("Đã chuyển lớp cho " + s.full_name);
      route();
    } catch (err) { toast(err.message); }
  };
};
// Admin bấm vào ô tháng trong bảng thu phí năm để đánh dấu đã đóng / bỏ đánh dấu
window.toggleFeeMonth = async (sid, year, month, paid) => {
  try {
    await api("POST", "/payments/fee-month", { student_id: sid, year: Number(year), month, paid });
    toast(paid ? `Đã đánh dấu đóng T${month}/${year}` : `Đã bỏ đánh dấu T${month}/${year}`);
    vStudentDetail(sid, year);
  } catch (err) { toast(err.message); }
};
// Sửa / xóa khoản thu trong Lịch sử thu phí (admin)
window.payDel = async (pid, sid) => {
  if (!await confirmDlg("Xóa khoản thu này? Học phí của học viên sẽ được tính lại.")) return;
  try { await api("DELETE", "/payments/" + pid); toast("Đã xóa"); vStudentDetail(sid); }
  catch (err) { toast(err.message); }
};
window.payEdit = async (pid, sid) => {
  const pays = await api("GET", `/payments?student_id=${sid}`).catch(() => []);
  const p = pays.find((x) => x.id === pid);
  if (!p) { toast("Không tìm thấy khoản thu"); return; }
  const d = (v) => v ? String(v).slice(0, 10) : "";
  openModal(`<h3>Sửa khoản thu</h3><form id="f">
    <label>Nhóm khoản thu</label><select name="category">
    ${Object.keys(CAT_LABEL).map((k) => `<option value="${k}" ${p.category === k ? "selected" : ""}>${CAT_LABEL[k]}</option>`).join("")}</select>
    <label>Số tiền (đ)</label><input name="amount" type="number" min="1" value="${p.amount}" required>
    <label>Ngày thu</label><input name="paid_on" type="date" value="${d(p.paid_on)}" required>
    <label>HP đóng đến ngày (nếu là học phí)</label><input name="paid_through" type="date" value="${d(p.paid_through)}">
    <label>Ghi chú</label><input name="note" value="${esc(p.note || "")}">
    <div class="btnrow"><button class="btn">Lưu</button><button type="button" class="btn ghost" onclick="closeModal()">Hủy</button></div></form>`);
  $("#f").onsubmit = async (e) => {
    e.preventDefault(); const fd = new FormData(e.target);
    try {
      await api("PUT", "/payments/" + pid, { category: fd.get("category"), amount: fd.get("amount"),
        paid_on: fd.get("paid_on"), paid_through: fd.get("paid_through") || null, note: fd.get("note") });
      closeModal(); toast("Đã lưu"); vStudentDetail(sid);
    } catch (err) { toast(err.message); }
  };
};
// Tính các tháng đã đóng trong năm từ lịch sử thu phí
function yearFeeCells(s, yr) {
  const cells = Array.from({ length: 12 }, () => ({ paid: false, title: "" }));
  for (const p of (s.payments || [])) {
    const from = String(p.paid_on || "").slice(0, 7);
    const to = String(p.paid_through || p.paid_on || "").slice(0, 7);
    if (!from) continue;
    let [y, m] = from.split("-").map(Number);
    const [y2, m2] = to.split("-").map(Number);
    let guard = 0;
    while ((y < y2 || (y === y2 && m <= m2)) && guard++ < 36) {
      if (String(y) === String(yr) && m >= 1 && m <= 12) {
        cells[m - 1].paid = true;
        const amt = p.amount ? fmtVND(p.amount) + " " : "";
        cells[m - 1].title = (cells[m - 1].title ? cells[m - 1].title + "; " : "") + amt + "(" + fmtDate(p.paid_on) + ")";
      }
      m++; if (m > 12) { m = 1; y++; }
    }
  }
  return cells;
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
// Xem chi tiết 1 buổi điểm danh (chỉ xem: ai đi học, ai vắng)
window.viewSession = async (sid) => {
  try {
    const s = await api("GET", "/attendance/sessions/" + sid);
    const nm = (r) => esc(r.full_name);
    const present = s.records.filter((r) => r.status === "present");
    const absent = s.records.filter((r) => r.status === "absent");
    const excused = s.records.filter((r) => r.status === "excused");
    openModal(`<h3>Điểm danh ${fmtDate(s.session_date)} — ${esc(s.class_name)}</h3>
      ${s.note ? `<p class="muted">Ghi chú: ${esc(s.note)}</p>` : ""}
      <p>✅ <b>Có mặt (${present.length}):</b><br>${present.map(nm).join(", ") || "—"}</p>
      <p>❌ <b>Vắng (${absent.length}):</b><br>${absent.map(nm).join(", ") || "—"}</p>
      <p>📝 <b>Có phép (${excused.length}):</b><br>${excused.map(nm).join(", ") || "—"}</p>
      <div class="btnrow"><button class="btn ghost" onclick="closeModal()">Đóng</button></div>`);
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
  const m = todayInput().slice(0, 7);
  V.innerHTML = pageHead("Nhật ký giảng dạy", `<button class="btn" onclick="logForm()">+ Ghi nhật ký</button>`) +
    `<div class="card"><div class="row"><select id="lClass" style="width:auto">
    ${S.classes.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join("")}</select>
    <input type="month" id="lMonth" value="${m}" style="width:auto">
    <button class="btn" onclick="loadLogs()">Xem</button></div><div id="logList" style="margin-top:.6rem"></div></div>`;
  loadLogs();
}
// Bảng nhật ký theo tháng: Ngày | Nội dung buổi học | Chi tiết | Ghi chú
window.loadLogs = async () => {
  const cid = $("#lClass").value;
  const m = $("#lMonth").value;
  if (!cid) { $("#logList").innerHTML = `<p class="muted">Chưa có lớp nào.</p>`; return; }
  const [logs, sessions] = await Promise.all([
    api("GET", `/teaching-logs?class_id=${cid}&from=${m}-01&to=${m}-31`),
    api("GET", `/attendance/sessions?class_id=${cid}`),
  ]);
  const logByDate = {};
  for (const l of logs) logByDate[String(l.log_date).slice(0, 10)] = l;
  const sessInMonth = sessions.filter((s) => String(s.session_date).slice(0, 7) === m);
  // hợp nhất các ngày có buổi điểm danh và các ngày đã ghi nhật ký
  const dates = [...new Set([...sessInMonth.map((s) => String(s.session_date).slice(0, 10)), ...Object.keys(logByDate)])].sort();
  $("#logList").innerHTML = dates.length ? `<div class="tbl-wrap"><table>
    <tr><th>Ngày</th><th>Nội dung buổi học</th><th>Chi tiết</th><th>Ghi chú</th><th></th></tr>
    ${dates.map((d) => { const l = logByDate[d]; return `<tr><td><b>${fmtDate(d)}</b></td>
      <td>${l ? esc(l.content) : `<span class="muted">—</span>`}</td>
      <td class="muted">${l && l.details ? esc(l.details) : "—"}</td>
      <td class="muted">${l && l.note ? esc(l.note) : "—"}</td>
      <td>${l
        ? `<div class="btnrow" style="margin:0;flex-wrap:nowrap"><button class="btn small ghost" onclick="logForm(${cid},${l.id})">Sửa</button><button class="btn small danger" onclick="logDel(${l.id})">Xóa</button></div>`
        : `<button class="btn small" onclick="logForm(${cid},null,'${d}')">Ghi</button>`}</td></tr>`; }).join("")}
    </table></div>` : `<p class="muted">Tháng này chưa có buổi học nào.</p>`;
};
window.logForm = async (presetClass, id, presetDate) => {
  let l = {};
  if (id) { const all = await api("GET", "/teaching-logs"); l = all.find((x) => x.id === id) || {}; }
  openModal(`<h3>${id ? "Sửa" : "Ghi"} nhật ký giảng dạy</h3><form id="f">
    <label>Lớp</label><select name="class_id">${S.classes.map((c) => `<option value="${c.id}" ${(l.class_id || presetClass) == c.id ? "selected" : ""}>${esc(c.name)}</option>`).join("")}</select>
    <label>Ngày</label><input name="log_date" type="date" value="${((l.log_date || presetDate) || todayInput()).slice(0, 10)}">
    <label>Nội dung buổi học</label><textarea name="content" required>${esc(l.content || "")}</textarea>
    <label>Chi tiết</label><textarea name="details">${esc(l.details || "")}</textarea>
    <label>Ghi chú</label><input name="note" maxlength="300" value="${esc(l.note || "")}">
    <div class="btnrow"><button class="btn">Lưu</button><button type="button" class="btn ghost" onclick="closeModal()">Hủy</button></div></form>`);
  $("#f").onsubmit = async (e) => {
    e.preventDefault(); const fd = new FormData(e.target);
    const body = { class_id: fd.get("class_id"), log_date: fd.get("log_date"), content: fd.get("content"),
      details: fd.get("details"), note: fd.get("note") };
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
  V.innerHTML = pageHead("Chấm công HLV", (isAdmin() ? `<button class="btn" onclick="tsForm()">+ Chấm công</button>` : "") +
    (isAdmin() ? `<button class="btn ghost" onclick="exportTimesheets()">⬇ Xuất Excel</button>` : "")) +
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

/* ----- tra cứu lớp/CLB (chỉ xem) ----- */
async function vDirectory() {
  V.innerHTML = pageHead("Tra cứu lớp & CLB") +
    `<div class="card"><div class="row"><select id="dBranch" style="width:auto">
      ${S.branches.map((b) => `<option value="${b.id}" ${b.id === S.branchId ? "selected" : ""}>${esc(b.name)}</option>`).join("")}</select>
      <button class="btn" onclick="loadDirectory()">Xem</button></div>
      <p class="muted">Xem thông tin các lớp và CLB khác (chế độ chỉ đọc). Danh sách học viên chỉ hiện họ tên và cấp đai.</p></div>
    <div id="dirBody"><p class="muted">Đang tải...</p></div>`;
  loadDirectory();
}
window.loadDirectory = async () => {
  const bid = $("#dBranch").value;
  try {
    const [classes, allStudents] = await Promise.all([
      api("GET", `/directory/classes?branch_id=${bid}`),
      api("GET", `/directory/branches/${bid}/students`),
    ]);
    const byClass = {};
    for (const s of allStudents) { (byClass[s.class_name || "—"] = byClass[s.class_name || "—"] || []).push(s); }
    $("#dirBody").innerHTML = `
    <div class="card"><h3>🏫 Các lớp (${classes.length})</h3>
      ${classes.length ? `<div class="tbl-wrap"><table><tr><th>Lớp</th><th>CLB</th><th>Lịch</th><th>HLV đứng lớp</th><th>HV</th><th></th></tr>
      ${classes.map((c) => `<tr><td><b>${esc(c.name)}</b>${c.status !== "active" ? ` <span class="muted">(tạm ngưng)</span>` : ""}</td>
        <td>${esc(c.branch_name)}</td><td class="muted">${esc(c.schedule || "—")}</td>
        <td>${c.coaches.map(esc).join(", ") || `<span class="muted">—</span>`}</td>
        <td>${c.active_students}</td>
        <td><button class="btn small ghost" id="dbtn-${c.id}" onclick="dirStudents(${c.id},'dbtn-${c.id}')">👥 DS học viên</button></td></tr>
        <tr id="drow-${c.id}" style="display:none"><td colspan="6"><div id="dlist-${c.id}"></div></td></tr>`).join("")}</table></div>`
      : `<p class="muted">Chưa có lớp nào.</p>`}</div>
    <div class="card"><h3>🧑‍🎓 Học viên toàn CLB (${allStudents.length})</h3>
      ${allStudents.length ? `<div class="tbl-wrap"><table><tr><th>Họ tên</th><th>Cấp đai</th><th>Lớp</th></tr>
      ${allStudents.map((s) => `<tr><td><b>${esc(s.full_name)}</b></td><td>🥋 ${esc(s.belt_level || "—")}</td><td class="muted">${esc(s.class_name || "—")}</td></tr>`).join("")}</table></div>`
      : `<p class="muted">Chưa có học viên.</p>`}</div>`;
  } catch (err) {
    $("#dirBody").innerHTML = `<div class="card"><p style="color:var(--bad)">${esc(err.message)}</p></div>`;
  }
};
window.dirStudents = async (cid, btnId) => {
  const row = $("#drow-" + cid), box = $("#dlist-" + cid), btn = $("#" + btnId);
  if (row.style.display !== "none") { row.style.display = "none"; btn.textContent = "👥 DS học viên"; return; }
  btn.textContent = "Đang tải...";
  try {
    const list = await api("GET", `/directory/classes/${cid}/students`);
    box.innerHTML = list.length ? `<div class="tbl-wrap"><table><tr><th>Họ tên</th><th>Cấp đai</th></tr>
      ${list.map((s) => `<tr><td>${esc(s.full_name)}</td><td>🥋 ${esc(s.belt_level || "—")}</td></tr>`).join("")}</table></div>`
      : `<p class="muted">Lớp chưa có học viên đang học.</p>`;
    row.style.display = ""; btn.textContent = "🔼 Thu gọn";
  } catch (err) { btn.textContent = "👥 DS học viên"; toast(err.message); }
};

/* ----- hồ sơ HLV (sửa thông tin -> gửi admin duyệt) ----- */
async function vProfile() {
  if (!isCoach()) { location.hash = "#/dashboard"; return; }
  V.innerHTML = `<p class="muted">Đang tải...</p>`;
  const me = await api("GET", "/profile/me");
  const pend = me.pending_request;
  V.innerHTML = pageHead("Hồ sơ của tôi") +
    `<div class="card"><h3>👤 ${esc(me.full_name || me.username)}</h3>
    <table>
    <tr><td class="muted">Tên đăng nhập</td><td><b>${esc(me.username)}</b></td></tr>
    <tr><td class="muted">Họ tên</td><td>${esc(me.full_name || "—")}</td></tr>
    <tr><td class="muted">Cấp đai</td><td>🥋 ${esc(me.belt_level || "—")}</td></tr>
    <tr><td class="muted">SĐT</td><td>${esc(me.phone || "—")}</td></tr>
    <tr><td class="muted">Vai trò</td><td>${roleLabel(me.role)}</td></tr>
    </table>
    <div class="btnrow"><button class="btn" onclick="profileForm()">✏️ Sửa thông tin</button>
    <button class="btn ghost" onclick="changePasswordForm()">🔑 Đổi mật khẩu</button></div></div>` +
    (pend ? `<div class="card"><h3>⏳ Đang chờ duyệt</h3>
    <p class="muted">Yêu cầu sửa hồ sơ bạn gửi lúc ${fmtDate((pend.created_at || "").slice(0, 10))} đang chờ quản trị viên duyệt.</p></div>` : "");
}
window.profileForm = async () => {
  const me = await api("GET", "/profile/me");
  openModal(`<h3>Sửa hồ sơ</h3><form id="f">
    <label>Họ tên</label><input name="full_name" value="${esc(me.full_name || "")}" required>
    <label>Cấp đai</label><input name="belt_level" value="${esc(me.belt_level || "")}" placeholder="VD: Hoàng đai">
    <label>SĐT</label><input name="phone" value="${esc(me.phone || "")}">
    <p class="muted">Thông tin mới sẽ được gửi cho quản trị viên duyệt trước khi áp dụng.</p>
    <div class="btnrow"><button class="btn">Gửi duyệt</button><button type="button" class="btn ghost" onclick="closeModal()">Hủy</button></div></form>`);
  $("#f").onsubmit = async (e) => {
    e.preventDefault(); const fd = new FormData(e.target);
    try {
      await api("POST", "/profile/request", { full_name: fd.get("full_name"), belt_level: fd.get("belt_level"), phone: fd.get("phone") });
      closeModal(); toast("Đã gửi, chờ quản trị viên duyệt"); vProfile();
    } catch (err) { toast(err.message); }
  };
};
// Đổi mật khẩu đăng nhập của chính mình (áp dụng ngay, không cần duyệt)
window.changePasswordForm = () => {
  openModal(`<h3>🔑 Đổi mật khẩu</h3><form id="f">
    <label>Mật khẩu hiện tại</label><input name="current_password" type="password" required autocomplete="current-password">
    <label>Mật khẩu mới (ít nhất 6 ký tự)</label><input name="new_password" type="password" required autocomplete="new-password">
    <label>Nhập lại mật khẩu mới</label><input name="confirm_password" type="password" required autocomplete="new-password">
    <div class="btnrow"><button class="btn">Đổi mật khẩu</button><button type="button" class="btn ghost" onclick="closeModal()">Hủy</button></div></form>`);
  $("#f").onsubmit = async (e) => {
    e.preventDefault(); const fd = new FormData(e.target);
    if (fd.get("new_password") !== fd.get("confirm_password")) { toast("Mật khẩu mới nhập lại không khớp"); return; }
    try {
      await api("POST", "/profile/change-password", { current_password: fd.get("current_password"), new_password: fd.get("new_password") });
      closeModal(); toast("Đã đổi mật khẩu — lần đăng nhập sau dùng mật khẩu mới nhé");
    } catch (err) { toast(err.message); }
  };
};

/* ----- lương HLV + sổ chi ----- */
const EXP_LABEL = { salary: "Lương HLV", performance: "Chi phí biểu diễn", other: "Chi khác" };
const PAY_TYPE_LABEL = { hourly: "Theo giờ", fixed: "Cố định tháng", revenue_share: "% doanh thu giảng dạy" };
let payrollMonth = null;
async function vPayroll() {
  if (!isAdmin()) { location.hash = "#/dashboard"; return; }
  const m = payrollMonth || todayInput().slice(0, 7);
  payrollMonth = m;
  const bName = (S.branches.find((b) => b.id === S.branchId) || {}).name || "";
  V.innerHTML = pageHead("Lương HLV") +
    `<div class="card"><div class="row"><label style="margin:0">Tháng</label>
     <input type="month" id="prMonth" value="${m}" style="width:auto">
     <button class="btn" onclick="payrollMonth=document.getElementById('prMonth').value;vPayroll()">Xem</button>
     <button class="btn ghost" onclick="exportFinance('${m}')">⬇ Báo cáo tài chính (Excel)</button>
     <span class="muted">Chi nhánh: <b>${esc(bName)}</b> (đổi chi nhánh ở thanh trên cùng)</span></div></div>
     <div id="prBody"><p class="muted">Đang tải...</p></div>`;
  const [pr, exps] = await Promise.all([
    api("GET", `/payroll?branch_id=${S.branchId}&month=${m}`),
    api("GET", `/expenses?branch_id=${S.branchId}&month=${m}`).catch(() => []),
  ]);
  const t = pr.totals;
  const allSettled = pr.rows.length > 0 && pr.rows.every((r) => !r.salary || r.settled);
  $("#prBody").innerHTML = `
   <div class="grid kpi">
     <div class="card"><div class="num">${fmtVND(t.total_salary)}</div><div class="lbl">Tổng lương HLV</div></div>
     <div class="card"><div class="num">${fmtVND(t.teaching_revenue)}</div><div class="lbl">Doanh thu giảng dạy (học phí lớp + dạy 1:1)</div></div>
     <div class="card"><div class="num" style="color:${t.over_warn ? "var(--bad)" : "var(--ok)"}">${t.ratio == null ? "—" : t.ratio + "%"}</div><div class="lbl">Tỷ trọng lương / doanh thu giảng dạy (ngưỡng ${t.warn_ratio}%)</div></div>
     <div class="card"><div class="num">${fmtVND(t.total_revenue)}</div><div class="lbl">Tổng doanh thu chi nhánh</div></div>
   </div>
   ${t.over_warn ? `<div class="card" style="border-left:4px solid var(--bad)"><b>⚠️ Tỷ trọng lương đang vượt ${t.warn_ratio}% doanh thu giảng dạy.</b></div>` : ""}
   <div class="card"><div class="row spread"><h3 style="margin:0">Bảng lương tháng ${m.slice(5)}/${m.slice(0, 4)}</h3>
     <button class="btn" onclick="settlePayroll('${m}')" ${allSettled ? "disabled" : ""}>✅ Chốt lương & ghi sổ chi</button></div>
   ${pr.rows.length ? `<div class="tbl-wrap"><table><tr><th>HLV</th><th>Kiểu trả</th><th style="text-align:right">Giờ dạy</th>
     <th style="text-align:right">Thu dạy 1:1</th><th style="text-align:right">Phân bổ học phí lớp</th>
     <th style="text-align:right">Lương</th><th>Trạng thái</th></tr>
   ${pr.rows.map((r) => `<tr><td><b>${esc(r.coach_name)}</b></td>
     <td class="muted">${PAY_TYPE_LABEL[r.pay_type] || r.pay_type}${r.note ? "<br>" + esc(r.note) : ""}</td>
     <td style="text-align:right">${r.hours}</td>
     <td style="text-align:right">${fmtVND(r.private_revenue)}</td>
     <td style="text-align:right">${fmtVND(r.tuition_share)}</td>
     <td style="text-align:right"><b>${r.salary == null ? "—" : fmtVND(r.salary)}</b></td>
     <td>${r.settled ? `<span class="badge b-paid">Đã chốt</span>` : `<span class="muted">Chưa chốt</span>`}</td></tr>`).join("")}
   </table></div>` : `<p class="muted">Chưa có HLV nào hoạt động ở chi nhánh này trong tháng.</p>`}
   <p class="muted">Kiểu trả lương + đơn giá đặt ở mục Tài khoản → sửa HLV. Giờ dạy lấy từ Chấm công (vào mục Chấm công để sửa từng buổi). Phân bổ học phí lớp: doanh thu học phí của lớp chia theo tỷ lệ giờ dạy của các HLV trong lớp đó.</p></div>
   <div class="card"><div class="row spread"><h3 style="margin:0">Sổ chi tháng này</h3>
     <button class="btn small" onclick="expenseForm()">+ Ghi khoản chi</button></div>
   ${exps.length ? `<div class="tbl-wrap"><table><tr><th>Ngày</th><th>Nhóm</th><th>Nội dung</th><th style="text-align:right">Số tiền</th><th></th></tr>
     ${exps.map((e) => `<tr><td>${fmtDate(e.paid_on)}</td><td class="muted">${EXP_LABEL[e.category] || e.category}</td>
     <td>${esc(e.note || "")}${e.coach_name ? ` — ${esc(e.coach_name)}` : ""}</td>
     <td style="text-align:right"><b>${fmtVND(e.amount)}</b></td>
     <td><button class="btn small danger" onclick="expenseDel(${e.id})">Xóa</button></td></tr>`).join("")}</table></div>`
     : `<p class="muted">Chưa có khoản chi nào trong tháng.</p>`}</div>`;
}
window.settlePayroll = async (m) => {
  if (!await confirmDlg(`Chốt lương tháng ${m.slice(5)}/${m.slice(0, 4)}? Khoản chi lương của từng HLV sẽ được ghi vào sổ chi của chi nhánh đang chọn.`)) return;
  try {
    const r = await api("POST", "/payroll/settle", { branch_id: S.branchId, month: m });
    toast(`Đã chốt lương: ghi ${r.created} khoản chi`);
    vPayroll();
  } catch (err) { toast(err.message); }
};
window.expenseForm = () => {
  openModal(`<h3>Ghi khoản chi</h3><form id="f">
    <label>Nhóm chi</label><select name="category">
      <option value="other">Chi khác</option><option value="performance">Chi phí biểu diễn</option><option value="salary">Lương HLV (ghi tay)</option></select>
    <label>Số tiền (đ)</label><input name="amount" type="number" min="1" required>
    <label>Ngày chi</label><input name="paid_on" type="date" value="${todayInput()}" required>
    <label>Nội dung</label><input name="note">
    <div class="btnrow"><button class="btn">Lưu</button><button type="button" class="btn ghost" onclick="closeModal()">Hủy</button></div></form>`);
  $("#f").onsubmit = async (e) => {
    e.preventDefault(); const fd = new FormData(e.target);
    try {
      await api("POST", "/expenses", { branch_id: S.branchId, category: fd.get("category"), amount: fd.get("amount"), paid_on: fd.get("paid_on"), note: fd.get("note") });
      closeModal(); toast("Đã ghi khoản chi"); vPayroll();
    } catch (err) { toast(err.message); }
  };
};
window.expenseDel = async (id) => {
  if (!await confirmDlg("Xóa khoản chi này?")) return;
  try { await api("DELETE", "/expenses/" + id); toast("Đã xóa"); vPayroll(); }
  catch (err) { toast(err.message); }
};

/* ----- hoạt động: cho thuê sân + dạy 1:1 ----- */
let actTab = "rent", actDate = null, actMonth = null, actCoaches = null;
let ACT_RENTALS = [], ACT_PRIVATES = [];
const fmtMin = (mins) => `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
async function vActivities() {
  if (!isAdmin()) { location.hash = "#/dashboard"; return; }
  if (!actCoaches) {
    const users = await api("GET", "/users").catch(() => []);
    actCoaches = users.filter((u) => u.role === "coach" && u.status === "active");
  }
  actDate = actDate || todayInput();
  actMonth = actMonth || todayInput().slice(0, 7);
  V.innerHTML = pageHead("Hoạt động") +
    `<div class="row" style="margin-bottom:.6rem">
       <button class="btn ${actTab === "rent" ? "" : "ghost"}" onclick="actTab='rent';vActivities()">🏟️ Cho thuê sân</button>
       <button class="btn ${actTab === "private" ? "" : "ghost"}" onclick="actTab='private';vActivities()">🥋 Dạy 1:1</button>
       <button class="btn ${actTab === "perf" ? "" : "ghost"}" onclick="actTab='perf';vActivities()">🎭 Biểu diễn</button>
     </div><div id="actBody"><p class="muted">Đang tải...</p></div>`;
  if (actTab === "rent") await actRentView();
  else if (actTab === "private") await actPrivateView();
  else await actPerfView();
}
async function actRentView() {
  const day = await api("GET", `/rentals/day?branch_id=${S.branchId}&date=${actDate}`);
  ACT_RENTALS = day.rentals;
  const busy = [
    ...day.busy_classes.map((c) => ({ t: `${fmtMin(c.start)}–${fmtMin(c.end)}`, label: `Lớp ${c.name}`, kind: "class" })),
    ...day.rentals.map((r) => ({ t: `${r.start_time}–${r.end_time}`, label: `Thuê: ${r.renter_name || "khách"}`, kind: "rent" })),
  ].sort((a, b) => a.t.localeCompare(b.t));
  $("#actBody").innerHTML = `
  <div class="card"><div class="row"><label style="margin:0">Ngày xem lịch</label>
    <input type="date" id="actDateInp" value="${actDate}" style="width:auto">
    <button class="btn" onclick="actDate=document.getElementById('actDateInp').value;actRentView()">Xem</button>
    <button class="btn" onclick="rentalForm()" style="margin-left:auto">+ Book lịch thuê</button></div>
    <h3 style="margin:.8rem 0 .3rem">Khung giờ đã bận ngày ${fmtDate(actDate)}</h3>
    ${busy.length ? busy.map((x) => `<div class="att-row"><div class="nm"><b>${esc(x.t)}</b> — ${esc(x.label)}</div><span class="muted">${x.kind === "class" ? "Giờ học cố định" : "Đã cho thuê"}</span></div>`).join("") : `<p class="muted">Chưa có lớp học hay lịch thuê nào — sân trống cả ngày.</p>`}
  </div>
  <div class="card"><h3>Lịch thuê trong ngày</h3>
  ${ACT_RENTALS.length ? `<div class="tbl-wrap"><table><tr><th>Giờ</th><th>Khách thuê</th><th>HLV phụ trách</th><th style="text-align:right">Giá/giờ</th><th style="text-align:right">Thành tiền</th><th></th></tr>
    ${ACT_RENTALS.map((r) => `<tr><td><b>${esc(r.start_time)}–${esc(r.end_time)}</b></td><td>${esc(r.renter_name || "—")}${r.renter_phone ? `<br><span class="muted">${esc(r.renter_phone)}</span>` : ""}</td>
    <td class="muted">${esc(r.coach_name || "—")}</td>
    <td style="text-align:right">${fmtVND(r.price_per_hour)}</td><td style="text-align:right"><b>${fmtVND(r.total_amount)}</b></td>
    <td><div class="btnrow" style="margin:0;flex-wrap:nowrap"><button class="btn small ghost" onclick="rentalForm(${r.id})">Sửa</button>
    <button class="btn small danger" onclick="rentalDel(${r.id})">Xóa</button></div></td></tr>`).join("")}</table></div>`
    : `<p class="muted">Chưa có lịch thuê nào trong ngày này.</p>`}
  <p class="muted">Khi lưu, hệ thống tự ghi khoản thu "Cho thuê" vào sổ và tự báo nếu trùng giờ học của lớp hoặc trùng lịch thuê khác.</p></div>`;
}
window.rentalForm = (id) => {
  const r = id ? (ACT_RENTALS.find((x) => x.id === id) || {}) : {};
  openModal(`<h3>${id ? "Sửa" : "Book"} lịch thuê sân</h3><form id="f">
    <label>Tên khách / đơn vị thuê</label><input name="renter_name" value="${esc(r.renter_name || "")}" required>
    <label>SĐT khách</label><input name="renter_phone" value="${esc(r.renter_phone || "")}">
    <label>Ngày thuê</label><input name="rent_date" type="date" value="${r.rent_date ? String(r.rent_date).slice(0, 10) : actDate}" required>
    <div class="row"><div style="flex:1"><label>Giờ bắt đầu</label><input name="start_time" type="time" value="${esc(r.start_time || "")}" required></div>
    <div style="flex:1"><label>Giờ kết thúc</label><input name="end_time" type="time" value="${esc(r.end_time || "")}" required></div></div>
    <label>Giá thuê (đ/giờ)</label><input name="price_per_hour" type="number" min="0" value="${r.price_per_hour != null ? r.price_per_hour : ""}" required>
    <label>HLV phụ trách (nếu có)</label><select name="coach_id"><option value="">— Không gắn —</option>
    ${(actCoaches || []).map((u) => `<option value="${u.id}" ${r.coach_id === u.id ? "selected" : ""}>${esc(u.full_name || u.username)}</option>`).join("")}</select>
    ${id ? `<label>Trạng thái</label><select name="status">
      <option value="booked" ${r.status === "booked" ? "selected" : ""}>Đã đặt</option>
      <option value="done" ${r.status === "done" ? "selected" : ""}>Đã xong</option>
      <option value="cancelled" ${r.status === "cancelled" ? "selected" : ""}>Đã hủy (gỡ khoản thu)</option></select>` : ""}
    <label>Ghi chú</label><input name="note" value="${esc(r.note || "")}">
    <div class="btnrow"><button class="btn">Lưu lịch thuê</button><button type="button" class="btn ghost" onclick="closeModal()">Hủy</button></div></form>`);
  $("#f").onsubmit = async (e) => {
    e.preventDefault(); const fd = new FormData(e.target);
    const body = { branch_id: S.branchId, renter_name: fd.get("renter_name"), renter_phone: fd.get("renter_phone"),
      rent_date: fd.get("rent_date"), start_time: fd.get("start_time"), end_time: fd.get("end_time"),
      price_per_hour: fd.get("price_per_hour"), coach_id: fd.get("coach_id") || null, note: fd.get("note") };
    if (id) body.status = fd.get("status");
    try {
      if (id) await api("PUT", "/rentals/" + id, body); else await api("POST", "/rentals", body);
      actDate = body.rent_date;
      closeModal(); toast("Đã lưu lịch thuê"); vActivities();
    } catch (err) { toast(err.message); }
  };
};
window.rentalDel = async (id) => {
  if (!await confirmDlg("Xóa lịch thuê này? Khoản thu liên kết cũng sẽ bị gỡ.")) return;
  try { await api("DELETE", "/rentals/" + id); toast("Đã xóa"); vActivities(); }
  catch (err) { toast(err.message); }
};
async function actPrivateView() {
  const list = await api("GET", `/private-sessions?branch_id=${S.branchId}&month=${actMonth}`);
  ACT_PRIVATES = list;
  const total = list.filter((s) => s.status !== "cancelled").reduce((sum, s) => sum + Number(s.fee || 0), 0);
  $("#actBody").innerHTML = `
  <div class="card"><div class="row"><label style="margin:0">Tháng</label>
    <input type="month" id="actMonthInp" value="${actMonth}" style="width:auto">
    <button class="btn" onclick="actMonth=document.getElementById('actMonthInp').value;actPrivateView()">Xem</button>
    <button class="btn" onclick="privateForm()" style="margin-left:auto">+ Thêm buổi 1:1</button></div>
    <p style="margin:.6rem 0 0">Tổng học phí 1:1 tháng này: <b>${fmtVND(total)}</b> · ${list.filter((s) => s.status !== "cancelled").length} buổi</p></div>
  <div class="card"><h3>Buổi dạy 1:1 trong tháng</h3>
  ${list.length ? `<div class="tbl-wrap"><table><tr><th>Ngày</th><th>Giờ</th><th>Học viên</th><th>HLV</th><th style="text-align:right">Học phí</th><th style="text-align:right">Giờ lương</th><th></th></tr>
    ${list.map((s) => `<tr${s.status === "cancelled" ? ` style="opacity:.55"` : ""}><td>${fmtDate(s.session_date)}</td><td><b>${esc(s.start_time)}–${esc(s.end_time)}</b></td>
    <td>${esc(s.student_name || "—")}${s.student_phone ? `<br><span class="muted">${esc(s.student_phone)}</span>` : ""}</td>
    <td class="muted">${esc(s.coach_name || "—")}</td>
    <td style="text-align:right"><b>${fmtVND(s.fee)}</b></td>
    <td style="text-align:right">${s.pay_hours != null ? s.pay_hours + "h" : "—"}</td>
    <td><div class="btnrow" style="margin:0;flex-wrap:nowrap"><button class="btn small ghost" onclick="privateForm(${s.id})">Sửa</button>
    <button class="btn small danger" onclick="privateDel(${s.id})">Xóa</button></div></td></tr>`).join("")}</table></div>`
    : `<p class="muted">Chưa có buổi 1:1 nào trong tháng này.</p>`}
  <p class="muted">Lưu buổi học sẽ tự ghi khoản thu "Dạy 1:1" cho HLV đó; nếu điền "Giờ tính lương" (theo thỏa thuận) thì hệ thống tự cộng giờ chấm công cho HLV. Trùng lịch của HLV sẽ bị báo ngay.</p></div>`;
}
window.privateForm = (id) => {
  const s = id ? (ACT_PRIVATES.find((x) => x.id === id) || {}) : {};
  openModal(`<h3>${id ? "Sửa" : "Thêm"} buổi dạy 1:1</h3><form id="f">
    <label>Huấn luyện viên</label><select name="coach_id" required>
    ${(actCoaches || []).map((u) => `<option value="${u.id}" ${s.coach_id === u.id ? "selected" : ""}>${esc(u.full_name || u.username)}</option>`).join("")}</select>
    <label>Tên học viên</label><input name="student_name" value="${esc(s.student_name || "")}" required>
    <label>SĐT học viên</label><input name="student_phone" value="${esc(s.student_phone || "")}">
    <label>Ngày dạy</label><input name="session_date" type="date" value="${s.session_date ? String(s.session_date).slice(0, 10) : todayInput()}" required>
    <div class="row"><div style="flex:1"><label>Giờ bắt đầu</label><input name="start_time" type="time" value="${esc(s.start_time || "")}" required></div>
    <div style="flex:1"><label>Giờ kết thúc</label><input name="end_time" type="time" value="${esc(s.end_time || "")}" required></div></div>
    <label>Học phí buổi này (đ)</label><input name="fee" type="number" min="0" value="${s.fee != null ? s.fee : ""}" required>
    <label>Giờ tính lương cho HLV (theo thỏa thuận — để trống nếu không tính giờ)</label><input name="pay_hours" type="number" min="0" step="0.5" value="${s.pay_hours != null ? s.pay_hours : ""}">
    ${id ? `<label>Trạng thái</label><select name="status">
      <option value="done" ${s.status === "done" ? "selected" : ""}>Đã dạy</option>
      <option value="cancelled" ${s.status === "cancelled" ? "selected" : ""}>Đã hủy (gỡ khoản thu + giờ lương)</option></select>` : ""}
    <label>Ghi chú</label><input name="note" value="${esc(s.note || "")}">
    <div class="btnrow"><button class="btn">Lưu buổi học</button><button type="button" class="btn ghost" onclick="closeModal()">Hủy</button></div></form>`);
  $("#f").onsubmit = async (e) => {
    e.preventDefault(); const fd = new FormData(e.target);
    const body = { branch_id: S.branchId, coach_id: fd.get("coach_id"), student_name: fd.get("student_name"),
      student_phone: fd.get("student_phone"), session_date: fd.get("session_date"),
      start_time: fd.get("start_time"), end_time: fd.get("end_time"), fee: fd.get("fee"),
      pay_hours: fd.get("pay_hours"), note: fd.get("note") };
    if (id) body.status = fd.get("status");
    try {
      if (id) await api("PUT", "/private-sessions/" + id, body); else await api("POST", "/private-sessions", body);
      actMonth = String(body.session_date).slice(0, 7);
      closeModal(); toast("Đã lưu buổi 1:1"); vActivities();
    } catch (err) { toast(err.message); }
  };
};
window.privateDel = async (id) => {
  if (!await confirmDlg("Xóa buổi 1:1 này? Khoản thu và giờ lương liên kết cũng sẽ bị gỡ.")) return;
  try { await api("DELETE", "/private-sessions/" + id); toast("Đã xóa"); vActivities(); }
  catch (err) { toast(err.message); }
};
let ACT_PERFS = [];
async function actPerfView() {
  const list = await api("GET", `/performances?branch_id=${S.branchId}&month=${actMonth}`);
  ACT_PERFS = list;
  const live = list.filter((p) => p.status !== "cancelled");
  const sumRev = live.reduce((s, p) => s + Number(p.revenue_fee || 0), 0);
  const sumProfit = live.reduce((s, p) => s + Number(p.profit || 0), 0);
  $("#actBody").innerHTML = `
  <div class="card"><div class="row"><label style="margin:0">Tháng</label>
    <input type="month" id="actMonthInp" value="${actMonth}" style="width:auto">
    <button class="btn" onclick="actMonth=document.getElementById('actMonthInp').value;actPerfView()">Xem</button>
    <button class="btn" onclick="perfForm()" style="margin-left:auto">+ Thêm sự kiện biểu diễn</button></div>
    <p style="margin:.6rem 0 0">Tổng thu biểu diễn tháng này: <b>${fmtVND(sumRev)}</b> · Lãi sau chi phí: <b style="color:${sumProfit >= 0 ? "var(--ok)" : "var(--bad)"}">${fmtVND(sumProfit)}</b> · ${live.length} sự kiện</p></div>
  <div class="card"><h3>Sự kiện biểu diễn trong tháng</h3>
  ${list.length ? `<div class="tbl-wrap"><table><tr><th>Ngày</th><th>Sự kiện</th><th>Nhân sự</th><th style="text-align:right">Thu</th><th style="text-align:right">Chi nhân sự</th><th style="text-align:right">Chi khác</th><th style="text-align:right">Lãi</th><th></th></tr>
    ${list.map((p) => `<tr${p.status === "cancelled" ? ` style="opacity:.55"` : ""}><td>${fmtDate(p.event_date)}</td>
    <td><b>${esc(p.event_name || "—")}</b>${p.partner ? `<br><span class="muted">${esc(p.partner)}</span>` : ""}</td>
    <td class="muted">${esc(p.personnel || "—")}</td>
    <td style="text-align:right">${fmtVND(p.revenue_fee)}</td>
    <td style="text-align:right">${fmtVND(p.personnel_cost)}</td>
    <td style="text-align:right">${fmtVND(p.other_cost)}</td>
    <td style="text-align:right"><b style="color:${p.profit >= 0 ? "var(--ok)" : "var(--bad)"}">${fmtVND(p.profit)}</b></td>
    <td><div class="btnrow" style="margin:0;flex-wrap:nowrap"><button class="btn small ghost" onclick="perfForm(${p.id})">Sửa</button>
    <button class="btn small danger" onclick="perfDel(${p.id})">Xóa</button></div></td></tr>`).join("")}</table></div>`
    : `<p class="muted">Chưa có sự kiện biểu diễn nào trong tháng này.</p>`}
  <p class="muted">Lưu sự kiện sẽ tự ghi khoản thu "Biểu diễn" và khoản chi (nhân sự + chi khác) vào sổ tài chính của chi nhánh.</p></div>`;
}
window.perfForm = (id) => {
  const p = id ? (ACT_PERFS.find((x) => x.id === id) || {}) : {};
  openModal(`<h3>${id ? "Sửa" : "Thêm"} sự kiện biểu diễn</h3><form id="f">
    <label>Tên sự kiện</label><input name="event_name" value="${esc(p.event_name || "")}" required>
    <label>Đơn vị tổ chức / đối tác</label><input name="partner" value="${esc(p.partner || "")}">
    <label>Ngày biểu diễn</label><input name="event_date" type="date" value="${p.event_date ? String(p.event_date).slice(0, 10) : todayInput()}" required>
    <label>Nhân sự tham gia (ghi tên, cách nhau dấu phẩy)</label><input name="personnel" value="${esc(p.personnel || "")}">
    <label>Phí thu từ đối tác (đ)</label><input name="revenue_fee" type="number" min="0" value="${p.revenue_fee != null ? p.revenue_fee : ""}">
    <label>Chi phí nhân sự (đ)</label><input name="personnel_cost" type="number" min="0" value="${p.personnel_cost != null ? p.personnel_cost : ""}">
    <label>Chi phí khác (đ) — đi lại, trang phục...</label><input name="other_cost" type="number" min="0" value="${p.other_cost != null ? p.other_cost : ""}">
    ${id ? `<label>Trạng thái</label><select name="status">
      <option value="done" ${p.status === "done" ? "selected" : ""}>Đã diễn</option>
      <option value="cancelled" ${p.status === "cancelled" ? "selected" : ""}>Đã hủy (gỡ cả thu và chi)</option></select>` : ""}
    <label>Ghi chú</label><input name="note" value="${esc(p.note || "")}">
    <div class="btnrow"><button class="btn">Lưu sự kiện</button><button type="button" class="btn ghost" onclick="closeModal()">Hủy</button></div></form>`);
  $("#f").onsubmit = async (e) => {
    e.preventDefault(); const fd = new FormData(e.target);
    const body = { branch_id: S.branchId, event_name: fd.get("event_name"), partner: fd.get("partner"),
      event_date: fd.get("event_date"), personnel: fd.get("personnel"), revenue_fee: fd.get("revenue_fee"),
      personnel_cost: fd.get("personnel_cost"), other_cost: fd.get("other_cost"), note: fd.get("note") };
    if (id) body.status = fd.get("status");
    try {
      if (id) await api("PUT", "/performances/" + id, body); else await api("POST", "/performances", body);
      actMonth = String(body.event_date).slice(0, 7);
      closeModal(); toast("Đã lưu sự kiện"); vActivities();
    } catch (err) { toast(err.message); }
  };
};
window.perfDel = async (id) => {
  if (!await confirmDlg("Xóa sự kiện này? Khoản thu và khoản chi liên kết cũng sẽ bị gỡ.")) return;
  try { await api("DELETE", "/performances/" + id); toast("Đã xóa"); vActivities(); }
  catch (err) { toast(err.message); }
};

/* ----- lớp học (học viên xem tất cả lớp, chia theo chi nhánh) ----- */
async function vStudentClasses() {
  V.innerHTML = `<p class="muted">Đang tải...</p>`;
  const list = await api("GET", "/classes/catalog");
  const me = await api("GET", "/students/me").catch(() => null);
  const card = (c) => `<div class="card"><h3>${esc(c.name)}${me && Number(me.class_id) === c.id ? ` <span class="badge b-paid">Lớp của bạn</span>` : ""}</h3>
      <div class="muted">${esc(c.schedule || "—")}${c.room ? " · " + esc(c.room) : ""}</div>
      <div class="row spread" style="margin-top:.5rem"><span>${c.active_students} HV đang học</span>
      ${c.status !== "active" ? `<span class="muted">(tạm ngưng)</span>` : ""}</div>
      ${c.coaches.length ? `<div class="muted">HLV: ${c.coaches.map((h) => `${esc(h.name)}${h.belt_level ? ` — 🥋 ${esc(h.belt_level)}` : ""}`).join("; ")}</div>` : ""}</div>`;
  const sections = S.branches.map((b) => {
    const cls = list.filter((c) => c.branch_id === b.id);
    if (!cls.length) return "";
    return `<div class="row spread" style="margin:1.1rem 0 .2rem"><h3 style="margin:0">🏢 ${esc(b.name)}</h3></div>
      ${b.address ? `<p class="muted" style="margin:.1rem 0 .4rem">${esc(b.address)}</p>` : ""}
      <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(260px,1fr))">${cls.map(card).join("")}</div>`;
  }).join("");
  V.innerHTML = pageHead("Lớp học") +
    `<p class="muted">Tất cả các lớp trên hệ thống (${list.length} lớp).</p>` +
    (sections || `<p class="muted">Chưa có lớp nào.</p>`);
}

/* ----- fees ----- */
async function vFees() {
  V.innerHTML = pageHead("Thu phí", isAdmin() ? `<button class="btn" onclick="payFor()">+ Ghi nhận thu</button>` : "") + `<div id="feeBody"><p class="muted">Đang tải...</p></div>`;
  const m = todayInput().slice(0, 7);
  // Tổng quan doanh thu chỉ dành cho admin (HLV không xem được)
  let revHtml = "";
  if (isAdmin()) {
    const sum = await api("GET", `/payments/revenue/summary?branch_id=${S.branchId}&from=${m}-01&to=${m}-31`);
    const exp = await api("GET", `/expenses/summary?branch_id=${S.branchId}&month=${m}`).catch(() => ({ grandTotal: 0 }));
    const bc = sum.byCategory;
    const teaching = (bc.tuition.total || 0) + (bc.private.total || 0);
    const nonTeaching = (bc.rental.total || 0) + (bc.performance.total || 0) + (bc.other.total || 0);
    revHtml = `<div class="card"><h3>💰 Tổng quan tháng ${m.slice(5)}/${m.slice(0, 4)}: ${fmtVND(sum.grandTotal)}</h3>
      <div class="tbl-wrap"><table><tr><th>Nhóm</th><th style="text-align:right">Số khoản</th><th style="text-align:right">Tổng</th></tr>
      ${Object.keys(CAT_LABEL).map((k) => `<tr><td>${CAT_LABEL[k]}</td><td style="text-align:right">${sum.byCategory[k].count}</td>
      <td style="text-align:right"><b>${fmtVND(sum.byCategory[k].total)}</b></td></tr>`).join("")}</table></div>
      <p style="margin:.6rem 0 0">🎓 <b>Hoạt động giảng dạy</b> (học phí lớp + dạy 1:1): <b>${fmtVND(teaching)}</b><br>
      🏟️ <b>Hoạt động khác</b> (cho thuê + biểu diễn + khác): <b>${fmtVND(nonTeaching)}</b><br>
      💸 <b>Tổng chi tháng</b> (xem ở Lương HLV / sổ chi): <b>${fmtVND(exp.grandTotal)}</b><br>
      ⚖️ <b>Chênh lệch thu − chi</b>: <b style="color:${sum.grandTotal - exp.grandTotal >= 0 ? "var(--ok)" : "var(--bad)"}">${fmtVND(sum.grandTotal - exp.grandTotal)}</b></p></div>`;
  }
  $("#feeBody").innerHTML = revHtml + `
  <div class="card"><h3>Theo lớp</h3>
    ${S.classes.map((c) => `<div class="att-row"><div class="nm"><b>${esc(c.name)}</b><br><span class="muted">${c.active_students} HV</span></div>
    <button class="btn small" onclick="location.hash='#/classes/${c.id}/fees'">Xem thu phí</button></div>`).join("")}</div>
  <div class="card"><h3>Khoản thu gần đây</h3><div id="payList"></div></div>`;
  const pays = await api("GET", `/payments?branch_id=${S.branchId}`);
  $("#payList").innerHTML = pays.length ? `<div class="tbl-wrap"><table><tr><th>Ngày</th><th>Học viên / Nội dung</th><th>Nhóm</th>${isAdmin() ? `<th style="text-align:right">Số tiền</th>` : ""}</tr>
    ${pays.slice(0, 30).map((p) => `<tr><td>${fmtDate(p.paid_on)}</td><td>${esc(p.student_name || p.note || "—")}</td>
    <td class="muted">${CAT_LABEL[p.category] || p.category}</td>${isAdmin() ? `<td style="text-align:right"><b>${fmtVND(p.amount)}</b></td>` : ""}</tr>`).join("")}</table></div>`
    : `<p class="muted">Chưa có khoản thu nào.</p>`;
}
window.payFor = async (studentId, classId) => {
  let s = null;
  if (studentId) s = await api("GET", "/students/" + studentId).catch(() => null);
  const pkgFee = s && s.package_fee ? s.package_fee : "";
  const allUsers = await api("GET", "/users").catch(() => []);
  const coaches = allUsers.filter((u) => u.role === "coach" && u.status === "active");
  openModal(`<h3>Ghi nhận thu phí${s ? " — " + esc(s.full_name) : ""}</h3><form id="f">
    <label>Nhóm khoản thu</label><select name="category">
    ${Object.keys(CAT_LABEL).map((k) => `<option value="${k}">${CAT_LABEL[k]}</option>`).join("")}</select>
    <label>HLV phụ trách (chọn khi là buổi dạy 1:1 — để tính % doanh thu cho HLV)</label>
    <select name="coach_id"><option value="">— Không gắn HLV —</option>
    ${coaches.map((u) => `<option value="${u.id}">${esc(u.full_name || u.username)}</option>`).join("")}</select>
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
        paid_through: fd.get("paid_through") || null, note: fd.get("note"),
        coach_id: fd.get("coach_id") || null });
      closeModal(); toast("Đã ghi nhận"); route();
    } catch (err) { toast(err.message); }
  };
};

/* ----- users (admin) ----- */
async function vUsers() {
  if (!isAdmin()) { location.hash = "#/dashboard"; return; }
  const users = await api("GET", "/users");
  const reqs = await api("GET", "/profile/requests").catch(() => []);
  const FIELD_LABEL = { full_name: "Họ tên", belt_level: "Cấp đai", phone: "SĐT" };
  const reqCard = reqs.length ? `<div class="card"><h3>📝 Yêu cầu sửa hồ sơ chờ duyệt (${reqs.length})</h3>
    ${reqs.map((r) => `<div class="att-row"><div class="nm"><b>${esc(r.username)}</b> <span class="muted">(${esc(r.current_name || "")})</span><br>
    ${Object.keys(r.changes || {}).map((k) => `<span class="muted">${FIELD_LABEL[k] || k}:</span> ${esc(r["current_" + (k === "full_name" ? "name" : k === "belt_level" ? "belt" : k)] || "—")} → <b>${esc(r.changes[k] || "—")}</b>`).join("<br>")}</div>
    <div class="btnrow" style="margin:0"><button class="btn small ok" onclick="profileReqReview(${r.id},true)">Duyệt</button>
    <button class="btn small danger" onclick="profileReqReview(${r.id},false)">Từ chối</button></div></div>`).join("")}</div>` : "";
  V.innerHTML = pageHead("Tài khoản", `<button class="btn" onclick="userForm()">+ Thêm</button>`) + reqCard +
    `<div class="card"><div class="tbl-wrap"><table><tr><th>Tên đăng nhập</th><th>Họ tên</th><th>Cấp đai</th><th>Vai trò</th><th>Lớp phụ trách</th><th>TT</th><th></th></tr>
    ${users.map((u) => `<tr><td><b>${esc(u.username)}</b></td><td>${esc(u.full_name || "—")}${u.role === "student" && u.student_name ? `<br><span class="muted">HV: ${esc(u.student_name)}</span>` : ""}</td>
      <td>${u.role === "coach" ? `🥋 ${esc(u.belt_level || "—")}` : `<span class="muted">—</span>`}</td>
      <td>${roleLabel(u.role)}</td>
      <td class="muted">${classIdsOf(u).map((cid) => esc(className(cid))).join(", ") || "—"}</td>
      <td>${u.status === "active" ? `<span class="badge b-active">Mở</span>` : `<span class="badge b-inactive">Khóa</span>`}</td>
      <td><button class="btn small ghost" onclick="userForm(${u.id})">Sửa</button></td></tr>`).join("")}</table></div>
      <p class="muted">Gán lớp cho HLV: vào Lớp học → mở lớp → tab HLV.</p></div>`;
}
window.profileReqReview = async (id, approve) => {
  try {
    if (approve) {
      if (!await confirmDlg("Duyệt và áp dụng thay đổi hồ sơ này?")) return;
      await api("PUT", `/profile/requests/${id}/approve`);
      toast("Đã duyệt hồ sơ");
    } else {
      const note = window.prompt("Lý do từ chối (không bắt buộc):") || "";
      if (note === null) return;
      await api("PUT", `/profile/requests/${id}/reject`, { note });
      toast("Đã từ chối");
    }
    vUsers();
  } catch (err) { toast(err.message); }
};
// Hiện ô nhập theo kiểu trả lương ở form Tài khoản
window.payTypeToggle = () => {
  const sel = document.getElementById("uPayType");
  if (!sel) return;
  const v = sel.value;
  document.getElementById("payHourly").style.display = v === "hourly" ? "" : "none";
  document.getElementById("payFixed").style.display = v === "fixed" ? "" : "none";
  document.getElementById("payShare").style.display = v === "revenue_share" ? "" : "none";
};
window.userForm = async (id) => {
  const users = await api("GET", "/users");
  const u = id ? users.find((x) => x.id === id) : {};
  const students = await api("GET", `/students?branch_id=${S.branchId}&status=active`).catch(() => []);
  // HLV trực thuộc chi nhánh nào + phụ trách lớp nào: chọn chi nhánh trước, rồi tick lớp trong chi nhánh
  const catalog = await api("GET", "/classes/catalog").catch(() => []);
  const branchBlocks = S.branches.map((b) => {
    const cls = catalog.filter((c) => c.branch_id === b.id && c.status === "active");
    return `<div class="branch-block" style="border:1px solid var(--line,#ddd);border-radius:.5rem;padding:.45rem .6rem;margin:.45rem 0">
      <label style="display:flex;gap:.45rem;align-items:center;font-size:.95rem;color:var(--ink)"><input type="checkbox" name="branch_id" value="${b.id}" style="width:auto" ${branchIdsOf(u).includes(b.id) ? "checked" : ""} onchange="toggleBranchClasses(this)"> <b>🏢 ${esc(b.name)}</b></label>
      ${cls.length ? cls.map((c) => `<label style="display:flex;gap:.45rem;align-items:center;margin:.3rem 0 .3rem 1.4rem;font-size:.95rem;color:var(--ink)"><input type="checkbox" name="class_id" value="${c.id}" style="width:auto" ${classIdsOf(u).includes(c.id) ? "checked" : ""}> ${esc(c.name)} <span class="muted">${esc(c.schedule || "")}</span></label>`).join("")
        : `<p class="muted" style="margin:.25rem 0 .25rem 1.4rem">Chưa có lớp — tạo lớp sau rồi quay lại gán cho HLV.</p>`}
    </div>`;
  }).join("");
  openModal(`<h3>${id ? "Sửa" : "Thêm"} tài khoản</h3><form id="f">
    <label>Tên đăng nhập</label><input name="username" value="${esc(u.username || "")}" ${id ? "disabled" : "required"}>
    <label>Họ tên</label><input name="full_name" value="${esc(u.full_name || "")}">
    <div class="grid" style="grid-template-columns:1fr 1fr;gap:.4rem .6rem">
    <div><label>Cấp đai (HLV)</label><input name="belt_level" value="${esc(u.belt_level || "")}" placeholder="VD: Hoàng đai"></div>
    <div><label>SĐT</label><input name="phone" value="${esc(u.phone || "")}"></div></div>
    <label>Mật khẩu ${id ? "(để trống nếu không đổi)" : ""}</label><input name="password" type="password" ${id ? "" : "required"}>
    <label>Vai trò</label><select name="role" id="uRole" onchange="document.getElementById('uStudentWrap').style.display=this.value==='student'?'':'none';document.getElementById('uPayWrap').style.display=this.value==='coach'?'':'none'">
      <option value="coach" ${u.role === "coach" ? "selected" : ""}>Huấn luyện viên</option>
      <option value="admin" ${u.role === "admin" ? "selected" : ""}>Quản trị viên</option>
      <option value="student" ${u.role === "student" ? "selected" : ""}>Học viên</option></select>
    <div id="uPayWrap" style="display:${u.role === "student" || u.role === "admin" ? "none" : ""}">
      <label>Kiểu trả lương (HLV)</label><select name="pay_type" id="uPayType" onchange="payTypeToggle()">
        <option value="hourly" ${u.pay_type !== "fixed" && u.pay_type !== "revenue_share" ? "selected" : ""}>Theo giờ dạy</option>
        <option value="fixed" ${u.pay_type === "fixed" ? "selected" : ""}>Cố định theo tháng</option>
        <option value="revenue_share" ${u.pay_type === "revenue_share" ? "selected" : ""}>% doanh thu giảng dạy</option></select>
      <div id="payHourly"><label>Đơn giá (đ/giờ) — để trống nếu chưa thỏa thuận</label><input name="hourly_rate" type="number" min="0" value="${u.hourly_rate != null ? u.hourly_rate : ""}"></div>
      <div id="payFixed"><label>Lương cố định (đ/tháng)</label><input name="fixed_salary" type="number" min="0" value="${u.fixed_salary != null ? u.fixed_salary : ""}"></div>
      <div id="payShare"><label>% doanh thu giảng dạy — để trống = mặc định 40%</label><input name="revenue_share_pct" type="number" min="0" max="100" step="0.5" value="${u.revenue_share_pct != null ? u.revenue_share_pct : ""}"></div>
    </div>
    <div id="uStudentWrap" style="display:${u.role === "student" ? "" : "none"}">
      <label>Gắn với học viên</label><select name="student_id">
      ${students.map((s) => `<option value="${s.id}" ${u.student_id == s.id ? "selected" : ""}>${esc(s.full_name)}${s.class_name ? " — " + esc(s.class_name) : ""}</option>`).join("")}
      </select></div>
    <label>Chi nhánh & lớp phụ trách (chỉ áp dụng cho HLV — tick chi nhánh để chọn nhanh tất cả lớp trong chi nhánh)</label>
    <div>${branchBlocks || `<p class="muted">Chưa có chi nhánh nào.</p>`}</div>
    <label>Trạng thái</label><select name="status"><option value="active" ${u.status !== "inactive" ? "selected" : ""}>Đang mở</option>
      <option value="inactive" ${u.status === "inactive" ? "selected" : ""}>Khóa</option></select>
    <div class="btnrow"><button class="btn">Lưu</button><button type="button" class="btn ghost" onclick="closeModal()">Hủy</button>
    ${id ? `<button type="button" class="btn danger" onclick="userDel(${id})">Xóa</button>` : ""}</div></form>`);
  payTypeToggle();
  $("#f").onsubmit = async (e) => {
    e.preventDefault(); const fd = new FormData(e.target);
    const body = { full_name: fd.get("full_name"), role: fd.get("role"), status: fd.get("status"),
      belt_level: fd.get("belt_level"), phone: fd.get("phone") };
    if (fd.get("role") === "coach") {
      body.pay_type = fd.get("pay_type");
      body.hourly_rate = fd.get("hourly_rate");
      body.fixed_salary = fd.get("fixed_salary");
      body.revenue_share_pct = fd.get("revenue_share_pct");
    }
    if (fd.get("role") === "student" && fd.get("student_id")) body.student_id = fd.get("student_id");
    if (fd.get("password")) body.password = fd.get("password");
    if (!id) body.username = fd.get("username");
    try {
      let uid = id;
      if (id) await api("PUT", "/users/" + id, body);
      else { const created = await api("POST", "/users", body); uid = created.id; }
      // Lưu chi nhánh + lớp phụ trách cho HLV
      if (uid && body.role === "coach") {
        const checked = $$("#f input[name=class_id]:checked").map((x) => Number(x.value));
        const bChecked = $$("#f input[name=branch_id]:checked").map((x) => Number(x.value));
        // Chi nhánh có lớp được tick cũng tính là chi nhánh HLV trực thuộc
        const fromClasses = checked.map((cid) => { const c = catalog.find((x) => x.id === cid); return c ? c.branch_id : null; }).filter(Boolean);
        const branchIds = [...new Set([...bChecked, ...fromClasses])];
        await api("PUT", `/users/${uid}/classes`, { classIds: checked, branchIds });
      }
      // Lưu liên kết học viên cho tài khoản HV
      if (uid && body.role === "student") {
        await api("PUT", `/users/${uid}`, { student_id: fd.get("student_id") || null });
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
    // Học viên chỉ được vào Tổng quan + Lớp học + Chương trình học
    if (isStudent() && !["dashboard", "", "curriculum", "classes", "login"].includes(seg[0])) {
      location.hash = "#/dashboard"; return;
    }
    if (seg[0] === "login") vLogin();
    else if (seg[0] === "dashboard" || seg[0] === "") await vDashboard();
    else if (seg[0] === "curriculum") await vCurriculum();
    else if (seg[0] === "profile") await vProfile();
    else if (seg[0] === "former-students") await vFormerStudents();
    else if (seg[0] === "branches") await vBranches();
    else if (seg[0] === "classes" && seg[1]) {
      if (isStudent()) { location.hash = "#/classes"; return; }
      await vClassDetail(seg[1], seg[2]);
    }
    else if (seg[0] === "classes") await (isStudent() ? vStudentClasses() : vClasses());
    else if (seg[0] === "students" && seg[1]) await vStudentDetail(seg[1]);
    else if (seg[0] === "students") await vStudents();
    else if (seg[0] === "packages") await vPackages();
    else if (seg[0] === "attendance") await vAttendance();
    else if (seg[0] === "teaching-logs") await vTeachingLogs();
    else if (seg[0] === "timesheets") await vTimesheets();
    else if (seg[0] === "shift-swaps") await vShiftSwaps();
    else if (seg[0] === "directory") await vDirectory();
    else if (seg[0] === "fees") await vFees();
    else if (seg[0] === "payroll") await vPayroll();
    else if (seg[0] === "activities") await vActivities();
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
watchIdle(); // theo dõi hoạt động để tự đăng xuất khi không dùng
route();
