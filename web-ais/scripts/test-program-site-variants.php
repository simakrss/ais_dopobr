<?php
// Reuse the in-memory WordPress/ACF fixtures; no connection to either website.
require __DIR__ . '/test-program-site-sync.php';
$role = 'edu';
$posts[42] = array('ID'=>42,'post_title'=>'Общий лендинг','post_type'=>'courses-pk','post_status'=>'publish','post_name'=>'shared-course','post_modified_gmt'=>'2026-09-24','post_content'=>'Keep existing page','post_excerpt'=>'Keep excerpt');
$base = array('skidka'=>'0','kolichestvo_chasov'=>'72','staraya_cena'=>'','stoimost_kursa'=>'5000','primechanie_ceny'=>'Прежний вариант','ssylka_na_registraciyu'=>'https://zifra-plus.ru/checkout/?add-to-cart=12');
$fields[42] = array('blok_ceny'=>array($base),'slajder'=>array(array('izobrazhenie_slajda'=>100)),
    'stoimost_kursa'=>'5000','kolichestvo_chasov'=>'72','opisanie_dokumenta'=>'Не менять описание',
    'podacha_zayavki_nazvanie_kursa'=>'Не менять название','srok'=>'1 месяц','forma_obucheniya'=>'Заочная',
    'blok_opisaniya_kursa'=>array(array('soderzhimoe_bloka'=>'Отзыв','photo'=>90)),
    'programmy_obucheniya'=>array(array('zagolovok_programmy_obucheniya'=>'Прежний учебный план','ssylka_na_programmu_kursa'=>'old.pdf','nazvanie_knopki_skachat'=>'Скачать','moduli_programmy'=>array())));
foreach (ais_pg_certificate_slots('КПК') as $slot=>$_language) $fields[42][$slot] = 100;
$sample_meta[42] = array();
$key = str_repeat('a',64); $hash = str_repeat('b',64); $certificate_hash = str_repeat('c',64);
$pages = array();
foreach (array('ru','page-2','page-3') as $index=>$language) {
    $id=201+$index; $posts[$id]=array('ID'=>$id,'post_type'=>'attachment'); $sample_mime[$id]='image/jpeg';
    $sample_meta[$id]['_ais_certificate_key']=ais_pg_certificate_key($key,$certificate_hash,$language);
    $pages[]=array('id'=>$id,'language'=>$language);
}
$model = array('type'=>'КПК','name'=>'Новый вариант','productName'=>'Новый товар','price'=>6500,'oldPrice'=>8000,'hours'=>144,
    'duration'=>'2 месяца','studyForm'=>'Очно','trainingPlan'=>array(array('discipline'=>'Новый модуль','content'=>'Новое содержание','totalHours'=>'144','theoryHours'=>'100','practiceHours'=>'44','attestation'=>'Зачёт')));
