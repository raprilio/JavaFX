<?php
declare(strict_types=1);

defined('SN_APP') || exit;

final class NotesController
{
    private const COLORS = ['default', 'red', 'orange', 'yellow', 'green', 'teal', 'blue', 'indigo', 'purple', 'pink', 'brown', 'gray'];
    private const BACKGROUNDS = ['none', 'dots', 'grid', 'lines', 'waves', 'paper'];

    public static function index(): void
    {
        $u = Auth::require();
        $filter = V::enum(Http::query('filter'), ['all', 'pinned', 'favorite', 'archived', 'trash', 'recent', 'shared', 'shared_by_me'], 'all');
        if ($filter === 'shared') {
            self::sharedWithMe($u['id']);
        }
        // All notes / Pinned also list notes shared with me and notes an admin pinned for everyone (v1.9).
        $wide = in_array($filter, ['all', 'pinned'], true);
        // v1.24: … and notes an admin pinned for me (the people tagged in it).
        $where = [$wide ? '(n.user_id = ? OR s.user_id IS NOT NULL OR (n.pinned_global = 1 AND n.is_locked = 0) OR (pt.user_id IS NOT NULL AND n.is_locked = 0))' : 'n.user_id = ?'];
        $params = [$u['id']];

        if ($filter === 'shared_by_me') {
            $where[] = 'n.deleted_at IS NULL';
            $where[] = 'EXISTS (SELECT 1 FROM note_shares s WHERE s.note_id = n.id)';
        } elseif ($filter === 'trash') {
            $where[] = 'n.deleted_at IS NOT NULL';
            $where[] = 'n.purged_at IS NULL';
        } else {
            $where[] = 'n.deleted_at IS NULL';
            $where[] = $filter === 'archived' ? 'n.is_archived = 1' : 'n.is_archived = 0';
            if ($filter === 'pinned') {
                $where[] = '(n.pinned_global = 1 OR pt.user_id IS NOT NULL OR IF(n.user_id = ?, n.is_pinned, COALESCE(s.is_pinned, 0)) = 1)';
                $params[] = $u['id'];
            } elseif ($filter === 'favorite') {
                $where[] = 'n.is_favorite = 1';
            } elseif ($filter === 'recent') {
                $where[] = 'n.last_opened_at IS NOT NULL';
            }
        }
        if ($cat = V::id(Http::query('category'))) {
            $where[] = 'n.category_id = ?';
            $params[] = $cat;
        } elseif (Http::query('category') === 'none') {
            $where[] = 'n.category_id IS NULL';
        }
        if ($tag = TagsController::normalize(Http::query('tag'))) {
            $where[] = 'EXISTS (SELECT 1 FROM note_tag_relations r JOIN note_tags t ON t.id = r.tag_id WHERE r.note_id = n.id AND t.name = ? AND t.user_id = ?)';
            $params[] = $tag;
            $params[] = $u['id'];
        }
        $types = ['text', 'checklist', 'image', 'audio', 'rich', 'mixed'];
        if (in_array(Http::query('type'), $types, true)) {
            $where[] = 'n.note_type = ?';
            $params[] = Http::query('type');
        }
        if (in_array(Http::query('color'), self::COLORS, true)) {
            $where[] = 'n.color = ?';
            $params[] = Http::query('color');
        }
        $q = V::str(Http::query('q'), 100);
        $unlocked = NoteLock::unlocked($u['id']);
        if ($q !== null) {
            $like = '%' . addcslashes($q, '%_\\') . '%';
            // The text of locked notes is not searchable until the PIN is entered.
            $where[] = $unlocked ? '(n.title LIKE ? OR n.content_text LIKE ?)' : '(n.title LIKE ? OR (n.is_locked = 0 AND n.content_text LIKE ?))';
            $params[] = $like;
            $params[] = $like;
        }
        if (Http::query('locked') === '1') {
            $where[] = 'n.is_locked = 1';
        }
        if ($who = self::mentionFilter($u['id'])) {
            $where[] = 'EXISTS (SELECT 1 FROM note_mentions m WHERE m.note_id = n.id AND m.user_id = ?)';
            $params[] = $who;
        }

        $sortMap = ['updated' => 'n.updated_at', 'created' => 'n.created_at', 'title' => 'n.title', 'opened' => 'n.last_opened_at'];
        $sort = $sortMap[Http::query('sort', $filter === 'recent' ? 'opened' : 'updated')] ?? 'n.updated_at';
        $dir = Http::query('dir') === 'asc' ? 'ASC' : 'DESC';
        // Admin pins for everyone first, then my own pins (or my pin on a note shared with me), then the rest.
        // v1.20: inside both pinned groups the order you arranged by dragging; a fresh pin (no position yet) on top.
        $mine = 'IF(n.user_id = ' . (int) $u['id'] . ', n.is_pinned, COALESCE(s.is_pinned, 0))';
        $forMe = '(n.pinned_global = 0 AND pt.user_id IS NOT NULL)';
        $order = ($wide ? "n.pinned_global DESC, IF(n.pinned_global = 1, COALESCE(n.pinned_global_pos, -1), 0), $forMe DESC, IF($forMe, COALESCE(pt.position, -1), 0), $mine DESC, IF($mine = 1, COALESCE(up.position, -1), 0), " : '') . "$sort $dir, n.id DESC";
        $perPage = V::int(Http::query('per_page'), 1, 100) ?? 40;
        $page = V::int(Http::query('page'), 1, 100000) ?? 1;
        $whereSql = implode(' AND ', $where);

        $from = 'notes n LEFT JOIN note_shares s ON s.note_id = n.id AND s.user_id = ' . (int) $u['id'] . ' LEFT JOIN users o ON o.id = n.user_id'
            . ' LEFT JOIN user_pins up ON up.user_id = ' . (int) $u['id'] . " AND up.kind = 'note' AND up.item_id = n.id"
            . ' LEFT JOIN note_pin_targets pt ON pt.note_id = n.id AND pt.user_id = ' . (int) $u['id'];
        $total = (int) DB::val("SELECT COUNT(*) FROM $from WHERE $whereSql", $params);
        $rows = DB::all(
            "SELECT n.id, n.title, LEFT(n.content_text, 260) AS excerpt, n.note_type, n.color, n.background,
                    n.is_pinned, n.is_favorite, n.is_archived, n.is_locked, n.category_id, n.checklist_total, n.checklist_done,
                    n.created_at, n.updated_at, n.last_opened_at, n.deleted_at, n.pinned_global, n.user_id AS owner_id, o.name AS owner_name,
                    s.permission, s.is_pinned AS share_pinned, pt.user_id IS NOT NULL AS pinned_for_me, pb.name AS pinned_by_name,
                    (SELECT COUNT(*) FROM note_pin_targets t WHERE t.note_id = n.id) AS pin_target_count,
                    (SELECT a.id FROM note_attachments a WHERE a.note_id = n.id AND a.file_kind = 'image' AND a.deleted_at IS NULL ORDER BY a.id LIMIT 1) AS cover_id,
                    (SELECT COUNT(*) FROM note_attachments a WHERE a.note_id = n.id AND a.deleted_at IS NULL) AS attachment_count,
                    (SELECT COUNT(*) FROM audio_notes au WHERE au.note_id = n.id AND au.deleted_at IS NULL) AS audio_count,
                    (SELECT COUNT(*) FROM note_shares s WHERE s.note_id = n.id) AS share_count,
                    (SELECT d.id FROM note_drawings d WHERE d.note_id = n.id AND d.deleted_at IS NULL ORDER BY d.id LIMIT 1) AS drawing_id,
                    (SELECT d.version FROM note_drawings d WHERE d.note_id = n.id AND d.deleted_at IS NULL ORDER BY d.id LIMIT 1) AS drawing_v
             FROM $from LEFT JOIN users pb ON pb.id = pt.pinned_by WHERE $whereSql ORDER BY $order LIMIT $perPage OFFSET " . (($page - 1) * $perPage),
            $params
        );
        $tags = TagsController::forItems('note', array_column($rows, 'id'));
        $people = Mentions::forNotes(array_map('intval', array_column($rows, 'id')));
        foreach ($rows as &$r) {
            $r = self::cast($r);
            $r['tags'] = $tags[$r['id']] ?? [];
            $r['mentions'] = $people[$r['id']] ?? [];
            $mine = $r['owner_id'] === (int) $u['id'];
            if (!$mine) {
                // Someone else's note: shared with me, or pinned by an admin for everyone.
                $r['shared'] = $r['permission'] !== null;
                $r['is_pinned'] = (bool) $r['share_pinned'];
                $r['is_favorite'] = false;
                $r['category_id'] = null;
                $r['share_count'] = null;
                $r['pin_target_count'] = null;
            } else {
                unset($r['owner_name']);
                $r['pinned_for_me'] = false;
            }
            if (!$r['pinned_for_me']) {
                unset($r['pinned_by_name']);
            }
            unset($r['share_pinned']);
            if ($r['is_locked'] && (!$mine || !$unlocked)) {
                $r = self::masked($r);
                $r['mentions'] = [];
            }
        }
        Http::ok(['items' => $rows, 'total' => $total, 'page' => $page, 'per_page' => $perPage, 'unlocked' => $unlocked]);
    }

