-- =====================================================================
--  Test & Pre-Test Online — Database Schema (MySQL 5.7+ / MariaDB 10.3+)
--  Import file ini melalui phpMyAdmin (tab "Import") ke database kosong.
--  Akun admin default:  username: admin   password: Admin@123
--  (WAJIB diganti setelah login pertama)
-- =====================================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

DROP TABLE IF EXISTS exam_answers;
DROP TABLE IF EXISTS attempt_questions;
DROP TABLE IF EXISTS exam_attempts;
DROP TABLE IF EXISTS exam_assignments;
DROP TABLE IF EXISTS exam_questions;
DROP TABLE IF EXISTS exams;
DROP TABLE IF EXISTS question_options;
DROP TABLE IF EXISTS questions;
DROP TABLE IF EXISTS categories;
DROP TABLE IF EXISTS login_attempts;
DROP TABLE IF EXISTS users;

SET FOREIGN_KEY_CHECKS = 1;

-- ---------------------------------------------------------------------
-- users
-- ---------------------------------------------------------------------
CREATE TABLE users (
    id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
    name          VARCHAR(120) NOT NULL,
    username      VARCHAR(60)  NOT NULL,
    email         VARCHAR(150) NULL,
    password      VARCHAR(255) NOT NULL,
    role          ENUM('admin','user') NOT NULL DEFAULT 'user',
    department    VARCHAR(100) NULL,
    position      VARCHAR(100) NULL,
    status        ENUM('active','inactive') NOT NULL DEFAULT 'active',
    last_login_at DATETIME NULL,
    created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    DATETIME NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_users_username (username),
    UNIQUE KEY uq_users_email (email),
    KEY idx_users_department (department),
    KEY idx_users_role (role)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- login_attempts (proteksi brute-force)
-- ---------------------------------------------------------------------
CREATE TABLE login_attempts (
    id           INT UNSIGNED NOT NULL AUTO_INCREMENT,
    ip_address   VARCHAR(45)  NOT NULL,
    username     VARCHAR(150) NOT NULL,
    attempted_at DATETIME NOT NULL,
    PRIMARY KEY (id),
    KEY idx_login_ip_time (ip_address, attempted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- categories (kategori question bank)
-- ---------------------------------------------------------------------
CREATE TABLE categories (
    id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
    name        VARCHAR(100) NOT NULL,
    description VARCHAR(255) NULL,
    created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_categories_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- questions
-- ---------------------------------------------------------------------
CREATE TABLE questions (
    id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
    category_id   INT UNSIGNED NULL,
    question      TEXT NOT NULL,
    question_type ENUM('multiple_choice','multiple_answer','true_false','short_answer','essay') NOT NULL DEFAULT 'multiple_choice',
    difficulty    ENUM('easy','medium','hard') NOT NULL DEFAULT 'medium',
    points        DECIMAL(6,2) NOT NULL DEFAULT 1.00,
    explanation   TEXT NULL,
    image         VARCHAR(255) NULL,
    created_by    INT UNSIGNED NULL,
    created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    DATETIME NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_questions_category (category_id),
    KEY idx_questions_type (question_type),
    CONSTRAINT fk_questions_category FOREIGN KEY (category_id) REFERENCES categories (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- question_options
-- ---------------------------------------------------------------------
CREATE TABLE question_options (
    id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
    question_id INT UNSIGNED NOT NULL,
    option_text TEXT NOT NULL,
    is_correct  TINYINT(1) NOT NULL DEFAULT 0,
    sort_order  INT NOT NULL DEFAULT 0,
    created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_options_question (question_id),
    CONSTRAINT fk_options_question FOREIGN KEY (question_id) REFERENCES questions (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- exams
--   type = 'pretest' -> show_result boleh 1 (score tampil ke peserta)
--   type = 'test'    -> show_result DIPAKSA 0 oleh backend (score hanya admin)
-- ---------------------------------------------------------------------
CREATE TABLE exams (
    id                  INT UNSIGNED NOT NULL AUTO_INCREMENT,
    title               VARCHAR(200) NOT NULL,
    description         TEXT NULL,
    instructions        TEXT NULL,
    type                ENUM('pretest','test') NOT NULL DEFAULT 'pretest',
    duration            INT UNSIGNED NOT NULL DEFAULT 60 COMMENT 'menit',
    passing_grade       DECIMAL(5,2) NOT NULL DEFAULT 70.00,
    show_result         TINYINT(1) NOT NULL DEFAULT 1,
    show_correct_answer TINYINT(1) NOT NULL DEFAULT 0,
    random_question     TINYINT(1) NOT NULL DEFAULT 0,
    random_answer       TINYINT(1) NOT NULL DEFAULT 0,
    question_count      INT UNSIGNED NOT NULL DEFAULT 0 COMMENT '0 = semua soal pada pool',
    max_attempts        INT UNSIGNED NOT NULL DEFAULT 1,
    start_date          DATETIME NULL,
    end_date            DATETIME NULL,
    status              ENUM('draft','published','closed') NOT NULL DEFAULT 'draft',
    created_by          INT UNSIGNED NULL,
    created_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME NULL DEFAULT NULL ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_exams_type_status (type, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- exam_questions  (pool soal milik sebuah exam, diatur admin)
-- ---------------------------------------------------------------------
CREATE TABLE exam_questions (
    id             INT UNSIGNED NOT NULL AUTO_INCREMENT,
    exam_id        INT UNSIGNED NOT NULL,
    question_id    INT UNSIGNED NOT NULL,
    question_order INT NOT NULL DEFAULT 0,
    PRIMARY KEY (id),
    UNIQUE KEY uq_exam_question (exam_id, question_id),
    KEY idx_eq_question (question_id),
    CONSTRAINT fk_eq_exam FOREIGN KEY (exam_id) REFERENCES exams (id) ON DELETE CASCADE,
    CONSTRAINT fk_eq_question FOREIGN KEY (question_id) REFERENCES questions (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- exam_assignments  (exam tanpa assignment = terbuka untuk semua user)
-- ---------------------------------------------------------------------
CREATE TABLE exam_assignments (
    id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
    exam_id    INT UNSIGNED NOT NULL,
    user_id    INT UNSIGNED NULL,
    department VARCHAR(100) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_assign_exam (exam_id),
    KEY idx_assign_user (user_id),
    CONSTRAINT fk_assign_exam FOREIGN KEY (exam_id) REFERENCES exams (id) ON DELETE CASCADE,
    CONSTRAINT fk_assign_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- exam_attempts  (score SELALU dihitung & disimpan; akses dibatasi backend)
-- ---------------------------------------------------------------------
CREATE TABLE exam_attempts (
    id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
    user_id         INT UNSIGNED NOT NULL,
    exam_id         INT UNSIGNED NOT NULL,
    started_at      DATETIME NOT NULL,
    deadline_at     DATETIME NOT NULL COMMENT 'batas waktu server-side',
    submitted_at    DATETIME NULL,
    duration        INT UNSIGNED NULL COMMENT 'detik',
    total_questions INT UNSIGNED NOT NULL DEFAULT 0,
    correct_answers INT UNSIGNED NOT NULL DEFAULT 0,
    wrong_answers   INT UNSIGNED NOT NULL DEFAULT 0,
    unanswered      INT UNSIGNED NOT NULL DEFAULT 0,
    pending_review  INT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'essay belum dinilai',
    total_points    DECIMAL(8,2) NOT NULL DEFAULT 0.00,
    max_points      DECIMAL(8,2) NOT NULL DEFAULT 0.00,
    score           DECIMAL(5,2) NULL,
    percentage      DECIMAL(5,2) NULL,
    passed          TINYINT(1) NULL,
    status          ENUM('in_progress','submitted','auto_submitted') NOT NULL DEFAULT 'in_progress',
    ip_address      VARCHAR(45) NULL,
    user_agent      VARCHAR(255) NULL,
    created_at      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_attempt_user_exam (user_id, exam_id, status),
    KEY idx_attempt_exam_status (exam_id, status),
    KEY idx_attempt_submitted (submitted_at),
    KEY idx_attempt_deadline (status, deadline_at),
    CONSTRAINT fk_attempt_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT fk_attempt_exam FOREIGN KEY (exam_id) REFERENCES exams (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- attempt_questions  (snapshot soal yang BENAR-BENAR diberikan ke peserta,
--                     termasuk urutan soal & urutan opsi hasil random,
--                     agar setiap attempt dapat direkonstruksi)
-- ---------------------------------------------------------------------
CREATE TABLE attempt_questions (
    id             INT UNSIGNED NOT NULL AUTO_INCREMENT,
    attempt_id     INT UNSIGNED NOT NULL,
    question_id    INT UNSIGNED NOT NULL,
    question_order INT NOT NULL DEFAULT 0,
    option_order   VARCHAR(1000) NULL COMMENT 'CSV id opsi sesuai urutan tampil',
    points         DECIMAL(6,2) NOT NULL DEFAULT 1.00 COMMENT 'snapshot bobot soal',
    PRIMARY KEY (id),
    UNIQUE KEY uq_attempt_question (attempt_id, question_id),
    KEY idx_aq_question (question_id),
    CONSTRAINT fk_aq_attempt FOREIGN KEY (attempt_id) REFERENCES exam_attempts (id) ON DELETE CASCADE,
    CONSTRAINT fk_aq_question FOREIGN KEY (question_id) REFERENCES questions (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- exam_answers
-- ---------------------------------------------------------------------
CREATE TABLE exam_answers (
    id                 INT UNSIGNED NOT NULL AUTO_INCREMENT,
    attempt_id         INT UNSIGNED NOT NULL,
    question_id        INT UNSIGNED NOT NULL,
    selected_option_id INT UNSIGNED NULL,
    selected_options   VARCHAR(500) NULL COMMENT 'CSV id opsi (multiple answer)',
    answer_text        TEXT NULL,
    is_correct         TINYINT(1) NULL COMMENT 'NULL = belum dinilai / tidak dijawab',
    points             DECIMAL(6,2) NOT NULL DEFAULT 0.00,
    graded_by          INT UNSIGNED NULL,
    answered_at        DATETIME NOT NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_attempt_answer (attempt_id, question_id),
    KEY idx_answer_question (question_id),
    CONSTRAINT fk_answer_attempt FOREIGN KEY (attempt_id) REFERENCES exam_attempts (id) ON DELETE CASCADE,
    CONSTRAINT fk_answer_question FOREIGN KEY (question_id) REFERENCES questions (id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- Admin default  (password: Admin@123)
-- ---------------------------------------------------------------------
INSERT INTO users (name, username, email, password, role, department, position, status)
VALUES ('Administrator', 'admin', 'admin@example.com',
        '$2y$10$qDH56mXF88o2Mmpw9XdtwO.tttuG8NhxxPdZHhBXsZVkGA0P7rVui',
        'admin', 'IT', 'System Administrator', 'active');
