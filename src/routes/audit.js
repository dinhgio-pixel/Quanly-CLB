"use strict";
// Xem nhật ký hoạt động (chỉ admin)
const express = require("express");
const db = require("../db");
const { requireAuth, requireRole } = require("../auth");

const router = express.Router();
router.use(requireAuth, requireRole("admin"));

router.get("/", async (req, res) => {
  const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 200));
  const action = String(req.query.action || "");
  const conds = [], vals = [];
  if (action) { conds.push(`action LIKE $${vals.length + 1}`); vals.push(action + "%"); }
  const where = conds.length ? "WHERE " + conds.join(" AND ") : "";
  vals.push(limit);
  const { rows } = await db.query(
    `SELECT id, user_id, username, action, entity, entity_id, detail, ip, created_at
     FROM audit_logs ${where} ORDER BY id DESC LIMIT $${vals.length}`, vals
  );
  res.json(rows);
});

module.exports = router;
