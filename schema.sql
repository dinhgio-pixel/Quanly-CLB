-- ============================================================
-- Schema: Quản lý CLB Vovinam (đa chi nhánh)
-- Tương thích PostgreSQL thuần (Supabase). Chỉ dùng kiểu chuẩn.
-- ============================================================

-- Chi nhánh (CLB / điểm dạy độc lập)
CREATE TABLE IF NOT EXISTS branches (
  id         SERIAL PRIMARY KEY,
  name       VARCHAR(100) NOT NULL,
  kind       VARCHAR(20)  NOT NULL DEFAULT 'club'
             CHECK (kind IN ('club', 'teaching_point')),
  address    VARCHAR(200) NOT NULL DEFAULT '',
  status     VARCHAR(20)  NOT NULL DEFAULT 'active'
             CHECK (status IN ('active', 'inactive')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Người dùng: admin quản trị, coach là HLV
CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  username      VARCHAR(50)  NOT NULL UNIQUE,
  password_hash TEXT         NOT NULL,
  role          VARCHAR(20)  NOT NULL DEFAULT 'coach'
                CHECK (role IN ('admin', 'coach', 'student')),
  full_name     VARCHAR(100) NOT NULL DEFAULT '',
  status        VARCHAR(20)  NOT NULL DEFAULT 'active'
                CHECK (status IN ('active', 'inactive')),
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Lớp học
CREATE TABLE IF NOT EXISTS classes (
  id          SERIAL PRIMARY KEY,
  branch_id   INTEGER NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  name        VARCHAR(100) NOT NULL,
  schedule    VARCHAR(160) NOT NULL DEFAULT '',
  room        VARCHAR(100) NOT NULL DEFAULT '',
  monthly_fee INTEGER NOT NULL DEFAULT 0 CHECK (monthly_fee >= 0),
  status      VARCHAR(20) NOT NULL DEFAULT 'active'
              CHECK (status IN ('active', 'inactive')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_classes_branch ON classes(branch_id);

-- Gán HLV quản lý từng lớp (HLV chỉ thấy lớp được gán)
CREATE TABLE IF NOT EXISTS coach_classes (
  id       SERIAL PRIMARY KEY,
  user_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  UNIQUE (user_id, class_id)
);
CREATE INDEX IF NOT EXISTS idx_coach_classes_user  ON coach_classes(user_id);
CREATE INDEX IF NOT EXISTS idx_coach_classes_class ON coach_classes(class_id);

-- Gói học (quản lý linh động ngay trên phần mềm)
CREATE TABLE IF NOT EXISTS packages (
  id               SERIAL PRIMARY KEY,
  branch_id        INTEGER NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  name             VARCHAR(100) NOT NULL,
  sessions_per_week INTEGER CHECK (sessions_per_week IS NULL OR sessions_per_week > 0),
  training_format  VARCHAR(20) NOT NULL DEFAULT 'group'
                   CHECK (training_format IN ('group', 'private')),
  monthly_fee      INTEGER NOT NULL DEFAULT 0 CHECK (monthly_fee >= 0),
  status           VARCHAR(20) NOT NULL DEFAULT 'active'
                   CHECK (status IN ('active', 'inactive')),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_packages_branch ON packages(branch_id);

-- Học viên
CREATE TABLE IF NOT EXISTS students (
  id           SERIAL PRIMARY KEY,
  branch_id    INTEGER NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  class_id     INTEGER REFERENCES classes(id) ON DELETE SET NULL,
  package_id   INTEGER REFERENCES packages(id) ON DELETE SET NULL,
  full_name    VARCHAR(120) NOT NULL,
  dob          DATE,
  phone        VARCHAR(30) NOT NULL DEFAULT '',
  joined_on    DATE NOT NULL,
  paid_through DATE,
  height_cm    NUMERIC(5,1),
  weight_kg    NUMERIC(5,1),
  health_note  TEXT NOT NULL DEFAULT '',
  belt_level   VARCHAR(50) NOT NULL DEFAULT '',
  leave_reason VARCHAR(300) NOT NULL DEFAULT '',
  stopped_at   DATE,
  status       VARCHAR(20) NOT NULL DEFAULT 'active'
               CHECK (status IN ('active', 'paused', 'stopped')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_students_branch ON students(branch_id);
CREATE INDEX IF NOT EXISTS idx_students_class  ON students(class_id);
CREATE INDEX IF NOT EXISTS idx_students_name   ON students(full_name);

-- Buổi điểm danh
CREATE TABLE IF NOT EXISTS attendance_sessions (
  id          SERIAL PRIMARY KEY,
  class_id    INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  session_date DATE NOT NULL,
  note        VARCHAR(200) NOT NULL DEFAULT '',
  created_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (class_id, session_date)
);
CREATE INDEX IF NOT EXISTS idx_att_sessions_class ON attendance_sessions(class_id);

-- Chi tiết điểm danh từng học viên
CREATE TABLE IF NOT EXISTS attendance_records (
  id         SERIAL PRIMARY KEY,
  session_id INTEGER NOT NULL REFERENCES attendance_sessions(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  status     VARCHAR(20) NOT NULL DEFAULT 'present'
             CHECK (status IN ('present', 'absent', 'excused')),
  UNIQUE (session_id, student_id)
);
CREATE INDEX IF NOT EXISTS idx_att_records_session ON attendance_records(session_id);
CREATE INDEX IF NOT EXISTS idx_att_records_student ON attendance_records(student_id);

-- Nhật ký giảng dạy
CREATE TABLE IF NOT EXISTS teaching_logs (
  id         SERIAL PRIMARY KEY,
  class_id   INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  log_date   DATE NOT NULL,
  content    TEXT NOT NULL,
  details    TEXT NOT NULL DEFAULT '',
  note       VARCHAR(300) NOT NULL DEFAULT '',
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_teaching_logs_class ON teaching_logs(class_id);

-- Khoản thu (học phí lớp / dạy 1:1 / cho thuê / biểu diễn / khác)
CREATE TABLE IF NOT EXISTS payments (
  id           SERIAL PRIMARY KEY,
  branch_id    INTEGER NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  student_id   INTEGER REFERENCES students(id) ON DELETE SET NULL,
  category     VARCHAR(30) NOT NULL DEFAULT 'tuition'
               CHECK (category IN ('tuition', 'private', 'rental', 'performance', 'other')),
  amount       INTEGER NOT NULL CHECK (amount > 0),
  paid_on      DATE NOT NULL,
  paid_through DATE,
  note         VARCHAR(200) NOT NULL DEFAULT '',
  created_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_payments_branch  ON payments(branch_id);
CREATE INDEX IF NOT EXISTS idx_payments_student ON payments(student_id);
CREATE INDEX IF NOT EXISTS idx_payments_paid_on ON payments(paid_on);

-- Chấm công HLV theo buổi và giờ dạy (mỗi dòng = 1 buổi dạy)
CREATE TABLE IF NOT EXISTS coach_timesheets (
  id         SERIAL PRIMARY KEY,
  branch_id  INTEGER NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  class_id   INTEGER REFERENCES classes(id) ON DELETE SET NULL,
  work_date  DATE NOT NULL,
  hours      NUMERIC(4,1) NOT NULL CHECK (hours > 0 AND hours <= 24),
  note       VARCHAR(200) NOT NULL DEFAULT '',
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_timesheets_branch ON coach_timesheets(branch_id);
CREATE INDEX IF NOT EXISTS idx_timesheets_user   ON coach_timesheets(user_id);
CREATE INDEX IF NOT EXISTS idx_timesheets_date  ON coach_timesheets(work_date);

-- Yêu cầu đổi ca dạy của HLV (HLV gửi, quản trị viên duyệt)
CREATE TABLE IF NOT EXISTS shift_swaps (
  id           SERIAL PRIMARY KEY,
  branch_id    INTEGER NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  requester_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  class_id     INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  work_date    DATE NOT NULL,
  swap_with_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reason       VARCHAR(300) NOT NULL DEFAULT '',
  status       VARCHAR(20) NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at  TIMESTAMPTZ,
  review_note  VARCHAR(300) NOT NULL DEFAULT '',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_shift_swaps_branch    ON shift_swaps(branch_id);
CREATE INDEX IF NOT EXISTS idx_shift_swaps_requester ON shift_swaps(requester_id);
CREATE INDEX IF NOT EXISTS idx_shift_swaps_status    ON shift_swaps(status);

-- ============================================================
-- Migration cho DB đang chạy (chạy lại an toàn mỗi lần deploy)
-- ============================================================

-- Học viên: cấp đai, nguyên nhân nghỉ, ngày nghỉ
ALTER TABLE students ADD COLUMN IF NOT EXISTS belt_level VARCHAR(50) NOT NULL DEFAULT '';
ALTER TABLE students ADD COLUMN IF NOT EXISTS leave_reason VARCHAR(300) NOT NULL DEFAULT '';
ALTER TABLE students ADD COLUMN IF NOT EXISTS stopped_at DATE;

-- Nhật ký dạy: chi tiết + ghi chú
ALTER TABLE teaching_logs ADD COLUMN IF NOT EXISTS details TEXT NOT NULL DEFAULT '';
ALTER TABLE teaching_logs ADD COLUMN IF NOT EXISTS note VARCHAR(300) NOT NULL DEFAULT '';

-- Tài khoản học viên: liên kết tới hồ sơ học viên
ALTER TABLE users ADD COLUMN IF NOT EXISTS student_id INTEGER REFERENCES students(id) ON DELETE SET NULL;

-- Yêu cầu xóa học viên (HLV gửi, quản trị viên duyệt)
CREATE TABLE IF NOT EXISTS student_delete_requests (
  id           SERIAL PRIMARY KEY,
  branch_id    INTEGER NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  student_id   INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  requester_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason       VARCHAR(300) NOT NULL DEFAULT '',
  status       VARCHAR(20) NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_by  INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at  TIMESTAMPTZ,
  review_note  VARCHAR(300) NOT NULL DEFAULT '',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_delreq_branch ON student_delete_requests(branch_id);
CREATE INDEX IF NOT EXISTS idx_delreq_status ON student_delete_requests(status);