    /** People @mentioned in the notes I can see, most mentioned first (people filter). */
    public static function people(): void
    {
        $u = Auth::require();
        Http::ok(Mentions::people((int) $u['id']));
    }

    /** ?mention=me | <user id>: notes that @mention this person (v1.16). */
    private static function mentionFilter(int $me): ?int
    {
        $m = Http::query('mention');
        return $m === 'me' ? $me : V::id($m);
    }

    private static function cast(array $r): array
    {
        foreach (['id', 'category_id', 'checklist_total', 'checklist_done', 'cover_id', 'attachment_count', 'audio_count', 'share_count', 'owner_id', 'drawing_id', 'drawing_v', 'pin_target_count'] as $k) {
            if (array_key_exists($k, $r) && $r[$k] !== null) {
                $r[$k] = (int) $r[$k];
            }
        }
        foreach (['is_pinned', 'is_favorite', 'is_archived', 'is_locked', 'share_pinned', 'pinned_global', 'pinned_for_me'] as $k) {
            if (array_key_exists($k, $r)) {
                $r[$k] = (bool) $r[$k];
            }
        }
        return $r;
    }

    /** List/preview fields of a locked note while the session is not unlocked. */
    public static function masked(array $r): array
    {
        $r['excerpt'] = '';
        $r['cover_id'] = null;
        $r['drawing_id'] = null;
        $r['checklist_total'] = 0;
        $r['checklist_done'] = 0;
        $r['locked'] = true;
        return $r;
    }

