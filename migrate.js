"use strict";
// Chạy schema.sql lên DATABASE_URL
const fs = require("fs");
const path = require("path");
const { getPool } = require("../src/db");

(async () => {
  const sql = fs.readFileSync(path.join(__dirname, "..", "schema.sql"), "utf8");
  await getPool().query(sql);
  console.log("Migrate schema OK");
  process.exit(0);
})().catch((e) => { console.error(e.message); process.exit(1); });
