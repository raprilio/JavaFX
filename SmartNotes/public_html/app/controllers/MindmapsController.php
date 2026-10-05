<?php
declare(strict_types=1);

defined('SN_APP') || exit;

/**
 * Mind maps: nodes & edges are stored relationally (mindmap_nodes / mindmap_edges).
 * Saving sends the whole graph; nodes are upserted by their stable `node_key`.
 */
final class MindmapsController
{
    private const MAX_NODES = 3000;

    public static function index(): void
    {
        $u = Auth::require();
        $params = [$u['id']];
        $where = 'm.user_id = ? AND m.deleted_at IS NULL';
        if ($q = V::str(Http::query('q'), 100)) {
            $where .= ' AND (m.title LIKE ? OR m.description LIKE ?)';
            $like = '%' . addcslashes($q, '%_\\') . '%';
            array_push($params, $like, $like);
        }
        $rows = DB::all(
            "SELECT m.id, m.title, m.description, m.created_at, m.updated_at, m.last_opened_at,
                    (SELECT COUNT(*) FROM mindmap_nodes n WHERE n.mindmap_id = m.id) AS node_count,
                    (SELECT n.label FROM mindmap_nodes n WHERE n.mindmap_id = m.id AND n.parent_id IS NULL ORDER BY n.id LIMIT 1) AS root_label
             FROM mindmaps m WHERE $where ORDER BY m.updated_at DESC LIMIT 500",
            $params
        );
        foreach ($rows as &$r) {
            $r['id'] = (int) $r['id'];
            $r['node_count'] = (int) $r['node_count'];
        }
        Http::ok($rows);
    }

    private static function find(int $id, int $userId): array
    {
        $m = DB::one('SELECT * FROM mindmaps WHERE id = ? AND user_id = ? AND deleted_at IS NULL', [$id, $userId]);
        if (!$m) {
            throw new HttpException('Mind map not found.', 404);
        }
        return $m;
    }

    public static function payload(int $id, int $userId): array
    {
        $m = self::find($id, $userId);
        $nodes = DB::all('SELECT * FROM mindmap_nodes WHERE mindmap_id = ? ORDER BY sort_order, id', [$id]);
        $keyById = [];
        foreach ($nodes as $n) {
            $keyById[(int) $n['id']] = $n['node_key'];
        }
        $outNodes = array_map(static fn($n) => [
            'key' => $n['node_key'],
            'parent' => $n['parent_id'] ? ($keyById[(int) $n['parent_id']] ?? null) : null,
            'label' => $n['label'],
            'x' => (float) $n['position_x'],
            'y' => (float) $n['position_y'],
            'w' => $n['width'] !== null ? (float) $n['width'] : null,
            'h' => $n['height'] !== null ? (float) $n['height'] : null,
            'color' => $n['color'],
            'icon' => $n['icon'],
            'notes' => $n['notes'],
            'collapsed' => (bool) $n['collapsed'],
            'order' => (int) $n['sort_order'],
        ], $nodes);
        $edges = array_map(static fn($e) => [
            'source' => $keyById[(int) $e['source_node_id']] ?? null,
            'target' => $keyById[(int) $e['target_node_id']] ?? null,
            'type' => $e['edge_type'],
            'label' => $e['label'],
        ], DB::all('SELECT * FROM mindmap_edges WHERE mindmap_id = ? ORDER BY id', [$id]));
        return [
            'id' => (int) $m['id'],
            'title' => $m['title'],
            'description' => $m['description'],
            'viewport' => json_decode_array($m['viewport']) ?: null,
            'created_at' => $m['created_at'],
            'updated_at' => $m['updated_at'],
            'nodes' => $outNodes,
            'edges' => array_values(array_filter($edges, static fn($e) => $e['source'] && $e['target'])),
        ];
    }

    public static function show(int $id): void
    {
        $u = Auth::require();
        self::find($id, $u['id']);
        DB::run('UPDATE mindmaps SET last_opened_at = NOW(), updated_at = updated_at WHERE id = ?', [$id]);
        Http::ok(self::payload($id, $u['id']));
    }

    public static function store(): void
    {
        $u = Auth::require();
        $title = V::str(Http::input('title'), 255) ?? 'Untitled mind map';
        $id = DB::tx(static function () use ($u, $title) {
            $id = DB::insert('mindmaps', ['user_id' => $u['id'], 'title' => $title, 'description' => V::str(Http::input('description'), 2000)]);
            DB::insert('mindmap_nodes', ['mindmap_id' => $id, 'node_key' => 'root', 'label' => $title, 'position_x' => 0, 'position_y' => 0, 'color' => '#6366f1']);
            return $id;
        });
        Activity::log('mindmap.create', 'mindmap', $id, $title);
        Http::ok(self::payload($id, $u['id']));
    }

    public static function save(int $id): void
    {
        $u = Auth::require();
        self::find($id, $u['id']);
        $in = Http::body();
        DB::tx(static function () use ($id, $in) {
            $meta = [];
            if (array_key_exists('title', $in)) {
                $meta['title'] = V::str($in['title'], 255) ?? 'Untitled mind map';
            }
            if (array_key_exists('description', $in)) {
                $meta['description'] = V::str($in['description'], 2000);
            }
            if (isset($in['viewport']) && is_array($in['viewport'])) {
                $meta['viewport'] = json_encode([
                    'x' => round(V::float($in['viewport']['x'] ?? 0), 2),
                    'y' => round(V::float($in['viewport']['y'] ?? 0), 2),
                    'zoom' => max(0.1, min(4, V::float($in['viewport']['zoom'] ?? 1, 1))),
                ]);
            }
            $meta['updated_at'] = now();
            DB::update('mindmaps', $meta, 'id = ?', [$id]);
            if (isset($in['nodes']) && is_array($in['nodes'])) {
                self::saveGraph($id, $in['nodes'], is_array($in['edges'] ?? null) ? $in['edges'] : []);
            }
        });
        Http::ok(['id' => $id, 'updated_at' => now()]);
    }