    public static function find(int $id, int $userId, bool $withTrashed = false): array
    {
        $n = DB::one('SELECT * FROM notes WHERE id = ? AND user_id = ? AND purged_at IS NULL' . ($withTrashed ? '' : ' AND deleted_at IS NULL'), [$id, $userId]);
        if (!$n) {
            throw new HttpException('Note not found.', 404);
        }
        return $n;
    }

    /**
     * Resolve the current user's access to a note.
     * @return array{0: array, 1: string} [note row, 'owner'|'edit'|'view']
     */
    public static function access(int $id, int $userId, bool $ownerMayBeTrashed = false): array
    {
        $n = DB::one('SELECT * FROM notes WHERE id = ? AND purged_at IS NULL', [$id]); // deleted forever = only in the admin trash
        if ($n && (int) $n['user_id'] === $userId) {
            if ($n['deleted_at'] && !$ownerMayBeTrashed) {
                throw new HttpException('Note not found.', 404);
            }
            return [$n, 'owner'];
        }
        if ($n && !$n['deleted_at']) {
            $perm = DB::val('SELECT permission FROM note_shares WHERE note_id = ? AND user_id = ?', [$id, $userId]);
            if ($perm) {
                return [$n, (string) $perm];
            }
            if ((int) $n['pinned_global'] === 1 && !(int) $n['is_locked']) {
                return [$n, 'view']; // pinned by an admin for everyone: read-only
            }
            if (!(int) $n['is_locked'] && DB::val('SELECT 1 FROM note_pin_targets WHERE note_id = ? AND user_id = ?', [$id, $userId])) {
                return [$n, 'view']; // pinned by an admin for me (v1.24): read-only
            }
            if (!(int) $n['is_locked'] && ItemNotesController::grants($id, $userId)) {
                return [$n, 'view']; // listed on a Team progress item / meeting / progress task I can see (v1.22)
            }
        }
        throw new HttpException('Note not found.', 404);
    }

    /** Can a user other than the owner read this note (shared with them, or pinned by an admin for everyone)? */
    public static function readableBy(int $noteId, int $userId): bool
    {
        if (DB::val(
            'SELECT 1 FROM notes n WHERE n.id = ? AND n.deleted_at IS NULL
               AND (EXISTS (SELECT 1 FROM note_shares s WHERE s.note_id = n.id AND s.user_id = ?) OR (n.pinned_global = 1 AND n.is_locked = 0)
                    OR (n.is_locked = 0 AND EXISTS (SELECT 1 FROM note_pin_targets t WHERE t.note_id = n.id AND t.user_id = ?)))',
            [$noteId, $userId, $userId]
        )) {
            return true;
        }
        // v1.22: listed on an item this user can see (its images and files open too)
        return (bool) DB::val('SELECT 1 FROM notes WHERE id = ? AND deleted_at IS NULL AND is_locked = 0', [$noteId])
            && ItemNotesController::grants($noteId, $userId);
    }

    /** Admin: pin one of my notes for every user (it appears pinned in everyone's All notes, read-only). */
    /** A note that is pinned again starts on top of "Pinned by me" (v1.20). */
    public static function forgetPinOrder(int $uid, array $ids): void
    {
        if ($ids) {
            DB::run("DELETE FROM user_pins WHERE user_id = ? AND kind = 'note' AND item_id IN (" . DB::in($ids) . ')', [$uid, ...$ids]);
        }
    }

