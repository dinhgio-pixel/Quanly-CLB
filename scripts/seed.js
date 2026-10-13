"use strict";
// Nạp seed.sql lên DATABASE_URL
const fs = require("fs");
const path = require("path");
const { getPool } = require("../src/db");

(async () => {
  const sql = fs.readFileSync(path.join(__dirname, "..", "seed.sql"), "utf8");
  await getPool().query(sql);
  console.log("Seed OK");
  process.exit(0);
})().catch((e) => { console.error(e.message); process.exit(1); });
