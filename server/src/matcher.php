<?php
declare(strict_types=1);

function match_list($value): array
{
    if (is_array($value)) {
        $raw = $value;
    } else {
        $decoded = json_decode((string) $value, true);
        $raw = is_array($decoded) ? $decoded : preg_split('/[,;\n]+/', (string) $value);
    }
    $out = [];
    foreach ($raw ?: [] as $item) {
        $item = trim((string) $item);
        if ($item !== '') {
            $out[] = $item;
        }
    }
    return $out;
}

function match_bid(array $bid, array $interests): bool
{
    $keywords = array_map('strtolower', match_list($interests['keywords'] ?? []));
    $naics = [];
    foreach (match_list($interests['naics'] ?? []) as $code) {
        $digits = preg_replace('/\D/', '', $code) ?? '';
        if ($digits !== '') {
            $naics[] = $digits;
        }
    }
    $states = array_map('strtoupper', match_list($interests['states'] ?? []));
    $sources = array_map('strtolower', match_list($interests['sources'] ?? []));
    if ($keywords) {
        $hay = strtolower(($bid['title'] ?? '') . ' ' . ($bid['agency'] ?? '') . ' ' . ($bid['description'] ?? $bid['summary'] ?? '') . ' ' . ($bid['naics'] ?? ''));
        $hit = false;
        foreach ($keywords as $word) {
            if (str_contains($hay, $word)) {
                $hit = true;
                break;
            }
        }
        if (!$hit) {
            return false;
        }
    }
    if ($naics) {
        $code = (string) ($bid['naics'] ?? '');
        $hit = false;
        foreach ($naics as $n) {
            if ($code === $n || str_starts_with($code, $n)) {
                $hit = true;
                break;
            }
        }
        if (!$hit) {
            return false;
        }
    }
    if ($states && !in_array(strtoupper((string) ($bid['state'] ?? '')), $states, true)) {
        return false;
    }
    if ($sources && !in_array(strtolower((string) ($bid['source'] ?? '')), $sources, true)) {
        return false;
    }
    return true;
}
