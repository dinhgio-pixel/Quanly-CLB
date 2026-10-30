"use strict";
// Chống dò mật khẩu (brute force): đếm lần đăng nhập sai trong cửa sổ 15 phút.
// - Theo tài khoản: sai 5 lần -> khóa 15 phút.
// - Theo IP: sai 30 lần -> khóa 15 phút (nới hơn vì nhiều người có thể chung 1 mạng wifi).
// Trạng thái lưu trong DB (bảng login_guards) nên không mất khi server khởi động lại.
const db = require("../db");

const WINDOW_MS = 15 * 60 * 1000;
const LOCK_MS = 15 * 60 * 1000;
const USER_THRESHOLD = 5;
const IP_THRESHOLD = 30;

function keysFor(req, username) {
  const ip = (req && req.ip) || "";
  return [
    { key: `u:${String(username || "").toLowerCase()}`, threshold: USER_THRESHOLD },
    ...(ip ? [{ key: `ip:${ip}`, threshold: IP_THRESHOLD }] : []),
  ];
}

async function getRow(key) {
  const { rows } = await db.query("SELECT * FROM login_guards WHERE guard_key = $1", [key]);
  return rows[0] || null;
}

// Còn bị khóa bao nhiêu ms (0 = không khóa)
async function lockedMs(req, username) {
  const now = Date.now();
  let max = 0;
  for (const { key } of keysFor(req, username)) {
    const row = await getRow(key);
    if (row && row.locked_until) {
      const remain = new Date(row.locked_until).getTime() - now;
      if (remain > max) max = remain;
    }
  }
  return max;
}

async function recordFail(req, username) {
  const now = new Date();
  for (const { key, threshold } of keysFor(req, username)) {
    const row = await getRow(key);
    let fails = 1, windowStart = now, lockedUntil = null;
    if (row && now.getTime() - new Date(row.window_start).getTime() < WINDOW_MS) {
      fails = Number(row.fails) + 1;
      windowStart = new Date(row.window_start);
      if (fails >= threshold) lockedUntil = new Date(now.getTime() + LOCK_MS);
    }
    await db.query(
      `INSERT INTO login_guards (guard_key, fails, window_start, locked_until)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (guard_key) DO UPDATE SET fails = EXCLUDED.fails,
         window_start = EXCLUDED.window_start, locked_until = EXCLUDED.locked_until`,
      [key, fails, windowStart.toISOString(), lockedUntil ? lockedUntil.toISOString() : null]
    );
  }
}

// Đăng nhập đúng -> xóa bộ đếm của tài khoản
async function recordSuccess(req, username) {
  await db.query("DELETE FROM login_guards WHERE guard_key = $1",
    [`u:${String(username || "").toLowerCase()}`]);
}

module.exports = { lockedMs, recordFail, recordSuccess };
