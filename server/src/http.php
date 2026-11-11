<?php
declare(strict_types=1);

function http_origin_ok(?string $origin): bool
{
    if (!$origin) {
        return true;
    }
    $allowed = app_config()['allowed_origins'] ?? [];
    return in_array($origin, $allowed, true);
}

function http_cors(): void
{
    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
    if ($origin && http_origin_ok($origin)) {
        header('Access-Control-Allow-Origin: ' . $origin);
        header('Vary: Origin');
        header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
        header('Access-Control-Allow-Headers: Content-Type');
    }
    header('Cache-Control: no-store');
    header('X-Content-Type-Options: nosniff');
}

function http_json(int $status, array $body): void
{
    http_cors();
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($body, JSON_UNESCAPED_UNICODE);
}

function http_read_json(): array
{
    $raw = file_get_contents('php://input') ?: '';
    if ($raw === '') {
        return [];
    }
    $data = json_decode($raw, true);
    return is_array($data) ? $data : [];
}

function http_client_ip(): string
{
    return substr((string) ($_SERVER['REMOTE_ADDR'] ?? '0.0.0.0'), 0, 64);
}

function rate_limit(string $bucket, int $max, int $windowSec): bool
{
    $pdo = app_db();
    $now = time();
    $key = $bucket;
    $stmt = $pdo->prepare('SELECT hits, reset_at FROM rate_limits WHERE bucket = ?');
    $stmt->execute([$key]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$row || (int) $row['reset_at'] < $now) {
        $pdo->prepare('REPLACE INTO rate_limits (bucket, hits, reset_at) VALUES (?, 1, ?)')->execute([$key, $now + $windowSec]);
        return true;
    }
    if ((int) $row['hits'] >= $max) {
        return false;
    }
    $pdo->prepare('UPDATE rate_limits SET hits = hits + 1 WHERE bucket = ?')->execute([$key]);
    return true;
}

function valid_email(string $email): bool
{
    return (bool) filter_var($email, FILTER_VALIDATE_EMAIL) && strlen($email) <= 160;
}
