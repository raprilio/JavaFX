<?php
declare(strict_types=1);

defined('SN_APP') || exit;

/** Notes PIN: set / change / reset / remove the PIN and unlock or re-lock the session. */
final class NotesPinController
{
    public static function status(): void
    {
        $u = Auth::require();
        Http::ok(NoteLock::status($u['id']));
    }

    /**
     * Set or change the PIN.
     * First PIN: nothing else needed. Changing: current PIN, or the account password ("forgot PIN").
     */
    public static function save(): void
    {
        $u = Auth::require();
        $pin = NoteLock::normalize(Http::input('pin'));
        if (NoteLock::hasPin($u['id'])) {
            self::proveIdentity($u['id']);
        }
        DB::run(
            'INSERT INTO note_pins (user_id, pin_hash, failed_attempts, locked_until) VALUES (?, ?, 0, NULL)
             ON DUPLICATE KEY UPDATE pin_hash = VALUES(pin_hash), failed_attempts = 0, locked_until = NULL',
            [$u['id'], password_hash($pin, PASSWORD_DEFAULT)]
        );
        NoteLock::unlock($u['id']);
        Activity::log('note.pin_set', null, null, 'Set notes PIN');
        Http::ok(NoteLock::status($u['id']), 'Notes PIN saved.');
    }

    /** Remove the PIN; every locked note becomes a normal note again. */
    public static function remove(): void
    {
        $u = Auth::require();
        if (!NoteLock::hasPin($u['id'])) {
            Http::ok(NoteLock::status($u['id']));
        }
        self::proveIdentity($u['id']);
        DB::tx(static function () use ($u) {
            DB::run('UPDATE notes SET is_locked = 0, updated_at = updated_at WHERE user_id = ?', [$u['id']]);
            DB::run('DELETE FROM note_pins WHERE user_id = ?', [$u['id']]);
        });
        NoteLock::lockSession();
        Activity::log('note.pin_removed', null, null, 'Removed notes PIN (all notes unlocked)');
        Http::ok(NoteLock::status($u['id']), 'Notes PIN removed. Your locked notes are no longer locked.');
    }

    public static function unlock(): void
    {
        $u = Auth::require();
        NoteLock::verify($u['id'], Http::input('pin'));
        NoteLock::unlock($u['id']);
        Http::ok(NoteLock::status($u['id']));
    }

    public static function lockNow(): void
    {
        $u = Auth::require();
        NoteLock::lockSession();
        Http::ok(NoteLock::status($u['id']));
    }

    /** Current PIN, or the account password when the PIN is forgotten. */
    private static function proveIdentity(int $userId): void
    {
        $password = Http::input('password');
        if (is_string($password) && $password !== '') {
            // Wrong account passwords count towards the same throttle as wrong PINs.
            $row = NoteLock::assertNotBlocked($userId);
            $hash = (string) DB::val('SELECT password_hash FROM users WHERE id = ?', [$userId]);
            if (!password_verify($password, $hash)) {
                NoteLock::fail($userId, (int) $row['failed_attempts'], 'password');
            }
            NoteLock::reset($userId, $row);
            return;
        }
        NoteLock::verify($userId, Http::input('current_pin'));
    }
}
