<?php
declare(strict_types=1);

function tenant_load(string $slug): array
{
    $slug = strtolower(preg_replace('/[^a-z0-9-]/', '', $slug) ?? '');
    if ($slug === '') {
        $slug = 'itsworkplace';
    }
    $path = dirname(app_root()) . '/tenants/' . $slug . '.json';
    if (!is_file($path)) {
        $path = dirname(app_root()) . '/tenants/itsworkplace.json';
    }
    $data = json_decode((string) file_get_contents($path), true);
    if (!is_array($data)) {
        $data = [];
    }
    $data['slug'] = $data['slug'] ?? 'itsworkplace';
    $data['brand'] = $data['brand'] ?? "It's Workplace";
    $data['address'] = $data['address'] ?? 'ITS WORKPLACE INC, 1261 Broadway, 2FL Suite IT, New York, NY 10001';
    $data['offshoreLine'] = $data['offshoreLine'] ?? "It's Workplace is our offshore team handling the business.";
    $data['bidPriceCents'] = (int) ($data['bidPriceCents'] ?? app_config()['bid_price_cents'] ?? 2000);
    $data['mail'] = $data['mail'] ?? [];
    $data['mail'] += [
        'firstClassCents' => 78,
        'certifiedCents' => 500,
        'returnReceiptCents' => 250,
        'perPageCents' => 15,
        'mailingChargeCents' => 500,
        'serviceFeeCents' => 500,
    ];
    return $data;
}

function quote_mail(array $tenant, int $pages, string $class, bool $receipt): array
{
    $fees = $tenant['mail'];
    $pages = max(1, $pages);
    $postage = $class === 'certified' ? (int) $fees['certifiedCents'] : (int) $fees['firstClassCents'];
    $receiptCents = $receipt ? (int) $fees['returnReceiptCents'] : 0;
    $mailing = (int) ($fees['mailingChargeCents'] ?? 500);
    $pageCents = $pages * (int) $fees['perPageCents'];
    $service = (int) $fees['serviceFeeCents'];
    $total = $postage + $receiptCents + $mailing + $pageCents + $service;
    return [
        'postage' => $postage,
        'returnReceipt' => $receiptCents,
        'mailingCharge' => $mailing,
        'pages' => $pageCents,
        'serviceFee' => $service,
        'total' => $total,
        'currency' => 'usd',
        'pagesCount' => $pages,
        'mailClass' => $class === 'certified' ? 'certified' : 'firstclass',
        'note' => 'Estimate from the rates configured for this service. Not a USPS guarantee.',
    ];
}
