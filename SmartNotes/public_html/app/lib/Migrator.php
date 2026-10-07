<?php
declare(strict_types=1);

defined('SN_APP') || exit;

/**
 * Automatic, idempotent schema upgrades for existing installations (no SSH / CLI needed).
 * Fresh installs get the latest schema from install/database.sql and skip this.
 */
final class Migrator
{
    public const VERSION = 5;

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
}
