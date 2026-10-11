<?php
declare(strict_types=1);

defined('SN_APP') || exit;

/**
 * Company mailboxes for users (v1.10). Full Admin role only.
 *  - Give a user access to an existing Hostinger mailbox: it then appears in that user's Mail
 *    (read and send through the Hostinger Mail API connections the admin added).
 *  - With the optional Hostinger account API token: create a new mailbox for a user, reset its password,
 *    or delete it at Hostinger.
 */
final class MailboxAdminController
{
    private static function admin(): array
    {
        $u = Auth::require();
        if (!Auth::isAdmin()) {
            throw new HttpException('Only administrators can manage company mailboxes.', 403);
        }
        return $u;
    }

    /** Mailbox ids → addresses the connected Mail API tokens can open. */
    private static function reachable(bool $fresh = false): array
    {
        if (!HostingerMail::configured()) {
            return [];
        }
        try {
            return array_column(HostingerMail::mailboxes($fresh), 'address', 'resourceId');
        } catch (HttpException) {
            return [];
        }
    }

    public static function index(): void
    {
        self::admin();
        $fresh = Http::query('refresh') === '1';
        $reach = self::reachable($fresh);
        $out = [
            'account' => ['connected' => HostingerAccount::configured(), 'source' => HostingerAccount::fromConfig() ? 'config' : 'database',
                'token_hint' => HostingerAccount::configured() ? '••••' . substr(HostingerAccount::token(), -4) : null],
            'mail_connected' => HostingerMail::configured(),
            'orders' => [],
            'account_error' => null,
            'mailboxes' => [],
            'assignments' => self::assignments(),
        ];
        foreach ($reach as $id => $addr) {
            $out['mailboxes'][$id] = ['id' => $id, 'address' => $addr, 'order' => null, 'reachable' => true, 'status' => null];
        }
        if (HostingerAccount::configured()) {
            try {
                foreach (HostingerAccount::orders() as $o) {
                    $boxes = $o['status'] === 'active' ? HostingerAccount::mailboxes($o['id']) : [];
                    $o['mailbox_count'] = count($boxes);
                    $o['mail_connected'] = false;
                    foreach ($boxes as $m) {
                        $out['mailboxes'][$m['id']] = $m + ['order' => $o['id'], 'reachable' => isset($reach[$m['id']])];
                        $o['mail_connected'] = $o['mail_connected'] || isset($reach[$m['id']]);
                    }
                    $out['orders'][] = $o;
                }
            } catch (HttpException $e) {
                $out['account_error'] = $e->getMessage();
            }
        }
        $out['mailboxes'] = array_values($out['mailboxes']);
        usort($out['mailboxes'], static fn($a, $b) => strcmp($a['address'], $b['address']));
        Http::ok($out);
    }

    private static function assignments(): array
    {
        return array_map(static fn($r) => [
            'id' => (int) $r['id'], 'mailbox_id' => $r['mailbox_id'], 'address' => $r['address'], 'created_at' => $r['created_at'],
            'user' => ['id' => (int) $r['user_id'], 'name' => $r['name'], 'email' => $r['email']], 'assigned_by' => $r['by_name'],
        ], DB::all(
            'SELECT a.*, u.name, u.email, b.name AS by_name FROM mailbox_assignments a JOIN users u ON u.id = a.user_id LEFT JOIN users b ON b.id = a.assigned_by
             WHERE u.deleted_at IS NULL ORDER BY a.address, u.name'
        ));
    }

    /** Connect / disconnect the Hostinger account API token. */
    public static function account(): void
    {
        self::admin();
        if (V::bool(Http::input('disconnect'))) {
            HostingerAccount::disconnect();
            Activity::log('admin.hostinger_api', null, null, 'Removed the Hostinger account API token');
            Http::ok(null, 'Disconnected.');
        }
        $token = trim((string) Http::input('token', ''));
        if ($token === '') {
            throw new HttpException('Paste the API token.', 422, ['token' => true]);
        }
        $orders = HostingerAccount::connect($token);
        Activity::log('admin.hostinger_api', null, null, 'Connected the Hostinger account API (' . count($orders) . ' e-mail order(s))');
        Http::ok(['orders' => count($orders)], 'Hostinger account connected.');
    }

