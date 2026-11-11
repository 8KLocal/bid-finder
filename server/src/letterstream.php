<?php
declare(strict_types=1);

/**
 * LetterStream single-letter flow from their public integration notes:
 * create a job (PDF URL, addresses, mail type) then authorize it.
 * LETTERSTREAM_TEST=1 never calls the network and never mails.
 * A job is refused unless the local order is already paid.
 */
function letterstream_submit(array $order, array $to, array $from, string $pdfUrl, int $pages, callable $http = null): array
{
    if (($order['status'] ?? '') !== 'paid' && ($order['status'] ?? '') !== 'mailing') {
        throw new RuntimeException('Refusing to mail before payment is confirmed.');
    }
    $detail = json_decode((string) ($order['detail'] ?? '{}'), true) ?: [];
    if (!empty($detail['job_id'])) {
        return ['job_id' => $detail['job_id'], 'idempotent' => true, 'test' => !empty($detail['test'])];
    }
    $cfg = app_config();
    $jobName = substr(preg_replace('/[^A-Za-z0-9]/', '', (string) ($order['stripe_session'] ?? 'job')) ?? 'job', 0, 20);
    if (strlen($jobName) < 8) {
        $jobName = str_pad($jobName, 8, '0');
    }
    if (!empty($cfg['letterstream_test'])) {
        return ['job_id' => 'TEST' . strtoupper(substr(hash('sha256', $jobName), 0, 12)), 'test' => true, 'idempotent' => false];
    }
    if (empty($cfg['letterstream_api_id']) || empty($cfg['letterstream_api_key'])) {
        throw new RuntimeException('LETTERSTREAM_API_ID and LETTERSTREAM_API_KEY are not set.');
    }
    $class = ($detail['mailClass'] ?? 'firstclass') === 'certified'
        ? (!empty($detail['returnReceipt']) ? 'certified' : 'certnoerr')
        : 'firstclass';
    $fields = [
        'api_id' => $cfg['letterstream_api_id'],
        'api_key' => $cfg['letterstream_api_key'],
        'method' => 'create',
        'pdf_url' => $pdfUrl,
        'unique_job_id' => $jobName,
        'pages' => $pages,
        'sender_first' => $from['first'],
        'sender_last' => $from['last'],
        'sender_address1' => $from['line1'],
        'sender_address2' => $from['line2'],
        'sender_city' => $from['city'],
        'sender_state' => $from['state'],
        'sender_zip' => $from['zip'],
        'recipient_first' => $to['first'],
        'recipient_last' => $to['last'],
        'recipient_address1' => $to['line1'],
        'recipient_address2' => $to['line2'],
        'recipient_city' => $to['city'],
        'recipient_state' => $to['state'],
        'recipient_zip' => $to['zip'],
        'mail_type' => $class,
        'ink' => 'B',
        'return_envelope' => 'N',
        'cover_sheet' => 'Y',
    ];
    $base = rtrim((string) ($cfg['letterstream_api_base'] ?: 'https://www.letterstream.com/api/'), '/');
    $call = $http ?? 'letterstream_http';
    $created = $call($base . '/', $fields);
    $auth = $created['auth_code'] ?? $created['Auth Code'] ?? $created['authcode'] ?? '';
    $jobId = (string) ($created['id'] ?? $created['ID'] ?? $created['job_id'] ?? $jobName);
    if ($auth !== '') {
        $call($base . '/', [
            'api_id' => $cfg['letterstream_api_id'],
            'api_key' => $cfg['letterstream_api_key'],
            'method' => 'authorize',
            'auth_code' => $auth,
        ]);
    }
    return ['job_id' => $jobId, 'test' => false, 'idempotent' => false];
}

function letterstream_http(string $url, array $fields): array
{
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => $fields,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 45,
    ]);
    $raw = curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    $data = json_decode((string) $raw, true);
    if (!is_array($data)) {
        throw new RuntimeException('LetterStream did not return JSON (HTTP ' . $code . '). Check LETTERSTREAM_API_BASE against the docs in your LetterStream account.');
    }
    if ($code >= 300 || (!empty($data['error']))) {
        throw new RuntimeException((string) ($data['error'] ?? $data['Details'] ?? 'LetterStream rejected the job.'));
    }
    return $data;
}
