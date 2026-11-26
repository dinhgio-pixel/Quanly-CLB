"use strict";
// Auth: JWT + bcrypt. Role: admin (toàn quyền) / coach (chỉ lớp được gán).
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const db = require("./db");

const JWT_EXPIRES = "3d";

function getSecret() {
  const s = process.env.JWT_SECRET;
  if (!s) throw new Error("Thiếu biến môi trường JWT_SECRET");
  return s;
}

function signToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username, role: user.role },
    getSecret(),
    { expiresIn: JWT_EXPIRES }
  );
}

async function verifyCredentials(username, password) {
  const { rows } = await db.query(
    "SELECT id, username, password_hash, role, full_name, status FROM users WHERE username = $1",
    [username]
  );
  const u = rows[0];
  if (!u || u.status !== "active") return null;
  const ok = await bcrypt.compare(password, u.password_hash);
  if (!ok) return null;
  return { id: u.id, username: u.username, role: u.role, full_name: u.full_name };
}

// Middleware: yêu cầu đăng nhập
async function requireAuth(req, res, next) {
  try {
    const h = req.headers.authorization || "";
    const token = h.startsWith("Bearer ") ? h.slice(7) : null;
    if (!token) return res.status(401).json({ error: "Chưa đăng nhập" });
    const payload = jwt.verify(token, getSecret());
    const { rows } = await db.query(
      "SELECT id, username, role, full_name, status, student_id FROM users WHERE id = $1",
      [payload.id]
    );
    const u = rows[0];
    if (!u || u.status !== "active") {
      return res.status(401).json({ error: "Tài khoản không còn hiệu lực" });
    }
    req.user = u;
    next();
  } catch (e) {
    return res.status(401).json({ error: "Phiên đăng nhập hết hạn" });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: "Không có quyền thực hiện" });
    }
    next();
  };
}

// Quản Lý (manager): được xem mọi mục như admin nhưng chỉ xem — chặn mọi thao tác ghi.
// Dùng cho các router vốn chỉ dành cho admin (lương, hoạt động, sổ chi, nhật ký...).
function readOnlyForManager(req, res, next) {
  if (req.user && req.user.role === "manager" && req.method !== "GET") {
    return res.status(403).json({ error: "Tài khoản Quản Lý chỉ được xem mục này, không có quyền sửa" });
  }
  next();
}

// Chốt chặn ghi toàn cục cho manager: ngoài các khu vực được phép ghi
// (thêm lớp học, học viên, thu phí, lịch thuê sân/1:1/biểu diễn, điểm danh, tự đổi mật khẩu)
// thì mọi POST/PUT/DELETE đều bị chặn, kể cả ở các route vốn dựa vào quyền theo lớp
// (nhật ký dạy, đổi ca, chấm công...).
const MANAGER_WRITE_WHITELIST = [
  (method, p) => method === "POST" && (p === "/api/classes" || p === "/api/classes/"),
  (method, p) => p.startsWith("/api/students"),
  (method, p) => p.startsWith("/api/payments"),
  (method, p) => p.startsWith("/api/rentals"),
  (method, p) => p.startsWith("/api/private-sessions"),
  (method, p) => p.startsWith("/api/performances"),
  (method, p) => p.startsWith("/api/attendance"),
  (method, p) => method === "POST" && p === "/api/profile/change-password",
];
function managerWriteGuard(req, res, next) {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return next();
  const h = req.headers.authorization || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : null;
  if (!token) return next();
  let payload = null;
  try { payload = jwt.verify(token, getSecret()); } catch (e) { return next(); }
  if (!payload || payload.role !== "manager") return next();
  if (MANAGER_WRITE_WHITELIST.some((f) => f(req.method, req.path))) return next();
  return res.status(403).json({ error: "Tài khoản Quản Lý không có quyền sửa mục này" });
}

// Lấy danh sách class_id mà HLV được phép quản lý (admin: null = tất cả)
async function getCoachClassIds(userId) {
  const { rows } = await db.query(
    "SELECT class_id FROM coach_classes WHERE user_id = $1",
    [userId]
  );
  return rows.map((r) => r.class_id);
}

module.exports = {
  signToken,
  verifyCredentials,
  requireAuth,
  requireRole,
  readOnlyForManager,
  managerWriteGuard,
  getCoachClassIds,
};
