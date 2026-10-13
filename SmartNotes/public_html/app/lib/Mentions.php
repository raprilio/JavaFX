<?php
declare(strict_types=1);

defined('SN_APP') || exit;

/**
 * @mentions in note text (v1.16). The editor writes <span class="sn-mention" data-user-id="5">@Name</span>;
 * on every save the set of mentioned users is mirrored into note_mentions, so notes can be filtered by person.
 * Newly mentioned users who can open the note get a notification that jumps to their name.
 */
final class Mentions
{
    private const MAX = 100;

    /** User ids mentioned in sanitized note HTML. */
    public static function ids(string $html): array
    {
        if (!str_contains($html, 'sn-mention')) {
            return [];
        }
        preg_match_all('/<span\b[^>]*\bclass="[^"]*\bsn-mention\b[^"]*"[^>]*>/i', $html, $tags);
        $ids = [];
        foreach ($tags[0] as $tag) {
            if (preg_match('/\bdata-user-id="(\d{1,10})"/', $tag, $m)) {
                $ids[(int) $m[1]] = true;
            }
        }
        return array_slice(array_keys($ids), 0, self::MAX);
    }

    public static function sync(int $noteId, string $html, int $byUser): void
    {
        $want = self::ids($html);
        if ($want) {
            // Only real, active accounts count.
            $want = array_map('intval', DB::col("SELECT id FROM users WHERE status = 'active' AND deleted_at IS NULL AND id IN (" . DB::in($want) . ')', $want));
        }
        $have = array_map('intval', DB::col('SELECT user_id FROM note_mentions WHERE note_id = ?', [$noteId]));
        $gone = array_values(array_diff($have, $want));
        $new = array_values(array_diff($want, $have));
        if ($gone) {
            DB::run('DELETE FROM note_mentions WHERE note_id = ? AND user_id IN (' . DB::in($gone) . ')', array_merge([$noteId], $gone));
        }
        if (!$new) {
            return;
        }
        foreach ($new as $uid) {
            DB::run('INSERT IGNORE INTO note_mentions (note_id, user_id, mentioned_by) VALUES (?, ?, ?)', [$noteId, $uid, $byUser]);
        }
        $note = DB::one('SELECT id, user_id, title, is_locked FROM notes WHERE id = ?', [$noteId]);
        if (!$note || (int) $note['is_locked']) {
            return;
        }
        $by = (string) DB::val('SELECT name FROM users WHERE id = ?', [$byUser]);
        $title = $note['title'] !== '' ? $note['title'] : 'Tanpa judul';
        foreach ($new as $uid) {
            if ($uid === $byUser) {
                continue;
            }
            // People who cannot open the note are not told about it (the owner is offered to share it instead).
            if ($uid !== (int) $note['user_id'] && !NotesController::readableBy($noteId, $uid)) {
                continue;
            }
            Notify::create($uid, 'mention', '@ ' . $by . ' menyebut Anda di catatan "' . $title . '"', self::context($html, $uid), '#/notes/' . $noteId . '?mention=' . $uid);
        }
    }

    /** The paragraph around the first mention of a user, as plain text (notification preview). */
    private static function context(string $html, int $uid): ?string
    {
        $pos = strpos($html, 'data-user-id="' . $uid . '"');
        if ($pos === false) {
            return null;
        }
        $start = max(0, (int) strrpos(substr($html, 0, $pos), '<p'), (int) strrpos(substr($html, 0, $pos), '<li'), (int) strrpos(substr($html, 0, $pos), '<td'));
        $end = $pos;
        foreach (['</p>', '</li>', '</td>'] as $close) {
            $e = strpos($html, $close, $pos);
            if ($e !== false) {
                $end = $end === $pos ? $e : min($end, $e);
            }
        }
        $text = Sanitizer::text(substr($html, $start, max(0, $end - $start) + 5));
        return $text !== '' ? mb_substr($text, 0, 180) : null;
    }

    /** Names of the people mentioned in each note (for list cards). */
    public static function forNotes(array $noteIds): array
    {
        if (!$noteIds) {
            return [];
        }
        $out = [];
        foreach (DB::all('SELECT m.note_id, u.id, u.name FROM note_mentions m JOIN users u ON u.id = m.user_id WHERE m.note_id IN (' . DB::in($noteIds) . ') ORDER BY u.name', $noteIds) as $r) {
            $out[(int) $r['note_id']][] = ['id' => (int) $r['id'], 'name' => $r['name']];
        }
        return $out;
    }

    /** People mentioned in any note this user can see (for the people filter). */
    public static function people(int $userId): array
    {
        return array_map(static fn($r) => ['id' => (int) $r['id'], 'name' => $r['name'], 'count' => (int) $r['c']], DB::all(
            'SELECT u.id, u.name, COUNT(*) AS c FROM note_mentions m JOIN notes n ON n.id = m.note_id AND n.deleted_at IS NULL
               JOIN users u ON u.id = m.user_id
             WHERE n.user_id = ? OR EXISTS (SELECT 1 FROM note_shares s WHERE s.note_id = n.id AND s.user_id = ?) OR (n.pinned_global = 1 AND n.is_locked = 0)
             GROUP BY u.id, u.name ORDER BY c DESC, u.name LIMIT 100',
            [$userId, $userId]
        ));
    }
}
