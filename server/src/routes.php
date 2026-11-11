<?php
declare(strict_types=1);

function route_dispatch(string $method, string $path): void
{
    if ($method === 'OPTIONS') {
        http_cors();
        http_response_code(204);
        return;
    }
    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
    if ($origin && !http_origin_ok($origin)) {
        http_json(403, ['error' => 'This origin is not allowed.']);
        return;
    }
    if ($path === '/api/health' && $method === 'GET') {
        $cfg = app_config();
        http_json(200, ['ok' => true, 'letterstreamTest' => !empty($cfg['letterstream_test']), 'grok' => !empty($cfg['xai_key'])]);
        return;
    }
    if ($path === '/api/signup' && $method === 'POST') {
        route_signup();
        return;
    }
    if ($path === '/api/confirm' && $method === 'GET') {
        route_confirm();
        return;
    }
    if ($path === '/api/preferences' && $method === 'POST') {
        route_preferences();
        return;
    }
    if ($path === '/api/unsubscribe' && ($method === 'GET' || $method === 'POST')) {
        route_unsubscribe();
        return;
    }
    if ($path === '/api/claim' && $method === 'POST') {
        route_claim();
        return;
    }
    if (($path === '/api/checkout' || $path === '/api/checkout/bid') && $method === 'POST') {
        route_checkout_bid();
        return;
    }
    if ($path === '/api/checkout/mail' && $method === 'POST') {
        route_checkout_mail();
        return;
    }
    if ($path === '/api/stripe/webhook' && $method === 'POST') {
        route_webhook();
        return;
    }
    if ($path === '/api/orders/status' && $method === 'GET') {
        route_order_status();
        return;
    }
    if ($path === '/api/mail/quote' && $method === 'POST') {
        route_quote();
        return;
    }
    if ($path === '/api/mail/upload' && $method === 'POST') {
        route_upload();
        return;
    }
    if ($path === '/api/mail/file' && $method === 'GET') {
        route_mail_file();
        return;
    }
    if ($path === '/api/draft' && $method === 'POST') {
        route_draft();
        return;
    }
    http_json(404, ['error' => 'No such API route.']);
}

