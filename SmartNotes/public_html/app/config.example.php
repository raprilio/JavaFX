<?php
/**
 * SmartNotes configuration.
 *
 * The web installer (/install) creates app/config.php for you.
 * To configure manually: copy this file to app/config.php and fill in the values.
 * Never commit app/config.php to version control.
 */
return [
    'app' => [
        // Public URL of the app, with trailing slash. Used for links in e-mails sent by cron.
        'url' => 'https://notes.example.com/',
        // Long random secret used to encrypt stored secrets (e.g. SMTP password).
        // Generate one with: php -r "echo bin2hex(random_bytes(32));"
        // Do NOT change it after installation, or saved SMTP passwords become unreadable.
        'key' => 'CHANGE_ME_TO_A_LONG_RANDOM_STRING',
        'debug' => false,              // true shows detailed errors and loads unminified JS
        'timezone' => 'Asia/Jakarta',
        'trust_proxy' => false,        // true if behind Cloudflare / a reverse proxy
    ],

    'db' => [
        'host' => 'localhost',
        'port' => 3306,
        'name' => 'u123456789_smartnotes',
        'user' => 'u123456789_smartnotes',
        'pass' => 'your-database-password',
    ],

    // Optional: define SMTP here instead of in Admin → Email.
    // When 'host' is non-empty these values override the admin panel.
    'smtp' => [
        'host' => '',                  // e.g. smtp.hostinger.com / smtp.gmail.com / smtp.office365.com
        'port' => 465,
        'username' => '',
        'password' => '',
        'encryption' => 'ssl',         // ssl (465) | tls (587) | none
        'from_email' => '',
        'from_name' => 'SmartNotes',
    ],

    'cron' => [
        // Secret for https://your-domain/cron.php?token=... (leave empty to allow CLI only)
        'token' => 'CHANGE_ME_RANDOM_TOKEN',
    ],

    // Optional: move the private storage folder (backups, logs, sessions) outside public_html.
    // 'paths' => [
    //     'storage' => '/home/USER/smartnotes-storage',
    // ],
];
