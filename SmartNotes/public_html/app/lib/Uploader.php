<?php
declare(strict_types=1);

defined('SN_APP') || exit;

/**
 * Validates and stores uploaded files. Binary goes to /uploads, metadata to MySQL (by the caller).
 * Validation: upload error, size limit, real MIME via finfo, extension whitelist, image decoding.
 */
final class Uploader
{
    /** ext => [allowed mimes, kind] */
    private const TYPES = [
        'jpg' => [['image/jpeg', 'image/pjpeg'], 'image'],
        'jpeg' => [['image/jpeg', 'image/pjpeg'], 'image'],
        'png' => [['image/png'], 'image'],
        'webp' => [['image/webp'], 'image'],
        'mp3' => [['audio/mpeg', 'audio/mp3', 'audio/x-mpeg'], 'audio'],
        'wav' => [['audio/wav', 'audio/x-wav', 'audio/wave', 'audio/vnd.wave'], 'audio'],
        'm4a' => [['audio/mp4', 'audio/x-m4a', 'audio/m4a', 'video/mp4', 'audio/aac', 'application/octet-stream'], 'audio'],
        'mp4' => [['audio/mp4', 'video/mp4', 'audio/x-m4a'], 'audio'],
        'aac' => [['audio/aac', 'audio/x-aac', 'audio/x-hx-aac-adts'], 'audio'],
        'ogg' => [['audio/ogg', 'application/ogg', 'video/ogg'], 'audio'],
        'oga' => [['audio/ogg', 'application/ogg'], 'audio'],
        'webm' => [['audio/webm', 'video/webm'], 'audio'],
        // Video files (stored on disk like everything else; only metadata goes to MySQL).
        'mov' => [['video/quicktime'], 'video'],
        'm4v' => [['video/x-m4v', 'video/mp4'], 'video'],
        'pdf' => [['application/pdf'], 'document'],
        'doc' => [['application/msword', 'application/vnd.ms-office', 'application/CDFV2', 'application/x-ole-storage'], 'document'],
        'docx' => [['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/zip', 'application/octet-stream'], 'document'],
        'xls' => [['application/vnd.ms-excel', 'application/vnd.ms-office', 'application/CDFV2', 'application/x-ole-storage'], 'document'],
        'xlsx' => [['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/zip', 'application/octet-stream'], 'document'],
        'ppt' => [['application/vnd.ms-powerpoint', 'application/vnd.ms-office', 'application/CDFV2', 'application/x-ole-storage'], 'document'],
        'pptx' => [['application/vnd.openxmlformats-officedocument.presentationml.presentation', 'application/zip', 'application/octet-stream'], 'document'],
        'txt' => [['text/plain'], 'document'],
        'csv' => [['text/csv', 'text/plain', 'application/csv'], 'document'],
        'zip' => [['application/zip', 'application/x-zip-compressed', 'application/x-zip'], 'archive'],
    ];

    /** MP4 / WebM can hold audio or video: they are stored as video wherever video is accepted. */
    private const VIDEO_MIME = ['mp4' => 'video/mp4', 'm4v' => 'video/mp4', 'webm' => 'video/webm', 'mov' => 'video/quicktime'];

    /** Canonical MIME types we send back when serving files. */
    public const SERVE_MIME = [
        'jpg' => 'image/jpeg', 'jpeg' => 'image/jpeg', 'png' => 'image/png', 'webp' => 'image/webp',
        'mp3' => 'audio/mpeg', 'wav' => 'audio/wav', 'm4a' => 'audio/mp4', 'mp4' => 'audio/mp4', 'aac' => 'audio/aac',
        'ogg' => 'audio/ogg', 'oga' => 'audio/ogg', 'webm' => 'audio/webm',
        'pdf' => 'application/pdf', 'doc' => 'application/msword',
        'docx' => 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'xls' => 'application/vnd.ms-excel', 'xlsx' => 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'ppt' => 'application/vnd.ms-powerpoint', 'pptx' => 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'txt' => 'text/plain', 'csv' => 'text/csv', 'zip' => 'application/zip',
    ];

    private const MAX_IMAGE_DIMENSION = 2560;
    private const THUMB_SIZE = 480;

    /** Kinds a file extension can be stored as (MP4/WebM can be audio or video). */
    public static function kindsFor(string $ext): array
    {
        if (!isset(self::TYPES[$ext])) {
            return [];
        }
        $kind = self::TYPES[$ext][1];
        return in_array($ext, ['mp4', 'webm'], true) ? [$kind, 'video'] : [$kind];
    }

