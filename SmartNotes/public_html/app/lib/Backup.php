<?php
declare(strict_types=1);

defined('SN_APP') || exit;

/**
 * Pure-PHP MySQL backup & restore (no mysqldump / shell access needed on shared hosting),
 * plus ZIP archives of the uploads folder.
 */
final class Backup
{
    public static function dir(): string
    {
        $d = SN_STORAGE . '/backups';
        ensure_dir($d);
        return $d;
    }

    /** Create a full SQL dump. Returns the file name. */
    public static function dumpDatabase(bool $gzip = true): string
    {
        @set_time_limit(0);
        $name = 'smartnotes-db-' . date('Ymd-His') . '-' . bin2hex(random_bytes(3)) . '.sql' . ($gzip && function_exists('gzopen') ? '.gz' : '');
        $path = self::dir() . '/' . $name;
        $gz = str_ends_with($name, '.gz');
        $fh = $gz ? gzopen($path, 'wb6') : fopen($path, 'wb');
        if (!$fh) {
            throw new HttpException('Cannot write to storage/backups. Check folder permissions.', 500);
        }
        $w = static fn(string $s) => $gz ? gzwrite($fh, $s) : fwrite($fh, $s);

        $pdo = DB::pdo();
        $w("-- SmartNotes database backup\n-- Version: " . SN_VERSION . "\n-- Created: " . now() . "\n\n");
        $w("SET NAMES utf8mb4;\nSET FOREIGN_KEY_CHECKS = 0;\nSET SQL_MODE = 'NO_AUTO_VALUE_ON_ZERO';\n\n");

        $tables = DB::col("SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME");
        foreach ($tables as $table) {
            $create = DB::one("SHOW CREATE TABLE `$table`");
            $w("DROP TABLE IF EXISTS `$table`;\n" . $create['Create Table'] . ";\n\n");
            $st = $pdo->query("SELECT * FROM `$table`", PDO::FETCH_ASSOC);
            $batch = [];
            $cols = null;
            while ($row = $st->fetch()) {
                if ($cols === null) {
                    $cols = '(' . implode(',', array_map(static fn($c) => "`$c`", array_keys($row))) . ')';
                }
                $vals = [];
                foreach ($row as $v) {
                    if ($v === null) {
                        $vals[] = 'NULL';
                    } elseif (is_int($v) || is_float($v)) {
                        $vals[] = (string) $v;
                    } else {
                        $vals[] = $pdo->quote((string) $v);
                    }
                }
                $batch[] = '(' . implode(',', $vals) . ')';
                if (count($batch) >= 100) {
                    $w("INSERT INTO `$table` $cols VALUES\n" . implode(",\n", $batch) . ";\n");
                    $batch = [];
                }
            }
            if ($batch) {
                $w("INSERT INTO `$table` $cols VALUES\n" . implode(",\n", $batch) . ";\n");
            }
            $w("\n");
        }
        $w("SET FOREIGN_KEY_CHECKS = 1;\n");
        $gz ? gzclose($fh) : fclose($fh);
        return $name;
    }

