<?php

declare(strict_types=1);

if (!function_exists('mb_strtolower')) {
    function mb_strtolower(string $value, ?string $encoding = null): string
    {
        return strtr(strtolower($value), [
            'А' => 'а', 'Б' => 'б', 'В' => 'в', 'Г' => 'г', 'Д' => 'д', 'Е' => 'е',
            'Ё' => 'ё', 'Ж' => 'ж', 'З' => 'з', 'И' => 'и', 'Й' => 'й', 'К' => 'к',
            'Л' => 'л', 'М' => 'м', 'Н' => 'н', 'О' => 'о', 'П' => 'п', 'Р' => 'р',
            'С' => 'с', 'Т' => 'т', 'У' => 'у', 'Ф' => 'ф', 'Х' => 'х', 'Ц' => 'ц',
            'Ч' => 'ч', 'Ш' => 'ш', 'Щ' => 'щ', 'Ъ' => 'ъ', 'Ы' => 'ы', 'Ь' => 'ь',
            'Э' => 'э', 'Ю' => 'ю', 'Я' => 'я',
        ]);
    }
}

define('AIS_GATEWAY_LIBRARY_ONLY', true);
require_once dirname(__DIR__) . '/gateway.php';

function lifecycle_expect(bool $condition, string $message): void
{
    if (!$condition) {
        throw new RuntimeException($message);
    }
}

$active = 'ДЕЙСТВУЮЩИЕ ДОГОВОРА';
$partner = 'ПАРТНЕРСКАЯ ПРОГРАММА';
$expired = 'ИСТЕКШИЕ ДОГОВОРА';
$today = '2026-09-07';

lifecycle_expect(
    gateway_contract_calendar_date_key('2026-09-06T23:59:59+03:00') === '2026-09-06',
    'ISO-дата договора должна нормализоваться.'
);
lifecycle_expect(
    gateway_contract_calendar_date_key('06.09.2026') === '2026-09-06',
    'Русская дата договора должна нормализоваться.'
);
lifecycle_expect(
    gateway_contract_calendar_date_key('31.02.2026') === '',
    'Некорректная дата не должна нормализоваться.'
);

$past = ['section' => $active, 'status' => 'Действует', 'endDate' => '2026-09-06'];
$equal = ['section' => $active, 'status' => 'Действует', 'endDate' => $today];
$partnerPast = ['section' => $partner, 'status' => 'Партнерская программа', 'endDate' => '2020-01-01'];
$partnerPastWithEmptySection = [
    'section' => '',
    'status' => 'Партнерская программа',
    'endDate' => '2020-01-01',
];
lifecycle_expect(
    gateway_employee_contract_past_end_date($past, $today),
    'Вчерашний действующий договор должен считаться истёкшим.'
);
lifecycle_expect(
    !gateway_employee_contract_past_end_date($equal, $today),
    'Договор должен действовать весь день «Срок по».'
);
lifecycle_expect(
    !gateway_employee_contract_past_end_date($partnerPast, $today),
    'Партнёрский договор не должен переноситься автоматически.'
);
lifecycle_expect(
    !gateway_employee_contract_past_end_date($partnerPastWithEmptySection, $today),
    'Пустой section должен использовать партнёрский status.'
);
lifecycle_expect(
    (gateway_employee_auth_access($partnerPastWithEmptySection)['status'] ?? '') === 'active',
    'Партнёрский status должен давать доступ при пустом section.'
);

$normalizedPast = gateway_normalize_employee_contract_expiration($past, $today);
lifecycle_expect(($normalizedPast['section'] ?? '') === $expired, 'Раздел договора не обновлён.');
lifecycle_expect(($normalizedPast['status'] ?? '') === 'Истек', 'Статус договора не обновлён.');
lifecycle_expect(
    (gateway_employee_auth_access([
        'section' => $active,
        'status' => 'Действует',
        'endDate' => '2000-01-01',
    ])['status'] ?? '') === 'blocked',
    'PHP-авторизация должна блокировать raw-договор с истёкшим сроком.'
);
lifecycle_expect(
    (gateway_employee_auth_access([
        'section' => $partner,
        'status' => 'Партнерская программа',
        'endDate' => '2000-01-01',
    ])['status'] ?? '') === 'active',
    'Партнёрский доступ не должен блокироваться по сроку договора.'
);

$patch = gateway_normalize_shared_state_contract_patch([
    'collections' => [
        'contracts' => [
            'upserts' => [
                ['id' => 'past', 'section' => $active, 'status' => 'Действует', 'endDate' => '2000-01-01'],
                ['id' => 'partner', 'section' => $partner, 'status' => 'Партнерская программа', 'endDate' => '2000-01-01'],
            ],
        ],
    ],
]);
$patchRows = $patch['collections']['contracts']['upserts'] ?? [];
lifecycle_expect(($patchRows[0]['section'] ?? '') === $expired, 'POST patch должен истекать на шлюзе.');
lifecycle_expect(($patchRows[1]['section'] ?? '') === $partner, 'POST patch не должен менять партнёра.');

$data = gateway_normalize_shared_state_contract_data([
    'collections' => [
        'contracts' => [
            ['id' => 'past', 'section' => $active, 'status' => 'Действует', 'endDate' => '2000-01-01'],
        ],
    ],
    'dictionaries' => [],
]);
lifecycle_expect(
    ($data['collections']['contracts'][0]['section'] ?? '') === $expired,
    'Полная замена общей базы должна истекать на шлюзе.'
);

echo "PHP employee contract lifecycle tests passed.\n";
