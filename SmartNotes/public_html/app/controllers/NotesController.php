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
        $filter = V::enum(Http::query('filter'), ['all', 'pinned', 'favorite', 'archived', 'trash', 'recent'], 'all');
        $where = ['n.user_id = ?'];
        $params = [$u['id']];

        if ($filter === 'trash') {
            $where[] = 'n.deleted_at IS NOT NULL';
        } else {
            $where[] = 'n.deleted_at IS NULL';
            $where[] = $filter === 'archived' ? 'n.is_archived = 1' : 'n.is_archived = 0';
            if ($filter === 'pinned') {
                $where[] = 'n.is_pinned = 1';
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
        if ($q !== null) {
            $like = '%' . addcslashes($q, '%_\\') . '%';
            $where[] = '(n.title LIKE ? OR n.content_text LIKE ?)';
            $params[] = $like;
            $params[] = $like;
        }

        $sortMap = ['updated' => 'n.updated_at', 'created' => 'n.created_at', 'title' => 'n.title', 'opened' => 'n.last_opened_at'];
        $sort = $sortMap[Http::query('sort', $filter === 'recent' ? 'opened' : 'updated')] ?? 'n.updated_at';
        $dir = Http::query('dir') === 'asc' ? 'ASC' : 'DESC';
        $order = ($filter === 'all' ? 'n.is_pinned DESC, ' : '') . "$sort $dir, n.id DESC";
        $perPage = V::int(Http::query('per_page'), 1, 100) ?? 40;
        $page = V::int(Http::query('page'), 1, 100000) ?? 1;
        $whereSql = implode(' AND ', $where);

        $total = (int) DB::val("SELECT COUNT(*) FROM notes n WHERE $whereSql", $params);
        $rows = DB::all(
            "SELECT n.id, n.title, LEFT(n.content_text, 260) AS excerpt, n.note_type, n.color, n.background,
                    n.is_pinned, n.is_favorite, n.is_archived, n.category_id, n.checklist_total, n.checklist_done,
                    n.created_at, n.updated_at, n.last_opened_at, n.deleted_at,
                    (SELECT a.id FROM note_attachments a WHERE a.note_id = n.id AND a.file_kind = 'image' AND a.deleted_at IS NULL ORDER BY a.id LIMIT 1) AS cover_id,
                    (SELECT COUNT(*) FROM note_attachments a WHERE a.note_id = n.id AND a.deleted_at IS NULL) AS attachment_count,
                    (SELECT COUNT(*) FROM audio_notes au WHERE au.note_id = n.id AND au.deleted_at IS NULL) AS audio_count
             FROM notes n WHERE $whereSql ORDER BY $order LIMIT $perPage OFFSET " . (($page - 1) * $perPage),
            $params
        );
        $tags = TagsController::forItems('note', array_column($rows, 'id'));
        foreach ($rows as &$r) {
            $r = self::cast($r);
            $r['tags'] = $tags[$r['id']] ?? [];
        }
        Http::ok(['items' => $rows, 'total' => $total, 'page' => $page, 'per_page' => $perPage]);
    }

    private static function cast(array $r): array
    {
        foreach (['id', 'category_id', 'checklist_total', 'checklist_done', 'cover_id', 'attachment_count', 'audio_count'] as $k) {
            if (array_key_exists($k, $r) && $r[$k] !== null) {
                $r[$k] = (int) $r[$k];
            }
        }
        foreach (['is_pinned', 'is_favorite', 'is_archived'] as $k) {
            if (array_key_exists($k, $r)) {
                $r[$k] = (bool) $r[$k];
            }
        }
        return $r;
    }

    public static function find(int $id, int $userId, bool $withTrashed = false): array
    {
        $n = DB::one('SELECT * FROM notes WHERE id = ? AND user_id = ?' . ($withTrashed ? '' : ' AND deleted_at IS NULL'), [$id, $userId]);
        if (!$n) {
            throw new HttpException('Note not found.', 404);
        }
        return $n;
    }

    public static function payload(int $id, int $userId): array
    {
        $n = self::cast(self::find($id, $userId, true));
        unset($n['user_id']);
        $n['tags'] = TagsController::forItems('note', [$id])[$id] ?? [];
        $n['attachments'] = FilesController::forParent('note', $id, $userId);
        $n['audio'] = AudioController::forNote($id, $userId);
        $n['tasks'] = DB::all("SELECT id, title, status, priority, due_date FROM tasks WHERE note_id = ? AND user_id = ? AND deleted_at IS NULL ORDER BY id", [$id, $userId]);
        return $n;
    }

    public static function show(int $id): void
    {
        $u = Auth::require();
        self::find($id, $u['id'], true);
        DB::run('UPDATE notes SET last_opened_at = NOW(), updated_at = updated_at WHERE id = ?', [$id]);
        Http::ok(self::payload($id, $u['id']));
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
        self::find($id, $u['id']);
        self::apply($id, $u['id'], Http::body());
        Http::ok(self::payload($id, $u['id']));
    }

    /** Apply a (partial) set of fields to a note. */
    private static function apply(int $id, int $userId, array $in): void
    {
        $data = [];
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
        if (array_key_exists('tags', $in)) {
            TagsController::sync('note', $id, $userId, $in['tags']);
            DB::run('UPDATE notes SET updated_at = NOW() WHERE id = ?', [$id]);
        }
        if (array_key_exists('content', $in)) {
            self::refreshType($id, $userId);
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

    public static function duplicate(int $id): void
    {
        $u = Auth::require();
        $n = self::find($id, $u['id']);
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
        ]);
        TagsController::sync('note', $new, $u['id'], TagsController::forItems('note', [$id])[$id] ?? []);
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
        } elseif ($action === 'trash') {
            DB::update('notes', ['deleted_at' => now()], "id IN ($in) AND user_id = ? AND deleted_at IS NULL", $params);
        } elseif ($action === 'restore') {
            DB::update('notes', ['deleted_at' => null], "id IN ($in) AND user_id = ?", $params);
        } elseif ($action === 'destroy') {
            foreach ($ids as $id) {
                try {
                    Trash::destroy('note', $id, $u['id']);
                } catch (HttpException) {
                    // skip items that are not owned / already gone
                }
            }
        }
        Activity::log('note.bulk', 'note', null, ucfirst($action) . ' ' . count($ids) . ' note(s)');
        Http::ok(['count' => count($ids)]);
    }
}