    /**
     * The uploaded file of this request: a normal multipart field, or a finished chunked upload
     * (POST upload_token, see ChunkUpload). Null when nothing was sent.
     */
    public static function fromRequest(int $userId, string $field = 'file'): ?array
    {
        if (!empty($_FILES[$field]) && ($_FILES[$field]['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_NO_FILE) {
            return $_FILES[$field];
        }
        $token = (string) ($_POST['upload_token'] ?? '');
        return $token !== '' ? ChunkUpload::take($userId, $token) : null;
    }

    /**
     * @param array  $file    entry from $_FILES (or ChunkUpload::take())
     * @param array  $kinds   allowed kinds, e.g. ['image'] or ['audio'] or ['image','audio','document','archive']
     * @param string $subdir  folder under uploads/, e.g. "u12" or "branding"
     * @param bool   $local   the file is a temp file written by the app itself (e.g. an e-mail attachment), not an HTTP upload
     * @param bool   $policy  apply the admin's upload rules (off for profile photos and branding)
     */
    public static function store(array $file, array $kinds, string $subdir, bool $makeThumb = true, bool $local = false, bool $policy = true): array
    {
        try {
            return self::doStore($file, $kinds, $subdir, $makeThumb, $local, $policy);
        } finally {
            if (!empty($file['chunk_dir'])) {
                ChunkUpload::discard($file['chunk_dir']);
            }
        }
    }

    private static function doStore(array $file, array $kinds, string $subdir, bool $makeThumb, bool $local, bool $policy): array
    {
        $chunked = !empty($file['chunk_dir']);
        $local = $local || $chunked;
        if (!isset($file['error']) || is_array($file['error'])) {
            throw new HttpException('Invalid upload.', 400);
        }
        if ($file['error'] !== UPLOAD_ERR_OK) {
            $msg = match ($file['error']) {
                UPLOAD_ERR_INI_SIZE, UPLOAD_ERR_FORM_SIZE => 'The file exceeds the server upload limit (' . ini_get('upload_max_filesize') . ').',
                UPLOAD_ERR_PARTIAL => 'The file was only partially uploaded.',
                UPLOAD_ERR_NO_FILE => 'No file was uploaded.',
                default => 'Upload failed (code ' . $file['error'] . ').',
            };
            throw new HttpException($msg, 422);
        }
        if (!$local && !is_uploaded_file($file['tmp_name']) && PHP_SAPI !== 'cli') {
            throw new HttpException('Invalid upload.', 400);
        }

        $original = self::cleanName((string) ($file['name'] ?? 'file'));
        $ext = strtolower(pathinfo($original, PATHINFO_EXTENSION));
        if (!isset(self::TYPES[$ext])) {
            throw new HttpException('File type ".' . $ext . '" is not allowed.', 422);
        }
        [$mimes, $kind] = self::TYPES[$ext];
        if (in_array('video', $kinds, true) && in_array($ext, ['mp4', 'webm'], true)) {
            $kind = 'video';
            $mimes = array_merge($mimes, ['video/mp4', 'video/webm', 'audio/mp4', 'audio/webm']);
        }
        if (!in_array($kind, $kinds, true)) {
            throw new HttpException('This file type is not allowed here.', 422);
        }

        $size = (int) filesize($file['tmp_name']);
        if ($size <= 0) {
            throw new HttpException('The file is empty.', 422);
        }
        if ($policy) {
            UploadPolicy::assertKind($kind);
            UploadPolicy::assertSize($kind, $size);
        }
        if (!$chunked) {
            UploadPolicy::assertSpace($size); // a chunked file is already on this disk: moving it costs nothing
        }

        $finfo = new finfo(FILEINFO_MIME_TYPE);
        $mime = (string) $finfo->file($file['tmp_name']);
        if (!in_array($mime, $mimes, true)) {
            throw new HttpException('The file content does not match its extension (' . $mime . ').', 422);
        }
        // Office Open XML / zip containers: make sure the archive is readable.
        if ($mime === 'application/zip' && class_exists('ZipArchive')) {
            $zip = new ZipArchive();
            if ($zip->open($file['tmp_name']) !== true) {
                throw new HttpException('The archive appears to be corrupted.', 422);
            }
            $zip->close();
        }

        $rel = trim($subdir, '/') . '/' . date('Y/m');
        $dir = SN_UPLOADS . '/' . $rel;
        ensure_dir($dir);
        $stored = bin2hex(random_bytes(16)) . '.' . ($ext === 'jpeg' ? 'jpg' : $ext);
        $dest = $dir . '/' . $stored;

        $width = $height = null;
        $thumb = null;
        if ($kind === 'image') {
            $info = @getimagesize($file['tmp_name']);
            if (!$info || $info[0] < 1 || $info[1] < 1) {
                throw new HttpException('The image could not be read.', 422);
            }
            [$width, $height] = [$info[0], $info[1]];
            if ($width * $height > 40_000_000) {
                throw new HttpException('The image resolution is too large.', 422);
            }
            // Re-encode through GD: strips metadata/payloads and compresses large images.
            $re = self::reencode($file['tmp_name'], $dest, $ext, self::MAX_IMAGE_DIMENSION);
            if ($re) {
                [$width, $height] = $re;
            } elseif (!($local ? copy($file['tmp_name'], $dest) : move_uploaded_file($file['tmp_name'], $dest)) && !copy($file['tmp_name'], $dest)) {
                throw new HttpException('Could not save the file — the hosting storage may be full.', 507);
            }
            if ($makeThumb) {
                $thumbName = pathinfo($stored, PATHINFO_FILENAME) . '_t.' . pathinfo($stored, PATHINFO_EXTENSION);
                if (self::reencode($dest, $dir . '/' . $thumbName, $ext, self::THUMB_SIZE)) {
                    $thumb = $rel . '/' . $thumbName;
                }
            }
        } else {
            $saved = $chunked ? self::moveLocal($file['tmp_name'], $dest)
                : ($local ? copy($file['tmp_name'], $dest) : @move_uploaded_file($file['tmp_name'], $dest));
            if (!$saved && !(PHP_SAPI === 'cli' && copy($file['tmp_name'], $dest))) {
                @unlink($dest);
                throw new HttpException('Could not save the file — the hosting storage may be full.', 507);
            }
        }
        @chmod($dest, 0644);

        return [
            'file_name' => $stored,
            'original_name' => $original,
            'file_path' => $rel . '/' . $stored,
            'thumb_path' => $thumb,
            'mime_type' => $kind === 'video' ? self::VIDEO_MIME[$ext] : (self::SERVE_MIME[$ext] ?? $mime),
            'file_kind' => $kind,
            'file_size' => (int) filesize($dest),
            'file_hash' => hash_file('sha256', $dest),
            'width' => $width,
            'height' => $height,
            'ext' => $ext,
        ];
    }

    /** Move a file the app wrote itself (rename is instant on the same disk; copy as a fallback). */
    private static function moveLocal(string $src, string $dest): bool
    {
        if (@rename($src, $dest)) {
            return true;
        }
        if (@copy($src, $dest)) {
            @unlink($src);
            return true;
        }
        return false;
    }

    public static function cleanName(string $name): string
    {
        $name = basename(str_replace('\\', '/', $name));
        $name = preg_replace('/[^\p{L}\p{N}\s._\-()]/u', '', $name) ?? 'file';
        $name = trim($name, ". \t");
        return mb_substr($name !== '' ? $name : 'file', 0, 200);
    }

    /** Resize (if needed) and re-encode an image with GD. Returns [w,h] or null if GD unavailable. */
    public static function reencode(string $src, string $dest, string $ext, int $maxDim, int $rotate = 0): ?array
    {
        if (!function_exists('imagecreatetruecolor')) {
            return null;
        }
        $img = match ($ext) {
            'jpg', 'jpeg' => @imagecreatefromjpeg($src),
            'png' => @imagecreatefrompng($src),
            'webp' => function_exists('imagecreatefromwebp') ? @imagecreatefromwebp($src) : false,
            default => false,
        };
        if (!$img) {
            return null;
        }
        if (in_array($ext, ['jpg', 'jpeg'], true) && function_exists('exif_read_data') && $rotate === 0) {
            $exif = @exif_read_data($src);
            $o = (int) ($exif['Orientation'] ?? 1);
            $rotate = match ($o) { 3 => 180, 6 => 90, 8 => 270, default => 0 };
        }
        if ($rotate) {
            $bg = imagecolorallocatealpha($img, 0, 0, 0, 127);
            $r = imagerotate($img, -$rotate, $bg);
            if ($r) {
                imagedestroy($img);
                $img = $r;
            }
        }
        $w = imagesx($img);
        $h = imagesy($img);
        $scale = min(1, $maxDim / max($w, $h));
        $nw = max(1, (int) round($w * $scale));
        $nh = max(1, (int) round($h * $scale));
        if ($scale < 1) {
            $dst = imagecreatetruecolor($nw, $nh);
            imagealphablending($dst, false);
            imagesavealpha($dst, true);
            imagecopyresampled($dst, $img, 0, 0, 0, 0, $nw, $nh, $w, $h);
            imagedestroy($img);
            $img = $dst;
        } else {
            imagealphablending($img, false);
            imagesavealpha($img, true);
        }
        $ok = match ($ext) {
            'jpg', 'jpeg' => imagejpeg($img, $dest, 85),
            'png' => imagepng($img, $dest, 7),
            'webp' => function_exists('imagewebp') && imagewebp($img, $dest, 85),
            default => false,
        };
        imagedestroy($img);
        return $ok ? [$nw, $nh] : null;
    }

    public static function absolute(string $relPath): string
    {
        $rel = ltrim(str_replace(['..', '\\'], '', $relPath), '/');
        return SN_UPLOADS . '/' . $rel;
    }

    public static function delete(?string ...$relPaths): void
    {
        foreach ($relPaths as $p) {
            if ($p) {
                $abs = self::absolute($p);
                if (is_file($abs)) {
                    @unlink($abs);
                }
            }
        }
    }

    /** Stream a stored file with HTTP Range support (needed for audio seeking). */
    public static function serve(string $relPath, string $mime, string $downloadName, bool $inline = true): never
    {
        $abs = self::absolute($relPath);
        if (!is_file($abs)) {
            throw new HttpException('File not found.', 404);
        }
        $size = (int) filesize($abs);
        $mtime = filemtime($abs) ?: time();
        $etag = '"' . md5($relPath . $size . $mtime) . '"';

        while (ob_get_level()) {
            ob_end_clean();
        }
        header('X-Content-Type-Options: nosniff');
        // PDFs must not be sandboxed or the browser's built-in viewer refuses to render them.
        header($mime === 'application/pdf'
            ? "Content-Security-Policy: frame-ancestors 'self'"
            : "Content-Security-Policy: default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; sandbox");
        header('Cache-Control: private, max-age=86400');
        header('ETag: ' . $etag);
        header('Accept-Ranges: bytes');
        // Only images/audio/PDF can be shown inline; everything else downloads.
        $inlineOk = $inline && (str_starts_with($mime, 'image/') || str_starts_with($mime, 'audio/') || str_starts_with($mime, 'video/') || $mime === 'application/pdf');
        $disp = $inlineOk ? 'inline' : 'attachment';
        header("Content-Disposition: $disp; filename=\"" . addcslashes(preg_replace('/[^\x20-\x7E]/', '_', $downloadName) ?? 'file', '"\\') . "\"; filename*=UTF-8''" . rawurlencode($downloadName));
        header('Content-Type: ' . $mime);

        if (($_SERVER['HTTP_IF_NONE_MATCH'] ?? '') === $etag) {
            http_response_code(304);
            exit;
        }

        $start = 0;
        $end = $size - 1;
        if (isset($_SERVER['HTTP_RANGE']) && preg_match('/bytes=(\d*)-(\d*)/', (string) $_SERVER['HTTP_RANGE'], $m)) {
            if ($m[1] === '' && $m[2] !== '') {
                $start = max(0, $size - (int) $m[2]);
            } else {
                $start = (int) $m[1];
                if ($m[2] !== '') {
                    $end = min((int) $m[2], $size - 1);
                }
            }
            if ($start > $end || $start >= $size) {
                http_response_code(416);
                header("Content-Range: bytes */$size");
                exit;
            }
            http_response_code(206);
            header("Content-Range: bytes $start-$end/$size");
        }
        $length = $end - $start + 1;
        header('Content-Length: ' . $length);
        if (Http::method() === 'HEAD') {
            exit;
        }
        if ($length > 8 * 1024 * 1024) {
            @set_time_limit(0); // large videos/archives on slow connections
        }
        $fp = fopen($abs, 'rb');
        fseek($fp, $start);
        $remaining = $length;
        while ($remaining > 0 && !feof($fp) && connection_status() === CONNECTION_NORMAL) {
            $chunk = fread($fp, (int) min(65536, $remaining));
            if ($chunk === false) {
                break;
            }
            echo $chunk;
            $remaining -= strlen($chunk);
            flush();
        }
        fclose($fp);
        exit;
    }
}
