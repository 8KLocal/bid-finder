<?php
/**
 * Copy to config.php on the server. config.php is gitignored.
 * Environment variables override these values when they are set.
 * Never commit API keys, Stripe secrets, or LetterStream credentials.
 */
return [
    'app_base_url' => 'https://bids.example.com',
    'public_site_url' => 'https://8klocal.github.io/bid-finder',
    'allowed_origins' => [
        'https://8klocal.github.io',
        'https://itsworkplace.com',
        'http://127.0.0.1:8080',
        'http://localhost:8080',
    ],
    'ops_email' => '',
    'db_driver' => 'sqlite',
    'db_path' => __DIR__ . '/../storage/app.sqlite',
    'db_dsn' => '',
    'db_user' => '',
    'db_pass' => '',
    'mail_transport' => 'log',
    'smtp_host' => '',
    'smtp_port' => 587,
    'smtp_user' => '',
    'smtp_pass' => '',
    'smtp_encryption' => 'tls',
    'sendgrid_api_key' => '',
    'mail_from' => 'hello@itsworkplace.com',
    'mail_from_name' => "It's Workplace",
    'xai_key' => '',
    'xai_model' => 'grok-4.7',
    'xai_base' => 'https://api.x.ai/v1',
    'stripe_secret_key' => '',
    'stripe_webhook_secret' => '',
    'letterstream_api_id' => '',
    'letterstream_api_key' => '',
    'letterstream_api_base' => 'https://www.letterstream.com/api/',
    'letterstream_test' => true,
    'mail_retention_days' => 14,
    'feed_index' => '',
    'bid_price_cents' => 2000,
];