$data=array('key'=>$key,'hash'=>$hash,'model'=>$model,'landingId'=>42,'version'=>ais_pg_sync_landing(42)['version'],'certificateHash'=>$certificate_hash);
$before=$fields[42]; $before_post=$posts[42]; $write_count=$writes;
ais_pg_variant('check-variant',$data);
check($writes===$write_count,'Variant preview must not write anything');
rejects(function()use($data){ais_pg_variant('check-variant',array_merge($data,array('version'=>'stale')));},'изменился');
$invalid=$data;$invalid['model']['type']='ППП';
rejects(function()use($invalid){ais_pg_variant('check-variant',$invalid);},'соответствующего вида');
$data['certificatePages']=$pages;$data['productId']=99;
$invalid=$data;$invalid['certificatePages'][0]['id']=100;
rejects(function()use($invalid){ais_pg_variant('check-variant',$invalid);},'актуальные образцы');
$invalid=$data;$invalid['productId']=12;
rejects(function()use($invalid){ais_pg_variant('check-variant',$invalid);},'другому варианту');
check($fields[42]===$before,'Rejected variants leave existing offers and documents untouched');
$drop_field='field_slajder';
rejects(function()use($data){ais_pg_variant('attach-variant',$data);},'не подтвердил поле');
$drop_field='';
check($fields[42]===$before && !get_post_meta(42,'_ais_program_variants',true),'A partial ACF failure restores changed price/plan fields before retry');
ais_pg_variant('attach-variant',$data);
check(count($fields[42]['blok_ceny'])===2 && $fields[42]['blok_ceny'][0]===$before['blok_ceny'][0],'Append a distinct price offer, preserving the original');
check($fields[42]['blok_ceny'][1]['ssylka_na_registraciyu']==='https://zifra-plus.ru/checkout/?add-to-cart=99','New offer points to the new shop product');
check($fields[42]['blok_ceny'][1]['primechanie_ceny']==="Скидка до [skidki-pp-pk]\nРассрочка без переплат" && $fields[42]['blok_ceny'][1]['kolichestvo_chasov']==='144','New offer has exactly two default note lines and the new hours');
check($fields[42]['slajder']===array_merge($before['slajder'],array_map(function($page){return array('izobrazhenie_slajda'=>$page['id']);},$pages)),'All new document pages appended after existing images');
check(count($fields[42]['programmy_obucheniya'])===2 && $fields[42]['programmy_obucheniya'][0]===$before['programmy_obucheniya'][0],'Existing training plan is preserved');
check($fields[42]['programmy_obucheniya'][1]['moduli_programmy'][0]['nazvanie_modulya']==='Новый модуль','New plan content is supplied');
foreach($before as $field=>$value) if(!in_array($field,array('blok_ceny','slajder','programmy_obucheniya'),true))check($fields[42][$field]===$value,'Unrelated landing field preserved: '.$field);
check($posts[42]===$before_post,'Title, body, status and permalink are unchanged');
$data['version']=ais_pg_sync_landing(42)['version']; $after=$fields[42];$write_count=$writes;
ais_pg_variant('attach-variant',$data);
check($fields[42]===$after && $writes===$write_count,'Retry of attached variant is a no-op');
check(!$wpdb->locked,'Page lock released');
// Subsequent synchronization is limited to this variant, including sample replacement.
$replacement_hash=str_repeat('d',64);$replacement=array();
foreach($pages as $index=>$page){$id=301+$index;$posts[$id]=array('ID'=>$id,'post_type'=>'attachment');$sample_mime[$id]='image/jpeg';$sample_meta[$id]['_ais_certificate_key']=ais_pg_certificate_key($key,$replacement_hash,$page['language']);$replacement[]=array('id'=>$id,'language'=>$page['language']);}
$sync=array('landingId'=>42,'productId'=>99,'version'=>ais_pg_sync_landing(42)['version'],'model'=>array_merge($model,array('name'=>'Обновлённый вариант','price'=>7000,'updateSamples'=>true,'certificateHash'=>$replacement_hash)),'certificatePages'=>$replacement);
ais_pg_sync_existing($sync);
check($posts[42]['post_title']===$before_post['post_title'] && $fields[42]['srok']===$before['srok'],'Variant sync cannot rename or change the common landing');
check($fields[42]['blok_ceny'][0]===$before['blok_ceny'][0] && $fields[42]['blok_ceny'][1]['stoimost_kursa']==='7000','Variant sync updates only its price');
check($fields[42]['blok_ceny'][1]['primechanie_ceny']===ais_pg_variant_price_note(),'Synchronization preserves default price note instead of replacing it with program name');
check($fields[42]['slajder'][0]===$before['slajder'][0] && count($fields[42]['slajder'])===4,'Variant sample sync retains original gallery images');
check($fields[42]['slajder'][1]['izobrazhenie_slajda']===301 && $fields[42]['izobrazhenie_vydavaemogo_dokumenta']===100,'Only the variant samples are replaced');
echo "PASS: variant preflight, new offer and plan, all sample pages, original data preservation, rollback, retries and scoped sample sync\n";