    /** Give a user access to a mailbox. */
    public static function assign(): void
    {
        $admin = self::admin();
        $mailbox = self::mailboxId(Http::input('mailbox_id'));
        $user = self::user(Http::input('user_id'));
        $address = self::addressOf($mailbox);
        $id = self::grant($mailbox, $address, $user, $admin);
        Http::ok(['id' => $id], "{$user['name']} can now use $address.");
    }

    public static function unassign(int $id): void
    {
        self::admin();
        $a = DB::one('SELECT a.*, u.name FROM mailbox_assignments a JOIN users u ON u.id = a.user_id WHERE a.id = ?', [$id]) ?? throw new HttpException('Not found.', 404);
        DB::run('DELETE FROM mailbox_assignments WHERE id = ?', [$id]);
        Notify::create((int) $a['user_id'], 'system', 'Akses mailbox ' . $a['address'] . ' dicabut oleh administrator', null, '#/mail');
        Activity::log('admin.mailbox_unassign', null, null, "Removed {$a['name']}'s access to {$a['address']}");
        Http::ok(null, 'Access removed.');
    }

    /** Create a mailbox at Hostinger (account API) and optionally give it to a user. */
    public static function create(): void
    {
        $admin = self::admin();
        $order = (string) Http::input('order_id', '');
        $local = strtolower(trim((string) Http::input('local_part', '')));
        if (!preg_match('/^(?=[a-z0-9])(?=.*[a-z0-9]$)[a-z0-9_-]+(?:\.[a-z0-9_-]+)*$/', $local) || strlen($local) > 50) {
            throw new HttpException('Use letters, digits, dots, "-" or "_" for the address (it must start and end with a letter or digit).', 422, ['local_part' => true]);
        }
        $password = (string) Http::input('password', '');
        $generated = $password === '';
        if ($generated) {
            $password = HostingerAccount::generatePassword();
        } elseif (!HostingerAccount::validPassword($password)) {
            throw new HttpException('The password needs 8–50 characters with upper and lower case letters, a number and a special character.', 422, ['password' => true]);
        }
        $user = Http::input('user_id') ? self::user(Http::input('user_id')) : null;
        $box = HostingerAccount::createMailbox($order, $local, $password);
        Activity::log('admin.mailbox_create', null, null, 'Created mailbox ' . $box['address'] . ' at Hostinger');

        // Make sure SmartNotes can open it: connect a Mail API token for this domain when none covers it yet.
        $reach = self::reachable(true);
        $note = null;
        if (!isset($reach[$box['id']]) && V::bool(Http::input('connect_mail', 1))) {
            try {
                $token = HostingerAccount::createMailToken($order, 'SmartNotes');
                HostingerMail::addConnection($token, substr((string) strrchr($box['address'], '@'), 1));
                $reach = self::reachable(true);
            } catch (HttpException $e) {
                $note = 'The mailbox was created, but SmartNotes could not get a Mail API token for this domain: ' . $e->getMessage();
            }
        }
        $assigned = null;
        if ($user) {
            $assigned = self::grant($box['id'], $box['address'], $user, $admin);
        }
        Http::ok([
            'mailbox' => $box + ['reachable' => isset($reach[$box['id']])],
            'password' => $password, // shown once to the admin; never stored by SmartNotes
            'generated' => $generated,
            'assignment_id' => $assigned,
            'warning' => $note ?? (isset($reach[$box['id']]) ? null : 'The connected Mail API token does not cover this mailbox yet. Add a token for its domain under API connections (all mailboxes).'),
        ], 'Mailbox created.');
    }

    public static function password(): void
    {
        self::admin();
        $mailbox = self::mailboxId(Http::input('mailbox_id'));
        $password = (string) Http::input('password', '');
        $generated = $password === '';
        if ($generated) {
            $password = HostingerAccount::generatePassword();
        } elseif (!HostingerAccount::validPassword($password)) {
            throw new HttpException('The password needs 8–50 characters with upper and lower case letters, a number and a special character.', 422, ['password' => true]);
        }
        HostingerAccount::changePassword($mailbox, $password);
        Activity::log('admin.mailbox_password', null, null, 'Changed the password of mailbox ' . $mailbox);
        Http::ok(['password' => $password, 'generated' => $generated], 'Password changed.');
    }

