# Quản lý CLB Vovinam (bản production)

Phần mềm quản lý **đa chi nhánh** CLB võ Vovinam: học viên, lớp học, gói học,
điểm danh, nhật ký giảng dạy, thu phí và phân quyền huấn luyện viên theo lớp.

- Backend: Node.js + Express (JS thuần), phục vụ cả API JSON và frontend tĩnh.
- Database: PostgreSQL thuần (schema tương thích Supabase).
- Auth: tự làm bằng JWT + bcrypt. Role `admin` (toàn quyền) / `coach`
  (chỉ thấy và quản lý lớp được gán).
- Frontend: SPA HTML/CSS/JS thuần, tiếng Việt, mobile-first.

## Cấu trúc thư mục

```
clb-vovinam-production/
├── schema.sql                  # schema PostgreSQL
├── seed.sql                    # dữ liệu mẫu (sinh từ file Excel CLB)
├── Dockerfile                  # build image production (node:20-alpine)
├── render.yaml                 # blueprint deploy lên Render (gói free)
├── .env.example                # mẫu biến môi trường
├── README.md
├── package.json
├── src/
│   ├── server.js               # khởi động server
│   ├── app.js                  # tạo Express app
│   ├── db.js                   # pool Postgres (DATABASE_URL)
│   ├── auth.js                 # JWT + middleware phân quyền
│   ├── helpers.js              # trạng thái học phí, lọc lớp theo HLV
│   └── routes/                 # auth, users, branches, classes, packages,
│                               # students, attendance, logs (nhật ký),
│                               # payments (thu phí), dashboard
├── public/                     # frontend tĩnh
│   ├── index.html
│   ├── css/style.css
│   └── js/app.js               # SPA: dashboard, lớp, HV, điểm danh, thu phí...
├── scripts/
│   ├── generate-seed.py        # đọc Excel -> sinh seed.sql (openpyxl)
│   ├── init.js                 # deploy: migrate + seed nếu DB trống
│   ├── migrate.js              # chạy schema.sql (thủ công)
│   └── seed.js                 # chạy seed.sql (thủ công)
└── tests/app.test.js           # test tự động (pg-mem + supertest)
```

## Tài khoản mặc định

- Tên đăng nhập: `admin` / Mật khẩu: `admin123`
- ⚠️ **Đổi mật khẩu ngay sau khi deploy** (mục Tài khoản → Sửa).

## Chạy local (cần PostgreSQL)

```bash
cp .env.example .env        # sửa DATABASE_URL, JWT_SECRET
npm install
node scripts/migrate.js    # tạo bảng
node scripts/seed.js        # nạp dữ liệu mẫu (38 học viên)
npm start                  # mở http://localhost:3000
```

Chạy test (không cần Postgres thật):

```bash
npm install
npm test
```

Sinh lại `seed.sql` từ file Excel mới:

```bash
HASH=$(node -e "console.log(require('bcryptjs').hashSync('admin123',10))")
ADMIN_HASH="$HASH" python3 scripts/generate-seed.py <đường-dẫn-excel> seed.sql
```

## Deploy từng bước: Render (free) + Supabase (free) — 0đ

### Bước 1 — Tạo database trên Supabase (2 phút)
1. Vào https://supabase.com → đăng nhập (tài khoản của Định) → **New project**.
2. Đặt tên project (vd `clb-vovinam`), chờ tạo xong.
3. Bấm nút **Connect** trên thanh công cụ → chọn tab **Direct** → ở mục
   Connection Method chọn **Transaction pooler** (Render gói free không có
   outbound IPv6, dùng pooler mới kết nối được — KHÔNG bấm "Enable IPv4 add-on"
   vì tốn $4/tháng, không cần thiết).
   Copy **connection string** dạng
   `postgresql://postgres.xxxxx:[YOUR-PASSWORD]@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres`,
   thay `[YOUR-PASSWORD]` bằng mật khẩu database đã lưu. Giữ chuỗi này, dán
   vào Render ở bước 3.

### Bước 2 — Đưa code lên GitHub (3 phút)
1. Tạo repo mới trên GitHub (tài khoản của Định), vd `clb-vovinam`.
2. Trong thư mục `clb-vovinam-production`:
   ```bash
   git init && git add . && git commit -m "ban production dau tien"
   git branch -M main
   git remote add origin https://github.com/<ten-tai-khoan>/clb-vovinam.git
   git push -u origin main
   ```

### Bước 3 — Deploy web lên Render (3 phút)
1. Vào https://dashboard.render.com → **New → Blueprint** → chọn repo `clb-vovinam`.
2. Render đọc `render.yaml` và tạo web service gói **Free**.
3. Ở mục **Environment**, dán `DATABASE_URL` = connection string Supabase ở bước 1.
   (`JWT_SECRET` Render tự sinh.)
4. Bấm **Apply** → chờ build xong (~3–5 phút).
5. Lần chạy đầu tiên, container tự chạy `scripts/init.js`: tạo bảng + nạp dữ
   liệu mẫu (38 học viên + tài khoản `admin/admin123`).

### Bước 4 — Kiểm tra
- Mở link `https://clb-vovinam.onrender.com` (tên miền Render cấp).
- Đăng nhập `admin / admin123` → **đổi mật khẩu ngay**.
- Lưu ý gói free: web "ngủ" sau 15 phút không ai vào, lần mở đầu chậm
  ~30–60 giây. Đây là giới hạn của gói miễn phí, không phải lỗi.

## Khi nào cần nâng cấp (trả phí, rẻ nhất)

- Gói free đủ để Định test và team 4–5 người dùng thử.
- Khi dùng thật ổn định, nâng lên **VPS Việt Nam ~120.000–150.000đ/tháng**
  (chạy cả web + database + backup tự động) — rẻ hơn các gói managed quốc tế.
  Max sẽ hỗ trợ migrate dữ liệu sang VPS khi tới bước này.

## Checklist cho Định

- [ ] Tạo tài khoản Supabase + project, copy connection string
- [ ] Tạo repo GitHub, push code
- [ ] Tạo Blueprint trên Render, dán DATABASE_URL
- [ ] Mở link, đăng nhập admin/admin123, **đổi mật khẩu ngay**
- [ ] Tạo tài khoản cho từng HLV (mục Tài khoản), gán lớp ở tab HLV trong từng lớp
- [ ] (Tùy chọn) mua tên miền riêng trỏ về link Render
