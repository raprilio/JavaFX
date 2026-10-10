<?php
declare(strict_types=1);

defined('SN_APP') || exit;

/**
 * Chunked uploads: the browser sends a large file in pieces smaller than PHP's upload_max_filesize,
 * they are appended to a temp file in storage/chunks/u{id}/{token}/, and the finished file is handed
 * to Uploader::store() (which moves it into uploads/ without copying).
 *
 * Pieces must arrive in order; re-sending a piece that already arrived is accepted (safe retries).
 * Unfinished uploads are removed by the scheduler after a day.
 */
final class ChunkUpload
{
    private const STALE_SECONDS = 86400;

    public static function root(): string
    {
        return SN_STORAGE . '/chunks';
    }

    private static function dir(int $userId, string $token): string
    {
        if (!preg_match('/^[a-f0-9]{32}$/', $token)) {
            throw new HttpException('Invalid upload token.', 422);
        }
        return self::root() . '/u' . $userId . '/' . $token;
    }

    /** Receive one piece. Returns ['received' => n, 'complete' => bool]. */
    public static function receive(int $userId, array $in, ?array $chunk): array
    {
        $token = (string) ($in['upload_token'] ?? '');
        $dir = self::dir($userId, $token);
        $index = (int) ($in['index'] ?? -1);
        $total = (int) ($in['total'] ?? 0);
        $size = (int) ($in['size'] ?? 0);
        $name = Uploader::cleanName((string) ($in['name'] ?? 'file'));
        if ($index < 0 || $total < 1 || $total > 200000 || $size < 1 || $index >= $total) {
            throw new HttpException('Invalid upload piece.', 422);
        }
        if (!$chunk || ($chunk['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK || (!is_uploaded_file($chunk['tmp_name']) && PHP_SAPI !== 'cli')) {
            throw new HttpException('An upload piece was not received. Please try again.', 422);
        }
        $pieceSize = (int) filesize($chunk['tmp_name']);
        if ($pieceSize < 1 || $pieceSize > UploadPolicy::chunkBytes() + 1024) {
            throw new HttpException('Invalid upload piece size.', 422);
        }

        $metaFile = $dir . '/meta.json';
        if (!is_file($metaFile)) {
            if ($index !== 0) {
                throw new HttpException('This upload expired. Please upload the file again.', 410);
            }
            // Check type, limit and free space before accepting the first byte.
            $kinds = Uploader::kindsFor(strtolower(pathinfo($name, PATHINFO_EXTENSION)));
            if (!$kinds) {
                throw new HttpException('File type ".' . strtolower(pathinfo($name, PATHINFO_EXTENSION)) . '" is not allowed.', 422);
            }
            $allowed = array_values(array_filter($kinds, [UploadPolicy::class, 'kindAllowed']));
            if (!$allowed) {
                UploadPolicy::assertKind($kinds[0]);
            }
            // MP4/WebM may become audio or video: accept if the most generous allowed kind accepts it.
            $allowed = array_reverse($allowed); // on a tie, name video (how Drive stores MP4/WebM)
            usort($allowed, static fn($x, $y) => (UploadPolicy::limitBytes($y) ?? PHP_INT_MAX) <=> (UploadPolicy::limitBytes($x) ?? PHP_INT_MAX));
            UploadPolicy::assertSize($allowed[0], $size);
            UploadPolicy::assertSpace($size);
            ensure_dir($dir);
            self::writeMeta($metaFile, ['name' => $name, 'size' => $size, 'total' => $total, 'next' => 0, 'bytes' => 0, 'complete' => false, 'created' => time()]);
        }

        $fp = fopen($metaFile, 'c+');
        if (!$fp || !flock($fp, LOCK_EX)) {
            throw new HttpException('Could not process the upload.', 500);
        }
        try {
            $meta = json_decode((string) stream_get_contents($fp), true) ?: [];
            if (($meta['size'] ?? 0) !== $size || ($meta['total'] ?? 0) !== $total) {
                throw new HttpException('Upload pieces do not match.', 422);
            }
            if ($index < $meta['next']) {
                return ['received' => $meta['next'], 'complete' => (bool) $meta['complete']]; // retry of a piece we already have
            }
            if ($index > $meta['next']) {
                throw new HttpException('Upload pieces arrived out of order.', 409);
            }
            if ($meta['bytes'] + $pieceSize > $size) {
                self::discard($dir);
                throw new HttpException('The file is larger than announced.', 422);
            }
            $in = fopen($chunk['tmp_name'], 'rb');
            $out = fopen($dir . '/data', 'ab');
            $written = ($in && $out) ? stream_copy_to_stream($in, $out) : false;
            $in && fclose($in);
            $out && fclose($out);
            if ($written !== $pieceSize) {
                // Undo a partial append so a retry starts clean.
                $h = @fopen($dir . '/data', 'r+');
                if ($h) {
                    ftruncate($h, $meta['bytes']);
                    fclose($h);
                }
                throw new HttpException('Could not write the file — the hosting storage may be full.', 507);
            }
            $meta['bytes'] += $pieceSize;
            $meta['next']++;
            if ($meta['next'] === $total) {
                if ($meta['bytes'] !== $size) {
                    self::discard($dir);
                    throw new HttpException('The upload is incomplete. Please try again.', 422);
                }
                $meta['complete'] = true;
            }
            ftruncate($fp, 0);
            rewind($fp);
            fwrite($fp, (string) json_encode($meta));
            return ['received' => $meta['next'], 'complete' => $meta['complete']];
        } finally {
            flock($fp, LOCK_UN);
            fclose($fp);
        }
    }

    /** The finished file as a $_FILES-like entry for Uploader::store(). */
    public static function take(int $userId, string $token): array
    {
        $dir = self::dir($userId, $token);
        $meta = is_file($dir . '/meta.json') ? json_decode((string) file_get_contents($dir . '/meta.json'), true) : null;
        if (!$meta || empty($meta['complete']) || !is_file($dir . '/data')) {
            throw new HttpException('The upload is not complete or has expired. Please upload the file again.', 410);
        }
        return ['name' => $meta['name'], 'tmp_name' => $dir . '/data', 'error' => UPLOAD_ERR_OK, 'size' => (int) $meta['size'], 'chunk_dir' => $dir];
    }

    public static function cancel(int $userId, string $token): void
    {
        self::discard(self::dir($userId, $token));
    }

    public static function discard(string $dir): void
    {
        if (!str_starts_with($dir, self::root() . '/') || !is_dir($dir)) {
            return;
        }
        foreach (glob($dir . '/*') ?: [] as $f) {
            @unlink($f);
        }
        @rmdir($dir);
    }

    /** Remove unfinished uploads older than a day. Returns [count, bytes]. */
    public static function purgeStale(int $olderThan = self::STALE_SECONDS): array
    {
        $count = 0;
        $bytes = 0;
        foreach (glob(self::root() . '/u*/*', GLOB_ONLYDIR) ?: [] as $dir) {
            $t = @filemtime($dir . '/meta.json') ?: @filemtime($dir) ?: 0;
            if ($t && $t < time() - $olderThan) {
                $bytes += (int) @filesize($dir . '/data');
                self::discard($dir);
                $count++;
            }
        }
        return [$count, $bytes];
    }

    public static function pendingBytes(): int
    {
        return dir_size(self::root());
    }

    private static function writeMeta(string $file, array $meta): void
    {
        if (file_put_contents($file, json_encode($meta), LOCK_EX) === false) {
            throw new HttpException('Could not start the upload — the server storage is not writable.', 507);
        }
    }
}