function route_signup(): void
{
    if (!rate_limit('signup:' . http_client_ip(), 5, 3600)) {
        http_json(429, ['error' => 'Too many signups from this network. Try again later.']);
        return;
    }
    $body = http_read_json();
    $email = strtolower(trim((string) ($body['email'] ?? '')));
    $company = trim((string) ($body['company'] ?? ''));
    $frequency = ($body['frequency'] ?? '') === 'weekly' ? 'weekly' : 'daily';
    if (!valid_email($email) || strlen($company) > 120) {
        http_json(400, ['error' => 'Enter a valid email and a company name under 120 characters.']);
        return;
    }
    $tenant = tenant_load((string) ($body['tenant'] ?? 'itsworkplace'));
    $confirm = app_token();
    $unsub = app_token();
    $pdo = app_db();
    $fields = [
        $company,
        app_json_list($body['keywords'] ?? []),
        app_json_list($body['naics'] ?? []),
        app_json_list($body['states'] ?? []),
        app_json_list($body['sources'] ?? []),
        $frequency,
    ];
    $existing = $pdo->prepare('SELECT id FROM subscribers WHERE tenant = ? AND email = ?');
    $existing->execute([$tenant['slug'], $email]);
    $row = $existing->fetch(PDO::FETCH_ASSOC);
    if ($row) {
        $pdo->prepare('UPDATE subscribers SET company = ?, keywords = ?, naics = ?, states = ?, sources = ?, frequency = ?, status = ?, confirm_token = ?, unsub_token = ?, welcome_sent_at = NULL WHERE id = ?')
            ->execute([...$fields, 'pending', $confirm, $unsub, $row['id']]);
    } else {
        $pdo->prepare('INSERT INTO subscribers (tenant, email, company, keywords, naics, states, sources, frequency, status, confirm_token, unsub_token, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
            ->execute([$tenant['slug'], $email, ...$fields, 'pending', $confirm, $unsub, gmdate('c')]);
    }
    $base = rtrim((string) app_config()['app_base_url'], '/');
    $confirmUrl = $base . '/api/confirm?token=' . rawurlencode($confirm) . '&tenant=' . rawurlencode($tenant['slug']);
    $unsubUrl = unsub_link($tenant, $unsub);
    $mail = render_welcome($tenant, $confirmUrl, $unsubUrl);
    $ok = mail_send([
        'to' => $email,
        'subject' => $mail['subject'],
        'text' => $mail['text'],
        'html' => $mail['html'],
        'fromName' => $tenant['emailFrom'] ?? $tenant['brand'],
        'replyTo' => $tenant['replyTo'] ?? null,
        'listUnsubscribe' => $unsubUrl,
    ]);
    if ($ok) {
        $pdo->prepare('UPDATE subscribers SET welcome_sent_at = ? WHERE tenant = ? AND email = ?')->execute([gmdate('c'), $tenant['slug'], $email]);
    }
    http_json(200, ['ok' => true, 'status' => 'pending', 'mailed' => $ok]);
}

function route_confirm(): void
{
    $token = (string) ($_GET['token'] ?? '');
    $pdo = app_db();
    $stmt = $pdo->prepare('SELECT id, status FROM subscribers WHERE confirm_token = ?');
    $stmt->execute([$token]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    header('Content-Type: text/html; charset=utf-8');
    if (!$row) {
        http_response_code(404);
        echo '<p>This confirmation link is not valid.</p>';
        return;
    }
    $pdo->prepare("UPDATE subscribers SET status = 'active', confirmed_at = ? WHERE id = ?")->execute([gmdate('c'), $row['id']]);
    echo '<p>You are confirmed. Bid alerts will use the schedule you picked. You can unsubscribe from any email.</p>';
}

function route_preferences(): void
{
    $body = http_read_json();
    $token = (string) ($body['token'] ?? '');
    $pdo = app_db();
    $stmt = $pdo->prepare('SELECT id FROM subscribers WHERE unsub_token = ? OR confirm_token = ?');
    $stmt->execute([$token, $token]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$row) {
        http_json(404, ['error' => 'Unknown subscriber.']);
        return;
    }
    $frequency = ($body['frequency'] ?? '') === 'weekly' ? 'weekly' : 'daily';
    $pdo->prepare('UPDATE subscribers SET company = ?, keywords = ?, naics = ?, states = ?, sources = ?, frequency = ? WHERE id = ?')->execute([
        trim((string) ($body['company'] ?? '')),
        app_json_list($body['keywords'] ?? []),
        app_json_list($body['naics'] ?? []),
        app_json_list($body['states'] ?? []),
        app_json_list($body['sources'] ?? []),
        $frequency,
        $row['id'],
    ]);
    http_json(200, ['ok' => true]);
}

function route_unsubscribe(): void
{
    $token = (string) ($_GET['token'] ?? ($_POST['token'] ?? ''));
    if ($token === '') {
        $body = http_read_json();
        $token = (string) ($body['token'] ?? '');
    }
    $pdo = app_db();
    $stmt = $pdo->prepare('UPDATE subscribers SET status = ? WHERE unsub_token = ?');
    $stmt->execute(['unsubscribed', $token]);
    if (str_contains((string) ($_SERVER['HTTP_ACCEPT'] ?? ''), 'application/json')) {
        http_json(200, ['ok' => true, 'status' => 'unsubscribed']);
        return;
    }
    header('Content-Type: text/html; charset=utf-8');
    echo '<p>You are unsubscribed. You will not get more bid alerts unless you sign up again.</p>';
}

function route_claim(): void
{
    if (!rate_limit('claim:' . http_client_ip(), 30, 3600)) {
        http_json(429, ['error' => 'Too many claims from this network.']);
        return;
    }
    $body = http_read_json();
    $title = trim((string) ($body['title'] ?? ''));
    $bidId = trim((string) ($body['bidId'] ?? ''));
    if ($title === '' || $bidId === '' || strlen($title) > 300) {
        http_json(400, ['error' => 'A bid id and title are required.']);
        return;
    }
    $tenant = tenant_load((string) ($body['tenant'] ?? 'itsworkplace'));
    $email = trim((string) ($body['contactEmail'] ?? ''));
    if ($email !== '' && !valid_email($email)) {
        http_json(400, ['error' => 'That contact email is not valid.']);
        return;
    }
    $claim = [
        'tenant' => $tenant['slug'],
        'bid_id' => $bidId,
        'title' => $title,
        'agency' => trim((string) ($body['agency'] ?? '')),
        'deadline' => trim((string) ($body['deadline'] ?? '')),
        'contact_email' => $email,
        'claimed_at' => trim((string) ($body['claimedAt'] ?? gmdate('c'))),
    ];
    app_db()->prepare('INSERT INTO claims (tenant, bid_id, title, agency, deadline, contact_email, claimed_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        ->execute([$claim['tenant'], $claim['bid_id'], $claim['title'], $claim['agency'], $claim['deadline'], $claim['contact_email'], $claim['claimed_at'], gmdate('c')]);
    $ops = (string) (app_config()['ops_email'] ?? '');
    if (valid_email($ops)) {
        $mail = render_claim_ops($tenant, $claim);
        mail_send(['to' => $ops, 'subject' => $mail['subject'], 'text' => $mail['text'], 'html' => $mail['html']]);
    }
    http_json(200, ['ok' => true]);
}

function route_checkout_bid(): void
{
    if (!rate_limit('bidpay:' . http_client_ip(), 10, 3600)) {
        http_json(429, ['error' => 'Too many checkout attempts. Try again later.']);
        return;
    }
    $body = http_read_json();
    $email = strtolower(trim((string) ($body['email'] ?? '')));
    $bid = is_array($body['bid'] ?? null) ? $body['bid'] : [];
    $title = trim((string) ($bid['title'] ?? ''));
    if (!valid_email($email) || $title === '') {
        http_json(400, ['error' => 'An email and the bid title are required before checkout.']);
        return;
    }
    $tenant = tenant_load((string) ($body['tenant'] ?? 'itsworkplace'));
    $cents = max(100, (int) $tenant['bidPriceCents']);
    $detail = json_encode([
        'bid' => [
            'id' => (string) ($bid['id'] ?? ''),
            'title' => $title,
            'agency' => (string) ($bid['agency'] ?? ''),
            'state' => (string) ($bid['state'] ?? ''),
            'naics' => (string) ($bid['naics'] ?? ''),
            'posted' => (string) ($bid['posted'] ?? ''),
            'deadline' => (string) ($bid['deadline'] ?? $bid['due'] ?? ''),
            'source' => (string) ($bid['source'] ?? ''),
            'url' => (string) ($bid['url'] ?? $bid['link'] ?? ''),
            'description' => substr((string) ($bid['description'] ?? $bid['summary'] ?? ''), 0, 800),
        ],
        'profile' => [
            'company' => substr((string) ($body['company'] ?? ''), 0, 160),
            'capabilities' => substr((string) ($body['capabilities'] ?? ''), 0, 800),
            'pastPerformance' => substr((string) ($body['pastPerformance'] ?? ''), 0, 800),
            'tone' => substr((string) ($body['tone'] ?? ''), 0, 160),
        ],
    ], JSON_UNESCAPED_UNICODE);
    $pdo = app_db();
    $pdo->prepare('INSERT INTO orders (tenant, kind, email, bid_id, title, amount_cents, status, detail, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        ->execute([$tenant['slug'], 'bid', $email, (string) ($bid['id'] ?? ''), $title, $cents, 'pending', $detail, gmdate('c')]);
    $orderId = (string) $pdo->lastInsertId();
    $site = rtrim((string) app_config()['public_site_url'], '/');
    $product = 'AI bid writing - ' . mb_substr($title, 0, 80);
    $result = stripe_checkout([
        'mode' => 'payment',
        'customer_email' => $email,
        'success_url' => $site . '/?bid_paid=1&session_id={CHECKOUT_SESSION_ID}',
        'cancel_url' => $site . '/?bid_paid=0#bids',
        'client_reference_id' => $orderId,
        'line_items[0][quantity]' => '1',
        'line_items[0][price_data][currency]' => 'usd',
        'line_items[0][price_data][unit_amount]' => (string) $cents,
        'line_items[0][price_data][product_data][name]' => $product,
        'metadata[kind]' => 'bid',
        'metadata[order_id]' => $orderId,
        'metadata[bid_id]' => substr((string) ($bid['id'] ?? ''), 0, 200),
        'metadata[tenant]' => $tenant['slug'],
        'metadata[email]' => $email,
    ]);
    if ($result['status'] === 200 && !empty($result['body']['id'])) {
        $pdo->prepare('UPDATE orders SET stripe_session = ? WHERE id = ?')->execute([$result['body']['id'], $orderId]);
    }
    http_json($result['status'], $result['body'] + ['amountCents' => $cents, 'orderId' => $orderId]);
}

function route_upload(): void
{
    if (!rate_limit('upload:' . http_client_ip(), 20, 3600)) {
        http_json(429, ['error' => 'Too many uploads.']);
        return;
    }
    $dir = app_root() . '/storage/uploads';
    if (!is_dir($dir)) {
        mkdir($dir, 0775, true);
    }
    $token = app_token();
    $dest = $dir . '/' . $token . '.pdf';
    try {
        if (!empty($_FILES['pdf']['tmp_name'])) {
            if (($_FILES['pdf']['size'] ?? 0) > 10485760) {
                throw new InvalidArgumentException('PDF must be under 10 MB.');
            }
            if (!move_uploaded_file($_FILES['pdf']['tmp_name'], $dest)) {
                throw new InvalidArgumentException('Could not store the upload.');
            }
            $pages = pdf_inspect($dest);
        } else {
            $body = http_read_json();
            $text = trim((string) ($body['draft'] ?? ''));
            if ($text === '' || strlen($text) > 200000) {
                throw new InvalidArgumentException('Paste or generate a draft, or upload a PDF.');
            }
            $pages = pdf_from_text($text, $dest);
            $pages = pdf_inspect($dest);
        }
    } catch (InvalidArgumentException $err) {
        if (is_file($dest)) {
            unlink($dest);
        }
        http_json(400, ['error' => $err->getMessage()]);
        return;
    }
    $expires = time() + 86400 * max(1, (int) (app_config()['mail_retention_days'] ?? 14));
    app_db()->prepare('INSERT INTO file_tokens (token, path, expires_at) VALUES (?, ?, ?)')->execute([$token, $dest, $expires]);
    http_json(200, ['uploadId' => $token, 'pages' => $pages]);
}

function route_quote(): void
{
    if (!rate_limit('quote:' . http_client_ip(), 60, 3600)) {
        http_json(429, ['error' => 'Too many quotes.']);
        return;
    }
    $body = http_read_json();
    $pages = (int) ($body['pages'] ?? 1);
    if ($pages < 1 || $pages > 60) {
        http_json(400, ['error' => 'Page count must be between 1 and 60.']);
        return;
    }
    $tenant = tenant_load((string) ($body['tenant'] ?? 'itsworkplace'));
    $class = ($body['mailClass'] ?? '') === 'certified' ? 'certified' : 'firstclass';
    http_json(200, quote_mail($tenant, $pages, $class, !empty($body['returnReceipt'])));
}

function route_checkout_mail(): void
{
    if (!rate_limit('mailpay:' . http_client_ip(), 10, 3600)) {
        http_json(429, ['error' => 'Too many checkout attempts.']);
        return;
    }
    $body = http_read_json();
    $email = strtolower(trim((string) ($body['email'] ?? '')));
    if (!valid_email($email)) {
        http_json(400, ['error' => 'Enter the email that should get the receipt.']);
        return;
    }
    try {
        $to = normalize_us_address(is_array($body['to'] ?? null) ? $body['to'] : []);
        $from = normalize_us_address(is_array($body['from'] ?? null) ? $body['from'] : []);
    } catch (InvalidArgumentException $err) {
        http_json(400, ['error' => $err->getMessage()]);
        return;
    }
    $token = (string) ($body['uploadId'] ?? '');
    $pdo = app_db();
    $stmt = $pdo->prepare('SELECT path, expires_at FROM file_tokens WHERE token = ?');
    $stmt->execute([$token]);
    $file = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$file || (int) $file['expires_at'] < time() || !is_file($file['path'])) {
        http_json(400, ['error' => 'Upload the letter again. That file is missing or expired.']);
        return;
    }
    try {
        $pages = pdf_inspect($file['path']);
    } catch (InvalidArgumentException $err) {
        http_json(400, ['error' => $err->getMessage()]);
        return;
    }
    $tenant = tenant_load((string) ($body['tenant'] ?? 'itsworkplace'));
    $class = ($body['mailClass'] ?? '') === 'certified' ? 'certified' : 'firstclass';
    $quote = quote_mail($tenant, $pages, $class, !empty($body['returnReceipt']));
    $detail = json_encode([
        'uploadId' => $token,
        'path' => $file['path'],
        'to' => $to,
        'from' => $from,
        'mailClass' => $class,
        'returnReceipt' => !empty($body['returnReceipt']),
        'pages' => $pages,
        'quote' => $quote,
    ], JSON_UNESCAPED_UNICODE);
    $pdo->prepare('INSERT INTO orders (tenant, kind, email, title, amount_cents, status, detail, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        ->execute([$tenant['slug'], 'mail', $email, 'Mail a bid packet', $quote['total'], 'pending', $detail, gmdate('c')]);
    $orderId = (string) $pdo->lastInsertId();
    $site = rtrim((string) app_config()['public_site_url'], '/');
    $mailing = (int) ($quote['mailingCharge'] ?? 0);
    $rest = max(0, (int) $quote['total'] - $mailing);
    $stripe = [
        'mode' => 'payment',
        'customer_email' => $email,
        'success_url' => $site . '/?mail_paid=1&session_id={CHECKOUT_SESSION_ID}#mail',
        'cancel_url' => $site . '/?mail_paid=0#mail',
        'client_reference_id' => $orderId,
        'metadata[kind]' => 'mail',
        'metadata[order_id]' => $orderId,
        'metadata[tenant]' => $tenant['slug'],
        'metadata[email]' => $email,
    ];
    $line = 0;
    if ($rest > 0) {
        $stripe["line_items[$line][quantity]"] = '1';
        $stripe["line_items[$line][price_data][currency]"] = 'usd';
        $stripe["line_items[$line][price_data][unit_amount]"] = (string) $rest;
        $stripe["line_items[$line][price_data][product_data][name]"] = 'Mail a bid packet (' . $pages . ' pages)';
        $line++;
    }
    if ($mailing > 0) {
        $stripe["line_items[$line][quantity]"] = '1';
        $stripe["line_items[$line][price_data][currency]"] = 'usd';
        $stripe["line_items[$line][price_data][unit_amount]"] = (string) $mailing;
        $stripe["line_items[$line][price_data][product_data][name]"] = 'Mailing charge';
    }
    $result = stripe_checkout($stripe);
    if ($result['status'] === 200 && !empty($result['body']['id'])) {
        $pdo->prepare('UPDATE orders SET stripe_session = ? WHERE id = ?')->execute([$result['body']['id'], $orderId]);
    }
    http_json($result['status'], $result['body'] + ['quote' => $quote, 'orderId' => $orderId]);
}

function route_webhook(): void
{
    $payload = file_get_contents('php://input') ?: '';
    $secret = (string) (app_config()['stripe_webhook_secret'] ?? '');
    $header = (string) ($_SERVER['HTTP_STRIPE_SIGNATURE'] ?? '');
    if (!stripe_verify($payload, $header, $secret)) {
        http_json(400, ['error' => 'Webhook signature was not valid.']);
        return;
    }
    $event = json_decode($payload, true);
    if (!is_array($event) || ($event['type'] ?? '') !== 'checkout.session.completed') {
        http_json(200, ['ok' => true, 'ignored' => true]);
        return;
    }
    $session = $event['data']['object'] ?? [];
    if (($session['payment_status'] ?? '') !== 'paid') {
        http_json(200, ['ok' => true, 'ignored' => true]);
        return;
    }
    $pdo = app_db();
    $sid = (string) ($session['id'] ?? '');
    $orderId = (string) ($session['metadata']['order_id'] ?? $session['client_reference_id'] ?? '');
    $stmt = $pdo->prepare('SELECT * FROM orders WHERE stripe_session = ? OR id = ?');
    $stmt->execute([$sid, $orderId]);
    $order = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$order) {
        http_json(200, ['ok' => true, 'missing' => true]);
        return;
    }
    if (in_array($order['status'], ['drafted', 'mailed', 'needs_review'], true)) {
        http_json(200, ['ok' => true, 'idempotent' => true]);
        return;
    }
    $pdo->prepare('UPDATE orders SET status = ?, stripe_session = ?, paid_at = ? WHERE id = ?')->execute(['paid', $sid, gmdate('c'), $order['id']]);
    $order['status'] = 'paid';
    $order['stripe_session'] = $sid;
    if ($order['kind'] === 'mail') {
        fulfill_mail($order);
    } else {
        fulfill_bid($order);
    }
    http_json(200, ['ok' => true]);
}

function fulfill_bid(array $order): void
{
    $detail = json_decode((string) ($order['detail'] ?? '{}'), true) ?: [];
    $tenant = tenant_load((string) ($order['tenant'] ?? 'itsworkplace'));
    $result = grok_draft($detail['bid'] ?? ['title' => $order['title']], $detail['profile'] ?? [], $tenant);
    $draft = $result['draft'] !== '' ? $result['draft'] : "AI draft, review before submitting.\n\nThe model was unavailable (" . $result['error'] . "). The team will finish this draft.";
    $status = $result['ok'] ? 'drafted' : 'needs_review';
    app_db()->prepare('UPDATE orders SET status = ?, draft = ? WHERE id = ?')->execute([$status, $draft, $order['id']]);
    $order['draft'] = $draft;
    $order['status'] = $status;
    $customer = render_paid_customer($tenant, $order);
    mail_send(['to' => $order['email'], 'subject' => $customer['subject'], 'text' => $customer['text'], 'html' => $customer['html'], 'fromName' => $tenant['brand']]);
    $ops = (string) (app_config()['ops_email'] ?? '');
    if (valid_email($ops)) {
        $note = render_paid_ops($tenant, $order);
        mail_send(['to' => $ops, 'subject' => $note['subject'], 'text' => $note['text'], 'html' => $note['html']]);
    }
}

function fulfill_mail(array $order): void
{
    $detail = json_decode((string) ($order['detail'] ?? '{}'), true) ?: [];
    $tenant = tenant_load((string) ($order['tenant'] ?? 'itsworkplace'));
    $base = rtrim((string) app_config()['app_base_url'], '/');
    $pdfUrl = $base . '/api/mail/file?token=' . rawurlencode((string) ($detail['uploadId'] ?? ''));
    try {
        $sent = letterstream_submit($order, $detail['to'], $detail['from'], $pdfUrl, (int) ($detail['pages'] ?? 1));
        $detail['job_id'] = $sent['job_id'];
        $detail['test'] = !empty($sent['test']);
        app_db()->prepare('UPDATE orders SET status = ?, detail = ? WHERE id = ?')->execute(['mailed', json_encode($detail), $order['id']]);
        $order['detail'] = json_encode($detail);
        $mail = render_mail_customer($tenant, $order);
        mail_send(['to' => $order['email'], 'subject' => $mail['subject'], 'text' => $mail['text'], 'html' => $mail['html'], 'fromName' => $tenant['brand']]);
    } catch (Throwable $err) {
        app_db()->prepare("UPDATE orders SET status = 'failed' WHERE id = ?")->execute([$order['id']]);
        $ops = (string) (app_config()['ops_email'] ?? '');
        if (valid_email($ops)) {
            $mail = render_mail_ops_failure($tenant, $order, $err->getMessage());
            mail_send(['to' => $ops, 'subject' => $mail['subject'], 'text' => $mail['text'], 'html' => $mail['html']]);
        }
    }
}

function route_order_status(): void
{
    $sid = (string) ($_GET['session_id'] ?? '');
    if (!preg_match('/^cs_[A-Za-z0-9_]+$/', $sid) && !preg_match('/^test_/', $sid)) {
        http_json(400, ['error' => 'Missing a Checkout session id.']);
        return;
    }
    $stmt = app_db()->prepare('SELECT status, kind, title, bid_id, draft, detail, amount_cents FROM orders WHERE stripe_session = ?');
    $stmt->execute([$sid]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$row) {
        http_json(404, ['error' => 'No order for that session yet.']);
        return;
    }
    $detail = json_decode((string) $row['detail'], true) ?: [];
    http_json(200, [
        'status' => $row['status'],
        'kind' => $row['kind'],
        'title' => $row['title'],
        'bidId' => $row['bid_id'] ?? '',
        'amountCents' => (int) $row['amount_cents'],
        'draft' => in_array($row['status'], ['drafted', 'needs_review'], true) ? $row['draft'] : '',
        'jobId' => $detail['job_id'] ?? '',
        'note' => 'AI draft, review before submitting. Payment does not guarantee an award.',
    ]);
}

function route_draft(): void
{
    if (!rate_limit('draft:' . http_client_ip(), 20, 3600)) {
        http_json(429, ['error' => 'Too many draft checks.']);
        return;
    }
    $body = http_read_json();
    $sid = (string) ($body['sessionId'] ?? '');
    $stmt = app_db()->prepare('SELECT status, draft, bid_id FROM orders WHERE stripe_session = ? AND kind = ?');
    $stmt->execute([$sid, 'bid']);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$row || !in_array($row['status'], ['drafted', 'needs_review', 'paid'], true)) {
        http_json(402, ['error' => 'Grok writes the full bid only after Stripe confirms the $20 payment.']);
        return;
    }
    if ($row['status'] === 'paid' || $row['draft'] === '') {
        http_json(202, ['status' => 'paid', 'error' => 'Payment is confirmed. The draft is still being written.']);
        return;
    }
    http_json(200, [
        'draft' => $row['draft'],
        'bidId' => $row['bid_id'] ?? '',
        'source' => 'grok',
        'note' => 'AI draft, review before submitting.',
    ]);
}

function route_mail_file(): void
{
    $token = (string) ($_GET['token'] ?? '');
    $stmt = app_db()->prepare('SELECT path, expires_at FROM file_tokens WHERE token = ?');
    $stmt->execute([$token]);
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    if (!$row || (int) $row['expires_at'] < time() || !is_file($row['path'])) {
        http_json(404, ['error' => 'That file is no longer available.']);
        return;
    }
    header('Content-Type: application/pdf');
    header('Content-Disposition: inline; filename="letter.pdf"');
    header('Cache-Control: private, no-store');
    readfile($row['path']);
}

function feed_bids(): array
{
    $indexRef = (string) (app_config()['feed_index'] ?? '');
    if ($indexRef === '' || !str_starts_with($indexRef, 'http') && !is_file($indexRef)) {
        return [];
    }
    $index = feed_get_json($indexRef);
    if (!$index) {
        return [];
    }
    $base = str_starts_with($indexRef, 'http') ? preg_replace('#/index\.json$#', '', $indexRef) : dirname($indexRef);
    $bids = [];
    foreach ($index['shards'] ?? [] as $shard) {
        $doc = feed_get_json($base . '/' . $shard);
        foreach ($doc['bids'] ?? [] as $bid) {
            $bids[] = $bid;
        }
    }
    return $bids;
}

function feed_get_json(string $ref): ?array
{
    if (str_starts_with($ref, 'http')) {
        $ch = curl_init($ref);
        curl_setopt_array($ch, [CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 30, CURLOPT_FOLLOWLOCATION => true]);
        $raw = curl_exec($ch);
        curl_close($ch);
    } else {
        $raw = is_file($ref) ? file_get_contents($ref) : false;
    }
    $data = json_decode((string) $raw, true);
    return is_array($data) ? $data : null;
}
