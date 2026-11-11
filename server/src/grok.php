<?php
declare(strict_types=1);

function grok_draft(array $bid, array $profile, array $tenant): array
{
    $cfg = app_config();
    $key = (string) ($cfg['xai_key'] ?? '');
    if ($key === '') {
        return ['ok' => false, 'error' => 'XAI_API_KEY is not set. The team will write the draft.', 'draft' => ''];
    }
    $model = (string) ($cfg['xai_model'] ?: 'grok-4.7');
    $base = rtrim((string) ($cfg['xai_base'] ?: 'https://api.x.ai/v1'), '/');
    $system = "You draft proposal responses for open United States government and public-agency notices.\n"
        . "The first line must say: AI draft, review before submitting. It has not been submitted.\n"
        . "Use only facts in the notice and the customer profile. Never invent past performance, prices, headcount, or clearances.\n"
        . "Where a fact is missing, use a bracket placeholder.\n"
        . "Include a compliance checklist, then a full response draft with headings: Draft notice, Compliance checklist, Transmittal, Understanding of the requirement, Technical approach, Relevant experience, Staffing, Schedule, Pricing, Contact, Before you submit.\n"
        . "There is no guarantee of award.\n"
        . ($tenant['persona'] ?? '');
    $user = "Notice:\n" . json_encode([
        'title' => $bid['title'] ?? '',
        'agency' => $bid['agency'] ?? '',
        'state' => $bid['state'] ?? '',
        'naics' => $bid['naics'] ?? '',
        'posted' => $bid['posted'] ?? '',
        'deadline' => $bid['deadline'] ?? $bid['due'] ?? '',
        'source' => $bid['source'] ?? '',
        'url' => $bid['url'] ?? $bid['link'] ?? '',
        'description' => $bid['description'] ?? $bid['summary'] ?? '',
    ], JSON_UNESCAPED_UNICODE) . "\nCustomer profile:\n" . json_encode($profile, JSON_UNESCAPED_UNICODE);
    $ch = curl_init($base . '/chat/completions');
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_HTTPHEADER => [
            'Authorization: Bearer ' . $key,
            'Content-Type: application/json',
        ],
        CURLOPT_POSTFIELDS => json_encode([
            'model' => $model,
            'temperature' => 0.3,
            'messages' => [
                ['role' => 'system', 'content' => $system],
                ['role' => 'user', 'content' => $user],
            ],
        ]),
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 90,
    ]);
    $raw = curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    $data = json_decode((string) $raw, true) ?: [];
    $text = $data['choices'][0]['message']['content'] ?? '';
    if ($code >= 300 || $text === '') {
        return ['ok' => false, 'error' => $data['error']['message'] ?? 'Grok did not return a draft.', 'draft' => ''];
    }
    return ['ok' => true, 'draft' => trim((string) $text), 'model' => $model, 'error' => ''];
}
