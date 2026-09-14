<?php
/**
 * Plugin Name: АИС — генератор образовательных программ
 * Description: Копирование проверяемых черновиков и защищённое подключение к вебинарам.
 * Version: 1.3.3
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
        $slug = $post->post_name;
        ais_pg_slug($slug, $data['postType'], $own_id);
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
function ais_pg_prepare_landing($data) {
    $type = ais_pg_program_type($data);
    $post_type = ais_pg_post_type($type);
    $template = ais_pg_template((int) ($data['templateId'] ?? 0));
    if ($type !== 'ДОП' && $template->post_type !== $post_type) throw new RuntimeException('Выберите прототип соответствующего вида программы.');
    if ($template->post_modified_gmt !== ($data['templateModified'] ?? '')) throw new RuntimeException('Прототип изменился. Повторите подготовку.');
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
        'post_content' => $template->post_content, 'post_excerpt' => $template->post_excerpt,
        'meta_input' => array('_ais_generator_key' => $data['key'], '_ais_generator_template' => $template->ID));
    if ($id) $post_data['ID'] = $id;
    $id = wp_insert_post(wp_slash($post_data), true);
    if (is_wp_error($id)) throw new RuntimeException('Не удалось сохранить черновик лендинга.');
    foreach ($definition as $field) {
        // Copy description, author and reviews from the authoritative prototype.
        if (in_array($field['name'], array('blok_opisaniya_kursa', 'opisanie_dokumenta', 'opisanie_o_programme', 'tekst_etap_obucheniya_1'), true)
            || preg_match('/otzyv|review/i', $field['name'])) {
            $data['fields'][$field['name']] = ais_pg_acf_value($field, $field['value']);
        }
        if (array_key_exists($field['name'], $data['fields'])) update_field($field['key'], ais_pg_acf_value($field, $data['fields'][$field['name']], true), $id);
    }
    $thumbnail = get_post_thumbnail_id($template->ID);
    if ($thumbnail) set_post_thumbnail($id, $thumbnail);
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
function ais_pg_connection_file($key, $name, $url) {
    // A connection link must never be stored in a predictable public uploads file.
    $dir = dirname(rtrim(ABSPATH, '/\\')) . '/ais-webinar-files/' . $key;
    if (!wp_mkdir_p($dir)) throw new RuntimeException('Не удалось создать защищённую папку подключения.');
    $file = $dir . '/connection.html';
    $html = '<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>' . esc_html($name) . '</title><h1>' . esc_html($name) . '</h1><p><a href="' . esc_attr($url) . '">Подключиться к вебинару SberJazz</a></p></html>';
    if (file_put_contents($file, $html, LOCK_EX) !== strlen($html)) throw new RuntimeException('Не удалось сохранить HTML-файл подключения.');
    @chmod($file, 0600);
    return $file;
}
function ais_pg_prepare_product($data) {
    if (!class_exists('WC_Product_Simple') || !class_exists('WC_Product_Download')) throw new RuntimeException('WooCommerce недоступен.');
    $id = ais_pg_find($data['key']);
    ais_pg_slug($data['slug'] ?? '', 'product', $id);
    if ($id && get_post_meta($id, '_ais_generator_hash', true) === $data['hash']) return ais_pg_result($id);
    if ($id && get_post_status($id) === 'publish') throw new RuntimeException('Товар уже опубликован с другими параметрами. Автоматическая перезапись запрещена.');
    $name = sanitize_text_field($data['productName'] ?? '');
    if (!$name || mb_strlen($name) > 128 || !isset($data['price']) || !is_numeric($data['price']) || $data['price'] < 0 || $data['price'] > 10000000) throw new RuntimeException('Проверьте название товара (до 128 символов) и цену.');
    $type = ais_pg_program_type($data);
    $webinar = $type === 'ПРО';
    $url = $webinar ? ais_pg_join_url($data['joinUrl'] ?? '') : '';
    $file = $webinar ? ais_pg_connection_file($data['key'], $name, $url) : '';
    // Approve only this generator's private directory, without weakening global checks.
    $registry_class = 'Automattic\\WooCommerce\\Internal\\ProductDownloads\\ApprovedDirectories\\Register';
    if ($webinar && class_exists($registry_class)) wc_get_container()->get($registry_class)->add_approved_directory(dirname($file) . '/', true);
    $product = $id ? wc_get_product($id) : new WC_Product_Simple();
    if (!$product || !$product->is_type('simple')) throw new RuntimeException('Неверный тип ранее созданного товара.');
    $product->set_name($name);
    $product->set_slug($data['slug']);
    $product->set_status('draft');
    $product->set_virtual(true);
    $product->set_downloadable($webinar);
    $product->set_catalog_visibility('hidden');
    $price = (string) $data['price'];
    $old = (float) ($data['oldPrice'] ?? 0);
    $product->set_regular_price($old > (float) $price ? (string) $old : $price);
    $product->set_sale_price($old > (float) $price ? $price : '');
    $product->set_price($price);
    $product->set_description(wp_kses_post($data['descriptionHtml'] ?? ''));
    $downloads = array();
    if ($webinar) {
        $download = new WC_Product_Download();
        $download->set_id(substr($data['key'], 0, 32));
        $download->set_name('Подключение к вебинару — ' . $name);
        $download->set_file($file);
        $downloads[] = $download;
    }
    $product->set_downloads($downloads);
    $product->update_meta_data('_ais_generator_key', $data['key']);
    $product->update_meta_data('_ais_webinar_join_url', $url);
    $product->update_meta_data('_ais_webinar_file', $file);
    $product->update_meta_data('_ais_program_type', $type);
    $product->update_meta_data('_ais_landing_url', ais_pg_landing_url($type, $data['slug']));
    $product->update_meta_data('_ais_generator_hash', $data['hash']);
    $id = $product->save();
    if (!$id) throw new RuntimeException('Не удалось сохранить товар.');
    return ais_pg_result($id);
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
            update_post_meta($id, '_ais_landing_redirect', '1');
            return ais_pg_result($id);
        }
        throw new RuntimeException('Недопустимая операция.');
    } finally {
        $wpdb->get_var($wpdb->prepare('SELECT RELEASE_LOCK(%s)', $lock));
    }
}
function ais_pg_sync_landing($id) {
    $post = get_post($id);
    if (!$post || !in_array($post->post_type, array('other-course', 'courses-pk', 'courses-pp'), true)
        || !in_array($post->post_status, array('draft', 'publish'), true)) throw new RuntimeException('Лендинг не найден или недоступен. Проверьте код в карточке.');
    if (!function_exists('get_field_objects')) throw new RuntimeException('На сайте недоступен ACF.');
    $fields = array();
    foreach (get_field_objects($id, false) ?: array() as $field) $fields[$field['name']] = ais_pg_acf_value($field, $field['value']);
    $offers = array();
    foreach ($fields['blok_ceny'] ?? array() as $index => $row) {
        $url = wp_parse_url(html_entity_decode((string) ($row['ssylka_na_registraciyu'] ?? ''), ENT_QUOTES, 'UTF-8'));
        if (!$url || !in_array($url['scheme'] ?? '', array('https', 'http'), true) || strtolower($url['host'] ?? '') !== 'zifra-plus.ru'
            || isset($url['user']) || isset($url['pass']) || isset($url['port'])) continue;
        parse_str($url['query'] ?? '', $query);
        $product_id = $query['add-to-cart'] ?? '';
        if (!is_scalar($product_id) || !preg_match('/^[1-9]\d*$/D', (string) $product_id)) continue;
        $offers[] = array('index' => $index, 'productId' => (int) $product_id, 'hours' => $row['kolichestvo_chasov'] ?? '', 'price' => $row['stoimost_kursa'] ?? '');
    }
    $version = hash('sha256', wp_json_encode(array($post->post_title, $post->post_modified_gmt, $post->post_status, $post->post_content, $fields)));
    $image = function_exists('wp_get_attachment_image_url') ? wp_get_attachment_image_url(get_post_thumbnail_id($id), 'medium_large') : '';
    return array_merge(ais_pg_result($id), array('title' => $post->post_title, 'previewImageUrl' => $image ?: '', 'fields' => $fields, 'offers' => $offers, 'version' => $version));
}
function ais_pg_sync_product($id) {
    if (!function_exists('wc_get_product')) throw new RuntimeException('WooCommerce недоступен.');
    $product = wc_get_product($id);
    if (!$product || !$product->is_type('simple') || !in_array($product->get_status(), array('draft', 'publish'), true)) throw new RuntimeException('Товар не найден, недоступен или не является простым товаром.');
    $values = array('title' => $product->get_name(), 'price' => $product->get_price(), 'regularPrice' => $product->get_regular_price(),
        'salePrice' => $product->get_sale_price(), 'descriptionHtml' => $product->get_description(),
        'saleFrom' => (string) $product->get_date_on_sale_from(), 'saleTo' => (string) $product->get_date_on_sale_to());
    return array_merge(ais_pg_result($id), $values, array('version' => hash('sha256', wp_json_encode(array($values, $product->get_status(), (string) $product->get_date_modified())))));
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
    $id = (int) ($data[ais_pg_role() === 'edu' ? 'landingId' : 'productId'] ?? 0);
    $snapshot = ais_pg_role() === 'edu' ? ais_pg_sync_landing($id) : ais_pg_sync_product($id);
    if (!is_string($data['version'] ?? null) || !hash_equals($snapshot['version'], $data['version'])) throw new RuntimeException('Данные на сайте изменились. Обновите проверку перед синхронизацией.');
    if (ais_pg_role() === 'edu') {
        $matching = array_filter($snapshot['offers'], function ($offer) use ($data) { return $offer['productId'] === (int) ($data['productId'] ?? 0); });
        if (count($matching) !== 1) throw new RuntimeException('Нужен один ценовой блок выбранного товара. Проверьте ссылки регистрации на лендинге.');
        // Refuse malformed/missing price blocks before the shop is changed.
        $row = $snapshot['fields']['blok_ceny'][array_values($matching)[0]['index']];
        foreach (array('stoimost_kursa', 'kolichestvo_chasov', 'staraya_cena', 'skidka') as $key) {
            if (!array_key_exists($key, $row)) throw new RuntimeException('В ценовом блоке отсутствует поле ' . $key . '. Проверьте ACF.');
        }
    }
    return $snapshot;
}
function ais_pg_sync_existing($data, $check_only = false) {
    global $wpdb;
    $id = (int) ($data[ais_pg_role() === 'edu' ? 'landingId' : 'productId'] ?? 0);
    $lock = 'ais_pg_sync_' . substr(hash('sha256', $wpdb->prefix . ':' . $id), 0, 45);
    if ((string) $wpdb->get_var($wpdb->prepare('SELECT GET_LOCK(%s, 0)', $lock)) !== '1') throw new RuntimeException('Страница уже обновляется. Повторите через несколько секунд.');
    try {
        $snapshot = ais_pg_sync_validate($data);
        if ($check_only) return array('ok' => true);
        $model = $data['model'];
        $price = (string) $model['price'];
        $old = (float) $model['oldPrice'];
        if (ais_pg_role() === 'shop') {
            $product = wc_get_product($id);
            $product->set_name(sanitize_text_field($model['productName']));
            $product->set_regular_price($old > (float) $price ? (string) $old : $price);
            $product->set_sale_price($old > (float) $price ? $price : '');
            // The user asks for the current AIS price to take effect now.
            $product->set_date_on_sale_from(null);
            $product->set_date_on_sale_to(null);
            $product->set_price($price);
            if (!empty($model['descriptionHtml'])) $product->set_description(wp_kses_post($model['descriptionHtml']));
            if (!$product->save()) throw new RuntimeException('Не удалось сохранить товар.');
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
            $definitions = get_field_objects($id, false) ?: array();
            $written = array();
            foreach ($definitions as $field) {
                $name = $field['name'];
                if (!array_key_exists($name, $patch)) continue;
                update_field($field['key'], ais_pg_acf_value($field, $patch[$name], true), $id);
                $written[$name] = $patch[$name];
            }
            $result = wp_update_post(wp_slash(array('ID' => $id, 'post_title' => sanitize_text_field($model['name']))), true);
            if (is_wp_error($result)) throw new RuntimeException('Не удалось сохранить название лендинга.');
            // Read through fresh ACF values, not the request-local value cache.
            if (function_exists('acf_flush_value_cache')) acf_flush_value_cache($id);
            $actual = ais_pg_sync_landing($id);
            foreach ($written as $name => $value) {
                if (($actual['fields'][$name] ?? null) != $value) throw new RuntimeException('Сайт не подтвердил поле ' . $name . '. Обновите проверку.');
            }
            if ($actual['title'] !== sanitize_text_field($model['name'])) throw new RuntimeException('Сайт не подтвердил название лендинга.');
        }
        // No publication, permalink, redirect, review, image, download or identity changes.
        return ais_pg_result($id);
    } finally { $wpdb->get_var($wpdb->prepare('SELECT RELEASE_LOCK(%s)', $lock)); }
}
function ais_pg_dispatch($request) {
    try {
        $action = basename($request->get_route());
        if ($request->get_method() === 'POST') {
            if (strlen($request->get_body()) > ($action === 'certificate-assets' ? 11500000 : 2000000)) return ais_pg_error('Слишком большой запрос.', 413);
            $data = $request->get_json_params() ?: array();
            if ($action === 'resolve-site') return ais_pg_resolve_site($data);
            if ($action === 'landing-code') return ais_pg_landing_code($data);
            if (in_array($action, array('check-sync', 'sync-existing'), true)) return ais_pg_sync_existing($data, $action === 'check-sync');
            return ais_pg_mutate($action, $data);
        }
        if ($action === 'health') return array('ok' => true, 'version' => '1.3.3', 'syncExisting' => true, 'programTypes' => array('ПРО', 'ДОП', 'КПК', 'ППП'), 'certificateSamples' => true, 'role' => ais_pg_role(), 'acf' => function_exists('get_field_objects'), 'woocommerce' => class_exists('WC_Product_Simple'));
        if (ais_pg_role() === 'shop' && strpos($request->get_route(), '/sync-product/') !== false) return ais_pg_sync_product((int) $request['id']);
        if (ais_pg_role() !== 'edu') return ais_pg_error('Операция доступна только на сайте программ.', 404);
        if (in_array($action, array('templates', 'catalog'), true)) {
            $posts = get_posts(array('post_type' => $action === 'catalog' ? array('other-course', 'courses-pk', 'courses-pp') : 'other-course', 'post_status' => 'publish', 'posts_per_page' => -1, 'orderby' => 'title', 'order' => 'ASC'));
            return array('templates' => array_map(function ($post) { return array('id' => $post->ID, 'title' => $post->post_title, 'postType' => $post->post_type, 'url' => get_permalink($post->ID)); }, $posts));
        }
        $post = ais_pg_template((int) $request['id']);
        $fields = array();
        foreach (get_field_objects($post->ID, false) ?: array() as $field) $fields[$field['name']] = ais_pg_acf_value($field, $field['value']);
        return array('id' => $post->ID, 'title' => $post->post_title, 'postType' => $post->post_type, 'modified' => $post->post_modified_gmt, 'fields' => $fields);
    } catch (Throwable $error) {
        // Only deliberate validation errors are public; no paths, SQL or vendor traces.
        return ais_pg_error($error instanceof RuntimeException ? $error->getMessage() : 'Не удалось выполнить операцию. Проверьте журнал WordPress и повторите подготовку.', 409);
    }
}
add_action('rest_api_init', function () {
    foreach (array('health', 'templates', 'catalog', 'template/(?P<id>\d+)', 'sync-product/(?P<id>\d+)') as $route) register_rest_route('ais-program-sites/v1', '/' . $route, array('methods' => 'GET', 'permission_callback' => 'ais_pg_permission', 'callback' => 'ais_pg_dispatch'));
    foreach (array('prepare-product', 'prepare-landing', 'certificate-assets', 'validate-publication', 'publish', 'enable-redirect', 'resolve-site', 'landing-code', 'check-sync', 'sync-existing') as $route) register_rest_route('ais-program-sites/v1', '/' . $route, array('methods' => 'POST', 'permission_callback' => 'ais_pg_permission', 'callback' => 'ais_pg_dispatch'));
});
// This filter runs ONLY after WooCommerce has checked download/order permissions.
add_filter('woocommerce_file_download_method', function ($method, $id, $file) {
    return get_post_meta($id, '_ais_generator_key', true) && $file === get_post_meta($id, '_ais_webinar_file', true) ? 'ais_webinar' : $method;
}, 10, 3);
add_action('woocommerce_download_file_ais_webinar', function ($file, $filename) {
    $key = basename(dirname($file));
    try {
        if (!preg_match('/^[a-f0-9]{64}$/D', $key) || ais_pg_role() !== 'shop') throw new RuntimeException('Недопустимый файл.');
        $id = ais_pg_find($key);
        if (!$id || $file !== get_post_meta($id, '_ais_webinar_file', true)) throw new RuntimeException('Файл не найден.');
        $url = ais_pg_join_url(get_post_meta($id, '_ais_webinar_join_url', true));
        nocache_headers();
        wp_redirect($url, 302, 'AIS webinar');
        exit;
    } catch (Throwable $error) { wp_die('Ссылка подключения недоступна. Обратитесь в учебный центр.', '', array('response' => 403)); }
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
