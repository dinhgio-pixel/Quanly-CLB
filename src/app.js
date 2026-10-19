"use strict";
// Factory tạo Express app (để test có thể inject pool pg-mem)
const express = require("express");
const path = require("path");

function createApp() {
  const app = express();
  app.use(express.json({ limit: "1mb" }));

  // API
  app.use("/api/auth", require("./routes/auth"));
  app.use("/api/users", require("./routes/users"));
  app.use("/api/branches", require("./routes/branches"));
  app.use("/api/classes", require("./routes/classes"));
  app.use("/api/packages", require("./routes/packages"));
  app.use("/api/students", require("./routes/students"));
  app.use("/api/attendance", require("./routes/attendance"));
  app.use("/api/teaching-logs", require("./routes/logs"));
  app.use("/api/payments", require("./routes/payments"));
  app.use("/api/timesheets", require("./routes/timesheets"));
  app.use("/api/shift-swaps", require("./routes/shifts"));
  app.use("/api/export", require("./routes/export"));
  app.use("/api/directory", require("./routes/directory"));
  app.use("/api/profile", require("./routes/profile"));
  app.use("/api/dashboard", require("./routes/dashboard"));

  app.get("/api/health", (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

  // 404 cho API lạ
  app.use("/api", (req, res) => res.status(404).json({ error: "API không tồn tại" }));

  // Frontend tĩnh (SPA)
  const pub = path.join(__dirname, "..", "public");
  app.use(express.static(pub));
  app.get("*", (req, res) => res.sendFile(path.join(pub, "index.html")));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).json({ error: "Lỗi máy chủ" });
  });

  return app;
}

module.exports = { createApp };
