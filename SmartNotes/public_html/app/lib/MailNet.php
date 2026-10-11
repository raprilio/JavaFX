<?php
declare(strict_types=1);

defined('SN_APP') || exit;

/**
 * Users type in their own IMAP/SMTP server names, so the app must not become a door into the hosting's
 * internal network (SSRF): private, loopback and reserved addresses are refused unless the config allows them.
 */
final class MailNet
{
    /**
     * Resolve and check a host; returns the address to connect to (an IP, so a second DNS lookup cannot
     * point somewhere else — the name is still used for TLS verification).
     */
    public static function resolve(string $host): string
    {
        $host = strtolower(trim($host));
        if ($host === '' || strlen($host) > 190 || !preg_match('/^[a-z0-9.\-]+$/', $host)) {
            throw new HttpException('Invalid server name.', 422, ['host' => true]);
        }
        if (Config::get('imap.allow_private_hosts', false)) {
            return $host;
        }
        $ips = filter_var($host, FILTER_VALIDATE_IP) ? [$host] : (gethostbynamel($host) ?: []);
        if (!$ips) {
            throw new HttpException('The server name ' . $host . ' could not be found.', 422, ['host' => true]);
        }
        foreach ($ips as $ip) {
            if (!filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE)) {
                throw new HttpException('Servers on private or local networks are not allowed.', 422, ['host' => true]);
            }
        }
        return str_contains($ips[0], ':') ? '[' . $ips[0] . ']' : $ips[0];
    }
}
