<?php
declare(strict_types=1);

defined('SN_APP') || exit;

/**
 * Drive folders linked to a note (v1.14): the note shows the folder's files, so related documents are one click away.
 * Only the note owner links / unlinks (own folders or folders shared with them). Anyone who can read the note sees
 * the folder card, but its files only when they may open the folder themselves (owner or folder shared with them):
 * linking a folder to a shared note never exposes files.
 */
final class NoteFoldersController
{
    private const MAX = 20;

    /** Folder access for a user: 'owner', 'shared' or null. */
    private static function access(array $folder, int $userId): ?string
    {
        if ((int) $folder['user_id'] === $userId) {
            return 'owner';
        }
        return Shares::folderShared((int) $folder['id'], $userId) ? 'shared' : null;
    }

    /** Linked folders of a note, for anyone who can read the note. */
    public static function index(int $id): void
    {
        $u = Auth::require();
        [$note] = NotesController::access($id, $u['id']);
        if (NoteLock::hides($note, $u['id'])) {
            Http::ok([]);
        }
        Http::ok(self::forNote($id, (int) $u['id']));
    }

    public static function forNote(int $noteId, int $userId): array
    {
        $rows = DB::all(
            'SELECT f.*, o.name AS owner_name, l.created_at AS linked_at,
                    (SELECT COUNT(*) FROM note_attachments a WHERE a.folder_id = f.id AND a.deleted_at IS NULL) AS file_count,
                    (SELECT COUNT(*) FROM drive_folders c WHERE c.parent_id = f.id) AS folder_count
             FROM note_folders l JOIN drive_folders f ON f.id = l.folder_id JOIN users o ON o.id = f.user_id
             WHERE l.note_id = ? ORDER BY l.created_at',
            [$noteId]
        );
        return array_map(static function ($f) use ($userId) {
            $access = self::access($f, $userId);
            return [
                'id' => (int) $f['id'], 'name' => $f['name'], 'color' => $f['color'], 'owner_name' => $f['owner_name'],
                'mine' => (int) $f['user_id'] === $userId, 'access' => $access,
                // Counts reveal nothing sensitive, but stay hidden when the folder is not open to this user.
                'file_count' => $access ? (int) $f['file_count'] : null,
                'folder_count' => $access ? (int) $f['folder_count'] : null,
                'linked_at' => $f['linked_at'],
            ];
        }, $rows);
    }

    public static function store(int $id): void
    {
        $u = Auth::require();
        $note = NotesController::find($id, $u['id']); // owner only
        if (NoteLock::hides($note, $u['id'])) {
            throw new HttpException('This note is locked. Enter your notes PIN first.', 423, ['locked' => true]);
        }
        $fid = V::id(Http::input('folder_id')) ?? throw new HttpException('Choose a folder.', 422, ['folder_id' => true]);
        $folder = DB::one('SELECT * FROM drive_folders WHERE id = ?', [$fid]);
        if (!$folder || !self::access($folder, (int) $u['id'])) {
            throw new HttpException('Folder not found.', 404);
        }
        if ((int) DB::val('SELECT COUNT(*) FROM note_folders WHERE note_id = ?', [$id]) >= self::MAX) {
            throw new HttpException('A note can link up to ' . self::MAX . ' folders.', 422);
        }
        DB::run('INSERT IGNORE INTO note_folders (note_id, folder_id, user_id) VALUES (?, ?, ?)', [$id, $fid, $u['id']]);
        Activity::log('note.folder_link', 'note', $id, 'Linked Drive folder "' . $folder['name'] . '"');
        Http::ok(self::forNote($id, (int) $u['id']));
    }

    public static function destroy(int $id, int $folderId): void
    {
        $u = Auth::require();
        NotesController::find($id, $u['id']);
        DB::run('DELETE FROM note_folders WHERE note_id = ? AND folder_id = ?', [$id, $folderId]);
        Http::ok(self::forNote($id, (int) $u['id']));
    }

    /** Drive side: my notes that link this folder (shown above the folder's files). */
    public static function notesOfFolder(int $folderId): void
    {
        $u = Auth::require();
        Http::ok(array_map(static fn($n) => ['id' => (int) $n['id'], 'title' => $n['title'] !== '' ? $n['title'] : 'Untitled'], DB::all(
            'SELECT n.id, n.title FROM note_folders l JOIN notes n ON n.id = l.note_id
             WHERE l.folder_id = ? AND n.user_id = ? AND n.deleted_at IS NULL AND n.purged_at IS NULL ORDER BY n.updated_at DESC LIMIT 20',
            [$folderId, $u['id']]
        )));
    }

    /** Copy the links when a note is duplicated. */
    public static function copy(int $from, int $to, int $userId): void
    {
        DB::run('INSERT IGNORE INTO note_folders (note_id, folder_id, user_id) SELECT ?, folder_id, ? FROM note_folders WHERE note_id = ?', [$to, $userId, $from]);
    }
}
