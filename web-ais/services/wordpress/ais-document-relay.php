<?php
/**
 * Plugin Name: АИС — защищённая очередь PDF и OCR
 * Description: Исходящий обмен с исполнителями АИС; зашифрованные временные документы вне public_html.
 * Version: 1.1.0
 */
// Direct requests use the same signed protocol without booting WordPress/WooCommerce.
// The file remains an MU plugin too, preserving compatibility with older desktops.
$ais_dr_direct = !defined('ABSPATH');
if ($ais_dr_direct) define('ABSPATH', dirname(__DIR__, 2) . '/');
class AisDrStandaloneError {
    public $message, $data;
    function __construct($message, $status) { $this->message = $message; $this->data = array('status' => $status); }
}
const AIS_DR_MAX_BYTES = 50331648;
const AIS_DR_CHUNK = 393216;
function ais_dr_error($message, $status = 400) { return class_exists('WP_Error') ? new WP_Error('ais_document_relay', $message, array('status' => $status)) : new AisDrStandaloneError($message, $status); }
function ais_dr_is_error($value) { return $value instanceof AisDrStandaloneError || (function_exists('is_wp_error') && is_wp_error($value)); }
function ais_dr_nonce($nonce) {
    // Shared atomic replay guard for both transports, never two independent nonce stores.
    $root = ais_dr_root();
    if (!is_dir($root) && !@mkdir($root, 0700, true) && !is_dir($root)) return false;
    foreach (glob($root . '/nonce-*.used') ?: array() as $file) if (filemtime($file) < time() - 250) @unlink($file);
    $file = "$root/nonce-$nonce.used";
    $handle = @fopen($file, 'x');
    if (!$handle) return false;
    fclose($handle); chmod($file, 0600); return true;
}
function ais_dr_permission($request) {
    $host = function_exists('home_url') ? parse_url(home_url(), PHP_URL_HOST) : ($_SERVER['HTTP_HOST'] ?? '');
    if (strtolower((string) $host) !== 'zifra-plus.ru') return ais_dr_error('Очередь работает только на zifra-plus.ru.', 404);
    $body = $request->get_body();
    if (strlen($body) > 700000 || $request->get_query_params()) return ais_dr_error('Недопустимый запрос очереди.', 413);
    $key_file = dirname(rtrim(ABSPATH, '/\\')) . '/ais-program-site.key';
    $secret = is_readable($key_file) ? trim(file_get_contents($key_file)) : '';
    $stamp = (string) $request->get_header('x-ais-timestamp');
    $nonce = (string) $request->get_header('x-ais-nonce');
    $signature = (string) $request->get_header('x-ais-signature');
    if (!preg_match('/^[a-f0-9]{64}$/D', $secret) || !ctype_digit($stamp) || abs(time() - (int) $stamp) > 120
        || !preg_match('/^[a-f0-9]{32}$/D', $nonce)) return ais_dr_error('Требуется защищённое подключение АИС.', 403);
    $key = hash_hmac('sha256', 'ais-document-relay-v1:authentication', $secret, true);
    $proof = hash_hmac('sha256', implode("\n", array($request->get_method(), '/wp-json' . $request->get_route(), $stamp, $nonce, hash('sha256', $body))), $key);
    if (!hash_equals($proof, $signature)) return ais_dr_error('Подпись запроса не подтверждена.', 403);
    // No WordPress cookie/admin bypass. Nonces are atomically unique across PHP processes.
    if (!ais_dr_nonce($nonce)) return ais_dr_error('Повторный запрос отклонён или хранилище недоступно.', 409);
    return true;
}
function ais_dr_root() { return dirname(rtrim(ABSPATH, '/\\')) . '/ais-document-relay-private'; }
function ais_dr_json($file) { $data = is_file($file) ? json_decode(file_get_contents($file), true) : null; return is_array($data) ? $data : null; }
function ais_dr_write($file, $data) {
    $temp = $file . '.tmp';
    if (file_put_contents($temp, json_encode($data, JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR), LOCK_EX) === false) throw new RuntimeException('Не удалось сохранить состояние очереди.');
    chmod($temp, 0600);
    if (!rename($temp, $file)) throw new RuntimeException('Не удалось обновить состояние очереди.');
}
function ais_dr_id($value, $length = 32) { return is_string($value) && preg_match('/^[a-f0-9]{' . $length . '}$/D', $value); }
function ais_dr_clear_payloads($root, $id) { foreach (array('input', 'output') as $kind) { $file = "$root/$id.$kind"; if (is_file($file)) unlink($file); } }
function ais_dr_cleanup($root, $now) {
    foreach (glob($root . '/*.json') ?: array() as $file) {
        $item = ais_dr_json($file);
        if (!$item || (int) ($item['expires'] ?? 0) > $now) continue;
        if (ais_dr_id($item['id'] ?? '')) ais_dr_clear_payloads($root, $item['id']);
        unlink($file);
    }
}
function ais_dr_workers($root, $now) {
    $result = array();
    foreach (glob($root . '/worker-*.json') ?: array() as $file) {
        $worker = ais_dr_json($file);
        if ($worker && (int) ($worker['seen'] ?? 0) >= $now - 35) $result[] = $worker;
    }
    return $result;
}
function ais_dr_validate_size($data) {
    if (!is_int($data['size'] ?? null) || $data['size'] < 28 || $data['size'] > AIS_DR_MAX_BYTES || !ais_dr_id($data['digest'] ?? '', 64)) throw new InvalidArgumentException('Некорректный размер или контрольная сумма пакета.');
}
function ais_dr_lease($job, $data, $now) {
    return $job['state'] === 'processing' && (int) $job['leaseUntil'] > $now
        && hash_equals($job['lease'], (string) ($data['lease'] ?? '')) && hash_equals($job['worker'], (string) ($data['worker'] ?? ''));
}
function ais_dr_dispatch($root, $action, $data, $now) {
    ais_dr_cleanup($root, $now);
    if ($action === 'health') {
        $workers = ais_dr_workers($root, $now);
        return array('ok' => true, 'pollMs' => 3000, 'workers' => count($workers), 'pdf' => count(array_filter($workers, fn($w) => in_array('pdf', $w['capabilities'], true))),
            'ocr' => count(array_filter($workers, fn($w) => in_array('ocr', $w['capabilities'], true))));
    }
    if ($action === 'claim') {
        $worker = $data['worker'] ?? '';
        if (!ais_dr_id($worker) || !is_array($data['capabilities'] ?? null) || count($data['capabilities']) > 2) throw new InvalidArgumentException('Некорректный исполнитель.');
        $caps = array_values(array_intersect(array('pdf', 'ocr'), $data['capabilities']));
        ais_dr_write("$root/worker-$worker.json", array('worker' => $worker, 'seen' => $now, 'capabilities' => $caps, 'expires' => $now + 300));
        $jobs = array();
        foreach (glob($root . '/job-*.json') ?: array() as $file) {
            $job = ais_dr_json($file);
            if (!$job) continue;
            // A second process on the same installation must not create a second concurrent slot.
            if ($job['state'] === 'processing' && $job['worker'] === $worker && $job['leaseUntil'] > $now) return array('job' => null);
            if ($job['state'] === 'processing' && $job['leaseUntil'] <= $now) {
                $job['state'] = $job['attempts'] >= 3 ? 'failed' : 'queued';
                unset($job['lease'], $job['worker'], $job['output']);
                if (is_file("$root/{$job['id']}.output")) unlink("$root/{$job['id']}.output");
                ais_dr_write($file, $job);
            }
            if ($job['state'] === 'queued' && in_array($job['kind'], $caps, true)) $jobs[] = $job;
        }
        usort($jobs, fn($a, $b) => $a['created'] <=> $b['created']);
        if (!$jobs) return array('job' => null);
        $job = $jobs[0]; $job['state'] = 'processing'; $job['worker'] = $worker;
        $job['lease'] = bin2hex(random_bytes(32)); $job['leaseUntil'] = $now + 40; $job['attempts']++;
        ais_dr_write("$root/job-{$job['id']}.json", $job);
        return array('job' => array('id' => $job['id'], 'lease' => $job['lease'], 'kind' => $job['kind'], 'size' => $job['size'], 'digest' => $job['digest']));
    }
    $id = $data['id'] ?? '';
    if (!ais_dr_id($id)) throw new InvalidArgumentException('Некорректный идентификатор задания.');
    $file = "$root/job-$id.json"; $job = ais_dr_json($file);
    if ($action === 'submit') {
        ais_dr_validate_size($data);
        if (!ais_dr_id($data['owner'] ?? '', 64) || !in_array($data['kind'] ?? '', array('pdf', 'ocr'), true)) throw new InvalidArgumentException('Некорректное задание.');
        if ($job) {
            if (!hash_equals($job['owner'], hash('sha256', $data['owner'])) || $job['digest'] !== $data['digest']) return ais_dr_error('Идентификатор уже занят.', 409);
            return array('ok' => true);
        }
        $ready = array_filter(ais_dr_workers($root, $now), fn($w) => in_array($data['kind'], $w['capabilities'], true));
        if (!$ready) return ais_dr_error('Нет доступного компьютера с ' . ($data['kind'] === 'pdf' ? 'LibreOffice' : 'OCR') . '. Запустите АИС и службы документов на одном из компьютеров.', 503);
        $files = glob($root . '/job-*.json') ?: array(); $reserved = 0;
        foreach ($files as $existing) { $j = ais_dr_json($existing); if ($j && !in_array($j['state'], array('acknowledged', 'cancelled'), true)) $reserved += $j['size'] + ($j['output']['size'] ?? 0); }
        if (count($files) >= 200 || $reserved + 2 * $data['size'] > 268435456) return ais_dr_error('Очередь заполнена. Повторите позже.', 429);
        $job = array('id' => $id, 'owner' => hash('sha256', $data['owner']), 'kind' => $data['kind'], 'size' => $data['size'], 'digest' => $data['digest'], 'state' => 'uploading', 'created' => $now, 'expires' => $now + 1200, 'attempts' => 0);
        ais_dr_write($file, $job); return array('ok' => true);
    }
    if (!$job) return ais_dr_error('Задание не найдено или срок хранения истёк.', 404);
    $worker_action = in_array($action, array('renew', 'result-start', 'result-put', 'complete'), true) || ($action === 'read' && isset($data['lease']));
    if ($worker_action) {
        if (!ais_dr_lease($job, $data, $now)) return ais_dr_error('Задание отменено или передано другому исполнителю.', 409);
    } elseif (!ais_dr_id($data['owner'] ?? '', 64) || !hash_equals($job['owner'], hash('sha256', $data['owner']))) return ais_dr_error('Доступ к заданию запрещён.', 403);
    if ($action === 'renew') {
        $job['leaseUntil'] = $now + 40; ais_dr_write($file, $job);
        $worker_file = "$root/worker-{$job['worker']}.json"; $worker = ais_dr_json($worker_file);
        if ($worker) { $worker['seen'] = $now; $worker['expires'] = $now + 300; ais_dr_write($worker_file, $worker); }
        return array('ok' => true);
    }
    if ($action === 'cancel' || $action === 'ack') {
        if ($action === 'ack' && !in_array($job['state'], array('complete', 'acknowledged'), true)) return ais_dr_error('Результат ещё не готов.', 409);
        $job['state'] = $action === 'ack' ? 'acknowledged' : 'cancelled'; $job['expires'] = $now + 120;
        ais_dr_clear_payloads($root, $id); ais_dr_write($file, $job); return array('ok' => true);
    }
    if ($action === 'status') return array('state' => $job['state'], 'attempts' => $job['attempts'], 'size' => $job['output']['size'] ?? null, 'digest' => $job['output']['digest'] ?? null);
    if ($action === 'result-start') {
        ais_dr_validate_size($data);
        if (isset($job['output']) && ($job['output']['digest'] !== $data['digest'] || $job['output']['size'] !== $data['size'])) return ais_dr_error('Результат уже загружается.', 409);
        $reserved = $data['size'];
        foreach (glob($root . '/job-*.json') ?: array() as $existing) {
            $j = ais_dr_json($existing);
            if ($j && !in_array($j['state'], array('acknowledged', 'cancelled'), true)) $reserved += $j['size'] + ($j['id'] === $id ? 0 : ($j['output']['size'] ?? 0));
        }
        if ($reserved > 268435456) return ais_dr_error('Очередь заполнена. Повторите позже.', 429);
        $job['output'] = array('size' => $data['size'], 'digest' => $data['digest']); ais_dr_write($file, $job); return array('ok' => true);
    }
    if ($action === 'put' || $action === 'result-put') {
        $input = $action === 'put'; $part = $input ? 'input' : 'output';
        if (($input && $job['state'] !== 'uploading') || (!$input && !isset($job['output']))) return ais_dr_error('Загрузка не разрешена.', 409);
        $max = $input ? $job['size'] : $job['output']['size']; $offset = $data['offset'] ?? null;
        $bytes = base64_decode((string) ($data['data'] ?? ''), true);
        if (!is_int($offset) || $offset < 0 || $bytes === false || strlen($bytes) < 1 || strlen($bytes) > AIS_DR_CHUNK || $offset + strlen($bytes) > $max) throw new InvalidArgumentException('Некорректный фрагмент.');
        $target = "$root/$id.$part"; clearstatcache(true, $target); $length = is_file($target) ? filesize($target) : 0;
        if ($offset < $length && $offset + strlen($bytes) <= $length && file_get_contents($target, false, null, $offset, strlen($bytes)) === $bytes) return array('ok' => true);
        if ($offset !== $length) return ais_dr_error('Неверный порядок фрагментов.', 409);
        if (file_put_contents($target, $bytes, FILE_APPEND | LOCK_EX) !== strlen($bytes)) throw new RuntimeException('Не удалось записать фрагмент.');
        chmod($target, 0600); return array('ok' => true);
    }
    if ($action === 'commit' || $action === 'complete') {
        $input = $action === 'commit'; $target = "$root/$id." . ($input ? 'input' : 'output');
        if ($input && $job['state'] === 'queued') return array('ok' => true);
        if (($input && $job['state'] !== 'uploading') || (!$input && !isset($job['output']))) return ais_dr_error('Нельзя завершить загрузку.', 409);
        $expected = $input ? $job : $job['output']; clearstatcache(true, $target);
        if (!is_file($target) || filesize($target) !== $expected['size'] || !hash_equals($expected['digest'], hash_file('sha256', $target))) return ais_dr_error('Пакет загружен не полностью или повреждён.', 409);
        $job['state'] = $input ? 'queued' : 'complete';
        if (!$input) { $job['expires'] = $now + 600; if (is_file("$root/$id.input")) unlink("$root/$id.input"); }
        ais_dr_write($file, $job); return array('ok' => true);
    }
    if ($action === 'read') {
        $part = $worker_action ? 'input' : 'output'; $offset = $data['offset'] ?? null;
        if (!$worker_action && $job['state'] !== 'complete') return ais_dr_error('Результат ещё не готов.', 409);
        if (!is_int($offset) || $offset < 0 || $offset >= AIS_DR_MAX_BYTES) throw new InvalidArgumentException('Некорректное смещение.');
        $target = "$root/$id.$part";
        if (!is_file($target)) return ais_dr_error('Файл задания не найден.', 404);
        return array('data' => base64_encode(file_get_contents($target, false, null, $offset, AIS_DR_CHUNK)));
    }
    throw new InvalidArgumentException('Неизвестное действие очереди.');
}
function ais_dr_handle($request) {
    $root = ais_dr_root();
    if (!is_dir($root) && !mkdir($root, 0700, true)) return ais_dr_error('Не удалось открыть защищённую очередь.', 503);
    $lock = fopen($root . '/queue.lock', 'c');
    if (!$lock || !flock($lock, LOCK_EX)) { if ($lock) fclose($lock); return ais_dr_error('Очередь занята.', 503); }
    try {
        $data = $request->get_json_params();
        if (!is_array($data)) throw new InvalidArgumentException('Некорректный запрос.');
        $action = basename($request->get_route());
        $result = ais_dr_dispatch($root, $action, $data, time());
        if (ais_dr_is_error($result)) return $result;
        return class_exists('WP_REST_Response') ? new WP_REST_Response($result, 200, array('Cache-Control' => 'no-store, private')) : $result;
    } catch (InvalidArgumentException $error) { return ais_dr_error($error->getMessage(), 400);
    } catch (Throwable $error) { return ais_dr_error('Ошибка защищённой очереди. Повторите запрос.', 503);
    } finally { flock($lock, LOCK_UN); fclose($lock); }
}
if (!$ais_dr_direct) {
add_action('rest_api_init', function () {
    register_rest_route('ais-document-relay/v1', '/(?P<action>health|submit|put|commit|claim|read|renew|result-start|result-put|complete|status|cancel|ack)', array(
        'methods' => 'POST', 'permission_callback' => 'ais_dr_permission', 'callback' => 'ais_dr_handle'));
});
// Expired encrypted payloads are also removed when no desktop workers remain online.
add_action('init', function () {
    if (!wp_next_scheduled('ais_document_relay_cleanup')) wp_schedule_event(time() + 3600, 'hourly', 'ais_document_relay_cleanup');
});
add_action('ais_document_relay_cleanup', function () {
    $root = ais_dr_root();
    if (!is_dir($root)) return;
    $lock = fopen($root . '/queue.lock', 'c');
    if (!$lock) return;
    try { if (flock($lock, LOCK_EX)) ais_dr_cleanup($root, time()); }
    finally { flock($lock, LOCK_UN); fclose($lock); }
});
} else {
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store, private');
    header('X-Content-Type-Options: nosniff');
    $action = (string) ($_GET['action'] ?? '');
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST' || !preg_match('/^(health|submit|put|commit|claim|read|renew|result-start|result-put|complete|status|cancel|ack)$/D', $action)) {
        http_response_code(404); echo '{"message":"Not found"}'; exit;
    }
    $request = new class($action) {
        private $action, $body;
        function __construct($action) { $this->action = $action; $this->body = file_get_contents('php://input', false, null, 0, 700001); }
        function get_body() { return $this->body; }
        function get_method() { return 'POST'; }
        function get_route() { return '/ais-document-relay/v1/' . $this->action; }
        function get_query_params() { return array_diff_key($_GET, array('action' => true)); }
        function get_header($name) { return (string) ($_SERVER['HTTP_' . strtoupper(str_replace('-', '_', $name))] ?? ''); }
        function get_json_params() { return json_decode($this->body, true); }
    };
    $permission = ais_dr_permission($request);
    $result = $permission === true ? ais_dr_handle($request) : $permission;
    if (ais_dr_is_error($result)) { http_response_code($result->data['status']); echo json_encode(array('message' => $result->message)); }
    else echo json_encode($result, JSON_UNESCAPED_UNICODE);
}
