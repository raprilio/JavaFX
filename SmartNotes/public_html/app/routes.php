<?php
/**
 * API routes: [METHOD, pattern, handler, access]
 * access: 'public' | 'auth' | '<permission>' (see Auth::PERMISSIONS)
 * Patterns: {id} = numeric id, {type} / {name} = token.
 */
declare(strict_types=1);

defined('SN_APP') || exit;

return [
    // App & auth
    ['GET', 'app', 'AppController::bootstrap', 'public'],
    ['POST', 'auth/login', 'AuthController::login', 'public'],
    ['POST', 'auth/logout', 'AuthController::logout', 'public'],
    ['POST', 'auth/register', 'AuthController::register', 'public'],
    ['POST', 'auth/forgot', 'AuthController::forgot', 'public'],
    ['POST', 'auth/reset', 'AuthController::reset', 'public'],

    // Profile & personal settings
    ['POST', 'profile', 'ProfileController::update', 'auth'],
    ['POST', 'profile/avatar', 'ProfileController::uploadAvatar', 'auth'],
    ['POST', 'profile/avatar/remove', 'ProfileController::removeAvatar', 'auth'],
    ['GET', 'profile/avatar/{id}', 'ProfileController::avatar', 'auth'],
    ['POST', 'profile/password', 'ProfileController::password', 'auth'],
    ['POST', 'profile/settings', 'ProfileController::saveSettings', 'auth'],
    ['POST', 'profile/background', 'ProfileController::uploadBackground', 'auth'],
    ['POST', 'profile/background/remove', 'ProfileController::removeBackground', 'auth'],
    ['GET', 'profile/background', 'ProfileController::background', 'auth'],
    ['GET', 'profile/sessions', 'ProfileController::sessions', 'auth'],
    ['POST', 'profile/sessions/{id}/revoke', 'ProfileController::revokeSession', 'auth'],
    ['POST', 'profile/sessions/revoke-all', 'ProfileController::revokeAllSessions', 'auth'],
    ['GET', 'profile/storage', 'ProfileController::storage', 'auth'],
    ['GET', 'profile/export', 'ProfileController::export', 'auth'],
    ['POST', 'profile/import', 'ProfileController::import', 'auth'],

    ['GET', 'dashboard', 'DashboardController::index', 'auth'],

    // Notes
    ['GET', 'notes', 'NotesController::index', 'auth'],
    ['POST', 'notes', 'NotesController::store', 'auth'],
    ['POST', 'notes/bulk', 'NotesController::bulk', 'auth'],
    ['GET', 'notes/{id}', 'NotesController::show', 'auth'],
    ['POST', 'notes/{id}', 'NotesController::update', 'auth'],
    ['POST', 'notes/{id}/duplicate', 'NotesController::duplicate', 'auth'],
    ['GET', 'notes/{id}/shares', 'SharesController::index', 'auth'],
    ['POST', 'notes/{id}/shares', 'SharesController::store', 'auth'],
    ['POST', 'notes/{id}/shares/{id}/remove', 'SharesController::remove', 'auth'],
    ['POST', 'notes/{id}/share-pin', 'SharesController::pin', 'auth'],
    ['POST', 'notes/{id}/lock', 'NotesController::lock', 'auth'],
    ['GET', 'notes-pin', 'NotesPinController::status', 'auth'],
    ['POST', 'notes-pin', 'NotesPinController::save', 'auth'],
    ['POST', 'notes-pin/remove', 'NotesPinController::remove', 'auth'],
    ['POST', 'notes-pin/unlock', 'NotesPinController::unlock', 'auth'],
    ['POST', 'notes-pin/lock', 'NotesPinController::lockNow', 'auth'],
    ['POST', 'notes/{id}/leave', 'SharesController::leave', 'auth'],
    ['GET', 'notes/{id}/related-files', 'DriveController::relatedFiles', 'auth'],
    ['GET', 'users/directory', 'SharesController::directory', 'auth'],

    // Drive
    ['GET', 'drive', 'DriveController::index', 'auth'],
    ['GET', 'drive/folders', 'DriveController::folders', 'auth'],
    ['POST', 'drive/folders', 'DriveController::createFolder', 'auth'],
    ['POST', 'drive/folders/{id}', 'DriveController::updateFolder', 'auth'],
    ['POST', 'drive/folders/{id}/delete', 'DriveController::deleteFolder', 'auth'],
    ['POST', 'drive/move', 'DriveController::move', 'auth'],
    ['GET', 'files/{id}/related', 'DriveController::relatedNotes', 'auth'],

    // Categories & tags
    ['GET', 'categories', 'CategoriesController::index', 'auth'],
    ['POST', 'categories', 'CategoriesController::store', 'auth'],
    ['POST', 'categories/reorder', 'CategoriesController::reorder', 'auth'],
    ['POST', 'categories/{id}', 'CategoriesController::update', 'auth'],
    ['POST', 'categories/{id}/delete', 'CategoriesController::destroy', 'auth'],
    ['GET', 'tags', 'TagsController::index', 'auth'],
    ['POST', 'tags', 'TagsController::store', 'auth'],
    ['POST', 'tags/{id}', 'TagsController::update', 'auth'],
    ['POST', 'tags/{id}/delete', 'TagsController::destroy', 'auth'],

    // Files
    ['GET', 'files', 'FilesController::index', 'auth'],
    ['POST', 'files/upload', 'FilesController::upload', 'auth'],
    ['GET', 'files/{id}', 'FilesController::show', 'auth'],
    ['GET', 'files/{id}/raw', 'FilesController::raw', 'auth'],
    ['GET', 'files/{id}/thumb', 'FilesController::thumb', 'auth'],
    ['GET', 'files/{id}/download', 'FilesController::download', 'auth'],
    ['POST', 'files/{id}', 'FilesController::update', 'auth'],
    ['POST', 'files/{id}/rotate', 'FilesController::rotate', 'auth'],

    // Audio
    ['GET', 'audio', 'AudioController::index', 'auth'],
    ['POST', 'audio/upload', 'AudioController::upload', 'auth'],
    ['GET', 'audio/{id}/raw', 'AudioController::raw', 'auth'],
    ['POST', 'audio/{id}', 'AudioController::update', 'auth'],

    // Tasks
    ['GET', 'tasks', 'TasksController::index', 'auth'],
    ['POST', 'tasks', 'TasksController::store', 'auth'],
    ['POST', 'tasks/reorder', 'TasksController::reorder', 'auth'],
    ['GET', 'tasks/{id}', 'TasksController::show', 'auth'],
    ['POST', 'tasks/{id}', 'TasksController::update', 'auth'],
    ['POST', 'tasks/{id}/status', 'TasksController::status', 'auth'],
    ['POST', 'tasks/{id}/move', 'TasksController::move', 'auth'],

    // Calendar & events
    ['GET', 'calendar', 'EventsController::feed', 'auth'],
    ['POST', 'events', 'EventsController::store', 'auth'],
    ['GET', 'events/{id}', 'EventsController::show', 'auth'],
    ['POST', 'events/{id}', 'EventsController::update', 'auth'],
    ['POST', 'events/{id}/move', 'EventsController::move', 'auth'],

    // Meetings
    ['GET', 'meetings', 'MeetingsController::index', 'auth'],
    ['POST', 'meetings', 'MeetingsController::store', 'auth'],
    ['GET', 'meetings/{id}', 'MeetingsController::show', 'auth'],
    ['POST', 'meetings/{id}', 'MeetingsController::update', 'auth'],
    ['POST', 'meetings/{id}/minutes', 'MeetingsController::minutes', 'auth'],
    ['POST', 'meetings/{id}/move', 'MeetingsController::move', 'auth'],
    ['GET', 'meetings/{id}/shares', 'MeetingsController::shares', 'auth'],
    ['POST', 'meetings/{id}/shares', 'MeetingsController::share', 'auth'],
    ['POST', 'meetings/{id}/shares/{id}/remove', 'MeetingsController::unshare', 'auth'],

    // Mind maps
    ['GET', 'mindmaps', 'MindmapsController::index', 'auth'],
    ['POST', 'mindmaps', 'MindmapsController::store', 'auth'],
    ['GET', 'mindmaps/{id}', 'MindmapsController::show', 'auth'],
    ['POST', 'mindmaps/{id}', 'MindmapsController::save', 'auth'],
    ['POST', 'mindmaps/{id}/duplicate', 'MindmapsController::duplicate', 'auth'],

    // Flowcharts
    ['GET', 'flowcharts', 'FlowchartsController::index', 'auth'],
    ['POST', 'flowcharts', 'FlowchartsController::store', 'auth'],
    ['GET', 'flowcharts/{id}', 'FlowchartsController::show', 'auth'],
    ['POST', 'flowcharts/{id}', 'FlowchartsController::save', 'auth'],
    ['POST', 'flowcharts/{id}/duplicate', 'FlowchartsController::duplicate', 'auth'],

    // Trash (generic for every type)
    ['GET', 'trash', 'TrashController::index', 'auth'],
    ['POST', 'trash/empty', 'TrashController::emptyAll', 'auth'],
    ['POST', 'items/{type}/{id}/trash', 'TrashController::trash', 'auth'],
    ['POST', 'items/{type}/{id}/restore', 'TrashController::restore', 'auth'],
    ['POST', 'items/{type}/{id}/destroy', 'TrashController::destroy', 'auth'],

    // Search & notifications
    ['GET', 'search', 'SearchController::index', 'auth'],
    ['GET', 'notifications', 'NotificationsController::index', 'auth'],
    ['POST', 'notifications/read', 'NotificationsController::read', 'auth'],
    ['POST', 'notifications/clear', 'NotificationsController::clear', 'auth'],

    // Admin
    // Admin mailbox (Hostinger Mail API) — MailController enforces the full admin role.
    ['GET', 'mail/status', 'MailController::status', 'auth'],
    ['POST', 'mail/settings', 'MailController::saveSettings', 'auth'],
    ['GET', 'mail/folders', 'MailController::folders', 'auth'],
    ['GET', 'mail/messages', 'MailController::messages', 'auth'],
    ['GET', 'mail/message', 'MailController::message', 'auth'],
    ['GET', 'mail/html', 'MailController::html', 'auth'],
    ['GET', 'mail/attachment', 'MailController::attachment', 'auth'],
    ['GET', 'mail/source', 'MailController::source', 'auth'],
    ['POST', 'mail/flags', 'MailController::flags', 'auth'],
    ['POST', 'mail/move', 'MailController::move', 'auth'],
    ['POST', 'mail/delete', 'MailController::delete', 'auth'],
    ['POST', 'mail/send', 'MailController::send', 'auth'],
    ['POST', 'mail/save-to-drive', 'MailController::saveToDrive', 'auth'],
    ['GET', 'admin/stats', 'AdminController::stats', 'view_stats'],
    ['GET', 'admin/activity', 'AdminController::activity', 'view_stats'],
    ['GET', 'admin/users', 'AdminController::users', 'manage_users'],
    ['POST', 'admin/users', 'AdminController::createUser', 'manage_users'],
    ['POST', 'admin/users/{id}', 'AdminController::updateUser', 'manage_users'],
    ['POST', 'admin/users/{id}/delete', 'AdminController::deleteUser', 'manage_users'],
    ['POST', 'admin/users/{id}/logout', 'AdminController::forceLogout', 'manage_users'],
    ['GET', 'admin/settings', 'AdminController::settings', 'manage_settings'],
    ['POST', 'admin/settings', 'AdminController::saveSettings', 'manage_settings'],
    ['POST', 'admin/branding/{type}', 'AdminController::uploadBranding', 'manage_branding'],
    ['POST', 'admin/branding/{type}/remove', 'AdminController::removeBranding', 'manage_branding'],
    ['POST', 'admin/branding-text', 'AdminController::saveBrandingText', 'manage_branding'],
    ['GET', 'admin/email', 'AdminController::email', 'manage_email'],
    ['POST', 'admin/email', 'AdminController::saveEmail', 'manage_email'],
    ['POST', 'admin/email/test', 'AdminController::testEmail', 'manage_email'],
    ['GET', 'admin/email/logs', 'AdminController::emailLogs', 'manage_email'],
    ['POST', 'admin/email/{id}/retry', 'AdminController::retryEmail', 'manage_email'],
    ['POST', 'admin/scheduler/run', 'AdminController::runScheduler', 'manage_email'],
    ['GET', 'admin/categories', 'AdminController::categories', 'manage_categories'],
    ['POST', 'admin/categories', 'AdminController::saveCategories', 'manage_categories'],
    ['GET', 'admin/backups', 'AdminController::backups', 'manage_backup'],
    ['POST', 'admin/backups', 'AdminController::createBackup', 'manage_backup'],
    ['GET', 'admin/backups/{name}/download', 'AdminController::downloadBackup', 'manage_backup'],
    ['POST', 'admin/backups/{name}/delete', 'AdminController::deleteBackup', 'manage_backup'],
    ['POST', 'admin/backups/{name}/restore', 'AdminController::restoreBackup', 'manage_backup'],
    ['POST', 'admin/restore-upload', 'AdminController::restoreUpload', 'manage_backup'],
    ['GET', 'admin/users/{id}/export', 'AdminController::exportUser', 'manage_backup'],
];
