"use strict";
// Render free không hỗ trợ outbound IPv6: ép DNS ưu tiên IPv4 để nối Supabase pooler
require("dns").setDefaultResultOrder("ipv4first");
const { createApp } = require("./app");

const PORT = process.env.PORT || 3000;
const app = createApp();

app.listen(PORT, () => {
  console.log(`Quản lý CLB Vovinam chạy tại cổng ${PORT}`);
});
