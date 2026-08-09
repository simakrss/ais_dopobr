import io
import unittest
import zipfile

from server import (
    decode_text_bytes,
    expand_face_photo_box,
    extract_fields,
    extract_text_document,
    is_valid_inn,
    is_valid_snils,
    photo_box_overlap,
)


class OcrExtractionTests(unittest.TestCase):
    def field_map(self, text, file_name):
        kinds, fields = extract_fields(text, file_name)
        return kinds, {field["key"]: field["value"] for field in fields}

    def test_passport_identity_fields(self):
        text = """
        ПАСПОРТ РОССИЙСКАЯ ФЕДЕРАЦИЯ
        Паспорт выдан ОТДЕЛОМ МВД РОССИИ ПО ТЕСТОВОМУ РАЙОНУ
        Дата выдачи 15.06.2018 Код подразделения 770-001
        Серия 45 18 Номер 123456
        Фамилия ИВАНОВ
        Имя ИВАН
        Отчество ИВАНОВИЧ
        Дата рождения 01.02.1990 Пол мужской
        СНИЛС 112-233-445 95
        ИНН 7707083893
        """
        kinds, fields = self.field_map(text, "Паспорт.png")
        self.assertEqual(kinds, ["passport", "snils", "inn"])
        self.assertEqual(fields["name"], "Иванов Иван Иванович")
        self.assertEqual(fields["passportNumber"], "45 18 123456")
        self.assertEqual(fields["passportCode"], "770-001")
        self.assertEqual(fields["passportDate"], "2018-06-15")
        self.assertEqual(fields["birthDate"], "1990-02-01")
        self.assertEqual(fields["snils"], "112-233-445 95")
        self.assertEqual(fields["inn"], "7707083893")

    def test_passport_registration_address(self):
        text = """
        ПАСПОРТ РОССИЙСКАЯ ФЕДЕРАЦИЯ
        МЕСТО ЖИТЕЛЬСТВА
        ЗАРЕГИСТРИРОВАНА ПО МЕСТУ ЖИТЕЛЬСТВА
        10 декабря 2013 г.
        обл. Тестовая
        г. Тестоград
        ул. Учебная, д. 10, кв. 20
        ОТДЕЛ УФМС РОССИИ ПО ТЕСТОВОЙ ОБЛАСТИ
        """
        kinds, fields = self.field_map(text, "Паспорт с пропиской.pdf")
        self.assertIn("passport", kinds)
        self.assertEqual(
            fields["registrationAddress"],
            "обл. Тестовая, г. Тестоград, ул. Учебная, д. 10, кв. 20",
        )

    def test_contract_addresses_are_not_passport_registration(self):
        text = """
        ДОГОВОР ОБ ОКАЗАНИИ ОБРАЗОВАТЕЛЬНЫХ УСЛУГ
        Паспорт заказчика: серия 61 20 номер 123456
        Адрес места жительства: г. Тестоград, ул. Учебная, д. 10, кв. 20
        ИНН/КПП 7707083893/770201001
        Юридический адрес: г. Тестоград, ул. Примерная, д. 1
        """
        _, fields = self.field_map(text, "Заявление и договор.pdf")
        self.assertNotIn("registrationAddress", fields)

    def test_application_text_layer_fields_are_extracted_without_ocr_artifacts(self):
        text = """
        Заявление поступающего
        Прошу зачислить меня в число слушателей (форма обучения – заочная дистанционная) по
        дополнительной профессиональной программе:
        Разработка конструкторской документации в САПР Компас-3D (300 ч)
        Срок обучения с 01.08.2026 г. по 19.09.2026 г.
        Персональные данные
        Фамилия Иванова
        Имя Анна
        Отчество Сергеевна
        Дата рождения 01.02.1990
        Адрес постоянного места
        жительства (регистрации по
        паспорту)
        Гражданство Российская Федерация
        г. Тестоград, ул. Учебная, д. 10, кв. 20
        Адрес для отправки документов
        (например, фактический адрес места жительства или работы)
        000000, г. Тестоград, ул. Примерная, д. 1
        Мобильный телефон +70000000000
        Адрес электронной почты student@example.org
        СНИЛС 112-233-445 95
        Вид документа Паспорт гражданина РФ
        Серия, номер 45 18 123456
        Дата выдачи: 15.06.2018
        Кем Выдан ОТДЕЛОМ МВД РОССИИ ПО ТЕСТОВОМУ РАЙОНУ
        Место работы(учебы): ТЕСТОВЫЙ УНИВЕРСИТЕТ
        Должность (специальность или
        направление обучения):
        студент магистратуры
        Сведения о предыдущем уровне образования
        Вид документа об образовании Диплом о высшем образовании
        Серия 000000
        Номер документа 0000000
        Дата выдачи: 30.06.2015
        Кем выдан: Тестовый государственный университет
        Я, Иванова Анна Сергеевна, ознакомлен (а)
        Дата подачи заявления: 29.07.2026 г.
        Договор No 001-01/ДО-1
        г. Санкт-Петербург 01.08.2026 г.
        Предмет договора
        """
        kinds, fields = self.field_map(
            text,
            "Заявление+договор_Иванова_Анна_Сергеевна_001-01_ДО-1.pdf",
        )
        self.assertIn("application", kinds)
        self.assertIn("contract", kinds)
        self.assertEqual(fields["name"], "Иванова Анна Сергеевна")
        self.assertEqual(fields["registrationAddress"], "г. Тестоград, ул. Учебная, д. 10, кв. 20")
        self.assertEqual(fields["mailingAddress"], "000000, г. Тестоград, ул. Примерная, д. 1")
        self.assertEqual(fields["phone"], "+70000000000")
        self.assertEqual(fields["email"], "student@example.org")
        self.assertEqual(fields["passportNumber"], "45 18 123456")
        self.assertEqual(fields["position"], "студент магистратуры")
        self.assertEqual(fields["program"], "Разработка конструкторской документации в САПР Компас-3D")
        self.assertEqual(fields["hours"], "300")
        self.assertEqual(fields["educationDocument"], "Диплом о высшем образовании")
        self.assertEqual(fields["educationDocumentSeries"], "000000")
        self.assertEqual(fields["educationDocumentNumber"], "0000000")
        self.assertEqual(fields["educationDocumentDate"], "2015-06-30")
        self.assertEqual(fields["contractNo"], "001-01/ДО-1")
        self.assertNotIn("inn", fields)
        self.assertNotIn("passportCode", fields)
        self.assertNotIn("educationLevel", fields)
        self.assertNotIn("educationSpecialty", fields)

    def test_cp1251_plain_text_is_decoded(self):
        source = "Заявление поступающего\nФамилия Иванова"
        self.assertEqual(decode_text_bytes(source.encode("cp1251")), source)

    def test_docx_text_is_extracted(self):
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w") as archive:
            archive.writestr(
                "word/document.xml",
                "<w:document xmlns:w='urn:test'><w:body><w:p><w:r><w:t>"
                "Заявление поступающего"
                "</w:t></w:r></w:p><w:p><w:r><w:t>Фамилия Иванова"
                "</w:t></w:r></w:p></w:body></w:document>",
            )
        text = extract_text_document(
            buffer.getvalue(),
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        )
        self.assertEqual(text, "Заявление поступающего\nФамилия Иванова")

    def test_education_document_fields(self):
        text = """
        ФЕДЕРАЛЬНОЕ ГОСУДАРСТВЕННОЕ ОБРАЗОВАТЕЛЬНОЕ УЧРЕЖДЕНИЕ
        ТЕСТОВЫЙ ГОСУДАРСТВЕННЫЙ УНИВЕРСИТЕТ
        ДИПЛОМ О ВЫСШЕМ ОБРАЗОВАНИИ
        Настоящий диплом свидетельствует о том, что ПЕТРОВ ПЕТР ПЕТРОВИЧ
        освоил образовательную программу бакалавриата
        по специальности Информационные системы и технологии
        Квалификация Бакалавр
        Серия 107724 Номер 1234567
        Дата выдачи 30.06.2015
        """
        kinds, fields = self.field_map(text, "Диплом.pdf")
        self.assertEqual(kinds, ["education"])
        self.assertEqual(fields["educationDocument"], "Диплом о высшем образовании")
        self.assertEqual(fields["educationLevel"], "Бакалавр")
        self.assertEqual(fields["educationDocumentSeries"], "107724")
        self.assertEqual(fields["educationDocumentNumber"], "1234567")
        self.assertEqual(fields["educationDocumentDate"], "2015-06-30")
        self.assertEqual(fields["educationSpecialty"], "Информационные системы и технологии")
        self.assertEqual(fields["educationQualification"], "Бакалавр")
        self.assertEqual(fields["educationDocumentSurname"], "Петров")

    def test_education_document_surname_after_label(self):
        text = """
        ПРИЛОЖЕНИЕ К ДИПЛОМУ О ВЫСШЕМ ОБРАЗОВАНИИ
        Фамилия
        ИВАНОВА
        Имя
        АННА
        Отчество
        СЕРГЕЕВНА
        Квалификация Бакалавр
        """
        kinds, fields = self.field_map(text, "Диплом об образовании.pdf")
        self.assertEqual(kinds, ["education"])
        self.assertEqual(fields["educationDocumentSurname"], "Иванова")

    def test_education_document_surname_from_full_name_row(self):
        text = """
        ДИПЛОМ О ВЫСШЕМ ОБРАЗОВАНИИ
        Фамилия Имя Отчество
        СИДОРОВА АННА ПАВЛОВНА
        присвоена квалификация Бакалавр
        """
        kinds, fields = self.field_map(text, "Диплом.pdf")
        self.assertEqual(kinds, ["education"])
        self.assertEqual(fields["educationDocumentSurname"], "Сидорова")

    def test_passport_mrz_and_targeted_regions(self):
        text = """
        ПАСПОРТ РОССИЙСКАЯ ФЕДЕРАЦИЯ
        Паспорт выдан: > ry МВД РОССИИ ПО Г. MOCKBE _
        Дата выдачи паспорта: 15.06.2018
        Код подразделения: 770-001
        MRZ: 4511234569RUS9002018M<<<<<<<8<<<<<<<<<<<<
        """
        kinds, fields = self.field_map(text, "Паспорт с пропиской.pdf")
        self.assertIn("passport", kinds)
        self.assertEqual(fields["passportNumber"], "45 18 123456")
        self.assertEqual(fields["passportDate"], "2018-06-15")
        self.assertEqual(fields["birthDate"], "1990-02-01")
        self.assertEqual(fields["passportCode"], "770-001")
        self.assertEqual(fields["passportIssuer"], "ГУ МВД РОССИИ ПО Г. МОСКВЕ")

    def test_control_numbers(self):
        self.assertTrue(is_valid_inn("7707083893"))
        self.assertTrue(is_valid_snils("112-233-445 95"))
        self.assertFalse(is_valid_inn("7707083894"))
        self.assertFalse(is_valid_snils("112-233-445 96"))

    def test_face_photo_box_stays_inside_page(self):
        left, top, width, height = expand_face_photo_box((10, 20, 100, 120), 600, 800)
        self.assertGreater(width, 100)
        self.assertGreater(height, 120)
        self.assertGreaterEqual(left, 0)
        self.assertGreaterEqual(top, 0)
        self.assertLessEqual(left + width, 600)
        self.assertLessEqual(top + height, 800)

    def test_photo_box_overlap_detects_duplicate_crop(self):
        self.assertGreater(photo_box_overlap((10, 10, 100, 140), (15, 15, 95, 135)), 0.8)
        self.assertEqual(photo_box_overlap((0, 0, 50, 50), (100, 100, 50, 50)), 0)


if __name__ == "__main__":
    unittest.main()
