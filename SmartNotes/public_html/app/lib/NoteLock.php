<?php
declare(strict_types=1);

defined('SN_APP') || exit;

/**
 * Notes PIN: one PIN per user protects the notes they mark as locked.
 *
 * Unlocking is per browser session and lasts UNLOCK_TTL seconds after the last access to a
 * locked note. While locked, the API never returns the content, excerpt, attachments or audio
 * of those notes, and full-text search ignores their content.
 * The content itself is not encrypted: the PIN guards against other people using the same
 * device/session, not against database administrators.
 */
final class NoteLock
{
    public const MIN_LEN = 4;
    public const MAX_LEN = 8;
    public const UNLOCK_TTL = 600;
    private const MAX_FAILS = 5;
    private const BLOCK_MINUTES = 15;

    public static function hasPin(int $userId): bool
    {
        return (bool) DB::val('SELECT 1 FROM note_pins WHERE user_id = ?', [$userId]);
    }

    /** Is the current session allowed to read this user's locked notes? Slides the window on every check. */
    public static function unlocked(int $userId): bool
    {
        $s = $_SESSION['note_unlock'] ?? null;
        if (is_array($s) && ($s['u'] ?? 0) === $userId && ($s['t'] ?? 0) > time()) {
            $_SESSION['note_unlock']['t'] = time() + self::UNLOCK_TTL;
            return true;
        }
        unset($_SESSION['note_unlock']);
        return false;
    }

    public static function lockSession(): void
    {
        unset($_SESSION['note_unlock']);
    }

    /** Is this note row hidden from the current session? */
    public static function hides(array $note, int $viewerId): bool
    {
        return !empty($note['is_locked']) && (int) $note['user_id'] === $viewerId && !self::unlocked($viewerId);
    }

    /** SQL fragment excluding rows whose parent note (column $noteCol) is locked, unless the session is unlocked. */
    public static function fileFilter(string $noteCol, int $userId): string
    {
        return self::unlocked($userId) ? '' : " AND NOT EXISTS (SELECT 1 FROM notes ln WHERE ln.id = $noteCol AND ln.is_locked = 1)";
    }

    public static function normalize(mixed $pin): string
    {
        $pin = is_scalar($pin) ? trim((string) $pin) : '';
        if (!preg_match('/^\d{' . self::MIN_LEN . ',' . self::MAX_LEN . '}$/', $pin)) {
            throw new HttpException('The PIN must be ' . self::MIN_LEN . '–' . self::MAX_LEN . ' digits.', 422, ['pin' => 'format']);
        }
        return $pin;
    }

    /** Throws 429 while the PIN is blocked after too many wrong attempts. */
    public static function assertNotBlocked(int $userId): array
    {
        $row = DB::one('SELECT * FROM note_pins WHERE user_id = ?', [$userId]);
        if (!$row) {
            throw new HttpException('Set a notes PIN first.', 422, ['pin_required' => true]);
        }
        if ($row['locked_until'] && strtotime($row['locked_until']) > time()) {
            $min = (int) ceil((strtotime($row['locked_until']) - time()) / 60);
            throw new HttpException("Too many wrong attempts. Try again in $min minute" . ($min === 1 ? '' : 's') . '.', 429, ['blocked' => true]);
        }
        return $row;
    }

    /** Record a wrong PIN / password and throw. 5 wrong tries block locked notes for 15 minutes. */
    public static function fail(int $userId, int $previousFails, string $what = 'PIN'): never
    {
        $fails = $previousFails + 1;
        if ($fails >= self::MAX_FAILS) {
            DB::run('UPDATE note_pins SET failed_attempts = 0, locked_until = ? WHERE user_id = ?', [date('Y-m-d H:i:s', time() + self::BLOCK_MINUTES * 60), $userId]);
            Activity::log('note.pin_blocked', null, null, 'Notes PIN blocked after too many wrong attempts');
            throw new HttpException('Too many wrong attempts. Locked notes are blocked for ' . self::BLOCK_MINUTES . ' minutes.', 429, ['blocked' => true]);
        }
        DB::run('UPDATE note_pins SET failed_attempts = ? WHERE user_id = ?', [$fails, $userId]);
        $left = self::MAX_FAILS - $fails;
        throw new HttpException("Wrong $what. $left attempt" . ($left === 1 ? '' : 's') . ' left.', 422, [$what === 'PIN' ? 'pin' : 'password' => 'wrong', 'attempts_left' => $left]);
    }

    /** Check a PIN with throttling. Throws on failure. */
    public static function verify(int $userId, mixed $pin): void
    {
        $row = self::assertNotBlocked($userId);
        $pin = is_scalar($pin) ? trim((string) $pin) : '';
        if ($pin !== '' && password_verify($pin, $row['pin_hash'])) {
            self::reset($userId, $row);
            return;
        }
        self::fail($userId, (int) $row['failed_attempts']);
    }

    public static function reset(int $userId, array $row): void
    {
        if ((int) $row['failed_attempts'] || $row['locked_until']) {
            DB::run('UPDATE note_pins SET failed_attempts = 0, locked_until = NULL WHERE user_id = ?', [$userId]);
        }
    }

    public static function unlock(int $userId): void
    {
        $_SESSION['note_unlock'] = ['u' => $userId, 't' => time() + self::UNLOCK_TTL];
    }

    public static function status(int $userId): array
    {
        $row = DB::one('SELECT locked_until FROM note_pins WHERE user_id = ?', [$userId]);
        $unlocked = $row && self::unlocked($userId);
        return [
            'has_pin' => (bool) $row,
            'unlocked' => $unlocked,
            'expires_in' => $unlocked ? max(0, (int) $_SESSION['note_unlock']['t'] - time()) : 0,
            'blocked_until' => $row && $row['locked_until'] && strtotime($row['locked_until']) > time() ? $row['locked_until'] : null,
            'locked_notes' => (int) DB::val('SELECT COUNT(*) FROM notes WHERE user_id = ? AND is_locked = 1 AND deleted_at IS NULL', [$userId]),
            'min' => self::MIN_LEN,
            'max' => self::MAX_LEN,
        ];
    }
}