    /** Delete the mailbox at Hostinger (restorable there for a limited time) and every user's access to it. */
    public static function destroy(): void
    {
        self::admin();
        $mailbox = self::mailboxId(Http::input('mailbox_id'));
        $address = DB::val('SELECT address FROM mailbox_assignments WHERE mailbox_id = ? LIMIT 1', [$mailbox]) ?? $mailbox;
        HostingerAccount::deleteMailbox($mailbox);
        foreach (DB::col('SELECT user_id FROM mailbox_assignments WHERE mailbox_id = ?', [$mailbox]) as $uid) {
            Notify::create((int) $uid, 'system', 'Mailbox ' . $address . ' dihapus oleh administrator', null, '#/mail');
        }
        DB::run('DELETE FROM mailbox_assignments WHERE mailbox_id = ?', [$mailbox]);
        if (Settings::get('hmail_default_mailbox') === $mailbox) {
            Settings::set('hmail_default_mailbox', '');
        }
        unset($_SESSION['hmail_me']);
        Activity::log('admin.mailbox_delete', null, null, 'Deleted mailbox ' . $address . ' at Hostinger');
        Http::ok(null, 'Mailbox deleted.');
    }

    // ------------------------------------------------------------ helpers

    private static function grant(string $mailbox, string $address, array $user, array $admin): int
    {
        DB::run('INSERT INTO mailbox_assignments (mailbox_id, address, user_id, assigned_by) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE address = VALUES(address)',
            [$mailbox, $address, $user['id'], $admin['id']]);
        $id = (int) DB::val('SELECT id FROM mailbox_assignments WHERE mailbox_id = ? AND user_id = ?', [$mailbox, $user['id']]);
        if ((int) $user['id'] !== (int) $admin['id']) {
            Notify::create((int) $user['id'], 'system', '📧 ' . $admin['name'] . ' memberi Anda akses mailbox ' . $address, 'Buka menu Mail untuk membaca dan mengirim e-mail.', '#/mail');
        }
        Activity::log('admin.mailbox_assign', null, null, "Gave {$user['name']} access to $address");
        return $id;
    }

    private static function mailboxId(mixed $v): string
    {
        $id = is_string($v) ? trim($v) : '';
        if (!preg_match('/^AC[A-Za-z0-9]{1,60}$/', $id)) {
            throw new HttpException('Choose a mailbox.', 422, ['mailbox_id' => true]);
        }
        return $id;
    }

    private static function user(mixed $v): array
    {
        $id = V::id($v) ?? throw new HttpException('Choose a user.', 422, ['user_id' => true]);
        return DB::one("SELECT id, name, email FROM users WHERE id = ? AND deleted_at IS NULL AND status = 'active'", [$id])
            ?? throw new HttpException('User not found.', 404);
    }

    /** The address of a mailbox known to the Mail API connections or the account API. */
    private static function addressOf(string $mailbox): string
    {
        $reach = self::reachable();
        if (!isset($reach[$mailbox])) {
            $reach = self::reachable(true);
        }
        if (isset($reach[$mailbox])) {
            return $reach[$mailbox];
        }
        if (HostingerAccount::configured()) {
            foreach (HostingerAccount::orders() as $o) {
                foreach ($o['status'] === 'active' ? HostingerAccount::mailboxes($o['id']) : [] as $m) {
                    if ($m['id'] === $mailbox) {
                        return $m['address'];
                    }
                }
            }
        }
        throw new HttpException('This mailbox is not available for the connected Hostinger tokens.', 404);
    }

    /** Hostinger mailboxes an administrator gave to this user: [['resourceId', 'address'], …]. */
    public static function forUser(int $userId): array
    {
        return array_map(static fn($r) => ['resourceId' => $r['mailbox_id'], 'address' => $r['address']],
            DB::all('SELECT mailbox_id, address FROM mailbox_assignments WHERE user_id = ? ORDER BY address', [$userId]));
    }

    public static function isAssigned(string $mailbox, int $userId): bool
    {
        return (bool) DB::val('SELECT 1 FROM mailbox_assignments WHERE mailbox_id = ? AND user_id = ?', [$mailbox, $userId]);
    }
}