    /**
     * Save the order after dragging pinned notes (v1.20): "mine" = my pins (own notes and notes shared with me),
     * "global" = the notes an administrator pinned for everyone (administrators only).
     */
    public static function pinOrder(): void
    {
        $u = Auth::require();
        $uid = (int) $u['id'];
        $section = V::enum(Http::input('section'), ['mine', 'global', 'people'], 'mine');
        $ids = array_slice(array_values(array_unique(array_filter(array_map('intval', (array) Http::input('ids', [])), static fn($v) => $v > 0))), 0, 500);
        if (!$ids) {
            Http::ok(['ids' => []]);
        }
        $in = DB::in($ids);
        if ($section === 'global') {
            if (!Auth::can('pin_everyone')) {
                throw new HttpException('Only people allowed to pin for everyone can arrange these notes.', 403);
            }
            $valid = array_map('intval', DB::col("SELECT id FROM notes WHERE pinned_global = 1 AND deleted_at IS NULL AND id IN ($in)", $ids));
        } elseif ($section === 'people') {
            $valid = array_map('intval', DB::col("SELECT note_id FROM note_pin_targets WHERE user_id = ? AND note_id IN ($in)", [$uid, ...$ids]));
        } else {
            $valid = array_map('intval', DB::col(
                "SELECT n.id FROM notes n LEFT JOIN note_shares s ON s.note_id = n.id AND s.user_id = ?
                 WHERE n.id IN ($in) AND n.deleted_at IS NULL AND ((n.user_id = ? AND n.is_pinned = 1) OR s.is_pinned = 1)",
                [$uid, ...$ids, $uid]
            ));
        }
        $ordered = array_values(array_filter($ids, static fn($id) => in_array($id, $valid, true)));
        DB::tx(static function () use ($ordered, $section, $uid) {
            foreach ($ordered as $pos => $id) {
                if ($section === 'global') {
                    DB::run('UPDATE notes SET pinned_global_pos = ?, updated_at = updated_at WHERE id = ?', [$pos, $id]);
                } elseif ($section === 'people') {
                    DB::run('UPDATE note_pin_targets SET position = ? WHERE note_id = ? AND user_id = ?', [$pos, $id, $uid]);
                } else {
                    DB::run("INSERT INTO user_pins (user_id, kind, item_id, position) VALUES (?, 'note', ?, ?) ON DUPLICATE KEY UPDATE position = VALUES(position)", [$uid, $id, $pos]);
                }
            }
        });
        Http::ok(['ids' => $ordered]);
    }

    public static function pinGlobal(int $id): void
    {
        $u = Auth::require();
        if (!Auth::can('pin_everyone')) {
            throw new HttpException('You are not allowed to pin notes for everyone. Ask an administrator.', 403);
        }
        $on = V::bool(Http::input('pinned'));
        // v1.27: an administrator may take away a pin someone else made (e.g. after their permission was removed)
        $other = !$on && Auth::isAdmin() ? DB::one('SELECT * FROM notes WHERE id = ? AND user_id <> ? AND deleted_at IS NULL', [$id, $u['id']]) : null;
        $n = $other ?: self::find($id, $u['id']);
        if ($on && (int) $n['is_locked']) {
            throw new HttpException('A locked note cannot be pinned for everyone. Remove the lock first.', 422);
        }
        if ($on !== (bool) (int) $n['pinned_global']) {
            // a new pin for everyone goes on top of that group (v1.20)
            DB::run('UPDATE notes SET pinned_global = ?, pinned_global_at = ?, pinned_global_pos = NULL, updated_at = updated_at WHERE id = ?', [$on ? 1 : 0, $on ? now() : null, $id]);
        }
        if ($on && !(int) $n['pinned_global']) {
            $title = $n['title'] !== '' ? $n['title'] : 'Tanpa judul';
            foreach (DB::col("SELECT id FROM users WHERE status = 'active' AND deleted_at IS NULL AND id <> ?", [$u['id']]) as $uid) {
                Notify::create((int) $uid, 'note', '📌 ' . $u['name'] . ' menyematkan catatan untuk semua: "' . $title . '"', null, '#/notes/' . $id);
            }
        }
        Activity::log($on ? 'note.pin_global' : 'note.unpin_global', 'note', $id, $on ? 'Pinned for everyone' : 'Unpinned for everyone');
        Http::ok($other ? ['id' => $id, 'pinned_global' => false] : self::payload($id, $u['id']));
    }

    /** The people an admin pinned this note for (v1.24). */
    public static function pinTargets(int $id): array
    {
        return array_map(static fn($r) => ['id' => (int) $r['id'], 'name' => $r['name'], 'email' => $r['email']], DB::all(
            'SELECT u.id, u.name, u.email FROM note_pin_targets t JOIN users u ON u.id = t.user_id WHERE t.note_id = ? ORDER BY u.name', [$id]
        ));
    }

