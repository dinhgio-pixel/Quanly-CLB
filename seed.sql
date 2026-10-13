-- ============================================================
-- Seed data: CLB Vovinam Digital (sinh tự động từ file Excel)
-- Học viên: 38 bạn | Ngày sinh: 2026-10-13
-- ============================================================

DELETE FROM payments;
DELETE FROM attendance_records;
DELETE FROM attendance_sessions;
DELETE FROM teaching_logs;
DELETE FROM students;
DELETE FROM coach_classes;
DELETE FROM packages;
DELETE FROM classes;
DELETE FROM users;
DELETE FROM branches;

INSERT INTO branches (name, kind, address) VALUES
  ('CLB Vovinam Digital', 'club', 'Tầng 4–5');

-- Tài khoản admin mặc định: admin / admin123 (PHẢI ĐỔI NGAY)
INSERT INTO users (username, password_hash, role, full_name) VALUES
  ('admin', '$2a$10$j6tQMIxoMv39Qg5SxDAbAujYU9el1q4JHVAuJC0kwugT9tg6txtXa', 'admin', 'Quản trị viên');

INSERT INTO packages (branch_id, name, sessions_per_week, training_format, monthly_fee, status) VALUES
  (1, 'Gói 1 buổi/tuần', 1, 'group', 300000, 'active'),
  (1, 'Gói 2 buổi/tuần', 2, 'group', 400000, 'active'),
  (1, 'Gói 3 buổi/tuần', 3, 'group', 600000, 'active'),
  (1, 'Gói 1 kèm 1', NULL, 'private', 0, 'active');

INSERT INTO classes (branch_id, name, schedule, room, monthly_fee, status) VALUES
  (1, 'Chuyên sâu (Teen 1)', 'T2/4/6 18:30–20:00 · Tầng 4', 'Tầng 4', 600000, 'active'),
  (1, 'Kid 1', 'T2/4/6 17:00–18:30 · Tầng 4', 'Tầng 4', 600000, 'active'),
  (1, 'Kid 2', 'T3/5 18:00–19:30 · Tầng 4', 'Tầng 4', 400000, 'active');

