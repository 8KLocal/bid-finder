<?php
declare(strict_types=1);

putenv('DB_PATH=/tmp/iw-bid-test.sqlite');
putenv('LETTERSTREAM_TEST=1');
putenv('MAIL_TRANSPORT=log');
@unlink('/tmp/iw-bid-test.sqlite');

$root = dirname(__DIR__, 2);
require dirname(__DIR__) . '/src/bootstrap.php';
require dirname(__DIR__) . '/src/templates.php';
require dirname(__DIR__) . '/src/matcher.php';
require dirname(__DIR__) . '/src/tenant.php';
require dirname(__DIR__) . '/src/address.php';
require dirname(__DIR__) . '/src/pdf.php';
require dirname(__DIR__) . '/src/stripe.php';
require dirname(__DIR__) . '/src/letterstream.php';

$fail = 0;
function check(bool $ok, string $name): void
{
    global $fail;
    if ($ok) {
        echo "ok  {$name}\n";
        return;
    }
    $fail++;
    echo "FAIL {$name}\n";
}

$tenant = tenant_load('itsworkplace');
$welcome = render_welcome($tenant, 'https://bids.example.com/api/confirm?token=abc', 'https://bids.example.com/api/unsubscribe?token=abc');
$digest = render_digest($tenant, [[
    'title' => 'Roof work',
    'agency' => 'City of Austin',
    'state' => 'TX',
    'deadline' => '2026-12-01',
    'url' => 'https://sam.gov/opp/abc/view',
]], 'https://bids.example.com/api/unsubscribe?token=abc', 'daily');
foreach (['welcome' => $welcome, 'digest' => $digest] as $name => $mail) {
    $blob = $mail['text'] . $mail['html'];
    check(str_contains($blob, '1261 Broadway, 2FL Suite IT, New York, NY 10001'), "{$name} address");
    check(str_contains($blob, "It's Workplace is our offshore team handling the business."), "{$name} offshore line");
    check(str_contains($blob, 'https://bids.example.com/api/unsubscribe?token=abc'), "{$name} unsubscribe");
    check(!preg_match('/sk_live_|sk_test_|LETTERSTREAM_API_KEY|XAI_API_KEY/', $blob), "{$name} has no secrets");
}

$cases = json_decode((string) file_get_contents($root . '/tests/fixtures/match-cases.json'), true);
foreach ($cases as $case) {
    check(match_bid($case['bid'], $case['interests']) === $case['want'], 'match ' . $case['name']);
}

$quote = quote_mail($tenant, 3, 'certified', true);
check($quote['mailingCharge'] === 500, 'mailing charge defaults to $5');
check($quote['total'] === $quote['postage'] + $quote['returnReceipt'] + $quote['mailingCharge'] + $quote['pages'] + $quote['serviceFee'], 'quote adds up');
check($quote['pages'] === 3 * (int) $tenant['mail']['perPageCents'], 'page cost');
check($quote['serviceFee'] === (int) $tenant['mail']['serviceFeeCents'], 'service fee shown');

$secret = 'whsec_test_secret';
$payload = '{"id":"evt_test"}';
$t = time();
$sig = hash_hmac('sha256', $t . '.' . $payload, $secret);
check(stripe_verify($payload, "t={$t},v1={$sig}", $secret), 'stripe signature accepts');
check(!stripe_verify($payload, "t={$t},v1=deadbeef", $secret), 'stripe signature rejects');
check(!stripe_verify($payload, 't=1,v1=' . hash_hmac('sha256', '1.' . $payload, $secret), $secret), 'stripe signature rejects old timestamp');

$to = normalize_us_address(['name' => 'City Clerk', 'line1' => '1 Main St', 'city' => 'Austin', 'state' => 'texas', 'zip' => '78701']);
check($to['state'] === 'TX' && $to['first'] === 'City', 'address normalizes');
$threw = false;
try {
    normalize_us_address(['name' => 'A', 'line1' => '1 Main', 'city' => 'Austin', 'state' => 'ZZ', 'zip' => '1']);
} catch (InvalidArgumentException $e) {
    $threw = true;
}
check($threw, 'address rejects a bad state');

$pdf = '/tmp/iw-draft.pdf';
pdf_from_text("AI draft, review before submitting.\nLine two.", $pdf);
check(pdf_inspect($pdf) >= 1, 'generated pdf has a page');

$called = false;
try {
    letterstream_submit(['status' => 'pending', 'stripe_session' => 'cs_test_pending1', 'detail' => '{}'], $to, $to, 'https://example.com/a.pdf', 1, function () use (&$called) {
        $called = true;
    });
    check(false, 'unpaid mail throws');
} catch (RuntimeException $e) {
    check(!$called && str_contains($e->getMessage(), 'before payment'), 'unpaid mail refused');
}
$called = false;
$sent = letterstream_submit(['status' => 'paid', 'stripe_session' => 'cs_test_paidorder', 'detail' => '{}'], $to, $to, 'https://example.com/a.pdf', 1, function () use (&$called) {
    $called = true;
    return [];
});
check(!$called && str_starts_with($sent['job_id'], 'TEST'), 'test mode does not call LetterStream');

echo $fail ? "{$fail} failed\n" : "all passed\n";
exit($fail ? 1 : 0);