    /**
     * Admin: pin one of my notes for chosen people (v1.24), like "Pin for everyone" but only for them — by default the
     * people @mentioned in it. They see it pinned at the top of their notes (read-only) and get a notification.
     * The list replaces the previous one; an empty list unpins it for everybody.
     */
    public static function pinPeople(int $id): void
    {
        $u = Auth::require();
        $me = (int) $u['id'];
        if (!Auth::can('pin_everyone')) {
            throw new HttpException('You are not allowed to pin notes for other people. Ask an administrator.', 403);
        }
        $want = array_values(array_unique(array_filter(array_map('intval', (array) Http::input('user_ids', [])), static fn($v) => $v > 0 && $v !== $me)));
        // v1.27: an administrator may clear the list of someone else's note (taking the pins away)
        $other = !$want && Auth::isAdmin() ? DB::one('SELECT * FROM notes WHERE id = ? AND user_id <> ? AND deleted_at IS NULL', [$id, $me]) : null;
        $n = $other ?: self::find($id, $me);
        if ($want) {
            if ((int) $n['is_locked']) {
                throw new HttpException('A locked note cannot be pinned for other people. Remove the lock first.', 422);
            }
            $want = array_map('intval', DB::col("SELECT id FROM users WHERE status = 'active' AND deleted_at IS NULL AND id IN (" . DB::in(array_slice($want, 0, 500)) . ')', array_slice($want, 0, 500)));
        }
        $have = array_map('intval', DB::col('SELECT user_id FROM note_pin_targets WHERE note_id = ?', [$id]));
        $gone = array_values(array_diff($have, $want));
        $new = array_values(array_diff($want, $have));
        DB::tx(static function () use ($id, $gone, $new, $me) {
            if ($gone) {
                DB::run('DELETE FROM note_pin_targets WHERE note_id = ? AND user_id IN (' . DB::in($gone) . ')', [$id, ...$gone]);
            }
            foreach ($new as $uid) {
                DB::run('INSERT IGNORE INTO note_pin_targets (note_id, user_id, pinned_by) VALUES (?, ?, ?)', [$id, $uid, $me]);
            }
        });
        $title = $n['title'] !== '' ? $n['title'] : 'Tanpa judul';
        foreach ($new as $uid) {
            Notify::create($uid, 'note', '📌 ' . $u['name'] . ' menyematkan catatan untuk Anda: "' . $title . '"', null, '#/notes/' . $id);
        }
        if ($new || $gone) {
            Activity::log($want ? 'note.pin_people' : 'note.unpin_people', 'note', $id, $want ? 'Pinned for ' . count($want) . ' people' : 'Unpinned for tagged people');
        }
        Http::ok($other ? ['id' => $id, 'pin_targets' => []] : self::payload($id, $me));
    }

    public static function payload(int $id, int $viewerId): array
    {
        [$row, $role] = self::access($id, $viewerId, true);
        $ownerId = (int) $row['user_id'];
        if (NoteLock::hides($row, $viewerId)) {
            // Only what the lock screen needs.
            $n = self::cast(array_intersect_key($row, array_flip(['id', 'title', 'color', 'background', 'is_pinned', 'is_favorite', 'is_archived', 'is_locked', 'created_at', 'updated_at', 'deleted_at'])));
            return $n + ['access' => $role, 'locked' => true, 'content' => '', 'attachments' => [], 'audio' => [], 'tasks' => [], 'tags' => [], 'shares' => []];
        }
        $n = self::cast($row);
        unset($n['user_id']);
        $n['access'] = $role;
        $n['locked'] = false;
        $n['tags'] = TagsController::forItems('note', [$id])[$id] ?? [];
        $n['attachments'] = FilesController::forParent('note', $id, $ownerId);
        $n['audio'] = AudioController::forNote($id, $ownerId);
        $n['tasks'] = $role === 'owner'
            ? DB::all("SELECT id, title, status, priority, due_date FROM tasks WHERE note_id = ? AND user_id = ? AND deleted_at IS NULL ORDER BY id", [$id, $ownerId])
            : [];
        $n['owner'] = DB::one('SELECT id, name, email FROM users WHERE id = ?', [$ownerId]);
        $n['updated_by_name'] = $row['updated_by'] ? DB::val('SELECT name FROM users WHERE id = ?', [$row['updated_by']]) : null;
        if ($role === 'owner') {
            $n['shares'] = SharesController::listFor($id);
            $n['pin_targets'] = self::pinTargets($id);
            $n['mentions'] = Mentions::forNotes([$id])[$id] ?? [];
        } else {
            $pb = DB::one('SELECT u.name FROM note_pin_targets t LEFT JOIN users u ON u.id = t.pinned_by WHERE t.note_id = ? AND t.user_id = ?', [$id, $viewerId]);
            $n['pinned_for_me'] = (bool) $pb;
            $n['pinned_by_name'] = $pb['name'] ?? null;
            $n['shared'] = (bool) DB::val('SELECT 1 FROM note_shares WHERE note_id = ? AND user_id = ?', [$id, $viewerId]);
            $n['share_pinned'] = (bool) DB::val('SELECT is_pinned FROM note_shares WHERE note_id = ? AND user_id = ?', [$id, $viewerId]);
            $n['is_pinned'] = $n['share_pinned'];
            $n['is_favorite'] = false;
            $n['category_id'] = null;
        }
        return $n;
    }