    public static function saveGraph(int $mapId, array $nodes, array $edges): void
    {
        if (count($nodes) > self::MAX_NODES) {
            throw new HttpException('A mind map can contain at most ' . self::MAX_NODES . ' nodes.', 422);
        }
        $existing = [];
        foreach (DB::all('SELECT id, node_key FROM mindmap_nodes WHERE mindmap_id = ?', [$mapId]) as $r) {
            $existing[$r['node_key']] = (int) $r['id'];
        }
        $idByKey = [];
        $parents = [];
        foreach (array_values($nodes) as $i => $n) {
            $key = V::token($n['key'] ?? null);
            if (!$key || isset($idByKey[$key])) {
                continue;
            }
            $row = [
                'label' => mb_substr((string) V::str($n['label'] ?? '', 500), 0, 500) ?: '',
                'position_x' => round(max(-1e6, min(1e6, V::float($n['x'] ?? 0))), 2),
                'position_y' => round(max(-1e6, min(1e6, V::float($n['y'] ?? 0))), 2),
                'width' => isset($n['w']) && is_numeric($n['w']) ? round((float) $n['w'], 2) : null,
                'height' => isset($n['h']) && is_numeric($n['h']) ? round((float) $n['h'], 2) : null,
                'color' => V::color($n['color'] ?? null),
                'icon' => V::token($n['icon'] ?? null),
                'notes' => V::str($n['notes'] ?? null, 10000),
                'collapsed' => V::bool($n['collapsed'] ?? false),
                'sort_order' => V::int($n['order'] ?? $i, -100000, 100000) ?? $i,
            ];
            if (isset($existing[$key])) {
                DB::update('mindmap_nodes', $row, 'id = ?', [$existing[$key]]);
                $idByKey[$key] = $existing[$key];
            } else {
                $idByKey[$key] = DB::insert('mindmap_nodes', $row + ['mindmap_id' => $mapId, 'node_key' => $key]);
            }
            $parents[$key] = V::token($n['parent'] ?? null);
        }
        foreach ($parents as $key => $pKey) {
            $pid = ($pKey && isset($idByKey[$pKey]) && $pKey !== $key) ? $idByKey[$pKey] : null;
            DB::run('UPDATE mindmap_nodes SET parent_id = ? WHERE id = ?', [$pid, $idByKey[$key]]);
        }
        $removed = array_diff_key($existing, $idByKey);
        if ($removed) {
            $ids = array_values($removed);
            DB::run('UPDATE mindmap_nodes SET parent_id = NULL WHERE mindmap_id = ? AND parent_id IN (' . DB::in($ids) . ')', array_merge([$mapId], $ids));
            DB::run('DELETE FROM mindmap_nodes WHERE mindmap_id = ? AND id IN (' . DB::in($ids) . ')', array_merge([$mapId], $ids));
        }

        // Edges: tree edges mirror parent links; extra "link" edges connect any two nodes.
        DB::run('DELETE FROM mindmap_edges WHERE mindmap_id = ?', [$mapId]);
        foreach ($parents as $key => $pKey) {
            if ($pKey && isset($idByKey[$pKey]) && $pKey !== $key) {
                DB::insert('mindmap_edges', ['mindmap_id' => $mapId, 'source_node_id' => $idByKey[$pKey], 'target_node_id' => $idByKey[$key], 'edge_type' => 'tree']);
            }
        }
        $seen = [];
        foreach (array_slice($edges, 0, self::MAX_NODES) as $e) {
            if (!is_array($e) || ($e['type'] ?? 'link') !== 'link') {
                continue;
            }
            $s = V::token($e['source'] ?? null);
            $t = V::token($e['target'] ?? null);
            if (!$s || !$t || $s === $t || !isset($idByKey[$s], $idByKey[$t]) || isset($seen["$s|$t"])) {
                continue;
            }
            $seen["$s|$t"] = true;
            DB::insert('mindmap_edges', [
                'mindmap_id' => $mapId, 'source_node_id' => $idByKey[$s], 'target_node_id' => $idByKey[$t],
                'edge_type' => 'link', 'label' => V::str($e['label'] ?? null, 255),
            ]);
        }
    }

    public static function duplicate(int $id): void
    {
        $u = Auth::require();
        $src = self::payload($id, $u['id']);
        $newId = DB::tx(static function () use ($u, $src) {
            $newId = DB::insert('mindmaps', [
                'user_id' => $u['id'],
                'title' => mb_substr($src['title'] . ' (copy)', 0, 255),
                'description' => $src['description'],
                'viewport' => $src['viewport'] ? json_encode($src['viewport']) : null,
            ]);
            self::saveGraph($newId, $src['nodes'], $src['edges']);
            return $newId;
        });
        Activity::log('mindmap.duplicate', 'mindmap', $newId, 'Duplicated mind map #' . $id);
        Http::ok(self::payload($newId, $u['id']));
    }
}
