<?php

declare(strict_types=1);

function ais_database_demo_mode_flag_path(): string
{
    return __DIR__ . '/storage/database-demo-mode.flag';
}

function ais_database_demo_mode_id_secret_path(): string
{
    return __DIR__ . '/storage/database-demo-mode.secret';
}

function ais_database_demo_mode_id_secret(): string
{
    static $cachedSecret = null;
    if (is_string($cachedSecret) && $cachedSecret !== '') {
        return $cachedSecret;
    }

    $path = ais_database_demo_mode_id_secret_path();
    $readSecret = static function () use ($path): string {
        $text = is_file($path) ? file_get_contents($path) : false;
        $secret = $text === false ? '' : trim($text);
        return preg_match('/^[a-f0-9]{64}$/', $secret) === 1 ? $secret : '';
    };
    $existing = $readSecret();
    if ($existing !== '') {
        $cachedSecret = $existing;
        return $cachedSecret;
    }
    if (is_file($path)) {
        throw new RuntimeException('Защищённый ключ деморежима повреждён.');
    }

    $directory = dirname($path);
    if (!is_dir($directory) && !mkdir($directory, 0700, true) && !is_dir($directory)) {
        throw new RuntimeException('Не удалось подготовить защищённое хранилище деморежима.');
    }
    $generated = bin2hex(random_bytes(32));
    $handle = @fopen($path, 'x+b');
    if (is_resource($handle)) {
        $written = fwrite($handle, $generated . "\n");
        $flushed = fflush($handle);
        fclose($handle);
        @chmod($path, 0600);
        if ($written !== 65 || !$flushed) {
            @unlink($path);
            throw new RuntimeException('Не удалось сохранить защищённый ключ деморежима.');
        }
        $cachedSecret = $generated;
        return $cachedSecret;
    }

    // Another PHP request may have won the exclusive-create race.
    $existing = $readSecret();
    if ($existing === '') {
        throw new RuntimeException('Не удалось прочитать защищённый ключ деморежима.');
    }
    $cachedSecret = $existing;
    return $cachedSecret;
}

function ais_database_demo_mode_enabled(): bool
{
    if ((string) getenv('AIS_DATABASE_DEMO_MODE') === '1') {
        return true;
    }
    $flagPath = ais_database_demo_mode_flag_path();
    if (is_file($flagPath)) {
        $flag = file_get_contents($flagPath);
        if ($flag === false) {
            return true;
        }
        $normalized = strtolower(trim($flag));
        if ($normalized === 'enabled') {
            return true;
        }
        if ($normalized === 'disabled') {
            return false;
        }
        return true;
    }

    // One-time compatibility with installations that stored the flag in server-settings.json.
    $legacyPath = __DIR__ . '/storage/server-settings.json';
    if (!is_file($legacyPath)) {
        return false;
    }
    $legacyText = file_get_contents($legacyPath);
    if ($legacyText === false) {
        return true;
    }
    $settings = json_decode($legacyText, true);
    if (!is_array($settings)) {
        return true;
    }
    return ($settings['databaseDemoModeEnabled'] ?? false) === true;
}