    public static function show(int $id): void
    {
        $u = Auth::require();
        [, $role] = self::access($id, $u['id'], true);
        if ($role === 'owner') {
            DB::run('UPDATE notes SET last_opened_at = NOW(), updated_at = updated_at WHERE id = ?', [$id]);
        } else {
            DB::run('UPDATE note_shares SET last_opened_at = NOW() WHERE note_id = ? AND user_id = ?', [$id, $u['id']]);
        }
        Http::ok(self::payload($id, $u['id']));
    }

    /** Notes other users shared with me (pinned first). */
    private static function sharedWithMe(int $uid): never
    {
        $params = [$uid];
        $extra = '';
        if ($q = V::str(Http::query('q'), 100)) {
            $like = '%' . addcslashes($q, '%_\\') . '%';
            $extra = ' AND (n.title LIKE ? OR n.content_text LIKE ?)';
            array_push($params, $like, $like);
        }
        if ($who = self::mentionFilter($uid)) {
            $extra .= ' AND EXISTS (SELECT 1 FROM note_mentions m WHERE m.note_id = n.id AND m.user_id = ?)';
            $params[] = $who;
        }
        $rows = DB::all(
            "SELECT n.id, n.title, LEFT(n.content_text, 260) AS excerpt, n.note_type, n.color, n.background, n.checklist_total, n.checklist_done,
                    n.created_at, n.updated_at, s.last_opened_at, s.permission, s.is_pinned AS share_pinned, n.user_id AS owner_id, o.name AS owner_name,
                    (SELECT a.id FROM note_attachments a WHERE a.note_id = n.id AND a.file_kind = 'image' AND a.deleted_at IS NULL ORDER BY a.id LIMIT 1) AS cover_id,
                    (SELECT COUNT(*) FROM note_attachments a WHERE a.note_id = n.id AND a.deleted_at IS NULL) AS attachment_count,
                    (SELECT COUNT(*) FROM audio_notes au WHERE au.note_id = n.id AND au.deleted_at IS NULL) AS audio_count
             FROM note_shares s JOIN notes n ON n.id = s.note_id AND n.deleted_at IS NULL JOIN users o ON o.id = n.user_id
             WHERE s.user_id = ?$extra ORDER BY s.is_pinned DESC, n.updated_at DESC LIMIT 500",
            $params
        );
        $tags = TagsController::forItems('note', array_column($rows, 'id'));
        $people = Mentions::forNotes(array_map('intval', array_column($rows, 'id')));
        foreach ($rows as &$r) {
            $r = self::cast($r);
            $r['tags'] = $tags[$r['id']] ?? [];
            $r['mentions'] = $people[$r['id']] ?? [];
            $r['is_pinned'] = $r['share_pinned'];
            $r['is_favorite'] = false;
            $r['is_archived'] = false;
            $r['category_id'] = null;
            $r['shared'] = true;
        }
        Http::ok(['items' => $rows, 'total' => count($rows), 'page' => 1, 'per_page' => 500]);
    }

    public static function store(): void
    {
        $u = Auth::require();
        $id = DB::insert('notes', ['user_id' => $u['id'], 'title' => '', 'content' => '', 'content_text' => '', 'last_opened_at' => now()]);
        self::apply($id, $u['id'], Http::body());
        Activity::log('note.create', 'note', $id, 'Created note');
        Http::ok(self::payload($id, $u['id']));
    }

    public static function update(int $id): void
    {
        $u = Auth::require();
        [$note, $role] = self::access($id, $u['id']);
        $in = Http::body();
        if ($role === 'view') {
            throw new HttpException('You can only view this note.', 403);
        }
        if ($role === 'edit') {
            // Collaborators may change the text only; organisation stays with the owner.
            $in = array_intersect_key($in, array_flip(['title', 'content', 'base_updated_at']));
        }
        if (NoteLock::hides($note, $u['id']) && array_diff(array_keys($in), ['is_pinned', 'is_favorite', 'is_archived', 'color', 'background', 'category_id'])) {
            throw new HttpException('This note is locked. Enter your notes PIN to edit it.', 423, ['locked' => true]);
        }
        // Optimistic concurrency: refuse to overwrite a newer version saved by someone else.
        $base = V::str($in['base_updated_at'] ?? null, 30);
        if ($base !== null && (array_key_exists('title', $in) || array_key_exists('content', $in))
            && $note['updated_at'] !== $base && $note['updated_by'] !== null && (int) $note['updated_by'] !== $u['id']) {
            $who = (string) DB::val('SELECT name FROM users WHERE id = ?', [$note['updated_by']]);
            throw new HttpException("This note was just changed by $who. Reload to get the latest version before editing.", 409);
        }
        self::apply($id, (int) $note['user_id'], $in, $u['id']);
        Http::ok(self::payload($id, $u['id']));
    }

