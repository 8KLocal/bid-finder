<?php
declare(strict_types=1);
require dirname(__DIR__) . '/src/bootstrap.php';
require dirname(__DIR__) . '/src/templates.php';
require dirname(__DIR__) . '/src/mailer.php';
require dirname(__DIR__) . '/src/tenant.php';
require dirname(__DIR__) . '/src/http.php';

$pdo = app_db();
$rows = $pdo->query("SELECT * FROM subscribers WHERE status = 'pending' AND welcome_sent_at IS NULL")->fetchAll(PDO::FETCH_ASSOC);
$base = rtrim((string) app_config()['app_base_url'], '/');
$sent = 0;
foreach ($rows as $row) {
    $tenant = tenant_load((string) $row['tenant']);
    $confirmUrl = $base . '/api/confirm?token=' . rawurlencode((string) $row['confirm_token']) . '&tenant=' . rawurlencode($tenant['slug']);
    $unsubUrl = unsub_link($tenant, (string) $row['unsub_token']);
    $mail = render_welcome($tenant, $confirmUrl, $unsubUrl);
    if (mail_send(['to' => $row['email'], 'subject' => $mail['subject'], 'text' => $mail['text'], 'html' => $mail['html'], 'listUnsubscribe' => $unsubUrl, 'fromName' => $tenant['brand']])) {
        $pdo->prepare('UPDATE subscribers SET welcome_sent_at = ? WHERE id = ?')->execute([gmdate('c'), $row['id']]);
        $sent++;
    }
}
fwrite(STDOUT, "welcome sent {$sent}\n");
