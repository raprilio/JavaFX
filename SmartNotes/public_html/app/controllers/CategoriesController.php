<?php
declare(strict_types=1);

defined('SN_APP') || exit;

final class CategoriesController
{
    private static function table(mixed $type): string
    {
        return $type === 'task' ? 'task_categories' : 'note_categories';
    }

    public static function listFor(string $type, int $userId): array
    {
        $t = self::table($type);
        $countSql = $type === 'task'
            ? '(SELECT COUNT(*) FROM tasks x WHERE x.category_id = c.id AND x.deleted_at IS NULL)'
            : '(SELECT COUNT(*) FROM notes x WHERE x.category_id = c.id AND x.deleted_at IS NULL)';
        return array_map(static function ($r) {
            $r['id'] = (int) $r['id'];
            $r['count'] = (int) $r['count'];
            return $r;
        }, DB::all("SELECT c.id, c.name, c.color, c.icon, c.sort_order, $countSql AS count FROM `$t` c WHERE c.user_id = ? ORDER BY c.sort_order, c.name", [$userId]));
    }

    public static function ownedId(string $type, mixed $id, int $userId): ?int
    {
        $id = V::id($id);
        if (!$id) {
            return null;
        }
        $t = self::table($type);
        return DB::val("SELECT id FROM `$t` WHERE id = ? AND user_id = ?", [$id, $userId]) ? $id : null;
    }

    public static function index(): void
    {
        $u = Auth::require();
        Http::ok(['note' => self::listFor('note', $u['id']), 'task' => self::listFor('task', $u['id'])]);
    }

    public static function store(): void
    {
        $u = Auth::require();
        $type = Http::input('type') === 'task' ? 'task' : 'note';
        $t = self::table($type);
        $name = V::str(Http::input('name'), 80, true, 'name');
        if (DB::val("SELECT id FROM `$t` WHERE user_id = ? AND name = ?", [$u['id'], $name])) {
            throw new HttpException('A category with this name already exists.', 422, ['name' => 'taken']);
        }
        $order = (int) DB::val("SELECT COALESCE(MAX(sort_order), 0) + 1 FROM `$t` WHERE user_id = ?", [$u['id']]);
        $id = DB::insert($t, [
            'user_id' => $u['id'],
            'name' => $name,
            'color' => V::color(Http::input('color')) ?? '#6366f1',
            'icon' => V::token(Http::input('icon')) ?? 'folder',
            'sort_order' => $order,
        ]);
        Http::ok(['id' => $id, 'list' => self::listFor($type, $u['id'])]);
    }

    public static function update(int $id): void
    {
        $u = Auth::require();
        $type = Http::input('type') === 'task' ? 'task' : 'note';
        $t = self::table($type);
        $data = [];
        if (Http::has('name')) {
            $data['name'] = V::str(Http::input('name'), 80, true, 'name');
            if (DB::val("SELECT id FROM `$t` WHERE user_id = ? AND name = ? AND id <> ?", [$u['id'], $data['name'], $id])) {
                throw new HttpException('A category with this name already exists.', 422, ['name' => 'taken']);
            }
        }
        if (Http::has('color')) {
            $data['color'] = V::color(Http::input('color')) ?? '#6366f1';
        }
        if (Http::has('icon')) {
            $data['icon'] = V::token(Http::input('icon')) ?? 'folder';
        }
        if (!DB::val("SELECT id FROM `$t` WHERE id = ? AND user_id = ?", [$id, $u['id']])) {
            throw new HttpException('Category not found.', 404);
        }
        DB::update($t, $data, 'id = ? AND user_id = ?', [$id, $u['id']]);
        Http::ok(['list' => self::listFor($type, $u['id'])]);
    }

    public static function destroy(int $id): void
    {
        $u = Auth::require();
        $type = Http::input('type') === 'task' ? 'task' : 'note';
        $t = self::table($type);
        DB::run("DELETE FROM `$t` WHERE id = ? AND user_id = ?", [$id, $u['id']]);
        Http::ok(['list' => self::listFor($type, $u['id'])]);
    }

    public static function reorder(): void
    {
        $u = Auth::require();
        $type = Http::input('type') === 'task' ? 'task' : 'note';
        $t = self::table($type);
        foreach (V::ids(Http::input('ids')) as $i => $id) {
            DB::update($t, ['sort_order' => $i], 'id = ? AND user_id = ?', [$id, $u['id']]);
        }
        Http::ok(['list' => self::listFor($type, $u['id'])]);
    }
}
