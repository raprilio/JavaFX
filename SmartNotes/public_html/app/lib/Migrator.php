<?php
declare(strict_types=1);

defined('SN_APP') || exit;

/**
 * Automatic, idempotent schema upgrades for existing installations (no SSH / CLI needed).
 * Fresh installs get the latest schema from install/database.sql and skip this.
 */
final class Migrator
{
    public const VERSION = 12;

    public static function run(): void
    {
        $current = (int) Settings::get('schema_version', '1');
        if ($current >= self::VERSION) {
            return;
        }
        if ((int) DB::val("SELECT GET_LOCK('smartnotes_migrate', 10)") !== 1) {
            return;
        }
        try {
            $current = (int) DB::val("SELECT setting_value FROM settings WHERE setting_key = 'schema_version'") ?: 1;
            if ($current < 2) {
                self::v2();
            }
            if ($current < 3) {
                self::v3();
            }
            if ($current < 4) {
                self::v4();
            }
            if ($current < 5) {
                self::v5();
            }
            if ($current < 6) {
                self::v6();
            }
            if ($current < 7) {
                self::v7();
            }
            if ($current < 8) {
                self::v8();
            }
            if ($current < 9) {
                self::v9();
            }
            if ($current < 10) {
                self::v10();
            }
            if ($current < 11) {
                self::v11();
            }
            if ($current < 12) {
                self::v12();
            }
            Settings::set('schema_version', (string) self::VERSION);
        } finally {
            DB::val("SELECT RELEASE_LOCK('smartnotes_migrate')");
        }
    }

    private static function hasTable(string $t): bool
    {
        return (bool) DB::val('SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?', [$t]);
    }

    private static function hasColumn(string $t, string $c): bool
    {
        return (bool) DB::val('SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?', [$t, $c]);
    }

    private static function hasConstraint(string $t, string $name): bool
    {
        return (bool) DB::val('SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND CONSTRAINT_NAME = ?', [$t, $name]);
    }

    private static function addColumn(string $t, string $c, string $def): void
    {
        if (!self::hasColumn($t, $c)) {
            DB::pdo()->exec("ALTER TABLE `$t` ADD COLUMN `$c` $def");
        }
    }

