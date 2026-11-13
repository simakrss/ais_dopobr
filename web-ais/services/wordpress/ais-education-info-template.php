<?php
defined('ABSPATH') || exit;
get_header();
?>
<main id="main" class="container education-info-page">
<?php while (have_posts()): the_post(); $sections = zifra_education_info_sections(get_the_content());
if ($sections) {
    foreach (['qualification', 'certificate'] as $key) $sections[$key] = str_replace('необходимо прислать:', 'заполните реквизиты в личном кабинете и прикрепите необходимые сканы:', $sections[$key]);
} ?>
    <header class="education-intro">
        <div class="education-intro-copy">
            <p class="education-eyebrow">УЧЕБНЫЙ ЦЕНТР / ИНФОРМАЦИЯ СЛУШАТЕЛЯМ</p>
            <h1>Оформление<br><span>на обучение</span></h1>
            <p class="education-lead">После оплаты войдите в личный кабинет, заполните реквизиты и загрузите сканы документов. Логин и пароль указаны в письме с данными доступа.</p>
            <a class="education-course-link" href="https://edu-plus.ru/lms/">Открыть личный кабинет <span aria-hidden="true">↗</span></a>
        </div>
        <div class="education-route" aria-label="Порядок оформления">
            <span class="education-route-icon" aria-hidden="true"><?php echo zifra_icon('book'); ?></span>
            <p>Ваш путь к обучению</p>
            <ol><li><span>01</span>Заполните личные данные</li><li><span>02</span>Загрузите сканы документов</li><li><span>03</span>Нажмите «Отправить на проверку»</li></ol>
        </div>
    </header>
    <?php if ($sections): ?>
    <nav class="education-section-nav" aria-label="Форматы обучения">
        <a href="#qualification">Повышение квалификации и переподготовка <span aria-hidden="true">↘</span></a>
        <a href="#certificate">Программы с сертификатом <span aria-hidden="true">↘</span></a>
        <a href="#module">Отдельный модуль <span aria-hidden="true">↘</span></a>
    </nav>
    <div class="education-layout">
        <div class="education-requirements">
            <section id="qualification" class="education-info-card education-primary-card" aria-labelledby="qualification-title">
                <header class="education-card-heading"><span class="education-card-number" aria-hidden="true">01</span><div><p>ДОКУМЕНТЫ ДЛЯ ПОСТУПЛЕНИЯ</p><h2 id="qualification-title">Повышение квалификации <br>и переподготовка</h2></div></header>
                <div class="education-copy"><?php echo zifra_education_info_html($sections['qualification']); ?></div>
            </section>
            <div class="education-other-formats">
                <section id="certificate" class="education-info-card" aria-labelledby="certificate-title">
                    <header class="education-card-heading"><span class="education-card-number" aria-hidden="true">02</span><h2 id="certificate-title">Программы <br>с сертификатом</h2></header>
                    <div class="education-copy"><?php echo zifra_education_info_html($sections['certificate']); ?></div>
                </section>
                <section id="module" class="education-info-card education-module-card" aria-labelledby="module-title">
                    <header class="education-card-heading"><span class="education-card-number" aria-hidden="true">03</span><h2 id="module-title">Отдельный <br>модуль программы</h2></header>
                    <div class="education-copy"><?php echo zifra_education_info_html($sections['module']); ?></div>
                </section>
            </div>
            <details class="education-international">
                <summary><span><?php echo zifra_icon('book'); ?>Документы об образовании из Узбекистана</span><span class="education-details-toggle" aria-hidden="true">+</span></summary>
                <div class="education-copy"><?php echo zifra_education_info_html($sections['international']); ?></div>
            </details>
        </div>
        <aside class="education-contact-column" aria-label="Связь с учебным центром">
            <section class="education-contact-card">
                <span class="education-contact-icon" aria-hidden="true"><?php echo zifra_icon('mail'); ?></span>
                <p class="education-eyebrow">СЛЕДУЮЩИЙ ШАГ</p>
                <h2>Загрузите документы<br>в личном кабинете</h2>
                <div class="education-copy"><ol><li>В разделе <strong>«Основное»</strong> заполните личные и паспортные данные, адрес регистрации, почтовый адрес с индексом и остальные обязательные реквизиты. Сохраните изменения.</li><li>В разделе <strong>«Документы»</strong> прикрепите сканы по перечню для Вашей программы.</li><li>Нажмите <strong>«Отправить на проверку»</strong>. Кнопка станет доступна, когда обязательные поля будут заполнены, а необходимые документы загружены.</li></ol><p>Результат проверки и замечания учебного центра появятся в кабинете. Если потребуется доработка, исправьте данные и отправьте документы повторно.</p></div>
                <a class="education-send-link" href="https://edu-plus.ru/lms/">Открыть личный кабинет <span aria-hidden="true">↗</span></a>
                <p>Если нужна помощь со входом, напишите на <a href="mailto:mail@edu-plus.ru">mail@edu-plus.ru</a>.</p>
            </section>
            <section class="education-person-card">
                <h2>На связи с вами</h2>
                <div class="education-copy"><?php echo zifra_education_info_html($sections['signature']); ?></div>
            </section>
            <section class="education-social-card">
                <h2>Новости учебного центра</h2>
                <p>Присоединяйтесь к нашим группам</p>
                <div class="education-social-links">
                <?php foreach (zifra_education_info_links($sections['social']) as $url):
                    $host = wp_parse_url($url, PHP_URL_HOST);
                    $label = ['bizvmax.ru' => 'MAX', 'vk.com' => 'ВКонтакте', 't.me' => 'Telegram'][$host] ?? $host;
                ?><a href="<?php echo esc_url($url); ?>"><?php echo esc_html($label); ?><span aria-hidden="true">↗</span></a><?php endforeach; ?>
                </div>
            </section>
        </aside>
    </div>
    <?php else: ?><article class="education-info-card education-copy"><?php the_content(); ?></article><?php endif; ?>
<?php endwhile; ?>
</main>
<?php get_footer(); ?>
