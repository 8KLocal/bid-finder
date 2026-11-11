<?php
declare(strict_types=1);

function app_root(): string
{
    return dirname(__DIR__);
}

function app_config(): array
{
    static $cfg;
    if ($cfg) {
        return $cfg;
    }
    $file = app_root() . '/config/config.php';
    $cfg = is_file($file) ? require $file : [];
    $map = [
        'app_base_url' => 'APP_BASE_URL',
        'public_site_url' => 'PUBLIC_SITE_URL',
        'ops_email' => 'OPS_EMAIL',
        'db_dsn' => 'DB_DSN',
        'db_user' => 'DB_USER',
        'db_pass' => 'DB_PASS',
        'db_path' => 'DB_PATH',
        'mail_transport' => 'MAIL_TRANSPORT',
        'smtp_host' => 'SMTP_HOST',
        'smtp_user' => 'SMTP_USER',
        'smtp_pass' => 'SMTP_PASS',
        'smtp_encryption' => 'SMTP_ENCRYPTION',
        'sendgrid_api_key' => 'SENDGRID_API_KEY',
        'mail_from' => 'MAIL_FROM',
        'mail_from_name' => 'MAIL_FROM_NAME',
        'xai_key' => 'XAI_API_KEY',
        'xai_model' => 'XAI_MODEL',
        'xai_base' => 'XAI_API_BASE',
        'stripe_secret_key' => 'STRIPE_SECRET_KEY',
        'stripe_webhook_secret' => 'STRIPE_WEBHOOK_SECRET',
        'letterstream_api_id' => 'LETTERSTREAM_API_ID',
        'letterstream_api_key' => 'LETTERSTREAM_API_KEY',
        'letterstream_api_base' => 'LETTERSTREAM_API_BASE',
        'feed_index' => 'FEED_INDEX_URL',
    ];
    foreach ($map as $key => $env) {
        $value = getenv($env);
        if ($value !== false && $value !== '') {
            $cfg[$key] = $value;
        }
    }
    if (getenv('ALLOWED_ORIGINS')) {
        $cfg['allowed_origins'] = array_values(array_filter(array_map('trim', explode(',', (string) getenv('ALLOWED_ORIGINS')))));
    }
    if (getenv('SMTP_PORT')) {
        $cfg['smtp_port'] = (int) getenv('SMTP_PORT');
    }
    if (getenv('LETTERSTREAM_TEST') !== false && getenv('LETTERSTREAM_TEST') !== '') {
        $cfg['letterstream_test'] = getenv('LETTERSTREAM_TEST') === '1';
    }
    if (getenv('MAIL_RETENTION_DAYS')) {
        $cfg['mail_retention_days'] = (int) getenv('MAIL_RETENTION_DAYS');
    }
    $cfg += [
        'app_base_url' => 'http://127.0.0.1:8091',
        'public_site_url' => 'https://8klocal.github.io/bid-finder',
        'allowed_origins' => ['https://8klocal.github.io', 'http://127.0.0.1:8080'],
        'ops_email' => '',
        'db_path' => app_root() . '/storage/app.sqlite',
        'db_dsn' => '',
        'mail_transport' => 'log',
        'smtp_port' => 587,
        'smtp_encryption' => 'tls',
        'mail_from' => 'hello@itsworkplace.com',
        'mail_from_name' => "It's Workplace",
        'xai_model' => 'grok-4.7',
        'xai_base' => 'https://api.x.ai/v1',
        'xai_key' => '',
        'letterstream_api_base' => 'https://www.letterstream.com/api/',
        'letterstream_test' => true,
        'mail_retention_days' => 14,
        'bid_price_cents' => 2000,
        'feed_index' => dirname(app_root()) . '/data/feed/index.json',
    ];
    return $cfg;
}

function app_db(): PDO
{
    static $pdo;
    if ($pdo) {
        return $pdo;
    }
    $cfg = app_config();
    if (!empty($cfg['db_dsn']) && str_starts_with((string) $cfg['db_dsn'], 'mysql:')) {
        $pdo = new PDO((string) $cfg['db_dsn'], (string) ($cfg['db_user'] ?? ''), (string) ($cfg['db_pass'] ?? ''), [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        ]);
    } else {
        $path = (string) $cfg['db_path'];
        $dir = dirname($path);
        if (!is_dir($dir)) {
            mkdir($dir, 0775, true);
        }
        $pdo = new PDO('sqlite:' . $path, null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
        $pdo->exec('PRAGMA foreign_keys = ON');
    }
    app_migrate($pdo);
    return $pdo;
}

function app_migrate(PDO $pdo): void
{
    $pk = $pdo->getAttribute(PDO::ATTR_DRIVER_NAME) === 'mysql'
        ? 'INTEGER PRIMARY KEY AUTO_INCREMENT'
        : 'INTEGER PRIMARY KEY AUTOINCREMENT';
    $pdo->exec("CREATE TABLE IF NOT EXISTS subscribers (
        id {$pk},
        tenant TEXT NOT NULL,
        email TEXT NOT NULL,
        company TEXT,
        keywords TEXT,
        naics TEXT,
        states TEXT,
        sources TEXT,
        frequency TEXT NOT NULL,
        status TEXT NOT NULL,
        confirm_token TEXT,
        unsub_token TEXT,
        created_at TEXT,
        confirmed_at TEXT,
        welcome_sent_at TEXT,
        last_digest_at TEXT,
        UNIQUE(tenant, email)
    )");
    $pdo->exec("CREATE TABLE IF NOT EXISTS claims (
        id {$pk},
        tenant TEXT,
        bid_id TEXT,
        title TEXT,
        agency TEXT,
        deadline TEXT,
        contact_email TEXT,
        claimed_at TEXT,
        created_at TEXT
    )");
    $pdo->exec("CREATE TABLE IF NOT EXISTS orders (
        id {$pk},
        tenant TEXT,
        kind TEXT,
        stripe_session TEXT UNIQUE,
        email TEXT,
        bid_id TEXT,
        title TEXT,
        amount_cents INTEGER,
        status TEXT,
        draft TEXT,
        detail TEXT,
        created_at TEXT,
        paid_at TEXT
    )");
    $pdo->exec('CREATE TABLE IF NOT EXISTS rate_limits (
        bucket TEXT PRIMARY KEY,
        hits INTEGER,
        reset_at INTEGER
    )');
    $pdo->exec('CREATE TABLE IF NOT EXISTS file_tokens (
        token TEXT PRIMARY KEY,
        path TEXT,
        expires_at INTEGER
    )');
}

function app_token(): string
{
    return bin2hex(random_bytes(24));
}

function app_json_list($value): string
{
    if (is_array($value)) {
        $items = $value;
    } else {
        $items = preg_split('/[,;\n]+/', (string) $value) ?: [];
    }
    $clean = [];
    foreach ($items as $item) {
        $item = trim((string) $item);
        if ($item !== '') {
            $clean[] = $item;
        }
    }
    return json_encode(array_values($clean), JSON_UNESCAPED_UNICODE);
}
