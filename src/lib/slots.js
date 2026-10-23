"use strict";
// Tiện ích khung giờ: đọc lịch lớp dạng text ("T2/4/6 17:00–18:30 · Tầng 4")
// và kiểm tra chồng lấn thời gian để chống trùng lịch (cho thuê / dạy 1:1).

// "HH:MM" -> số phút trong ngày; không hợp lệ -> null
function toMin(t) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(t || "").trim());
  if (!m) return null;
  const h = Number(m[1]), mi = Number(m[2]);
  if (h > 23 || mi > 59) return null;
  return h * 60 + mi;
}

function toHHMM(mins) {
  return `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
}

// Hai khoảng [s1,e1) và [s2,e2) có chồng nhau không
function overlaps(s1, e1, s2, e2) {
  return s1 < e2 && s2 < e1;
}

// Thứ của 1 ngày "YYYY-MM-DD" theo JS: 0=CN, 1=T2, ..., 6=T7
function weekdayOf(dateStr) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d.getUTCDay();
}

// Đọc lịch lớp: { days:Set(0..6 theo JS), start, end } hoặc null nếu không đọc được.
// Hỗ trợ: "T2/4/6 17:00–18:30", "T3/5 18:00-19:30", "Thứ 2, 4 17:00–18:30", "CN 8:00–9:30".
function parseSchedule(text) {
  if (!text) return null;
  const t = String(text);
  const tm = /(\d{1,2})[:h](\d{2})\s*[–—-]\s*(\d{1,2})[:h](\d{2})/.exec(t);
  if (!tm) return null;
  const start = Number(tm[1]) * 60 + Number(tm[2]);
  const end = Number(tm[3]) * 60 + Number(tm[4]);
  if (end <= start) return null;
  const days = new Set();
  // CN / Chủ nhật -> 0
  if (/\bCN\b|Chủ\s*nhật/i.test(t)) days.add(0);
  // Cụm "T2/4/6" hoặc "Thứ 2, 4, 6": bắt số đầu + các số nối tiếp sau / hoặc ,
  const re = /(?:T|Thứ)\s*([2-7])((?:\s*[/,]\s*[2-7])*)/gi;
  let m;
  while ((m = re.exec(t))) {
    days.add(Number(m[1]) - 1); // T2 -> 1 (JS Mon)
    const tail = m[2].match(/[2-7]/g) || [];
    for (const d of tail) days.add(Number(d) - 1);
  }
  if (!days.size) return null;
  return { days, start, end };
}

// Chuẩn hoá giá trị ngày từ DB (Postgres trả Date, pg-mem trả string) -> "YYYY-MM-DD"
function dateStr(d) {
  if (!d) return "";
  if (d instanceof Date) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
  return String(d).slice(0, 10);
}

module.exports = { toMin, toHHMM, overlaps, weekdayOf, parseSchedule, dateStr };
