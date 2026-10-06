<?php
declare(strict_types=1);

defined('SN_APP') || exit;

/**
 * Global search across every module, scoped to the authenticated user.
 */
final class SearchController
{
    public static function index(): void
    {
        $u = Auth::require();
        $uid = $u['id'];
        $q = V::str(Http::query('q'), 100) ?? '';
        $type = Http::query('type', 'all');
        $limit = V::int(Http::query('limit'), 1, 50) ?? 8;
        $from = V::date(Http::query('from'));
        $to = V::date(Http::query('to'));
        $category = V::id(Http::query('category'));
        $tag = TagsController::normalize(Http::query('tag'));
        $favorite = V::bool(Http::query('favorite'));
        $archived = Http::query('archived');

        if ($q === '' && !$tag && !$category && !$favorite && !$from && $archived === null) {
            Http::ok(['query' => $q, 'groups' => []]);
        }
        $like = '%' . addcslashes($q, '%_\\') . '%';
        $groups = [];
        $want = static fn(string $t) => $type === 'all' || $type === $t;
        $dateFilter = static function (string $col, array &$where, array &$params) use ($from, $to): void {
            if ($from) {
                $where[] = "$col >= ?";
                $params[] = $from . ' 00:00:00';
            }
            if ($to) {
                $where[] = "$col <= ?";
                $params[] = $to . ' 23:59:59';
            }
        };

        if ($want('note')) {
            // Own notes + notes other users shared with me.
            $where = ['(n.user_id = ? OR EXISTS (SELECT 1 FROM note_shares sh WHERE sh.note_id = n.id AND sh.user_id = ?))', 'n.deleted_at IS NULL'];
            $params = [$uid, $uid];
            $unlocked = NoteLock::unlocked($uid);
            if ($q !== '') {
                // Locked notes match on their title only until the PIN is entered.
                $where[] = $unlocked ? '(n.title LIKE ? OR n.content_text LIKE ?)' : '(n.title LIKE ? OR (n.is_locked = 0 AND n.content_text LIKE ?))';
                array_push($params, $like, $like);
            }
            if ($category) {
                $where[] = 'n.category_id = ?';
                $params[] = $category;
            }
            if ($tag) {
                $where[] = 'EXISTS (SELECT 1 FROM note_tag_relations r JOIN note_tags t ON t.id = r.tag_id WHERE r.note_id = n.id AND t.name = ?)';
                $params[] = $tag;
            }
            if ($favorite) {
                $where[] = 'n.is_favorite = 1';
            }
            if ($archived === '1') {
                $where[] = 'n.is_archived = 1';
            } elseif ($archived === '0') {
                $where[] = 'n.is_archived = 0';
            }
            $dateFilter('n.updated_at', $where, $params);
            $rows = DB::all(
                'SELECT n.id, n.title, ' . ($unlocked ? 'LEFT(n.content_text, 200)' : "IF(n.is_locked = 1, '', LEFT(n.content_text, 200))") . ' AS excerpt, n.is_locked, n.updated_at AS date, n.is_archived, n.is_favorite, n.note_type, c.name AS category
                 FROM notes n LEFT JOIN note_categories c ON c.id = n.category_id
                 WHERE ' . implode(' AND ', $where) . " ORDER BY n.is_pinned DESC, n.updated_at DESC LIMIT $limit",
                $params
            );
            $groups['note'] = array_map(static fn($r) => [
                'id' => (int) $r['id'],
                'title' => $r['title'] !== '' ? $r['title'] : '(Untitled note)',
                'snippet' => self::snippet((string) $r['excerpt'], $q),
                'date' => $r['date'],
                'meta' => array_values(array_filter([$r['category'], $r['is_locked'] ? 'Locked' : null, $r['is_archived'] ? 'Archived' : null, $r['is_favorite'] ? 'Favorite' : null])),
                'link' => '#/notes/' . $r['id'],
            ], $rows);
        }

        $simpleOnlyText = !$category && !$tag && !$favorite && $archived === null;

        if ($want('task') && ($simpleOnlyText || $tag || $category)) {
            $where = ['t.user_id = ?', 't.deleted_at IS NULL'];
            $params = [$uid];
            if ($q !== '') {
                $where[] = '(t.title LIKE ? OR t.description LIKE ?)';
                array_push($params, $like, $like);
            }
            if ($tag) {
                $where[] = 'EXISTS (SELECT 1 FROM task_tag_relations r JOIN note_tags g ON g.id = r.tag_id WHERE r.task_id = t.id AND g.name = ?)';
                $params[] = $tag;
            }
            if ($category && $type === 'task') {
                $where[] = 't.category_id = ?';
                $params[] = $category;
            }
            $dateFilter('COALESCE(t.due_date, t.created_at)', $where, $params);
            $rows = DB::all('SELECT t.id, t.title, t.description, t.status, t.priority, t.due_date FROM tasks t WHERE ' . implode(' AND ', $where) . " ORDER BY t.updated_at DESC LIMIT $limit", $params);
            $groups['task'] = array_map(static fn($r) => [
                'id' => (int) $r['id'], 'title' => $r['title'], 'snippet' => self::snippet((string) $r['description'], $q),
                'date' => $r['due_date'], 'meta' => [str_replace('_', ' ', $r['status']), $r['priority']], 'link' => '#/tasks?open=' . $r['id'],
            ], $rows);
        }

        if ($simpleOnlyText && $q !== '' || ($simpleOnlyText && $from)) {
            if ($want('meeting')) {
                // Own meetings + meetings shared with me.
                $where = [MeetingsController::visibleSql('m'), 'm.deleted_at IS NULL', '(m.title LIKE ? OR m.description LIKE ? OR m.location LIKE ? OR m.minutes_text LIKE ?)'];
                $params = [$uid, $uid, $like, $like, $like, $like];
                $dateFilter('m.meeting_date', $where, $params);
                $rows = DB::all('SELECT m.id, m.title, m.description, m.meeting_date, m.start_time, m.location FROM meetings m WHERE ' . implode(' AND ', $where) . " ORDER BY m.meeting_date DESC LIMIT $limit", $params);
                $groups['meeting'] = array_map(static fn($r) => [
                    'id' => (int) $r['id'], 'title' => $r['title'], 'snippet' => self::snippet((string) $r['description'], $q),
                    'date' => $r['meeting_date'] . ' ' . $r['start_time'], 'meta' => array_filter([$r['location']]), 'link' => '#/meetings/' . $r['id'],
                ], $rows);
            }
            if ($want('event')) {
                $where = ['user_id = ?', 'deleted_at IS NULL', '(title LIKE ? OR description LIKE ? OR location LIKE ?)'];
                $params = [$uid, $like, $like, $like];
                $dateFilter('start_at', $where, $params);
                $rows = DB::all('SELECT id, title, description, start_at, event_type, repeat_rule FROM calendar_events WHERE ' . implode(' AND ', $where) . " ORDER BY start_at DESC LIMIT $limit", $params);
                $groups['event'] = array_map(static fn($r) => [
                    'id' => (int) $r['id'], 'title' => $r['title'], 'snippet' => self::snippet((string) $r['description'], $q),
                    'date' => $r['start_at'], 'meta' => array_filter([$r['event_type'], $r['repeat_rule'] !== 'none' ? 'repeats ' . $r['repeat_rule'] : null]),
                    'link' => '#/calendar?event=' . $r['id'] . '&date=' . substr($r['start_at'], 0, 10),
                ], $rows);
            }
            if ($want('mindmap')) {
                $where = ['m.user_id = ?', 'm.deleted_at IS NULL', '(m.title LIKE ? OR m.description LIKE ? OR EXISTS (SELECT 1 FROM mindmap_nodes n WHERE n.mindmap_id = m.id AND (n.label LIKE ? OR n.notes LIKE ?)))'];
                $params = [$uid, $like, $like, $like, $like];
                $dateFilter('m.updated_at', $where, $params);
                $rows = DB::all('SELECT m.id, m.title, m.description, m.updated_at FROM mindmaps m WHERE ' . implode(' AND ', $where) . " ORDER BY m.updated_at DESC LIMIT $limit", $params);
                $groups['mindmap'] = array_map(static fn($r) => [
                    'id' => (int) $r['id'], 'title' => $r['title'], 'snippet' => self::snippet((string) $r['description'], $q),
                    'date' => $r['updated_at'], 'meta' => [], 'link' => '#/mindmaps/' . $r['id'],
                ], $rows);
            }
            if ($want('flowchart')) {
                $where = ['f.user_id = ?', 'f.deleted_at IS NULL', '(f.title LIKE ? OR f.description LIKE ? OR EXISTS (SELECT 1 FROM flowchart_nodes n WHERE n.flowchart_id = f.id AND n.label LIKE ?))'];
                $params = [$uid, $like, $like, $like];
                $dateFilter('f.updated_at', $where, $params);
                $rows = DB::all('SELECT f.id, f.title, f.description, f.updated_at FROM flowcharts f WHERE ' . implode(' AND ', $where) . " ORDER BY f.updated_at DESC LIMIT $limit", $params);
                $groups['flowchart'] = array_map(static fn($r) => [
                    'id' => (int) $r['id'], 'title' => $r['title'], 'snippet' => self::snippet((string) $r['description'], $q),
                    'date' => $r['updated_at'], 'meta' => [], 'link' => '#/flowcharts/' . $r['id'],
                ], $rows);
            }
            if ($want('audio')) {
                $where = ['a.user_id = ?', 'a.deleted_at IS NULL', '(a.title LIKE ? OR n.title LIKE ?)'];
                $params = [$uid, $like, $like];
                $dateFilter('a.created_at', $where, $params);
                $rows = DB::all('SELECT a.id, a.title, a.duration, a.created_at, n.title AS note_title FROM audio_notes a LEFT JOIN notes n ON n.id = a.note_id WHERE ' . implode(' AND ', $where) . " ORDER BY a.created_at DESC LIMIT $limit", $params);
                $groups['audio'] = array_map(static fn($r) => [
                    'id' => (int) $r['id'], 'title' => $r['title'], 'snippet' => $r['note_title'] ? 'In note: ' . $r['note_title'] : '',
                    'date' => $r['created_at'], 'meta' => [gmdate('i:s', (int) $r['duration'])], 'link' => '#/audio?play=' . $r['id'],
                ], $rows);
            }
        }
        if ($want('file') && ($q !== '' || $tag || ($simpleOnlyText && $from))) {
            $where = ['a.user_id = ?', 'a.deleted_at IS NULL' . NoteLock::fileFilter('a.note_id', $uid)];
            $params = [$uid];
            if ($q !== '') {
                $where[] = '(a.original_name LIKE ? OR a.description LIKE ? OR EXISTS (SELECT 1 FROM file_tag_relations r JOIN note_tags t ON t.id = r.tag_id WHERE r.file_id = a.id AND t.name LIKE ?))';
                array_push($params, $like, $like, $like);
            }
            if ($tag) {
                $where[] = 'EXISTS (SELECT 1 FROM file_tag_relations r JOIN note_tags t ON t.id = r.tag_id WHERE r.file_id = a.id AND t.name = ?)';
                $params[] = $tag;
            }
            $dateFilter('a.created_at', $where, $params);
            $rows = DB::all('SELECT a.id, a.original_name, a.file_kind, a.file_size, a.created_at, a.description FROM note_attachments a WHERE ' . implode(' AND ', $where) . " ORDER BY a.created_at DESC LIMIT $limit", $params);
            $groups['file'] = array_map(static fn($r) => [
                'id' => (int) $r['id'], 'title' => $r['original_name'], 'snippet' => self::snippet((string) $r['description'], $q),
                'date' => $r['created_at'], 'meta' => [$r['file_kind'], format_bytes((int) $r['file_size'])], 'link' => '#/drive?open=' . $r['id'],
            ], $rows);
        }
        Http::ok(['query' => $q, 'groups' => array_filter($groups)]);
    }

    private static function snippet(string $text, string $q): string
    {
        $text = trim(preg_replace('/\s+/u', ' ', $text) ?? '');
        if ($q === '' || $text === '') {
            return mb_substr($text, 0, 140);
        }
        $pos = mb_stripos($text, $q);
        if ($pos === false) {
            return mb_substr($text, 0, 140);
        }
        $start = max(0, $pos - 50);
        return ($start > 0 ? '…' : '') . mb_substr($text, $start, 140) . (mb_strlen($text) > $start + 140 ? '…' : '');
    }
}
