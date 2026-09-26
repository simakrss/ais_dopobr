<?php
/**
 * Plugin Name: АИС — генератор образовательных программ
 * Description: Копирование проверяемых черновиков и создание файлов подключения к вебинарам.
 * Version: 1.7.7
 * Install as a MU plugin. The signing key belongs OUTSIDE public_html.
 */
defined('ABSPATH') || exit;

function ais_pg_error($message, $status = 400) {
    return new WP_Error('ais_pg_error', $message, array('status' => $status));
}
function ais_pg_role() {
    $host = strtolower((string) wp_parse_url(home_url(), PHP_URL_HOST));
    return $host === 'edu-plus.ru' ? 'edu' : ($host === 'zifra-plus.ru' ? 'shop' : '');
}
function ais_pg_signature($secret, $method, $resource, $timestamp, $nonce, $body) {
    return hash_hmac('sha256', implode("\n", array($method, $resource, $timestamp, $nonce, hash('sha256', $body))), $secret);
}
function ais_pg_permission($request) {
    if (!ais_pg_role()) return ais_pg_error('Модуль не настроен для этого сайта.', 503);
    if (current_user_can('manage_options')) return true;
    $key_file = dirname(rtrim(ABSPATH, '/\\')) . '/ais-program-site.key';
    $secret = is_readable($key_file) ? trim(file_get_contents($key_file)) : '';
    $stamp = $request->get_header('x-ais-timestamp');
    $nonce = $request->get_header('x-ais-nonce');
    $proof = $request->get_header('x-ais-signature');
    if (!preg_match('/^[a-f0-9]{64}$/D', $secret) || !ctype_digit($stamp)
        || abs(time() - (int) $stamp) > 300 || !preg_match('/^[a-f0-9]{32}$/D', $nonce)) {
        return ais_pg_error('Требуется авторизованный администратор или действующая подпись АИС.', 403);
    }
    $resource = '/wp-json' . $request->get_route();
    if ($request->get_query_params()) return ais_pg_error('Параметры URL для подписанного запроса недопустимы.', 403);
    $expected = ais_pg_signature($secret, $request->get_method(), $resource, $stamp, $nonce, $request->get_body());
    if (!hash_equals($expected, $proof)) return ais_pg_error('Неверная подпись АИС.', 403);
    // add_option is atomic; transients alone would permit concurrent replay.
    if (!add_option('_ais_pg_nonce_' . $nonce, (string) time(), '', false)) return ais_pg_error('Запрос уже обработан.', 409);
    global $wpdb;
    $wpdb->query($wpdb->prepare("DELETE FROM {$wpdb->options} WHERE option_name LIKE %s AND CAST(option_value AS UNSIGNED) < %d", $wpdb->esc_like('_ais_pg_nonce_') . '%', time() - 610));
    return true;
}
function ais_pg_join_url($value) {
    $url = trim((string) $value);
    $parts = wp_parse_url($url);
    if (!$parts || ($parts['scheme'] ?? '') !== 'https' || isset($parts['user']) || isset($parts['pass']) || isset($parts['port'])
        || !preg_match('/^[a-z0-9.-]+\.[a-z]{2,}$/iD', $parts['host'] ?? '')
        || preg_match('/(?:^|\.)(?:localhost|local|internal|test)$/iD', $parts['host']) || strlen($url) > 2000
        || preg_match('/[\r\n]/', $url)) throw new RuntimeException('Некорректная HTTPS-ссылка SberJazz.');
    return esc_url_raw($url, array('https'));
}
function ais_pg_identity($data) {
    if (!preg_match('/^[a-f0-9]{64}$/D', $data['key'] ?? '') || !preg_match('/^[a-f0-9]{64}$/D', $data['hash'] ?? '')) {
        throw new RuntimeException('Не указан идентификатор программы или версия данных.');
    }
}
function ais_pg_program_type($data) {
    $type = $data['type'] ?? 'ПРО';
    if (!in_array($type, array('ПРО', 'ДОП', 'КПК', 'ППП'), true)) throw new RuntimeException('Недопустимый вид образовательной программы.');
    return $type;
}
function ais_pg_post_type($type) {
    return $type === 'КПК' ? 'courses-pk' : ($type === 'ППП' ? 'courses-pp' : 'other-course');
}
function ais_pg_landing_url($type, $slug) {
    $post_type = ais_pg_post_type($type);
    return 'https://edu-plus.ru/' . ($post_type === 'other-course' ? 'other_course' : $post_type) . '/' . $slug . '/';
}
function ais_pg_find($key) {
    $ids = get_posts(array('post_type' => ais_pg_role() === 'shop' ? 'product' : array('other-course', 'courses-pk', 'courses-pp'),
        'post_status' => array('draft', 'publish', 'pending', 'private', 'trash', 'future'), 'posts_per_page' => 2,
        'fields' => 'ids', 'meta_key' => '_ais_generator_key', 'meta_value' => $key));
    if (count($ids) > 1) throw new RuntimeException('Найдены несколько документов программы. Требуется проверка администратором.');
    if ($ids && !in_array(get_post_status($ids[0]), array('draft', 'publish'), true)) throw new RuntimeException('Созданный объект перемещён или удалён. Проверьте его в WordPress.');
    return $ids ? (int) $ids[0] : 0;
}
function ais_pg_result($id) {
    return array('id' => (int) $id, 'status' => get_post_status($id), 'url' => get_permalink($id),
        'slug' => get_post_field('post_name', $id), 'postType' => get_post_type($id),
        'redirectEnabled' => get_post_meta($id, '_ais_landing_redirect', true) === '1',
        'editUrl' => admin_url('post.php?post=' . (int) $id . '&action=edit'),
        'previewUrl' => add_query_arg(array('p' => (int) $id, 'preview' => 'true', 'post_type' => get_post_type($id)), home_url('/')));
}
function ais_pg_slug($slug, $type, $own_id = 0) {
    if (!is_string($slug) || !preg_match('/^[a-z0-9][a-z0-9_-]{1,79}$/D', $slug)) throw new RuntimeException('Недопустимый код лендинга.');
    $collision = get_page_by_path($slug, OBJECT, $type === 'product' ? 'product' : array('other-course', 'courses-pk', 'courses-pp', 'page', 'post'));
    if ($collision && (int) $collision->ID !== (int) $own_id) throw new RuntimeException('Этот адрес уже занят. Существующая страница не изменена; задайте другой код лендинга для новой страницы.');
}
// Read-only suggestion: no reservation, post or metadata writes. prepare-landing
// rechecks the address to reject a collision that occurs after this lookup.
function ais_pg_landing_code($data) {
    if (ais_pg_role() !== 'edu') throw new RuntimeException('Операция доступна только на сайте программ.');
    if (!is_string($data['key'] ?? null) || !preg_match('/^[a-f0-9]{64}$/D', $data['key'])) throw new RuntimeException('Недопустимый ключ программы.');
    if (!in_array($data['postType'] ?? '', array('other-course', 'courses-pk', 'courses-pp'), true)) throw new RuntimeException('Недопустимый вид программы.');
    $slug = $data['slug'] ?? '';
    if (!is_string($slug) || !preg_match('/^[a-z0-9][a-z0-9_-]{1,79}$/D', $slug)) throw new RuntimeException('Недопустимый код лендинга.');
    $own_id = ais_pg_find($data['key']);
    if ($own_id) {
        $post = get_post($own_id);
        if (!$post || $post->post_type !== $data['postType']) throw new RuntimeException('Вид программы отличается от уже созданного лендинга.');
        if (($data['exact'] ?? false) === true && $post->post_status === 'publish' && $slug !== $post->post_name) throw new RuntimeException('Адрес опубликованного лендинга отличается от поля «На промо сайте». Автоматическое переименование опубликованной страницы запрещено.');
        if (($data['exact'] ?? false) !== true) $slug = $post->post_name;
        ais_pg_slug($slug, $data['postType'], $own_id);
        return array('slug' => $slug);
    }
    if (($data['exact'] ?? false) === true) {
        ais_pg_slug($slug, $data['postType']);
        return array('slug' => $slug);
    }
    for ($attempt = 0; $attempt < 100; $attempt++) {
        $suffix = $attempt ? '-' . substr($data['key'], 0, 8) . ($attempt > 1 ? '-' . $attempt : '') : '';
        $candidate = $attempt ? rtrim(substr($slug, 0, 80 - strlen($suffix)), '-_') . $suffix : $slug;
        $collision = get_page_by_path($candidate, OBJECT, array('other-course', 'courses-pk', 'courses-pp', 'page', 'post'));
        if (!$collision) return array('slug' => $candidate);
    }
    throw new RuntimeException('Не удалось подобрать свободный адрес лендинга. Повторите подготовку позже.');
}
/** Export repeater/group values by field NAME; import them by ACF field KEY. */
function ais_pg_acf_value($field, $value, $writing = false) {
    if (!is_array($value)) return $value;
    $type = $field['type'] ?? '';
    if ($type === 'repeater' || $type === 'flexible_content') {
        $rows = array();
        foreach ($value as $row) {
            if (!is_array($row)) continue;
            $definition = $field;
            if ($type === 'flexible_content') {
                foreach ($field['layouts'] ?? array() as $layout) {
                    if (($layout['name'] ?? '') === ($row['acf_fc_layout'] ?? '')) $definition = $layout;
                }
            }
            $definition['type'] = 'group';
            $rows[] = ais_pg_acf_value($definition, $row, $writing);
        }
        return $rows;
    }
    if ($type === 'group') {
        $out = isset($value['acf_fc_layout']) ? array('acf_fc_layout' => $value['acf_fc_layout']) : array();
        foreach ($field['sub_fields'] ?? array() as $sub) {
            $source_key = array_key_exists($sub['name'], $value) ? $sub['name'] : $sub['key'];
            if (array_key_exists($source_key, $value)) $out[$writing ? $sub['key'] : $sub['name']] = ais_pg_acf_value($sub, $value[$source_key], $writing);
        }
        return $out;
    }
    return $value;
}
function ais_pg_template($id) {
    $post = get_post($id);
    if (!$post || !in_array($post->post_type, array('other-course', 'courses-pk', 'courses-pp'), true) || $post->post_status !== 'publish') throw new RuntimeException('Выберите опубликованную образовательную программу.');
    if (!function_exists('get_field_objects')) throw new RuntimeException('На сайте недоступен ACF.');
    return $post;
}
function ais_pg_start_label($id) {
    $value = get_post_meta($id, 'data_starta', true);
    return is_string($value) ? $value : '';
}
function ais_pg_certificate_slots($type = 'ПРО') {
    $second = in_array($type, array('КПК', 'ППП'), true) ? 'page-2' : 'en';
    return array('izobrazhenie_vydavaemogo_dokumenta' => 'ru', 'prevyu_vydavaemogo_dokumenta_1' => 'ru',
        'izobrazhenie_vydavaemogo_dokumenta_2' => $second, 'prevyu_vydavaemogo_dokumenta_2' => $second);
}
function ais_pg_certificate_key($key, $hash, $language) {
    if (!preg_match('/^[a-f0-9]{64}$/D', $hash) || !preg_match('/^(?:ru|en|page-[2-8])$/D', $language)) throw new RuntimeException('Не указана версия образцов документов.');
    return hash('sha256', $key . ':' . $hash . ':' . $language);
}
function ais_pg_certificate_pages($images, $type) {
    $bilingual = in_array($type, array('ПРО', 'ДОП'), true);
    if (!is_array($images) || ($bilingual ? count($images) !== 2 : count($images) < 3 || count($images) > 8)) throw new RuntimeException('Не переданы все страницы образца документа.');
    foreach (array_values($images) as $index => $image) {
        $expected = $index === 0 ? 'ru' : ($bilingual ? 'en' : 'page-' . ($index + 1));
        if (($image['language'] ?? '') !== $expected) throw new RuntimeException('Нарушен порядок страниц образца документа.');
    }
    return $images;
}
function ais_pg_certificate_assets($data) {
    $own_id = ais_pg_find($data['key']);
    if ($own_id && get_post_status($own_id) === 'publish' && get_post_meta($own_id, '_ais_generator_hash', true) !== $data['hash']) {
        throw new RuntimeException('Программа уже опубликована с другими параметрами. Автоматическая перезапись запрещена.');
    }
    return ais_pg_upload_certificate_assets($data);
}
function ais_pg_upload_certificate_assets($data) {
    $type = ais_pg_program_type($data);
    $images = ais_pg_certificate_pages($data['images'] ?? null, $type);
    $validated = array();
    foreach ($images as $image) {
        $language = $image['language'] ?? '';
        $asset_key = ais_pg_certificate_key($data['key'], $data['certificateHash'] ?? '', $language);
        if (isset($validated[$language])) throw new RuntimeException('Языки образцов сертификатов повторяются.');
        $encoded = $image['base64'] ?? '';
        if (!is_string($encoded) || strlen($encoded) > 1400000) throw new RuntimeException('Образец сертификата превышает допустимый размер.');
        $bytes = base64_decode($encoded, true);
        $info = $bytes ? @getimagesizefromstring($bytes) : false;
        if (!$info || $info[2] !== IMAGETYPE_JPEG || strlen($bytes) > 1024 * 1024
            || min($info[0], $info[1]) < 600 || max($info[0], $info[1]) > 2200) {
            throw new RuntimeException('Образцы должны быть изображениями JPEG размером 600–2200 пикселей, до 1 МБ.');
        }
        $validated[$language] = array('bytes' => $bytes, 'key' => $asset_key);
    }
    require_once ABSPATH . 'wp-admin/includes/image.php';
    $result = array();
    foreach ($validated as $language => $image) {
        $ids = get_posts(array('post_type' => 'attachment', 'post_status' => 'inherit', 'posts_per_page' => 2,
            'fields' => 'ids', 'meta_key' => '_ais_certificate_key', 'meta_value' => $image['key']));
        if (count($ids) > 1) throw new RuntimeException('Найдено несколько одинаковых образцов. Проверьте медиатеку.');
        $id = $ids ? (int) $ids[0] : 0;
        if ($id && !is_file(get_attached_file($id))) throw new RuntimeException('Файл образца удалён из медиатеки. Восстановите его перед повторной подготовкой.');
        if (!$id) {
            $uploaded = wp_upload_bits('certificate-sample-' . $image['key'] . '-' . $language . '.jpg', null, $image['bytes']);
            if (!empty($uploaded['error'])) throw new RuntimeException('Не удалось загрузить образец сертификата в медиатеку.');
            $id = wp_insert_attachment(array('post_title' => 'Образец документа ' . $type . ' / SAMPLE — ' . strtoupper($language),
                'post_mime_type' => 'image/jpeg', 'post_status' => 'inherit',
                'meta_input' => array('_ais_certificate_key' => $image['key'])), $uploaded['file'], 0, true);
            if (is_wp_error($id)) {
                wp_delete_file($uploaded['file']);
                throw new RuntimeException('Не удалось зарегистрировать образец сертификата в медиатеке.');
            }
            update_post_meta($id, '_wp_attachment_image_alt', 'Образец документа ' . $type . ' — ' . ($language === 'ru' ? 'основной документ' : ($language === 'en' ? 'English' : 'приложение ' . substr($language, 5))));
        }
        // Recover interrupted thumbnail generation without uploading another attachment.
        if (!wp_get_attachment_metadata($id)) wp_update_attachment_metadata($id, wp_generate_attachment_metadata($id, get_attached_file($id)));
        $result[] = array('id' => $id, 'language' => $language, 'url' => wp_get_attachment_url($id));
    }
    return array('ok' => true, 'images' => $result);
}
function ais_pg_validate_certificates($data) {
    $type = ais_pg_program_type($data);
    $pages = $data['certificatePages'] ?? null;
    if ($pages !== null || in_array($type, array('КПК', 'ППП'), true)) {
        $pages = ais_pg_certificate_pages($pages, $type);
        foreach ($pages as $page) ais_pg_validate_certificate_asset($data, (int) ($page['id'] ?? 0), $page['language']);
        if (!in_array($type, array('ПРО', 'ДОП'), true)) {
            $slider = array_map(function ($row) { return (int) ($row['izobrazhenie_slajda'] ?? 0); }, $data['fields']['slajder'] ?? array());
            if ($slider !== array_map(function ($row) { return (int) $row['id']; }, $pages)) throw new RuntimeException('Не все страницы приложения размещены в галерее лендинга.');
        }
    }
    foreach (ais_pg_certificate_slots($type) as $slot => $language) {
        $id = (int) ($data['fields'][$slot] ?? 0);
        ais_pg_validate_certificate_asset($data, $id, $language);
    }
}
function ais_pg_validate_certificate_asset($data, $id, $language) {
        $expected = ais_pg_certificate_key($data['key'], $data['certificateHash'] ?? '', $language);
        if (!$id || get_post_type($id) !== 'attachment' || get_post_mime_type($id) !== 'image/jpeg'
            || get_post_meta($id, '_ais_certificate_key', true) !== $expected || !is_file(get_attached_file($id))) {
            throw new RuntimeException('Для лендинга не загружены актуальные образцы сертификатов. Повторите подготовку.');
        }
}
// Keep this transform in parity with updateWebinarSchedule (shared regression fixtures).
// Mask markup at equal byte offsets; replace text tokens, never HTML attributes or links.
function ais_pg_webinar_schedule($value, $data, $name = '') {
    if (($data['type'] ?? '') !== 'ПРО' || empty($data['date']) || empty($data['time'])
        || $name === 'blok_opisaniya_kursa' || preg_match('/otzyv|review/i', $name)) return $value;
    if (!preg_match('/^(20\d{2})-(\d{2})-(\d{2})$/D', $data['date'], $date)
        || !checkdate((int) $date[2], (int) $date[3], (int) $date[1])
        || !preg_match('/^([01]\d|2[0-3]):([0-5]\d)$/D', $data['time'], $time)) throw new RuntimeException('Проверьте дату и время вебинара.');
    if (is_array($value)) {
        foreach ($value as $key => $item) $value[$key] = ais_pg_webinar_schedule($item, $data, is_string($key) ? $key : $name);
        return $value;
    }
    if (!is_string($value)) return $value;
    $months = explode(' ', 'января февраля марта апреля мая июня июля августа сентября октября ноября декабря');
    $shadow = preg_replace_callback('~<!--[\s\S]*?-->|<(script|style)\b[^>]*>[\s\S]*?</\1\s*>|<[^>]*>|&(?:nbsp|\#160|\#x0*a0|\#32|\#x20);~i', function ($m) { return str_repeat(' ', strlen($m[0])); }, $value);
    $pattern = '~(?<![\p{L}\d])(?:(?<isoYear>20\d{2})\s*-\s*(?<isoMonth>0?[1-9]|1[0-2])\s*-\s*(?<isoDay>0?[1-9]|[12]\d|3[01])|(?<day>0?[1-9]|[12]\d|3[01])\s*(?:[./-]|\s+)\s*(?<month>' . implode('|', $months) . '|0?[1-9]|1[0-2])\s*(?:[./-]|\s+)\s*(?<year>20\d{2}))(?!\d)~iu';
    $time_pattern = '~^\s*(?:года|год|г\.)?\s*(?:[,—–-]\s*)?(?:в\s*)?(?<hour>[01]?\d|2[0-3])\s*[:.]\s*(?<minute>[0-5]\d)(?!\d)~iu';
    $edits = array();
    $add = function ($match, $token, $replacement, $offset = 0) use (&$edits) {
        if (isset($match[$token]) && $match[$token][1] >= 0 && $match[$token][0] !== '') $edits[] = array($offset + $match[$token][1], strlen($match[$token][0]), $replacement);
    };
    preg_match_all($pattern, $shadow, $matches, PREG_SET_ORDER | PREG_OFFSET_CAPTURE | PREG_UNMATCHED_AS_NULL);
    foreach ($matches as $match) {
        $old_month = $match['isoMonth'][0] ?: $match['month'][0];
        if (!ctype_digit((string) $old_month)) foreach ($months as $index => $label) if (preg_match('~^' . $label . '$~iu', $old_month)) { $old_month = $index + 1; break; }
        if (!checkdate((int) $old_month, (int) ($match['isoDay'][0] ?: $match['day'][0]), (int) ($match['isoYear'][0] ?: $match['year'][0]))) continue;
        $end = $match[0][1] + strlen($match[0][0]);
        $has_time = preg_match($time_pattern, substr($shadow, $end), $time_match, PREG_OFFSET_CAPTURE);
        $context = substr($shadow, 0, $match[0][1]);
        if (!in_array($name, array('opisanie_dokumenta','opisanie_o_programme','descriptionHtml','post_content','post_excerpt'), true)
            && !$has_time && !preg_match('~(?:расписани|трансляци|начало|состоится|дата\s+(?:вебинара|семинара|проведения))[\s\S]{0,160}$~iu', $context)) continue;
        $add($match, 'isoYear', $date[1]); $add($match, 'isoMonth', $date[2]); $add($match, 'isoDay', $date[3]);
        $add($match, 'year', $date[1]); $add($match, 'day', strlen($match['day'][0] ?? '') === 2 ? $date[3] : (string) (int) $date[3]);
        $old_label = $match['month'][0] ?? '';
        $label = ctype_digit($old_label) ? (strlen($old_label) === 2 ? $date[2] : (string) (int) $date[2]) : $months[(int) $date[2] - 1];
        if (preg_match('/^[А-ЯЁ]+$/u', $old_label)) {
            $label = explode(' ', 'ЯНВАРЯ ФЕВРАЛЯ МАРТА АПРЕЛЯ МАЯ ИЮНЯ ИЮЛЯ АВГУСТА СЕНТЯБРЯ ОКТЯБРЯ НОЯБРЯ ДЕКАБРЯ')[(int) $date[2] - 1];
        } elseif (preg_match('/^[А-ЯЁ]/u', $old_label)) {
            $label = explode(' ', 'Января Февраля Марта Апреля Мая Июня Июля Августа Сентября Октября Ноября Декабря')[(int) $date[2] - 1];
        }
        $add($match, 'month', $label);
        if ($has_time) { $add($time_match, 'hour', $time[1], $end); $add($time_match, 'minute', $time[2], $end); }
    }
    preg_match_all('~(?:время\s*(?:начала|трансляции|вебинара)?|начало\s*(?:трансляции|вебинара)?)\s*[:—–-]?\s*(?:в\s*)?(?<hour>[01]?\d|2[0-3])\s*[:.]\s*(?<minute>[0-5]\d)(?!\d)~iu', $shadow, $matches, PREG_SET_ORDER | PREG_OFFSET_CAPTURE);
    foreach ($matches as $match) { $add($match, 'hour', $time[1]); $add($match, 'minute', $time[2]); }
    usort($edits, function ($a, $b) { return $b[0] <=> $a[0]; });
    $boundary = strlen($value);
    foreach ($edits as $edit) {
        if ($edit[0] + $edit[1] > $boundary) continue;
        $value = substr_replace($value, $edit[2], $edit[0], $edit[1]);
        $boundary = $edit[0];
    }
    return $value;
}
function ais_pg_registration_links($value, $product_id, $name = '') {
    if ($product_id < 1 || $name === 'blok_opisaniya_kursa' || preg_match('/otzyv|review/i', $name)) return $value;
    if (is_array($value)) {
        foreach ($value as $key => $item) $value[$key] = ais_pg_registration_links($item, $product_id, is_string($key) ? $key : $name);
        return $value;
    }
    if (!is_string($value)) return $value;
    return preg_replace_callback('~https?://zifra-plus\.ru/[^\s"\'<>]+~i', function ($match) use ($product_id) {
        $url = wp_parse_url(html_entity_decode($match[0], ENT_QUOTES, 'UTF-8'));
        if (!$url || !in_array(rtrim($url['path'] ?? '', '/'), array('', '/checkout', '/cart'), true)) return $match[0];
        parse_str($url['query'] ?? '', $query);
        if (!is_scalar($query['add-to-cart'] ?? null) || !preg_match('/^[1-9]\d*$/D', (string) $query['add-to-cart'])) return $match[0];
        return preg_replace_callback('/([?&](?:amp;)?add-to-cart=)\d+/', function ($part) use ($product_id) { return $part[1] . (int) $product_id; }, $match[0]);
    }, $value);
}
function ais_pg_prepare_landing($data) {
    $type = ais_pg_program_type($data);
    $post_type = ais_pg_post_type($type);
    $template = ais_pg_template((int) ($data['templateId'] ?? 0));
    if ($type !== 'ДОП' && $template->post_type !== $post_type) throw new RuntimeException('Выберите прототип соответствующего вида программы.');
    if ($template->post_modified_gmt !== ($data['templateModified'] ?? '')) throw new RuntimeException('Прототип изменился. Повторите подготовку.');
    $image_source = isset($data['imageSource']) ? ais_pg_validate_image_source($data['imageSource']) : null;
    $id = ais_pg_find($data['key']);
    ais_pg_slug($data['slug'] ?? '', $post_type, $id);
    if ($id && get_post_meta($id, '_ais_generator_hash', true) === $data['hash']) return ais_pg_result($id);
    if ($id && get_post_status($id) === 'publish') throw new RuntimeException('Программа уже опубликована с другими параметрами. Отредактируйте её в WordPress; автоматическая перезапись запрещена.');
    $title = sanitize_text_field($data['title'] ?? '');
    if (!$title || !is_array($data['fields'] ?? null)) throw new RuntimeException('Не заполнены название или поля лендинга.');
    $definition = get_field_objects($template->ID, false) ?: array();
    if (!$definition) throw new RuntimeException('Прототип не содержит полей ACF.');
    ais_pg_validate_certificates($data);
    $field_names = array_column($definition, 'name');
    foreach (ais_pg_certificate_slots($type) as $slot => $_language) {
        if (!in_array($slot, $field_names, true)) throw new RuntimeException('В прототипе отсутствуют блоки образцов сертификатов.');
    }
    $post_data = array('post_title' => $title, 'post_name' => $data['slug'], 'post_type' => $post_type, 'post_status' => 'draft',
        'post_content' => ais_pg_webinar_schedule($template->post_content, $data, 'post_content'), 'post_excerpt' => ais_pg_webinar_schedule($template->post_excerpt, $data, 'post_excerpt'),
        'meta_input' => array('_ais_generator_key' => $data['key'], '_ais_generator_template' => $template->ID));
    foreach (array('post_content', 'post_excerpt') as $key) $post_data[$key] = ais_pg_registration_links($post_data[$key], (int) ($data['productId'] ?? 0), $key);
    if ($id) $post_data['ID'] = $id;
    $id = wp_insert_post(wp_slash($post_data), true);
    if (is_wp_error($id)) throw new RuntimeException('Не удалось сохранить черновик лендинга.');
    foreach ($definition as $field) {
        // Copy description, author and reviews from the authoritative prototype.
        if (in_array($field['name'], array('blok_opisaniya_kursa', 'opisanie_dokumenta', 'opisanie_o_programme', 'tekst_etap_obucheniya_1'), true)
            || preg_match('/otzyv|review/i', $field['name'])) {
            $data['fields'][$field['name']] = ais_pg_webinar_schedule(ais_pg_acf_value($field, $field['value']), $data, $field['name']);
        }
        if (array_key_exists($field['name'], $data['fields'])) {
            $value = ais_pg_registration_links($data['fields'][$field['name']], (int) ($data['productId'] ?? 0), $field['name']);
            update_field($field['key'], ais_pg_acf_value($field, $value, true), $id);
        }
    }
    $thumbnail = $image_source ? $image_source['imageId'] : get_post_thumbnail_id($template->ID);
    if ($thumbnail) set_post_thumbnail($id, $thumbnail);
    if ($thumbnail && (int) get_post_thumbnail_id($id) !== (int) $thumbnail) throw new RuntimeException('Сайт не подтвердил изображение записи. Повторите подготовку.');
    // Only public taxonomies; never copy edit locks, secrets, author/session metadata.
    foreach (get_object_taxonomies($post_type, 'objects') as $taxonomy) {
        if ($taxonomy->public) wp_set_object_terms($id, wp_get_object_terms($template->ID, $taxonomy->name, array('fields' => 'ids')), $taxonomy->name);
    }
    update_post_meta($id, '_ais_generator_product', (int) ($data['productId'] ?? 0));
    foreach (ais_pg_certificate_slots($type) as $slot => $_language) {
        if ((int) get_field($slot, $id, false) !== (int) $data['fields'][$slot]) throw new RuntimeException('WordPress не подтвердил подстановку образцов. Повторите подготовку.');
    }
    update_post_meta($id, '_ais_certificate_hash', $data['certificateHash']);
    update_post_meta($id, '_ais_program_type', $type);
    update_post_meta($id, '_ais_certificate_pages', $data['certificatePages'] ?? array());
    update_post_meta($id, '_ais_generator_hash', $data['hash']);
    return ais_pg_result($id);
}
function ais_pg_public_webinar_file($key, $slug, $name, $url) {
    if (ais_pg_role() !== 'shop' || !preg_match('/^[a-f0-9]{64}$/D', $key)
        || !preg_match('/^[a-z0-9][a-z0-9_-]{1,79}$/D', $slug)) throw new RuntimeException('Проверьте код файла подключения к вебинару.');
    $url = ais_pg_join_url($url);
    $uploads = wp_upload_dir();
    if (!empty($uploads['error']) || !preg_match('~^https?://zifra-plus\.ru/wp-content/uploads/?$~D', $uploads['baseurl'] ?? '')) {
        throw new RuntimeException('Не удалось определить папку скачиваемых файлов магазина.');
    }
    $dir = rtrim($uploads['basedir'], '/\\') . '/dae-uploads/webinars';
    $locks = dirname(rtrim(ABSPATH, '/\\')) . '/ais-webinar-files/public-locks';
    if (!wp_mkdir_p($dir) || !wp_mkdir_p($locks)) throw new RuntimeException('Не удалось создать папку файлов подключения.');
    // This public HTML is intentional: the administrator requested a direct
    // webinar URL. Only escaped text/HTTPS URLs are written, never template HTML.
    $marker = '<!-- AIS webinar ' . $key . ' -->';
    $href = htmlspecialchars($url, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
    $title = htmlspecialchars($name, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
    $content = "<!doctype html>\n<html lang=\"ru\"><head><meta charset=\"utf-8\">\n"
        . $marker . "\n<meta name=\"robots\" content=\"noindex, nofollow\"><meta name=\"referrer\" content=\"no-referrer\">\n"
        . '<meta http-equiv="refresh" content="0;URL=' . $href . '"><title>' . $title . "</title></head>\n"
        . '<body><p>Подключение к вебинару: ' . $title . '</p><p>Если переход не произошёл автоматически, '
        . '<a rel="noreferrer" href="' . $href . '">нажмите здесь для подключения</a>.</p></body></html>' . "\n";
    $file = $dir . '/' . $slug . '.html';
    $lock = fopen($locks . '/' . $slug . '.lock', 'c');
    if (!$lock) throw new RuntimeException('Не удалось открыть файл подключения для сохранения.');
    $temporary = false;
    try {
        if (!flock($lock, LOCK_EX | LOCK_NB)) throw new RuntimeException('Файл подключения сейчас занят. Повторите подготовку.');
        if (is_link($file) || (file_exists($file) && (!is_file($file) || strpos((string) file_get_contents($file), $marker) === false))) {
            throw new RuntimeException('HTML-файл с таким кодом уже существует и создан не этой программой. Он не изменён; выберите другой код.');
        }
        if (!is_file($file) || file_get_contents($file) !== $content) {
            $temporary = tempnam($dir, '.ais-');
            if (!$temporary || file_put_contents($temporary, $content, LOCK_EX) !== strlen($content)
                || !chmod($temporary, 0644) || !rename($temporary, $file)) throw new RuntimeException('Не удалось сохранить HTML-файл подключения. Повторите подготовку.');
            $temporary = false;
        }
    } finally {
        if ($temporary && is_file($temporary)) unlink($temporary);
        flock($lock, LOCK_UN); fclose($lock);
    }
    return 'https://zifra-plus.ru/wp-content/uploads/dae-uploads/webinars/' . $slug . '.html';
}
function ais_pg_connection_file($key, $name, $url, $type = 'ПРО', $slug = '') {
    if ($type === 'ПРО') return ais_pg_public_webinar_file($key, $slug, $name, $url);
    // Keep the existing private education-info downloads for non-webinar courses.
    $dir = dirname(rtrim(ABSPATH, '/\\')) . '/ais-webinar-files/' . $key;
    if (!wp_mkdir_p($dir)) throw new RuntimeException('Не удалось создать защищённую папку подключения.');
    $file = $dir . '/connection.txt';
    $content = $name . "\r\n\r\nИнформация об обучении:\r\n" . $url . "\r\n";
    if (file_put_contents($file, $content, LOCK_EX) !== strlen($content)) throw new RuntimeException('Не удалось сохранить файл подключения.');
    @chmod($file, 0600);
    return $file;
}
function ais_pg_download_formats() {
    $formats = array();
    if (!class_exists('WC_Product_Download')) return $formats;
    foreach (array('html', 'txt') as $extension) {
        $download = new WC_Product_Download();
        $download->set_file(dirname(rtrim(ABSPATH, '/\\')) . '/ais-webinar-files/format-check/connection.' . $extension);
        $formats[$extension] = $download->is_allowed_filetype();
    }
    return $formats;
}
function ais_pg_product_prototype_categories($data) {
    // Older clients may resume a draft without category-copy parameters.
    if (!array_key_exists('productTemplateId', $data)) return null;
    $id = $data['productTemplateId'];
    if ((!is_int($id) && !is_string($id)) || !preg_match('/^[1-9]\d*$/D', (string) $id) || (string) (int) $id !== (string) $id) throw new RuntimeException('Некорректный товар-прототип для копирования категорий.');
    $product = wc_get_product((int) $id);
    if (!$product || !$product->is_type('simple') || !in_array($product->get_status('edit'), array('draft', 'publish'), true)) throw new RuntimeException('Товар-прототип в интернет-магазине не найден или недоступен. Категории не скопированы. Проверьте ссылку регистрации прототипа.');
    return array_map('intval', $product->get_category_ids('edit'));
}
function ais_pg_prepare_product($data) {
    if (!class_exists('WC_Product_Simple') || !class_exists('WC_Product_Download')) throw new RuntimeException('WooCommerce недоступен.');
    $id = ais_pg_find($data['key']);
    ais_pg_slug($data['slug'] ?? '', 'product', $id);
    $landing_slug = $data['landingSlug'] ?? $data['slug'];
    if (!is_string($landing_slug) || !preg_match('/^[a-z0-9][a-z0-9_-]{1,79}$/D', $landing_slug)) throw new RuntimeException('Некорректный адрес общего лендинга.');
    if ($id && get_post_meta($id, '_ais_generator_hash', true) !== $data['hash'] && get_post_status($id) === 'publish') throw new RuntimeException('Товар уже опубликован с другими параметрами. Автоматическая перезапись запрещена.');
    $category_ids = ais_pg_product_prototype_categories($data);
    if ($id && get_post_meta($id, '_ais_generator_hash', true) === $data['hash']) {
        $product = wc_get_product($id);
        if (!$product || !$product->is_type('simple')) throw new RuntimeException('Неверный тип ранее созданного товара.');
        // Repair only this generated product when resuming preparation.
        $changed = false;
        if (!$product->get_sold_individually('edit')) {
            $product->set_sold_individually(true);
            $changed = true;
        }
        if ($category_ids !== null && ($product->get_category_ids('edit') !== $category_ids
            || (int) get_post_meta($id, '_ais_generator_product_template', true) !== (int) $data['productTemplateId'])) {
            $product->set_category_ids($category_ids);
            $product->update_meta_data('_ais_generator_product_template', (int) $data['productTemplateId']);
            $changed = true;
        }
        if ($changed && !$product->save()) throw new RuntimeException('Не удалось сохранить ограничение покупок и категории товара.');
        return ais_pg_configure_product($id, $data);
    }
    $name = sanitize_text_field($data['productName'] ?? '');
    if (!$name || mb_strlen($name) > 128 || !isset($data['price']) || !is_numeric($data['price']) || $data['price'] < 0 || $data['price'] > 10000000) throw new RuntimeException('Проверьте название товара (до 128 символов) и цену.');
    $type = ais_pg_program_type($data);
    $webinar = $type === 'ПРО';
    ais_pg_redirect_manager();
    $url = $webinar ? ais_pg_join_url($data['joinUrl'] ?? '') : 'https://zifra-plus.ru/edu_info';
    $file = ais_pg_connection_file($data['key'], $name, $url, $type, $data['slug']);
    // Approve only the download's own directory; retain WooCommerce validation.
    $registry_class = 'Automattic\\WooCommerce\\Internal\\ProductDownloads\\ApprovedDirectories\\Register';
    if (class_exists($registry_class)) wc_get_container()->get($registry_class)->add_approved_directory(dirname($file) . '/', true);
    $product = $id ? wc_get_product($id) : new WC_Product_Simple();
    if (!$product || !$product->is_type('simple')) throw new RuntimeException('Неверный тип ранее созданного товара.');
    $product->set_name($name);
    $product->set_slug($data['slug']);
    $product->set_status('draft');
    $product->set_virtual(true);
    $product->set_downloadable(true);
    $product->set_sold_individually(true);
    if ($category_ids !== null) {
        $product->set_category_ids($category_ids);
        $product->update_meta_data('_ais_generator_product_template', (int) $data['productTemplateId']);
    }
    $product->set_catalog_visibility('hidden');
    $price = (string) $data['price'];
    $old = (float) ($data['oldPrice'] ?? 0);
    $product->set_regular_price($old > (float) $price ? (string) $old : $price);
    $product->set_sale_price($old > (float) $price ? $price : '');
    $product->set_price($price);
    $product->set_description(wp_kses_post($data['descriptionHtml'] ?? ''));
    $downloads = array();
    {
        $download = new WC_Product_Download();
        $download->set_id(substr($data['key'], 0, 32));
        $download->set_name(($webinar ? 'Подключение к вебинару — ' : 'Информация об обучении — ') . $name);
        $download->set_file($file);
        if (method_exists($download, 'check_is_valid')) {
            try { $download->check_is_valid(false); }
            catch (Throwable $error) {
                ais_pg_log_failure($error, 'validate-webinar-download');
                throw new RuntimeException('WooCommerce отклонил файл подключения. Проверьте доступ к папке скачиваемых файлов и разрешение формата HTML/TXT в магазине.');
            }
        }
        $downloads[] = $download;
    }
    $product->set_downloads($downloads);
    $product->update_meta_data('_ais_generator_key', $data['key']);
    $product->update_meta_data('_ais_webinar_join_url', $webinar ? $url : '');
    $product->update_meta_data('_ais_webinar_file', $webinar ? $file : '');
    $product->update_meta_data('_ais_download_file', $file);
    $product->update_meta_data('_ais_program_type', $type);
    $product->update_meta_data('_ais_landing_url', ais_pg_landing_url($type, $landing_slug));
    $product->update_meta_data('_ais_generator_hash', $data['hash']);
    $id = $product->save();
    if (!$id) throw new RuntimeException('Не удалось сохранить товар.');
    $description = wp_kses_post($data['descriptionHtml'] ?? '');
    $linked_description = ais_pg_registration_links($description, $id);
    if ($linked_description !== $description) {
        $saved = wp_update_post(wp_slash(array('ID' => $id, 'post_content' => $linked_description)), true);
        if (is_wp_error($saved)) throw new RuntimeException('Не удалось обновить кнопки регистрации товара.');
    }
    return ais_pg_configure_product($id, $data);
}

function ais_pg_redirect_manager() {
    if (!is_callable(array('WF301_functions', 'get_redirects')) || !is_callable(array('WF301_functions', 'save_redirect_rule'))) {
        throw new RuntimeException('Для автоматических переходов нужен активный плагин 301 Redirects PRO.');
    }
}
function ais_pg_download_target($id) {
    $type = ais_pg_program_type(array('type' => get_post_meta($id, '_ais_program_type', true) ?: 'ПРО'));
    return $type === 'ПРО' ? ais_pg_join_url(get_post_meta($id, '_ais_webinar_join_url', true)) : 'https://zifra-plus.ru/edu_info';
}
function ais_pg_product_redirect_rules($id, $enabled, $overrides = array()) {
    $url = $overrides['landingUrl'] ?? get_post_meta($id, '_ais_landing_url', true);
    if (!preg_match('~^https://edu-plus\.ru/(?:other_course|courses-pk|courses-pp)/[a-z0-9][a-z0-9_-]{1,79}/$~D', $url)) throw new RuntimeException('Не указан корректный адрес лендинга товара.');
    $slug = $overrides['slug'] ?? get_post_field('post_name', $id);
    if (!preg_match('/^[a-z0-9][a-z0-9_-]{1,79}$/D', $slug)) throw new RuntimeException('Не указан код товара.');
    // PRO's wildcard converter rewrites every *, so regex repetitions use {0,}.
    // ID boundaries prevent 5112 matching 51120. Exact/drop never leaks order keys,
    // email addresses or query parameters into the destination meeting URL.
    $params = '(?:[^&]+&){0,}';
    $skip = '(?!' . $params . '(?:add-to-cart|preview|download_file)=)';
    $specs = array(
        array('query', '^/[?]' . $skip . '(?=' . $params . 'post_type=product(?:&|$))(?=' . $params . 'p=' . (int) $id . '(?:&|$)).{0,}', $url, 301),
        array('product', '^/product/' . preg_quote($slug, '~') . '/?(?:[?]' . $skip . '.{0,})?', $url, 301),
        array('download', '^/[?](?=' . $params . 'download_file=' . (int) $id . '(?:&|$)).{0,}', $overrides['downloadUrl'] ?? ais_pg_download_target($id), 302)
    );
    return array_map(function ($spec) use ($id, $enabled) {
        return array('url_from' => $spec[1], 'url_to' => $spec[2], 'type' => $spec[3],
            'query_parameters' => 'exactdrop', 'case_insensitive' => 'disabled', 'regex' => 'enabled',
            'status' => $enabled ? 'enabled' : 'disabled', 'position' => 5, 'tags' => 'AIS program ' . (int) $id . ' ' . $spec[0]);
    }, $specs);
}
function ais_pg_save_product_redirects($id, $enabled, $overrides = array(), $check_only = false) {
    ais_pg_redirect_manager();
    $rules = ais_pg_product_redirect_rules($id, $enabled, $overrides);
    $existing = WF301_functions::get_redirects(false);
    $updates = array();
    // Preflight all rows. Never overwrite unrelated rules or ambiguous duplicates.
    foreach ($rules as $rule) {
        $matches = array_values(array_filter($existing, function ($row) use ($rule) { return $row->tags === $rule['tags']; }));
        if (count($matches) > 1) throw new RuntimeException('Найдено несколько правил АИС для товара. Проверьте 301 Redirects PRO.');
        foreach ($existing as $row) {
            if (in_array($rule['url_from'], array((string) $row->url_from, stripslashes($row->url_from)), true) && $row->tags !== $rule['tags']) throw new RuntimeException('Такой переход уже настроен вручную. Проверьте 301 Redirects PRO; существующее правило не изменено.');
        }
        if ($matches) $rule['redirect_id'] = (int) $matches[0]->id;
        $updates[] = $rule;
    }
    if ($check_only) return $updates;
    $ids = array();
    foreach ($updates as $rule) {
        $rule_id = (int) WF301_functions::save_redirect_rule($rule);
        $saved = $rule_id ? WF301_functions::get_redirect($rule_id) : array();
        foreach ($rule as $key => $value) {
            if ($key !== 'redirect_id' && (string) ($saved[$key] ?? '') !== (string) $value) throw new RuntimeException('Плагин не подтвердил сохранение переходов. Повторите подготовку.');
        }
        if (!$rule_id) throw new RuntimeException('Не удалось сохранить переходы в 301 Redirects PRO.');
        $ids[] = $rule_id;
    }
    update_post_meta($id, '_ais_redirect_rule_ids', $ids);
    return $ids;
}
function ais_pg_image_url_valid($url) {
    return is_string($url) && strlen($url) <= 2000 && preg_match('~^https://edu-plus\.ru/wp-content/uploads/[^?#\r\n]+\.(?:jpe?g|png|webp)$~iD', $url);
}
function ais_pg_image_source($id) {
    if (ais_pg_role() !== 'edu') throw new RuntimeException('Источник изображения доступен только на edu-plus.ru.');
    $post = ais_pg_template($id);
    $image_id = (int) get_post_thumbnail_id($id);
    $url = $image_id ? wp_get_attachment_image_url($image_id, 'full') : '';
    if (!$image_id || !ais_pg_image_url_valid($url) || get_post_type($image_id) !== 'attachment' || !is_file(get_attached_file($image_id))) {
        throw new RuntimeException('У выбранного лендинга нет доступного изображения записи JPG, PNG или WebP.');
    }
    return array('id' => (int) $id, 'title' => $post->post_title, 'imageId' => $image_id, 'imageUrl' => $url,
        'version' => hash('sha256', wp_json_encode(array($image_id, $url, get_post_field('post_modified_gmt', $image_id), $post->post_modified_gmt))));
}
function ais_pg_validate_image_source($source) {
    if (!is_array($source) || !is_int($source['id'] ?? null) || $source['id'] < 1) throw new RuntimeException('Выберите лендинг — источник изображения.');
    $actual = ais_pg_image_source($source['id']);
    foreach (array('imageId', 'imageUrl', 'version') as $key) {
        if (($source[$key] ?? null) !== $actual[$key]) throw new RuntimeException('Изображение источника изменилось. Обновите проверку или повторите подготовку.');
    }
    return $actual;
}
function ais_pg_product_image($url) {
    // Only copy raster images from the education site's media library. No remote
    // redirects, arbitrary hosts, credentials, SVG/PHP, or unbounded responses.
    if (!ais_pg_image_url_valid($url)) throw new RuntimeException('Изображение должно находиться в медиатеке лендинга edu-plus.ru.');
    $source_key = hash('sha256', $url);
    $ids = get_posts(array('post_type' => 'attachment', 'post_status' => 'inherit', 'posts_per_page' => 1, 'fields' => 'ids', 'meta_key' => '_ais_product_image_source', 'meta_value' => $source_key));
    $id = $ids ? (int) $ids[0] : 0;
    require_once ABSPATH . 'wp-admin/includes/image.php';
    if (!$id || !is_file(get_attached_file($id))) {
        $response = wp_safe_remote_get($url, array('timeout' => 25, 'redirection' => 0, 'limit_response_size' => 5242881));
        if (is_wp_error($response) || wp_remote_retrieve_response_code($response) !== 200) throw new RuntimeException('Не удалось загрузить изображение лендинга. Повторите подготовку.');
        $bytes = wp_remote_retrieve_body($response);
        $info = @getimagesizefromstring($bytes);
        $formats = array(IMAGETYPE_JPEG => 'jpg', IMAGETYPE_PNG => 'png', IMAGETYPE_WEBP => 'webp');
        if (!$info || !isset($formats[$info[2]]) || strlen($bytes) > 5242880 || $info[0] * $info[1] > 20000000) throw new RuntimeException('Некорректное изображение лендинга: разрешены JPG, PNG и WebP до 5 МБ и 20 мегапикселей.');
        $uploaded = wp_upload_bits('landing-' . substr($source_key, 0, 24) . '.' . $formats[$info[2]], null, $bytes);
        if (!empty($uploaded['error'])) throw new RuntimeException('Не удалось сохранить изображение в медиатеке магазина.');
        $id = wp_insert_attachment(array('post_title' => 'Изображение лендинга программы', 'post_mime_type' => $info['mime'], 'post_status' => 'inherit',
            'meta_input' => array('_ais_product_image_source' => $source_key)), $uploaded['file'], 0, true);
        if (is_wp_error($id)) { wp_delete_file($uploaded['file']); throw new RuntimeException('Не удалось зарегистрировать изображение товара.'); }
    }
    if (!wp_get_attachment_metadata($id)) wp_update_attachment_metadata($id, wp_generate_attachment_metadata($id, get_attached_file($id)));
    return $id;
}
function ais_pg_configure_product($id, $data) {
    if (ais_pg_role() !== 'shop' || !get_post_meta($id, '_ais_generator_key', true)) throw new RuntimeException('Настройка доступна только для товара генератора.');
    if ((get_post_meta($id, '_ais_program_type', true) ?: 'ПРО') === 'ПРО') {
        $key = get_post_meta($id, '_ais_generator_key', true);
        $name = $data['productName'] ?? get_post_field('post_title', $id);
        $file = ais_pg_public_webinar_file($key, get_post_field('post_name', $id), $name, get_post_meta($id, '_ais_webinar_join_url', true));
        $previous = get_post_meta($id, '_ais_download_file', true) ?: get_post_meta($id, '_ais_webinar_file', true);
        // Re-preparing an older ready draft upgrades its private TXT in place.
        // Keep the download ID (existing permissions) and unrelated attachments.
        if ($previous !== $file) {
            $product = wc_get_product($id);
            if (!$product || !$product->is_type('simple')) throw new RuntimeException('Не найден товар для обновления файла подключения.');
            $downloads = $product->get_downloads('edit');
            $download_id = substr($key, 0, 32);
            foreach ($downloads as $index => $existing) {
                if ($existing->get_id() === $download_id || $existing->get_file() === $previous) {
                    $download_id = $existing->get_id(); unset($downloads[$index]); break;
                }
            }
            $download = new WC_Product_Download();
            $download->set_id($download_id);
            $download->set_name('Подключение к вебинару — ' . $name);
            $download->set_file($file);
            $registry_class = 'Automattic\\WooCommerce\\Internal\\ProductDownloads\\ApprovedDirectories\\Register';
            if (class_exists($registry_class)) wc_get_container()->get($registry_class)->add_approved_directory(dirname($file) . '/', true);
            if (method_exists($download, 'check_is_valid')) $download->check_is_valid(false);
            $downloads[$download_id] = $download;
            $product->set_downloads($downloads);
            $product->update_meta_data('_ais_webinar_file', $file);
            $product->update_meta_data('_ais_download_file', $file);
            if (!$product->save()) throw new RuntimeException('Не удалось обновить скачиваемый файл товара.');
        }
    }
    $enabled = get_post_status($id) === 'publish' && get_post_meta($id, '_ais_landing_redirect', true) === '1';
    $rule_ids = ais_pg_save_product_redirects($id, $enabled);
    if (!empty($data['imageUrl'])) {
        $image_id = ais_pg_product_image($data['imageUrl']);
        set_post_thumbnail($id, $image_id);
        if ((int) get_post_thumbnail_id($id) !== $image_id) throw new RuntimeException('Магазин не подтвердил изображение товара. Повторите подготовку.');
    }
    return array_merge(ais_pg_result($id), array('imageId' => (int) get_post_thumbnail_id($id), 'redirectRuleIds' => $rule_ids));
}
function ais_pg_mutate($action, $data) {
    ais_pg_identity($data);
    global $wpdb;
    $lock = 'ais_pg_' . substr(hash('sha256', $wpdb->prefix . $data['key']), 0, 48);
    if ((string) $wpdb->get_var($wpdb->prepare('SELECT GET_LOCK(%s, 0)', $lock)) !== '1') return ais_pg_error('Эта программа уже обрабатывается. Повторите через несколько секунд.', 409);
    try {
        if ($action === 'certificate-assets' && ais_pg_role() === 'edu') return ais_pg_certificate_assets($data);
        if ($action === 'prepare-product' && ais_pg_role() === 'shop') return ais_pg_prepare_product($data);
        if ($action === 'prepare-landing' && ais_pg_role() === 'edu') return ais_pg_prepare_landing($data);
        $id = ais_pg_find($data['key']);
        if (!$id || get_post_meta($id, '_ais_generator_hash', true) !== $data['hash']) throw new RuntimeException('Сначала подготовьте и проверьте черновики с текущими параметрами.');
        if ($action === 'configure-product' && ais_pg_role() === 'shop') return ais_pg_configure_product($id, $data);
        if (in_array($action, array('publish', 'validate-publication'), true) && ais_pg_role() === 'edu') {
            $type = get_post_meta($id, '_ais_program_type', true) ?: 'ПРО';
            $fields = array();
            foreach (ais_pg_certificate_slots($type) as $slot => $_language) $fields[$slot] = get_field($slot, $id, false);
            $fields['slajder'] = get_field('slajder', $id, false);
            if (function_exists('get_field_object')) {
                $slider_field = get_field_object('slajder', $id, false);
                if ($slider_field) $fields['slajder'] = ais_pg_acf_value($slider_field, $slider_field['value']);
            }
            $validation = array('key' => $data['key'], 'type' => $type, 'certificateHash' => get_post_meta($id, '_ais_certificate_hash', true), 'fields' => $fields);
            $pages = get_post_meta($id, '_ais_certificate_pages', true);
            if ($pages) $validation['certificatePages'] = $pages;
            ais_pg_validate_certificates($validation);
            if ($action === 'validate-publication') return array('ok' => true);
        }
        if ($action === 'publish') {
            ais_pg_slug(get_post_field('post_name', $id), get_post_type($id), $id);
            $result = wp_update_post(array('ID' => $id, 'post_status' => 'publish'), true);
            if (is_wp_error($result) || get_post_status($id) !== 'publish') throw new RuntimeException('Публикация не подтверждена. Повторите попытку.');
            return ais_pg_result($id);
        }
        if ($action === 'enable-redirect' && ais_pg_role() === 'shop' && get_post_status($id) === 'publish') {
            ais_pg_save_product_redirects($id, true);
            update_post_meta($id, '_ais_landing_redirect', '1');
            return ais_pg_result($id);
        }
        throw new RuntimeException('Недопустимая операция.');
    } finally {
        $wpdb->get_var($wpdb->prepare('SELECT RELEASE_LOCK(%s)', $lock));
    }
}
function ais_pg_variant_price_note() {
    return "Скидка до [skidki-pp-pk]\nРассрочка без переплат";
}
function ais_pg_offer_product_id($value) {
    if (!is_string($value)) return 0;
    $url = wp_parse_url(html_entity_decode($value, ENT_QUOTES, 'UTF-8'));
    if (!$url || !in_array($url['scheme'] ?? '', array('https', 'http'), true) || strtolower($url['host'] ?? '') !== 'zifra-plus.ru'
        || isset($url['user']) || isset($url['pass']) || isset($url['port'])) return 0;
    parse_str($url['query'] ?? '', $query);
    $id = $query['add-to-cart'] ?? '';
    return is_scalar($id) && preg_match('/^[1-9]\d*$/D', (string) $id) ? (int) $id : 0;
}
function ais_pg_hidden_offers($id) {
    $hidden = get_post_meta($id, '_ais_hidden_landing_offers', true) ?: array();
    if (!is_array($hidden)) throw new RuntimeException('Повреждены настройки видимости вариантов.');
    return array_values(array_unique(array_filter(array_map('intval', $hidden), function ($id) { return $id > 0; })));
}
function ais_pg_sync_landing($id) {
    $post = get_post($id);
    if (!$post || !in_array($post->post_type, array('other-course', 'courses-pk', 'courses-pp'), true)
        || !in_array($post->post_status, array('draft', 'publish'), true)) throw new RuntimeException('Лендинг не найден или недоступен. Проверьте код в карточке.');
    if (!function_exists('get_field_objects')) throw new RuntimeException('На сайте недоступен ACF.');
    $fields = array();
    foreach (get_field_objects($id, false) ?: array() as $field) $fields[$field['name']] = ais_pg_acf_value($field, $field['value']);
    $offers = array(); $hidden = ais_pg_hidden_offers($id);
    foreach ($fields['blok_ceny'] ?? array() as $index => $row) {
        $product_id = ais_pg_offer_product_id($row['ssylka_na_registraciyu'] ?? '');
        if (!$product_id) continue;
        $offers[] = array('index' => $index, 'productId' => $product_id, 'hours' => $row['kolichestvo_chasov'] ?? '', 'price' => $row['stoimost_kursa'] ?? '', 'hidden' => in_array($product_id, $hidden, true));
    }
    $variants = get_post_meta($id, '_ais_program_variants', true) ?: array();
    if (!is_array($variants)) throw new RuntimeException('Повреждены привязки вариантов лендинга.');
    $version = hash('sha256', wp_json_encode(array($post->post_title, $post->post_name, $post->post_modified_gmt, $post->post_status, $post->post_content, $post->post_excerpt ?? '', $fields, get_post_thumbnail_id($id), $variants, $hidden)));
    $image = function_exists('wp_get_attachment_image_url') ? wp_get_attachment_image_url(get_post_thumbnail_id($id), 'medium_large') : '';
    return array_merge(ais_pg_result($id), array('title' => $post->post_title, 'previewImageUrl' => $image ?: '', 'fields' => $fields, 'offers' => $offers, 'variants' => $variants, 'version' => $version, 'variantVisibility' => true));
}

function ais_pg_set_variant_visibility($data) {
    if (ais_pg_role() !== 'edu') throw new RuntimeException('Видимость меняется только на сайте программ.');
    if (!is_int($data['landingId'] ?? null) || $data['landingId'] < 1 || !is_int($data['productId'] ?? null) || $data['productId'] < 1
        || !is_bool($data['hidden'] ?? null)) throw new RuntimeException('Проверьте вариант и его видимость.');
    global $wpdb;
    $id = $data['landingId'];
    $lock = 'ais_pg_sync_' . substr(hash('sha256', $wpdb->prefix . ':' . $id), 0, 45);
    if ((string) $wpdb->get_var($wpdb->prepare('SELECT GET_LOCK(%s, 0)', $lock)) !== '1') throw new RuntimeException('Лендинг уже обновляется. Повторите через несколько секунд.');
    try {
        $snapshot = ais_pg_sync_landing($id);
        if (!is_string($data['version'] ?? null) || !hash_equals($snapshot['version'], $data['version'])) throw new RuntimeException('Лендинг изменился. Обновите список вариантов.');
        if (!in_array($data['productId'], array_column($snapshot['offers'], 'productId'), true)) throw new RuntimeException('Товар не связан с этим лендингом.');
        $before = ais_pg_hidden_offers($id);
        $hidden = array_values(array_diff($before, array($data['productId'])));
        if ($data['hidden']) $hidden[] = $data['productId'];
        sort($hidden, SORT_NUMERIC);
        if ($hidden !== $before) {
            update_post_meta($id, '_ais_hidden_landing_offers', $hidden);
            if (ais_pg_hidden_offers($id) !== $hidden) {
                update_post_meta($id, '_ais_hidden_landing_offers', $before);
                throw new RuntimeException('Сайт не подтвердил видимость варианта. Повторите проверку.');
            }
            if (function_exists('acf_flush_value_cache')) acf_flush_value_cache($id);
            if (function_exists('clean_post_cache')) clean_post_cache($id);
            // Invalidate common page caches without changing any product or ACF row.
            if (function_exists('wp_cache_post_change')) wp_cache_post_change($id);
            if (function_exists('rocket_clean_post')) rocket_clean_post($id);
            do_action('litespeed_purge_post', $id);
        }
        return array('ok' => true, 'landingId' => $id, 'productId' => $data['productId'], 'hidden' => $data['hidden'], 'version' => ais_pg_sync_landing($id)['version']);
    } finally { $wpdb->get_var($wpdb->prepare('SELECT RELEASE_LOCK(%s)', $lock)); }
}

function ais_pg_variant_plan($data) {
    if (ais_pg_role() !== 'edu') throw new RuntimeException('Вариант добавляется только на сайт программ.');
    ais_pg_identity($data);
    $model = $data['model'] ?? array();
    $type = ais_pg_program_type($model);
    $snapshot = ais_pg_sync_landing((int) ($data['landingId'] ?? 0));
    if ($snapshot['status'] !== 'publish' || $snapshot['postType'] !== ais_pg_post_type($type)) throw new RuntimeException('Нужен опубликованный лендинг соответствующего вида программы.');
    if (!is_string($data['version'] ?? null) || !hash_equals($snapshot['version'], $data['version'])) throw new RuntimeException('Лендинг изменился. Обновите проверку перед добавлением варианта.');
    if (!is_string($model['name'] ?? null) || !trim($model['name']) || mb_strlen($model['name']) > 500) throw new RuntimeException('Проверьте название варианта.');
    foreach (array('price', 'oldPrice', 'hours') as $field) {
        if (!isset($model[$field]) || !is_numeric($model[$field]) || $model[$field] < 0 || $model[$field] > ($field === 'hours' ? 10000 : 10000000)) throw new RuntimeException('Проверьте стоимость и часы варианта.');
    }
    if ($model['hours'] <= 0) throw new RuntimeException('Количество часов должно быть положительным.');
    ais_pg_certificate_key($data['key'], $data['certificateHash'] ?? '', 'ru');
    $own = $snapshot['variants'][$data['key']] ?? array();
    if ($own && $own['hash'] !== $data['hash']) throw new RuntimeException('Вариант уже добавлен с другими параметрами. Обновите карточку и используйте синхронизацию товара.');
    if (!$own && count($snapshot['offers']) >= 30) throw new RuntimeException('На одном лендинге допускается не более 30 вариантов.');
    $definitions = array();
    foreach (get_field_objects($snapshot['id'], false) ?: array() as $field) $definitions[$field['name']] = $field;
    foreach (array('blok_ceny', 'slajder') as $field) {
        if (($definitions[$field]['type'] ?? '') !== 'repeater' || !is_array($snapshot['fields'][$field] ?? null)) throw new RuntimeException('На лендинге нет таблицы цен или галереи документов. Проверьте ACF.');
    }
    $price_fields = array_column($definitions['blok_ceny']['sub_fields'] ?? array(), 'name');
    foreach (array('stoimost_kursa', 'kolichestvo_chasov', 'staraya_cena', 'skidka', 'ssylka_na_registraciyu', 'primechanie_ceny') as $field) {
        if (!in_array($field, $price_fields, true) || !array_key_exists($field, $snapshot['fields']['blok_ceny'][0] ?? array())) throw new RuntimeException('В ценовом блоке отсутствует поле ' . $field . '.');
    }
    $gallery_fields = array_filter($definitions['slajder']['sub_fields'] ?? array(), function ($field) { return $field['name'] === 'izobrazhenie_slajda' && $field['type'] === 'image'; });
    if (count($gallery_fields) !== 1) throw new RuntimeException('Не найдено поле изображений галереи.');
    $training = $model['trainingPlan'] ?? array();
    if (!is_array($training) || count($training) > 300) throw new RuntimeException('Проверьте учебный план варианта.');
    if ($training && (($definitions['programmy_obucheniya']['type'] ?? '') !== 'repeater' || !is_array($snapshot['fields']['programmy_obucheniya'] ?? null))) throw new RuntimeException('На лендинге нет блока учебных планов. Проверьте ACF.');
    if ($training) {
        $plan_fields = array_column($definitions['programmy_obucheniya']['sub_fields'] ?? array(), null, 'name');
        if (!isset($plan_fields['zagolovok_programmy_obucheniya']) || ($plan_fields['moduli_programmy']['type'] ?? '') !== 'repeater') throw new RuntimeException('Проверьте структуру учебных планов в ACF.');
        $module_fields = array_column($plan_fields['moduli_programmy']['sub_fields'] ?? array(), 'name');
        foreach (array('nazvanie_modulya','opisanie_modulya','chasy_vsego','chasy_1','chasy_2','kontrol') as $field) if (!in_array($field, $module_fields, true)) throw new RuntimeException('В учебном плане отсутствует поле ' . $field . '.');
    }
    if (isset($data['certificatePages'])) {
        foreach (ais_pg_certificate_pages($data['certificatePages'], $type) as $page) ais_pg_validate_certificate_asset($data, (int) ($page['id'] ?? 0), $page['language']);
    }
    if (!empty($data['productId'])) {
        if (!is_int($data['productId']) || $data['productId'] < 1) throw new RuntimeException('Некорректный код нового товара.');
        foreach ($snapshot['offers'] as $offer) {
            if ($offer['productId'] === $data['productId'] && (int) ($own['productId'] ?? 0) !== $data['productId']) throw new RuntimeException('Этот товар уже относится к другому варианту.');
        }
        if ($own && (int) $own['productId'] !== $data['productId']) throw new RuntimeException('Код ранее созданного товара изменился.');
    }
    return array($snapshot, $definitions, $own);
}

function ais_pg_variant($action, $data) {
    global $wpdb;
    $id = (int) ($data['landingId'] ?? 0);
    // Same post-ID lock as ordinary synchronization; different programs share this page.
    $lock = 'ais_pg_sync_' . substr(hash('sha256', $wpdb->prefix . ':' . $id), 0, 45);
    if ((string) $wpdb->get_var($wpdb->prepare('SELECT GET_LOCK(%s, 0)', $lock)) !== '1') throw new RuntimeException('Лендинг уже обновляется. Повторите через несколько секунд.');
    try {
        list($snapshot, $definitions, $own) = ais_pg_variant_plan($data);
        if ($action === 'check-variant') return array('ok' => true);
        if ($action === 'variant-assets') return ais_pg_upload_certificate_assets(array('type' => $data['model']['type'], 'key' => $data['key'], 'certificateHash' => $data['certificateHash'], 'images' => $data['images'] ?? null));
        if ($action !== 'attach-variant' || empty($data['productId']) || empty($data['certificatePages'])) throw new RuntimeException('Не подготовлены товар и все образцы документов.');
        if (!empty($own['complete'])) return ais_pg_result($id);
        $model = $data['model'];
        $price = (string) $model['price']; $old = (float) $model['oldPrice'];
        $rows = $snapshot['fields']['blok_ceny'];
        $row = array_merge($rows[0], array('stoimost_kursa' => $price, 'kolichestvo_chasov' => (string) $model['hours'],
            'staraya_cena' => $old > (float) $price ? (string) $old : '', 'skidka' => $old > (float) $price ? (string) round(100 * (1 - (float) $price / $old)) : '0',
            'ssylka_na_registraciyu' => 'https://zifra-plus.ru/checkout/?add-to-cart=' . $data['productId']));
        if (array_key_exists('primechanie_ceny', $row)) $row['primechanie_ceny'] = ais_pg_variant_price_note();
        $rows[] = $row;
        $patch = array('blok_ceny' => $rows, 'slajder' => array_merge($snapshot['fields']['slajder'], array_map(function ($page) { return array('izobrazhenie_slajda' => (int) $page['id']); }, $data['certificatePages'])));
        $plan_index = null;
        if (!empty($model['trainingPlan'])) {
            $plans = $snapshot['fields']['programmy_obucheniya'];
            $plan_index = count($plans);
            $plan = $plans[0] ?? array();
            $plan['zagolovok_programmy_obucheniya'] = sanitize_text_field($model['name']) . ' — ' . $model['hours'] . ' ч.';
            $plan['ssylka_na_programmu_kursa'] = ''; $plan['nazvanie_knopki_skachat'] = '';
            $plan['moduli_programmy'] = array_map(function ($row) {
                $value = array();
                foreach (array('discipline'=>'nazvanie_modulya', 'content'=>'opisanie_modulya', 'totalHours'=>'chasy_vsego', 'theoryHours'=>'chasy_1', 'practiceHours'=>'chasy_2', 'attestation'=>'kontrol') as $source=>$target) $value[$target] = wp_kses_post((string) ($row[$source] ?? ''));
                return $value;
            }, $model['trainingPlan']);
            $plans[] = $plan; $patch['programmy_obucheniya'] = $plans;
        }
        $variants = $snapshot['variants'];
        $variants[$data['key']] = array('hash'=>$data['hash'], 'productId'=>$data['productId'], 'certificateHash'=>$data['certificateHash'], 'certificatePages'=>$data['certificatePages'], 'planIndex'=>$plan_index, 'complete'=>true);
        try {
            foreach ($patch as $name=>$value) update_field($definitions[$name]['key'], ais_pg_acf_value($definitions[$name], $value, true), $id);
            if (function_exists('acf_flush_value_cache')) acf_flush_value_cache($id);
            $actual = ais_pg_sync_landing($id);
            foreach ($patch as $name=>$value) if (($actual['fields'][$name] ?? null) != $value) throw new RuntimeException('Сайт не подтвердил поле ' . $name . '.');
            update_post_meta($id, '_ais_program_variants', $variants);
            if (get_post_meta($id, '_ais_program_variants', true) != $variants) throw new RuntimeException('Не сохранена привязка нового варианта.');
        } catch (Throwable $error) {
            // Restore only these fields while holding the page lock, so retries cannot duplicate rows.
            foreach ($patch as $name=>$_value) update_field($definitions[$name]['key'], ais_pg_acf_value($definitions[$name], $snapshot['fields'][$name], true), $id);
            update_post_meta($id, '_ais_program_variants', $snapshot['variants']);
            if (function_exists('acf_flush_value_cache')) acf_flush_value_cache($id);
            throw $error;
        }
        return ais_pg_result($id);
    } finally { $wpdb->get_var($wpdb->prepare('SELECT RELEASE_LOCK(%s)', $lock)); }
}
function ais_pg_webinar_file_locations($id, $extra_slug = '') {
    $key = get_post_meta($id, '_ais_generator_key', true) ?: get_post_meta($id, '_ais_webinar_file_key', true);
    if (!$key) $key = hash('sha256', 'ais-shop-product:' . (int) $id);
    if (!preg_match('/^[a-f0-9]{64}$/D', $key)) throw new RuntimeException('Некорректный владелец файлов подключения.');
    $uploads = wp_upload_dir(null, false);
    if (!empty($uploads['error']) || !preg_match('~^https?://zifra-plus\.ru/wp-content/uploads/?$~D', $uploads['baseurl'] ?? '')) throw new RuntimeException('Не удалось определить папку файлов вебинаров.');
    $dir = rtrim($uploads['basedir'], '/\\') . '/dae-uploads/webinars';
    $slugs = get_post_meta($id, '_ais_webinar_slug_aliases', true) ?: array();
    if (!is_array($slugs) || count($slugs) > 50) throw new RuntimeException('Проверьте список прежних файлов вебинара.');
    foreach (array(get_post_field('post_name', $id), $extra_slug) as $slug) if ($slug) $slugs[] = $slug;
    $known = array_filter(array(get_post_meta($id, '_ais_download_file', true), get_post_meta($id, '_ais_webinar_file', true)));
    $product = wc_get_product($id);
    $selected = array();
    foreach ($product ? $product->get_downloads('edit') : array() as $index => $download) {
        if (!is_object($download)) continue;
        $file = $download->get_file();
        $own = $download->get_id() === substr($key, 0, 32) || in_array($file, $known, true);
        if (preg_match('~^https://zifra-plus\.ru/wp-content/uploads/dae-uploads/webinars/([a-z0-9][a-z0-9_-]{1,79})\.html$~D', $file, $match)) {
            $path = $dir . '/' . $match[1] . '.html';
            if (is_file($path) && !is_link($path) && filesize($path) <= 65536
                && strpos((string) file_get_contents($path), '<!-- AIS webinar ' . $key . ' -->') !== false) $own = true;
            if ($own) $slugs[] = $match[1];
        }
        if ($own) $selected[] = $index;
    }
    foreach ($known as $file) if (preg_match('~^https://zifra-plus\.ru/wp-content/uploads/dae-uploads/webinars/([a-z0-9][a-z0-9_-]{1,79})\.html$~D', $file, $match)) $slugs[] = $match[1];
    $slugs = array_values(array_unique($slugs));
    if (count($slugs) > 50) throw new RuntimeException('Слишком много прежних файлов вебинара.');
    foreach ($slugs as $slug) if (!is_string($slug) || !preg_match('/^[a-z0-9][a-z0-9_-]{1,79}$/D', $slug)) throw new RuntimeException('Некорректное имя файла вебинара.');
    $private_dir = dirname(rtrim(ABSPATH, '/\\')) . '/ais-webinar-files/' . $key;
    $private = array();
    foreach (array('txt', 'html') as $extension) {
        $file = $private_dir . '/connection.' . $extension;
        if (file_exists($file) || is_link($file)) $private[] = $file;
    }
    return array('key' => $key, 'dir' => $dir, 'slugs' => $slugs, 'private' => $private, 'downloadIndexes' => $selected);
}
function ais_pg_webinar_files_version($id) {
    $state = array();
    foreach (array('_ais_webinar_join_url', '_ais_webinar_file', '_ais_download_file', '_ais_webinar_file_key', '_ais_webinar_slug_aliases', '_ais_landing_url', '_ais_landing_redirect', '_ais_redirect_rule_ids') as $key) $state[$key] = get_post_meta($id, $key, true);
    if ($state['_ais_webinar_file'] || $state['_ais_webinar_file_key']) {
        $locations = ais_pg_webinar_file_locations($id);
        $files = array_merge($locations['private'], array_map(function ($slug) use ($locations) { return $locations['dir'] . '/' . $slug . '.html'; }, $locations['slugs']));
        foreach ($files as $file) $state['files'][$file] = is_file($file) && !is_link($file) && filesize($file) <= 65536 ? hash_file('sha256', $file) : 'missing-or-invalid';
    }
    return $state;
}
function ais_pg_sync_links_plan($data, $snapshot) {
    $model = $data['model'];
    if (empty($model['slug']) && empty($model['joinUrl'])) return null;
    if (!empty($model['joinUrl']) && ($model['type'] !== 'ПРО' || !is_string($model['joinUrl']))) throw new RuntimeException('Ссылка SberJazz предназначена только для ПРО.');
    $shop = ais_pg_role() === 'shop';
    $id = (int) $data[$shop ? 'productId' : 'landingId'];
    $slug = $model['slug'] ?? $snapshot['slug'];
    ais_pg_slug($slug, $shop ? 'product' : get_post_type($id), $id);
    if (!$shop) return array('slug' => $slug);
    $url = $model['landingUrl'] ?? '';
    if (!is_string($url) || !preg_match('~^https://edu-plus\.ru/(?:other_course|courses-pk|courses-pp)/[a-z0-9][a-z0-9_-]{1,79}/$~D', $url)) throw new RuntimeException('Не подтверждён новый адрес лендинга.');
    $join = $model['type'] === 'ПРО' ? ais_pg_join_url($model['joinUrl'] ?? get_post_meta($id, '_ais_webinar_join_url', true)) : 'https://zifra-plus.ru/edu_info';
    $enabled = get_post_status($id) === 'publish' && ($data['landingStatus'] ?? '') === 'publish';
    $overrides = array('slug' => $slug, 'landingUrl' => $url, 'downloadUrl' => $join);
    ais_pg_save_product_redirects($id, $enabled, $overrides, true);
    $files = null;
    if ($model['type'] === 'ПРО') {
        $files = ais_pg_webinar_file_locations($id, $slug);
        foreach (array_merge(array($files['dir']), array_map('dirname', $files['private'])) as $dir) {
            if (is_link($dir) || is_link(dirname($dir))) throw new RuntimeException('Папка файла подключения является символической ссылкой. Файлы не изменены.');
        }
        foreach ($files['slugs'] as $alias) {
            $file = $files['dir'] . '/' . $alias . '.html';
            if (is_link($file) || (file_exists($file) && (!is_file($file) || filesize($file) > 65536
                || strpos((string) file_get_contents($file), '<!-- AIS webinar ' . $files['key'] . ' -->') === false))) throw new RuntimeException('Файл подключения с таким именем создан не этой программой. Он не изменён; проверьте код лендинга.');
        }
        foreach ($files['private'] as $file) if (is_link($file) || !is_file($file) || filesize($file) > 65536) throw new RuntimeException('Прежний файл подключения недоступен для безопасного обновления.');
    }
    return array('slug' => $slug, 'landingUrl' => $url, 'joinUrl' => $join, 'enabled' => $enabled, 'overrides' => $overrides, 'files' => $files);
}
function ais_pg_sync_webinar_files($product, $plan, $name) {
    $files = $plan['files'];
    if (!$files) return;
    foreach ($files['slugs'] as $slug) ais_pg_public_webinar_file($files['key'], $slug, $name, $plan['joinUrl']);
    $url = 'https://zifra-plus.ru/wp-content/uploads/dae-uploads/webinars/' . $plan['slug'] . '.html';
    // Old private HTML/TXT copies remain usable for already issued links.
    foreach ($files['private'] as $file) {
        $content = substr($file, -5) === '.html' ? file_get_contents($files['dir'] . '/' . $plan['slug'] . '.html') : $name . "\r\n\r\nПодключение к вебинару:\r\n" . $plan['joinUrl'] . "\r\n";
        $temp = tempnam(dirname($file), '.ais-sync-');
        try {
            if (!$temp || file_put_contents($temp, $content, LOCK_EX) !== strlen($content) || !chmod($temp, 0600) || !rename($temp, $file)) throw new RuntimeException('Не удалось обновить прежний файл подключения. Повторите синхронизацию.');
            $temp = false;
        } finally { if ($temp && is_file($temp)) unlink($temp); }
    }
    $downloads = $product->get_downloads('edit');
    $indexes = $files['downloadIndexes'];
    if (!$indexes) {
        $index = substr($files['key'], 0, 32);
        $download = new WC_Product_Download(); $download->set_id($index);
        $downloads[$index] = $download; $indexes[] = $index;
    }
    $registry_class = 'Automattic\\WooCommerce\\Internal\\ProductDownloads\\ApprovedDirectories\\Register';
    if (class_exists($registry_class)) wc_get_container()->get($registry_class)->add_approved_directory(dirname($url) . '/', true);
    foreach ($indexes as $index) {
        $download = clone $downloads[$index];
        $download->set_name('Подключение к вебинару — ' . $name); $download->set_file($url);
        if (method_exists($download, 'check_is_valid')) $download->check_is_valid(false);
        $downloads[$index] = $download;
    }
    $product->set_downloads($downloads); $product->set_downloadable(true);
    $product->update_meta_data('_ais_webinar_file_key', $files['key']);
    $product->update_meta_data('_ais_webinar_slug_aliases', $files['slugs']);
    $product->update_meta_data('_ais_webinar_join_url', $plan['joinUrl']);
    $product->update_meta_data('_ais_download_file', $url); $product->update_meta_data('_ais_webinar_file', $url);
}
function ais_pg_sync_product($id) {
    if (!function_exists('wc_get_product')) throw new RuntimeException('WooCommerce недоступен.');
    $product = wc_get_product($id);
    if (!$product || !$product->is_type('simple') || !in_array($product->get_status(), array('draft', 'publish'), true)) throw new RuntimeException('Товар не найден, недоступен или не является простым товаром.');
    $values = array('title' => $product->get_name(), 'price' => $product->get_price(), 'regularPrice' => $product->get_regular_price(),
        'salePrice' => $product->get_sale_price(), 'descriptionHtml' => $product->get_description(), 'shortDescriptionHtml' => $product->get_short_description(),
        'saleFrom' => (string) $product->get_date_on_sale_from(), 'saleTo' => (string) $product->get_date_on_sale_to(), 'imageId' => (int) get_post_thumbnail_id($id));
    $downloads = array();
    foreach ($product->get_downloads('edit') as $download) $downloads[] = is_object($download) ? array($download->get_id(), $download->get_name(), $download->get_file()) : $download;
    return array_merge(ais_pg_result($id), $values, array('version' => hash('sha256', wp_json_encode(array($values, $product->get_status(), $product->get_slug('edit'), (string) $product->get_date_modified(), $downloads, ais_pg_webinar_files_version($id))))));
}
function ais_pg_resolve_site($data) {
    if (ais_pg_role() !== 'edu') throw new RuntimeException('Поиск лендинга доступен только на edu-plus.ru.');
    $id = (int) ($data['landingId'] ?? 0);
    if (!$id) {
        $slug = $data['slug'] ?? '';
        if (!is_string($slug) || !preg_match('/^[a-z0-9][a-z0-9_-]{1,79}$/D', $slug)) throw new RuntimeException('Не указан код лендинга.');
        $ids = get_posts(array('post_type' => array('other-course', 'courses-pk', 'courses-pp'), 'post_status' => array('draft', 'publish'),
            'name' => $slug, 'posts_per_page' => 2, 'fields' => 'ids'));
        if (!$ids && ($data['allowMissing'] ?? false) === true) return array('found' => false);
        if (count($ids) !== 1) throw new RuntimeException('Лендинг по коду не найден однозначно. Укажите его числовой ID в карточке программы.');
        $id = (int) $ids[0];
    }
    if (($data['allowMissing'] ?? false) === true) {
        $post = get_post($id);
        if (!$post || !in_array($post->post_type, array('other-course', 'courses-pk', 'courses-pp'), true)
            || !in_array($post->post_status, array('draft', 'publish'), true)) return array('found' => false);
    }
    return ais_pg_sync_landing($id);
}
function ais_pg_sync_validate($data) {
    $model = $data['model'] ?? array();
    ais_pg_program_type($model);
    if (!is_string($model['name'] ?? null) || trim($model['name']) === '' || mb_strlen($model['name']) > 500
        || !is_string($model['productName'] ?? null) || trim($model['productName']) === '' || mb_strlen($model['productName']) > 500) throw new RuntimeException('Проверьте название программы и товара.');
    foreach (array('price', 'oldPrice', 'hours') as $key) {
        if (!isset($model[$key]) || !is_numeric($model[$key]) || $model[$key] < 0 || $model[$key] > ($key === 'hours' ? 10000 : 10000000)) throw new RuntimeException('Проверьте стоимость и часы программы.');
    }
    if ($model['hours'] <= 0) throw new RuntimeException('Количество часов должно быть положительным.');
    if ($model['type'] === 'ПРО' && (!empty($model['date']) || !empty($model['time']))) {
        if (!is_string($model['date'] ?? null) || !is_string($model['time'] ?? null)
            || !preg_match('/^(20\d{2})-(\d{2})-(\d{2})$/D', $model['date'], $date)
            || !checkdate((int) $date[2], (int) $date[3], (int) $date[1])
            || !preg_match('/^([01]\d|2[0-3]):[0-5]\d$/D', $model['time'])) throw new RuntimeException('Проверьте дату и время вебинара.');
    }
    $id = (int) ($data[ais_pg_role() === 'edu' ? 'landingId' : 'productId'] ?? 0);
    $snapshot = ais_pg_role() === 'edu' ? ais_pg_sync_landing($id) : ais_pg_sync_product($id);
    if (!is_string($data['version'] ?? null) || !hash_equals($snapshot['version'], $data['version'])) throw new RuntimeException('Данные на сайте изменились. Обновите проверку перед синхронизацией.');
    if (ais_pg_role() === 'edu') {
        if (isset($model['imageSource'])) ais_pg_validate_image_source($model['imageSource']);
        $matching = array_filter($snapshot['offers'], function ($offer) use ($data) { return $offer['productId'] === (int) ($data['productId'] ?? 0); });
        if (count($matching) !== 1) throw new RuntimeException('Нужен один ценовой блок выбранного товара. Проверьте ссылки регистрации на лендинге.');
        foreach ($snapshot['variants'] as $key => $variant) {
            if ((int) $variant['productId'] === (int) $data['productId']) $snapshot['_variant'] = array_merge($variant, array('key' => $key));
        }
        if (isset($snapshot['_variant']) && !empty($model['slug'])) throw new RuntimeException('Вариант использует общий лендинг. Его адрес меняется в основной программе.');
        // Refuse malformed/missing price blocks before the shop is changed.
        $row = $snapshot['fields']['blok_ceny'][array_values($matching)[0]['index']];
        foreach (array('stoimost_kursa', 'kolichestvo_chasov', 'staraya_cena', 'skidka') as $key) {
            if (!array_key_exists($key, $row)) throw new RuntimeException('В ценовом блоке отсутствует поле ' . $key . '. Проверьте ACF.');
        }
        if (($model['updateSamples'] ?? false) === true) $snapshot['_sampleFields'] = ais_pg_sync_sample_fields($data, $snapshot);
    }
    if (isset($model['imageSource']) && !ais_pg_image_url_valid($model['imageSource']['imageUrl'] ?? null)) throw new RuntimeException('Проверьте изображение записи.');
    $snapshot['_linksPlan'] = ais_pg_sync_links_plan($data, $snapshot);
    return $snapshot;
}
function ais_pg_sync_certificate_owner($id, $product_id = 0) {
    foreach (get_post_meta($id, '_ais_program_variants', true) ?: array() as $key => $variant) {
        if ((int) $variant['productId'] === (int) $product_id) return $key;
    }
    $key = get_post_meta($id, '_ais_generator_key', true);
    return is_string($key) && preg_match('/^[a-f0-9]{64}$/D', $key) ? $key : 'sync-landing-' . (int) $id;
}
function ais_pg_sync_sample_fields($data, $snapshot) {
    $model = $data['model'];
    $slots = ais_pg_certificate_slots($model['type']);
    $definitions = array();
    foreach (get_field_objects((int) $snapshot['id'], false) ?: array() as $field) $definitions[$field['name']] = $field;
    foreach ($slots as $slot => $language) {
        if (!array_key_exists($slot, $snapshot['fields']) || ($definitions[$slot]['type'] ?? '') !== 'image') {
            throw new RuntimeException('На лендинге отсутствует поле изображения образца ' . $slot . '. Проверьте ACF.');
        }
    }
    $has_slider = array_key_exists('slajder', $snapshot['fields']);
    if (!$has_slider && in_array($model['type'], array('КПК', 'ППП'), true)) throw new RuntimeException('На лендинге отсутствует галерея для всех страниц приложения.');
    if ($has_slider) {
        $slider = $definitions['slajder'] ?? array();
        $images = array_filter($slider['sub_fields'] ?? array(), function ($field) { return $field['name'] === 'izobrazhenie_slajda' && $field['type'] === 'image'; });
        if (($slider['type'] ?? '') !== 'repeater' || count($images) !== 1) throw new RuntimeException('Проверьте поля галереи образцов документов в ACF.');
    }
    $key = ais_pg_sync_certificate_owner((int) $snapshot['id'], (int) $data['productId']);
    ais_pg_certificate_key($key, $model['certificateHash'] ?? '', 'ru');
    // Initial preflight is read-only; assets arrive after rendering every page.
    if (!array_key_exists('certificatePages', $data)) return array();
    $pages = ais_pg_certificate_pages($data['certificatePages'], $model['type']);
    $patch = array();
    foreach ($slots as $slot => $language) {
        foreach ($pages as $page) if ($page['language'] === $language) $patch[$slot] = (int) ($page['id'] ?? 0);
    }
    if ($has_slider) $patch['slajder'] = array_map(function ($page) { return array('izobrazhenie_slajda' => (int) ($page['id'] ?? 0)); }, $pages);
    ais_pg_validate_certificates(array('type' => $model['type'], 'key' => $key, 'certificateHash' => $model['certificateHash'], 'certificatePages' => $pages, 'fields' => $patch));
    if (isset($snapshot['_variant'])) {
        $old_ids = array_column($snapshot['_variant']['certificatePages'], 'id');
        $other = array_values(array_filter($snapshot['fields']['slajder'], function ($row) use ($old_ids) { return !in_array((int) ($row['izobrazhenie_slajda'] ?? 0), $old_ids, true); }));
        return array('slajder' => array_merge($other, $patch['slajder']));
    }
    // Updating the main program must also retain documents of attached variants.
    if ($has_slider && $snapshot['variants']) {
        $variant_ids = array();
        foreach ($snapshot['variants'] as $variant) $variant_ids = array_merge($variant_ids, array_column($variant['certificatePages'], 'id'));
        foreach ($snapshot['fields']['slajder'] as $row) if (in_array((int) ($row['izobrazhenie_slajda'] ?? 0), $variant_ids, true)) $patch['slajder'][] = $row;
    }
    return $patch;
}
function ais_pg_sync_certificate_assets($data) {
    if (ais_pg_role() !== 'edu' || ($data['model']['updateSamples'] ?? false) !== true) throw new RuntimeException('Обновление образцов доступно только для выбранного лендинга.');
    ais_pg_sync_existing($data, true);
    // Separate from draft creation: published and legacy pages are allowed only
    // after validating their actual ID, selected product, version and sample fields.
    return ais_pg_upload_certificate_assets(array('type' => $data['model']['type'], 'key' => ais_pg_sync_certificate_owner((int) $data['landingId'], (int) $data['productId']),
        'certificateHash' => $data['model']['certificateHash'], 'images' => $data['images'] ?? null));
}
function ais_pg_sync_existing($data, $check_only = false) {
    global $wpdb;
    $id = (int) ($data[ais_pg_role() === 'edu' ? 'landingId' : 'productId'] ?? 0);
    $lock = 'ais_pg_sync_' . substr(hash('sha256', $wpdb->prefix . ':' . $id), 0, 45);
    if ((string) $wpdb->get_var($wpdb->prepare('SELECT GET_LOCK(%s, 0)', $lock)) !== '1') throw new RuntimeException('Страница уже обновляется. Повторите через несколько секунд.');
    try {
        $snapshot = ais_pg_sync_validate($data);
        if ($check_only) return array('ok' => true);
        if (ais_pg_role() === 'edu' && ($data['model']['updateSamples'] ?? false) === true && empty($snapshot['_sampleFields'])) throw new RuntimeException('Не загружены актуальные образцы документов. Повторите синхронизацию.');
        $model = $data['model'];
        $links = $snapshot['_linksPlan'];
        $price = (string) $model['price'];
        $old = (float) $model['oldPrice'];
        if (ais_pg_role() === 'shop') {
            // Fetch and validate the selected image before changing product fields.
            $image_id = isset($model['imageSource']) ? ais_pg_product_image($model['imageSource']['imageUrl']) : null;
            $product = wc_get_product($id);
            if ($links) {
                ais_pg_sync_webinar_files($product, $links, sanitize_text_field($model['productName']));
                $product->set_slug($links['slug']);
                $product->update_meta_data('_ais_landing_url', $links['landingUrl']);
                $product->update_meta_data('_ais_program_type', $model['type']);
                $product->update_meta_data('_ais_landing_redirect', $links['enabled'] ? '1' : '0');
            }
            $product->set_name(sanitize_text_field($model['productName']));
            $product->set_regular_price($old > (float) $price ? (string) $old : $price);
            $product->set_sale_price($old > (float) $price ? $price : '');
            // The user asks for the current AIS price to take effect now.
            $product->set_date_on_sale_from(null);
            $product->set_date_on_sale_to(null);
            $product->set_price($price);
            if (!empty($model['descriptionHtml'])) $product->set_description(wp_kses_post($model['descriptionHtml']));
            if ($model['type'] === 'ПРО' && !empty($model['date'])) {
                $product->set_description(ais_pg_webinar_schedule($product->get_description('edit'), $model, 'post_content'));
                $product->set_short_description(ais_pg_webinar_schedule($product->get_short_description('edit'), $model, 'post_excerpt'));
            }
            if ($image_id !== null) $product->set_image_id($image_id);
            if (!$product->save()) throw new RuntimeException('Не удалось сохранить товар.');
            if ($links) {
                $saved_product = wc_get_product($id);
                if ($saved_product->get_slug('edit') !== $links['slug']) throw new RuntimeException('Магазин не подтвердил новый адрес товара.');
                if ($links['files']) {
                    if (get_post_meta($id, '_ais_webinar_join_url', true) !== $links['joinUrl']) throw new RuntimeException('Магазин не подтвердил ссылку SberJazz.');
                    $actual_downloads = array();
                    foreach ($saved_product->get_downloads('edit') as $download) $actual_downloads[$download->get_id()] = $download->get_file();
                    foreach ($product->get_downloads('edit') as $download) if (($actual_downloads[$download->get_id()] ?? null) !== $download->get_file()) throw new RuntimeException('Магазин не подтвердил сохранение файлов подключения. Повторите синхронизацию.');
                }
                ais_pg_save_product_redirects($id, $links['enabled'], $links['overrides']);
            }
            if ($image_id !== null && (int) get_post_thumbnail_id($id) !== $image_id) throw new RuntimeException('Магазин не подтвердил изображение товара. Обновите проверку.');
            $actual = ais_pg_sync_product($id);
            if ($actual['title'] !== sanitize_text_field($model['productName']) || (float) $actual['price'] !== (float) $price
                || (float) $actual['regularPrice'] !== ($old > (float) $price ? $old : (float) $price)
                || (string) $actual['salePrice'] !== ($old > (float) $price ? (string) $actual['price'] : '')) throw new RuntimeException('Магазин не подтвердил название или цену. Повторите проверку.');
        } else {
            $fields = $snapshot['fields'];
            $rows = $fields['blok_ceny'];
            $offer = array_values(array_filter($snapshot['offers'], function ($offer) use ($data) { return $offer['productId'] === (int) $data['productId']; }))[0];
            $prices = array('stoimost_kursa' => $price, 'kolichestvo_chasov' => (string) $model['hours'],
                'staraya_cena' => $old > (float) $price ? (string) $old : '', 'skidka' => $old > (float) $price ? (string) round(100 * (1 - (float) $price / $old)) : '0');
            $rows[$offer['index']] = array_merge($rows[$offer['index']], $prices);
            $patch = array('blok_ceny' => $rows, 'podacha_zayavki_nazvanie_kursa' => sanitize_text_field($model['name']));
            // Shared header prices describe the first offer. Other offers must not change them.
            if ($offer['index'] === 0) $patch = array_merge($patch, $prices);
            foreach (array('duration' => 'srok', 'studyForm' => 'forma_obucheniya', 'startLabel' => 'data_starta',
                'descriptionHtml' => 'opisanie_dokumenta', 'speakerHtml' => 'tekst_etap_obucheniya_1') as $source => $destination) {
                if (!empty($model[$source])) $patch[$destination] = wp_kses_post($model[$source]);
            }
            if (!empty($model['descriptionHtml']) && $model['type'] !== 'ПРО') $patch['opisanie_o_programme'] = wp_kses_post($model['descriptionHtml']);
            foreach (array_merge($fields, $patch) as $name => $value) {
                $updated = ais_pg_webinar_schedule($value, $model, $name);
                if ($updated !== $value) $patch[$name] = $updated;
            }
            if (isset($snapshot['_variant'])) {
                // Preserve the two-line default and any manually edited price note.
                $patch = array('blok_ceny' => $rows);
            }
            if (isset($snapshot['_sampleFields'])) $patch = array_merge($patch, $snapshot['_sampleFields']);
            $definitions = get_field_objects($id, false) ?: array();
            $written = array();
            foreach ($definitions as $field) {
                $name = $field['name'];
                if (!array_key_exists($name, $patch)) continue;
                update_field($field['key'], ais_pg_acf_value($field, $patch[$name], true), $id);
                $written[$name] = $patch[$name];
            }
            $post_patch = array('ID' => $id, 'post_title' => sanitize_text_field($model['name']));
            foreach (array('post_content', 'post_excerpt') as $name) {
                $value = get_post_field($name, $id);
                $updated = ais_pg_webinar_schedule($value, $model, $name);
                if ($updated !== $value) $post_patch[$name] = $updated;
            }
            if ($links) $post_patch['post_name'] = $links['slug'];
            if (isset($snapshot['_variant'])) $post_patch = array('ID' => $id);
            $result = wp_update_post(wp_slash($post_patch), true);
            if (is_wp_error($result)) throw new RuntimeException('Не удалось сохранить название лендинга.');
            if (isset($model['imageSource']) && !isset($snapshot['_variant'])) {
                $image = ais_pg_validate_image_source($model['imageSource']);
                set_post_thumbnail($id, $image['imageId']);
                if ((int) get_post_thumbnail_id($id) !== $image['imageId']) throw new RuntimeException('Сайт не подтвердил изображение записи. Обновите проверку.');
            }
            // Read through fresh ACF values, not the request-local value cache.
            if (function_exists('acf_flush_value_cache')) acf_flush_value_cache($id);
            $actual = ais_pg_sync_landing($id);
            foreach (array_merge($written, $snapshot['_sampleFields'] ?? array()) as $name => $value) {
                if (($actual['fields'][$name] ?? null) != $value) throw new RuntimeException('Сайт не подтвердил поле ' . $name . '. Обновите проверку.');
            }
            if (!empty($snapshot['_sampleFields']) && isset($snapshot['_variant'])) {
                $variants = $snapshot['variants']; $key = $snapshot['_variant']['key'];
                $variants[$key]['certificateHash'] = $model['certificateHash'];
                $variants[$key]['certificatePages'] = $data['certificatePages'];
                update_post_meta($id, '_ais_program_variants', $variants);
                if (get_post_meta($id, '_ais_program_variants', true) != $variants) throw new RuntimeException('Не сохранена версия образцов варианта.');
            } elseif (!empty($snapshot['_sampleFields'])) {
                // Keep publication validation consistent for drafts created by the generator.
                update_post_meta($id, '_ais_certificate_hash', $model['certificateHash']);
                update_post_meta($id, '_ais_certificate_pages', $data['certificatePages']);
                update_post_meta($id, '_ais_program_type', $model['type']);
                if (get_post_meta($id, '_ais_certificate_hash', true) !== $model['certificateHash']
                    || get_post_meta($id, '_ais_certificate_pages', true) != $data['certificatePages']
                    || get_post_meta($id, '_ais_program_type', true) !== $model['type']) throw new RuntimeException('Сайт не подтвердил версию образцов. Повторите синхронизацию.');
            }
            if (!isset($snapshot['_variant']) && $actual['title'] !== sanitize_text_field($model['name'])) throw new RuntimeException('Сайт не подтвердил название лендинга.');
            if ($links && $actual['slug'] !== $links['slug']) throw new RuntimeException('Сайт не подтвердил новый адрес лендинга.');
        }
        // Synchronization never publishes drafts or replaces post/download identities.
        return ais_pg_result($id);
    } finally { $wpdb->get_var($wpdb->prepare('SELECT RELEASE_LOCK(%s)', $lock)); }
}
function ais_pg_log_failure($error, $action) {
    // No request body, link/password, absolute path or vendor message in logs.
    $reference = substr(hash('sha256', uniqid('', true)), 0, 12);
    $record = array('reference' => $reference, 'action' => $action, 'exception' => get_class($error),
        'file' => basename($error->getFile()), 'line' => $error->getLine(),
        'frames' => array_map(function ($frame) { return ($frame['class'] ?? '') . ($frame['type'] ?? '') . ($frame['function'] ?? ''); }, array_slice($error->getTrace(), 0, 8)));
    if (function_exists('wc_get_logger')) wc_get_logger()->error(json_encode($record), array('source' => 'ais-program-generator'));
    else error_log('AIS program generator: ' . json_encode($record));
    return $reference;
}
function ais_pg_dispatch($request) {
    try {
        $action = basename($request->get_route());
        if ($request->get_method() === 'POST') {
            if (strlen($request->get_body()) > (in_array($action, array('certificate-assets', 'sync-certificate-assets'), true) ? 11500000 : 2000000)) return ais_pg_error('Слишком большой запрос.', 413);
            $data = $request->get_json_params() ?: array();
            if ($action === 'resolve-site') return ais_pg_resolve_site($data);
            if ($action === 'landing-code') return ais_pg_landing_code($data);
            if ($action === 'set-variant-visibility') return ais_pg_set_variant_visibility($data);
            if ($action === 'sync-certificate-assets') return ais_pg_sync_certificate_assets($data);
            if (in_array($action, array('check-variant', 'variant-assets', 'attach-variant'), true)) return ais_pg_variant($action, $data);
            if (in_array($action, array('check-sync', 'sync-existing'), true)) return ais_pg_sync_existing($data, $action === 'check-sync');
            return ais_pg_mutate($action, $data);
        }
        if ($action === 'health') return array('ok' => true, 'version' => '1.7.7', 'variantVisibility' => true, 'programVariants' => true, 'sampleSync' => true, 'webinarScheduleSync' => true, 'webinarSync' => true, 'promoUrlSync' => true, 'soldIndividually' => true, 'prototypeStartLabel' => true, 'publicWebinarHtml' => true, 'imageSources' => true, 'draftRegistrationNotice' => true, 'productPresentation' => true, 'redirectManager' => is_callable(array('WF301_functions', 'save_redirect_rule')), 'syncExisting' => true, 'programTypes' => array('ПРО', 'ДОП', 'КПК', 'ППП'), 'certificateSamples' => true, 'role' => ais_pg_role(), 'acf' => function_exists('get_field_objects'), 'woocommerce' => class_exists('WC_Product_Simple'), 'downloadFormats' => ais_pg_download_formats());
        if (ais_pg_role() === 'shop' && strpos($request->get_route(), '/sync-product/') !== false) return ais_pg_sync_product((int) $request['id']);
        if (ais_pg_role() !== 'edu') return ais_pg_error('Операция доступна только на сайте программ.', 404);
        if (in_array($action, array('templates', 'catalog'), true)) {
            $posts = get_posts(array('post_type' => $action === 'catalog' ? array('other-course', 'courses-pk', 'courses-pp') : 'other-course', 'post_status' => 'publish', 'posts_per_page' => -1, 'orderby' => 'title', 'order' => 'ASC'));
            return array('templates' => array_map(function ($post) {
                $image_id = (int) get_post_thumbnail_id($post->ID);
                $image_url = $image_id ? wp_get_attachment_image_url($image_id, 'full') : '';
                return array('id' => $post->ID, 'title' => $post->post_title, 'postType' => $post->post_type, 'url' => get_permalink($post->ID),
                    'startLabel' => ais_pg_start_label($post->ID),
                    'imageUrl' => ais_pg_image_url_valid($image_url) ? $image_url : '',
                    'previewImageUrl' => ais_pg_image_url_valid($image_url) ? (wp_get_attachment_image_url($image_id, 'medium') ?: $image_url) : '');
            }, $posts));
        }
        if (strpos($request->get_route(), '/image-source/') !== false) return ais_pg_image_source((int) $request['id']);
        $post = ais_pg_template((int) $request['id']);
        $fields = array();
        foreach (get_field_objects($post->ID, false) ?: array() as $field) $fields[$field['name']] = ais_pg_acf_value($field, $field['value']);
        $image = wp_get_attachment_image_url(get_post_thumbnail_id($post->ID), 'full');
        return array('id' => $post->ID, 'title' => $post->post_title, 'postType' => $post->post_type, 'modified' => $post->post_modified_gmt, 'fields' => $fields, 'imageUrl' => $image ?: '');
    } catch (Throwable $error) {
        // Only deliberate validation errors are public; no paths, SQL or vendor traces.
        $reference = ais_pg_log_failure($error, $action ?? 'unknown');
        return ais_pg_error($error instanceof RuntimeException ? $error->getMessage() : 'Не удалось выполнить операцию. Код диагностики: ' . $reference . '. Подробности в журнале WooCommerce «ais-program-generator».', 409);
    }
}
add_action('rest_api_init', function () {
    foreach (array('health', 'templates', 'catalog', 'template/(?P<id>\d+)', 'image-source/(?P<id>\d+)', 'sync-product/(?P<id>\d+)') as $route) register_rest_route('ais-program-sites/v1', '/' . $route, array('methods' => 'GET', 'permission_callback' => 'ais_pg_permission', 'callback' => 'ais_pg_dispatch'));
    foreach (array('prepare-product', 'configure-product', 'prepare-landing', 'certificate-assets', 'sync-certificate-assets', 'validate-publication', 'publish', 'enable-redirect', 'resolve-site', 'landing-code', 'check-sync', 'sync-existing', 'check-variant', 'variant-assets', 'attach-variant', 'set-variant-visibility') as $route) register_rest_route('ais-program-sites/v1', '/' . $route, array('methods' => 'POST', 'permission_callback' => 'ais_pg_permission', 'callback' => 'ais_pg_dispatch'));
});
// Filter at load time so both get_field() and have_rows() omit hidden rows.
// Admin/REST/CLI always see complete raw ACF data for edits and synchronization.
function ais_pg_visible_variant_rows($value, $post_id, $field) {
    $name = $field['name'] ?? '';
    if (!is_array($value) || !is_numeric($post_id) || ais_pg_role() !== 'edu'
        || !in_array($name, array('blok_ceny', 'programmy_obucheniya', 'slajder'), true)
        || (function_exists('is_admin') && is_admin()) || (defined('REST_REQUEST') && REST_REQUEST) || (defined('WP_CLI') && WP_CLI)) return $value;
    try { $hidden = ais_pg_hidden_offers((int) $post_id); } catch (Throwable $error) { return $value; }
    if (!$hidden) return $value;
    $key = function ($name) use ($field) {
        foreach ($field['sub_fields'] ?? array() as $sub) if ($sub['name'] === $name) return $sub['key'];
        return $name;
    };
    $variants = get_post_meta((int) $post_id, '_ais_program_variants', true) ?: array();
    $plans = array(); $images = array(); $visible_images = array();
    foreach (is_array($variants) ? $variants : array() as $variant) {
        $ids = array_column($variant['certificatePages'] ?? array(), 'id');
        if (in_array((int) ($variant['productId'] ?? 0), $hidden, true)) {
            if (isset($variant['planIndex'])) $plans[] = (int) $variant['planIndex'];
            $images = array_merge($images, $ids);
        } else $visible_images = array_merge($visible_images, $ids);
    }
    $images = array_diff($images, $visible_images);
    $visible = array();
    foreach ($value as $index => $row) {
        if (!is_array($row)) { $visible[] = $row; continue; }
        if ($name === 'blok_ceny' && in_array(ais_pg_offer_product_id($row[$key('ssylka_na_registraciyu')] ?? $row['ssylka_na_registraciyu'] ?? ''), $hidden, true)) continue;
        if ($name === 'programmy_obucheniya' && in_array((int) $index, $plans, true)) continue;
        if ($name === 'slajder' && in_array((int) ($row[$key('izobrazhenie_slajda')] ?? $row['izobrazhenie_slajda'] ?? 0), array_map('intval', $images), true)) continue;
        $visible[] = $row;
    }
    return $visible;
}
add_filter('acf/load_value', 'ais_pg_visible_variant_rows', 20, 3);
function ais_pg_format_variant_price_note($value, $post_id, $field) {
    if (ais_pg_role() !== 'edu' || !preg_match('/(?:^|_)primechanie_ceny$/D', $field['name'] ?? '') || $value !== ais_pg_variant_price_note()) return $value;
    // The stored value has exactly two text lines; HTML gets an explicit break.
    return do_shortcode(str_replace("\n", "<br>\n", $value));
}
add_filter('acf/format_value', 'ais_pg_format_variant_price_note', 25, 3);
// Repair displayed links in older generated pages too, without mutating their
// content, publication status, reviews or unrelated manually maintained pages.
function ais_pg_render_registration_links($value, $post_id, $name = '') {
    if (!is_numeric($post_id) || !get_post_meta((int) $post_id, '_ais_generator_key', true)) return $value;
    if (ais_pg_role() === 'edu') {
        // Filtering can leave one visible offer of a multi-product landing. It
        // must keep its own product URL, not inherit the hidden original product.
        if (ais_pg_hidden_offers((int) $post_id)) return $value;
        $offers = get_field('blok_ceny', (int) $post_id, false);
        if (is_array($offers) && count($offers) > 1) return $value;
    }
    $product_id = ais_pg_role() === 'shop' ? (int) $post_id : (int) get_post_meta((int) $post_id, '_ais_generator_product', true);
    return ais_pg_registration_links($value, $product_id, $name);
}
add_filter('acf/format_value', function ($value, $post_id, $field) {
    // ACF formats child fields before their parent: whitelist the registration
    // and description blocks, not arbitrary text that may belong to a review.
    if (!in_array($field['name'] ?? '', array('blok_ceny', 'ssylka_na_registraciyu', 'opisanie_dokumenta', 'opisanie_o_programme', 'tekst_etap_obucheniya_1'), true)) return $value;
    return ais_pg_render_registration_links($value, $post_id, $field['name'] ?? '');
}, 20, 3);
add_filter('the_content', function ($content) { return ais_pg_render_registration_links($content, get_the_ID(), 'post_content'); }, 20);
// Run before WooCommerce's add-to-cart handler. Never make a draft purchasable.
function ais_pg_draft_registration_message($id) {
    if (ais_pg_role() !== 'shop' || get_post_type($id) !== 'product' || get_post_status($id) !== 'draft'
        || !get_post_meta($id, '_ais_generator_key', true)) return '';
    return 'Регистрация ещё не открыта: товар сохранён как черновик. После проверки в АИС нажмите «Опубликовать страницу и товар», затем повторите регистрацию. Корзина не изменена.';
}
add_action('wp_loaded', function () {
    $value = $_REQUEST['add-to-cart'] ?? '';
    if (!is_scalar($value) || !preg_match('/^[1-9]\d*$/D', (string) $value)) return;
    $message = ais_pg_draft_registration_message((int) $value);
    if (!$message) return;
    nocache_headers();
    wp_die(esc_html($message), 'Регистрация ещё не открыта', array('response' => 409, 'back_link' => true));
}, 5);
// Allow HTML as a WooCommerce download, not as a general media-library upload.
// This also permits later edits of the generated download in the product editor.
add_filter('woocommerce_downloadable_file_allowed_mime_types', function ($types) {
    if (ais_pg_role() === 'shop') $types['html'] = 'text/html';
    return $types;
});
// This filter runs ONLY after WooCommerce has checked download/order permissions.
add_filter('woocommerce_file_download_method', function ($method, $id, $file) {
    // Public HTML files use WooCommerce's standard handler. Retain the legacy
    // private-file redirect for existing orders and non-webinar programs.
    if (strpos($file, 'https://zifra-plus.ru/wp-content/uploads/dae-uploads/webinars/') === 0) return $method;
    return get_post_meta($id, '_ais_generator_key', true) && $file === (get_post_meta($id, '_ais_download_file', true) ?: get_post_meta($id, '_ais_webinar_file', true)) ? 'ais_webinar' : $method;
}, 10, 3);
add_action('woocommerce_download_file_ais_webinar', function ($file, $filename) {
    $key = basename(dirname($file));
    try {
        if (!preg_match('/^[a-f0-9]{64}$/D', $key) || ais_pg_role() !== 'shop') throw new RuntimeException('Недопустимый файл.');
        $id = ais_pg_find($key);
        if (!$id || $file !== (get_post_meta($id, '_ais_download_file', true) ?: get_post_meta($id, '_ais_webinar_file', true))) throw new RuntimeException('Файл не найден.');
        $url = ais_pg_download_target($id);
        nocache_headers();
        wp_redirect($url, 302, 'AIS webinar');
        exit;
    } catch (Throwable $error) { wp_die('Ссылка подключения недоступна. Обратитесь в учебный центр.', '', array('response' => 403)); }
}, 10, 2);
add_filter('woocommerce_cart_item_permalink', function ($url, $item) {
    $id = (int) ($item['product_id'] ?? 0);
    if (get_post_meta($id, '_ais_landing_redirect', true) !== '1' || get_post_status($id) !== 'publish') return $url;
    $landing = get_post_meta($id, '_ais_landing_url', true);
    return preg_match('~^https://edu-plus\.ru/(?:other_course|courses-pk|courses-pp)/[a-z0-9][a-z0-9_-]{1,79}/$~D', $landing) ? $landing : $url;
}, 10, 2);
add_action('template_redirect', function () {
    if (ais_pg_role() !== 'shop' || !is_singular('product') || is_preview() || isset($_GET['add-to-cart'])) return;
    $id = get_queried_object_id();
    if (get_post_status($id) !== 'publish' || get_post_meta($id, '_ais_landing_redirect', true) !== '1') return;
    $url = get_post_meta($id, '_ais_landing_url', true);
    if (!preg_match('~^https://edu-plus\.ru/(?:other_course|courses-pk|courses-pp)/[a-z0-9][a-z0-9_-]{1,79}/$~D', $url)) return;
    foreach (array('utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term') as $param) {
        if (isset($_GET[$param]) && is_string($_GET[$param])) $url = add_query_arg($param, sanitize_text_field(wp_unslash($_GET[$param])), $url);
    }
    wp_redirect($url, 301, 'AIS program');
    exit;
});
