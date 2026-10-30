"use strict";
const express = require("express");
const { signToken, verifyCredentials, requireAuth } = require("../auth");
const { getCoachClassIds } = require("../auth");
const db = require("../db");
const guard = require("../lib/login-guard");
const { logAudit } = require("../lib/audit");

const router = express.Router();

router.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: "Nhập tên đăng nhập và mật khẩu" });
    }
    const locked = await guard.lockedMs(req, username);
    if (locked > 0) {
      await logAudit(req, "login_locked", "auth", null,
        `Đăng nhập bị chặn tạm thời (còn ${Math.ceil(locked / 60000)} phút) — tài khoản ${username}`);
      return res.status(429).json({
        error: `Đăng nhập sai quá nhiều lần. Vui lòng thử lại sau ${Math.ceil(locked / 60000)} phút.`,
      });
    }
    const user = await verifyCredentials(username, password);
    if (!user) {
      await guard.recordFail(req, username);
      await logAudit(req, "login_failed", "auth", null, `Đăng nhập sai — tài khoản ${username}`);
      return res.status(401).json({ error: "Sai tên đăng nhập hoặc mật khẩu" });
    }
    await guard.recordSuccess(req, username);
    req.user = user; // để nhật ký ghi đúng người vừa đăng nhập
    await logAudit(req, "login_success", "auth", user.id, `Đăng nhập thành công`);
    const token = signToken(user);
    const classIds = user.role === "coach" ? await getCoachClassIds(user.id) : null;
    res.json({ token, user: { ...user, classIds } });
  } catch (e) {
    res.status(500).json({ error: "Lỗi đăng nhập" });
  }
});

router.get("/me", requireAuth, async (req, res) => {
  const classIds = req.user.role === "coach" ? await getCoachClassIds(req.user.id) : null;
  res.json({ ...req.user, classIds });
});

module.exports = router;
