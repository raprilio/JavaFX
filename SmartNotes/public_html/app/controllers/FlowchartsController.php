<?php
declare(strict_types=1);

defined('SN_APP') || exit;

/**
 * Flowcharts: nodes & edges stored relationally (flowchart_nodes / flowchart_edges).
 */
final class FlowchartsController
{
    private const TYPES = ['start', 'end', 'process', 'decision', 'input', 'output', 'database', 'document', 'connector'];
    private const PORTS = ['top', 'right', 'bottom', 'left'];
    private const MAX_NODES = 2000;

    public static function index(): void
    {
        $u = Auth::require();
        $params = [$u['id']];
        $where = 'f.user_id = ? AND f.deleted_at IS NULL';
        if ($q = V::str(Http::query('q'), 100)) {
            $where .= ' AND (f.title LIKE ? OR f.description LIKE ?)';
            $like = '%' . addcslashes($q, '%_\\') . '%';
            array_push($params, $like, $like);
        }
        $rows = DB::all(
            "SELECT f.id, f.title, f.description, f.created_at, f.updated_at, f.last_opened_at,
                    (SELECT COUNT(*) FROM flowchart_nodes n WHERE n.flowchart_id = f.id) AS node_count,
                    (SELECT COUNT(*) FROM flowchart_edges e WHERE e.flowchart_id = f.id) AS edge_count
             FROM flowcharts f WHERE $where ORDER BY f.updated_at DESC LIMIT 500",
            $params
        );
        foreach ($rows as &$r) {
            $r['id'] = (int) $r['id'];
            $r['node_count'] = (int) $r['node_count'];
            $r['edge_count'] = (int) $r['edge_count'];
        }
        Http::ok($rows);
    }

    private static function find(int $id, int $userId): array
    {
        $f = DB::one('SELECT * FROM flowcharts WHERE id = ? AND user_id = ? AND deleted_at IS NULL', [$id, $userId]);
        if (!$f) {
            throw new HttpException('Flowchart not found.', 404);
        }
        return $f;
    }

    public static function payload(int $id, int $userId): array
    {
        $f = self::find($id, $userId);
        $keyById = [];
        $nodes = [];
        foreach (DB::all('SELECT * FROM flowchart_nodes WHERE flowchart_id = ? ORDER BY id', [$id]) as $n) {
            $keyById[(int) $n['id']] = $n['node_key'];
            $nodes[] = [
                'key' => $n['node_key'],
                'type' => $n['node_type'],
                'label' => $n['label'],
                'x' => (float) $n['position_x'],
                'y' => (float) $n['position_y'],
                'w' => (float) $n['width'],
                'h' => (float) $n['height'],
                'style' => json_decode_array($n['configuration_json']) ?: new stdClass(),
            ];
        }
        $edges = [];
        foreach (DB::all('SELECT * FROM flowchart_edges WHERE flowchart_id = ? ORDER BY id', [$id]) as $e) {
            if (!isset($keyById[(int) $e['source_node_id']], $keyById[(int) $e['target_node_id']])) {
                continue;
            }
            $edges[] = [
                'key' => $e['edge_key'],
                'source' => $keyById[(int) $e['source_node_id']],
                'target' => $keyById[(int) $e['target_node_id']],
                'sourcePort' => $e['source_port'],
                'targetPort' => $e['target_port'],
                'label' => $e['label'],
                'style' => json_decode_array($e['configuration_json']) ?: new stdClass(),
            ];
        }
        return [
            'id' => (int) $f['id'],
            'title' => $f['title'],
            'description' => $f['description'],
            'viewport' => json_decode_array($f['viewport']) ?: null,
            'settings' => json_decode_array($f['settings_json']) ?: ['grid' => true, 'snap' => true],
            'created_at' => $f['created_at'],
            'updated_at' => $f['updated_at'],
            'nodes' => $nodes,
            'edges' => $edges,
        ];
    }

    public static function show(int $id): void
    {
        $u = Auth::require();
        self::find($id, $u['id']);
        DB::run('UPDATE flowcharts SET last_opened_at = NOW(), updated_at = updated_at WHERE id = ?', [$id]);
        Http::ok(self::payload($id, $u['id']));
    }

    public static function store(): void
    {
        $u = Auth::require();
        $title = V::str(Http::input('title'), 255) ?? 'Untitled flowchart';
        $id = DB::tx(static function () use ($u, $title) {
            $id = DB::insert('flowcharts', [
                'user_id' => $u['id'], 'title' => $title, 'description' => V::str(Http::input('description'), 2000),
                'settings_json' => json_encode(['grid' => true, 'snap' => true]),
            ]);
            $s = DB::insert('flowchart_nodes', ['flowchart_id' => $id, 'node_key' => 'n1', 'node_type' => 'start', 'label' => 'Start', 'position_x' => 0, 'position_y' => 0, 'width' => 140, 'height' => 56]);
            $p = DB::insert('flowchart_nodes', ['flowchart_id' => $id, 'node_key' => 'n2', 'node_type' => 'process', 'label' => 'Process', 'position_x' => 0, 'position_y' => 120, 'width' => 160, 'height' => 64]);
            DB::insert('flowchart_edges', ['flowchart_id' => $id, 'edge_key' => 'e1', 'source_node_id' => $s, 'target_node_id' => $p, 'source_port' => 'bottom', 'target_port' => 'top']);
            return $id;
        });
        Activity::log('flowchart.create', 'flowchart', $id, $title);
        Http::ok(self::payload($id, $u['id']));
    }

