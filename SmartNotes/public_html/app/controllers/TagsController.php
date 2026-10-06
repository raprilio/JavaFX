<?php
declare(strict_types=1);

defined('SN_APP') || exit;

final class TagsController
{
    public static function listFor(int $userId): array
    {
        return array_map(static function ($r) {
            $r['id'] = (int) $r['id'];
            $r['count'] = (int) $r['count'];
            return $r;
        }, DB::all(
            'SELECT t.id, t.name, t.color,
                    (SELECT COUNT(*) FROM note_tag_relations r JOIN notes n ON n.id = r.note_id AND n.deleted_at IS NULL WHERE r.tag_id = t.id)
                  + (SELECT COUNT(*) FROM task_tag_relations r JOIN tasks k ON k.id = r.task_id AND k.deleted_at IS NULL WHERE r.tag_id = t.id)
                  + (SELECT COUNT(*) FROM file_tag_relations r JOIN note_attachments f ON f.id = r.file_id AND f.deleted_at IS NULL WHERE r.tag_id = t.id) AS count
             FROM note_tags t WHERE t.user_id = ? ORDER BY t.name',
            [$userId]
        ));
    }

    public static function normalize(mixed $name): ?string
    {
        if (!is_string($name)) {
            return null;
        }
        $n = mb_strtolower(trim(ltrim(trim($name), '#')));
        $n = preg_replace('/[^\p{L}\p{N}_\-]+/u', '-', $n) ?? '';
        $n = trim($n, '-');
        return $n === '' ? null : mb_substr($n, 0, 60);
    }

    /** [relation table, item column] for note / task / file. */
    private static function relation(string $type): array
    {
        return match ($type) {
            'task' => ['task_tag_relations', 'task_id'],
            'file' => ['file_tag_relations', 'file_id'],
            default => ['note_tag_relations', 'note_id'],
        };
    }

    /** Replace the tags of a note or task with the given names (creating tags as needed). */
    public static function sync(string $type, int $itemId, int $userId, mixed $names): void
    {
        [$rel, $col] = self::relation($type);
        $clean = [];
        foreach (is_array($names) ? $names : [] as $n) {
            $n = self::normalize($n);
            if ($n !== null) {
                $clean[$n] = $n;
            }
        }
        $clean = array_slice(array_values($clean), 0, 30);
        DB::run("DELETE FROM `$rel` WHERE `$col` = ?", [$itemId]);
        foreach ($clean as $n) {
            DB::run('INSERT IGNORE INTO note_tags (user_id, name) VALUES (?, ?)', [$userId, $n]);
            $tagId = (int) DB::val('SELECT id FROM note_tags WHERE user_id = ? AND name = ?', [$userId, $n]);
            DB::run("INSERT IGNORE INTO `$rel` (`$col`, tag_id) VALUES (?, ?)", [$itemId, $tagId]);
        }
    }

    /** Map item id => [tag names] for a set of ids. */
    public static function forItems(string $type, array $ids): array
    {
        if (!$ids) {
            return [];
        }
        [$rel, $col] = self::relation($type);
        $out = [];
        foreach (DB::all("SELECT r.`$col` AS item_id, t.name FROM `$rel` r JOIN note_tags t ON t.id = r.tag_id WHERE r.`$col` IN (" . DB::in($ids) . ') ORDER BY t.name', array_values($ids)) as $r) {
            $out[(int) $r['item_id']][] = $r['name'];
        }
        return $out;
    }

    public static function index(): void
    {
        $u = Auth::require();
        Http::ok(self::listFor($u['id']));
    }

    public static function store(): void
    {
        $u = Auth::require();
        $name = self::normalize(Http::input('name'));
        if (!$name) {
            throw new HttpException('Tag name is required.', 422);
        }
        DB::run('INSERT IGNORE INTO note_tags (user_id, name, color) VALUES (?, ?, ?)', [$u['id'], $name, V::color(Http::input('color'))]);
        Http::ok(self::listFor($u['id']));
    }

    public static function update(int $id): void
    {
        $u = Auth::require();
        $data = [];
        if (Http::has('name')) {
            $name = self::normalize(Http::input('name'));
            if (!$name) {
                throw new HttpException('Tag name is required.', 422);
            }
            if (DB::val('SELECT id FROM note_tags WHERE user_id = ? AND name = ? AND id <> ?', [$u['id'], $name, $id])) {
                throw new HttpException('A tag with this name already exists.', 422);
            }
            $data['name'] = $name;
        }
        if (Http::has('color')) {
            $data['color'] = V::color(Http::input('color'));
        }
        DB::update('note_tags', $data, 'id = ? AND user_id = ?', [$id, $u['id']]);
        Http::ok(self::listFor($u['id']));
    }

    public static function destroy(int $id): void
    {
        $u = Auth::require();
        DB::run('DELETE FROM note_tags WHERE id = ? AND user_id = ?', [$id, $u['id']]);
        Http::ok(self::listFor($u['id']));
    }
}
