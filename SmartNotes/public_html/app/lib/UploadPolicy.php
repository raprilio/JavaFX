<?php
declare(strict_types=1);

defined('SN_APP') || exit;

/**
 * Admin-controlled upload rules: size limit per kind (0 = no limit), which kinds users may upload,
 * and a free-space reserve on the hosting. There is no per-user storage quota: every file goes to
 * the uploads/ folder of the hosting and is only bounded by the space the hosting plan has.
 *
 * Large files are sent in chunks (see ChunkUpload), so PHP's upload_max_filesize no longer caps them.
 */
final class UploadPolicy
{
    public const KINDS = ['image', 'audio', 'video', 'document', 'archive'];

    /** setting key => default MB (0 = unlimited) */
    public const LIMIT_KEYS = ['image' => ['max_image_mb', 8], 'audio' => ['max_audio_mb', 25], 'video' => ['max_video_mb', 100], 'document' => ['max_file_mb', 20], 'archive' => ['max_file_mb', 20]];

    /** Upper bound accepted by the admin form (1 TB). */
    public const MAX_MB = 1048576;

    private const DEFAULT_CHUNK = 8 * 1024 * 1024;

    /** Size limit in bytes for a kind, or null when unlimited. */
    public static function limitBytes(string $kind): ?int
    {
        [$key, $def] = self::LIMIT_KEYS[$kind] ?? self::LIMIT_KEYS['document'];
        $mb = Settings::int($key, $def);
        return $mb > 0 ? $mb * 1024 * 1024 : null;
    }

    public static function limitMb(string $kind): int
    {
        [$key, $def] = self::LIMIT_KEYS[$kind] ?? self::LIMIT_KEYS['document'];
        return max(0, Settings::int($key, $def));
    }

    /** Kinds users may upload (profile photos and branding are always allowed). */
    public static function allowedKinds(): array
    {
        $raw = Settings::get('upload_kinds');
        if ($raw === null || $raw === '') {
            return self::KINDS; // not configured yet: everything allowed
        }
        return array_values(array_intersect(self::KINDS, explode(',', (string) $raw))); // 'none' => []
    }

    public static function kindAllowed(string $kind): bool
    {
        return in_array($kind, self::allowedKinds(), true);
    }

    public static function label(string $kind): string
    {
        return ['image' => 'images', 'audio' => 'audio files', 'video' => 'videos', 'document' => 'documents', 'archive' => 'ZIP archives'][$kind] ?? 'files';
    }

    public static function assertKind(string $kind): void
    {
        if (!self::kindAllowed($kind)) {
            throw new HttpException('Uploading ' . self::label($kind) . ' is turned off by the administrator.', 422);
        }
    }

    public static function assertSize(string $kind, int $bytes): void
    {
        $max = self::limitBytes($kind);
        if ($max !== null && $bytes > $max) {
            throw new HttpException('The file is too large. Maximum size for ' . self::label($kind) . ' is ' . self::fmtMb(self::limitMb($kind)) . '.', 422);
        }
    }

    public static function fmtMb(int $mb): string
    {
        return $mb >= 1024 && $mb % 1024 === 0 ? ($mb / 1024) . ' GB' : $mb . ' MB';
    }

    /** Free space that must stay on the hosting after an upload (bytes). */
    public static function reserveBytes(): int
    {
        return max(0, Settings::int('min_free_disk_mb', 200)) * 1024 * 1024;
    }

    /** Free bytes on the disk holding uploads/, or null when the host does not report it. */
    public static function diskFree(): ?int
    {
        $f = function_exists('disk_free_space') ? @disk_free_space(is_dir(SN_UPLOADS) ? SN_UPLOADS : SN_ROOT) : false;
        return $f === false ? null : (int) $f;
    }

    public static function diskTotal(): ?int
    {
        $t = function_exists('disk_total_space') ? @disk_total_space(is_dir(SN_UPLOADS) ? SN_UPLOADS : SN_ROOT) : false;
        return $t === false ? null : (int) $t;
    }

    /** Refuse an upload that would leave less than the reserve free (when the host reports free space). */
    public static function assertSpace(int $bytes): void
    {
        $free = self::diskFree();
        if ($free !== null && $free - $bytes < self::reserveBytes()) {
            throw new HttpException('Not enough storage space left on the server for this file. Ask the administrator to free up space or upgrade the hosting plan.', 507);
        }
    }

    public static function iniBytes(string $v): int
    {
        $v = trim($v);
        if ($v === '' || $v === '-1' || $v === '0') {
            return PHP_INT_MAX;
        }
        $n = (int) $v;
        return match (strtolower(substr($v, -1))) {
            'g' => $n * 1024 ** 3,
            'm' => $n * 1024 ** 2,
            'k' => $n * 1024,
            default => $n,
        };
    }

    /** Size of one upload piece: comfortably below the PHP limits of this host. */
    public static function chunkBytes(): int
    {
        $max = min(self::iniBytes((string) ini_get('upload_max_filesize')), self::iniBytes((string) ini_get('post_max_size')) - 256 * 1024);
        return (int) max(256 * 1024, min(self::DEFAULT_CHUNK, (int) floor($max * 0.9)));
    }

    /** Limits sent to the browser (bootstrap). */
    public static function clientConfig(): array
    {
        return [
            'image_mb' => self::limitMb('image'),
            'audio_mb' => self::limitMb('audio'),
            'video_mb' => self::limitMb('video'),
            'file_mb' => self::limitMb('document'),
            'kinds' => self::allowedKinds(),
            'chunk_bytes' => self::chunkBytes(),
            'server_upload' => ini_get('upload_max_filesize'),
        ];
    }
}
