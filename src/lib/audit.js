"use strict";
// Ghi nhật ký hoạt động (audit log). Lỗi ghi log KHÔNG bao giờ được làm hỏng nghiệp vụ chính.
const db = require("../db");

async function logAudit(req, action, entity, entityId, detail) {
  try {
    const user = (req && req.user) || null;
    await db.query(
      `INSERT INTO audit_logs (user_id, username, action, entity, entity_id, detail, ip)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [
        user ? user.id : null,
        user ? user.username : ((req && req.body && req.body.username) || ""),
        action,
        entity || "",
        entityId != null ? Number(entityId) : null,
        String(detail || "").slice(0, 500),
        (req && req.ip) || "",
      ]
    );
  } catch (e) { /* bỏ qua: log là phụ trợ */ }
}

module.exports = { logAudit };