    /** Apply a (partial) set of fields to a note. */
    private static function apply(int $id, int $userId, array $in, ?int $editorId = null): void
    {
        $data = [];
        if (array_key_exists('title', $in) || array_key_exists('content', $in)) {
            $data['updated_by'] = $editorId ?? $userId;
        }
        if (array_key_exists('title', $in)) {
            $data['title'] = V::str($in['title'], 255) ?? '';
        }
        if (array_key_exists('content', $in)) {
            $html = Sanitizer::html(is_string($in['content']) ? $in['content'] : '');
            $data['content'] = $html;
            $data['content_text'] = Sanitizer::text($html);
            [$data['checklist_total'], $data['checklist_done']] = Sanitizer::checklistStats($html);
        }
        if (array_key_exists('category_id', $in)) {
            $data['category_id'] = CategoriesController::ownedId('note', $in['category_id'], $userId);
        }
        if (array_key_exists('color', $in)) {
            $data['color'] = in_array($in['color'], self::COLORS, true) && $in['color'] !== 'default' ? $in['color'] : null;
        }
        if (array_key_exists('background', $in)) {
            $data['background'] = in_array($in['background'], self::BACKGROUNDS, true) && $in['background'] !== 'none' ? $in['background'] : null;
        }
        foreach (['is_pinned', 'is_favorite', 'is_archived'] as $k) {
            if (array_key_exists($k, $in)) {
                $data[$k] = V::bool($in[$k]);
            }
        }
        if ($data) {
            DB::update('notes', $data, 'id = ? AND user_id = ?', [$id, $userId]);
        }
        if (array_key_exists('is_pinned', $data)) {
            self::forgetPinOrder($userId, [$id]);
        }
        if (array_key_exists('tags', $in)) {
            TagsController::sync('note', $id, $userId, $in['tags']);
            DB::run('UPDATE notes SET updated_at = NOW() WHERE id = ?', [$id]);
        }
        if (array_key_exists('content', $in)) {
            self::refreshType($id, $userId);
            DrawingsController::syncNote($id, $data['content']);
            Mentions::sync($id, $data['content'], $editorId ?? $userId);
        }
    }

    /** Derive the note type from its content (text / checklist / image / audio / rich / mixed). */
    public static function refreshType(int $id, int $userId): void
    {
        $n = DB::one('SELECT content, checklist_total FROM notes WHERE id = ?', [$id]);
        if (!$n) {
            return;
        }
        $html = (string) $n['content'];
        $images = str_contains($html, '<img') || (int) DB::val("SELECT COUNT(*) FROM note_attachments WHERE note_id = ? AND file_kind = 'image' AND deleted_at IS NULL", [$id]) > 0;
        $audio = (int) DB::val('SELECT COUNT(*) FROM audio_notes WHERE note_id = ? AND deleted_at IS NULL', [$id]) > 0;
        $checklist = (int) $n['checklist_total'] > 0;
        $text = trim(preg_replace('#<(ul|ol)[^>]*class="[^"]*checklist[^"]*".*?</\1>#is', '', $html) ?? '');
        $hasText = trim(strip_tags($text)) !== '';
        $rich = (bool) preg_match('/<(h[1-4]|b|strong|i|em|u|s|table|blockquote|pre|mark|ol|ul|a)\b/i', $text);

        $kinds = array_filter(['checklist' => $checklist, 'image' => $images, 'audio' => $audio, 'text' => $hasText]);
        if (count($kinds) > 1) {
            $type = 'mixed';
        } elseif ($checklist) {
            $type = 'checklist';
        } elseif ($images) {
            $type = 'image';
        } elseif ($audio) {
            $type = 'audio';
        } else {
            $type = $rich ? 'rich' : 'text';
        }
        DB::run('UPDATE notes SET note_type = ?, updated_at = updated_at WHERE id = ?', [$type, $id]);
    }