    /** v1.1: Drive (folders, file tags), note sharing, forced password change / remote sign-out, logo sizing. */
    private static function v2(): void
    {
        $pdo = DB::pdo();
        self::addColumn('users', 'must_change_password', "TINYINT(1) NOT NULL DEFAULT 0");
        self::addColumn('users', 'session_version', "INT UNSIGNED NOT NULL DEFAULT 1");
        self::addColumn('notes', 'updated_by', "INT UNSIGNED NULL");

        if (!self::hasTable('drive_folders')) {
            $pdo->exec("CREATE TABLE `drive_folders` (
              `id` INT UNSIGNED NOT NULL AUTO_INCREMENT, `user_id` INT UNSIGNED NOT NULL, `parent_id` INT UNSIGNED NULL,
              `name` VARCHAR(120) NOT NULL, `color` VARCHAR(9) NULL,
              `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
              PRIMARY KEY (`id`), KEY `idx_df_user_parent` (`user_id`, `parent_id`), KEY `idx_df_parent` (`parent_id`),
              CONSTRAINT `fk_df_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
              CONSTRAINT `fk_df_parent` FOREIGN KEY (`parent_id`) REFERENCES `drive_folders` (`id`) ON DELETE SET NULL
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
        }
        self::addColumn('note_attachments', 'folder_id', 'INT UNSIGNED NULL AFTER `meeting_id`');
        self::addColumn('note_attachments', 'description', 'TEXT NULL');
        self::addColumn('note_attachments', 'is_starred', 'TINYINT(1) NOT NULL DEFAULT 0');
        self::addColumn('note_attachments', 'last_opened_at', 'DATETIME NULL');
        if (!self::hasConstraint('note_attachments', 'fk_att_folder')) {
            $pdo->exec('ALTER TABLE `note_attachments` ADD KEY `idx_att_folder` (`folder_id`), ADD CONSTRAINT `fk_att_folder` FOREIGN KEY (`folder_id`) REFERENCES `drive_folders` (`id`) ON DELETE SET NULL');
        }
        if (!self::hasTable('file_tag_relations')) {
            $pdo->exec("CREATE TABLE `file_tag_relations` (
              `file_id` INT UNSIGNED NOT NULL, `tag_id` INT UNSIGNED NOT NULL, PRIMARY KEY (`file_id`, `tag_id`), KEY `idx_ftr_tag` (`tag_id`),
              CONSTRAINT `fk_ftr_file` FOREIGN KEY (`file_id`) REFERENCES `note_attachments` (`id`) ON DELETE CASCADE,
              CONSTRAINT `fk_ftr_tag` FOREIGN KEY (`tag_id`) REFERENCES `note_tags` (`id`) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
        }
        if (!self::hasTable('note_shares')) {
            $pdo->exec("CREATE TABLE `note_shares` (
              `id` INT UNSIGNED NOT NULL AUTO_INCREMENT, `note_id` INT UNSIGNED NOT NULL, `owner_id` INT UNSIGNED NOT NULL, `user_id` INT UNSIGNED NOT NULL,
              `permission` ENUM('view','edit') NOT NULL DEFAULT 'view', `is_pinned` TINYINT(1) NOT NULL DEFAULT 0, `last_opened_at` DATETIME NULL,
              `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
              PRIMARY KEY (`id`), UNIQUE KEY `uq_share_note_user` (`note_id`, `user_id`), KEY `idx_share_user` (`user_id`, `is_pinned`), KEY `idx_share_owner` (`owner_id`),
              CONSTRAINT `fk_share_note` FOREIGN KEY (`note_id`) REFERENCES `notes` (`id`) ON DELETE CASCADE,
              CONSTRAINT `fk_share_owner` FOREIGN KEY (`owner_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
              CONSTRAINT `fk_share_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
        }
        foreach (['allow_note_sharing' => '1', 'logo_display' => 'logo', 'logo_height' => '34', 'logo_max_width' => '180', 'login_logo_height' => '48'] as $k => $v) {
            DB::run('INSERT IGNORE INTO settings (setting_key, setting_value) VALUES (?, ?)', [$k, $v]);
        }
    }

    /** v1.3: note PIN lock, shared meetings, video files, dashboard customisation. */
    private static function v3(): void
    {
        $pdo = DB::pdo();
        self::addColumn('notes', 'is_locked', 'TINYINT(1) NOT NULL DEFAULT 0');
        if (!self::hasTable('note_pins')) {
            $pdo->exec("CREATE TABLE `note_pins` (
              `user_id` INT UNSIGNED NOT NULL, `pin_hash` VARCHAR(255) NOT NULL, `failed_attempts` SMALLINT UNSIGNED NOT NULL DEFAULT 0,
              `locked_until` DATETIME NULL, `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
              PRIMARY KEY (`user_id`), CONSTRAINT `fk_npin_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
        }
        self::addColumn('meetings', 'share_all', 'TINYINT(1) NOT NULL DEFAULT 0');
        if (!self::hasTable('meeting_shares')) {
            $pdo->exec("CREATE TABLE `meeting_shares` (
              `id` INT UNSIGNED NOT NULL AUTO_INCREMENT, `meeting_id` INT UNSIGNED NOT NULL, `owner_id` INT UNSIGNED NOT NULL, `user_id` INT UNSIGNED NOT NULL,
              `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
              PRIMARY KEY (`id`), UNIQUE KEY `uq_mshare` (`meeting_id`, `user_id`), KEY `idx_mshare_user` (`user_id`),
              CONSTRAINT `fk_mshare_meeting` FOREIGN KEY (`meeting_id`) REFERENCES `meetings` (`id`) ON DELETE CASCADE,
              CONSTRAINT `fk_mshare_owner` FOREIGN KEY (`owner_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
              CONSTRAINT `fk_mshare_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
        }
        $type = (string) DB::val("SELECT COLUMN_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'note_attachments' AND COLUMN_NAME = 'file_kind'");
        if ($type !== '' && !str_contains($type, "'video'")) {
            $pdo->exec("ALTER TABLE `note_attachments` MODIFY `file_kind` ENUM('image','audio','video','document','archive','other') NOT NULL DEFAULT 'other'");
        }
        self::addColumn('user_settings', 'dashboard_hidden', 'TEXT NULL');
        DB::run("INSERT IGNORE INTO settings (setting_key, setting_value) VALUES ('max_video_mb', '100')");
    }

    /** v1.4: handwriting / pen drawings inside notes (vector JSON + PNG files in uploads/). */
    private static function v4(): void
    {
        if (!self::hasTable('note_drawings')) {
            DB::pdo()->exec("CREATE TABLE `note_drawings` (
              `id` INT UNSIGNED NOT NULL AUTO_INCREMENT, `user_id` INT UNSIGNED NOT NULL, `note_id` INT UNSIGNED NOT NULL,
              `data_path` VARCHAR(255) NOT NULL, `png_path` VARCHAR(255) NOT NULL,
              `width` SMALLINT UNSIGNED NOT NULL DEFAULT 0, `height` SMALLINT UNSIGNED NOT NULL DEFAULT 0, `stroke_count` INT UNSIGNED NOT NULL DEFAULT 0,
              `file_size` INT UNSIGNED NOT NULL DEFAULT 0, `version` INT UNSIGNED NOT NULL DEFAULT 1,
              `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, `deleted_at` DATETIME NULL,
              PRIMARY KEY (`id`), KEY `idx_draw_note` (`note_id`, `deleted_at`), KEY `idx_draw_user` (`user_id`),
              CONSTRAINT `fk_draw_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
              CONSTRAINT `fk_draw_note` FOREIGN KEY (`note_id`) REFERENCES `notes` (`id`) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
        }
    }

    /** v1.5: sharing of audio, mind maps, flowcharts, Drive files/folders and tagged calendar events. */
    private static function v5(): void
    {
        if (!self::hasTable('item_shares')) {
            DB::pdo()->exec("CREATE TABLE `item_shares` (
              `id` INT UNSIGNED NOT NULL AUTO_INCREMENT, `item_type` VARCHAR(20) NOT NULL, `item_id` INT UNSIGNED NOT NULL,
              `owner_id` INT UNSIGNED NOT NULL, `user_id` INT UNSIGNED NOT NULL, `permission` ENUM('view','edit') NOT NULL DEFAULT 'view',
              `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
              PRIMARY KEY (`id`), UNIQUE KEY `uq_item_share` (`item_type`, `item_id`, `user_id`), KEY `idx_item_share_user` (`user_id`, `item_type`),
              CONSTRAINT `fk_ishare_owner` FOREIGN KEY (`owner_id`) REFERENCES `users` (`id`) ON DELETE CASCADE,
              CONSTRAINT `fk_ishare_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
        }
        self::addColumn('mindmaps', 'updated_by', 'INT UNSIGNED NULL');
        self::addColumn('flowcharts', 'updated_by', 'INT UNSIGNED NULL');
        self::addColumn('mindmaps', 'revision', 'INT UNSIGNED NOT NULL DEFAULT 0');
        self::addColumn('flowcharts', 'revision', 'INT UNSIGNED NOT NULL DEFAULT 0');
    }

    /** v1.7: upload size limits removed (0 = no limit); files are only bounded by the hosting disk. */
    private static function v6(): void
    {
        DB::run("UPDATE settings SET setting_value = '0' WHERE setting_key IN ('max_image_mb', 'max_audio_mb', 'max_video_mb', 'max_file_mb')");
    }

    /** v1.8: admins assign tasks to users; personal IMAP mail accounts (Gmail etc.). */
    private static function v7(): void
    {
        self::addColumn('tasks', 'assigned_by', 'INT UNSIGNED NULL AFTER `user_id`');
        if (!self::hasConstraint('tasks', 'fk_tasks_assigned_by')) {
            DB::pdo()->exec('ALTER TABLE `tasks` ADD KEY `idx_tasks_assigned_by` (`assigned_by`, `deleted_at`), ADD CONSTRAINT `fk_tasks_assigned_by` FOREIGN KEY (`assigned_by`) REFERENCES `users` (`id`) ON DELETE SET NULL');
        }
        // Flowchart node types are no longer a fixed ENUM (network device shapes were added).
        DB::pdo()->exec("ALTER TABLE `flowchart_nodes` MODIFY `node_type` VARCHAR(30) NOT NULL DEFAULT 'process'");
        if (!self::hasTable('mail_accounts')) {
            DB::pdo()->exec(self::MAIL_ACCOUNTS_SQL);
        }
    }

    /** v1.9: admin pins for everyone, admin trash for deleted notes, events for all users, pop-ups & announcements. */
    private static function v8(): void
    {
        self::addColumn('notes', 'pinned_global', "TINYINT(1) NOT NULL DEFAULT 0 AFTER `is_pinned`");
        self::addColumn('notes', 'pinned_global_at', 'DATETIME NULL AFTER `pinned_global`');
        self::addColumn('notes', 'purged_at', 'DATETIME NULL AFTER `deleted_at`');
        self::addColumn('notes', 'purged_by', 'INT UNSIGNED NULL AFTER `purged_at`');
        self::addColumn('calendar_events', 'share_all', 'TINYINT(1) NOT NULL DEFAULT 0');
        self::addColumn('notifications', 'popped_at', 'DATETIME NULL AFTER `read_at`');
        self::addColumn('user_settings', 'popup_reminders', 'TINYINT(1) NOT NULL DEFAULT 1');
        // Reminders that fired before the upgrade must not all pop up at once.
        DB::run("UPDATE notifications SET popped_at = NOW() WHERE type = 'reminder' AND popped_at IS NULL");
        // Defined here, not read from install/ (that folder may have been deleted after installation).
        $t = ' ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci';
        if (!self::hasTable('announcements')) {
            DB::pdo()->exec("CREATE TABLE `announcements` (
              `id` INT UNSIGNED NOT NULL AUTO_INCREMENT, `created_by` INT UNSIGNED NULL, `title` VARCHAR(160) NOT NULL, `body` TEXT NULL,
              `level` ENUM('info','important') NOT NULL DEFAULT 'info', `audience` ENUM('all','users') NOT NULL DEFAULT 'all',
              `starts_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, `ends_at` DATETIME NULL,
              `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, `deleted_at` DATETIME NULL,
              PRIMARY KEY (`id`), KEY `idx_announcements_active` (`deleted_at`, `starts_at`),
              CONSTRAINT `fk_announcements_user` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL)" . $t);
        }
        if (!self::hasTable('announcement_targets')) {
            DB::pdo()->exec("CREATE TABLE `announcement_targets` (
              `announcement_id` INT UNSIGNED NOT NULL, `user_id` INT UNSIGNED NOT NULL,
              PRIMARY KEY (`announcement_id`, `user_id`), KEY `idx_ann_targets_user` (`user_id`),
              CONSTRAINT `fk_ann_targets_ann` FOREIGN KEY (`announcement_id`) REFERENCES `announcements` (`id`) ON DELETE CASCADE,
              CONSTRAINT `fk_ann_targets_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE)" . $t);
        }
        if (!self::hasTable('announcement_reads')) {
            DB::pdo()->exec("CREATE TABLE `announcement_reads` (
              `announcement_id` INT UNSIGNED NOT NULL, `user_id` INT UNSIGNED NOT NULL, `read_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
              PRIMARY KEY (`announcement_id`, `user_id`), KEY `idx_ann_reads_user` (`user_id`),
              CONSTRAINT `fk_ann_reads_ann` FOREIGN KEY (`announcement_id`) REFERENCES `announcements` (`id`) ON DELETE CASCADE,
              CONSTRAINT `fk_ann_reads_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE)" . $t);
        }
    }

    /** v1.10: handwriting pages; company (Hostinger) mailboxes given to users by an administrator. */
    private static function v9(): void
    {
        self::addColumn('note_drawings', 'pages', 'SMALLINT UNSIGNED NOT NULL DEFAULT 1 AFTER `height`');
        if (DB::val("SELECT DATA_TYPE FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'note_drawings' AND COLUMN_NAME = 'height'") === 'smallint') {
            DB::pdo()->exec('ALTER TABLE `note_drawings` MODIFY `height` INT UNSIGNED NOT NULL DEFAULT 0');
        }
        // Old single-sheet drawings: page count from their height (A4 pages of 1414 units).
        DB::run('UPDATE note_drawings SET pages = GREATEST(1, CEIL(height / 1414)) WHERE pages = 1 AND height > 1414');
        if (!self::hasTable('mailbox_assignments')) {
            DB::pdo()->exec(self::MAILBOX_ASSIGNMENTS_SQL);
        }
    }

    /** v1.16: @mentions in notes; mind map look (theme per map, style per topic). */
    private static function v12(): void
    {
        if (!self::hasTable('note_mentions')) {
            DB::pdo()->exec(self::NOTE_MENTIONS_SQL);
        }
        self::addColumn('mindmaps', 'theme', "VARCHAR(500) NULL COMMENT 'JSON look: preset, branches, layout, background, font (v1.16)' AFTER `viewport`");
        self::addColumn('mindmap_nodes', 'style', "VARCHAR(255) NULL COMMENT 'JSON: shape, emoji, size, bold (v1.16)' AFTER `icon`");
    }

    public const NOTE_MENTIONS_SQL = "CREATE TABLE `note_mentions` (
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci";

    /** v1.14: Drive folders linked to notes. */
    private static function v11(): void
    {
        if (!self::hasTable('note_folders')) {
            DB::pdo()->exec(self::NOTE_FOLDERS_SQL);
        }
    }

    public const NOTE_FOLDERS_SQL = "CREATE TABLE `note_folders` (
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci";

    /** v1.11: flowchart shapes keep their drawing order (to front / to back). */
    private static function v10(): void
    {
        self::addColumn('flowchart_nodes', 'sort_order', 'INT NOT NULL DEFAULT 0 AFTER `height`');
    }

    public const MAILBOX_ASSIGNMENTS_SQL = "CREATE TABLE `mailbox_assignments` (
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
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci";

    public const MAIL_ACCOUNTS_SQL = "CREATE TABLE `mail_accounts` (
      `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
      `user_id` INT UNSIGNED NOT NULL,
      `provider` VARCHAR(20) NOT NULL DEFAULT 'custom',
      `label` VARCHAR(80) NOT NULL,
      `email` VARCHAR(190) NOT NULL,
      `display_name` VARCHAR(120) NULL,
      `imap_host` VARCHAR(190) NOT NULL, `imap_port` SMALLINT UNSIGNED NOT NULL DEFAULT 993, `imap_security` ENUM('ssl','tls','none') NOT NULL DEFAULT 'ssl',
      `smtp_host` VARCHAR(190) NULL, `smtp_port` SMALLINT UNSIGNED NULL, `smtp_security` ENUM('ssl','tls','none') NULL,
      `username` VARCHAR(190) NOT NULL,
      `password_enc` TEXT NOT NULL COMMENT 'Encrypted with the APP key',
      `last_error` VARCHAR(255) NULL,
      `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (`id`), UNIQUE KEY `uq_mail_account` (`user_id`, `email`),
      CONSTRAINT `fk_mail_accounts_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci";
}
