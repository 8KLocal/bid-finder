<?php
declare(strict_types=1);

function mail_send(array $message): bool
{
    $cfg = app_config();
    $transport = $cfg['mail_transport'] ?? 'log';
    $from = $message['from'] ?? ($cfg['mail_from'] ?? 'hello@itsworkplace.com');
    $fromName = $message['fromName'] ?? ($cfg['mail_from_name'] ?? "It's Workplace");
    $to = $message['to'] ?? '';
    if (!valid_email($to)) {
        return false;
    }
    $headers = [
        'From: ' . mail_encode_name($fromName) . " <{$from}>",
        'Reply-To: ' . ($message['replyTo'] ?? $from),
        'MIME-Version: 1.0',
        'Content-Type: text/html; charset=UTF-8',
    ];
    if (!empty($message['listUnsubscribe'])) {
        $headers[] = 'List-Unsubscribe: <' . $message['listUnsubscribe'] . '>';
        $headers[] = 'List-Unsubscribe-Post: List-Unsubscribe=One-Click';
    }
    if ($transport === 'sendgrid' && !empty($cfg['sendgrid_api_key'])) {
        return mail_sendgrid($cfg, $message, $from, $fromName);
    }
    if ($transport === 'smtp' && !empty($cfg['smtp_host'])) {
        return mail_smtp($cfg, $message, $from, $fromName, $headers);
    }
    $dir = app_root() . '/storage';
    if (!is_dir($dir)) {
        mkdir($dir, 0775, true);
    }
    $line = json_encode([
        'to' => $to,
        'subject' => $message['subject'] ?? '',
        'text' => $message['text'] ?? '',
        'at' => gmdate('c'),
    ], JSON_UNESCAPED_UNICODE);
    return file_put_contents($dir . '/mail.log', $line . "\n", FILE_APPEND) !== false;
}

function mail_encode_name(string $name): string
{
    return '=?UTF-8?B?' . base64_encode($name) . '?=';
}

function mail_sendgrid(array $cfg, array $message, string $from, string $fromName): bool
{
    $payload = [
        'personalizations' => [[
            'to' => [['email' => $message['to']]],
            'headers' => !empty($message['listUnsubscribe']) ? [
                'List-Unsubscribe' => '<' . $message['listUnsubscribe'] . '>',
                'List-Unsubscribe-Post' => 'List-Unsubscribe=One-Click',
            ] : new stdClass(),
        ]],
        'from' => ['email' => $from, 'name' => $fromName],
        'subject' => $message['subject'] ?? '',
        'content' => [
            ['type' => 'text/plain', 'value' => $message['text'] ?? ''],
            ['type' => 'text/html', 'value' => $message['html'] ?? ''],
        ],
    ];
    $ch = curl_init('https://api.sendgrid.com/v3/mail/send');
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_HTTPHEADER => [
            'Authorization: Bearer ' . $cfg['sendgrid_api_key'],
            'Content-Type: application/json',
        ],
        CURLOPT_POSTFIELDS => json_encode($payload),
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 20,
    ]);
    curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    return $code >= 200 && $code < 300;
}

function mail_smtp(array $cfg, array $message, string $from, string $fromName, array $headers): bool
{
    $host = (string) $cfg['smtp_host'];
    $port = (int) ($cfg['smtp_port'] ?? 587);
    $remote = ($cfg['smtp_encryption'] ?? '') === 'ssl' ? "ssl://{$host}:{$port}" : "tcp://{$host}:{$port}";
    $fp = @stream_socket_client($remote, $errno, $errstr, 20, STREAM_CLIENT_CONNECT);
    if (!$fp) {
        return false;
    }
    stream_set_timeout($fp, 20);
    $read = function () use ($fp) {
        $data = '';
        while ($line = fgets($fp, 515)) {
            $data .= $line;
            if (isset($line[3]) && $line[3] === ' ') {
                break;
            }
        }
        return $data;
    };
    $write = function (string $cmd) use ($fp, $read) {
        fwrite($fp, $cmd . "\r\n");
        return $read();
    };
    $read();
    $write('EHLO itsworkplace.local');
    if (($cfg['smtp_encryption'] ?? '') === 'tls') {
        $write('STARTTLS');
        stream_socket_enable_crypto($fp, true, STREAM_CRYPTO_METHOD_TLS_CLIENT);
        $write('EHLO itsworkplace.local');
    }
    if (!empty($cfg['smtp_user'])) {
        $write('AUTH LOGIN');
        $write(base64_encode((string) $cfg['smtp_user']));
        $resp = $write(base64_encode((string) $cfg['smtp_pass']));
        if (!str_starts_with($resp, '235')) {
            fclose($fp);
            return false;
        }
    }
    $write('MAIL FROM:<' . $from . '>');
    $write('RCPT TO:<' . $message['to'] . '>');
    $write('DATA');
    $body = 'To: ' . $message['to'] . "\r\n"
        . 'From: ' . mail_encode_name($fromName) . " <{$from}>\r\n"
        . 'Subject: ' . mail_encode_name((string) ($message['subject'] ?? '')) . "\r\n"
        . implode("\r\n", $headers) . "\r\n\r\n"
        . ($message['html'] ?? $message['text'] ?? '') . "\r\n.";
    $resp = $write($body);
    $write('QUIT');
    fclose($fp);
    return str_starts_with($resp, '250');
}
