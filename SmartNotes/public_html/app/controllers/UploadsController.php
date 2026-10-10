<?php
declare(strict_types=1);

defined('SN_APP') || exit;

/** Chunked uploads of large files (see ChunkUpload). The finished file is attached by files/upload or audio/upload with upload_token. */
final class UploadsController
{
    public static function chunk(): void
    {
        $u = Auth::require();
        Http::ok(ChunkUpload::receive($u['id'], $_POST, $_FILES['chunk'] ?? null));
    }

    public static function cancel(): void
    {
        $u = Auth::require();
        ChunkUpload::cancel($u['id'], (string) ($_POST['upload_token'] ?? Http::input('upload_token') ?? ''));
        Http::ok();
    }
}