    /** ZIP of the uploads folder. Returns the file name. */
    public static function zipUploads(): string
    {
        if (!class_exists('ZipArchive')) {
            throw new HttpException('The PHP zip extension is not available on this server.', 500);
        }
        @set_time_limit(0);
        $name = 'smartnotes-uploads-' . date('Ymd-His') . '-' . bin2hex(random_bytes(3)) . '.zip';
        $zip = new ZipArchive();
        if ($zip->open(self::dir() . '/' . $name, ZipArchive::CREATE) !== true) {
            throw new HttpException('Could not create the ZIP archive.', 500);
        }
        $base = realpath(SN_UPLOADS);
        $it = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($base, FilesystemIterator::SKIP_DOTS));
        foreach ($it as $f) {
            if ($f->isFile()) {
                $rel = ltrim(str_replace('\\', '/', substr($f->getPathname(), strlen($base))), '/');
                $zip->addFile($f->getPathname(), $rel);
            }
        }
        $zip->close();
        return $name;
    }

    public static function list(): array
    {
        $out = [];
        foreach (glob(self::dir() . '/smartnotes-*') ?: [] as $f) {
            $out[] = [
                'name' => basename($f),
                'size' => filesize($f),
                'type' => str_contains(basename($f), '-uploads-') ? 'uploads' : 'database',
                'created_at' => date('Y-m-d H:i:s', filemtime($f)),
            ];
        }
        usort($out, static fn($a, $b) => strcmp($b['created_at'], $a['created_at']));
        return $out;
    }

    public static function path(string $name): string
    {
        if (!preg_match('/^smartnotes-(db|uploads)-[0-9]{8}-[0-9]{6}-[a-f0-9]{6}\.(sql|sql\.gz|zip)$/', $name)) {
            throw new HttpException('Invalid backup name.', 422);
        }
        $p = self::dir() . '/' . $name;
        if (!is_file($p)) {
            throw new HttpException('Backup not found.', 404);
        }
        return $p;
    }

    /** Execute a .sql or .sql.gz dump statement by statement. Returns executed statement count. */
    public static function restoreDatabase(string $file): int
    {
        @set_time_limit(0);
        $gz = str_ends_with($file, '.gz') || self::isGzip($file);
        $fh = $gz ? gzopen($file, 'rb') : fopen($file, 'rb');
        if (!$fh) {
            throw new HttpException('Cannot read the backup file.', 422);
        }
        $pdo = DB::pdo();
        $pdo->exec('SET FOREIGN_KEY_CHECKS = 0');
        $count = 0;
        $buf = '';
        $inStr = false;
        $quote = '';
        $escape = false;
        try {
            while (!($gz ? gzeof($fh) : feof($fh))) {
                $line = $gz ? gzgets($fh, 1 << 20) : fgets($fh, 1 << 20);
                if ($line === false) {
                    break;
                }
                if (!$inStr) {
                    $t = ltrim($line);
                    if ($buf === '' && ($t === '' || str_starts_with($t, '--') || str_starts_with($t, '#'))) {
                        continue;
                    }
                }
                $len = strlen($line);
                for ($i = 0; $i < $len; $i++) {
                    $c = $line[$i];
                    if ($inStr) {
                        if ($escape) {
                            $escape = false;
                        } elseif ($c === '\\') {
                            $escape = true;
                        } elseif ($c === $quote) {
                            $inStr = false;
                        }
                        $buf .= $c;
                        continue;
                    }
                    if ($c === "'" || $c === '"' || $c === '`') {
                        $inStr = true;
                        $quote = $c;
                        $buf .= $c;
                        continue;
                    }
                    if ($c === ';') {
                        $sql = trim($buf);
                        $buf = '';
                        if ($sql !== '' && !self::isForbidden($sql)) {
                            $pdo->exec($sql);
                            $count++;
                        }
                        continue;
                    }
                    $buf .= $c;
                }
            }
            $sql = trim($buf);
            if ($sql !== '' && !self::isForbidden($sql)) {
                $pdo->exec($sql);
                $count++;
            }
        } finally {
            $gz ? gzclose($fh) : fclose($fh);
            $pdo->exec('SET FOREIGN_KEY_CHECKS = 1');
        }
        return $count;
    }

    private static function isGzip(string $file): bool
    {
        $h = @fopen($file, 'rb');
        if (!$h) {
            return false;
        }
        $magic = fread($h, 2);
        fclose($h);
        return $magic === "\x1f\x8b";
    }

    /** Refuse statements that could touch other databases or the server. */
    private static function isForbidden(string $sql): bool
    {
        return (bool) preg_match('/^\s*(USE|CREATE\s+DATABASE|DROP\s+DATABASE|GRANT|REVOKE|CREATE\s+USER|DROP\s+USER|LOAD\s+DATA|SELECT\s.*INTO\s+OUTFILE|SHUTDOWN|INSTALL\s+PLUGIN)\b/is', $sql);
    }

    /** Extract an uploads ZIP back into /uploads (refuses path traversal & executable files). */
    public static function restoreUploads(string $zipFile): int
    {
        if (!class_exists('ZipArchive')) {
            throw new HttpException('The PHP zip extension is not available on this server.', 500);
        }
        $zip = new ZipArchive();
        if ($zip->open($zipFile) !== true) {
            throw new HttpException('Invalid ZIP archive.', 422);
        }
        $n = 0;
        for ($i = 0; $i < $zip->numFiles; $i++) {
            $entry = (string) $zip->getNameIndex($i);
            if ($entry === '' || str_ends_with($entry, '/') || str_contains($entry, '..') || str_starts_with($entry, '/')
                || preg_match('/\.(php\d?|phtml|phar|cgi|pl|py|sh|htaccess|htpasswd)$/i', $entry)) {
                continue;
            }
            $dest = SN_UPLOADS . '/' . $entry;
            ensure_dir(dirname($dest));
            $in = $zip->getStream($entry);
            if ($in) {
                $out = fopen($dest, 'wb');
                stream_copy_to_stream($in, $out);
                fclose($out);
                fclose($in);
                $n++;
            }
        }
        $zip->close();
        return $n;
    }
}
