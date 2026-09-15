import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import server as s


def word(text, x, y, width=170, height=24):
    return dict(text=text, left=x, top=y, width=width, height=height,
                confidence=95, lineKey=(x, y, 0))


class PassportLayoutTests(unittest.TestCase):
    def fields(self, text):
        return {f['key']: f['value'] for f in s.extract_fields(text, 'passport.pdf')[1]}

    def test_labels_locate_neighbouring_values_at_any_offset_and_scale(self):
        source = [
            word('Паспорт выдан', 80, 90), word('ГУ МВД РОССИИ ПО Г. ТЕСТОВОМУ', 270, 89, 430),
            word('14.08.2020', 170, 180), word('123-456', 630, 180),
            word('Дата выдачи', 80, 210), word('Код подразделения', 460, 210, 200),
            word('Дата рождения', 340, 670), word('10.12.1990', 510, 670),
            word('ЗАРЕГИСТРИРОВАН', 120, 960, 300), word('02.03.2021', 120, 995),
            word('г. Тестовый, ул. Учебная, д.', 120, 1030, 420),
            word('17', 120, 1060, 30), word('кв. 21', 190, 1060, 100),
            word('ОТДЕЛ ПО ВОПРОСАМ МИГРАЦИИ', 120, 1150, 500),
        ]
        for scale, offset in ((1, 0), (2, 730), (0.5, 41)):
            with self.subTest(scale=scale, offset=offset):
                words = [{**item, **{key: round(item[key] * scale + (offset if key in ('left', 'top') else 0))
                                     for key in ('left', 'top', 'width', 'height')}} for item in source]
                fields = self.fields(s.passport_anchor_text(words))
                self.assertEqual(fields['passportDate'], '2020-08-14')
                self.assertEqual(fields['birthDate'], '1990-12-10')
                self.assertEqual(fields['passportCode'], '123-456')
                self.assertEqual(fields['passportIssuer'], 'ГУ МВД РОССИИ ПО Г. ТЕСТОВОМУ')
                self.assertIn('17', fields['registrationAddress'])
                self.assertIn('кв. 21', fields['registrationAddress'])
                self.assertNotIn('МИГРАЦИИ', fields['registrationAddress'])
                self.assertNotIn('2021', fields['registrationAddress'])

    def test_distant_registration_date_is_not_an_issue_date(self):
        text = s.passport_anchor_text([word('Дата выдачи', 100, 100), word('03.04.2022', 100, 2000)])
        self.assertNotIn('Дата выдачи паспорта:', text)
        self.assertNotIn('passportDate', self.fields(text))

    def test_literal_quotes_do_not_consume_tsv_rows(self):
        header = 'level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n'
        rows = [f'5\t1\t1\t1\t1\t{i}\t10\t20\t40\t12\t90\t{text}\n'
                for i, text in enumerate(['"', 'Дата выдачи', '14.08.2020'], 1)]
        self.assertEqual([item['text'] for item in s.parse_tesseract_words(header + ''.join(rows))],
                         ['"', 'Дата выдачи', '14.08.2020'])

    def test_dates_have_valid_calendar_values_and_iso_storage(self):
        for source in ('14. 08. 2020', '14082020', '14-08-2020', '2020-08-14'):
            self.assertEqual(s.normalize_recognized_field_value('passportDate', source)[0], '2020-08-14')
        for key in s.DATE_FIELD_KEYS:
            self.assertEqual(s.normalize_recognized_field_value(key, '29.02.2020')[0], '2020-02-29')
            self.assertEqual(s.normalize_recognized_field_value(key, '31.02.2020')[0], '')

    def test_address_retains_numeric_only_house_line(self):
        address = s.normalize_registration_address(['ЗАРЕГИСТРИРОВАН', '03.04.2022',
            'г. Тестовый, ул. Учебная, д.', '17', 'кв. 21', 'ОТДЕЛ МИГРАЦИИ'])
        self.assertIn('д. 17', address)
        self.assertNotIn('МИГРАЦИИ', address)

    def test_only_visual_cyrillic_glyphs_are_normalized(self):
        self.assertEqual(s.normalize_passport_ocr_text('KOMMYHAPKA'), 'КОММУНАРКА')
        self.assertEqual(s.normalize_passport_ocr_text('PNRUSIVANOVA<<ANNA'), 'PNRUSIVANOVA<<ANNA')

    def test_no_models_means_offline_tesseract_fallback(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(s.os.environ, {'OCR_MODEL_DIR': directory}), \
                patch.object(s, '_neural_ocr_checked', False), patch.object(s, '_neural_ocr', None):
            self.assertIsNone(s.get_neural_ocr())

    @unittest.skipIf(s.cv2 is None, 'OpenCV unavailable')
    def test_detects_photographs_not_fixed_field_regions(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'sheet.png'
            image = s.np.full((1600, 1200, 3), 255, s.np.uint8)
            s.cv2.rectangle(image, (25, 40), (550, 740), (150, 150, 150), -1)
            s.cv2.rectangle(image, (620, 790), (1170, 1560), (160, 160, 160), -1)
            s.cv2.imwrite(str(path), image)
            self.assertEqual(s.passport_photo_regions(path), [(25, 40, 526, 701), (620, 790, 551, 771)])

    @unittest.skipIf(s.cv2 is None, 'OpenCV unavailable')
    def test_all_rotations_are_checked_and_coordinates_return_to_source(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'scan.png'
            s.cv2.imwrite(str(path), s.np.full((600, 800, 3), 255, s.np.uint8))
            correct_words = [word('Дата выдачи', 40, 60), word('14.08.2020', 220, 60),
                             word('Код подразделения', 40, 110, 220), word('123-456', 280, 110)]
            def candidate(target):
                return ('', correct_words) if target.stem.endswith('-90') else ('', [word('шум', 0, 0)])
            with patch.object(s, 'neural_text_with_words', side_effect=candidate) as recognize:
                text, words, rotations = s.recognize_passport_layout(path)
            self.assertEqual(recognize.call_count, 4)
            self.assertEqual(rotations, [90])
            self.assertEqual(self.fields(text)['passportDate'], '2020-08-14')
            self.assertEqual((words[0]['left'], words[0]['top']), (60, 390))


if __name__ == '__main__':
    unittest.main()
