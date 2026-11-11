<?php
declare(strict_types=1);

require dirname(__DIR__) . '/src/bootstrap.php';
require dirname(__DIR__) . '/src/http.php';
require dirname(__DIR__) . '/src/templates.php';
require dirname(__DIR__) . '/src/mailer.php';
require dirname(__DIR__) . '/src/matcher.php';
require dirname(__DIR__) . '/src/tenant.php';
require dirname(__DIR__) . '/src/address.php';
require dirname(__DIR__) . '/src/pdf.php';
require dirname(__DIR__) . '/src/stripe.php';
require dirname(__DIR__) . '/src/letterstream.php';
require dirname(__DIR__) . '/src/grok.php';
require dirname(__DIR__) . '/src/routes.php';

$path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
$path = '/' . ltrim($path, '/');
if ($path === '/index.php') {
    $path = '/';
}
route_dispatch($_SERVER['REQUEST_METHOD'] ?? 'GET', $path);
