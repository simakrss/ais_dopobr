<?php
/**
 * Plugin Name: АИС — генератор программ ПРО
 * Description: Копирование проверяемых черновиков и защищённое подключение к вебинарам.
 * Version: 1.1.1
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
function ais_pg_find($key) {
    $ids = get_posts(array('post_type' => ais_pg_role() === 'shop' ? 'product' : 'other-course',
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
function ais_pg_certificate_slots() {
    return array('izobrazhenie_vydavaemogo_dokumenta' => 'ru', 'prevyu_vydavaemogo_dokumenta_1' => 'ru',
        'izobrazhenie_vydavaemogo_dokumenta_2' => 'en', 'prevyu_vydavaemogo_dokumenta_2' => 'en');
}
function ais_pg_certificate_key($key, $hash, $language) {
    if (!preg_match('/^[a-f0-9]{64}$/D', $hash) || !in_array($language, array('ru', 'en'), true)) throw new RuntimeException('Не указана версия образцов сертификатов.');
    return hash('sha256', $key . ':' . $hash . ':' . $language);
}
function ais_pg_certificate_assets($data) {
    $own_id = ais_pg_find($data['key']);
    if ($own_id && get_post_status($own_id) === 'publish' && get_post_meta($own_id, '_ais_generator_hash', true) !== $data['hash']) {
        throw new RuntimeException('Программа уже опубликована с другими параметрами. Автоматическая перезапись запрещена.');
    }
    $images = $data['images'] ?? null;
    if (!is_array($images) || count($images) !== 2) throw new RuntimeException('Нужны два образца сертификата — русский и английский.');
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
            $id = wp_insert_attachment(array('post_title' => 'Образец сертификата ПРО / SAMPLE — ' . strtoupper($language),
                'post_mime_type' => 'image/jpeg', 'post_status' => 'inherit',
                'meta_input' => array('_ais_certificate_key' => $image['key'])), $uploaded['file'], 0, true);
            if (is_wp_error($id)) {
                wp_delete_file($uploaded['file']);
                throw new RuntimeException('Не удалось зарегистрировать образец сертификата в медиатеке.');
            }
            update_post_meta($id, '_wp_attachment_image_alt', 'Образец сертификата — ' . ($language === 'ru' ? 'русский' : 'English'));
        }
        // Recover interrupted thumbnail generation without uploading another attachment.
        if (!wp_get_attachment_metadata($id)) wp_update_attachment_metadata($id, wp_generate_attachment_metadata($id, get_attached_file($id)));
        $result[] = array('id' => $id, 'language' => $language, 'url' => wp_get_attachment_url($id));
    }
    return array('ok' => true, 'images' => $result);
}
function ais_pg_validate_certificates($data) {
    foreach (ais_pg_certificate_slots() as $slot => $language) {
        $id = (int) ($data['fields'][$slot] ?? 0);
        $expected = ais_pg_certificate_key($data['key'], $data['certificateHash'] ?? '', $language);
        if (!$id || get_post_type($id) !== 'attachment' || get_post_mime_type($id) !== 'image/jpeg'
            || get_post_meta($id, '_ais_certificate_key', true) !== $expected || !is_file(get_attached_file($id))) {
            throw new RuntimeException('Для лендинга не загружены актуальные образцы сертификатов. Повторите подготовку.');
        }
    }
}
function ais_pg_prepare_landing($data) {
    $template = ais_pg_template((int) ($data['templateId'] ?? 0));
    if ($template->post_modified_gmt !== ($data['templateModified'] ?? '')) throw new RuntimeException('Прототип изменился. Повторите подготовку.');
    $id = ais_pg_find($data['key']);
    ais_pg_slug($data['slug'] ?? '', 'other-course', $id);
    if ($id && get_post_meta($id, '_ais_generator_hash', true) === $data['hash']) return ais_pg_result($id);
    if ($id && get_post_status($id) === 'publish') throw new RuntimeException('Программа уже опубликована с другими параметрами. Отредактируйте её в WordPress; автоматическая перезапись запрещена.');
    $title = sanitize_text_field($data['title'] ?? '');
    if (!$title || !is_array($data['fields'] ?? null)) throw new RuntimeException('Не заполнены название или поля лендинга.');
    $definition = get_field_objects($template->ID, false) ?: array();
    if (!$definition) throw new RuntimeException('Прототип не содержит полей ACF.');
    ais_pg_validate_certificates($data);
    $field_names = array_column($definition, 'name');
    foreach (ais_pg_certificate_slots() as $slot => $_language) {
        if (!in_array($slot, $field_names, true)) throw new RuntimeException('В прототипе отсутствуют блоки образцов сертификатов.');
    }
    $post_data = array('post_title' => $title, 'post_name' => $data['slug'], 'post_type' => 'other-course', 'post_status' => 'draft',
        'post_content' => $template->post_content, 'post_excerpt' => $template->post_excerpt,
        'meta_input' => array('_ais_generator_key' => $data['key'], '_ais_generator_template' => $template->ID));
    if ($id) $post_data['ID'] = $id;
    $id = wp_insert_post(wp_slash($post_data), true);
    if (is_wp_error($id)) throw new RuntimeException('Не удалось сохранить черновик лендинга.');
    foreach ($definition as $field) {
        if (array_key_exists($field['name'], $data['fields'])) update_field($field['key'], ais_pg_acf_value($field, $data['fields'][$field['name']], true), $id);
    }
    $thumbnail = get_post_thumbnail_id($template->ID);
    if ($thumbnail) set_post_thumbnail($id, $thumbnail);
    // Only public taxonomies; never copy edit locks, secrets, author/session metadata.
    foreach (get_object_taxonomies('other-course', 'objects') as $taxonomy) {
        if ($taxonomy->public) wp_set_object_terms($id, wp_get_object_terms($template->ID, $taxonomy->name, array('fields' => 'ids')), $taxonomy->name);
    }
    update_post_meta($id, '_ais_generator_product', (int) ($data['productId'] ?? 0));
    foreach (ais_pg_certificate_slots() as $slot => $_language) {
        if ((int) get_field($slot, $id, false) !== (int) $data['fields'][$slot]) throw new RuntimeException('WordPress не подтвердил подстановку образцов. Повторите подготовку.');
    }
    update_post_meta($id, '_ais_certificate_hash', $data['certificateHash']);
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
    $url = ais_pg_join_url($data['joinUrl'] ?? '');
    $file = ais_pg_connection_file($data['key'], $name, $url);
    // Approve only this generator's private directory, without weakening global checks.
    $registry_class = 'Automattic\\WooCommerce\\Internal\\ProductDownloads\\ApprovedDirectories\\Register';
    if (class_exists($registry_class)) wc_get_container()->get($registry_class)->add_approved_directory(dirname($file) . '/', true);
    $product = $id ? wc_get_product($id) : new WC_Product_Simple();
    if (!$product || !$product->is_type('simple')) throw new RuntimeException('Неверный тип ранее созданного товара.');
    $product->set_name($name);
    $product->set_slug($data['slug']);
    $product->set_status('draft');
    $product->set_virtual(true);
    $product->set_downloadable(true);
    $product->set_catalog_visibility('hidden');
    $price = (string) $data['price'];
    $old = (float) ($data['oldPrice'] ?? 0);
    $product->set_regular_price($old > (float) $price ? (string) $old : $price);
    $product->set_sale_price($old > (float) $price ? $price : '');
    $product->set_price($price);
    $product->set_description(wp_kses_post($data['descriptionHtml'] ?? ''));
    $download = new WC_Product_Download();
    $download->set_id(substr($data['key'], 0, 32));
    $download->set_name('Подключение к вебинару — ' . $name);
    $download->set_file($file);
    $product->set_downloads(array($download));
    $product->update_meta_data('_ais_generator_key', $data['key']);
    $product->update_meta_data('_ais_webinar_join_url', $url);
    $product->update_meta_data('_ais_webinar_file', $file);
    $product->update_meta_data('_ais_landing_url', 'https://edu-plus.ru/other_course/' . $data['slug'] . '/');
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
            $fields = array();
            foreach (ais_pg_certificate_slots() as $slot => $_language) $fields[$slot] = get_field($slot, $id, false);
            ais_pg_validate_certificates(array('key' => $data['key'], 'certificateHash' => get_post_meta($id, '_ais_certificate_hash', true), 'fields' => $fields));
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
function ais_pg_dispatch($request) {
    try {
        $action = basename($request->get_route());
        if ($request->get_method() === 'POST') {
            if (strlen($request->get_body()) > ($action === 'certificate-assets' ? 3000000 : 2000000)) return ais_pg_error('Слишком большой запрос.', 413);
            return ais_pg_mutate($action, $request->get_json_params() ?: array());
        }
        if ($action === 'health') return array('ok' => true, 'version' => '1.1.1', 'certificateSamples' => true, 'role' => ais_pg_role(), 'acf' => function_exists('get_field_objects'), 'woocommerce' => class_exists('WC_Product_Simple'));
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
    foreach (array('health', 'templates', 'catalog', 'template/(?P<id>\d+)') as $route) register_rest_route('ais-program-sites/v1', '/' . $route, array('methods' => 'GET', 'permission_callback' => 'ais_pg_permission', 'callback' => 'ais_pg_dispatch'));
    foreach (array('prepare-product', 'prepare-landing', 'certificate-assets', 'validate-publication', 'publish', 'enable-redirect') as $route) register_rest_route('ais-program-sites/v1', '/' . $route, array('methods' => 'POST', 'permission_callback' => 'ais_pg_permission', 'callback' => 'ais_pg_dispatch'));
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
    if (!preg_match('~^https://edu-plus\.ru/other_course/[a-z0-9][a-z0-9_-]{1,79}/$~D', $url)) return;
    foreach (array('utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term') as $param) {
        if (isset($_GET[$param]) && is_string($_GET[$param])) $url = add_query_arg($param, sanitize_text_field(wp_unslash($_GET[$param])), $url);
    }
    wp_redirect($url, 301, 'AIS program');
    exit;
});
