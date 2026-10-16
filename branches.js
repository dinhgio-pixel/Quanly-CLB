"use strict";
// Chi nhánh: xem (mọi user đã đăng nhập), thêm/sửa/xóa (admin)
const express = require("express");
const db = require("../db");
const { requireAuth, requireRole } = require("../auth");

const router = express.Router();
router.use(requireAuth);

router.get("/", async (req, res) => {
  const { rows } = await db.query("SELECT * FROM branches ORDER BY id");
  res.json(rows);
});

router.post("/", requireRole("admin"), async (req, res) => {
  const { name, kind, address } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: "Nhập tên chi nhánh" });
  if (!["club", "teaching_point"].includes(kind)) return res.status(400).json({ error: "Loại chi nhánh không hợp lệ" });
  const { rows } = await db.query(
    "INSERT INTO branches (name, kind, address) VALUES ($1,$2,$3) RETURNING *",
    [name.trim(), kind, (address || "").trim()]
  );
  res.status(201).json(rows[0]);
});

router.put("/:id", requireRole("admin"), async (req, res) => {
  const { name, kind, address, status } = req.body || {};
  const sets = [], vals = [];
  const push = (col, v) => { sets.push(`${col} = $${sets.length + 1}`); vals.push(v); };
  if (name !== undefined) push("name", String(name).trim());
  if (kind && ["club", "teaching_point"].includes(kind)) push("kind", kind);
  if (address !== undefined) push("address", String(address).trim());
  if (status && ["active", "inactive"].includes(status)) push("status", status);
  if (!sets.length) return res.status(400).json({ error: "Không có gì để cập nhật" });
  vals.push(req.params.id);
  const { rows } = await db.query(
    `UPDATE branches SET ${sets.join(", ")} WHERE id = $${vals.length} RETURNING *`, vals
  );
  if (!rows[0]) return res.status(404).json({ error: "Không tìm thấy chi nhánh" });
  res.json(rows[0]);
});

router.delete("/:id", requireRole("admin"), async (req, res) => {
  const c = await db.query("SELECT COUNT(*)::int AS n FROM branches");
  if (c.rows[0].n <= 1) return res.status(400).json({ error: "Phải giữ lại ít nhất 1 chi nhánh" });
  await db.query("DELETE FROM branches WHERE id = $1", [req.params.id]);
  res.json({ ok: true });
});

module.exports = router;
