"use strict";
const express = require("express");
const { signToken, verifyCredentials, requireAuth } = require("../auth");
const { getCoachClassIds } = require("../auth");
const db = require("../db");

const router = express.Router();

router.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: "Nhập tên đăng nhập và mật khẩu" });
    }
    const user = await verifyCredentials(username, password);
    if (!user) return res.status(401).json({ error: "Sai tên đăng nhập hoặc mật khẩu" });
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
