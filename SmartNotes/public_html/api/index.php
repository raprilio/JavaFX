<?php
/**
 * SmartNotes JSON API front controller.
 * Called as: api/index.php?route=notes/12  (works without mod_rewrite).
 */
declare(strict_types=1);

require dirname(__DIR__) . '/app/bootstrap.php';

Http::securityHeaders();

if (!Config::isInstalled()) {
    Http::error('SmartNotes is not installed yet. Open /install to set it up.', 503);
}

try {
    Auth::startSession();
    $method = Http::method();
    if ($method === 'HEAD') {
        $method = 'GET';
    }
    if ($method !== 'GET' && $method !== 'POST') {
        throw new HttpException('Method not allowed.', 405);
    }
    $route = trim((string) ($_GET['route'] ?? ''), '/');
    if ($route === '' || strlen($route) > 200) {
        throw new HttpException('Not found.', 404);
    }

    $routes = require SN_APP_DIR . '/routes.php';
    $matched = null;
    $params = [];
    $methodMismatch = false;
    foreach ($routes as [$m, $pattern, $handler, $access]) {
        $regex = '#^' . strtr(preg_quote($pattern, '#'), [
            '\{id\}' => '(\d+)',
            '\{type\}' => '([a-z_\-]+)',
            '\{name\}' => '([A-Za-z0-9._\-]+)',
        ]) . '$#';
        if (preg_match($regex, $route, $mm)) {
            if ($m !== $method) {
                $methodMismatch = true;
                continue;
            }
            $matched = [$handler, $access];
            $params = array_slice($mm, 1);
            break;
        }
    }
    if (!$matched) {
        throw new HttpException($methodMismatch ? 'Method not allowed.' : 'Not found.', $methodMismatch ? 405 : 404);
    }

    [$handler, $access] = $matched;
    if ($method === 'POST') {
        Csrf::verify();
    }
    if ($access === 'auth') {
        Auth::require();
    } elseif ($access !== 'public') {
        Auth::requirePermission($access);
    }

    [$class, $fn] = explode('::', $handler);
    $args = array_map(static fn($p) => ctype_digit($p) ? (int) $p : $p, $params);
    $class::$fn(...$args);
    Http::ok();
} catch (HttpException $e) {
    Http::error($e->getMessage(), $e->getCode() ?: 400, $e->errors);
} catch (PDOException $e) {
    error_log('[SmartNotes] DB error: ' . $e->getMessage() . ' @ ' . $e->getFile() . ':' . $e->getLine());
    $msg = Config::get('app.debug') ? 'Database error: ' . $e->getMessage() : 'A database error occurred. Please try again.';
    Http::error($msg, 500);
} catch (Throwable $e) {
    error_log('[SmartNotes] ' . get_class($e) . ': ' . $e->getMessage() . ' @ ' . $e->getFile() . ':' . $e->getLine());
    $msg = Config::get('app.debug') ? $e->getMessage() . ' @ ' . basename($e->getFile()) . ':' . $e->getLine() : 'Something went wrong. Please try again.';
    Http::error($msg, 500);
}
