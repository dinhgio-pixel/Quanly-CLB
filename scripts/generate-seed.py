#!/usr/bin/env python3
"""Đọc file Excel quản lý học viên CLB và sinh seed.sql cho bản production.

Cách dùng:
    ADMIN_HASH='$2a$...' python3 scripts/generate-seed.py \
        ~/workspace/your_files/Quan-ly-hoc-vien-CLB-Vovinam-Digital.xlsx \
        seed.sql
"""
import sys
import openpyxl
from datetime import date, datetime

XLSX_PATH = sys.argv[1]
OUT_PATH = sys.argv[2]
ADMIN_HASH = sys.argv[3] if len(sys.argv) > 4 else None

import os
ADMIN_HASH = os.environ.get("ADMIN_HASH", ADMIN_HASH or "")

wb = openpyxl.load_workbook(XLSX_PATH, data_only=True)

def d(v):
    if v is None or v == "":
        return None
    if isinstance(v, datetime):
        v = v.date()
    if isinstance(v, date):
        return v.strftime("%Y-%m-%d")
    return None

def q(s):
    if s is None:
        return "NULL"
    return "'" + str(s).replace("'", "''") + "'"

PKG_MAP = {"1 buổi/tuần": 1, "2 buổi/tuần": 2, "3 buổi/tuần": 3}

# branch_id -> (sheet_name, class_id)
PLAN = [
    ("Teen 1", 1, "Chuyên sâu (Teen 1)"),
    ("Kid 1", 2, "Kid 1"),
    ("Kid 2", 3, "Kid 2"),
]

students = []  # (id, branch, class, package, name, dob, phone, joined, paid_through)
sid = 0
for sheet_name, class_id, _label in PLAN:
    ws = wb[sheet_name]
    for r in range(5, ws.max_row + 1):
        name = ws.cell(r, 2).value
        if name is None or str(name).strip() == "":
            continue
        if str(name).strip() == "Họ tên":
            break  # bắt đầu vùng nhật ký thu phí -> bỏ qua
        pkg_name = (ws.cell(r, 6).value or "").strip()
        sid += 1
        students.append({
            "id": sid,
            "branch_id": 1,
            "class_id": class_id,
            "package_id": PKG_MAP.get(pkg_name),
            "full_name": str(name).strip(),
            "dob": d(ws.cell(r, 3).value),
            "phone": str(ws.cell(r, 4).value or "").strip(),
            "joined_on": d(ws.cell(r, 5).value),
            "paid_through": d(ws.cell(r, 9).value),
        })

for s in students:
    assert s["joined_on"], f"thiếu ngày vào lớp: {s['full_name']}"

lines = []
lines.append("-- ============================================================")
lines.append("-- Seed data: CLB Vovinam Digital (sinh tự động từ file Excel)")
lines.append(f"-- Học viên: {len(students)} bạn | Ngày sinh: {date.today()}")
lines.append("-- ============================================================")
lines.append("")
tables = ["payments", "attendance_records", "attendance_sessions",
          "teaching_logs", "students", "coach_classes", "packages",
          "classes", "users", "branches"]
for t in tables:
    lines.append(f"DELETE FROM {t};")
lines.append("")

# Chi nhánh
lines.append("INSERT INTO branches (name, kind, address) VALUES")
lines.append("  ('CLB Vovinam Digital', 'club', 'Tầng 4–5');")
lines.append("")

# Admin mặc định (ĐỔI MẬT KHẨU NGAY sau khi deploy)
lines.append("-- Tài khoản admin mặc định: admin / admin123 (PHẢI ĐỔI NGAY)")
lines.append("INSERT INTO users (username, password_hash, role, full_name) VALUES")
lines.append(f"  ('admin', '{ADMIN_HASH}', 'admin', 'Quản trị viên');")
lines.append("")

# Gói học
lines.append("INSERT INTO packages (branch_id, name, sessions_per_week, training_format, monthly_fee, status) VALUES")
lines.append("  (1, 'Gói 1 buổi/tuần', 1, 'group', 300000, 'active'),")
lines.append("  (1, 'Gói 2 buổi/tuần', 2, 'group', 400000, 'active'),")
lines.append("  (1, 'Gói 3 buổi/tuần', 3, 'group', 600000, 'active'),")
lines.append("  (1, 'Gói 1 kèm 1', NULL, 'private', 0, 'active');")
lines.append("")

# Lớp học
lines.append("INSERT INTO classes (branch_id, name, schedule, room, monthly_fee, status) VALUES")
lines.append("  (1, 'Chuyên sâu (Teen 1)', 'T2/4/6 18:30–20:00 · Tầng 4', 'Tầng 4', 600000, 'active'),")
lines.append("  (1, 'Kid 1', 'T2/4/6 17:00–18:30 · Tầng 4', 'Tầng 4', 600000, 'active'),")
lines.append("  (1, 'Kid 2', 'T3/5 18:00–19:30 · Tầng 4', 'Tầng 4', 400000, 'active');")
lines.append("")

# Học viên (id tự tăng theo đúng thứ tự insert trên DB mới)
lines.append("INSERT INTO students (branch_id, class_id, package_id, full_name, dob, phone, joined_on, paid_through, status) VALUES")
rows = []
for s in students:
    dob = q(s["dob"]) if s["dob"] else "NULL"
    pt = q(s["paid_through"]) if s["paid_through"] else "NULL"
    pkg = str(s["package_id"]) if s["package_id"] else "NULL"
    rows.append(
        f"  ({s['branch_id']}, {s['class_id']}, {pkg}, {q(s['full_name'])}, "
        f"{dob}, {q(s['phone'])}, {q(s['joined_on'])}, {pt}, 'active')"
    )
lines.append(",\n".join(rows) + ";")
lines.append("")

with open(OUT_PATH, "w", encoding="utf-8") as f:
    f.write("\n".join(lines))

print(f"OK: {len(students)} học viên -> {OUT_PATH}")