    /** Lock or unlock a note (owner only). Locking needs a notes PIN; removing a lock needs an unlocked session. */
    public static function lock(int $id): void
    {
        $u = Auth::require();
        $n = self::find($id, $u['id']);
        $lock = V::bool(Http::input('locked'));
        if ($lock) {
            if (!NoteLock::hasPin($u['id'])) {
                throw new HttpException('Set a notes PIN first.', 422, ['pin_required' => true]);
            }
            if (DB::val('SELECT 1 FROM note_shares WHERE note_id = ? LIMIT 1', [$id])) {
                throw new HttpException('Shared notes cannot be locked. Stop sharing it first.', 422, ['shared' => true]);
            }
            if ((int) $n['pinned_global']) {
                throw new HttpException('This note is pinned for everyone. Unpin it for everyone first.', 422, ['pinned_global' => true]);
            }
            if (DB::val('SELECT 1 FROM note_pin_targets WHERE note_id = ? LIMIT 1', [$id])) {
                throw new HttpException('This note is pinned for other people. Unpin it for them first.', 422, ['pinned_people' => true]);
            }
        } elseif (NoteLock::hides($n, $u['id'])) {
            if (Http::has('pin')) {
                NoteLock::verify($u['id'], Http::input('pin'));
                NoteLock::unlock($u['id']);
            } else {
                throw new HttpException('Enter your notes PIN to remove the lock.', 423, ['locked' => true]);
            }
        }
        DB::run('UPDATE notes SET is_locked = ?, updated_at = updated_at WHERE id = ?', [$lock ? 1 : 0, $id]);
        Activity::log($lock ? 'note.lock' : 'note.unlock', 'note', $id, $lock ? 'Locked note' : 'Removed note lock');
        Http::ok(self::payload($id, $u['id']));
    }

    public static function duplicate(int $id): void
    {
        $u = Auth::require();
        $n = self::find($id, $u['id']);
        if (NoteLock::hides($n, $u['id'])) {
            throw new HttpException('This note is locked. Enter your notes PIN first.', 423, ['locked' => true]);
        }
        $new = DB::insert('notes', [
            'user_id' => $u['id'],
            'category_id' => $n['category_id'],
            'title' => mb_substr(($n['title'] ?: 'Untitled') . ' (copy)', 0, 255),
            'content' => $n['content'],
            'content_text' => $n['content_text'],
            'note_type' => $n['note_type'],
            'color' => $n['color'],
            'background' => $n['background'],
            'checklist_total' => $n['checklist_total'],
            'checklist_done' => $n['checklist_done'],
            'is_locked' => $n['is_locked'],
        ]);
        // Handwriting is copied too, so editing the copy never changes the original.
        $copied = DrawingsController::copyForNote($id, $new, $u['id'], (string) $n['content']);
        if ($copied !== $n['content']) {
            DB::run('UPDATE notes SET content = ? WHERE id = ?', [$copied, $new]);
        }
        TagsController::sync('note', $new, $u['id'], TagsController::forItems('note', [$id])[$id] ?? []);
        NoteFoldersController::copy($id, $new, (int) $u['id']);
        DB::run('INSERT IGNORE INTO note_mentions (note_id, user_id, mentioned_by) SELECT ?, user_id, mentioned_by FROM note_mentions WHERE note_id = ?', [$new, $id]);
        Activity::log('note.duplicate', 'note', $new, 'Duplicated note #' . $id);
        Http::ok(self::payload($new, $u['id']));
    }

    public static function bulk(): void
    {
        $u = Auth::require();
        $ids = array_slice(V::ids(Http::input('ids')), 0, 500);
        $action = V::enum(Http::input('action'), ['pin', 'unpin', 'favorite', 'unfavorite', 'archive', 'unarchive', 'trash', 'restore', 'destroy', 'category', 'color'], '');
        if (!$ids || $action === '') {
            throw new HttpException('Nothing to do.', 422);
        }
        $in = DB::in($ids);
        $params = array_merge($ids, [$u['id']]);
        $set = match ($action) {
            'pin' => ['is_pinned' => 1], 'unpin' => ['is_pinned' => 0],
            'favorite' => ['is_favorite' => 1], 'unfavorite' => ['is_favorite' => 0],
            'archive' => ['is_archived' => 1, 'is_pinned' => 0], 'unarchive' => ['is_archived' => 0],
            'category' => ['category_id' => CategoriesController::ownedId('note', Http::input('category_id'), $u['id'])],
            'color' => ['color' => in_array(Http::input('color'), self::COLORS, true) && Http::input('color') !== 'default' ? Http::input('color') : null],
            default => null,
        };
        if ($set !== null) {
            DB::update('notes', $set, "id IN ($in) AND user_id = ?", $params);
            if (array_key_exists('is_pinned', $set)) {
                self::forgetPinOrder((int) $u['id'], $ids);
            }
        } elseif ($action === 'trash') {
            DB::update('notes', ['deleted_at' => now()], "id IN ($in) AND user_id = ? AND deleted_at IS NULL", $params);
        } elseif ($action === 'restore') {
            DB::update('notes', ['deleted_at' => null], "id IN ($in) AND user_id = ? AND purged_at IS NULL", $params);
        } elseif ($action === 'destroy') {
            foreach ($ids as $id) {
                try {
                    Trash::remove('note', $id, $u['id']);
                } catch (HttpException) {
                    // skip items that are not owned / already gone
                }
            }
        }
        Activity::log('note.bulk', 'note', null, ucfirst($action) . ' ' . count($ids) . ' note(s)');
        Http::ok(['count' => count($ids)]);
    }
}
