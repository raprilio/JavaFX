-- =====================================================================
--  SmartNotes — MySQL schema
--  Compatible with MySQL 5.7+ / 8.x and MariaDB 10.3+
--  Engine: InnoDB, charset utf8mb4
--  Import via phpMyAdmin (Import tab) or let /install run it for you.
-- =====================================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- ---------------------------------------------------------------------
-- Users & authentication
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `users` (
  `id`              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `email`           VARCHAR(190) NOT NULL,
  `password_hash`   VARCHAR(255) NOT NULL,
  `name`            VARCHAR(120) NOT NULL,
  `role`            ENUM('admin','user') NOT NULL DEFAULT 'user',
  `permissions`     TEXT NULL COMMENT 'JSON array of extra permissions granted to a user',
  `status`          ENUM('active','suspended') NOT NULL DEFAULT 'active',
  `last_login_at`   DATETIME NULL,
  `last_login_ip`   VARCHAR(45) NULL,
  `must_change_password` TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'Set when an admin creates/resets the password',
  `session_version` INT UNSIGNED NOT NULL DEFAULT 1 COMMENT 'Incremented to sign the user out everywhere',
  `created_at`      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at`      DATETIME NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_users_email` (`email`),
  KEY `idx_users_role` (`role`),
  KEY `idx_users_status` (`status`, `deleted_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `user_profiles` (
  `user_id`     INT UNSIGNED NOT NULL,
  `avatar_path` VARCHAR(255) NULL,
  `job_title`   VARCHAR(120) NULL,
  `phone`       VARCHAR(40) NULL,
  `bio`         TEXT NULL,
  `created_at`  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`user_id`),
  CONSTRAINT `fk_profiles_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `user_settings` (
  `user_id`                INT UNSIGNED NOT NULL,
  `theme`                  ENUM('light','dark','system') NOT NULL DEFAULT 'system',
  `accent_color`           VARCHAR(9) NULL,
  `sidebar_style`          ENUM('expanded','collapsed') NOT NULL DEFAULT 'expanded',
  `background_image`       VARCHAR(255) NULL,
  `background_opacity`     TINYINT UNSIGNED NOT NULL DEFAULT 15,
  `compact_mode`           TINYINT(1) NOT NULL DEFAULT 0,
  `notes_view`             ENUM('grid','list') NOT NULL DEFAULT 'grid',
  `notify_task`            TINYINT(1) NOT NULL DEFAULT 1,
  `notify_meeting`         TINYINT(1) NOT NULL DEFAULT 1,
  `notify_schedule`        TINYINT(1) NOT NULL DEFAULT 1,
  `notify_daily_agenda`    TINYINT(1) NOT NULL DEFAULT 0,
  `notify_weekly_agenda`   TINYINT(1) NOT NULL DEFAULT 0,
  `popup_reminders`        TINYINT(1) NOT NULL DEFAULT 1,
  `email_notifications`    TINYINT(1) NOT NULL DEFAULT 1,
  `daily_agenda_time`      TIME NOT NULL DEFAULT '07:00:00',
  `default_reminder`       SMALLINT NULL DEFAULT 30 COMMENT 'minutes before',
  `last_daily_agenda_at`   DATE NULL,
  `last_weekly_agenda_at`  DATE NULL,
  `dashboard_hidden`       TEXT NULL COMMENT 'JSON list of hidden dashboard widgets',
  `dashboard_layout`       TEXT NULL COMMENT 'JSON [{k, w, h}] own dashboard layout (v1.21)',
  `updated_at`             DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`user_id`),
  CONSTRAINT `fk_usettings_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `password_resets` (
  `id`          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`     INT UNSIGNED NOT NULL,
  `token_hash`  CHAR(64) NOT NULL,
  `expires_at`  DATETIME NOT NULL,
  `used_at`     DATETIME NULL,
  `created_at`  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_reset_token` (`token_hash`),
  KEY `idx_reset_user` (`user_id`),
  CONSTRAINT `fk_reset_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `remember_tokens` (
  `id`              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`         INT UNSIGNED NOT NULL,
  `selector`        CHAR(24) NOT NULL,
  `validator_hash`  CHAR(64) NOT NULL,
  `user_agent`      VARCHAR(255) NULL,
  `ip_address`      VARCHAR(45) NULL,
  `expires_at`      DATETIME NOT NULL,
  `last_used_at`    DATETIME NULL,
  `created_at`      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_remember_selector` (`selector`),
  KEY `idx_remember_user` (`user_id`),
  CONSTRAINT `fk_remember_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `login_attempts` (
  `id`            BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `attempt_type`  ENUM('login','forgot') NOT NULL DEFAULT 'login',
  `email`         VARCHAR(190) NULL,
  `ip_address`    VARCHAR(45) NOT NULL,
  `success`       TINYINT(1) NOT NULL DEFAULT 0,
  `created_at`    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_attempt_ip` (`attempt_type`, `ip_address`, `created_at`),
  KEY `idx_attempt_email` (`attempt_type`, `email`, `created_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- Categories & tags
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `note_categories` (
  `id`          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`     INT UNSIGNED NOT NULL,
  `name`        VARCHAR(80) NOT NULL,
  `color`       VARCHAR(9) NOT NULL DEFAULT '#6366f1',
  `icon`        VARCHAR(40) NOT NULL DEFAULT 'folder',
  `sort_order`  INT NOT NULL DEFAULT 0,
  `created_at`  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_ncat_user_name` (`user_id`, `name`),
  CONSTRAINT `fk_ncat_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `task_categories` (
  `id`          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`     INT UNSIGNED NOT NULL,
  `name`        VARCHAR(80) NOT NULL,
  `color`       VARCHAR(9) NOT NULL DEFAULT '#6366f1',
  `icon`        VARCHAR(40) NOT NULL DEFAULT 'folder',
  `sort_order`  INT NOT NULL DEFAULT 0,
  `created_at`  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_tcat_user_name` (`user_id`, `name`),
  CONSTRAINT `fk_tcat_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `note_tags` (
  `id`          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`     INT UNSIGNED NOT NULL,
  `name`        VARCHAR(60) NOT NULL,
  `color`       VARCHAR(9) NULL,
  `created_at`  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_tag_user_name` (`user_id`, `name`),
  CONSTRAINT `fk_tag_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- Notes
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `notes` (
  `id`              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`         INT UNSIGNED NOT NULL,
  `category_id`     INT UNSIGNED NULL,
  `title`           VARCHAR(255) NOT NULL DEFAULT '',
  `content`         LONGTEXT NULL COMMENT 'Sanitized rich-text HTML',
  `content_text`    MEDIUMTEXT NULL COMMENT 'Plain text for search & previews',
  `note_type`       ENUM('text','checklist','image','audio','rich','mixed') NOT NULL DEFAULT 'text',
  `color`           VARCHAR(20) NULL,
  `background`      VARCHAR(40) NULL,
  `is_pinned`       TINYINT(1) NOT NULL DEFAULT 0,
  `pinned_global`   TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'Pinned by an admin for every user (v1.9)',
  `pinned_global_at` DATETIME NULL,
  `pinned_global_pos` INT NULL COMMENT 'Order of the notes pinned for everyone (v1.20)',
  `is_favorite`     TINYINT(1) NOT NULL DEFAULT 0,
  `is_archived`     TINYINT(1) NOT NULL DEFAULT 0,
  `is_locked`       TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'Requires the owner''s notes PIN to open',
  `checklist_total` SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  `checklist_done`  SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  `last_opened_at`  DATETIME NULL,
  `updated_by`      INT UNSIGNED NULL COMMENT 'Last editor (owner or a user the note is shared with)',
  `created_at`      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at`      DATETIME NULL,
  `purged_at`       DATETIME NULL COMMENT 'Deleted forever by the user: kept in the admin trash (v1.9)',
  `purged_by`       INT UNSIGNED NULL,
  PRIMARY KEY (`id`),
  KEY `idx_notes_list` (`user_id`, `deleted_at`, `is_archived`, `is_pinned`, `updated_at`),
  KEY `idx_notes_opened` (`user_id`, `last_opened_at`),
  KEY `idx_notes_created` (`user_id`, `created_at`),
  KEY `idx_notes_category` (`category_id`),
  CONSTRAINT `fk_notes_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_notes_category` FOREIGN KEY (`category_id`) REFERENCES `note_categories` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `note_tag_relations` (
  `note_id`  INT UNSIGNED NOT NULL,
  `tag_id`   INT UNSIGNED NOT NULL,
  PRIMARY KEY (`note_id`, `tag_id`),
  KEY `idx_ntr_tag` (`tag_id`),
  CONSTRAINT `fk_ntr_note` FOREIGN KEY (`note_id`) REFERENCES `notes` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_ntr_tag` FOREIGN KEY (`tag_id`) REFERENCES `note_tags` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- Tasks
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `meetings` (
  `id`                INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`           INT UNSIGNED NOT NULL,
  `note_id`           INT UNSIGNED NULL COMMENT 'Related note',
  `title`             VARCHAR(255) NOT NULL,
  `description`       TEXT NULL,
  `meeting_date`      DATE NOT NULL,
  `start_time`        TIME NOT NULL,
  `end_time`          TIME NOT NULL,
  `location`          VARCHAR(255) NULL,
  `meeting_url`       VARCHAR(500) NULL,
  `minutes`           LONGTEXT NULL COMMENT 'Meeting notes (sanitized HTML)',
  `minutes_text`      MEDIUMTEXT NULL,
  `status`            ENUM('scheduled','completed','cancelled') NOT NULL DEFAULT 'scheduled',
  `reminder_minutes`  SMALLINT NULL,
  `color`             VARCHAR(9) NULL,
  `share_all`         TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'Visible to every user',
  `created_at`        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at`        DATETIME NULL,
  PRIMARY KEY (`id`),
  KEY `idx_meet_user_date` (`user_id`, `deleted_at`, `meeting_date`, `start_time`),
  KEY `idx_meet_note` (`note_id`),
  CONSTRAINT `fk_meet_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_meet_note` FOREIGN KEY (`note_id`) REFERENCES `notes` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `meeting_participants` (
  `id`          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `meeting_id`  INT UNSIGNED NOT NULL,
  `name`        VARCHAR(120) NOT NULL,
  `email`       VARCHAR(190) NULL,
  `status`      ENUM('invited','accepted','declined','tentative') NOT NULL DEFAULT 'invited',
  `created_at`  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_mp_meeting` (`meeting_id`),
  CONSTRAINT `fk_mp_meeting` FOREIGN KEY (`meeting_id`) REFERENCES `meetings` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `meeting_shares` (
  `id`          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `meeting_id`  INT UNSIGNED NOT NULL,
  `owner_id`    INT UNSIGNED NOT NULL,
  `user_id`     INT UNSIGNED NOT NULL COMMENT 'Recipient (read-only access)',
  `created_at`  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_mshare` (`meeting_id`, `user_id`),
  KEY `idx_mshare_user` (`user_id`),
  CONSTRAINT `fk_mshare_meeting` FOREIGN KEY (`meeting_id`) REFERENCES `meetings` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_mshare_owner` FOREIGN KEY (`owner_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_mshare_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `tasks` (
  `id`                INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`           INT UNSIGNED NOT NULL COMMENT 'Owner = the person who does the task',
  `assigned_by`       INT UNSIGNED NULL COMMENT 'Admin who assigned it to user_id (v1.8)',
  `category_id`       INT UNSIGNED NULL,
  `note_id`           INT UNSIGNED NULL COMMENT 'Related note',
  `meeting_id`        INT UNSIGNED NULL COMMENT 'Related meeting',
  `title`             VARCHAR(255) NOT NULL,
  `description`       TEXT NULL,
  `due_date`          DATE NULL,
  `due_time`          TIME NULL,
  `priority`          ENUM('low','medium','high','urgent') NOT NULL DEFAULT 'medium',
  `status`            ENUM('todo','in_progress','completed','cancelled') NOT NULL DEFAULT 'todo',
  `reminder_minutes`  SMALLINT NULL,
  `sort_order`        INT NOT NULL DEFAULT 0,
  `completed_at`      DATETIME NULL,
  `created_at`        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at`        DATETIME NULL,
  PRIMARY KEY (`id`),
  KEY `idx_tasks_list` (`user_id`, `deleted_at`, `status`, `sort_order`),
  KEY `idx_tasks_due` (`user_id`, `due_date`),
  KEY `idx_tasks_category` (`category_id`),
  KEY `idx_tasks_note` (`note_id`),
  KEY `idx_tasks_meeting` (`meeting_id`),
  KEY `idx_tasks_assigned_by` (`assigned_by`, `deleted_at`),
  CONSTRAINT `fk_tasks_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_tasks_assigned_by` FOREIGN KEY (`assigned_by`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_tasks_category` FOREIGN KEY (`category_id`) REFERENCES `task_categories` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_tasks_note` FOREIGN KEY (`note_id`) REFERENCES `notes` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_tasks_meeting` FOREIGN KEY (`meeting_id`) REFERENCES `meetings` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- v1.19 team progress tracker
CREATE TABLE IF NOT EXISTS `progress_items` (
  `id`              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`         INT UNSIGNED NULL COMMENT 'Creator: manages title, stages, fields and who may update',
  `title`           VARCHAR(255) NOT NULL,
  `description`     TEXT NULL,
  `stages`          TEXT NULL COMMENT 'JSON [{name, percent}] from start to publish',
  `fields`          TEXT NULL COMMENT 'JSON [{label, value}] custom fields',
  `percent`         TINYINT UNSIGNED NOT NULL DEFAULT 0,
  `stage`           VARCHAR(80) NULL,
  `status`          ENUM('on_track','at_risk','blocked','done') NOT NULL DEFAULT 'on_track',
  `priority`        ENUM('low','medium','high','urgent') NOT NULL DEFAULT 'medium',
  `color`           VARCHAR(9) NULL,
  `start_date`      DATE NULL,
  `due_date`        DATE NULL,
  `published_at`    DATETIME NULL COMMENT 'When it reached 100%',
  `last_update_at`  DATETIME NULL,
  `created_at`      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at`      DATETIME NULL,
  `pinned_global`   TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'Pinned by an admin for everyone (v1.20)',
  `pinned_global_at` DATETIME NULL,
  `pinned_global_by` INT UNSIGNED NULL,
  `pinned_global_pos` INT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_progress_list` (`deleted_at`, `updated_at`),
  KEY `fk_progress_user` (`user_id`),
  KEY `fk_progress_pinned_by` (`pinned_global_by`),
  CONSTRAINT `fk_progress_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_progress_pinned_by` FOREIGN KEY (`pinned_global_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- v1.20 pins & own order: my pinned notes' order, Team progress I pinned, my order of Team progress
CREATE TABLE IF NOT EXISTS `user_pins` (
  `user_id`     INT UNSIGNED NOT NULL,
  `kind`        VARCHAR(20) NOT NULL COMMENT 'note = order of my pinned notes, progress = Team progress I pinned, progress_order = my own order of Team progress',
  `item_id`     INT UNSIGNED NOT NULL,
  `position`    INT NOT NULL DEFAULT 0,
  `created_at`  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`user_id`, `kind`, `item_id`),
  KEY `idx_user_pins_item` (`kind`, `item_id`),
  CONSTRAINT `fk_user_pins_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- v1.22 progress tasks (management or personal): a task split into parts, each filled by its own person
CREATE TABLE IF NOT EXISTS `ptasks` (
  `id`            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`       INT UNSIGNED NOT NULL COMMENT 'Owner: manages the parts and approves submissions',
  `title`         VARCHAR(255) NOT NULL,
  `description`   TEXT NULL,
  `color`         VARCHAR(9) NULL,
  `due_date`      DATE NULL,
  `percent`       TINYINT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Weighted average of the parts',
  `status`        ENUM('open','done') NOT NULL DEFAULT 'open',
  `completed_at`  DATETIME NULL,
  `created_at`    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at`    DATETIME NULL,
  PRIMARY KEY (`id`),
  KEY `idx_ptasks_user` (`user_id`, `deleted_at`),
  CONSTRAINT `fk_ptasks_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `ptask_parts` (
  `id`                INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `ptask_id`          INT UNSIGNED NOT NULL,
  `assignee_id`       INT UNSIGNED NULL COMMENT 'The only person who fills this bar',
  `title`             VARCHAR(255) NOT NULL,
  `weight`            TINYINT UNSIGNED NOT NULL DEFAULT 1,
  `percent`           TINYINT UNSIGNED NOT NULL DEFAULT 0,
  `needs_submission`  TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'Must be handed in (setor) and approved',
  `submission`        ENUM('none','submitted','approved','rejected') NOT NULL DEFAULT 'none',
  `due_date`          DATE NULL,
  `position`          INT NOT NULL DEFAULT 0,
  `done_at`           DATETIME NULL,
  `created_at`        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_ptask_parts_task` (`ptask_id`, `position`),
  KEY `idx_ptask_parts_user` (`assignee_id`),
  CONSTRAINT `fk_ptask_parts_task` FOREIGN KEY (`ptask_id`) REFERENCES `ptasks` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_ptask_parts_user` FOREIGN KEY (`assignee_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `ptask_updates` (
  `id`            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `ptask_id`      INT UNSIGNED NOT NULL,
  `part_id`       INT UNSIGNED NULL,
  `user_id`       INT UNSIGNED NULL,
  `kind`          ENUM('progress','submit','approve','reject') NOT NULL DEFAULT 'progress',
  `percent_from`  TINYINT UNSIGNED NULL,
  `percent`       TINYINT UNSIGNED NULL,
  `message`       TEXT NULL,
  `files`         TEXT NULL COMMENT 'JSON list of handed-in file ids',
  `notes`         TEXT NULL COMMENT 'JSON list of handed-in note ids',
  `created_at`    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_ptask_updates_task` (`ptask_id`, `created_at`),
  KEY `fk_ptask_updates_part` (`part_id`),
  KEY `fk_ptask_updates_user` (`user_id`),
  CONSTRAINT `fk_ptask_updates_task` FOREIGN KEY (`ptask_id`) REFERENCES `ptasks` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_ptask_updates_part` FOREIGN KEY (`part_id`) REFERENCES `ptask_parts` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_ptask_updates_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- v1.22 notes listed on Team progress items, meetings and progress tasks (opened read-only by everyone there)
CREATE TABLE IF NOT EXISTS `item_notes` (
  `item_type`   VARCHAR(20) NOT NULL COMMENT 'progress, meeting or ptask',
  `item_id`     INT UNSIGNED NOT NULL,
  `note_id`     INT UNSIGNED NOT NULL,
  `added_by`    INT UNSIGNED NULL,
  `created_at`  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`item_type`, `item_id`, `note_id`),
  KEY `idx_item_notes_note` (`note_id`),
  KEY `fk_item_notes_by` (`added_by`),
  CONSTRAINT `fk_item_notes_note` FOREIGN KEY (`note_id`) REFERENCES `notes` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_item_notes_by` FOREIGN KEY (`added_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `note_pin_targets` (
  `note_id`     INT UNSIGNED NOT NULL,
  `user_id`     INT UNSIGNED NOT NULL COMMENT 'Sees the note pinned at the top, read-only',
  `pinned_by`   INT UNSIGNED NULL,
  `position`    INT NULL COMMENT 'Order the person arranged by dragging',
  `created_at`  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`note_id`, `user_id`),
  KEY `idx_note_pin_targets_user` (`user_id`),
  KEY `fk_note_pin_targets_by` (`pinned_by`),
  CONSTRAINT `fk_note_pin_targets_note` FOREIGN KEY (`note_id`) REFERENCES `notes` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_note_pin_targets_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_note_pin_targets_by` FOREIGN KEY (`pinned_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `progress_updaters` (
  `item_id`     INT UNSIGNED NOT NULL,
  `user_id`     INT UNSIGNED NOT NULL COMMENT 'Allowed to post progress updates',
  `created_at`  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`item_id`, `user_id`),
  KEY `idx_progress_updaters_user` (`user_id`),
  CONSTRAINT `fk_progress_updaters_item` FOREIGN KEY (`item_id`) REFERENCES `progress_items` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_progress_updaters_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `item_pin_targets` (
  `item_type`   VARCHAR(20) NOT NULL COMMENT 'flowchart',
  `item_id`     INT UNSIGNED NOT NULL,
  `user_id`     INT UNSIGNED NOT NULL COMMENT 'Sees the item pinned at the top, read-only',
  `pinned_by`   INT UNSIGNED NULL,
  `created_at`  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`item_type`, `item_id`, `user_id`),
  KEY `idx_item_pin_targets_user` (`user_id`, `item_type`),
  KEY `fk_item_pin_targets_by` (`pinned_by`),
  CONSTRAINT `fk_item_pin_targets_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_item_pin_targets_by` FOREIGN KEY (`pinned_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `progress_parts` (
  `id`              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `item_id`         INT UNSIGNED NOT NULL,
  `title`           VARCHAR(120) NOT NULL,
  `weight`          TINYINT UNSIGNED NOT NULL DEFAULT 1 COMMENT 'Share of the item percentage, 1 to 5',
  `percent`         TINYINT UNSIGNED NOT NULL DEFAULT 0,
  `stage`           VARCHAR(80) NULL,
  `status`          ENUM('on_track','at_risk','blocked','done') NOT NULL DEFAULT 'on_track',
  `position`        INT NOT NULL DEFAULT 0,
  `last_update_at`  DATETIME NULL,
  `done_at`         DATETIME NULL,
  `created_at`      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_progress_parts_item` (`item_id`, `position`),
  CONSTRAINT `fk_progress_parts_item` FOREIGN KEY (`item_id`) REFERENCES `progress_items` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `progress_part_people` (
  `part_id`     INT UNSIGNED NOT NULL,
  `user_id`     INT UNSIGNED NOT NULL COMMENT 'Works on this part and posts its updates',
  PRIMARY KEY (`part_id`, `user_id`),
  KEY `idx_progress_part_people_user` (`user_id`),
  CONSTRAINT `fk_progress_part_people_part` FOREIGN KEY (`part_id`) REFERENCES `progress_parts` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_progress_part_people_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `progress_updates` (
  `id`            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `item_id`       INT UNSIGNED NOT NULL,
  `user_id`       INT UNSIGNED NULL,
  `percent_from`  TINYINT UNSIGNED NOT NULL DEFAULT 0,
  `percent`       TINYINT UNSIGNED NOT NULL,
  `stage`         VARCHAR(80) NULL,
  `status`        ENUM('on_track','at_risk','blocked','done') NOT NULL DEFAULT 'on_track',
  `reason`        TEXT NOT NULL,
  `created_at`    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `part_id`       INT UNSIGNED NULL COMMENT 'The part this update is for (v1.25)',
  `part_title`    VARCHAR(120) NULL,
  `item_percent`  TINYINT UNSIGNED NULL COMMENT 'Item percentage after this update',
  PRIMARY KEY (`id`),
  KEY `idx_progress_updates_item` (`item_id`, `created_at`),
  KEY `fk_progress_updates_user` (`user_id`),
  KEY `fk_progress_updates_part` (`part_id`),
  CONSTRAINT `fk_progress_updates_item` FOREIGN KEY (`item_id`) REFERENCES `progress_items` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_progress_updates_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_progress_updates_part` FOREIGN KEY (`part_id`) REFERENCES `progress_parts` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Personal IMAP/SMTP mailboxes (Gmail with an App Password, etc.), one user each (v1.8)
CREATE TABLE IF NOT EXISTS `mail_accounts` (
  `id`            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`       INT UNSIGNED NOT NULL,
  `provider`      VARCHAR(20) NOT NULL DEFAULT 'custom',
  `label`         VARCHAR(80) NOT NULL,
  `email`         VARCHAR(190) NOT NULL,
  `display_name`  VARCHAR(120) NULL,
  `imap_host`     VARCHAR(190) NOT NULL,
  `imap_port`     SMALLINT UNSIGNED NOT NULL DEFAULT 993,
  `imap_security` ENUM('ssl','tls','none') NOT NULL DEFAULT 'ssl',
  `smtp_host`     VARCHAR(190) NULL,
  `smtp_port`     SMALLINT UNSIGNED NULL,
  `smtp_security` ENUM('ssl','tls','none') NULL,
  `username`      VARCHAR(190) NOT NULL,
  `password_enc`  TEXT NOT NULL COMMENT 'Encrypted with the APP key',
  `last_error`    VARCHAR(255) NULL,
  `created_at`    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_mail_account` (`user_id`, `email`),
  CONSTRAINT `fk_mail_accounts_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- v1.10: company (Hostinger) mailboxes an administrator gives to a user
CREATE TABLE IF NOT EXISTS `mailbox_assignments` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `mailbox_id` VARCHAR(64) NOT NULL COMMENT 'Hostinger mailbox resource id (AC…)',
  `address` VARCHAR(190) NOT NULL,
  `user_id` INT UNSIGNED NOT NULL,
  `assigned_by` INT UNSIGNED NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_mailbox_user` (`mailbox_id`, `user_id`),
  KEY `idx_mailbox_assign_user` (`user_id`),
  KEY `fk_mailbox_assign_by` (`assigned_by`),
  CONSTRAINT `fk_mailbox_assign_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_mailbox_assign_by` FOREIGN KEY (`assigned_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `task_tag_relations` (
  `task_id`  INT UNSIGNED NOT NULL,
  `tag_id`   INT UNSIGNED NOT NULL,
  PRIMARY KEY (`task_id`, `tag_id`),
  KEY `idx_ttr_tag` (`tag_id`),
  CONSTRAINT `fk_ttr_task` FOREIGN KEY (`task_id`) REFERENCES `tasks` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_ttr_tag` FOREIGN KEY (`tag_id`) REFERENCES `note_tags` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- Calendar
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `calendar_events` (
  `id`                INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`           INT UNSIGNED NOT NULL,
  `note_id`           INT UNSIGNED NULL,
  `task_id`           INT UNSIGNED NULL,
  `event_type`        ENUM('event','schedule','reminder') NOT NULL DEFAULT 'event',
  `title`             VARCHAR(255) NOT NULL,
  `description`       TEXT NULL,
  `start_at`          DATETIME NOT NULL,
  `end_at`            DATETIME NOT NULL,
  `all_day`           TINYINT(1) NOT NULL DEFAULT 0,
  `location`          VARCHAR(255) NULL,
  `meeting_url`       VARCHAR(500) NULL,
  `color`             VARCHAR(9) NULL,
  `repeat_rule`       ENUM('none','daily','weekly','monthly','yearly') NOT NULL DEFAULT 'none',
  `repeat_until`      DATE NULL,
  `reminder_minutes`  SMALLINT NULL,
  `status`            ENUM('scheduled','completed','cancelled') NOT NULL DEFAULT 'scheduled',
  `created_at`        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `share_all`         TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'Admin event for every user (v1.9)',
  `deleted_at`        DATETIME NULL,
  PRIMARY KEY (`id`),
  KEY `idx_events_range` (`user_id`, `deleted_at`, `start_at`, `end_at`),
  KEY `idx_events_repeat` (`user_id`, `repeat_rule`),
  KEY `idx_events_note` (`note_id`),
  KEY `idx_events_task` (`task_id`),
  CONSTRAINT `fk_events_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_events_note` FOREIGN KEY (`note_id`) REFERENCES `notes` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_events_task` FOREIGN KEY (`task_id`) REFERENCES `tasks` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `event_participants` (
  `id`          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `event_id`    INT UNSIGNED NOT NULL,
  `name`        VARCHAR(120) NOT NULL,
  `email`       VARCHAR(190) NULL,
  `created_at`  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_ep_event` (`event_id`),
  CONSTRAINT `fk_ep_event` FOREIGN KEY (`event_id`) REFERENCES `calendar_events` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- Files (images, documents, archives) & audio
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `drive_folders` (
  `id`          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`     INT UNSIGNED NOT NULL,
  `parent_id`   INT UNSIGNED NULL,
  `name`        VARCHAR(120) NOT NULL,
  `color`       VARCHAR(9) NULL,
  `created_at`  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_df_user_parent` (`user_id`, `parent_id`),
  KEY `idx_df_parent` (`parent_id`),
  CONSTRAINT `fk_df_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_df_parent` FOREIGN KEY (`parent_id`) REFERENCES `drive_folders` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- v1.14: Drive folders linked to notes
CREATE TABLE IF NOT EXISTS `note_folders` (
  `note_id`     INT UNSIGNED NOT NULL,
  `folder_id`   INT UNSIGNED NOT NULL,
  `user_id`     INT UNSIGNED NOT NULL COMMENT 'Who linked it (the note owner)',
  `created_at`  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`note_id`, `folder_id`),
  KEY `idx_note_folders_folder` (`folder_id`),
  KEY `fk_note_folders_user` (`user_id`),
  CONSTRAINT `fk_note_folders_note` FOREIGN KEY (`note_id`) REFERENCES `notes` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_note_folders_folder` FOREIGN KEY (`folder_id`) REFERENCES `drive_folders` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_note_folders_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `note_mentions` (
  `note_id`       INT UNSIGNED NOT NULL,
  `user_id`       INT UNSIGNED NOT NULL COMMENT 'Mentioned user (@name in the note text)',
  `mentioned_by`  INT UNSIGNED NULL COMMENT 'Who added the first mention',
  `created_at`    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`note_id`, `user_id`),
  KEY `idx_note_mentions_user` (`user_id`),
  KEY `fk_note_mentions_by` (`mentioned_by`),
  CONSTRAINT `fk_note_mentions_note` FOREIGN KEY (`note_id`) REFERENCES `notes` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_note_mentions_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_note_mentions_by` FOREIGN KEY (`mentioned_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `note_attachments` (
  `id`             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`        INT UNSIGNED NOT NULL,
  `note_id`        INT UNSIGNED NULL,
  `task_id`        INT UNSIGNED NULL,
  `meeting_id`     INT UNSIGNED NULL,
  `ptask_id`       INT UNSIGNED NULL COMMENT 'Handed in for a progress task (v1.22)',
  `folder_id`      INT UNSIGNED NULL COMMENT 'Drive folder',
  `file_name`      VARCHAR(120) NOT NULL COMMENT 'Stored (random) file name',
  `original_name`  VARCHAR(255) NOT NULL,
  `file_path`      VARCHAR(255) NOT NULL COMMENT 'Relative to uploads/',
  `thumb_path`     VARCHAR(255) NULL,
  `mime_type`      VARCHAR(120) NOT NULL,
  `file_kind`      ENUM('image','audio','video','document','archive','other') NOT NULL DEFAULT 'other',
  `file_size`      BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `file_hash`      CHAR(64) NULL,
  `width`          INT UNSIGNED NULL,
  `height`         INT UNSIGNED NULL,
  `description`    TEXT NULL,
  `is_starred`     TINYINT(1) NOT NULL DEFAULT 0,
  `last_opened_at` DATETIME NULL,
  `created_at`     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT 'uploaded_at',
  `updated_at`     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at`     DATETIME NULL,
  PRIMARY KEY (`id`),
  KEY `idx_att_user` (`user_id`, `deleted_at`, `file_kind`, `created_at`),
  KEY `idx_att_note` (`note_id`),
  KEY `idx_att_task` (`task_id`),
  KEY `idx_att_meeting` (`meeting_id`),
  KEY `idx_att_ptask` (`ptask_id`),
  KEY `idx_att_hash` (`user_id`, `file_hash`),
  KEY `idx_att_folder` (`folder_id`),
  CONSTRAINT `fk_att_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_att_note` FOREIGN KEY (`note_id`) REFERENCES `notes` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_att_task` FOREIGN KEY (`task_id`) REFERENCES `tasks` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_att_meeting` FOREIGN KEY (`meeting_id`) REFERENCES `meetings` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_att_folder` FOREIGN KEY (`folder_id`) REFERENCES `drive_folders` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `file_tag_relations` (
  `file_id`  INT UNSIGNED NOT NULL,
  `tag_id`   INT UNSIGNED NOT NULL,
  PRIMARY KEY (`file_id`, `tag_id`),
  KEY `idx_ftr_tag` (`tag_id`),
  CONSTRAINT `fk_ftr_file` FOREIGN KEY (`file_id`) REFERENCES `note_attachments` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_ftr_tag` FOREIGN KEY (`tag_id`) REFERENCES `note_tags` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `note_shares` (
  `id`              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `note_id`         INT UNSIGNED NOT NULL,
  `owner_id`        INT UNSIGNED NOT NULL,
  `user_id`         INT UNSIGNED NOT NULL COMMENT 'Recipient',
  `permission`      ENUM('view','edit') NOT NULL DEFAULT 'view',
  `is_pinned`       TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'Pinned by the recipient',
  `last_opened_at`  DATETIME NULL,
  `created_at`      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_share_note_user` (`note_id`, `user_id`),
  KEY `idx_share_user` (`user_id`, `is_pinned`),
  KEY `idx_share_owner` (`owner_id`),
  CONSTRAINT `fk_share_note` FOREIGN KEY (`note_id`) REFERENCES `notes` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_share_owner` FOREIGN KEY (`owner_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_share_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `item_shares` (
  `id`          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `item_type`   VARCHAR(20) NOT NULL COMMENT 'audio | mindmap | flowchart | file | folder | event',
  `item_id`     INT UNSIGNED NOT NULL,
  `owner_id`    INT UNSIGNED NOT NULL,
  `user_id`     INT UNSIGNED NOT NULL COMMENT 'Recipient / tagged user',
  `permission`  ENUM('view','edit') NOT NULL DEFAULT 'view',
  `created_at`  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_item_share` (`item_type`, `item_id`, `user_id`),
  KEY `idx_item_share_user` (`user_id`, `item_type`),
  CONSTRAINT `fk_ishare_owner` FOREIGN KEY (`owner_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_ishare_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `note_drawings` (
  `id`            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`       INT UNSIGNED NOT NULL,
  `note_id`       INT UNSIGNED NOT NULL,
  `data_path`     VARCHAR(255) NOT NULL COMMENT 'Vector strokes (JSON file under uploads/)',
  `png_path`      VARCHAR(255) NOT NULL COMMENT 'Rendered PNG under uploads/',
  `width`         SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  `height`        INT UNSIGNED NOT NULL DEFAULT 0,
  `pages`         SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  `stroke_count`  INT UNSIGNED NOT NULL DEFAULT 0,
  `file_size`     INT UNSIGNED NOT NULL DEFAULT 0,
  `version`       INT UNSIGNED NOT NULL DEFAULT 1,
  `created_at`    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at`    DATETIME NULL COMMENT 'Set when the drawing is removed from the note text (purged after 7 days)',
  PRIMARY KEY (`id`),
  KEY `idx_draw_note` (`note_id`, `deleted_at`),
  KEY `idx_draw_user` (`user_id`),
  CONSTRAINT `fk_draw_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_draw_note` FOREIGN KEY (`note_id`) REFERENCES `notes` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `note_pins` (
  `user_id`          INT UNSIGNED NOT NULL,
  `pin_hash`         VARCHAR(255) NOT NULL COMMENT 'password_hash() of the notes PIN',
  `failed_attempts`  SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  `locked_until`     DATETIME NULL COMMENT 'Throttle after too many wrong PINs',
  `updated_at`       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`user_id`),
  CONSTRAINT `fk_npin_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `audio_notes` (
  `id`          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`     INT UNSIGNED NOT NULL,
  `note_id`     INT UNSIGNED NULL,
  `title`       VARCHAR(255) NOT NULL,
  `file_path`   VARCHAR(255) NOT NULL,
  `file_name`   VARCHAR(120) NOT NULL,
  `mime_type`   VARCHAR(120) NOT NULL,
  `file_size`   BIGINT UNSIGNED NOT NULL DEFAULT 0,
  `duration`    DECIMAL(10,2) NOT NULL DEFAULT 0 COMMENT 'seconds',
  `waveform`    TEXT NULL COMMENT 'JSON array of peaks 0..1',
  `created_at`  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at`  DATETIME NULL,
  PRIMARY KEY (`id`),
  KEY `idx_audio_user` (`user_id`, `deleted_at`, `created_at`),
  KEY `idx_audio_note` (`note_id`),
  CONSTRAINT `fk_audio_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_audio_note` FOREIGN KEY (`note_id`) REFERENCES `notes` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- Mind maps
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `mindmaps` (
  `id`              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`         INT UNSIGNED NOT NULL,
  `title`           VARCHAR(255) NOT NULL,
  `description`     TEXT NULL,
  `viewport`        VARCHAR(120) NULL COMMENT 'JSON {x,y,zoom}',
  `theme`           VARCHAR(500) NULL COMMENT 'JSON look: preset, branches, layout, background, font (v1.16)',
  `last_opened_at`  DATETIME NULL,
  `updated_by`      INT UNSIGNED NULL COMMENT 'Last editor (owner or a user it is shared with)',
  `revision`        INT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Incremented on every save (conflict detection)',
  `created_at`      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at`      DATETIME NULL,
  `pinned_global`   TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'Pinned for everyone (v1.27)',
  `pinned_global_at` DATETIME NULL,
  `pinned_global_by` INT UNSIGNED NULL,
  PRIMARY KEY (`id`),
  KEY `idx_mm_user` (`user_id`, `deleted_at`, `updated_at`),
  CONSTRAINT `fk_mm_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `mindmap_nodes` (
  `id`          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `mindmap_id`  INT UNSIGNED NOT NULL,
  `node_key`    VARCHAR(40) NOT NULL COMMENT 'Stable client-side id',
  `parent_id`   INT UNSIGNED NULL,
  `label`       VARCHAR(500) NOT NULL DEFAULT '',
  `position_x`  DECIMAL(10,2) NOT NULL DEFAULT 0,
  `position_y`  DECIMAL(10,2) NOT NULL DEFAULT 0,
  `width`       DECIMAL(10,2) NULL,
  `height`      DECIMAL(10,2) NULL,
  `color`       VARCHAR(9) NULL,
  `icon`        VARCHAR(40) NULL,
  `style`       VARCHAR(255) NULL COMMENT 'JSON: shape, emoji, size, bold (v1.16)',
  `notes`       TEXT NULL,
  `collapsed`   TINYINT(1) NOT NULL DEFAULT 0,
  `sort_order`  INT NOT NULL DEFAULT 0,
  `created_at`  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_mmn_key` (`mindmap_id`, `node_key`),
  KEY `idx_mmn_parent` (`parent_id`),
  CONSTRAINT `fk_mmn_map` FOREIGN KEY (`mindmap_id`) REFERENCES `mindmaps` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_mmn_parent` FOREIGN KEY (`parent_id`) REFERENCES `mindmap_nodes` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `mindmap_edges` (
  `id`              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `mindmap_id`      INT UNSIGNED NOT NULL,
  `source_node_id`  INT UNSIGNED NOT NULL,
  `target_node_id`  INT UNSIGNED NOT NULL,
  `edge_type`       ENUM('tree','link') NOT NULL DEFAULT 'tree',
  `label`           VARCHAR(255) NULL,
  `created_at`      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_mme_map` (`mindmap_id`),
  KEY `idx_mme_source` (`source_node_id`),
  KEY `idx_mme_target` (`target_node_id`),
  CONSTRAINT `fk_mme_map` FOREIGN KEY (`mindmap_id`) REFERENCES `mindmaps` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_mme_source` FOREIGN KEY (`source_node_id`) REFERENCES `mindmap_nodes` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_mme_target` FOREIGN KEY (`target_node_id`) REFERENCES `mindmap_nodes` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- Flowcharts
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `flowcharts` (
  `id`              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`         INT UNSIGNED NOT NULL,
  `title`           VARCHAR(255) NOT NULL,
  `description`     TEXT NULL,
  `viewport`        VARCHAR(120) NULL COMMENT 'JSON {x,y,zoom}',
  `settings_json`   TEXT NULL COMMENT 'JSON {grid,snap}',
  `last_opened_at`  DATETIME NULL,
  `updated_by`      INT UNSIGNED NULL COMMENT 'Last editor (owner or a user it is shared with)',
  `revision`        INT UNSIGNED NOT NULL DEFAULT 0 COMMENT 'Incremented on every save (conflict detection)',
  `created_at`      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`      DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at`      DATETIME NULL,
  `pinned_global`   TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'Pinned by an admin for everyone (v1.26)',
  `pinned_global_at` DATETIME NULL,
  `pinned_global_by` INT UNSIGNED NULL,
  PRIMARY KEY (`id`),
  KEY `idx_fc_user` (`user_id`, `deleted_at`, `updated_at`),
  CONSTRAINT `fk_fc_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `flowchart_nodes` (
  `id`                  INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `flowchart_id`        INT UNSIGNED NOT NULL,
  `node_key`            VARCHAR(40) NOT NULL,
  `node_type`           VARCHAR(30) NOT NULL DEFAULT 'process' COMMENT 'start, end, process, decision, …, server, router, switch, firewall, pc, …',
  `label`               VARCHAR(500) NOT NULL DEFAULT '',
  `position_x`          DECIMAL(10,2) NOT NULL DEFAULT 0,
  `position_y`          DECIMAL(10,2) NOT NULL DEFAULT 0,
  `width`               DECIMAL(10,2) NOT NULL DEFAULT 140,
  `height`              DECIMAL(10,2) NOT NULL DEFAULT 64,
  `sort_order`          INT NOT NULL DEFAULT 0 COMMENT 'Drawing order (v1.11)',
  `configuration_json`  TEXT NULL COMMENT 'JSON {fill,stroke,textColor}',
  `created_at`          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_fcn_key` (`flowchart_id`, `node_key`),
  CONSTRAINT `fk_fcn_chart` FOREIGN KEY (`flowchart_id`) REFERENCES `flowcharts` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `flowchart_edges` (
  `id`                  INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `flowchart_id`        INT UNSIGNED NOT NULL,
  `edge_key`            VARCHAR(40) NOT NULL,
  `source_node_id`      INT UNSIGNED NOT NULL,
  `target_node_id`      INT UNSIGNED NOT NULL,
  `source_port`         ENUM('top','right','bottom','left') NOT NULL DEFAULT 'bottom',
  `target_port`         ENUM('top','right','bottom','left') NOT NULL DEFAULT 'top',
  `label`               VARCHAR(255) NULL,
  `configuration_json`  TEXT NULL,
  `created_at`          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_fce_key` (`flowchart_id`, `edge_key`),
  KEY `idx_fce_source` (`source_node_id`),
  KEY `idx_fce_target` (`target_node_id`),
  CONSTRAINT `fk_fce_chart` FOREIGN KEY (`flowchart_id`) REFERENCES `flowcharts` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_fce_source` FOREIGN KEY (`source_node_id`) REFERENCES `flowchart_nodes` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_fce_target` FOREIGN KEY (`target_node_id`) REFERENCES `flowchart_nodes` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- Reminders, e-mail, notifications
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `reminders` (
  `id`               INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`          INT UNSIGNED NOT NULL,
  `remindable_type`  ENUM('task','event','meeting') NOT NULL,
  `remindable_id`    INT UNSIGNED NOT NULL,
  `occurrence_at`    DATETIME NOT NULL COMMENT 'When the task/event/meeting happens',
  `remind_at`        DATETIME NOT NULL COMMENT 'When the reminder fires',
  `minutes_before`   SMALLINT NOT NULL DEFAULT 0,
  `status`           ENUM('pending','sent','failed','cancelled') NOT NULL DEFAULT 'pending',
  `sent_at`          DATETIME NULL,
  `created_at`       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_reminder_occ` (`remindable_type`, `remindable_id`, `occurrence_at`),
  KEY `idx_rem_due` (`status`, `remind_at`),
  KEY `idx_rem_user` (`user_id`),
  CONSTRAINT `fk_rem_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `email_notifications` (
  `id`                 INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`            INT UNSIGNED NULL,
  `reminder_id`        INT UNSIGNED NULL,
  `event_id`           INT UNSIGNED NULL,
  `task_id`            INT UNSIGNED NULL,
  `meeting_id`         INT UNSIGNED NULL,
  `notification_type`  ENUM('task','meeting','schedule','daily_agenda','weekly_agenda','password_reset','test','system') NOT NULL,
  `recipient_email`    VARCHAR(190) NOT NULL,
  `subject`            VARCHAR(255) NOT NULL,
  `message`            MEDIUMTEXT NOT NULL,
  `scheduled_at`       DATETIME NOT NULL,
  `sent_at`            DATETIME NULL,
  `status`             ENUM('pending','sent','failed','cancelled') NOT NULL DEFAULT 'pending',
  `attempts`           TINYINT UNSIGNED NOT NULL DEFAULT 0,
  `error_message`      TEXT NULL,
  `created_at`         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at`         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_en_queue` (`status`, `scheduled_at`),
  KEY `idx_en_user` (`user_id`, `created_at`),
  KEY `idx_en_reminder` (`reminder_id`),
  CONSTRAINT `fk_en_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_en_reminder` FOREIGN KEY (`reminder_id`) REFERENCES `reminders` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_en_event` FOREIGN KEY (`event_id`) REFERENCES `calendar_events` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_en_task` FOREIGN KEY (`task_id`) REFERENCES `tasks` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_en_meeting` FOREIGN KEY (`meeting_id`) REFERENCES `meetings` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `email_logs` (
  `id`                     BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `email_notification_id`  INT UNSIGNED NULL,
  `recipient_email`        VARCHAR(190) NOT NULL,
  `subject`                VARCHAR(255) NOT NULL,
  `status`                 ENUM('sent','failed') NOT NULL,
  `error_message`          TEXT NULL,
  `created_at`             DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_el_created` (`created_at`),
  KEY `idx_el_notification` (`email_notification_id`),
  CONSTRAINT `fk_el_notification` FOREIGN KEY (`email_notification_id`) REFERENCES `email_notifications` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `announcements` (
  `id`          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `created_by`  INT UNSIGNED NULL,
  `title`       VARCHAR(160) NOT NULL,
  `body`        TEXT NULL,
  `level`       ENUM('info','important') NOT NULL DEFAULT 'info',
  `audience`    ENUM('all','users') NOT NULL DEFAULT 'all',
  `starts_at`   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `ends_at`     DATETIME NULL,
  `created_at`  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `deleted_at`  DATETIME NULL,
  PRIMARY KEY (`id`),
  KEY `idx_announcements_active` (`deleted_at`, `starts_at`),
  CONSTRAINT `fk_announcements_user` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `announcement_targets` (
  `announcement_id` INT UNSIGNED NOT NULL,
  `user_id`         INT UNSIGNED NOT NULL,
  PRIMARY KEY (`announcement_id`, `user_id`),
  KEY `idx_ann_targets_user` (`user_id`),
  CONSTRAINT `fk_ann_targets_ann` FOREIGN KEY (`announcement_id`) REFERENCES `announcements` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_ann_targets_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `announcement_reads` (
  `announcement_id` INT UNSIGNED NOT NULL,
  `user_id`         INT UNSIGNED NOT NULL,
  `read_at`         DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`announcement_id`, `user_id`),
  KEY `idx_ann_reads_user` (`user_id`),
  CONSTRAINT `fk_ann_reads_ann` FOREIGN KEY (`announcement_id`) REFERENCES `announcements` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_ann_reads_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `notifications` (
  `id`          BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`     INT UNSIGNED NOT NULL,
  `type`        VARCHAR(40) NOT NULL,
  `title`       VARCHAR(255) NOT NULL,
  `message`     TEXT NULL,
  `link`        VARCHAR(255) NULL,
  `is_read`     TINYINT(1) NOT NULL DEFAULT 0,
  `read_at`     DATETIME NULL,
  `popped_at`   DATETIME NULL COMMENT 'Reminder pop-up closed (v1.9)',
  `created_at`  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_notif_user` (`user_id`, `is_read`, `created_at`),
  CONSTRAINT `fk_notif_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------
-- System
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `settings` (
  `setting_key`    VARCHAR(80) NOT NULL,
  `setting_value`  MEDIUMTEXT NULL,
  `updated_at`     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`setting_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `activity_logs` (
  `id`           BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id`      INT UNSIGNED NULL,
  `action`       VARCHAR(60) NOT NULL,
  `entity_type`  VARCHAR(40) NULL,
  `entity_id`    INT UNSIGNED NULL,
  `description`  VARCHAR(500) NULL,
  `ip_address`   VARCHAR(45) NULL,
  `user_agent`   VARCHAR(255) NULL,
  `created_at`   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_act_created` (`created_at`),
  KEY `idx_act_user` (`user_id`, `created_at`),
  CONSTRAINT `fk_act_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;

-- ---------------------------------------------------------------------
-- Default application settings
-- ---------------------------------------------------------------------
INSERT IGNORE INTO `settings` (`setting_key`, `setting_value`) VALUES
('app_name', 'SmartNotes'),
('app_tagline', 'All-in-one notes, tasks & planning'),
('logo_path', NULL),
('favicon_path', NULL),
('background_path', NULL),
('default_theme', 'system'),
('default_accent', '#6366f1'),
('allow_registration', '0'),
('trash_auto_delete_days', '30'),
('max_image_mb', '0'),
('max_audio_mb', '0'),
('max_file_mb', '0'),
('max_video_mb', '0'),
('default_reminder_minutes', '30'),
('web_cron_enabled', '1'),
('default_note_categories', '["Work","Personal","Project","Meeting","Ideas","Important","Finance","Development"]'),
('default_task_categories', '["Work","Personal","Project","Meeting","Important","Development"]'),
('smtp_host', ''),
('smtp_port', '587'),
('smtp_username', ''),
('smtp_password', ''),
('smtp_encryption', 'tls'),
('smtp_from_name', 'SmartNotes'),
('smtp_from_email', ''),
('schema_version', '20'),
('allow_note_sharing', '1'),
('logo_display', 'logo'),
('logo_height', '34'),
('logo_max_width', '180'),
('login_logo_height', '48');
