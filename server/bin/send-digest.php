<?php
declare(strict_types=1);
require dirname(__DIR__) . '/src/bootstrap.php';
require dirname(__DIR__) . '/src/templates.php';
require dirname(__DIR__) . '/src/mailer.php';
require dirname(__DIR__) . '/src/matcher.php';
require dirname(__DIR__) . '/src/tenant.php';
require dirname(__DIR__) . '/src/http.php';
require dirname(__DIR__) . '/src/routes.php';

$which = $argv[1] ?? '';
if (!in_array($which, ['daily', 'weekly'], true)) {
    fwrite(STDERR, "Usage: php send-digest.php daily|weekly\n");
    exit(2);
}
$bids = feed_bids();
$pdo = app_db();
$stmt = $pdo->prepare("SELECT * FROM subscribers WHERE status = 'active' AND frequency = ?");
$stmt->execute([$which]);
$sent = 0;
foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $row) {
    $interests = [
        'keywords' => $row['keywords'],
        'naics' => $row['naics'],
        'states' => $row['states'],
        'sources' => $row['sources'],
    ];
    $matched = [];
    foreach ($bids as $bid) {
        $posted = strtotime((string) ($bid['posted'] ?? '')) ?: 0;
        $since = strtotime((string) ($row['last_digest_at'] ?? '')) ?: 0;
        if ($since && $posted && $posted < $since) {
            continue;
        }
        if (!match_bid($bid, $interests)) {
            continue;
        }
        $matched[] = $bid;
        if (count($matched) >= 25) {
            break;
        }
    }
    if (!$matched) {
        $pdo->prepare('UPDATE subscribers SET last_digest_at = ? WHERE id = ?')->execute([gmdate('c'), $row['id']]);
        continue;
    }
    $tenant = tenant_load((string) $row['tenant']);
    $unsub = unsub_link($tenant, (string) $row['unsub_token']);
    $mail = render_digest($tenant, $matched, $unsub, $which);
    if (mail_send(['to' => $row['email'], 'subject' => $mail['subject'], 'text' => $mail['text'], 'html' => $mail['html'], 'listUnsubscribe' => $unsub, 'fromName' => $tenant['brand']])) {
        $pdo->prepare('UPDATE subscribers SET last_digest_at = ? WHERE id = ?')->execute([gmdate('c'), $row['id']]);
        $sent++;
    }
}
fwrite(STDOUT, "digest {$which} sent {$sent}\n");
