import unittest

from server import (
    expand_face_photo_box,
    extract_fields,
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
        обл. Рязанская
        г. Рязань
        ул. Быстрецкая, д. 27, кв. 102
        ОТДЕЛ УФМС РОССИИ ПО РЯЗАНСКОЙ ОБЛАСТИ
        """
        kinds, fields = self.field_map(text, "Паспорт с пропиской.pdf")
        self.assertIn("passport", kinds)
        self.assertEqual(
            fields["registrationAddress"],
            "обл. Рязанская, г. Рязань, ул. Быстрецкая, д. 27, кв. 102",
        )

    def test_contract_addresses_are_not_passport_registration(self):
        text = """
        ДОГОВОР ОБ ОКАЗАНИИ ОБРАЗОВАТЕЛЬНЫХ УСЛУГ
        Паспорт заказчика: серия 61 20 номер 123456
        Адрес места жительства: г. Рязань, ул. Быстрецкая, д. 27, кв. 102
        ИНН/КПП 5506198724/780201001
        Юридический адрес: г. Санкт-Петербург, пр-кт Лесной, д. 1
        """
        _, fields = self.field_map(text, "Заявление и договор.pdf")
        self.assertNotIn("registrationAddress", fields)

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
        КОРОЛЬКОВА
        Имя
        ОЛЬГА
        Отчество
        ВИКТОРОВНА
        Квалификация Бакалавр
        """
        kinds, fields = self.field_map(text, "Диплом об образовании.pdf")
        self.assertEqual(kinds, ["education"])
        self.assertEqual(fields["educationDocumentSurname"], "Королькова")

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
        Дата выдачи паспорта: 10.07.2023
        Код подразделения: 770-101
        MRZ: 4526053601RUSOZ05233F<<<<<<<3230710770101<08
        """
        kinds, fields = self.field_map(text, "Паспорт с пропиской.pdf")
        self.assertIn("passport", kinds)
        self.assertEqual(fields["passportNumber"], "45 23 605360")
        self.assertEqual(fields["passportDate"], "2023-07-10")
        self.assertEqual(fields["birthDate"], "2003-05-23")
        self.assertEqual(fields["passportCode"], "770-101")
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
