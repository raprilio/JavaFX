<?php
declare(strict_types=1);

defined('SN_APP') || exit;

/**
 * Notes listed on an item (v1.22): reference notes of a Team progress item, discussion notes of a meeting and the
 * notes of a progress task. Everyone who can see the item can open its notes read-only; the note stays its
 * owner's note (only the owner, or people it is shared with for editing, can change it).
 */
final class ItemNotesController
{
    public const TYPES = ['progress', 'meeting', 'ptask'];

    /** Can this user see the item (and so read the notes listed on it)? */
    public static function canSee(string $type, int $id, int $uid): bool
    {
        return match ($type) {
            'progress' => (bool) DB::val('SELECT 1 FROM progress_items WHERE id = ? AND deleted_at IS NULL', [$id]),
            'meeting' => (bool) DB::val('SELECT 1 FROM meetings m WHERE m.id = ? AND m.deleted_at IS NULL AND ' . MeetingsController::visibleSql('m'), [$id, $uid, $uid]),
            'ptask' => PtasksController::involved($id, $uid),
            default => false,
        };
    }

    /** Can this user add notes to the item? */
    private static function canAdd(string $type, int $id, int $uid): bool
    {
        if ($type === 'progress') {
            $it = DB::one('SELECT user_id FROM progress_items WHERE id = ? AND deleted_at IS NULL', [$id]);
            return $it && ((int) $it['user_id'] === $uid || Auth::isAdmin()
                || DB::val('SELECT 1 FROM progress_updaters WHERE item_id = ? AND user_id = ?', [$id, $uid]));
        }
        return self::canSee($type, $id, $uid); // everyone in the meeting / on the progress task
    }

    /** The item's owner (may remove any note from it). */
    private static function ownerOf(string $type, int $id): ?int
    {
        $t = ['progress' => 'progress_items', 'meeting' => 'meetings', 'ptask' => 'ptasks'][$type];
        $v = DB::val("SELECT user_id FROM `$t` WHERE id = ?", [$id]);
        return $v !== null && $v !== false ? (int) $v : null;
    }

    /** Is the note readable by this user through an item it is listed on? (locked notes never are) */
    public static function grants(int $noteId, int $uid): bool
    {
        foreach (DB::all('SELECT item_type, item_id FROM item_notes WHERE note_id = ?', [$noteId]) as $l) {
            if (self::canSee((string) $l['item_type'], (int) $l['item_id'], $uid)) {
                return true;
            }
        }
        return false;
    }

    /** The notes listed on an item, as the viewer sees them. */
    public static function listFor(string $type, int $id, int $uid): array
    {
        $owner = self::ownerOf($type, $id);
        $canManage = $owner === $uid || ($type === 'progress' && Auth::isAdmin());
        return array_map(static fn($r) => [
            'id' => (int) $r['id'], 'title' => $r['title'] !== '' ? $r['title'] : 'Untitled',
            'excerpt' => (int) $r['is_locked'] ? '' : mb_substr(trim((string) $r['excerpt']), 0, 140),
            'locked' => (bool) (int) $r['is_locked'], 'color' => $r['color'],
            'owner' => ['id' => (int) $r['owner_id'], 'name' => $r['owner_name']],
            'added_by' => $r['added_by'] !== null ? ['id' => (int) $r['added_by'], 'name' => $r['adder_name']] : null,
            'added_at' => $r['created_at'], 'updated_at' => $r['updated_at'],
            'can_remove' => $canManage || (int) $r['added_by'] === $uid,
        ], DB::all(
            "SELECT n.id, n.title, LEFT(n.content_text, 160) AS excerpt, n.is_locked, n.color, n.updated_at, n.user_id AS owner_id, o.name AS owner_name,
                    l.added_by, a.name AS adder_name, l.created_at
             FROM item_notes l JOIN notes n ON n.id = l.note_id AND n.deleted_at IS NULL
             LEFT JOIN users o ON o.id = n.user_id LEFT JOIN users a ON a.id = l.added_by
             WHERE l.item_type = ? AND l.item_id = ? ORDER BY l.created_at, n.id",
            [$type, $id]
        ));
    }

    /** Link a note the user can read (own or shared with them) to an item. */
    public static function link(string $type, int $id, int $noteId, int $uid): void
    {
        [$n] = NotesController::access($noteId, $uid);
        if ((int) $n['is_locked']) {
            throw new HttpException('A locked note cannot be listed here — others could not open it. Remove the lock first.', 422);
        }
        DB::run('INSERT IGNORE INTO item_notes (item_type, item_id, note_id, added_by) VALUES (?, ?, ?, ?)', [$type, $id, $noteId, $uid]);
    }

    private static function check(string $type): string
    {
        if (!in_array($type, self::TYPES, true)) {
            throw new HttpException('Not found.', 404);
        }
        return $type;
    }

    public static function add(string $type, int $id): void
    {
        $u = Auth::require();
        $uid = (int) $u['id'];
        $type = self::check($type);
        if (!self::canAdd($type, $id, $uid)) {
            throw new HttpException($type === 'progress' ? 'Only the creator, an administrator or the people who update this item can add notes.' : 'You cannot add notes here.', 403);
        }
        $noteId = V::id(Http::input('note_id'));
        if (!$noteId) {
            throw new HttpException('Choose a note.', 422, ['note_id' => 'Choose a note.']);
        }
        self::link($type, $id, $noteId, $uid);
        Activity::log('item.note_add', $type, $id, 'Listed note #' . $noteId);
        Http::ok(self::listFor($type, $id, $uid));
    }

    public static function remove(string $type, int $id, int $noteId): void
    {
        $u = Auth::require();
        $uid = (int) $u['id'];
        $type = self::check($type);
        if (!self::canSee($type, $id, $uid)) {
            throw new HttpException('Not found.', 404);
        }
        $row = DB::one('SELECT added_by FROM item_notes WHERE item_type = ? AND item_id = ? AND note_id = ?', [$type, $id, $noteId]);
        if (!$row) {
            throw new HttpException('This note is not listed here.', 404);
        }
        $owner = self::ownerOf($type, $id);
        if ((int) $row['added_by'] !== $uid && $owner !== $uid && !($type === 'progress' && Auth::isAdmin())) {
            throw new HttpException('Only the person who added the note or the owner can remove it.', 403);
        }
        DB::run('DELETE FROM item_notes WHERE item_type = ? AND item_id = ? AND note_id = ?', [$type, $id, $noteId]);
        Http::ok(self::listFor($type, $id, $uid));
    }
}
