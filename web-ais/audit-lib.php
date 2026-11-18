<?php

declare(strict_types=1);

const AIS_AUDIT_MAX_ROWS = 100000;
const AIS_AUDIT_MAX_CHANGES = 100;

function ais_audit_log_path(): string
{
    return ais_auth_storage_root() . '/audit-log.jsonl';
}

function ais_audit_text(mixed $value, int $limit = 2000): string
{
    if (is_array($value) || is_object($value)) {
        $encoded = json_encode($value, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        $value = $encoded === false ? '' : $encoded;
    }
    $text = trim(str_replace("\0", '', (string) $value));
    return mb_substr($text, 0, $limit, 'UTF-8');
}

function ais_audit_is_secret_field(string $field): bool
{
    return preg_match(
        '/(?:password|passwd|парол|secret|token|credential|jwt|photoData|authorization)/iu',
        $field
    ) === 1;
}

function ais_audit_changes(mixed $source): array
{
    if (!is_array($source)) {
        return [];
    }
    $changes = [];
    foreach (array_slice($source, 0, AIS_AUDIT_MAX_CHANGES) as $change) {
        if (!is_array($change)) {
            continue;
        }
        $field = ais_audit_text($change['field'] ?? '', 160);
        $label = ais_audit_text($change['label'] ?? $field, 240);
        if ($field === '' && $label === '') {
            continue;
        }
        $secret = ais_audit_is_secret_field($field . ' ' . $label);
        $changes[] = [
            'field' => $field,
            'label' => $label,
            'before' => $secret ? '[скрыто]' : ais_audit_text($change['before'] ?? '', 4000),
            'after' => $secret ? '[скрыто]' : ais_audit_text($change['after'] ?? '', 4000),
        ];
    }
    return $changes;
}

function ais_audit_client_ip(): string
{
    foreach (['HTTP_X_REAL_IP', 'REMOTE_ADDR'] as $key) {
        $candidate = trim((string) ($_SERVER[$key] ?? ''));
        if ($candidate !== '' && filter_var($candidate, FILTER_VALIDATE_IP) !== false) {
            return $candidate;
        }
    }
    return '';
}

function ais_audit_append(array $payload, array $user): array
{
    $action = ais_audit_text($payload['action'] ?? '', 240);
    $area = ais_audit_text($payload['area'] ?? '', 240);
    if ($action === '') {
        throw new InvalidArgumentException('Не указано действие для журнала изменений.');
    }
    $changes = ais_audit_changes($payload['changes'] ?? []);
    $entry = [
        'id' => bin2hex(random_bytes(16)),
        'createdAt' => gmdate('c'),
        'userId' => (string) ($user['id'] ?? ''),
        'user' => (string) ($user['login'] ?? 'system'),
        'userName' => (string) ($user['name'] ?? ''),
        'role' => (string) ($user['role'] ?? ''),
        'action' => $action,
        'area' => $area,
        'entityType' => ais_audit_text($payload['entityType'] ?? '', 160),
        'entityId' => ais_audit_text($payload['entityId'] ?? '', 240),
        'entityLabel' => ais_audit_text($payload['entityLabel'] ?? '', 500),
        'field' => ais_audit_text($payload['field'] ?? '', 240),
        'before' => ais_audit_text($payload['before'] ?? '', 4000),
        'after' => ais_audit_text($payload['after'] ?? '', 4000),
        'details' => ais_audit_text($payload['details'] ?? '', 4000),
        'changes' => $changes,
        'ip' => ais_audit_client_ip(),
        'userAgent' => ais_audit_text($_SERVER['HTTP_USER_AGENT'] ?? '', 500),
        'source' => ais_audit_text($payload['source'] ?? 'web', 80),
    ];
    if ($changes !== []) {
        if ($entry['field'] === '') {
            $entry['field'] = implode(', ', array_values(array_unique(array_map(
                static fn (array $change): string => $change['label'] !== '' ? $change['label'] : $change['field'],
                $changes
            ))));
        }
        if (count($changes) === 1) {
            $entry['before'] = $changes[0]['before'];
            $entry['after'] = $changes[0]['after'];
        }
    }
    if (ais_audit_is_secret_field($entry['field'])) {
        $entry['before'] = '[скрыто]';
        $entry['after'] = '[скрыто]';
    }

    $line = json_encode($entry, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    if ($line === false) {
        throw new RuntimeException('Не удалось подготовить запись журнала изменений.');
    }
    $path = ais_audit_log_path();
    if (file_put_contents($path, $line . "\n", FILE_APPEND | LOCK_EX) === false) {
        throw new RuntimeException('Не удалось записать журнал изменений.');
    }
    @chmod($path, 0600);
    return $entry;
}

function ais_audit_try_append(array $payload, array $user): ?array
{
    try {
        return ais_audit_append($payload, $user);
    } catch (Throwable $error) {
        error_log('AIS audit write failed: ' . $error->getMessage());
        return null;
    }
}

function ais_audit_read_rows(): array
{
    $path = ais_audit_log_path();
    if (!is_file($path)) {
        return [];
    }
    $rows = [];
    $file = new SplFileObject($path, 'rb');
    while (!$file->eof()) {
        $line = trim((string) $file->fgets());
        if ($line === '') {
            continue;
        }
        $row = json_decode($line, true);
        if (is_array($row)) {
            $rows[] = $row;
            if (count($rows) > AIS_AUDIT_MAX_ROWS) {
                array_shift($rows);
            }
        }
    }
    return array_reverse($rows);
}

function ais_audit_filter_text(array $filters, string $key): string
{
    return mb_strtolower(trim((string) ($filters[$key] ?? '')), 'UTF-8');
}

function ais_audit_row_search_text(array $row): string
{
    $changes = ais_audit_changes($row['changes'] ?? []);
    $changeText = implode(' ', array_map(static fn (array $change): string => implode(' ', $change), $changes));
    return mb_strtolower(implode(' ', [
        (string) ($row['createdAt'] ?? ''),
        (string) ($row['user'] ?? ''),
        (string) ($row['userName'] ?? ''),
        (string) ($row['role'] ?? ''),
        (string) ($row['action'] ?? ''),
        (string) ($row['area'] ?? ''),
        (string) ($row['entityType'] ?? ''),
        (string) ($row['entityId'] ?? ''),
        (string) ($row['entityLabel'] ?? ''),
        (string) ($row['field'] ?? ''),
        (string) ($row['before'] ?? ''),
        (string) ($row['after'] ?? ''),
        (string) ($row['details'] ?? ''),
        (string) ($row['ip'] ?? ''),
        (string) ($row['userAgent'] ?? ''),
        $changeText,
    ]), 'UTF-8');
}

function ais_audit_parse_boundary(string $value, bool $endOfDay): ?int
{
    $source = trim($value);
    if ($source === '') {
        return null;
    }
    if (preg_match('/^\d{4}-\d{2}-\d{2}$/', $source) === 1) {
        $source .= $endOfDay ? ' 23:59:59' : ' 00:00:00';
    }
    $timestamp = strtotime($source);
    return $timestamp === false ? null : $timestamp;
}

function ais_audit_matches(array $row, array $filters): bool
{
    $exactEntityType = trim((string) ($filters['entityTypeExact'] ?? ''));
    $exactEntityId = trim((string) ($filters['entityIdExact'] ?? ''));
    if ($exactEntityType !== '' && (string) ($row['entityType'] ?? '') !== $exactEntityType) {
        return false;
    }
    if ($exactEntityId !== '' && (string) ($row['entityId'] ?? '') !== $exactEntityId) {
        return false;
    }
    $from = ais_audit_parse_boundary((string) ($filters['from'] ?? ''), false);
    $to = ais_audit_parse_boundary((string) ($filters['to'] ?? ''), true);
    $createdAt = strtotime((string) ($row['createdAt'] ?? '')) ?: 0;
    if ($from !== null && $createdAt < $from) {
        return false;
    }
    if ($to !== null && $createdAt > $to) {
        return false;
    }
    $keys = [
        'user' => 'user',
        'userName' => 'userName',
        'role' => 'role',
        'action' => 'action',
        'area' => 'area',
        'entityType' => 'entityType',
        'entityId' => 'entityId',
        'entityLabel' => 'entityLabel',
        'field' => 'field',
        'before' => 'before',
        'after' => 'after',
        'details' => 'details',
        'ip' => 'ip',
        'userAgent' => 'userAgent',
        'source' => 'source',
    ];
    foreach ($keys as $filterKey => $rowKey) {
        $needle = ais_audit_filter_text($filters, $filterKey);
        if ($needle === '') {
            continue;
        }
        $haystack = mb_strtolower(ais_audit_text($row[$rowKey] ?? '', 12000), 'UTF-8');
        if (!str_contains($haystack, $needle)) {
            $changes = ais_audit_changes($row['changes'] ?? []);
            if ($filterKey === 'field') {
                $changeValues = implode(' ', array_map(
                    static fn (array $change): string => ($change['field'] ?? '') . ' ' . ($change['label'] ?? ''),
                    $changes
                ));
            } elseif ($filterKey === 'before' || $filterKey === 'after') {
                $changeValues = implode(' ', array_column($changes, $filterKey));
            } else {
                return false;
            }
            if (!str_contains(mb_strtolower($changeValues, 'UTF-8'), $needle)) {
                return false;
            }
        }
    }
    $query = ais_audit_filter_text($filters, 'q');
    return $query === '' || str_contains(ais_audit_row_search_text($row), $query);
}

function ais_audit_filter_rows(array $rows, array $filters): array
{
    return array_values(array_filter(
        $rows,
        static fn (array $row): bool => ais_audit_matches($row, $filters)
    ));
}

function ais_audit_filter_options(array $rows): array
{
    $keys = ['user', 'role', 'action', 'area', 'entityType', 'source'];
    $options = [];
    foreach ($keys as $key) {
        $values = [];
        foreach ($rows as $row) {
            $value = trim((string) ($row[$key] ?? ''));
            if ($value !== '') {
                $values[$value] = true;
            }
        }
        $list = array_keys($values);
        natcasesort($list);
        $options[$key] = array_values($list);
    }
    return $options;
}

function ais_audit_query(
    array $filters,
    int $page = 1,
    int $pageSize = 50,
    ?array $optionScope = null
): array
{
    $rows = ais_audit_read_rows();
    $filtered = ais_audit_filter_rows($rows, $filters);
    $optionRows = $optionScope === null ? $rows : ais_audit_filter_rows($rows, $optionScope);
    $pageSize = max(10, min(200, $pageSize));
    $total = count($filtered);
    $pages = max(1, (int) ceil($total / $pageSize));
    $page = max(1, min($page, $pages));
    return [
        'items' => array_slice($filtered, ($page - 1) * $pageSize, $pageSize),
        'total' => $total,
        'page' => $page,
        'pageSize' => $pageSize,
        'pages' => $pages,
        'options' => ais_audit_filter_options($optionRows),
    ];
}

function ais_audit_csv_cell(mixed $value): string
{
    $text = str_replace('"', '""', ais_audit_text($value, 32000));
    return '"' . $text . '"';
}

function ais_audit_changes_column(array $row, string $key): string
{
    return implode("\n", array_map(static function (array $change) use ($key): string {
        $label = (string) ($change['label'] ?? $change['field'] ?? '');
        $value = (string) ($change[$key] ?? '');
        return $label . ($value !== '' ? ': ' . $value : '');
    }, ais_audit_changes($row['changes'] ?? [])));
}

function ais_audit_export_csv(array $filters): string
{
    $rows = ais_audit_filter_rows(ais_audit_read_rows(), $filters);
    $columns = [
        'createdAt' => 'Дата и время',
        'user' => 'Логин',
        'userName' => 'Пользователь',
        'role' => 'Роль',
        'action' => 'Действие',
        'area' => 'Раздел',
        'entityType' => 'Тип объекта',
        'entityId' => 'ID объекта',
        'entityLabel' => 'Объект',
        'field' => 'Поля',
        'before' => 'Было',
        'after' => 'Стало',
        'details' => 'Подробности',
        'ip' => 'IP',
        'userAgent' => 'Клиент',
        'source' => 'Источник',
    ];
    $lines = [implode(';', array_map('ais_audit_csv_cell', array_values($columns)))];
    foreach ($rows as $row) {
        $values = [];
        foreach (array_keys($columns) as $key) {
            if ($key === 'before' && !empty($row['changes'])) {
                $values[] = ais_audit_changes_column($row, 'before');
            } elseif ($key === 'after' && !empty($row['changes'])) {
                $values[] = ais_audit_changes_column($row, 'after');
            } else {
                $values[] = $row[$key] ?? '';
            }
        }
        $lines[] = implode(';', array_map('ais_audit_csv_cell', $values));
    }
    return "\xEF\xBB\xBF" . implode("\r\n", $lines);
}