    public static function save(int $id): void
    {
        $u = Auth::require();
        self::find($id, $u['id']);
        $in = Http::body();
        DB::tx(static function () use ($id, $in) {
            $meta = ['updated_at' => now()];
            if (array_key_exists('title', $in)) {
                $meta['title'] = V::str($in['title'], 255) ?? 'Untitled flowchart';
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
            if (isset($in['settings']) && is_array($in['settings'])) {
                $meta['settings_json'] = json_encode(['grid' => (bool) ($in['settings']['grid'] ?? true), 'snap' => (bool) ($in['settings']['snap'] ?? true)]);
            }
            DB::update('flowcharts', $meta, 'id = ?', [$id]);
            if (isset($in['nodes']) && is_array($in['nodes'])) {
                self::saveGraph($id, $in['nodes'], is_array($in['edges'] ?? null) ? $in['edges'] : []);
            }
        });
        Http::ok(['id' => $id, 'updated_at' => now()]);
    }

    private static function style(mixed $s): ?string
    {
        if (!is_array($s)) {
            return null;
        }
        $out = [];
        foreach (['fill', 'stroke', 'text'] as $k) {
            if ($c = V::color($s[$k] ?? null)) {
                $out[$k] = $c;
            }
        }
        if (isset($s['dashed'])) {
            $out['dashed'] = (bool) $s['dashed'];
        }
        return $out ? json_encode($out) : null;
    }

    public static function saveGraph(int $chartId, array $nodes, array $edges): void
    {
        if (count($nodes) > self::MAX_NODES) {
            throw new HttpException('A flowchart can contain at most ' . self::MAX_NODES . ' shapes.', 422);
        }
        $existing = [];
        foreach (DB::all('SELECT id, node_key FROM flowchart_nodes WHERE flowchart_id = ?', [$chartId]) as $r) {
            $existing[$r['node_key']] = (int) $r['id'];
        }
        $idByKey = [];
        foreach ($nodes as $n) {
            if (!is_array($n)) {
                continue;
            }
            $key = V::token($n['key'] ?? null);
            if (!$key || isset($idByKey[$key])) {
                continue;
            }
            $row = [
                'node_type' => V::enum($n['type'] ?? 'process', self::TYPES, 'process'),
                'label' => (string) (V::str($n['label'] ?? '', 500) ?? ''),
                'position_x' => round(max(-1e6, min(1e6, V::float($n['x'] ?? 0))), 2),
                'position_y' => round(max(-1e6, min(1e6, V::float($n['y'] ?? 0))), 2),
                'width' => round(max(20, min(2000, V::float($n['w'] ?? 140, 140))), 2),
                'height' => round(max(20, min(2000, V::float($n['h'] ?? 64, 64))), 2),
                'configuration_json' => self::style($n['style'] ?? null),
            ];
            if (isset($existing[$key])) {
                DB::update('flowchart_nodes', $row, 'id = ?', [$existing[$key]]);
                $idByKey[$key] = $existing[$key];
            } else {
                $idByKey[$key] = DB::insert('flowchart_nodes', $row + ['flowchart_id' => $chartId, 'node_key' => $key]);
            }
        }
        DB::run('DELETE FROM flowchart_edges WHERE flowchart_id = ?', [$chartId]);
        $removed = array_values(array_diff_key($existing, $idByKey));
        if ($removed) {
            DB::run('DELETE FROM flowchart_nodes WHERE flowchart_id = ? AND id IN (' . DB::in($removed) . ')', array_merge([$chartId], $removed));
        }
        $keys = [];
        foreach (array_slice($edges, 0, self::MAX_NODES * 3) as $e) {
            if (!is_array($e)) {
                continue;
            }
            $s = V::token($e['source'] ?? null);
            $t = V::token($e['target'] ?? null);
            $k = V::token($e['key'] ?? null) ?? ('e' . bin2hex(random_bytes(4)));
            if (!$s || !$t || $s === $t || !isset($idByKey[$s], $idByKey[$t]) || isset($keys[$k])) {
                continue;
            }
            $keys[$k] = true;
            DB::insert('flowchart_edges', [
                'flowchart_id' => $chartId,
                'edge_key' => $k,
                'source_node_id' => $idByKey[$s],
                'target_node_id' => $idByKey[$t],
                'source_port' => V::enum($e['sourcePort'] ?? 'bottom', self::PORTS, 'bottom'),
                'target_port' => V::enum($e['targetPort'] ?? 'top', self::PORTS, 'top'),
                'label' => V::str($e['label'] ?? null, 255),
                'configuration_json' => self::style($e['style'] ?? null),
            ]);
        }
    }

    public static function duplicate(int $id): void
    {
        $u = Auth::require();
        $src = self::payload($id, $u['id']);
        $newId = DB::tx(static function () use ($u, $src) {
            $newId = DB::insert('flowcharts', [
                'user_id' => $u['id'],
                'title' => mb_substr($src['title'] . ' (copy)', 0, 255),
                'description' => $src['description'],
                'viewport' => $src['viewport'] ? json_encode($src['viewport']) : null,
                'settings_json' => json_encode($src['settings']),
            ]);
            self::saveGraph($newId, $src['nodes'], $src['edges']);
            return $newId;
        });
        Activity::log('flowchart.duplicate', 'flowchart', $newId, 'Duplicated flowchart #' . $id);
        Http::ok(self::payload($newId, $u['id']));
    }
}