INSERT INTO students (branch_id, class_id, package_id, full_name, dob, phone, joined_on, paid_through, status) VALUES
  (1, 1, 3, 'Lê Nam Vinh', '2011-02-04', '0918247829', '2026-08-23', '2026-10-31', 'active'),
  (1, 1, 3, 'Đỗ Thu Phương', '2007-10-06', '0383067268', '2026-09-19', '2026-10-31', 'active'),
  (1, 1, 1, 'Trần Văn Toàn', NULL, '0911178891', '2026-02-10', '2026-10-31', 'active'),
  (1, 1, 2, 'Cao Phạm Hương Giang', '2006-12-21', '0968703962', '2026-04-07', '2026-10-31', 'active'),
  (1, 1, 3, 'Hà Thị Minh Tâm', NULL, '0353243444', '2026-04-13', '2027-05-31', 'active'),
  (1, 1, 2, 'Lại Hữu Hải', '1991-12-09', '0904684833', '2026-04-23', '2026-10-21', 'active'),
  (1, 1, 3, 'Phạm Xuân Long', '2010-11-18', '0971971382', '2026-03-05', '2026-11-04', 'active'),
  (1, 1, 3, 'Nguyễn Minh Khôi', '2019-12-13', '0965839582', '2026-04-08', '2026-10-31', 'active'),
  (1, 2, 2, 'Bùi Anh Quang', '2018-10-02', '0979871286', '2026-07-22', '2026-10-31', 'active'),
  (1, 2, 3, 'Tào Trung Nghĩa', '2016-06-09', '0345138713', '2026-03-09', '2026-10-31', 'active'),
  (1, 2, 1, 'Hoàng Xuân Thái', '2014-10-23', '0988440426', '2026-06-29', '2026-10-31', 'active'),
  (1, 2, 3, 'Lê Phong Sơn', '2015-08-13', '0968566285', '2026-02-10', '2026-10-31', 'active'),
  (1, 2, 2, 'Phạm Đỗ Minh Đức', '2019-09-20', '0367924935', '2026-07-08', '2026-10-31', 'active'),
  (1, 2, 3, 'Nguyễn Gia Hưng', '2018-08-03', '0387871393', '2026-05-27', '2026-10-31', 'active'),
  (1, 2, 2, 'Phùng Thị Thu Trang', '2015-03-13', '0971032186', '2026-10-08', '2026-10-31', 'active'),
  (1, 2, 2, 'Trịnh Minh Phú', '2015-10-23', '0394999825', '2026-01-06', '2026-10-31', 'active'),
  (1, 2, 1, 'Phạm Ngọc Bảo An', '2018-04-15', '0984674861', '2026-02-10', '2026-10-31', 'active'),
  (1, 2, 3, 'Trần Khôi Nguyên', '2016-12-14', '0972410369', '2026-02-10', '2026-10-31', 'active'),
  (1, 2, 3, 'Lê Anh Vũ', '2015-01-19', '0985733839', '2026-04-20', '2027-04-20', 'active'),
  (1, 2, 3, 'Nguyễn Hải Nam', '2015-02-17', '0968973426', '2026-04-14', '2026-10-14', 'active'),
  (1, 2, 3, 'Nguyễn Tiến Phong', '2020-09-28', '0902256116', '2026-04-23', '2026-11-04', 'active'),
  (1, 2, 3, 'Đặng Hải Vinh', '2019-08-26', '0986227046', '2026-04-23', '2026-11-04', 'active'),
  (1, 2, 2, 'Ngô Khánh Linh', '2013-02-17', '0984023516', '2026-07-17', '2026-11-02', 'active'),
  (1, 2, 3, 'Nguyễn Tiến Minh', '2019-01-26', '0978126655', '2026-08-14', '2026-11-06', 'active'),
  (1, 2, 3, 'Nguyễn Thị Thức', '2007-04-09', '0345947949', '2026-04-16', '2026-11-17', 'active'),
  (1, 3, 2, 'Cao Bảo Anh', '2018-12-10', '0988556831', '2026-07-13', '2026-10-31', 'active'),
  (1, 3, 2, 'Bùi Tuấn Dũng', NULL, '0976528686', '2026-01-06', '2026-10-31', 'active'),
  (1, 3, 2, 'Phạm Ngọc Bảo Châu', '2017-06-29', '0988399986', '2026-05-22', '2026-10-31', 'active'),
  (1, 3, 2, 'Phạm Mạnh Trường', '2022-10-03', '0988399986', '2026-05-22', '2026-10-31', 'active'),
  (1, 3, 2, 'Dương Xuân An', '2020-12-01', '0979939909', '2026-03-30', '2026-10-31', 'active'),
  (1, 3, 2, 'Dương Xuân Khang', '2020-12-01', '0979939909', '2026-09-16', '2026-10-31', 'active'),
  (1, 3, 2, 'Nguyễn Ngọc Bảo Châu', '2019-09-19', '0975398217', '2026-02-10', '2026-10-31', 'active'),
  (1, 3, 2, 'Phan Đức Anh', '2018-05-16', '0944409559', '2026-06-07', '2026-10-31', 'active'),
  (1, 3, 3, 'Bạch Thị Diệp Nhi', '2017-07-17', '0973875925', '2026-08-18', '2026-11-11', 'active'),
  (1, 3, 3, 'Nguyễn Công Chí Kiên', '2020-02-12', '0948055466', '2026-09-04', '2026-10-11', 'active'),
  (1, 3, 3, 'Nguyễn Công Trường An', '2020-02-12', '0948055466', '2026-09-04', '2026-10-11', 'active'),
  (1, 3, 3, 'Trần Thiên Ân', '2020-04-10', '0948783056', '2026-04-17', '2027-04-21', 'active'),
  (1, 3, 3, 'Trịnh Hoàng Bách', '2020-02-12', '0398775534', '2026-04-14', '2026-10-14', 'active');
