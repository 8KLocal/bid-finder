<?php
declare(strict_types=1);
require dirname(__DIR__) . '/src/bootstrap.php';

$pdo = app_db();
$now = time();
$rows = $pdo->prepare('SELECT token, path FROM file_tokens WHERE expires_at < ?');
$rows->execute([$now]);
$n = 0;
foreach ($rows->fetchAll(PDO::FETCH_ASSOC) as $row) {
    if (is_file($row['path'])) {
        unlink($row['path']);
    }
    $pdo->prepare('DELETE FROM file_tokens WHERE token = ?')->execute([$row['token']]);
    $n++;
}
fwrite(STDOUT, "purged {$n}\n");
