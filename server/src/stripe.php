<?php
declare(strict_types=1);

function stripe_verify(string $payload, string $header, string $secret, int $tolerance = 300): bool
{
    if ($secret === '' || $header === '') {
        return false;
    }
    $parts = [];
    foreach (explode(',', $header) as $piece) {
        $bits = explode('=', trim($piece), 2);
        if (count($bits) === 2) {
            $parts[$bits[0]][] = $bits[1];
        }
    }
    $timestamp = isset($parts['t'][0]) ? (int) $parts['t'][0] : 0;
    if ($timestamp < 1 || abs(time() - $timestamp) > $tolerance) {
        return false;
    }
    $expected = hash_hmac('sha256', $timestamp . '.' . $payload, $secret);
    foreach ($parts['v1'] ?? [] as $sig) {
        if (hash_equals($expected, $sig)) {
            return true;
        }
    }
    return false;
}

function stripe_checkout(array $params): array
{
    $secret = (string) (app_config()['stripe_secret_key'] ?? '');
    if ($secret === '' || !preg_match('/^(sk|rk)_(test|live)_/', $secret)) {
        return ['status' => 503, 'body' => ['code' => 'STRIPE_NOT_CONFIGURED', 'error' => 'Set STRIPE_SECRET_KEY on the server. The browser never holds it.']];
    }
    $ch = curl_init('https://api.stripe.com/v1/checkout/sessions');
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_USERPWD => $secret . ':',
        CURLOPT_POSTFIELDS => http_build_query($params),
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 30,
    ]);
    $raw = curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    $data = json_decode((string) $raw, true) ?: [];
    if ($code >= 300 || empty($data['url'])) {
        return ['status' => 502, 'body' => ['error' => $data['error']['message'] ?? 'Stripe did not start Checkout.']];
    }
    return ['status' => 200, 'body' => ['url' => $data['url'], 'id' => $data['id'] ?? '']];
}
