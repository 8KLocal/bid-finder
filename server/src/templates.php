<?php
declare(strict_types=1);

function email_footer(array $tenant): string
{
    $address = $tenant['address'] ?? 'ITS WORKPLACE INC, 1261 Broadway, 2FL Suite IT, New York, NY 10001';
    $line = $tenant['offshoreLine'] ?? "It's Workplace is our offshore team handling the business.";
    return $address . "\n" . $line;
}

function email_wrap(string $text, array $tenant, string $unsubUrl): array
{
    $footer = email_footer($tenant);
    $plain = rtrim($text) . "\n\n---\n" . $footer . "\nUnsubscribe: " . $unsubUrl . "\n";
    $html = '<div style="font-family:Georgia,serif;color:#1b1b1b;line-height:1.5">'
        . nl2br(htmlspecialchars($text, ENT_QUOTES, 'UTF-8'))
        . '<hr style="border:0;border-top:4px solid #9b2335;margin:24px 0 12px">'
        . '<p style="color:#4d5968;font-size:13px">' . nl2br(htmlspecialchars($footer, ENT_QUOTES, 'UTF-8')) . '</p>'
        . '<p style="color:#4d5968;font-size:13px"><a href="' . htmlspecialchars($unsubUrl, ENT_QUOTES, 'UTF-8') . '">Unsubscribe</a></p>'
        . '</div>';
    return [$plain, $html];
}

function render_welcome(array $tenant, string $confirmUrl, string $unsubUrl): array
{
    $brand = $tenant['brand'] ?? "It's Workplace";
    $text = "Welcome to {$brand}.\n\nConfirm this address to get bid digests: {$confirmUrl}\n\nYou will not get a digest until you confirm. Each note has a one-click unsubscribe.";
    [$plain, $html] = email_wrap($text, $tenant, $unsubUrl);
    return ['subject' => "Confirm your {$brand} bid alerts", 'text' => $plain, 'html' => $html];
}

function render_digest(array $tenant, array $bids, string $unsubUrl, string $frequency): array
{
    $brand = $tenant['brand'] ?? "It's Workplace";
    $lines = ["New public bids for your {$frequency} {$brand} alert.", ""];
    foreach ($bids as $bid) {
        $lines[] = $bid['title'] ?? '';
        $lines[] = trim(($bid['agency'] ?? '') . ' · ' . ($bid['state'] ?? '') . ' · due ' . ($bid['deadline'] ?? 'see notice'));
        $lines[] = $bid['url'] ?? '';
        $lines[] = '';
    }
    $lines[] = "These are public notices we could read. This is not every U.S. bid. Confirm details on the official page.";
    [$plain, $html] = email_wrap(implode("\n", $lines), $tenant, $unsubUrl);
    return ['subject' => "{$brand} {$frequency} bids (" . count($bids) . ")", 'text' => $plain, 'html' => $html];
}

function render_paid_customer(array $tenant, array $order): array
{
    $brand = $tenant['brand'] ?? "It's Workplace";
    $text = "We received your payment of " . money_cents((int) $order['amount_cents']) . " for AI bid writing.\n\n"
        . ($order['title'] ?? '') . "\n\n"
        . "AI draft, review before submitting. Grok wrote a draft from the public notice and the profile you sent. Our team reviews it before you treat it as finished. "
        . "There is no guarantee of an award. The price is for the draft, not for winning the contract.\n\n"
        . "It's Workplace is our offshore team handling the business.\n\n"
        . ($order['draft'] ?? '');
    $unsub = unsub_link($tenant, (string) ($order['unsub_token'] ?? ''));
    [$plain, $html] = email_wrap($text, $tenant, $unsub);
    return ['subject' => "{$brand} draft: " . ($order['title'] ?? 'your bid'), 'text' => $plain, 'html' => $html];
}

function render_paid_ops(array $tenant, array $order): array
{
    $text = "Paid bid ready for review.\n\nTenant: " . ($order['tenant'] ?? '') . "\nEmail: " . ($order['email'] ?? '')
        . "\nBid: " . ($order['title'] ?? '') . "\nAmount: " . money_cents((int) $order['amount_cents'])
        . "\n\nGrok drafted it. Please review and finish. We do the bid for them.\n\n" . ($order['draft'] ?? '');
    [$plain, $html] = email_wrap($text, $tenant, unsub_link($tenant, ''));
    return ['subject' => 'Paid bid to review: ' . ($order['title'] ?? ''), 'text' => $plain, 'html' => $html];
}

function render_mail_customer(array $tenant, array $order): array
{
    $detail = json_decode((string) ($order['detail'] ?? '{}'), true) ?: [];
    $text = "We received payment and handed your letter to the mail service.\n\nJob: " . ($detail['job_id'] ?? '')
        . "\nClass: " . ($detail['mailClass'] ?? '') . "\n\nWe do not guarantee a delivery time or a bid award. Deadlines are yours to meet."
        . " A notarized document still needs a third-party notary before you upload it.";
    [$plain, $html] = email_wrap($text, $tenant, unsub_link($tenant, (string) ($order['unsub_token'] ?? '')));
    return ['subject' => "Mail accepted: " . ($order['title'] ?? 'your letter'), 'text' => $plain, 'html' => $html];
}

function render_mail_ops_failure(array $tenant, array $order, string $error): array
{
    $text = "Mail job failed after payment. Nothing was sent to the postal service if the provider rejected the job.\n\n"
        . ($order['email'] ?? '') . "\n" . ($order['title'] ?? '') . "\n" . $error;
    [$plain, $html] = email_wrap($text, $tenant, unsub_link($tenant, ''));
    return ['subject' => 'Mail failure: ' . ($order['title'] ?? ''), 'text' => $plain, 'html' => $html];
}

function render_claim_ops(array $tenant, array $claim): array
{
    $text = "A visitor claimed a public bid in the browser.\n\nTenant: " . ($claim['tenant'] ?? '')
        . "\n" . ($claim['title'] ?? '') . "\n" . ($claim['agency'] ?? '') . "\nDue: " . ($claim['deadline'] ?? '')
        . "\nEmail: " . ($claim['contact_email'] ?? '') . "\n\nNothing was submitted to a government portal.";
    [$plain, $html] = email_wrap($text, $tenant, unsub_link($tenant, ''));
    return ['subject' => 'Claim: ' . ($claim['title'] ?? 'bid'), 'text' => $plain, 'html' => $html];
}

function money_cents(int $cents): string
{
    return '$' . number_format($cents / 100, 2);
}

function unsub_link(array $tenant, string $token): string
{
    $base = rtrim((string) (app_config()['app_base_url'] ?? ''), '/');
    if ($token === '') {
        return $base . '/legal.html';
    }
    return $base . '/api/unsubscribe?token=' . rawurlencode($token) . '&tenant=' . rawurlencode((string) ($tenant['slug'] ?? 'itsworkplace'));
}
