(() => {
  const STORAGE_KEY = "ais-dopobr-web-state-v1";
  const TABLE_SETTINGS_KEY = "ais-dopobr-web-table-settings-v1";
  const STUDENT_CARD_TAB_ORDER_KEY = "ais-dopobr-student-card-tab-order-v1";
  const app = document.getElementById("app");
  const programHourOptions = [1, 2, 4, 16, 36, 72, 144, 300, 600, 1200];
  const studentCommunicationTemplateDefaults = [
    `{Приветствие}

Меня зовут Симак Роман Сергеевич, я представляю учебный центр Цифровизация Плюс.

Получили от Вас заявку на программу *{ПрограммаКарточки}*, для зачисления необходимо прислать следующие документы:
{ПереченьДокументов}

Пришлите, пожалуйста, свои документы на адрес mail@edu-plus.ru, мы в ответ подготовим Вам документы для оформления на обучение (договор, анкета, согласие на обработку персональных данных и т.д.).

Дальнейшую переписку предлагаю вести в Телеграмме https://t.me/simakrs или Максе https://max.ru/u/f9LHodD0cOJFNLoo1J-p9xzwXq9NcNpBiO_awFVbsccTG5PS38I_pQg_iPE{ОпцияБезДокумента}`,
    `{Приветствие}

Меня зовут Симак Роман Сергеевич, я представляю учебный центр Цифровизация Плюс.

Отправили Вам на электронную почту ({EmailКарточки}) комплект документов по курсу *{ПрограммаКарточки}* на подпись для зачисления (письмо могло попасть в спам).

Проверьте его, пожалуйста, если все правильно, подпишите (в местах, выделенных галочкой) и отправьте скан на адрес mail@edu-plus.ru

Подписать можно одним из следующих способов:
1) Через онлайн-сервис - https://www.ilovepdf.com/ru/sign-pdf (графической подписью)
2) С помощью сервиса Госключ (после подписи нажать Скачать подпись и отправить ее в ответном сообщении) - https://www.gosuslugi.ru/600373/1/form
3) От руки

Дальнейшую переписку предлагаю вести в Телеграмме https://t.me/simakrs или Максе https://max.ru/u/f9LHodD0cOJFNLoo1J-p9xzwXq9NcNpBiO_awFVbsccTG5PS38I_pQg_iPE`,
    `{Приветствие}

Поздравляем Вас с завершением обучения по курсу *{ПрограммаКарточки}* и отправляем сюда и на почту ({EmailКарточки}) {ДокументПослеОбучения}{НапоминаниеОбОплате}`,
    `{Приветствие}

{ДокументОбОбразовании}

Большая просьба оставить отзыв о пройденном курсе по следующей ссылке {СсылкаАнкеты}`,
    `{Приветствие}

Отправили Вам документ об образовании на адрес: {АдресОтправкиКарточки}{ТрекКодБлок}

Большая просьба оставить отзыв о пройденном курсе по следующей ссылке {СсылкаАнкеты}`,
    `{Приветствие}

Благодарим за сотрудничество и дарим купон на дополнительную скидку в 15% на последующее обучение: NEXT15

И еще одна просьба, сможете отправить своим коллегам, знакомым, разместить в своих соцсетях следующую рекомендацию по нашим курсам?

Рекомендую учебный центр Цифровизация Плюс (https://edu-plus.ru?utm_source={СсылкаРекомендации})

Повышение квалификации, переподготовка, отличный сервис, качество обучения и оперативность.

Вот купон на дополнительную скидку в 10% на программы повышения квалификации и переподготовки: SALE10`,
    `{Приветствие}

До окончания Вашего обучения по курсу *{ПрограммаКарточки}* остается {ДнейДоОкончанияКарточки} дн.

Чтобы успеть выполнить все до {ДатаОкончанияПрописьюКарточки} рекомендуется активизировать учебный процесс.

Для просмотра текущих оценок по всем дисциплинам/модулям можете воспользоваться следующей ссылкой - {СсылкаПрограммыКарточки}

Вам нужно выполнить задания по всем дисциплинам/модулям и затем пройти итоговую аттестацию до окончания обучения (проходной балл - не менее 50%: оценка <удовлетворительно> от 50% до 69%, оценка <хорошо> от 70% до 89%, оценка <отлично> 90% и выше)

{ИтогПослеОбучения}

С уважением, Симак Роман Сергеевич
Учебный центр Цифровизация Плюс`,
    `{Приветствие}

Вы досрочно освоили образовательную программу {ПрограммаКарточки}.

Предлагаем Вам сократить срок обучения до {ДатаСокращенияКарточки} (с учетом нормативной продолжительности обучения) для более быстрого получения документа об образовании, заключив дополнительное соглашение к договору

На всякий случай, отправили Вам на электронную почту ({EmailКарточки}) комплект документов на подпись для сокращения обучения на курсах до {ДатаСокращенияКарточки} (проверьте его, пожалуйста, если все правильно, подпишите и отправьте скан на адрес mail@edu-plus.ru)`,
    `{Приветствие}

Благодарим Вас за сотрудничество и дарим купон на дополнительную скидку в 15% на последующее обучение: {ПартнерскийКупонКарточки}

Данный купон является бессрочным и действует в рамках нашей партнерской программы (https://forms.gle/ArBUi5SB3sw6JHzt6). Вы получите скидку и кэшбэк за свое последующее обучение, а также дополнительный доход от регистраций по купону других слушателей в соответствии с условиями партнерской программы

И еще одна просьба, сможете отправить своим коллегам, знакомым, разместить в своих соцсетях следующую рекомендацию по нашим курсам?

Рекомендую учебный центр Цифровизация Плюс (https://edu-plus.ru?utm_source={СсылкаРекомендации})

Повышение квалификации, переподготовка, отличный сервис, качество обучения и оперативность.

Вот купон на дополнительную скидку в 15% на программы повышения квалификации и переподготовки: {ПартнерскийКупонКарточки}`,
    `{Приветствие}

Ваш срок обучения по программе {ПрограммаКарточки} подошел к концу - {ДатаОкончанияКарточки}, но программа не освоена в полном объеме.

Предлагаем Вам на выбор два варианта:
1) Бесплатно продлить срок обучения до {ДатаСокращенияКарточки}, заключив дополнительное соглашение к договору (не более 1 раза, затем ПЛАТНО 1000 руб. за каждое последующее продление).
2) Отчислить Вас без выдачи документа об образовании с последующей возможностью бесплатного восстановления (не более 1 раза, затем ПЛАТНО 1000 руб. за каждое последующее восстановление)

На всякий случай, отправили Вам на электронную почту ({EmailКарточки}) комплект документов на подпись для продления обучения на курсах до {ДатаСокращенияКарточки} (проверьте его, пожалуйста, если все правильно, подпишите и отправьте скан на адрес mail@edu-plus.ru)

Платное продление возможно не более двух раз, затем полная оплата курса с заключением нового договора`,
    `{Приветствие}

Ваш срок обучения по программе {ПрограммаКарточки} подошел к концу - {ДатаОкончанияКарточки}, но программа ПОВТОРНО не освоена в полном объеме.

Предлагаем Вам на выбор два варианта:
1) ПЛАТНО продлить срок обучения до {ДатаСокращенияКарточки}, заключив дополнительное соглашение к договору (платно 1000 руб. за каждое продление).
2) Отчислить Вас без выдачи документа об образовании с последующей возможностью ПЛАТНОГО восстановления (платно 1000 руб. за каждое последующее восстановление)

Ссылка на оплату: {СсылкаОплатыПродления}

Платное продление возможно не более двух раз, затем полная оплата курса с заключением нового договора`,
    `{Приветствие}

Отправляем Вам ссылку для участия в мероприятии {ПрограммаКарточки} - {СсылкаПрограммыКарточки}

Отправляем Вам электронный сертификат сюда и на электронную почту ({EmailКарточки}) вместе с записью вебинара

Большая просьба оставить отзыв, можно написать сюда и прикрепить фотографию (или можем взять из Вашего профиля в вацапе) и мы с Вашего разрешения опубликуем его на странице вебинара

Также просим заполнить анкету по адресу {СсылкаАнкеты}

Подписывайтесь на наши группы в Телеграм (https://t.me/zifra_plus) и Вконтакте (https://vk.com/zifra_plus)

С уважением, Симак Роман Сергеевич`,
    `{{если:ЕстьЛогин}}{Приветствие}

Вот Ваши учетные данные для обучения на портале дистанционного обучения Цифровизация Плюс (https://portal.edu-plus.ru):

логин: {ЛогинКарточки}
пароль: {ПарольКарточки}

Программа: {ПрограммаКарточки}
Срок обучения по: {СрокОбученияПоКарточки}

{ТелеграмГруппаБлок}Точка входа на курс: https://portal.edu-plus.ru/my/courses.php
Перед началом работы посмотрите, пожалуйста, вводный видеоурок: https://edu-plus.ru/portal_intro

Вам нужно выполнить задания по всем дисциплинам/модулям (факультативные задания, при наличии, выполняются по желанию) и затем пройти итоговую аттестацию до окончания обучения (проходной балл - не менее 50%: оценка <удовлетворительно> от 50% до 69%, оценка <хорошо> от 70% до 89%, оценка <отлично> 90% и выше){ИтогДоступаКПорталу}

С уважением,
Симак Роман Сергеевич

Учебный центр Цифровизация Плюс
www.edu-plus.ru

{СсылкиСоцсети}{{конец}}`
  ];
  const studentCommunicationTemplateFields = [
    "Приветствие", "ПереченьДокументов", "ОпцияБезДокумента", "ДокументПослеОбучения",
    "НапоминаниеОбОплате", "ДокументОбОбразовании", "ТрекКодБлок", "СсылкаРекомендации",
    "ИтогПослеОбучения", "СсылкаАнкеты", "СсылкаОплаты", "СсылкаОплатыПродления",
    "ТелеграмГруппаБлок", "ИтогДоступаКПорталу", "СертификатПослеОбучения", "СсылкиСоцсети"
  ];
  const studentCommunicationTemplateCardFields = [
    "ФИОКарточки", "ПрограммаКарточки", "EmailКарточки", "АдресОтправкиКарточки",
    "ТрекКодКарточки", "ПартнерскийКупонКарточки", "ДнейДоОкончанияКарточки",
    "ДатаОкончанияКарточки", "ДатаОкончанияПрописьюКарточки", "ДатаСокращенияКарточки",
    "СсылкаПрограммыКарточки", "ЛогинКарточки", "ПарольКарточки",
    "СрокОбученияПоКарточки", "ТелеграмГруппаПрограммыКарточки"
  ];
  const studentCommunicationTemplateEditableFields = [
    ...studentCommunicationTemplateFields,
    ...studentCommunicationTemplateCardFields
  ];
  const studentCommunicationTemplateFieldFormulaDefaults = {
    Приветствие: "{{если:ЕстьИмяОтчество}}Здравствуйте, {ИмяОтчество}!{{иначе}}Здравствуйте!{{конец}}",
    ПереченьДокументов: `{{если:ДПО}}- скан паспорта с пропиской
- СНИЛС (для граждан РФ)
- скан документа о высшем или среднем профессиональном образовании с приложением (скан диплома)
- сведения о месте работы и занимаемой должности (в простой текстовой форме для целей госстатистики, если не указали при подаче заявки)
- документы о перемене ФИО, если данные в дипломе не совпадают с паспортом
- сведения о почтовом адресе фактического места жительства с индексом (для отправки документов)

Данные документы нужны для заключения договора и включения сведений в федеральный государственный реестр документов об образовании (ФРДО) по окончании Вашего обучения{{иначе}}- скан паспорта с пропиской
- сведения о почтовом адресе фактического места жительства с индексом

Данные документы нужны для заключения договора с последующей выдачей документа об образовании{{конец}}`,
    ОпцияБезДокумента: `{{если:ДПО}}{{иначе}}

Вы можете не предоставлять данные документы, в случае отсутствия необходимости получения документа об образовании

Какой вариант Вам подходит, с выдачей документа или без выдачи?{{конец}}`,
    ДокументПослеОбучения: `{{если:ДПО}}для согласования макет документа об образовании (проверьте, пожалуйста, личные данные){{иначе}}электронный документ об образовании

Большая просьба оставить отзыв о пройденном курсе по следующей ссылке {СсылкаАнкеты}{{конец}}`,
    НапоминаниеОбОплате: `{{если:ЕстьОстатокОплаты}}

Также напоминаем, что Вам нужно внести остаток оплаты за обучение {ОстатокОплаты} руб. по следующей ссылке - {СсылкаОплаты}{{конец}}`,
    ДокументОбОбразовании: "{{если:ДПО}}Отправляем Вам скан документа об образовании. Оригинал отправим по адресу: {АдресОтправкиКарточки}{{иначе}}Отправляем Вам электронный документ об образовании{{конец}}",
    ТрекКодБлок: `{{если:ЕстьТрекКод}}

Трек-код: {ТрекКодКарточки}

Для отслеживания почтового отправления рекомендуется установить приложение Почты России - http://play.google.com/store/apps/details?id=com.octopod.russianpost.client.android{{конец}}`,
    СсылкаРекомендации: "{РеферальныйКод}",
    ИтогПослеОбучения: "{{если:ДПО}}После выполнения всех заданий и прохождения итоговой аттестации по окончанию срока обучения направим Вам макет документа об образовании для согласования{{иначе}}После выполнения всех заданий и прохождения итоговой аттестации по окончанию срока обучения направим электронный документ об образовании{{конец}}",
    СсылкаАнкеты: "https://forms.gle/1EcHf4VwVB7rF1e6A",
    СсылкаОплаты: "https://yookassa.ru/my/i/Z85l1c4uVDu_/l",
    СсылкаОплатыПродления: "https://yookassa.ru/my/i/Zqknfk2aqFoq/l",
    ТелеграмГруппаБлок: `{{если:ЕстьТелеграмГруппа}}Вступите, пожалуйста, в группу курса в телеграмме - {ТелеграмГруппаПрограммыКарточки}

{{конец}}`,
    ИтогДоступаКПорталу: `{{если:ДПО}}

После выполнения всех заданий и прохождения итоговой аттестации по окончанию срока обучения направим Вам макет документа об образовании для согласования{{иначе}}{СертификатПослеОбучения}{{конец}}`,
    СертификатПослеОбучения: `{{если:ВыдаватьДокумент}}

После выполнения всех заданий и прохождения итоговой аттестации по окончанию срока обучения направим Вам электронный сертификат{{конец}}`,
    СсылкиСоцсети: `Вступайте в наши группы:
MAX - https://bizvmax.ru/zifra_plus
ВК - https://vk.com/zifra_plus
Телеграмм - https://t.me/zifra_plus`,
    ФИОКарточки: "{ФИОКарточки}",
    ПрограммаКарточки: "{ПрограммаКарточки}",
    EmailКарточки: "{EmailКарточки}",
    АдресОтправкиКарточки: "{АдресОтправкиКарточки}",
    ТрекКодКарточки: "{ТрекКодКарточки}",
    ПартнерскийКупонКарточки: "{ПартнерскийКупонКарточки}",
    ДнейДоОкончанияКарточки: "{ДнейДоОкончанияКарточки}",
    ДатаОкончанияКарточки: "{ДатаОкончанияКарточки}",
    ДатаОкончанияПрописьюКарточки: "{ДатаОкончанияПрописьюКарточки}",
    ДатаСокращенияКарточки: "{ДатаСокращенияКарточки}",
    СсылкаПрограммыКарточки: "{СсылкаПрограммыКарточки}",
    ЛогинКарточки: "{ЛогинКарточки}",
    ПарольКарточки: "{ПарольКарточки}",
    СрокОбученияПоКарточки: "{СрокОбученияПоКарточки}",
    ТелеграмГруппаПрограммыКарточки: "{ТелеграмГруппаПрограммыКарточки}"
  };
  const communicationTemplateFieldAliasMap = {
    ФИО: "ФИОКарточки",
    ФИОИсходное: "ФИОКарточки",
    Программа: "ПрограммаКарточки",
    ПрограммаИсходная: "ПрограммаКарточки",
    Email: "EmailКарточки",
    EmailИсходный: "EmailКарточки",
    АдресОтправки: "АдресОтправкиКарточки",
    АдресОтправкиИсходный: "АдресОтправкиКарточки",
    ТрекКод: "ТрекКодКарточки",
    ТрекКодИсходный: "ТрекКодКарточки",
    ПартнерскийКупон: "ПартнерскийКупонКарточки",
    ПартнерскийКупонИсходный: "ПартнерскийКупонКарточки",
    ДнейДоОкончания: "ДнейДоОкончанияКарточки",
    ДнейДоОкончанияИсходное: "ДнейДоОкончанияКарточки",
    ДатаОкончания: "ДатаОкончанияКарточки",
    ДатаОкончанияИсходная: "ДатаОкончанияКарточки",
    ДатаОкончанияПрописью: "ДатаОкончанияПрописьюКарточки",
    ДатаОкончанияПрописьюИсходная: "ДатаОкончанияПрописьюКарточки",
    ДатаСокращения: "ДатаСокращенияКарточки",
    ДатаСокращенияИсходная: "ДатаСокращенияКарточки",
    СсылкаПрограммы: "СсылкаПрограммыКарточки",
    СсылкаПрограммыИсходная: "СсылкаПрограммыКарточки",
    СсылкаАнкетыИсходная: "СсылкаАнкеты",
    СсылкаОплатыИсходная: "СсылкаОплаты",
    СсылкаОплатыПродленияИсходная: "СсылкаОплатыПродления"
  };
  const dataFormulaTokenDefinitions = [
    { name: "Год1", label: "Последняя цифра года", token: "{Год1}" },
    { name: "Месяц2", label: "Месяц, 2 цифры", token: "{Месяц2}" },
    { name: "День2", label: "Число, 2 цифры", token: "{День2}" },
    { name: "ПорядковыйНомерЗаДату", label: "Порядковый номер за дату", token: "{ПорядковыйНомерЗаДату}" }
  ];
  const dataFormulaDefaults = [
    {
      key: "contractNumber",
      label: "Номер договора",
      dateField: "contractDate",
      targetField: "contractNo",
      template: "{Год1}{Месяц2}-{День2}/ДО-{ПорядковыйНомерЗаДату}"
    },
    {
      key: "enrollmentOrderNumber",
      label: "Номер приказа о зачислении",
      dateField: "enrollmentDate",
      targetField: "enrollmentOrderNo",
      template: "Зач-{Год1}{Месяц2}-{День2}"
    },
    {
      key: "expulsionOrderNumber",
      label: "Номер приказа об отчислении",
      dateField: "expulsionDate",
      targetField: "expulsionOrderNo",
      template: "Отч-{Год1}{Месяц2}-{День2}"
    }
  ];
  const sdoSettingDefaults = [
    {
      key: "portalUrl",
      label: "Адрес портала СДО",
      value: "https://portal.edu-plus.ru"
    },
    {
      key: "uploadUsersUrl",
      label: "Страница загрузки пользователей",
      value: "https://portal.edu-plus.ru/admin/tool/uploaduser/index.php"
    }
  ];
  const defaultPhotoServerOrigin = "http://localhost:8080";
  const financeMetrics = [
    { key: "revenue", label: "Поступления", tone: "income" },
    { key: "direct", label: "Прямые затраты", tone: "direct" },
    { key: "general", label: "Общие затраты", tone: "general" }
  ];
  const dictionaryDefaults = {
    managers: [],
    sources: [],
    fundingSources: ["Собственные средства", "За счет организации", "Федеральный бюджет", "Местный бюджет"],
    citizenships: ["Российская Федерация"],
    documentTypes: ["Паспорт гражданина РФ", "Иностранный паспорт", "Вид на жительство", "Свидетельство о рождении"],
    passportIssuers: [],
    educationLevels: ["СПО", "Бакалавр", "Специалист", "Магистр", "Аттестат"],
    educationDocumentTypes: ["Диплом о начальном профессиональном образовании", "Диплом о среднем профессиональном образовании", "Диплом о высшем образовании"],
    educationDocumentIssuers: [],
    workPlaces: [],
    positions: [],
    employmentCategories: [
      "работники предприятий и организаций",
      "руководители предприятий и организаций",
      "педагогические работники дошкольных образовательных организаций",
      "педагогические работники общеобразовательных организаций",
      "педагогические работники профессиональных образовательных организаций",
      "педагогические работники образовательных организаций высшего образования",
      "педагогические работники организаций дополнительного профессионального образования",
      "педагогические работники организаций дополнительного образования",
      "руководители дошкольных образовательных организаций",
      "руководители общеобразовательных организаций",
      "руководители профессиональных образовательных организаций",
      "руководители образовательных организаций высшего образования",
      "руководители организаций дополнительного профессионального образования",
      "руководители организаций дополнительного образования",
      "специалисты, замещающие государственные должности и должности государственной гражданской службы",
      "руководители, замещающие государственные должности и должности государственной гражданской службы",
      "лица, замещающие муниципальные должности и должности муниципальной службы",
      "лица, уволенные с военной службы",
      "незанятые лица по направлению службы занятости",
      "незанятые лица по направлению службы занятости (безработные)",
      "студенты, обучающиеся по образовательным программам среднего профессионального образования",
      "студенты, обучающиеся по образовательным программам высшего образования"
    ],
    ovzStatuses: ["ОВЗ", "ОВЗ Инвалиды", "Инвалиды"],
    expenseNotes: [],
    discountRules: []
  };
  const discountGroups = [
    {
      title: "ПРОФЕССИОНАЛЬНЫЕ ПРОГРАММЫ",
      items: [
        { rates: [25, 50, 75, 100], title: "По решению директора учебного центра" },
        { rates: [15, 40], title: "Скидка по партнерской программе" },
        { rates: [50], title: "Сотрудники и преподаватели военных учебных заведений" },
        { rates: [15], title: "Выпускники/партнерская программа учебного центра Цифровизация+" },
        { rates: [10, 20, 30], title: "Акция Приведи друга; ФИО рекомендовавших друзей" },
        { rates: [10], title: "Ранняя предоплата (не менее чем за месяц до начала курса)" },
        { rates: [10, 15, 20], title: "Периодическая акция" }
      ]
    },
    {
      title: "ОБЩЕОБРАЗОВАТЕЛЬНЫЕ ПРОГРАММЫ",
      items: [
        { rates: [20], title: "Регистрация на курсы до 1 октября года набора на обучение" },
        { separator: "или" },
        { rates: [10], title: "Регистрация на курсы до 1 декабря года набора на обучение" },
        { rates: [10], title: "Обучение одновременно на двух и более дополнительных общеобразовательных программах" },
        { separator: "или" },
        { rates: [10], title: "Многодетная/неполная семья" },
        { rates: [2, 4, 6, 8, 10], title: "Акция Приведи друга; ФИО рекомендовавших друзей" }
      ]
    }
  ];
  const searchableStudentFields = {
    manager: { dict: "managers", fields: [["students", "manager"], ["programs", "manager"]] },
    source: { dict: "sources", fields: [["students", "source"], ["webinars", "source"]] },
    citizenship: { dict: "citizenships", fields: [["students", "citizenship"]] },
    passportType: { dict: "documentTypes", fields: [["students", "passportType"]] },
    customerPassportType: { dict: "documentTypes", fields: [["students", "customerPassportType"]] },
    workPlace: { dict: "workPlaces", fields: [["students", "workPlace"]] },
    position: { dict: "positions", fields: [["students", "position"]] }
  };

  const navItems = [
    { id: "dashboard", label: "Рабочий стол", icon: '<svg class="nav-svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 19V5"></path><path d="M4 19h16"></path><path d="M7 16l4-4 3 3 5-7"></path><path d="M16 8h3v3"></path></svg>' },
    { id: "students", label: "Слушатели", icon: '<svg class="nav-svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="12" cy="8" r="4"></circle><path d="M5 21a7 7 0 0 1 14 0"></path></svg>' },
    { id: "contracts", label: "Договоры", icon: '<svg class="nav-svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M7 3h7l5 5v13H7z"></path><path d="M14 3v5h5"></path><path d="M10 12h6"></path><path d="M10 16h6"></path></svg>' },
    { id: "programs", label: "Программы", icon: '<svg class="nav-svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M3 9l9-5 9 5-9 5z"></path><path d="M7 11v5c3 2 7 2 10 0v-5"></path><path d="M21 9v6"></path></svg>' },
    { id: "trainingPlans", label: "Учебные планы", icon: '<svg class="nav-svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M8 4h8"></path><path d="M9 3h6v4H9z"></path><path d="M6 5H5v16h14V5h-1"></path><path d="M8 12h8"></path><path d="M8 16h6"></path></svg>' },
    { id: "directExpenses", label: "Прямые затраты", icon: '<svg class="nav-svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M7 3h10v18l-2-1.2-2 1.2-2-1.2-2 1.2-2-1.2z"></path><path d="M10 8h5"></path><path d="M10 12h5"></path><circle cx="8" cy="8" r="0.7"></circle><circle cx="8" cy="12" r="0.7"></circle><path d="M13 16h4"></path><path d="M15 14v4"></path></svg>' },
    { id: "generalExpenses", label: "Общие затраты", icon: '<svg class="nav-svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 8c0-2 3.6-3.5 8-3.5S20 6 20 8s-3.6 3.5-8 3.5S4 10 4 8z"></path><path d="M4 8v4c0 2 3.6 3.5 8 3.5s8-1.5 8-3.5V8"></path><path d="M4 12v4c0 2 3.6 3.5 8 3.5s8-1.5 8-3.5v-4"></path></svg>' },
    { id: "inventory", label: "Запасы", icon: '<svg class="nav-svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 8l8-4 8 4-8 4z"></path><path d="M4 8v8l8 4 8-4V8"></path><path d="M12 12v8"></path><path d="M8 6l8 4"></path></svg>' },
    { id: "settings", label: "Справочники", icon: '<svg class="nav-svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 7h10"></path><path d="M18 7h2"></path><circle cx="16" cy="7" r="2"></circle><path d="M4 17h2"></path><path d="M10 17h10"></path><circle cx="8" cy="17" r="2"></circle></svg>' },
    { id: "admin", label: "Админка", icon: '<svg class="nav-svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 3l7 3v5c0 4.6-2.8 7.9-7 10-4.2-2.1-7-5.4-7-10V6z"></path><circle cx="12" cy="12" r="2.4"></circle><path d="M12 8.2v1.2"></path><path d="M12 14.6v1.2"></path><path d="M15.8 12h-1.2"></path><path d="M9.4 12H8.2"></path><path d="M14.7 9.3l-.9.9"></path><path d="M10.2 13.8l-.9.9"></path><path d="M14.7 14.7l-.9-.9"></path><path d="M10.2 10.2l-.9-.9"></path></svg>' }
  ];

  const configs = {
    students: {
      title: "Слушатели и заявки",
      subtitle: "Лист Excel: База",
      collection: "students",
      accent: "teal",
      fields: [
        field("name", "ФИО", "text", true),
        field("nameEnglish", "ФИО анг."),
        field("noDeclension", "Не склоняется", "checkbox"),
        field("addressByFirstName", "Обращаться по имени", "checkbox"),
        field("status", "Статус", "select", true, "statuses"),
        field("program", "Программа", "text", true),
        field("phone", "Телефон"),
        field("email", "Email", "email"),
        field("source", "Источник"),
        field("group", "Группа"),
        field("contractNo", "Договор"),
        field("contractAmount", "Сумма договора", "number"),
        field("paidAmount", "Внесено", "number"),
        field("balance", "Остаток", "number"),
        field("applicationDate", "Дата заявки", "date"),
        field("startDate", "Начало обучения", "date"),
        field("endDate", "Окончание", "date"),
        field("documentsStatus", "Документы"),
        field("manager", "Ответственный"),
        field("tags", "Теги", "textarea")
      ],
      table: ["name", "status", "program", "applicationDate", "phone", "balance", "endDate", "documentsStatus"]
    },
    contracts: {
      title: "Реестр договоров",
      subtitle: "Лист Excel: Реестр договоров",
      collection: "contracts",
      accent: "blue",
      fields: [
        field("name", "ФИО / контрагент", "text", true),
        field("contractNo", "Номер договора", "text", true),
        field("contractDate", "Дата договора", "date"),
        field("startDate", "Срок с", "date"),
        field("endDate", "Срок по", "date"),
        field("amount", "Сумма", "number"),
        field("paid", "Оплачено", "number"),
        field("balance", "Остаток", "number"),
        field("type", "Вид договора", "select", false, "contractTypes"),
        field("subject", "Предмет", "textarea"),
        field("status", "Статус")
      ],
      table: ["name", "contractNo", "type", "amount", "paid", "balance", "endDate", "status"]
    },
    programs: {
      title: "Реестр программ",
      subtitle: "Лист Excel: Реестр программ",
      collection: "programs",
      accent: "green",
      fields: [
        field("name", "Наименование программы", "text", true),
        field("shortName", "Краткое название"),
        field("status", "Статус", "select", true, "programStatuses"),
        field("price", "Стоимость", "number"),
        field("oldPrice", "Старая цена", "number"),
        field("type", "Тип"),
        field("hours", "Часы", "number"),
        field("duration", "Срок"),
        field("landingCode", "Код лендинга"),
        field("promoSite", "На промо сайте"),
        field("gradeReportUrl", "Ссылка на отчет по оценкам"),
        field("telegramGroup", "Гр. Телеграмм"),
        field("groupIndex", "Индекс группы"),
        field("studyForm", "Форма обучения", "select", false, "studyForms"),
        field("qualification", "Квалификация"),
        field("manager", "Ответственный")
      ],
      table: ["name", "status", "type", "hours", "price", "landingCode", "promoSite", "telegramGroup", "groupIndex"]
    },
    trainingPlans: {
      title: "Учебные планы",
      subtitle: "Лист Excel: Учебные планы",
      collection: "trainingPlans",
      accent: "amber",
      fields: [
        field("code", "Код", "text", true),
        field("programName", "Название программы", "text", true),
        field("discipline", "Дисциплина", "text", true),
        field("totalHours", "Всего часов", "number"),
        field("theoryHours", "Теория", "number"),
        field("practiceHours", "Практика", "number"),
        field("attestation", "Аттестация"),
        field("teacher", "Преподаватель"),
        field("materials", "Материалы"),
        field("content", "Содержание", "textarea")
      ],
      table: ["programName", "code", "discipline", "totalHours", "attestation", "teacher"]
    },
    webinars: {
      title: "Вебинары",
      subtitle: "Лист Excel: Вебинары",
      collection: "webinars",
      accent: "violet",
      fields: [
        field("code", "Код вебинара", "text", true),
        field("requestDate", "Дата заявки"),
        field("name", "ФИО", "text", true),
        field("phone", "Телефон"),
        field("email", "Email", "email"),
        field("city", "Город"),
        field("organization", "Организация"),
        field("position", "Должность"),
        field("source", "Источник"),
        field("payment", "Оплата", "number"),
        field("joinLink", "Ссылка подключения"),
        field("status", "Статус")
      ],
      table: ["code", "requestDate", "name", "email", "source", "payment", "status"]
    },
    directExpenses: {
      title: "Прямые затраты",
      subtitle: "Лист Excel: Прямые затраты",
      collection: "directExpenses",
      accent: "red",
      fields: [
        field("uid", "uid слушателя"),
        field("date", "Дата", "date"),
        field("type", "Вид затрат", "select", true, "expenseTypes"),
        field("amount", "Сумма", "number", true),
        field("note", "Примечание"),
        field("inventoryLink", "Связь с запасами"),
        field("act", "Акт"),
        field("actStatus", "Статус акта"),
        field("recommendation", "Рекомендация")
      ],
      table: ["uid", "date", "type", "amount", "note", "actStatus", "recommendation"]
    },
    generalExpenses: {
      title: "Общие затраты",
      subtitle: "Лист Excel: Общие затраты",
      collection: "generalExpenses",
      accent: "orange",
      fields: [
        field("counterparty", "Контрагент", "text", true),
        field("date", "Дата", "date"),
        field("workType", "Вид работ", "select", true, "expenseTypes"),
        field("description", "Описание"),
        field("amount", "Сумма", "number", true),
        field("paid", "Оплачено"),
        field("accountingClosed", "Закрыто в бухгалтерии"),
        field("bkExpenseNo", "Номер в расходах БК"),
        field("otherExpenses", "Прочие затраты")
      ],
      table: ["counterparty", "date", "workType", "amount", "paid", "accountingClosed"]
    },
    inventory: {
      title: "Запасы",
      subtitle: "Лист Excel: Запасы",
      collection: "inventory",
      accent: "gray",
      fields: [
        field("date", "Дата", "date"),
        field("itemType", "Вид ТМЦ", "select", true, "inventoryTypes"),
        field("amount", "Сумма", "number"),
        field("note", "Примечание"),
        field("uid", "uid"),
        field("balance", "Остаток", "number")
      ],
      table: ["itemType", "balance", "date", "amount", "note", "uid"]
    },
    users: {
      title: "Пользователи",
      subtitle: "Администрирование доступа",
      collection: "users",
      accent: "teal",
      fields: [
        field("name", "ФИО", "text", true),
        field("email", "Email", "email", true),
        field("role", "Роль", "select", true, "roles"),
        field("status", "Статус", "select", true, null, ["Активен", "Заблокирован"]),
        field("lastLogin", "Последний вход")
      ],
      table: ["name", "email", "role", "status", "lastLogin"]
    }
  };

  const studentCommunicationMessages = [
    { key: "note1", source: "Примечание1", label: "Документы для зачисления" },
    { key: "note2", source: "Примечание2", label: "Документы на подпись" },
    { key: "note3", source: "Примечание3", label: "Завершение обучения" },
    { key: "note4", source: "Примечание4", label: "Скан документа" },
    { key: "note5", source: "Примечание5а", label: "Отправка оригинала" },
    { key: "note6", source: "Примечание6", label: "Скидка и рекомендация" },
    { key: "note7", source: "Примечание7", label: "Скорое окончание" },
    { key: "note8", source: "Примечание8", label: "Сокращение срока" },
    { key: "note9", source: "Примечание9", label: "Партнерская программа" },
    { key: "note10", source: "Примечание10", label: "Бесплатное продление" },
    { key: "note11", source: "Примечание11", label: "Платное продление" },
    { key: "note12", source: "Примечание12", label: "Вебинар и сертификат" },
    {
      key: "portalAccessMessage",
      source: "СообщЛогин",
      label: "Доступ к порталу СДО",
      showInCommunications: false,
      importValue: false
    }
  ];
  const studentCommunicationContactFields = [
    field("phone", "Телефон обучающегося"),
    field("email", "Email"),
    field("telegram", "Аккаунт Telegram"),
    field("whatsapp", "WhatsApp"),
    field("messengerUrl", "Адрес мессенджера"),
    field("customer", "Заказчик"),
    field("customerPhone", "Телефон заказчика"),
    field("customerEmail", "Email заказчика")
  ];

  const studentCardTabs = [
    {
      id: "main",
      label: "Основное",
      sections: [
        {
          title: "Обучающийся",
          fields: [
            field("name", "ФИО", "text", true),
            field("nameEnglish", "ФИО анг."),
            field("noDeclension", "Не склоняется", "checkbox"),
            field("addressByFirstName", "Обращаться по имени", "checkbox"),
            field("uid", "uid"),
            field("status", "Статус", "select", true, "statuses"),
            field("program", "Программа", "text", true),
            field("studyForm", "Форма обучения", "select", false, "studyForms"),
            field("educationType", "Вид программы"),
            field("hours", "Кол. часов", "number"),
            field("registrationAddress", "Адрес места регистрации", "textarea"),
            field("mailingAddress", "Адрес с почтовым индексом для отправки документов", "textarea"),
            field("internship", "Стажировка", "checkbox"),
            field("group", "Группа"),
            field("manager", "Ответственный"),
            field("source", "Источник"),
            field("agent", "Агент"),
            field("workPlace", "Место работы"),
            field("position", "Должность"),
            field("employmentCategory", "Категория занятости", "select", false, "employmentCategories"),
            field("ovzStatus", "Статус ОВЗ", "select", false, "ovzStatuses"),
            field("tags", "Теги", "textarea")
          ]
        },
        {
          title: "Сроки обучения",
          fields: [
            field("applicationDate", "Дата подачи заявки", "date"),
            field("startDate", "Дата начала обучения", "date"),
            field("endDate", "Дата окончания обучения", "date"),
            field("extendedEndDate", "Продленная дата окончания", "date")
          ]
        }
      ]
    },
    {
      id: "documents",
      label: "Документы",
      sections: [
        {
          title: "Паспортные данные обучающегося",
          fields: [
            field("birthDate", "Дата рождения", "date"),
            field("citizenship", "Гражданство"),
            field("passportType", "Вид документа"),
            field("passportDate", "Дата выдачи", "date"),
            field("passportNumber", "Серия и номер"),
            field("passportCode", "Код подразд."),
            field("passportIssuer", "Кем выдан", "textarea"),
            field("snils", "СНИЛС"),
            field("inn", "ИНН")
          ]
        },
        {
          title: "Паспортные данные заказчика",
          customerPassport: true,
          fields: [
            field("customer", "ФИО заказчика"),
            field("customerBirthDate", "Дата рождения", "date"),
            field("customerPassportType", "Вид документа"),
            field("customerPassportDate", "Дата выдачи", "date"),
            field("customerPassportNumber", "Серия и номер"),
            field("customerPassportCode", "Код подразд."),
            field("customerPassportIssuer", "Кем выдан", "textarea"),
            field("customerSnils", "СНИЛС"),
            field("customerInn", "ИНН")
          ]
        },
        {
          title: "Документ об образовании слушателя",
          fields: [
            field("educationLevel", "Уровень образования", "select", false, "educationLevels"),
            field("educationDocument", "Документ", "select", false, "educationDocumentTypes"),
            field("educationDocumentSeries", "Серия"),
            field("educationDocumentNumber", "Номер"),
            field("educationDocumentDate", "Дата выдачи", "date"),
            field("educationDocumentIssuer", "Кем выдан", "textarea")
          ]
        }
      ]
    },
    {
      id: "income",
      label: "Финансы",
      payments: true,
      expenses: true,
      sections: [
        {
          title: "Доходы по договору",
          fields: [
            field("fundingSource", "Источник финансирования", "select", false, "fundingSources"),
            field("orderNo", "Номер заказа"),
            field("contractAmount", "Сумма договора", "number"),
            field("discount", "Скидка в %", "number"),
            field("paidAmount", "Внесено по договору", "number"),
            field("balance", "Остаток по договору", "number"),
            field("discountDescription", "Описание скидки")
          ]
        }
      ]
    },
    {
      id: "contract",
      label: "Договор",
      sections: [
        {
          title: "Договор",
          fields: [
            field("contractNo", "Договор"),
            field("contractDate", "Дата договора", "date"),
            field("consentPersonalData", "Согласие ПнД", "checkbox")
          ]
        },
        {
          title: "Финансы договора",
          fields: [
            field("contractAmount", "Сумма по договору", "number"),
            field("monthlyAmount", "Сумма в месяц", "number"),
            field("paidAmount", "Внесено", "number"),
            field("balance", "Остаток", "number"),
            field("discount", "Скидка в %", "number"),
            field("fundingSource", "Источник финансирования", "select", false, "fundingSources")
          ]
        }
      ]
    },
    {
      id: "communications",
      label: "Коммуникации",
      sections: [
        {
          title: "Типовые сообщения",
          messageGrid: true,
          fields: studentCommunicationMessages
            .filter((message) => message.showInCommunications !== false)
            .map((message) => field(message.key, message.label, "textarea"))
        }
      ]
    },
    {
      id: "finance",
      label: "Финансы",
      sections: [
        {
          title: "Расходы по слушателю",
          fields: [
            field("expenseControl", "Контроль для договора"),
            field("expenseTotal", "Расходы итого", "number"),
            field("expenseNotes", "Примечания", "textarea")
          ]
        }
      ],
      payments: true,
      expenses: true,
      linkedExpenses: true
    },
    {
      id: "ordersSdo",
      label: "Приказы, СДО",
      sections: [
        {
          title: "Приказы и СДО",
          fields: [
            field("contractDate", "Дата договора", "date"),
            field("contractNo", "Номер договора"),
            field("startDate", "Дата нач. обуч.", "date"),
            field("endDate", "Дата окон. обуч.", "date"),
            field("extendedEndDate", "Дата окон. изм.", "date"),
            field("enrollmentDate", "Дата зачислен.", "date"),
            field("enrollmentOrderNo", "Номер приказа"),
            field("expulsionDate", "Дата отчислен.", "date"),
            field("expulsionOrderNo", "Номер приказа"),
            field("group", "Номер группы"),
            field("login", "Логин"),
            field("password", "Пароль"),
            field("portalAccessMessage", "Сообщение о доступе к порталу обучения", "textarea")
          ]
        }
      ]
    },
    {
      id: "orders",
      label: "Приказы",
      sections: [
        {
          title: "Зачисление и отчисление",
          fields: [
            field("enrollmentOrderNo", "№ приказа о зачислении"),
            field("enrollmentOrderDate", "Дата приказа о зачислении", "date"),
            field("expulsionOrderNo", "№ приказа об отчислении"),
            field("expulsionOrderDate", "Дата приказа об отчислении", "date"),
            field("orderNotes", "Примечания по приказам", "textarea")
          ]
        },
        {
          title: "Протоколы и ФРДО",
          fields: [
            field("protocolNo", "Номер протокола"),
            field("protocolDate", "Дата протокола", "date"),
            field("frdoStatus", "Выгрузка ФРДО"),
            field("frdoDate", "Дата выгрузки ФРДО", "date")
          ]
        }
      ]
    },
    {
      id: "lms",
      label: "СДО",
      sections: [
        {
          title: "Доступ к порталу",
          fields: [
            field("login", "Логин"),
            field("password", "Пароль"),
            field("portalAccess", "Доступ к порталу"),
            field("lmsCourse", "Курс в СДО"),
            field("lmsProgress", "Прогресс, %", "number"),
            field("lmsLastLogin", "Последний вход"),
            field("portalNotes", "Примечания", "textarea")
          ]
        }
      ]
    },
    {
      id: "results",
      label: "Итоги",
      sections: [
        {
          title: "Аттестация",
          fields: [
            field("finalWorkTopic", "Тема ИАР", "textarea"),
            field("finalGrade", "Оценка ИА"),
            field("qualification", "Квалификация"),
            field("chairman", "Председатель"),
            field("commissionMember1", "Член комиссии 1"),
            field("commissionMember2", "Член комиссии 2"),
            field("secretary", "Секретарь")
          ]
        },
        {
          title: "Документ об образовании",
          fields: [
            field("diplomaBlankNo", "Номер бланка"),
            field("registrationNo", "Рег. номер"),
            field("diplomaIssueDate", "Дата выдачи", "date"),
            field("deliveryDate", "Дата доставки", "date"),
            field("postalTrack", "Трек-код")
          ]
        }
      ]
    },
    {
      id: "review",
      label: "Отзыв",
      sections: [
        {
          title: "Отзыв слушателя",
          fields: [
            field("review", "Текст отзыва", "textarea"),
            field("reviewDate", "Дата отзыва", "date"),
            field("reviewPublished", "Отзыв размещен"),
            field("reviewLink", "Ссылка на отзыв"),
            field("reviewPermission", "Согласие на публикацию"),
            field("reviewNotes", "Примечания", "textarea")
          ]
        }
      ]
    }
  ];

  const studentEventTemplates = [
    { key: "docsListNotice", label: "Уведомление с перечнем документов" },
    { key: "sourceDocsReceived", label: "Получен пакет исходных документов" },
    { key: "contractDocsSent", label: "Отправлен пакет готовых документов для подписи" },
    { key: "portalAccountCreated", label: "Создана/обновлена учетная запись на портале" },
    { key: "enrollmentOrderPrepared", label: "Сформирован приказ на зачисление" },
    { key: "signedDocsReceived", label: "Получен подписанный пакет документов" },
    { key: "portalCredentialsSent", label: "Отправлены данные для доступа к порталу" },
    { key: "expulsionOrderPrepared", label: "Сформирован приказ об отчислении" },
    { key: "educationDocMaketSent", label: "Отправлен макет документа об образовании на согласование" },
    { key: "educationDocMaketApproved", label: "Макет документа об образовании согласован" },
    { key: "educationDocOriginalSent", label: "Отправлен оригинал документа об образовании" },
    { key: "reviewRequested", label: "Запрошен отзыв о прохождении обучения" },
    { key: "reviewReceived", label: "Получен отзыв о прохождении обучения" },
    { key: "recommendationRequested", label: "Запрошена рекомендация учебного центра" },
    { key: "partnerInviteSent", label: "Отправлено приглашение в партнерскую программу" },
    { key: "examSheetPrepared", label: "Сформирована зачетно-экзаменационная ведомость" },
    { key: "personalCasePrinted", label: "Распечатано личное дело" },
    { key: "extensionDocsSent", label: "Отправлен комплект документов для продления обучения" },
    { key: "extensionDocsReceived", label: "Получен комплект документов для продления обучения" },
    { key: "reductionDocsSent", label: "Отправлен комплект документов для сокращения обучения" },
    { key: "reductionDocsReceived", label: "Получен комплект документов для сокращения обучения" },
    { key: "certificateSent", label: "Отправлена справка об обучении" }
  ];

  const studentCardDefaultTabIds = ["main", "documents", "income", "communications", "ordersSdo"];
  const visibleStudentCardTabs = studentCardDefaultTabIds
    .map((id) => studentCardTabs.find((tab) => tab.id === id))
    .filter(Boolean);
  const studentCardFields = studentCardTabs.flatMap((tab) => tab.sections.flatMap((section) => section.fields));
  const studentSideFields = [
    field("note", "Примечание", "textarea"),
    field("eventOrder", "Порядок событий"),
    field("eventDeleted", "Удаленные события"),
    field("eventCustomKeys", "Пользовательские события")
  ];
  const studentEventFields = studentEventTemplates.flatMap((event) => [
    field(`event_${event.key}_state`, event.label),
    field(`event_${event.key}_date`, `${event.label}: дата`, "date"),
    field(`event_${event.key}_label`, `${event.label}: название`)
  ]);
  const paymentFields = Array.from({ length: 8 }, (_, index) => [
    field(`payment${index + 1}Date`, `Дата ${index + 1}`, "date"),
    field(`payment${index + 1}Amount`, `Оплата ${index + 1}`, "number"),
    field(`payment${index + 1}Note`, `Комментарий ${index + 1}`)
  ]).flat();
  const expenseFields = Array.from({ length: 6 }, (_, index) => [
    field(`expense${index + 1}Date`, `Дата ${index + 1}`, "date"),
    field(`expense${index + 1}Type`, `Вид затрат ${index + 1}`, "select", false, "expenseTypes"),
    field(`expense${index + 1}Amount`, `Сумма ${index + 1}`, "number"),
    field(`expense${index + 1}IsPaid`, `Оплачено ${index + 1}`, "checkbox"),
    field(`expense${index + 1}Note`, `Примечание ${index + 1}`)
  ]).flat();
  const studentAllFields = [
    field("photoData", "Фото"),
    field("photoPath", "Путь фото"),
    field("photoUrl", "URL фото"),
    ...studentSideFields,
    ...studentEventFields,
    ...studentCommunicationContactFields,
    ...studentCardFields,
    ...paymentFields,
    ...expenseFields
  ];

  let state = {
    view: "dashboard",
    search: "",
    statusFilter: "Все",
    sort: { key: "", dir: "asc" },
    studentCardTab: "main",
    studentCardTabOrder: loadStudentCardTabOrder(),
    discountPickerOpen: false,
    discountPicker: null,
    openPaymentRows: [],
    openExpenseRows: [],
    selected: {},
    tableOptions: null,
    tableSettings: loadTableSettings(),
    dictionarySearch: "",
    selectedDictionary: "",
    dictionaryAddFocus: "",
    communicationTemplateFieldSort: "asc",
    financeChart: { revenue: true, direct: true, general: true },
    modal: null,
    data: loadState()
  };
  let sidebarOutsideClickBound = false;
  let fieldUndoKeyBound = false;
  let lastDeletedControlState = null;
  let draggedStudentTabId = "";
  let lastStudentTabDragEndedAt = 0;
  const communicationTemplateEditorHistories = new WeakMap();

  const transliterationPairs = [
    ["А", "A"], ["Б", "B"], ["В", "V"], ["Г", "G"], ["Д", "D"], ["Е", "E"], ["Ё", "Yo"], ["Ж", "Zh"],
    ["З", "Z"], ["И", "I"], ["Й", "Y"], ["К", "K"], ["Л", "L"], ["М", "M"], ["Н", "N"], ["О", "O"],
    ["П", "P"], ["Р", "R"], ["С", "S"], ["Т", "T"], ["У", "U"], ["Ф", "F"], ["Х", "Kh"], ["Ц", "Ts"],
    ["Ч", "Ch"], ["Ш", "Sh"], ["Щ", "Shch"], ["Ъ", ""], ["Ы", "Y"], ["Ь", ""], ["Э", "E"], ["Ю", "Yu"],
    ["Я", "Ya"]
  ];
  const transliterationMap = transliterationPairs.reduce((map, [cyrillic, latin]) => {
    map[cyrillic] = latin;
    map[cyrillic.toLowerCase()] = latin.toLowerCase();
    return map;
  }, {});

  function field(key, label, type = "text", required = false, dict = null, options = null) {
    return { key, label, type, required, dict, options };
  }

  function transliterateStudentName(value) {
    return String(value || "")
      .trim()
      .replace(/[А-Яа-яЁё]/g, (char) => transliterationMap[char] ?? char)
      .replace(/\s+/g, " ");
  }

  function autoFillStudentGender(name) {
    const gender = inferStudentGender(name);
    const genderInput = document.querySelector("[name='gender']");
    if (!gender || !genderInput) return;
    genderInput.value = gender;
    genderInput.dispatchEvent(new Event("input", { bubbles: true }));
    genderInput.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function inferStudentGender(name) {
    const words = String(name || "").trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return "";
    if (words.some((word) => /(?:вна|ична)$/.test(word) || word.endsWith("кызы"))) return "Женский";
    if (words.some((word) => /(?:вич|ич)$/.test(word) || word.endsWith("оглы"))) return "Мужской";
    const [surname = "", firstName = words[0]] = words;
    if (/(?:ова|ева|ёва|ина|ая|яя|ская|цкая)$/.test(surname)) return "Женский";
    if (/(?:ов|ев|ёв|ин|ый|ий|ский|цкий)$/.test(surname)) return "Мужской";
    if (/(?:а|я)$/.test(firstName) && !/(?:илья|никита|кузьма|фома|лука|савва|добрыня)$/.test(firstName)) return "Женский";
    if (/(?:н|р|й|м|л|д|т|с|в|п|г|к)$/.test(firstName)) return "Мужской";
    return "";
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function loadState() {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed && parsed.collections) {
          const normalized = ensureDataShape(parsed);
          localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
          return normalized;
        }
      } catch (error) {
        console.warn("Не удалось прочитать сохраненное состояние", error);
      }
    }
    return ensureDataShape(clone(window.AIS_SEED));
  }

  function ensureDataShape(data) {
    data.dictionaries = data.dictionaries || {};
    const hasDiscountRules = Array.isArray(data.dictionaries.discountRules);
    const legacyMoodlePortalUrl = Array.isArray(data.dictionaries.moodlePortalUrls)
      ? data.dictionaries.moodlePortalUrls.find((value) => String(value || "").trim())
      : "";
    Object.entries(dictionaryDefaults).forEach(([key, values]) => {
      data.dictionaries[key] = unique([...(data.dictionaries[key] || []), ...values]);
    });
    if (!hasDiscountRules) data.dictionaries.discountRules = getDefaultDiscountRuleValues();
    data.dictionaries.communicationTemplates = normalizeCommunicationTemplates(data.dictionaries.communicationTemplates);
    data.dictionaries.communicationTemplateDescriptions = normalizeCommunicationTemplateDescriptions(
      data.dictionaries.communicationTemplateDescriptions
    );
    data.dictionaries.communicationTemplateFieldOverrides = normalizeCommunicationTemplateFieldOverrides(
      data.dictionaries.communicationTemplateFieldOverrides
    );
    data.dictionaries.communicationTemplateCustomFields = normalizeCommunicationTemplateCustomFields(
      data.dictionaries.communicationTemplateCustomFields
    );
    data.dictionaries.dataFormulas = normalizeDataFormulaTemplates(data.dictionaries.dataFormulas);
    data.dictionaries.sdoSettings = normalizeSdoSettings(data.dictionaries.sdoSettings, legacyMoodlePortalUrl);
    delete data.dictionaries.moodlePortalUrls;
    data.collections = data.collections || {};
    data.collections.programs = mergeProgramRegistry(data)
      .map((program) => normalizeProgramRecord(program));
    data.collections.students = (data.collections.students || []).map((student) => normalizeStudentRecord(student));
    return data;
  }

  function normalizeSdoSettings(values, legacyPortalUrl = "") {
    const saved = Array.isArray(values) ? values : [];
    return sdoSettingDefaults.map((setting) => {
      const savedSetting = saved.find((item) => item?.key === setting.key);
      const legacyValue = setting.key === "portalUrl" ? legacyPortalUrl : "";
      return {
        ...setting,
        value: String(savedSetting?.value || legacyValue || setting.value)
      };
    });
  }

  function getSdoSettingValue(key) {
    return normalizeSdoSettings(state.data.dictionaries.sdoSettings)
      .find((setting) => setting.key === key)?.value || "";
  }

  function mergeProgramRegistry(data) {
    const currentPrograms = Array.isArray(data.collections.programs) ? data.collections.programs : [];
    const registry = Array.isArray(window.AIS_PROGRAM_REGISTRY) ? window.AIS_PROGRAM_REGISTRY : [];
    const version = String(window.AIS_PROGRAM_REGISTRY_VERSION || "");
    data.meta = data.meta && typeof data.meta === "object" ? data.meta : {};
    if (!registry.length || (version && data.meta.programRegistryVersion === version)) return currentPrograms;

    const existingByName = new Map();
    currentPrograms.forEach((program) => {
      const key = normalizeProgramName(program?.name);
      if (!key) return;
      if (!existingByName.has(key)) existingByName.set(key, []);
      existingByName.get(key).push(program);
    });

    const importedPrograms = registry.map((program) => {
      const matches = existingByName.get(normalizeProgramName(program.name)) || [];
      const existing = matches.shift();
      return {
        ...(existing || {}),
        ...clone(program),
        id: existing?.id || program.id
      };
    });
    const customPrograms = Array.from(existingByName.values()).flat();
    data.meta.programRegistryVersion = version;
    return [...importedPrograms, ...customPrograms];
  }

  function normalizeProgramName(value) {
    return String(value || "").trim().toLowerCase();
  }

  function findProgramInRows(programs, name) {
    const normalized = normalizeProgramName(name);
    if (!normalized) return null;
    return programs.find((program) => normalizeProgramName(program.name) === normalized)
      || programs.find((program) => normalizeProgramName(program.shortName) === normalized)
      || null;
  }

  function buildStudentGroupNumber(programName, startDate, programs = []) {
    const program = findProgramInRows(programs, programName);
    const groupIndex = String(program?.groupIndex || "").trim().replace(/-+$/, "");
    const dateMatch = /^(\d{4})-(\d{2})/.exec(String(startDate || "").trim());
    if (!groupIndex || !dateMatch) return "";
    return `${groupIndex}-${dateMatch[1].slice(-1)}${dateMatch[2]}`;
  }

  function normalizeDataFormulaTemplates(values) {
    const saved = Array.isArray(values) ? values : [];
    return dataFormulaDefaults.map((formula) => {
      const savedFormula = saved.find((item) => item?.key === formula.key);
      return {
        ...formula,
        template: String(savedFormula?.template ?? formula.template)
      };
    });
  }

  function normalizeCommunicationTemplates(values) {
    const saved = Array.isArray(values) ? values : [];
    return studentCommunicationTemplateDefaults.map((template, index) => (
      replaceCommunicationTemplateFieldAliases(String(saved[index] ?? template))
    ));
  }

  function normalizeCommunicationTemplateDescriptions(values) {
    const saved = Array.isArray(values) ? values : [];
    return studentCommunicationMessages.map((message, index) => String(saved[index] ?? message.label));
  }

  function normalizeCommunicationTemplateFieldOverrides(values) {
    if (!values || typeof values !== "object" || Array.isArray(values)) return {};
    return Object.fromEntries(Object.entries(values)
      .map(([name, formula]) => [
        getCommunicationTemplateFieldAlias(normalizeCommunicationTemplateFieldName(name)),
        replaceCommunicationTemplateFieldAliases(String(formula ?? ""))
      ])
      .filter(([name]) => name));
  }

  function normalizeCommunicationTemplateCustomFields(values) {
    if (!Array.isArray(values)) return [];
    const builtInNames = new Set(studentCommunicationTemplateEditableFields);
    const seen = new Set();
    return values.reduce((result, field) => {
      const name = normalizeCommunicationTemplateFieldName(field?.name);
      if (!name || builtInNames.has(name) || seen.has(name)) return result;
      const formula = replaceCommunicationTemplateFieldAliases(String(field?.formula ?? ""));
      result.push({
        name,
        formula,
        initialFormula: replaceCommunicationTemplateFieldAliases(String(field?.initialFormula ?? formula))
      });
      seen.add(name);
      return result;
    }, []);
  }

  function normalizeCommunicationTemplateFieldName(value) {
    return String(value || "").replace(/[{}]/g, "").trim();
  }

  function getCommunicationTemplateFieldAlias(name) {
    return communicationTemplateFieldAliasMap[name] || name;
  }

  function replaceCommunicationTemplateFieldAliases(value) {
    return String(value || "").replace(/\{([^{}]+)\}/g, (match, fieldName) => {
      const alias = getCommunicationTemplateFieldAlias(fieldName.trim());
      return alias ? `{${alias}}` : match;
    });
  }

  function getCommunicationTemplateFieldDefinitions() {
    const overrides = normalizeCommunicationTemplateFieldOverrides(
      state.data.dictionaries.communicationTemplateFieldOverrides
    );
    const builtIns = studentCommunicationTemplateEditableFields.map((name) => ({
      name,
      formula: Object.prototype.hasOwnProperty.call(overrides, name)
        ? overrides[name]
        : studentCommunicationTemplateFieldFormulaDefaults[name] || `{${name}}`,
      initialFormula: studentCommunicationTemplateFieldFormulaDefaults[name] || `{${name}}`,
      custom: false
    }));
    const customFields = normalizeCommunicationTemplateCustomFields(
      state.data.dictionaries.communicationTemplateCustomFields
    ).map((field) => ({
      ...field,
      formula: Object.prototype.hasOwnProperty.call(overrides, field.name) ? overrides[field.name] : field.formula,
      custom: true
    }));
    return [...builtIns, ...customFields];
  }

  function sortCommunicationTemplateFieldDefinitions(fields, order = "asc") {
    const direction = order === "desc" ? -1 : 1;
    return [...fields].sort((a, b) => (
      direction * String(a.name || "").localeCompare(String(b.name || ""), "ru", {
        numeric: true,
        sensitivity: "base"
      })
    ));
  }

  function normalizeStudentRecord(student) {
    if (!student || typeof student !== "object") return student;
    const normalized = { ...student };
    studentCommunicationMessages.forEach((message, index) => {
      if (message.importValue === false) return;
      if (String(normalized[message.key] || "").trim()) return;
      const number = index + 1;
      const importedValue = [
        student[message.source],
        student[`Примечание${number}`],
        student[`Примечание ${number}`]
      ].find((value) => String(value || "").trim());
      if (importedValue !== undefined) normalized[message.key] = importedValue;
    });
    return normalized;
  }

  function normalizeProgramRecord(program) {
    if (!program || typeof program !== "object") return program;
    const promoSite = [
      program.promoSite,
      program["На промо сайте"],
      program["Промосайт"],
      program["Промо сайт"],
      program.promoUrl,
      program.promoWebsite,
      program.landingUrl,
      program.siteUrl
    ].find((value) => String(value || "").trim());
    const gradeReportUrl = [
      program.gradeReportUrl,
      program["Ссылка на отчет по оценкам"],
      program.reportUrl,
      program.gradeUrl
    ].find((value) => String(value || "").trim());
    const telegramGroup = [
      program.telegramGroup,
      program["Гр. Телеграмм"],
      program["ГрТелегр"],
      program["Группа Телеграмм"],
      program.telegramUrl,
      program.telegram
    ].find((value) => String(value || "").trim());
    return {
      ...program,
      ...(promoSite ? { promoSite } : {}),
      ...(gradeReportUrl ? { gradeReportUrl } : {}),
      ...(telegramGroup ? { telegramGroup } : {})
    };
  }

  function persist() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.data));
  }

  function loadTableSettings() {
    const saved = localStorage.getItem(TABLE_SETTINGS_KEY);
    if (!saved) return {};
    try {
      const parsed = JSON.parse(saved);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (error) {
      console.warn("Не удалось прочитать настройки таблиц", error);
      return {};
    }
  }

  function persistTableSettings() {
    localStorage.setItem(TABLE_SETTINGS_KEY, JSON.stringify(state.tableSettings));
  }

  function loadStudentCardTabOrder() {
    const saved = localStorage.getItem(STUDENT_CARD_TAB_ORDER_KEY);
    if (!saved) return [];
    try {
      const parsed = JSON.parse(saved);
      return Array.isArray(parsed) ? parsed.filter((id) => typeof id === "string") : [];
    } catch (error) {
      console.warn("Не удалось прочитать порядок вкладок карточки слушателя", error);
      return [];
    }
  }

  function persistStudentCardTabOrder(order = state.studentCardTabOrder) {
    localStorage.setItem(STUDENT_CARD_TAB_ORDER_KEY, JSON.stringify(order));
  }

  function getOrderedStudentCardTabs() {
    const availableIds = visibleStudentCardTabs.map((tab) => tab.id);
    const orderedIds = [
      ...(state.studentCardTabOrder || []).filter((id) => availableIds.includes(id)),
      ...availableIds.filter((id) => !(state.studentCardTabOrder || []).includes(id))
    ];
    return orderedIds
      .map((id) => visibleStudentCardTabs.find((tab) => tab.id === id))
      .filter(Boolean);
  }

  function money(value) {
    const num = Number(value || 0);
    return new Intl.NumberFormat("ru-RU", { style: "currency", currency: "RUB", maximumFractionDigits: 0 }).format(num);
  }

  function dateRu(value) {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat("ru-RU").format(date);
  }

  function valueForDisplay(key, value) {
    if (value === undefined || value === null || value === "") return "—";
    if (["amount", "price", "oldPrice", "paid", "balance", "contractAmount", "paidAmount"].includes(key) && !Number.isNaN(Number(value))) return money(value);
    if (key.toLowerCase().includes("date") || key === "paid") return dateRu(value);
    return String(value);
  }

  function render() {
    hideCommunicationTemplateFieldMenu();
    document.querySelector("[data-communication-template-field-dialog]")?.remove();
    const current = navItems.find((item) => item.id === state.view) || navItems[0];
    app.innerHTML = `
      <aside class="sidebar">
        <div class="brand">
          <div class="brand-mark">АИС</div>
          <div>
            <strong>Допобразование</strong>
            <span>${escapeHtml(state.data.meta.organization)}</span>
          </div>
          <button class="sidebar-close" data-action="collapse-sidebar" type="button" title="Закрыть панель">×</button>
        </div>
        <nav class="nav-list">
          ${navItems.map((item) => `
            <button class="nav-item ${state.view === item.id ? "active" : ""}" data-view="${item.id}" type="button">
              <span class="nav-icon">${item.icon}</span>
              <span>${item.label}</span>
            </button>
          `).join("")}
        </nav>
      </aside>
      <main class="main">
        <header class="topbar">
          <button class="sidebar-toggle" data-action="toggle-sidebar" type="button" title="Меню">☰</button>
          <div>
            <p class="eyebrow">Учебный центр</p>
            <h1>${current.label}</h1>
          </div>
          <div class="top-actions">
            <span class="source-pill">${escapeHtml(state.data.meta.sourceWorkbook)}</span>
            <button class="ghost-button" data-action="export-json" type="button">Экспорт</button>
          </div>
        </header>
        <section class="content">
          ${renderView()}
        </section>
      </main>
      ${state.modal ? renderModal() : ""}
    `;
    bindEvents();
    restoreDictionaryAddFocus();
  }

  function renderView() {
    if (state.view === "dashboard") return renderDashboard();
    if (state.view === "settings") return renderSettings();
    if (state.view === "admin") return renderAdmin();
    const config = configs[state.view];
    if (!config) {
      state.view = "dashboard";
      return renderDashboard();
    }
    return renderCollection(config);
  }

  function renderDashboard() {
    const students = state.data.collections.students;
    const programs = state.data.collections.programs;
    const contracts = state.data.collections.contracts;
    const direct = sumBy(state.data.collections.directExpenses, "amount");
    const general = sumBy(state.data.collections.generalExpenses, "amount");
    const revenue = sumBy(students, "paidAmount");
    const financeSeries = buildFinanceSeries();
    const receivable = sumBy(students, "balance");
    const activeStudents = students.filter((item) => ["Учится", "На зачисление", "В работе"].includes(item.status)).length;
    const statusCounts = countBy(students, "status");
    const maxStatus = Math.max(...Object.values(statusCounts), 1);
    const dueSoon = students
      .filter((item) => item.endDate)
      .sort((a, b) => new Date(a.endDate) - new Date(b.endDate))
      .slice(0, 5);

    return `
      <div class="dashboard-grid">
        ${metric("Активные слушатели", activeStudents, "Из листа «База»", "teal")}
        ${metric("Программы", programs.length, "Реестр программ", "green")}
        ${metric("Договоры", contracts.length, "Действующие записи", "blue")}
        ${metric("Дебиторка", money(receivable), "Остаток к оплате", "red")}
      </div>

      <div class="split-layout">
        <section class="panel">
          <div class="panel-head">
            <div>
              <p class="eyebrow">Заявки и обучение</p>
              <h2>Статусы слушателей</h2>
            </div>
            <button class="icon-button" data-view-shortcut="students" type="button" title="Открыть слушателей">↗</button>
          </div>
          <div class="bar-list">
            ${Object.entries(statusCounts).map(([label, count]) => `
              <div class="bar-row">
                <span>${escapeHtml(label)}</span>
                <div class="bar-track"><i style="width:${Math.max(8, (count / maxStatus) * 100)}%"></i></div>
                <strong>${count}</strong>
              </div>
            `).join("")}
          </div>
        </section>

        <section class="panel">
          <div class="panel-head">
            <div>
              <p class="eyebrow">Финансы</p>
              <h2>Поступления и затраты</h2>
            </div>
            <button class="icon-button" data-view-shortcut="directExpenses" type="button" title="Открыть затраты">↗</button>
          </div>
          <div class="finance-summary">
            <div><span>Внесено слушателями</span><strong>${money(revenue)}</strong></div>
            <div><span>Прямые затраты</span><strong>${money(direct)}</strong></div>
            <div><span>Общие затраты</span><strong>${money(general)}</strong></div>
            <div><span>Маржинальный остаток</span><strong>${money(revenue - direct - general)}</strong></div>
          </div>
          ${renderFinanceChart(financeSeries)}
        </section>
      </div>

      <section class="panel">
        <div class="panel-head">
          <div>
            <p class="eyebrow">Контроль сроков</p>
            <h2>Ближайшие окончания обучения</h2>
          </div>
        </div>
        ${miniTable(dueSoon, ["name", "program", "endDate", "balance"])}
      </section>
    `;
  }

  function metric(label, value, hint, tone) {
    return `
      <section class="metric ${tone}">
        <span>${label}</span>
        <strong>${value}</strong>
        <small>${hint}</small>
      </section>
    `;
  }

  function renderFinanceChart(series) {
    if (!series.length) return `<div class="empty-state compact"><span>Нет данных для графика</span></div>`;
    const activeMetrics = getActiveFinanceMetrics();
    const sortedSeries = sortFinanceSeries(series, activeMetrics);
    const maxValue = Math.max(...sortedSeries.flatMap((item) => activeMetrics.map((metric) => item[metric.key])), 1);
    return `
      <div class="finance-chart">
        <div class="finance-chart-filters" aria-label="Фильтр показателей графика">
          ${financeMetrics.map((metric) => `
            <button class="chart-filter ${state.financeChart[metric.key] ? "active" : ""}" data-action="toggle-finance-metric" data-metric="${metric.key}" type="button" aria-pressed="${state.financeChart[metric.key] ? "true" : "false"}">
              <i class="${metric.tone}"></i>${escapeHtml(metric.label)}
            </button>
          `).join("")}
        </div>
        ${activeMetrics.length ? `
          <div class="finance-bars">
            ${sortedSeries.map((item) => `
            <div class="finance-month">
              <div class="finance-bars-group" style="grid-template-columns: repeat(${activeMetrics.length}, 1fr)">
                ${activeMetrics.map((metric) => financeBar(metric.tone, item[metric.key], maxValue, metric.label)).join("")}
              </div>
              <small>${escapeHtml(item.label)}</small>
            </div>
            `).join("")}
          </div>
        ` : `<div class="empty-state compact"><span>Выберите хотя бы один показатель</span></div>`}
      </div>
    `;
  }

  function getActiveFinanceMetrics() {
    return financeMetrics.filter((metric) => state.financeChart[metric.key]);
  }

  function sortFinanceSeries(series, activeMetrics = getActiveFinanceMetrics()) {
    return series
      .slice()
      .sort((a, b) => financeMetricTotal(b, activeMetrics) - financeMetricTotal(a, activeMetrics) || b.key.localeCompare(a.key))
      .slice(0, 12);
  }

  function financeMetricTotal(item, activeMetrics) {
    return activeMetrics.reduce((sum, metric) => sum + Number(item[metric.key] || 0), 0);
  }

  function financeBar(kind, value, maxValue, label) {
    const amount = Number(value || 0);
    const height = amount > 0 ? Math.max(4, (amount / maxValue) * 100) : 0;
    return `<span class="finance-bar ${kind}" style="height:${height}%" title="${escapeAttr(`${label}: ${money(amount)}`)}"></span>`;
  }

  function renderCollection(config) {
    const rows = getVisibleRows(config);
    const statuses = getFilterOptions(config);
    return `
      <section class="panel">
        <div class="section-head">
          <div>
            <p class="eyebrow">${config.subtitle}</p>
            <h2>${config.title}</h2>
          </div>
          <div class="toolbar">
            <label class="search-box">
              <span>⌕</span>
              <input id="searchInput" value="${escapeAttr(state.search)}" placeholder="Поиск" autocomplete="off">
            </label>
            ${statuses.length ? `
              <select id="statusFilter" class="select-control">
                ${["Все", ...statuses].map((item) => `<option ${state.statusFilter === item ? "selected" : ""}>${escapeHtml(item)}</option>`).join("")}
              </select>
            ` : ""}
            <button class="ghost-button" data-action="export-csv" data-config="${state.view}" type="button">CSV</button>
            <button class="primary-button" data-action="create" data-config="${state.view}" type="button">Добавить</button>
          </div>
        </div>
        ${renderBulkToolbar(config, rows, state.view)}
        ${renderTable(config, rows, state.view)}
      </section>
    `;
  }

  function renderBulkToolbar(config, rows, configId) {
    const selected = getSelected(configId);
    const selectedRows = getRowsByIds(config.collection, selected);
    const statusField = config.fields.find((item) => item.key === "status");
    const statusOptions = statusField ? (statusField.options || state.data.dictionaries[statusField.dict] || getFilterOptions(config)) : [];
    return `
      <div class="bulk-toolbar ${selected.length ? "active" : ""}">
        <span>Выбрано: <strong>${selected.length}</strong></span>
        ${statusOptions.length ? `
          <select id="bulkStatusSelect" class="select-control" ${selected.length ? "" : "disabled"}>
            ${statusOptions.map((item) => `<option>${escapeHtml(item)}</option>`).join("")}
          </select>
          <button class="ghost-button" data-action="bulk-status" data-config="${configId}" type="button" ${selected.length ? "" : "disabled"}>Сменить статус</button>
        ` : ""}
        <button class="ghost-button" data-action="bulk-clear" data-config="${configId}" type="button" ${selected.length ? "" : "disabled"}>Снять выбор</button>
        <button class="ghost-button icon-only csv-button" data-action="bulk-export" data-config="${configId}" type="button" title="Экспорт выбранных в CSV" aria-label="Экспорт выбранных в CSV" ${selectedRows.length ? "" : "disabled"}>
          <svg class="csv-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M7 3h7l4 4v14H7z"></path>
            <path d="M14 3v5h5"></path>
            <path d="M12 17V9"></path>
            <path d="M8.5 12.5L12 9l3.5 3.5"></path>
            <path d="M9 18h6"></path>
          </svg>
        </button>
        <button class="danger-button icon-only trash-button" data-action="bulk-delete" data-config="${configId}" type="button" title="Удалить выбранные" aria-label="Удалить выбранные" ${selected.length ? "" : "disabled"}>
          <svg class="trash-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M3 6h18"></path>
            <path d="M8 6V4h8v2"></path>
            <path d="M6 6l1 15h10l1-15"></path>
            <path d="M10 11v6"></path>
            <path d="M14 11v6"></path>
          </svg>
        </button>
        <button class="ghost-button icon-only table-options-button" data-action="toggle-table-options" data-config="${configId}" type="button" title="Опции таблицы" aria-label="Опции таблицы">⋯</button>
      </div>
      ${renderTableOptions(configId)}
    `;
  }

  function getVisibleRows(config) {
    const query = state.search.trim().toLowerCase();
    const rows = state.data.collections[config.collection] || [];
    let filtered = rows.filter((row) => {
      const matchQuery = !query || Object.values(row).some((value) => String(value || "").toLowerCase().includes(query));
      const matchStatus = state.statusFilter === "Все" || row.status === state.statusFilter || row.type === state.statusFilter || row.workType === state.statusFilter || row.itemType === state.statusFilter;
      return matchQuery && matchStatus;
    });
    if (state.sort.key) {
      const dir = state.sort.dir === "asc" ? 1 : -1;
      filtered = filtered.slice().sort((a, b) => String(a[state.sort.key] || "").localeCompare(String(b[state.sort.key] || ""), "ru") * dir);
    }
    return filtered;
  }

  function getFilterOptions(config) {
    const rows = state.data.collections[config.collection] || [];
    const keys = ["status", "type", "workType", "itemType"];
    const key = keys.find((item) => rows.some((row) => row[item]));
    if (!key) return [];
    return unique(rows.map((row) => row[key]).filter(Boolean));
  }

  function renderTable(config, rows, configId = state.view) {
    const fields = getTableFields(config, configId);
    const selected = getSelected(configId);
    const allVisibleSelected = rows.length > 0 && rows.every((row) => selected.includes(row.id));
    if (!rows.length) {
      return `
        <div class="empty-state"><strong>Записей нет</strong><span>Измените фильтр или добавьте новую запись.</span></div>
      `;
    }
    return `
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th class="select-col">
                <input type="checkbox" data-action="toggle-all-selection" data-config="${configId}" ${allVisibleSelected ? "checked" : ""} aria-label="Выбрать все строки">
              </th>
              ${fields.map((fieldItem) => `
                <th class="table-column-head" ${columnDataAttrs(configId, fieldItem.key)} ${columnStyleAttr(configId, fieldItem.key)} draggable="true" title="Перетащите заголовок для смены порядка">
                  <div class="table-head-cell">
                    <button data-action="sort" data-key="${fieldItem.key}" type="button">
                      ${escapeHtml(fieldItem.label)}
                      ${state.sort.key === fieldItem.key ? (state.sort.dir === "asc" ? "↑" : "↓") : ""}
                    </button>
                    <span class="column-resize-handle" data-action="resize-column" data-config="${configId}" data-field="${escapeAttr(fieldItem.key)}" title="Изменить ширину"></span>
                  </div>
                </th>
              `).join("")}
            </tr>
          </thead>
          <tbody>
            ${rows.map((row) => `
              <tr>
                <td class="select-col">
                  <input type="checkbox" data-action="toggle-row-selection" data-config="${configId}" data-id="${row.id}" ${selected.includes(row.id) ? "checked" : ""} aria-label="Выбрать строку">
                </td>
                ${fields.map((fieldItem, index) => {
                  const value = escapeHtml(valueForDisplay(fieldItem.key, row[fieldItem.key]) || "Открыть");
                  const style = columnStyleAttr(configId, fieldItem.key);
                  const attrs = columnDataAttrs(configId, fieldItem.key);
                  if (index === 0) {
                    return `
                      <td class="table-primary-col" ${attrs} ${style}>
                        <button class="table-edit-link" data-action="edit" data-config="${configId}" data-id="${row.id}" type="button">${value}</button>
                      </td>
                    `;
                  }
                  return `<td ${attrs} ${style}>${value}</td>`;
                }).join("")}
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    `;
  }

  function renderTableOptions(configId) {
    const isOpen = state.tableOptions === configId;
    return `
      ${isOpen ? `
        <div class="table-options-backdrop" data-action="close-table-options"></div>
        <div class="table-options-panel" role="dialog" aria-label="Опции таблицы">
          <div class="table-options-head">
            <strong>Опции таблицы</strong>
            <button class="icon-button" data-action="close-table-options" type="button" title="Закрыть">×</button>
          </div>
          <button class="ghost-button table-option-command" data-action="refresh-table-data" data-config="${configId}" type="button">Обновить данные</button>
          <button class="ghost-button table-option-command" data-action="reset-table-options" data-config="${configId}" type="button">Восстановить исходный вид</button>
        </div>
      ` : ""}
    `;
  }

  function getTableFields(config, configId) {
    return getTableKeys(config, configId).map((key) => config.fields.find((item) => item.key === key) || { key, label: key });
  }

  function getTableKeys(config, configId) {
    const baseKeys = config.table || [];
    const settings = state.tableSettings[configId] || {};
    const savedOrder = Array.isArray(settings.order) ? settings.order : [];
    return [
      ...savedOrder.filter((key) => baseKeys.includes(key)),
      ...baseKeys.filter((key) => !savedOrder.includes(key))
    ];
  }

  function getColumnWidth(configId, key) {
    return state.tableSettings[configId]?.widths?.[key] || "";
  }

  function columnStyleAttr(configId, key) {
    const width = Number(getColumnWidth(configId, key));
    if (!width) return "";
    const safeWidth = clamp(width, 80, 640);
    return `style="width:${safeWidth}px;min-width:${safeWidth}px"`;
  }

  function columnDataAttrs(configId, key) {
    return `data-table-config="${escapeAttr(configId)}" data-column-key="${escapeAttr(key)}"`;
  }

  function updateTableSettings(configId, updater) {
    const current = state.tableSettings[configId] || {};
    state.tableSettings[configId] = updater({
      order: Array.isArray(current.order) ? [...current.order] : [],
      widths: { ...(current.widths || {}) }
    });
    persistTableSettings();
  }

  function moveTableColumn(configId, fieldKey, dir) {
    const config = configs[configId];
    if (!config) return;
    const order = getTableKeys(config, configId);
    const from = order.indexOf(fieldKey);
    const to = from + Number(dir);
    if (from < 0 || to < 0 || to >= order.length) return;
    [order[from], order[to]] = [order[to], order[from]];
    updateTableSettings(configId, (settings) => ({ ...settings, order }));
    render();
  }

  function setTableColumnWidth(configId, fieldKey, value) {
    updateTableSettings(configId, (settings) => {
      const raw = String(value || "").trim();
      if (!raw) {
        delete settings.widths[fieldKey];
      } else {
        settings.widths[fieldKey] = clamp(Number(raw) || 0, 80, 640);
      }
      return settings;
    });
  }

  function reorderTableColumn(configId, fromKey, toKey) {
    const config = configs[configId];
    if (!config || !fromKey || !toKey || fromKey === toKey) return;
    const order = getTableKeys(config, configId);
    const from = order.indexOf(fromKey);
    const to = order.indexOf(toKey);
    if (from < 0 || to < 0) return;
    [order[from], order[to]] = [order[to], order[from]];
    updateTableSettings(configId, (settings) => ({ ...settings, order }));
    render();
  }

  function resetTableOptions(configId) {
    delete state.tableSettings[configId];
    state.tableOptions = null;
    persistTableSettings();
    render();
  }

  function refreshTableData(configId) {
    state.data = loadState();
    state.selected[configId] = [];
    state.tableOptions = null;
    render();
  }

  function bindTableColumnEvents() {
    document.querySelectorAll(".table-column-head").forEach((header) => {
      header.addEventListener("dragstart", (event) => {
        if (event.target.closest(".column-resize-handle")) {
          event.preventDefault();
          return;
        }
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", JSON.stringify({
          configId: header.dataset.tableConfig,
          fieldKey: header.dataset.columnKey
        }));
        header.classList.add("is-dragging");
      });
      header.addEventListener("dragend", () => {
        document.querySelectorAll(".table-column-head").forEach((item) => item.classList.remove("is-dragging", "is-drop-target"));
      });
      header.addEventListener("dragover", (event) => {
        event.preventDefault();
        header.classList.add("is-drop-target");
      });
      header.addEventListener("dragleave", () => {
        header.classList.remove("is-drop-target");
      });
      header.addEventListener("drop", (event) => {
        event.preventDefault();
        header.classList.remove("is-drop-target");
        const source = parseDragPayload(event.dataTransfer.getData("text/plain"));
        if (!source || source.configId !== header.dataset.tableConfig) return;
        reorderTableColumn(source.configId, source.fieldKey, header.dataset.columnKey);
      });
    });

    document.querySelectorAll("[data-action='resize-column']").forEach((handle) => {
      handle.addEventListener("mousedown", startColumnResize);
      handle.addEventListener("dragstart", (event) => event.preventDefault());
      handle.addEventListener("click", (event) => event.stopPropagation());
    });
  }

  function parseDragPayload(value) {
    try {
      const parsed = JSON.parse(value);
      return parsed && parsed.configId && parsed.fieldKey ? parsed : null;
    } catch (error) {
      return null;
    }
  }

  function startColumnResize(event) {
    event.preventDefault();
    event.stopPropagation();
    const handle = event.currentTarget;
    const header = handle.closest("th");
    const configId = handle.dataset.config;
    const fieldKey = handle.dataset.field;
    if (!header || !configId || !fieldKey) return;
    const startWidth = header.getBoundingClientRect().width || Number(getColumnWidth(configId, fieldKey)) || 160;
    const resizeState = {
      configId,
      fieldKey,
      startX: event.clientX,
      startWidth,
      currentWidth: startWidth
    };
    document.body.classList.add("is-resizing-column");
    const onMove = (moveEvent) => {
      resizeState.currentWidth = clamp(Math.round(resizeState.startWidth + moveEvent.clientX - resizeState.startX), 80, 640);
      applyColumnWidthToDom(resizeState.configId, resizeState.fieldKey, resizeState.currentWidth);
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.body.classList.remove("is-resizing-column");
      setTableColumnWidth(resizeState.configId, resizeState.fieldKey, resizeState.currentWidth);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp, { once: true });
  }

  function applyColumnWidthToDom(configId, fieldKey, width) {
    document.querySelectorAll("[data-table-config][data-column-key]").forEach((cell) => {
      if (cell.dataset.tableConfig !== configId || cell.dataset.columnKey !== fieldKey) return;
      cell.style.width = `${width}px`;
      cell.style.minWidth = `${width}px`;
    });
  }

  function getSelected(configId) {
    return state.selected[configId] || [];
  }

  function setSelected(configId, ids) {
    state.selected[configId] = unique(ids.filter(Boolean));
  }

  function getRowsByIds(collection, ids) {
    const set = new Set(ids);
    return (state.data.collections[collection] || []).filter((row) => set.has(row.id));
  }

  function toggleRowSelection(configId, id, checked) {
    const selected = new Set(getSelected(configId));
    if (checked) selected.add(id);
    else selected.delete(id);
    setSelected(configId, Array.from(selected));
    render();
  }

  function toggleAllSelection(configId, checked) {
    const config = configs[configId];
    const visibleIds = getVisibleRows(config).map((row) => row.id);
    const selected = new Set(getSelected(configId));
    visibleIds.forEach((id) => {
      if (checked) selected.add(id);
      else selected.delete(id);
    });
    setSelected(configId, Array.from(selected));
    render();
  }

  function renderSettings() {
    const dictionaries = state.data.dictionaries;
    const dictionaryItems = Object.keys(dictionaries)
      .filter((key) => ![
        "communicationTemplateDescriptions",
        "communicationTemplateFieldOverrides",
        "communicationTemplateCustomFields"
      ].includes(key))
      .map((key) => ({ key, title: dictionaryTitle(key), values: dictionaries[key] || [] }))
      .sort((a, b) => a.title.localeCompare(b.title, "ru"));
    const query = state.dictionarySearch.trim().toLowerCase();
    const visibleItems = dictionaryItems.filter((item) => (
      !query ||
      item.title.toLowerCase().includes(query) ||
      item.values.some((value) => (
        typeof value === "object"
          ? `${value?.label || ""} ${value?.template || ""} ${value?.value || ""}`.toLowerCase().includes(query)
          : String(value || "").toLowerCase().includes(query)
      ))
    ));
    const selectedKey = visibleItems.some((item) => item.key === state.selectedDictionary)
      ? state.selectedDictionary
      : visibleItems[0]?.key || dictionaryItems[0]?.key || "";
    if (state.selectedDictionary !== selectedKey) state.selectedDictionary = selectedKey;
    const selectedItem = dictionaryItems.find((item) => item.key === selectedKey);
    const selectedValues = selectedItem?.values || [];
    const isCommunicationTemplates = selectedKey === "communicationTemplates";
    const isDataFormulas = selectedKey === "dataFormulas";
    const isSdoSettings = selectedKey === "sdoSettings";
    const isSpecialDictionary = isCommunicationTemplates || isDataFormulas || isSdoSettings;
    const communicationTemplateFieldSortOrder = state.communicationTemplateFieldSort === "desc" ? "desc" : "asc";
    return `
      <section class="panel">
        <div class="section-head">
          <div>
            <p class="eyebrow">Настройки</p>
            <h2>Справочники системы</h2>
          </div>
        </div>
        <div class="dictionary-browser">
          <aside class="dictionary-list-panel">
            <label class="search-box dictionary-search">
              <span>⌕</span>
              <input id="dictionarySearch" value="${escapeAttr(state.dictionarySearch)}" placeholder="Поиск справочника" autocomplete="off">
            </label>
            <div class="dictionary-list" role="listbox" aria-label="Справочники">
              ${visibleItems.length ? visibleItems.map((item) => `
                <button class="dictionary-list-item ${item.key === selectedKey ? "active" : ""}" data-action="select-dictionary" data-dict="${item.key}" type="button" role="option" aria-selected="${item.key === selectedKey ? "true" : "false"}">
                  <span>${escapeHtml(item.title)}</span>
                  <small>${item.values.length}</small>
                </button>
              `).join("") : `<div class="empty-state compact"><span>Справочники не найдены</span></div>`}
            </div>
          </aside>
          <section class="dictionary-detail ${isSpecialDictionary ? "is-communication-templates" : ""}">
            ${selectedItem ? `
              <div class="dictionary-detail-head">
                <div>
                  <p class="eyebrow">Содержание справочника</p>
                  <h3>${escapeHtml(selectedItem.title)}</h3>
                </div>
                <div class="dictionary-detail-actions">
                  ${isCommunicationTemplates ? `
                    <button class="icon-button communication-template-field-sort-button ${communicationTemplateFieldSortOrder === "asc" ? "active" : ""}" data-action="sort-communication-template-fields" data-order="asc" type="button" title="Сортировать поля по алфавиту" aria-label="Сортировать поля по алфавиту" aria-pressed="${communicationTemplateFieldSortOrder === "asc" ? "true" : "false"}">А→Я</button>
                    <button class="icon-button communication-template-field-sort-button ${communicationTemplateFieldSortOrder === "desc" ? "active" : ""}" data-action="sort-communication-template-fields" data-order="desc" type="button" title="Сортировать поля против алфавита" aria-label="Сортировать поля против алфавита" aria-pressed="${communicationTemplateFieldSortOrder === "desc" ? "true" : "false"}">Я→А</button>
                  ` : isDataFormulas || isSdoSettings ? "" : `
                    <button class="icon-button dictionary-sort-button" data-action="dict-sort" data-dict="${selectedKey}" data-order="asc" type="button" title="Сортировать по алфавиту" aria-label="Сортировать по алфавиту">А→Я</button>
                    <button class="icon-button dictionary-sort-button" data-action="dict-sort" data-dict="${selectedKey}" data-order="desc" type="button" title="Сортировать против алфавита" aria-label="Сортировать против алфавита">Я→А</button>
                  `}
                  ${isSpecialDictionary ? "" : `
                    <button class="icon-button dictionary-copy-button" data-action="dict-copy-all" data-dict="${selectedKey}" type="button" title="Скопировать все значения" aria-label="Скопировать все значения">
                      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="8" y="8" width="11" height="11" rx="2"></rect><path d="M5 15V5h10"></path></svg>
                    </button>
                    <button class="icon-button dictionary-clear-button" data-action="dict-clear" data-dict="${selectedKey}" type="button" title="Очистить справочник" aria-label="Очистить справочник">
                      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M3 6h18"></path><path d="M8 6V4h8v2"></path><path d="M6 6l1 15h10l1-15"></path><path d="M10 11v6"></path><path d="M14 11v6"></path></svg>
                    </button>
                  `}
                  ${selectedKey === "discountRules" ? `
                    <button class="icon-button dictionary-restore-button" data-action="restore-default-discount-rules" type="button" title="Восстановить исходный перечень скидок" aria-label="Восстановить исходный перечень скидок">
                      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M3 12a9 9 0 1 0 3-6.7"></path><path d="M3 4v6h6"></path><path d="M12 8v5l3 2"></path></svg>
                    </button>
                  ` : ""}
                  <span>${selectedValues.length}</span>
                </div>
              </div>
              ${isCommunicationTemplates
                ? renderCommunicationTemplateDictionary(selectedValues)
                : isDataFormulas
                  ? renderDataFormulaDictionary(selectedValues)
                  : isSdoSettings
                    ? renderSdoSettingsDictionary(selectedValues)
                  : `
                <form class="inline-form dictionary-add-form" data-action="dict-add" data-dict="${selectedKey}">
                  <input name="value" placeholder="Новое значение или список из буфера обмена" autocomplete="off" data-dictionary-add-input>
                  <button class="ghost-button" type="submit">Добавить</button>
                </form>
                ${selectedKey === "discountRules" ? `
                  <p class="dictionary-format-hint">Формат скидок: <code># Название группы</code>, <code>25,50; Описание скидки</code>, <code>или</code>.</p>
                ` : ""}
                <div class="chips dictionary-detail-values" data-dictionary-values data-dict="${selectedKey}">
                  ${selectedValues.length ? selectedValues.map((value) => `
                    <span class="chip dictionary-value-chip" draggable="true" data-dict="${selectedKey}" data-value="${escapeAttr(value)}" title="Перетащите, чтобы изменить порядок">
                      ${escapeHtml(value)}
                      <button data-action="dict-remove" data-dict="${selectedKey}" data-value="${escapeAttr(value)}" type="button">×</button>
                    </span>
                  `).join("") : `<span class="lookup-empty">Значений пока нет</span>`}
                </div>
              `}
            ` : `<div class="empty-state"><span>Выберите справочник</span></div>`}
          </section>
        </div>
      </section>
    `;
  }

  function renderSdoSettingsDictionary(values) {
    const settings = normalizeSdoSettings(values);
    return `
      <form class="sdo-settings-form" data-action="save-sdo-settings">
        <div class="sdo-settings-fields">
          ${settings.map((setting) => `
            <label>
              <span>${escapeHtml(setting.label)}</span>
              <input
                name="${escapeAttr(setting.key)}"
                type="url"
                value="${escapeAttr(setting.value)}"
                placeholder="https://"
                autocomplete="off"
                required
              >
            </label>
          `).join("")}
        </div>
        <p class="sdo-settings-hint">Эти адреса используются для входа в портал и перехода к загрузке пользователей после формирования CSV.</p>
        <div class="sdo-settings-actions">
          <button class="ghost-button" data-action="reset-sdo-settings" type="button">Восстановить исходные</button>
          <button class="primary-button" type="submit">Сохранить настройки</button>
        </div>
      </form>
    `;
  }

  function renderCommunicationTemplateDictionary(values) {
    const templates = normalizeCommunicationTemplates(values);
    const descriptions = normalizeCommunicationTemplateDescriptions(
      state.data.dictionaries.communicationTemplateDescriptions
    );
    const fieldSortOrder = state.communicationTemplateFieldSort === "desc" ? "desc" : "asc";
    const templateFields = sortCommunicationTemplateFieldDefinitions(
      getCommunicationTemplateFieldDefinitions(),
      fieldSortOrder
    );
    return `
      <form class="communication-template-form" data-action="save-communication-templates">
        <div class="communication-template-fields">
          <div class="communication-template-fields-head">
            <strong>Доступные поля</strong>
            <button class="communication-template-field-add" data-action="add-communication-template-field" type="button" title="Добавить поле" aria-label="Добавить поле">+</button>
          </div>
          <div class="communication-template-field-list">${templateFields.map((field) => {
            return renderCommunicationTemplateFieldToken(field, "Перетащите поле в текст сообщения. Нажмите правой кнопкой мыши для настройки");
          }).join("")}</div>
        </div>
        <div class="communication-template-list">
          ${studentCommunicationMessages.map((message, index) => `
            <section class="communication-template-item">
              <label class="communication-template-item-head">
                <strong>Сообщение ${index + 1}</strong>
                <input name="description${index}" value="${escapeAttr(descriptions[index])}" placeholder="Краткое описание" />
              </label>
              <div
                class="communication-template-editor"
                contenteditable="true"
                data-template-editor
                data-template-index="${index}"
                role="textbox"
                aria-label="${escapeAttr(`Текст сообщения ${index + 1}`)}"
                aria-multiline="true"
              >${renderCommunicationTemplateEditorContent(templates[index])}</div>
              <input name="template${index}" value="${escapeAttr(templates[index])}" type="hidden" />
            </section>
          `).join("")}
        </div>
        <div class="communication-template-actions">
          <button class="ghost-button" data-action="reset-communication-templates" type="button">Восстановить исходные</button>
          <button class="primary-button" type="submit">Сохранить шаблоны</button>
        </div>
      </form>
    `;
  }

  function renderDataFormulaDictionary(values) {
    const formulas = normalizeDataFormulaTemplates(values);
    const sampleDate = new Date(2026, 1, 16);
    return `
      <form class="data-formula-form" data-action="save-data-formulas">
        <aside class="data-formula-tokens">
          <strong>Блоки формулы</strong>
          <p>Перетащите блок в нужное место формулы.</p>
          <div class="data-formula-token-list">
            ${dataFormulaTokenDefinitions.map((item) => `
              <button
                class="communication-template-token data-formula-token"
                data-template-token="${escapeAttr(item.token)}"
                draggable="true"
                type="button"
                title="${escapeAttr(item.label)}"
              >${escapeHtml(item.token)}</button>
            `).join("")}
          </div>
        </aside>
        <div class="data-formula-list">
          ${formulas.map((formula, index) => `
            <section class="data-formula-item">
              <header>
                <div>
                  <strong>${escapeHtml(formula.label)}</strong>
                  <small>Дата: ${escapeHtml(getDataFormulaDateFieldLabel(formula.dateField))}</small>
                </div>
                <output>${escapeHtml(evaluateDataFormula(formula.template, sampleDate, 1))}</output>
              </header>
              <div
                class="communication-template-editor data-formula-editor"
                contenteditable="true"
                data-data-formula-editor
                data-formula-index="${index}"
                role="textbox"
                aria-label="${escapeAttr(formula.label)}"
              >${renderDataFormulaEditorContent(formula.template)}</div>
              <input name="formula${index}" value="${escapeAttr(formula.template)}" type="hidden">
            </section>
          `).join("")}
          <div class="data-formula-actions">
            <button class="ghost-button" data-action="reset-data-formulas" type="button">Восстановить исходные</button>
            <button class="primary-button" type="submit">Сохранить формулы</button>
          </div>
        </div>
      </form>
    `;
  }

  function renderDataFormulaEditorContent(template) {
    const availableTokens = new Set(dataFormulaTokenDefinitions.map((item) => item.token));
    return String(template || "")
      .split(/(\{[^{}]+\})/g)
      .map((part) => {
        if (!availableTokens.has(part)) return escapeHtml(part).replace(/\n/g, "<br>");
        return `<span class="communication-template-block data-formula-block" contenteditable="false" data-template-token="${escapeAttr(part)}" draggable="true">${escapeHtml(part)}</span>`;
      })
      .join("");
  }

  function getDataFormulaDateFieldLabel(fieldName) {
    const labels = {
      contractDate: "Дата договора",
      enrollmentDate: "Дата зачисления",
      expulsionDate: "Дата отчисления"
    };
    return labels[fieldName] || fieldName;
  }

  function renderCommunicationTemplateEditorContent(template) {
    const availableFields = new Set(getCommunicationTemplateFieldDefinitions().map((field) => field.name));
    return String(template || "")
      .split(/(\{\{[\s\S]*?\}\}|\{[^{}]+\})/g)
      .map((part) => {
        const syntax = renderCommunicationTemplateSyntax(part);
        if (syntax) return syntax;
        const fieldName = part.slice(1, -1);
        if (!/^\{[^{}]+\}$/.test(part) || !availableFields.has(fieldName)) return escapeHtml(part);
        return `<span class="communication-template-block" contenteditable="false" data-template-token="${escapeAttr(part)}" data-template-field-name="${escapeAttr(fieldName)}" draggable="true" title="Нажмите правой кнопкой мыши для настройки поля">${escapeHtml(part)}</span>`;
      })
      .join("");
  }

  function renderCommunicationTemplateFormulaEditorContent(formula) {
    const availableFields = new Set(getCommunicationTemplateFieldDefinitions().map((field) => field.name));
    return String(formula || "")
      .split(/(\{\{[\s\S]*?\}\}|\{[^{}]+\})/g)
      .map((part) => {
        const syntax = renderCommunicationTemplateSyntax(part);
        if (syntax) return syntax;
        const fieldName = part.slice(1, -1);
        if (!/^\{[^{}]+\}$/.test(part) || !availableFields.has(fieldName)) return escapeHtml(part);
        return `<span class="communication-template-block" contenteditable="false" data-template-token="${escapeAttr(part)}" data-template-field-name="${escapeAttr(fieldName)}" draggable="true" title="Нажмите правой кнопкой мыши для настройки поля">${escapeHtml(part)}</span>`;
      })
      .join("");
  }

  function renderCommunicationTemplateSyntax(part) {
    if (!/^\{\{[^{}]+\}\}$/.test(part)) return "";
    const isElse = part === "{{иначе}}";
    const isEnd = part === "{{конец}}";
    const tone = isElse || isEnd ? "keyword" : "condition";
    return `<span class="communication-template-formula-syntax is-${tone}">${escapeHtml(part)}</span>`;
  }

  function renderCommunicationTemplateFieldToken(field, title = "Перетащите поле. Нажмите правой кнопкой мыши для настройки") {
    const token = `{${field.name}}`;
    return `<button class="communication-template-token communication-template-field-token ${field.custom ? "is-custom" : ""}" data-template-token="${escapeAttr(token)}" data-template-field-name="${escapeAttr(field.name)}" draggable="true" type="button" title="${escapeAttr(title)}">${escapeHtml(token)}</button>`;
  }

  function renderAdmin() {
    const storageBytes = new Blob([JSON.stringify(state.data)]).size;
    return `
      <div class="split-layout admin-layout">
        <section class="panel data-access-panel">
          <div class="section-head">
            <div>
              <p class="eyebrow">Администрирование</p>
              <h2>Данные и доступ</h2>
            </div>
            <div class="toolbar">
              <button class="ghost-button" data-action="import-json-trigger" type="button">Импорт JSON</button>
              <button class="ghost-button" data-action="export-json" type="button">Экспорт JSON</button>
              <button class="danger-button" data-action="reset-state" type="button">Сброс</button>
              <input id="jsonImport" type="file" accept="application/json" hidden>
            </div>
          </div>
          <div class="admin-stats">
            ${metric("Размер данных", formatBytes(storageBytes), "localStorage", "blue")}
            ${metric("Пользователи", state.data.collections.users.length, "Роли и доступ", "teal")}
            ${metric("VBA-модули", state.data.meta.vbaModules.length, "К переносу", "amber")}
          </div>
          ${renderBulkToolbar(configs.users, state.data.collections.users, "users")}
          ${renderTable(configs.users, state.data.collections.users, "users")}
          <div class="admin-user-actions">
            <button class="primary-button" data-action="create" data-config="users" type="button">Добавить пользователя</button>
          </div>
        </section>

        <section class="panel">
          <div class="panel-head">
            <div>
              <p class="eyebrow">Миграция</p>
              <h2>Контур переноса из Excel</h2>
            </div>
          </div>
          <ol class="roadmap">
            <li><strong>Данные:</strong> перенести листы в таблицы БД с сохранением uid и номеров договоров.</li>
            <li><strong>Бизнес-логика:</strong> выделить правила из <code>Main</code>, <code>КарточкаСлушателя</code>, <code>ИмпортЗаявок</code>.</li>
            <li><strong>Документы:</strong> вынести генерацию договоров, приказов, протоколов и ФРДО в backend.</li>
            <li><strong>Интеграции:</strong> заменить <code>FTP</code>, <code>JupiterSync</code>, <code>WhatsApp_BOT</code> на API-сервисы.</li>
          </ol>
          <div class="module-list">
            ${state.data.meta.vbaModules.slice(0, 10).map((module) => `
              <div class="module-row">
                <span>${escapeHtml(module.name)}</span>
                <strong>${module.lines} строк</strong>
              </div>
            `).join("")}
          </div>
        </section>
      </div>
      <section class="panel">
        <div class="panel-head">
          <div>
            <p class="eyebrow">Журнал</p>
            <h2>Последние действия</h2>
          </div>
        </div>
        ${miniTable(state.data.collections.audit.slice().reverse().slice(0, 12), ["date", "user", "action", "area", "details"])}
      </section>
    `;
  }

  function renderModal() {
    const config = configs[state.modal.config];
    const rows = state.data.collections[config.collection] || [];
    const baseRecord = state.modal.id ? rows.find((row) => row.id === state.modal.id) : ensureRecordUid(config, {});
    const record = state.modal.draft ? { ...(baseRecord || {}), ...state.modal.draft } : baseRecord;
    if (state.modal.config === "students") return renderStudentModal(record || {});
    const title = state.modal.id ? "Редактирование" : "Новая запись";
    return `
      <div class="modal-backdrop" data-action="close-modal">
        <section class="modal" role="dialog" aria-modal="true" aria-label="${title}">
          <form id="recordForm" data-config="${state.modal.config}" data-id="${record?.id || ""}">
            <header class="modal-head">
              <div>
                <p class="eyebrow">${escapeHtml(config.title)}</p>
                <h2>${title}</h2>
              </div>
              <div class="modal-head-actions">
                <button class="ghost-button" data-action="close-modal" type="button">Отмена</button>
                <button class="primary-button" type="submit">Сохранить</button>
              </div>
            </header>
            <div class="form-grid">
              ${config.fields.map((item) => renderField(item, record || {})).join("")}
            </div>
          </form>
        </section>
      </div>
    `;
  }

  function renderField(item, record) {
    const value = record[item.key] ?? "";
    const required = item.required ? "required" : "";
    const label = `<label><span>${escapeHtml(item.label)}${item.required ? " *" : ""}</span>`;
    if (item.type === "checkbox") {
      return `${label}<input name="${item.key}" type="checkbox" value="Да" ${isChecked(value) ? "checked" : ""}></label>`;
    }
    if (item.type === "textarea") {
      return `${label}<textarea name="${item.key}" ${required}>${escapeHtml(value)}</textarea></label>`;
    }
    if (item.type === "select") {
      const dictionaryOptions = item.options || state.data.dictionaries[item.dict] || [];
      const options = item.required ? dictionaryOptions : ["", ...dictionaryOptions];
      return `${label}<select name="${item.key}" ${required}>${options.map((option) => `<option ${String(option) === String(value) ? "selected" : ""}>${escapeHtml(option)}</option>`).join("")}</select></label>`;
    }
    if (state.modal?.config === "programs" && item.key === "hours") {
      return renderProgramHoursField(label, value, required);
    }
    return `${label}<input name="${item.key}" type="${item.type}" value="${escapeAttr(value)}" ${required}></label>`;
  }

  function renderStudentModal(record) {
    if (!state.modal.id) record = { ...record, uid: record.uid || getNextUid() };
    const orderedTabs = getOrderedStudentCardTabs();
    const activeTab = orderedTabs.find((tab) => tab.id === state.studentCardTab) || orderedTabs[0];
    const title = getStudentCardTitle(record);
    const programTitle = getStudentCardProgramTitle(record);
    const navigation = getStudentCardNavigation(record);
    return `
      <div class="modal-backdrop" data-action="close-modal">
        <section class="modal student-modal" role="dialog" aria-modal="true" aria-label="${escapeAttr(title)}">
          <form id="recordForm" data-config="students" data-id="${record.id || ""}">
            <header class="modal-head student-modal-head">
              <div class="student-modal-title">
                <h2>${escapeHtml(title)}</h2>
                ${programTitle ? `<p>${escapeHtml(programTitle)}</p>` : ""}
              </div>
              <div class="modal-head-actions">
                ${renderStudentHeaderStatus(record)}
                <button class="ghost-button" data-action="close-modal" type="button">Отмена</button>
                <button class="primary-button" type="submit">Сохранить карточку</button>
                <div class="student-card-nav" aria-label="Переход между карточками слушателей">
                  <button class="icon-button student-card-nav-button" data-action="navigate-student-card" data-direction="-1" type="button" title="Предыдущая карточка" aria-label="Предыдущая карточка" ${navigation.hasPrev ? "" : "disabled"}>
                    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M15 6l-6 6 6 6"></path></svg>
                  </button>
                  <button class="icon-button student-card-nav-button" data-action="navigate-student-card" data-direction="1" type="button" title="Следующая карточка" aria-label="Следующая карточка" ${navigation.hasNext ? "" : "disabled"}>
                    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M9 6l6 6-6 6"></path></svg>
                  </button>
                </div>
              </div>
            </header>

            <div class="student-card-layout">
              <section class="student-card-main">
                <div class="student-tabs" data-student-tabs role="tablist">
                  ${orderedTabs.map((tab) => `
                    <button class="${activeTab.id === tab.id ? "active" : ""}" data-student-tab="${tab.id}" draggable="true" type="button" role="tab">
                      ${escapeHtml(tab.label)}
                    </button>
                  `).join("")}
                </div>
                <div class="student-tab-body ${activeTab.id === "documents" ? "student-documents-tab" : ""} ${activeTab.id === "income" ? "student-income-tab" : ""} ${activeTab.id === "communications" ? "student-communications-tab" : ""} ${activeTab.id === "ordersSdo" ? "student-orders-sdo-tab" : ""}">
                  ${renderStudentTabContent(activeTab, record)}
                </div>
              </section>

              <aside class="student-side-panel">
                ${renderStudentSidePanel(record)}
              </aside>
            </div>

            ${state.discountPickerOpen ? renderDiscountPicker(record) : ""}
          </form>
        </section>
      </div>
    `;
  }

  function renderStudentHeaderStatus(record) {
    const value = String(record.status || "");
    const options = unique([
      value,
      ...(state.data.dictionaries.statuses || [])
    ].map((option) => String(option || "").trim()).filter(Boolean));
    if (!options.length) {
      return `<input class="student-status student-status-input" name="status" value="${escapeAttr(value)}" placeholder="Статус" required>`;
    }
    return `
      <select class="student-status student-status-select" name="status" title="Статус" aria-label="Статус" required>
        ${options.map((option) => `<option value="${escapeAttr(option)}" ${option === value ? "selected" : ""}>${escapeHtml(option)}</option>`).join("")}
      </select>
    `;
  }

  function getStudentCardTitle(record) {
    const uid = String(record.uid || "").trim();
    const name = String(record.name || "").trim() || (state.modal.id ? "Без ФИО" : "Новая запись");
    const uidPart = uid ? ` [${uid}]` : "";
    return `Карточка слушателя${uidPart} - ${name}`;
  }

  function getStudentCardProgramTitle(record) {
    const program = String(record.program || "").trim();
    const hours = getStudentProgramHours(record);
    if (!program) return "";
    return `${program}${hours ? ` (${hours} ч)` : ""}`;
  }

  function getStudentProgramHours(record) {
    const ownHours = String(record.hours || record.programHours || record.totalHours || "").trim();
    if (ownHours) return ownHours;
    const program = findProgramByName(record.program);
    return String(program?.hours || "").trim();
  }

  function renderProgramHoursField(label, value, required) {
    return `
      ${label}
        ${renderComboField({
          name: "hours",
          type: "number",
          value,
          required,
          options: programHourOptions,
          attrs: 'min="0" step="1" inputmode="numeric"'
        })}
      </label>
    `;
  }

  function renderStudentTabContent(tab, record) {
    if (tab.id === "ordersSdo") return renderStudentOrdersSdoTab(record);
    return `
      ${tab.sections.filter((section) => !(tab.id === "main" && !section.fields.some((item) => item.key === "name"))).map((section) => `
        <section class="form-section">
          <div class="form-section-head">
            <h3>${escapeHtml(section.title)}</h3>
            ${section.customerPassport ? `
              <button class="ghost-button passport-copy-button" data-action="copy-student-passport-to-customer" type="button" title="Скопировать паспортные данные обучающегося" aria-label="Скопировать паспортные данные обучающегося">
                <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M5 12h13"></path><path d="M14 8l4 4-4 4"></path></svg>
                <span>Скопировать данные обучающегося</span>
              </button>
            ` : ""}
          </div>
          ${tab.id === "main" && section.fields.some((item) => item.key === "name")
            ? renderStudentMainIdentity(section, record)
            : section.messageGrid
              ? renderStudentCommunicationMessages(section, record)
            : `<div class="student-form-grid">${section.fields.map((item) => renderStudentField(item, record)).join("")}</div>`}
        </section>
      `).join("")}
      ${tab.payments ? renderPaymentRows(record) : ""}
      ${tab.expenses ? renderExpenseRows(record) : ""}
      ${tab.linkedExpenses ? renderLinkedExpenses(record) : ""}
    `;
  }

  function renderStudentOrdersSdoTab(record) {
    const generatedMessages = generateStudentCommunicationMessages(record);
    const portalMessage = record.portalAccessMessage || generatedMessages.portalAccessMessage || "";
    return `
      <section class="form-section student-orders-sdo-panel">
        <div class="orders-sdo-topbar">
          <button class="ghost-button orders-sdo-auto-button" type="button">
            ${renderOrdersSdoIcon("zap")}
            <span>Авто</span>
          </button>
        </div>
        <div class="orders-sdo-contract-grid">
          ${renderOrdersSdoControl("contractDate", "Дата договора", record, "date", { tools: ["dateStep"] })}
          ${renderOrdersSdoControl("contractNo", "Номер договора", record, "text", { tools: ["generateContractNo"] })}
          ${renderOrdersSdoControl("startDate", "Дата нач. обуч.", record, "date", { tools: ["dateStep"] })}
          ${renderOrdersSdoControl("endDate", "Дата окон. обуч.", record, "date", { tools: ["dateStep"] })}
          <div class="orders-sdo-shift-row">
            ${renderOrdersSdoControl("extendedEndDate", "Дата окон. изм.", record, "date", { tools: ["dateStep", "copyExtendedEndUp"] })}
          </div>
        </div>
        <div class="orders-sdo-orders-grid">
          ${renderOrdersSdoControl("enrollmentDate", "Дата зачислен.", record, "date", { tools: ["dateStep"] })}
          ${renderOrdersSdoControl("expulsionDate", "Дата отчислен.", record, "date", { tools: ["dateStep"] })}
          ${renderOrdersSdoControl("enrollmentOrderNo", "Номер приказа", record, "text", { tools: ["generateEnrollmentOrderNo", "document", "educationCertificate"] })}
          ${renderOrdersSdoControl("expulsionOrderNo", "Номер приказа", record, "text", { tools: ["generateExpulsionOrderNo", "document"] })}
          ${renderOrdersSdoControl("group", "Номер группы", record, "text", { tools: ["generateGroupNo"], className: "orders-sdo-group-field" })}
        </div>
        <fieldset class="orders-sdo-lms">
          <legend>Система дистанционного обучения</legend>
          <div class="orders-sdo-lms-row">
            ${renderOrdersSdoControl("login", "Логин", record, "text", {
              compact: true,
              attrs: 'autocomplete="off" autocapitalize="none" spellcheck="false" data-lpignore="true" data-1p-ignore data-moodle-credential'
            })}
            ${renderOrdersSdoControl("password", "Пароль", record, "text", {
              compact: true,
              attrs: 'autocomplete="new-password" data-lpignore="true" data-1p-ignore data-moodle-credential'
            })}
            <button class="ghost-button orders-sdo-tool-button" data-action="generate-portal-password" type="button">
              ${renderOrdersSdoIcon("key")}
              <span>Сгенерировать</span>
            </button>
            <button class="orders-sdo-icon-button" data-action="open-moodle-portal" type="button" title="Войти в портал Moodle" aria-label="Войти в портал Moodle">
              ${renderOrdersSdoIcon("globe")}
            </button>
          </div>
          <div class="orders-sdo-message-head">
            <span>Сообщение о доступе к порталу обучения</span>
            <button class="ghost-button orders-sdo-tool-button" data-action="export-student-to-sdo" type="button">
              ${renderOrdersSdoIcon("laptop")}
              <span>Экспорт в СДО</span>
            </button>
            <button class="ghost-button orders-sdo-tool-button" type="button">
              ${renderOrdersSdoIcon("at")}
              <span>Отправить</span>
            </button>
            <button class="orders-sdo-icon-button" type="button" title="Копировать сообщение" aria-label="Копировать сообщение">
              ${renderOrdersSdoIcon("clipboard")}
            </button>
          </div>
          <textarea name="portalAccessMessage" class="orders-sdo-message">${escapeHtml(portalMessage)}</textarea>
        </fieldset>
      </section>
    `;
  }

  function renderOrdersSdoIcon(name) {
    const paths = {
      at: '<circle cx="12" cy="12" r="8"></circle><path d="M16 12v1.5a2.5 2.5 0 0 1-5 0V12a2.5 2.5 0 0 1 5 0Z"></path><path d="M16 9v6"></path>',
      chevronDown: '<path d="m7 9 5 5 5-5"></path>',
      chevronLeft: '<path d="m15 18-6-6 6-6"></path>',
      chevronRight: '<path d="m9 18 6-6-6-6"></path>',
      arrowUp: '<path d="m7 11 5-5 5 5"></path><path d="M12 6v12"></path>',
      clipboard: '<rect x="6" y="5" width="12" height="16" rx="2"></rect><path d="M9 5.5V3h6v2.5"></path>',
      copy: '<rect x="8" y="8" width="11" height="11" rx="2"></rect><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"></path>',
      document: '<path d="M6 3h8l4 4v14H6z"></path><path d="M14 3v5h5"></path>',
      documentText: '<path d="M6 3h8l4 4v14H6z"></path><path d="M14 3v5h5"></path><path d="M9 13h6"></path><path d="M9 17h4"></path>',
      globe: '<circle cx="12" cy="12" r="9"></circle><path d="M3 12h18"></path><path d="M12 3a14 14 0 0 1 0 18"></path><path d="M12 3a14 14 0 0 0 0 18"></path>',
      key: '<circle cx="8" cy="15" r="3"></circle><path d="m10.5 13.5 8-8"></path><path d="m16 8 2 2"></path><path d="m14 10 2 2"></path>',
      laptop: '<rect x="5" y="4" width="14" height="11" rx="1.5"></rect><path d="M3 18h18"></path><path d="m5 15-2 3"></path><path d="m19 15 2 3"></path><path d="M9 18h6"></path>',
      lock: '<rect x="5" y="10" width="14" height="11" rx="2"></rect><path d="M8 10V7a4 4 0 0 1 8 0v3"></path><path d="M12 14v3"></path>',
      wand: '<path d="m4 20 11-11"></path><path d="m13 7 4 4"></path><path d="m5.5 3 .8 1.7L8 5.5l-1.7.8L5.5 8l-.8-1.7L3 5.5l1.7-.8L5.5 3Z"></path><path d="m18.5 13 .8 1.7 1.7.8-1.7.8-.8 1.7-.8-1.7-1.7-.8 1.7-.8.8-1.7Z"></path><path d="m19 2 .5 1 .9.5-.9.5-.5 1-.5-1-.9-.5.9-.5.5-1Z"></path>',
      zap: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"></path>'
    };
    return `<svg class="orders-sdo-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${paths[name] || ""}</svg>`;
  }

  function renderOrdersSdoControl(key, label, record, type = "text", options = {}) {
    const tools = options.tools || [];
    const value = record[key] ?? "";
    const control = `<input name="${key}" type="${type}" value="${escapeAttr(value)}" ${options.attrs || ""}>`;
    return `
      <label class="orders-sdo-field ${options.compact ? "is-compact" : ""} ${options.className || ""}">
        <span>${escapeHtml(label)}</span>
        <div class="orders-sdo-control">
          ${control}
          ${tools.map((tool) => renderOrdersSdoToolButton(tool, key)).join("")}
          ${options.after || ""}
        </div>
      </label>
    `;
  }

  function renderOrdersSdoToolButton(tool, fieldName) {
    if (["generateContractNo", "generateEnrollmentOrderNo", "generateExpulsionOrderNo", "generateGroupNo"].includes(tool)) {
      const actionMap = {
        generateContractNo: ["generate-contract-number", "Сформировать номер договора"],
        generateEnrollmentOrderNo: ["generate-enrollment-order-number", "Сформировать номер приказа о зачислении"],
        generateExpulsionOrderNo: ["generate-expulsion-order-number", "Сформировать номер приказа об отчислении"],
        generateGroupNo: ["generate-group-number", "Сформировать номер группы"]
      };
      const [action, title] = actionMap[tool];
      return `
        <button
          class="orders-sdo-icon-button is-magic"
          data-action="${action}"
          type="button"
          title="${escapeAttr(title)}"
          aria-label="${escapeAttr(title)}"
        >
          ${renderOrdersSdoIcon("wand")}
        </button>
      `;
    }
    if (tool === "document") {
      const title = fieldName === "enrollmentOrderNo"
        ? "Сформировать приказ на зачисление"
        : fieldName === "expulsionOrderNo"
          ? "Сформировать приказ на отчисление"
          : "Документ";
      return `
        <button class="orders-sdo-icon-button" type="button" title="${escapeAttr(title)}" aria-label="${escapeAttr(title)}">
          ${renderOrdersSdoIcon("document")}
        </button>
      `;
    }
    if (tool === "educationCertificate") {
      return `
        <button
          class="orders-sdo-icon-button"
          type="button"
          title="Сформировать справку об обучении"
          aria-label="Сформировать справку об обучении"
        >
          ${renderOrdersSdoIcon("documentText")}
        </button>
      `;
    }
    if (tool === "dateStep") {
      return `
        <span class="orders-sdo-date-step">
          <button
            class="orders-sdo-icon-button"
            data-action="shift-orders-sdo-date"
            data-field="${escapeAttr(fieldName)}"
            data-direction="-1"
            type="button"
            title="На один день назад; с Alt — на один месяц назад"
            aria-label="Изменить дату назад"
          >${renderOrdersSdoIcon("chevronLeft")}</button>
          <button
            class="orders-sdo-icon-button"
            data-action="shift-orders-sdo-date"
            data-field="${escapeAttr(fieldName)}"
            data-direction="1"
            type="button"
            title="На один день вперед; с Alt — на один месяц вперед"
            aria-label="Изменить дату вперед"
          >${renderOrdersSdoIcon("chevronRight")}</button>
        </span>
      `;
    }
    if (tool === "copyExtendedEndUp") {
      return `
        <button
          class="orders-sdo-icon-button"
          data-action="copy-extended-end-date-up"
          type="button"
          title="Скопировать измененную дату окончания обучения в дату окончания обучения"
          aria-label="Скопировать измененную дату окончания обучения в дату окончания обучения"
        >${renderOrdersSdoIcon("arrowUp")}</button>
      `;
    }
    const map = {
      copy: [renderOrdersSdoIcon("copy"), "Копировать"],
      file: [renderOrdersSdoIcon("document"), "Документ"],
      up: [renderOrdersSdoIcon("arrowUp"), "Перенести вверх"],
      dropdown: [renderOrdersSdoIcon("chevronDown"), "Выбрать"]
    };
    const [icon, title] = map[tool] || [tool, ""];
    const tone = tool === "clear" ? " is-danger" : "";
    return `<button class="orders-sdo-icon-button${tone}" type="button" title="${escapeAttr(title)}" aria-label="${escapeAttr(title)}">${icon}</button>`;
  }

  function shiftOrdersSdoDate(fieldName, direction, byMonth = false) {
    const formElement = document.getElementById("recordForm");
    const input = formElement?.elements[fieldName];
    if (!(input instanceof HTMLInputElement) || input.type !== "date") return;
    const current = parseOrdersSdoDate(input.value) || new Date();
    const step = Number(direction) < 0 ? -1 : 1;
    const shifted = byMonth
      ? shiftDateByClampedMonth(current, step)
      : new Date(current.getFullYear(), current.getMonth(), current.getDate() + step);
    input.value = formatOrdersSdoDate(shifted);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    input.focus({ preventScroll: true });
  }

  function copyExtendedEndDateToEndDate() {
    const formElement = document.getElementById("recordForm");
    const source = formElement?.elements.extendedEndDate;
    const target = formElement?.elements.endDate;
    if (!(source instanceof HTMLInputElement) || !(target instanceof HTMLInputElement)) return;
    if (!source.value) {
      alert("Укажите измененную дату окончания обучения.");
      source.focus({ preventScroll: true });
      return;
    }
    if (!confirm("Скопировать измененную дату окончания обучения в дату окончания обучения?")) return;
    target.value = source.value;
    target.dispatchEvent(new Event("input", { bubbles: true }));
    target.dispatchEvent(new Event("change", { bubbles: true }));
    target.focus({ preventScroll: true });
  }

  function generateContractNumber() {
    generateNumberFromDataFormula("contractNumber");
  }

  function generateEnrollmentOrderNumber() {
    generateNumberFromDataFormula("enrollmentOrderNumber");
  }

  function generateExpulsionOrderNumber() {
    generateNumberFromDataFormula("expulsionOrderNumber");
  }

  function generateNumberFromDataFormula(formulaKey) {
    const formula = normalizeDataFormulaTemplates(state.data.dictionaries.dataFormulas)
      .find((item) => item.key === formulaKey);
    const formElement = document.getElementById("recordForm");
    const input = formElement?.elements[formula?.targetField];
    if (!formula || !(input instanceof HTMLInputElement)) return;
    const dateInput = formElement.elements[formula.dateField];
    const date = parseOrdersSdoDate(dateInput?.value) || new Date();
    const sequence = formula.template.includes("{ПорядковыйНомерЗаДату}")
      ? getNextDataFormulaSequence(formula, date, formElement.dataset.id)
      : 1;
    input.value = evaluateDataFormula(formula.template, date, sequence);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    input.focus({ preventScroll: true });
  }

  function evaluateDataFormula(template, date, sequence = 1) {
    const safeDate = date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date();
    const values = {
      Год1: String(safeDate.getFullYear()).slice(-1),
      Месяц2: String(safeDate.getMonth() + 1).padStart(2, "0"),
      День2: String(safeDate.getDate()).padStart(2, "0"),
      ПорядковыйНомерЗаДату: String(sequence)
    };
    return String(template || "").replace(/\{([^{}]+)\}/g, (match, name) => (
      Object.prototype.hasOwnProperty.call(values, name) ? values[name] : match
    ));
  }

  function getNextDataFormulaSequence(formula, date, currentId = "") {
    const marker = "__AIS_SEQUENCE__";
    const sample = evaluateDataFormula(formula.template, date, marker);
    const markerIndex = sample.indexOf(marker);
    if (markerIndex < 0) return 1;
    const prefix = sample.slice(0, markerIndex);
    const suffix = sample.slice(markerIndex + marker.length);
    const pattern = new RegExp(`^${escapeRegExp(prefix)}(\\d+)${escapeRegExp(suffix)}$`);
    const sequences = ["students", "contracts"]
      .flatMap((collection) => state.data.collections[collection] || [])
      .filter((record) => !currentId || String(record.id || "") !== String(currentId))
      .map((record) => pattern.exec(String(record[formula.targetField] || "").trim()))
      .filter(Boolean)
      .map((match) => Number(match[1]))
      .filter((number) => Number.isFinite(number) && number > 0);
    return (sequences.length ? Math.max(...sequences) : 0) + 1;
  }

  function escapeRegExp(value) {
    return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function parseOrdersSdoDate(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
    if (!match) return null;
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function shiftDateByClampedMonth(date, direction) {
    const target = new Date(date.getFullYear(), date.getMonth() + direction, 1);
    const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
    target.setDate(Math.min(date.getDate(), lastDay));
    return target;
  }

  function formatOrdersSdoDate(date) {
    return [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, "0"),
      String(date.getDate()).padStart(2, "0")
    ].join("-");
  }

  function renderStudentCommunicationMessages(section, record) {
    const generatedMessages = generateStudentCommunicationMessages(record);
    const descriptions = normalizeCommunicationTemplateDescriptions(
      state.data.dictionaries.communicationTemplateDescriptions
    );
    return `
      <div class="communication-message-grid">
        ${section.fields.map((item, index) => {
          const message = studentCommunicationMessages.find((entry) => entry.key === item.key);
          const source = message?.source || `Примечание${index + 1}`;
          const label = descriptions[index] || message?.label || item.label;
          const generatedValue = generatedMessages[item.key] || "";
          const value = record[item.key] || generatedValue;
          const isCustomized = String(record[item.key] || "") !== "" && String(record[item.key]) !== String(generatedValue);
          return `
            <article class="communication-message-card ${isCustomized ? "is-customized" : ""}">
              <div class="communication-message-head">
                <strong>Сообщение ${index + 1}</strong>
                <span title="${escapeAttr(label)}">${escapeHtml(label)}</span>
              </div>
              <textarea
                name="${item.key}"
                data-communication-message="${item.key}"
                data-generated-message="${escapeAttr(encodeURIComponent(generatedValue))}"
                placeholder="${escapeAttr(`Значение из столбца ${source}`)}"
                readonly
              >${escapeHtml(value)}</textarea>
              <div class="communication-message-menu" role="menu" aria-label="${escapeAttr(`Действия для сообщения ${index + 1}`)}">
                <button data-action="copy-communication-message" data-message-key="${item.key}" type="button">
                  ${renderCommunicationActionIcon("copy")}
                  <span>Копировать</span>
                </button>
                <button data-action="edit-communication-message" data-message-key="${item.key}" type="button">
                  ${renderCommunicationActionIcon("edit")}
                  <span>Редактировать</span>
                </button>
                <button data-action="restore-communication-message" data-message-key="${item.key}" type="button">
                  ${renderCommunicationActionIcon("restore")}
                  <span>Восстановить</span>
                </button>
                <button data-action="email-communication-message" data-message-key="${item.key}" type="button">
                  ${renderCommunicationActionIcon("mail")}
                  <span>Отправить по почте</span>
                </button>
              </div>
            </article>
          `;
        }).join("")}
      </div>
    `;
  }

  function renderCommunicationActionIcon(action) {
    if (action === "edit") {
      return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m14 5 5 5"></path><path d="M4 20h5L19 10a3.5 3.5 0 0 0-5-5L4 15z"></path></svg>`;
    }
    if (action === "mail") {
      return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="3" y="5" width="18" height="14" rx="2"></rect><path d="m4 7 8 6 8-6"></path></svg>`;
    }
    if (action === "restore") {
      return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M3 12a9 9 0 1 0 3-6.7"></path><path d="M3 4v6h6"></path></svg>`;
    }
    return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><rect x="9" y="9" width="10" height="10" rx="2"></rect><path d="M5 15V7a2 2 0 0 1 2-2h8"></path></svg>`;
  }

  function renderStudentMainIdentity(section, record) {
    const hiddenKeys = new Set(["name", "nameEnglish", "noDeclension", "addressByFirstName", "uid", "status", "program", "studyForm", "educationType", "hours", "registrationAddress", "mailingAddress", "workPlace", "position", "employmentCategory", "ovzStatus", "internship", "group", "source", "tags"]);
    const nameField = section.fields.find((item) => item.key === "name");
    const nameEnglishField = section.fields.find((item) => item.key === "nameEnglish");
    const uidField = section.fields.find((item) => item.key === "uid");
    const statusField = section.fields.find((item) => item.key === "status");
    const programField = section.fields.find((item) => item.key === "program");
    const studyFormField = section.fields.find((item) => item.key === "studyForm");
    const educationTypeField = section.fields.find((item) => item.key === "educationType");
    const hoursField = section.fields.find((item) => item.key === "hours");
    const registrationAddressField = section.fields.find((item) => item.key === "registrationAddress");
    const mailingAddressField = section.fields.find((item) => item.key === "mailingAddress");
    const employmentFields = ["workPlace", "position"]
      .map((key) => section.fields.find((item) => item.key === key))
      .filter(Boolean);
    const employmentDetailsFields = ["employmentCategory", "ovzStatus"]
      .map((key) => section.fields.find((item) => item.key === key))
      .filter(Boolean);
    const internshipField = section.fields.find((item) => item.key === "internship");
    const sourceField = section.fields.find((item) => item.key === "source");
    return `
      <div class="student-main-identity">
        <div class="student-main-photo">
          ${renderStudentPhotoEditor(record)}
          ${renderStudentField(uidField, record)}
        </div>
        <div class="student-main-fields">
          <div class="student-name-status-grid">
            <div class="student-name-stack">
              ${renderStudentField(nameField, record)}
              ${renderStudentNameOptions(record)}
              ${renderStudentEnglishNameField(nameEnglishField, record)}
            </div>
            <div class="student-status-stack">
              ${renderStudentField(sourceField, record)}
              ${renderStudentGenderField(record)}
            </div>
            ${renderStudentContactLine(record)}
          </div>
          <div class="student-form-grid">
            ${section.fields.filter((item) => !hiddenKeys.has(item.key)).sort(orderStudentMainField).map((item) => renderStudentField(item, record)).join("")}
          </div>
        </div>
        <div class="student-main-program-row student-main-subsection student-program-section">
          ${renderStudentProgramLine(programField, internshipField, record)}
          <div class="student-program-details-row">
            ${[studyFormField, educationTypeField, hoursField].filter(Boolean).map((item) => renderStudentField(item, record)).join("")}
          </div>
          <div class="student-main-subsection student-address-section">
            <div class="student-address-pair">
              ${renderStudentAddressField(registrationAddressField, record, "mailingAddress")}
              ${renderStudentAddressField(mailingAddressField, record, "registrationAddress")}
            </div>
          </div>
          <div class="student-main-subsection student-employment-section">
            <div class="student-employment-row">
              ${employmentFields.map((item) => renderStudentField(item, record)).join("")}
            </div>
            <div class="student-employment-details-row">
              ${employmentDetailsFields.map((item) => renderStudentField(item, record)).join("")}
            </div>
          </div>
        </div>
      </div>
    `;
  }

  function renderStudentAddressField(item, record, copyTargetKey) {
    if (!item) return "";
    const value = record[item.key] || "";
    return `
      <label class="student-address-field">
        <span>${escapeHtml(item.label)}</span>
        <div class="student-address-control">
          <textarea name="${item.key}" data-address-field="${item.key}">${escapeHtml(value)}</textarea>
          <div class="student-address-actions">
            <button class="icon-button student-address-action" data-action="copy-address-to" data-source="${item.key}" data-target="${copyTargetKey}" type="button" title="Скопировать в другое адресное поле" aria-label="Скопировать в другое адресное поле">
              ${renderAddressCopyIcon(item.key === "registrationAddress" ? "down" : "up")}
            </button>
            <button class="icon-button student-address-action student-address-check-action" data-action="check-post-index" data-source="${item.key}" type="button" title="Проверить почтовый индекс через Почту России" aria-label="Проверить почтовый индекс через Почту России">
              ${renderGlobeGridIcon()}
            </button>
          </div>
        </div>
      </label>
    `;
  }

  function renderStudentProgramLine(item, internshipField, record) {
    if (!item) return "";
    const promoTitle = getProgramPromoButtonTitle(getProgramPromoUrl(findProgramByName(record.program)));
    return `
      <div class="student-program-link-row">
        ${renderStudentField(item, record)}
        <button class="icon-button student-program-promo-button" data-action="open-student-program-promo" type="button" title="${escapeAttr(promoTitle)}" aria-label="${escapeAttr(promoTitle)}">
          ${renderExternalLinkIcon()}
        </button>
        ${renderStudentInternshipField(internshipField, record)}
      </div>
    `;
  }

  function renderStudentInternshipField(item, record) {
    if (!item) return "";
    return `
      <label class="student-internship-field">
        <span class="student-internship-control">
          <input name="${item.key}" type="checkbox" value="Да" ${isChecked(record[item.key]) ? "checked" : ""}>
          <span>${escapeHtml(item.label)}</span>
        </span>
      </label>
    `;
  }

  function renderStudentNameOptions(record) {
    return `
      <div class="student-name-options" aria-label="Настройки ФИО">
        <label>
          <input name="noDeclension" type="checkbox" value="Да" ${isChecked(record.noDeclension) ? "checked" : ""}>
          <span>Не склоняется ФИО</span>
        </label>
        <label>
          <input name="addressByFirstName" type="checkbox" value="Да" ${isChecked(record.addressByFirstName) ? "checked" : ""}>
          <span>Обращаться по имени</span>
        </label>
      </div>
    `;
  }

  function orderStudentMainField(a, b) {
    const order = {
      agent: 1,
      manager: 2,
      workPlace: 3,
      position: 4,
      employmentCategory: 5,
      ovzStatus: 6
    };
    return (order[a.key] || 10) - (order[b.key] || 10);
  }

  function renderStudentGenderField(record) {
    const value = record.gender || "";
    const options = ["", "Женский", "Мужской"];
    return `
      <label class="student-gender-field">
        <span>Пол</span>
        <select name="gender">
          ${options.map((option) => `<option value="${escapeAttr(option)}" ${option === value ? "selected" : ""}>${escapeHtml(option)}</option>`).join("")}
        </select>
      </label>
    `;
  }

  function renderStudentContactLine(record) {
    return `
      <div class="student-contact-line">
        <label class="student-contact-field">
          <span>Email</span>
          <input name="email" type="email" value="${escapeAttr(record.email || "")}">
        </label>
        <div class="student-contact-field student-phone-field">
          <span>Телефон</span>
          <div class="student-phone-messenger-row">
            <input name="phone" type="tel" value="${escapeAttr(record.phone || "")}" aria-label="Телефон">
            <div class="student-messenger-actions">
              ${renderMessengerButton("max", "Открыть Max", renderMaxIcon())}
              ${renderMessengerButton("telegram", "Открыть Telegram", renderTelegramIcon())}
              ${renderMessengerButton("whatsapp", "Открыть WhatsApp", renderWhatsAppIcon())}
            </div>
          </div>
        </div>
        <label class="student-contact-field student-messenger-url-field">
          <span>Адрес мессенджера</span>
          <div class="student-messenger-url-row">
            <input name="messengerUrl" type="text" value="${escapeAttr(record.messengerUrl || "")}" placeholder="https://max.ru/u/...">
            <button class="icon-button student-messenger-url-button" data-action="open-student-messenger-url" type="button" title="Перейти по адресу мессенджера" aria-label="Перейти по адресу мессенджера">
              ${renderExternalLinkIcon()}
            </button>
          </div>
        </label>
      </div>
    `;
  }

  function renderMessengerButton(messenger, label, icon) {
    return `
      <button class="icon-button student-messenger-button ${messenger}" data-action="open-student-messenger" data-messenger="${messenger}" type="button" title="${escapeAttr(label)}" aria-label="${escapeAttr(label)}">
        ${icon}
      </button>
    `;
  }

  function renderMaxIcon() {
    return `
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M4.5 17.5V6.5h3.1l4.4 6.4 4.4-6.4h3.1v11h-3.2v-5.8l-3.3 4.6h-2l-3.3-4.6v5.8z"></path>
      </svg>
    `;
  }

  function renderTelegramIcon() {
    return `
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M21 4.8 17.8 19c-.2.9-.8 1.1-1.5.7l-4.5-3.3-2.2 2.1c-.2.2-.4.4-.9.4l.3-4.7 8.5-7.7c.4-.3-.1-.5-.5-.2L6.5 12.9 2 11.5c-.9-.3-.9-.9.2-1.3L19.8 3.4c.8-.3 1.5.2 1.2 1.4z"></path>
      </svg>
    `;
  }

  function renderWhatsAppIcon() {
    return `
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M5.2 19 6 15.9a7.4 7.4 0 1 1 2.8 2.8z"></path>
        <path d="M9 8.6c.2-.4.4-.5.7-.5h.5c.2 0 .4.1.5.4l.7 1.7c.1.3.1.5-.1.7l-.4.5c-.1.1-.2.3 0 .5.5.9 1.3 1.6 2.2 2 .2.1.4.1.5-.1l.6-.7c.2-.2.4-.2.7-.1l1.6.8c.3.1.4.4.4.6 0 .5-.3 1.2-.8 1.5-.5.3-1.2.4-2.3 0-2.1-.7-4.4-2.6-5.3-4.7-.4-1-.4-1.8 0-2.6z"></path>
      </svg>
    `;
  }

  function renderExternalLinkIcon() {
    return `
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M14 5h5v5"></path>
        <path d="M10 14 19 5"></path>
        <path d="M19 14v5H5V5h5"></path>
      </svg>
    `;
  }

  function renderAddressCopyIcon(direction) {
    const arrow = direction === "up"
      ? `<path d="M12 5v14"></path><path d="M6 11l6-6 6 6"></path>`
      : `<path d="M12 5v14"></path><path d="M6 13l6 6 6-6"></path>`;
    return `
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        ${arrow}
      </svg>
    `;
  }

  function renderGlobeGridIcon() {
    return `
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <circle cx="12" cy="12" r="8"></circle>
        <path d="M4 12h16"></path>
        <path d="M6.4 7.5h11.2"></path>
        <path d="M6.4 16.5h11.2"></path>
        <ellipse cx="12" cy="12" rx="3.2" ry="8"></ellipse>
      </svg>
    `;
  }

  function renderStudentEnglishNameField(item, record) {
    if (!item) return "";
    return `
      <label class="student-name-english-field">
        <span>${escapeHtml(item.label)}</span>
        <div class="student-translit-row">
          <input name="${item.key}" type="text" value="${escapeAttr(record[item.key] || "")}">
          <button class="icon-button student-translit-button" data-action="transliterate-student-name" type="button" title="Транслитерировать ФИО" aria-label="Транслитерировать ФИО">Aa</button>
        </div>
      </label>
    `;
  }

  function renderStudentPhotoEditor(record) {
    const photo = getStudentPhotoSrc(record);
    return `
      <div class="photo-preview ${photo ? "has-photo" : ""}" id="studentPhotoPreview">
        ${photo ? `<img src="${escapeAttr(photo)}" alt="Фото слушателя">` : `<span>${initials(record.name || "Слушатель")}</span>`}
        <div class="photo-actions" aria-label="Действия с фото">
          <label class="photo-icon-button" title="Прикрепить фото" aria-label="Прикрепить фото">
            <input id="studentPhotoInput" type="file" accept="image/*">
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="M21.4 11.6l-8.9 8.9a6 6 0 0 1-8.5-8.5l9.8-9.8a4 4 0 0 1 5.7 5.7l-9.8 9.8a2 2 0 0 1-2.8-2.8l8.8-8.8"></path>
            </svg>
          </label>
          <button class="photo-icon-button" data-action="clear-photo" type="button" title="Удалить фото" aria-label="Удалить фото">
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="M4 7h16"></path>
              <path d="M10 11v6"></path>
              <path d="M14 11v6"></path>
              <path d="M6 7l1 14h10l1-14"></path>
              <path d="M9 7V4h6v3"></path>
            </svg>
          </button>
        </div>
      </div>
      <input type="hidden" name="photoData" id="studentPhotoData" value="${escapeAttr(record.photoData || "")}">
      <input type="hidden" name="photoPath" id="studentPhotoPath" value="${escapeAttr(record.photoPath || "")}">
      <input type="hidden" name="photoUrl" id="studentPhotoUrl" value="${escapeAttr(record.photoUrl || "")}">
    `;
  }

  function renderStudentSidePanel(record) {
    const orderedEvents = getOrderedStudentEvents(record);
    return `
      <section class="student-note-block">
        <div class="student-side-head">
          <h3>Примечание</h3>
        </div>
        <textarea name="note" placeholder="Общее примечание по слушателю">${escapeHtml(record.note || "")}</textarea>
      </section>
      <section class="student-events-block">
        <div class="student-side-head">
          <h3>Перечень событий</h3>
        </div>
        <div class="student-events-top">
          <div class="student-events-head" aria-hidden="true">
            <span></span>
            <span>Дата</span>
            <span>Событие</span>
          </div>
          <button class="icon-button event-add-button" data-action="add-student-event" type="button" title="Добавить событие" aria-label="Добавить событие">
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="M12 5v14"></path>
              <path d="M5 12h14"></path>
            </svg>
          </button>
        </div>
        <input type="hidden" name="eventOrder" data-event-order value="${escapeAttr(orderedEvents.map((event) => event.key).join(","))}">
        <input type="hidden" name="eventDeleted" data-event-deleted value="${escapeAttr(csvList(record.eventDeleted).join(","))}">
        <input type="hidden" name="eventCustomKeys" data-event-custom-keys value="${escapeAttr(csvList(record.eventCustomKeys).join(","))}">
        <div class="student-events-list" data-student-events-list>
          ${orderedEvents.map((event) => renderStudentEventRow(event, record)).join("")}
        </div>
        <div class="student-event-editor" data-event-editor hidden>
          <label>
            <span>Дата</span>
            <input type="date" data-event-editor-date>
          </label>
          <label>
            <span>Событие</span>
            <input type="text" data-event-editor-label>
          </label>
          <div class="student-event-editor-actions">
            <button class="event-editor-delete" data-action="delete-student-event" type="button" title="Удалить событие" aria-label="Удалить событие">
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="M3 6h18"></path>
                <path d="M8 6V4c0-1.1.9-2 2-2h4c1.1 0 2 .9 2 2v2"></path>
                <path d="M19 6l-1 14c-.1 1.1-1 2-2.1 2H8.1c-1.1 0-2-.9-2.1-2L5 6"></path>
                <path d="M10 11v6"></path>
                <path d="M14 11v6"></path>
              </svg>
            </button>
            <button class="ghost-button" data-action="close-event-editor" type="button">Отмена</button>
            <button class="primary-button" data-action="apply-event-editor" type="button">Применить</button>
          </div>
        </div>
      </section>
    `;
  }

  function renderStudentEventRow(event, record) {
    const stateKey = `event_${event.key}_state`;
    const dateKey = `event_${event.key}_date`;
    const labelKey = `event_${event.key}_label`;
    const stateValue = normalizeEventState(record[stateKey], record[dateKey]);
    const dateValue = record[dateKey] || "";
    const labelValue = record[labelKey] || event.label;
    return `
      <div class="student-event-row ${stateValue ? "is-selected" : ""} ${stateValue === "dated" ? "has-date" : ""}" data-action="toggle-student-event" data-event-key="${escapeAttr(event.key)}" data-event-custom="${event.custom ? "true" : ""}" role="button" tabindex="0" draggable="false">
        <input
          type="checkbox"
          tabindex="-1"
          aria-hidden="true"
          ${stateValue ? "checked" : ""}
        >
        <input type="hidden" name="${stateKey}" data-event-state="${escapeAttr(event.key)}" value="${escapeAttr(stateValue)}">
        <input type="hidden" name="${dateKey}" data-event-date="${escapeAttr(event.key)}" value="${escapeAttr(dateValue)}">
        <input type="hidden" name="${labelKey}" data-event-label-value="${escapeAttr(event.key)}" value="${escapeAttr(labelValue)}">
        <span class="event-date" data-event-date-label="${escapeAttr(event.key)}">${stateValue === "dated" ? escapeHtml(dateRu(dateValue)) : ""}</span>
        <span class="event-label" data-event-label-text="${escapeAttr(event.key)}" title="${escapeAttr(labelValue)}">${escapeHtml(labelValue)}</span>
      </div>
    `;
  }

  function getOrderedStudentEvents(record) {
    const catalog = getStudentEventCatalog(record);
    const keys = String(record.eventOrder || "")
      .split(",")
      .map((key) => key.trim())
      .filter(Boolean);
    const eventByKey = new Map(catalog.map((event) => [event.key, event]));
    const ordered = keys.map((key) => eventByKey.get(key)).filter(Boolean);
    const usedKeys = new Set(ordered.map((event) => event.key));
    return [
      ...ordered,
      ...catalog.filter((event) => !usedKeys.has(event.key))
    ];
  }

  function getStudentEventCatalog(record) {
    const deleted = new Set(csvList(record.eventDeleted));
    const baseEvents = studentEventTemplates.filter((event) => !deleted.has(event.key));
    const customEvents = csvList(record.eventCustomKeys).map((key) => ({
      key,
      label: record[`event_${key}_label`] || "Новое событие",
      custom: true
    }));
    return [...baseEvents, ...customEvents];
  }

  function csvList(value) {
    return String(value || "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }

  function syncStudentEventOrder() {
    const input = document.querySelector("[data-event-order]");
    const list = document.querySelector("[data-student-events-list]");
    if (!input || !list) return;
    input.value = Array.from(list.querySelectorAll(".student-event-row"))
      .map((row) => row.dataset.eventKey)
      .filter(Boolean)
      .join(",");
  }

  function setCsvHidden(selector, values) {
    const input = document.querySelector(selector);
    if (input) input.value = unique(values.filter(Boolean)).join(",");
  }

  function getEventDragAfterElement(list, y) {
    const rows = Array.from(list.querySelectorAll(".student-event-row:not(.is-dragging)"));
    return rows.reduce((closest, row) => {
      const box = row.getBoundingClientRect();
      const offset = y - box.top - box.height / 2;
      if (offset < 0 && offset > closest.offset) return { offset, row };
      return closest;
    }, { offset: Number.NEGATIVE_INFINITY, row: null }).row;
  }

  function bindStudentEventRow(row) {
    row.draggable = false;
    row.addEventListener("pointerdown", (event) => {
      const canReorder = event.button === 0 && (event.shiftKey || document.body.classList.contains("event-reorder-mode"));
      row.draggable = canReorder;
      row.dataset.reorderDragReady = canReorder ? "true" : "";
    });
    row.addEventListener("pointerup", () => {
      if (row.classList.contains("is-dragging")) return;
      row.draggable = false;
      row.dataset.reorderDragReady = "";
    });
    row.addEventListener("click", (event) => {
      event.preventDefault();
      if (row.dataset.wasDragged === "true") {
        row.dataset.wasDragged = "";
        return;
      }
      updateStudentEventRow(row);
    });
    row.addEventListener("dragstart", (event) => {
      const canReorder = row.dataset.reorderDragReady === "true" || event.shiftKey || document.body.classList.contains("event-reorder-mode");
      if (!canReorder) {
        event.preventDefault();
        row.draggable = false;
        return;
      }
      closeStudentEventEditor();
      row.classList.add("is-dragging");
      document.body.classList.add("event-reorder-dragging");
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", row.dataset.eventKey || "");
    });
    row.addEventListener("dragend", () => {
      row.classList.remove("is-dragging");
      document.body.classList.remove("event-reorder-dragging");
      row.draggable = false;
      row.dataset.reorderDragReady = "";
      row.dataset.wasDragged = "true";
      window.setTimeout(() => {
        row.dataset.wasDragged = "";
      }, 150);
      syncStudentEventOrder();
    });
    row.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      openStudentEventEditor(row, event.clientX, event.clientY);
    });
    row.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      updateStudentEventRow(row);
    });
  }

  function setEventReorderMode(active) {
    document.body.classList.toggle("event-reorder-mode", active);
    if (!active) {
      document.querySelectorAll(".student-event-row:not(.is-dragging)").forEach((row) => {
        row.draggable = false;
        row.dataset.reorderDragReady = "";
      });
    }
  }

  function bindStudentEventReorderKeys() {
    if (window.studentEventReorderKeysBound) return;
    window.studentEventReorderKeysBound = true;
    document.addEventListener("keydown", (event) => {
      if (event.key === "Shift") setEventReorderMode(true);
    });
    document.addEventListener("keyup", (event) => {
      if (event.key === "Shift") setEventReorderMode(false);
    });
    window.addEventListener("blur", () => {
      setEventReorderMode(false);
      document.body.classList.remove("event-reorder-dragging");
    });
  }

  function addStudentEvent() {
    const name = window.prompt("Название события");
    const label = String(name || "").trim();
    if (!label) return;
    const list = document.querySelector("[data-student-events-list]");
    if (!list) return;
    const key = `customEvent_${Date.now().toString(36)}`;
    const customKeys = csvList(document.querySelector("[data-event-custom-keys]")?.value);
    setCsvHidden("[data-event-custom-keys]", [...customKeys, key]);
    list.insertAdjacentHTML("beforeend", renderStudentEventRow({ key, label, custom: true }, { [`event_${key}_label`]: label }));
    const row = list.querySelector(`.student-event-row[data-event-key="${CSS.escape(key)}"]`);
    if (row) bindStudentEventRow(row);
    syncStudentEventOrder();
  }

  function deleteStudentEvent(event) {
    event.preventDefault();
    event.stopPropagation();
    const editor = document.querySelector("[data-event-editor]");
    const key = editor?.dataset.eventKey;
    const row = key ? document.querySelector(`.student-event-row[data-event-key="${CSS.escape(key)}"]`) : null;
    if (!row || !key) return;
    closeStudentEventEditor();
    if (row.dataset.eventCustom === "true") {
      setCsvHidden("[data-event-custom-keys]", csvList(document.querySelector("[data-event-custom-keys]")?.value).filter((item) => item !== key));
    } else {
      setCsvHidden("[data-event-deleted]", [...csvList(document.querySelector("[data-event-deleted]")?.value), key]);
    }
    row.remove();
    syncStudentEventOrder();
  }

  function renderStudentField(item, record) {
    const value = record[item.key] ?? "";
    const required = item.required ? "required" : "";
    const isWide = item.type === "textarea" || item.key === "program";
    const classes = [
      isWide ? "wide-field" : "",
      item.key === "manager" ? "manager-field" : "",
      item.key === "agent" ? "agent-field" : "",
      item.key === "discountDescription" ? "discount-description-label" : "",
      ["workPlace", "employmentCategory"].includes(item.key) ? "long-label-field" : ""
    ].filter(Boolean).join(" ");
    const label = `<label class="${classes}"><span>${escapeHtml(item.label)}${item.required ? " *" : ""}</span>`;
    if (item.key === "program") {
      return renderStudentProgramField(label, value, required);
    }
    if (item.key === "hours") {
      return renderProgramHoursField(label, value, required);
    }
    if (searchableStudentFields[item.key]) {
      return renderSearchableStudentField(label, item, value, required);
    }
    if (["passportIssuer", "customerPassportIssuer", "educationDocumentIssuer"].includes(item.key)) {
      return renderIssuerLookupField(label, item, value, required);
    }
    if (item.key === "educationType") {
      const programType = getProgramType(record.program, record);
      return `
        ${label}
          ${renderComboField({
            name: item.key,
            type: "search",
            value: programType,
            options: getProgramTypeOptions(programType),
            attrs: 'data-program-autofill="educationType"'
          })}
        </label>
      `;
    }
    if (item.key === "discountDescription") {
      return renderDiscountDescriptionField(label, value);
    }
    if (["inn", "customerInn"].includes(item.key)) {
      return `${label}<input name="${item.key}" type="text" value="${escapeAttr(value)}" inputmode="numeric" maxlength="12" pattern="\\d{10}|\\d{12}" autocomplete="off"></label>`;
    }
    if (["snils", "customerSnils"].includes(item.key)) {
      return `${label}<input name="${item.key}" type="text" value="${escapeAttr(value)}" inputmode="numeric" maxlength="14" autocomplete="off"></label>`;
    }
    if (item.type === "checkbox") {
      return `${label}<input name="${item.key}" type="checkbox" value="Да" ${isChecked(value) ? "checked" : ""}></label>`;
    }
    if (item.type === "textarea") {
      return `${label}<textarea name="${item.key}" ${required}>${escapeHtml(value)}</textarea></label>`;
    }
    if (item.type === "select") {
      const dictionaryOptions = item.options || state.data.dictionaries[item.dict] || [];
      const options = item.required ? dictionaryOptions : ["", ...dictionaryOptions];
      return `${label}<select name="${item.key}" ${required}>${options.map((option) => `<option ${String(option) === String(value) ? "selected" : ""}>${escapeHtml(option)}</option>`).join("")}</select></label>`;
    }
    return `${label}<input name="${item.key}" type="${item.type}" value="${escapeAttr(value)}" ${required}></label>`;
  }

  function renderDiscountDescriptionField(label, value) {
    return `
      ${label}
        <div class="discount-description-field">
          <input name="discountDescription" type="text" value="${escapeAttr(value)}" autocomplete="off">
          <button class="icon-button discount-picker-trigger" data-action="open-discount-picker" type="button" title="Выбрать скидку" aria-label="Выбрать скидку">
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              <path d="M20 10.6V5.8A1.8 1.8 0 0 0 18.2 4h-4.8a2 2 0 0 0-1.4.6l-7.4 7.4a2 2 0 0 0 0 2.8l4.6 4.6a2 2 0 0 0 2.8 0l7.4-7.4a2 2 0 0 0 .6-1.4z"></path>
              <circle cx="16.2" cy="7.8" r="1"></circle>
              <path d="M8.6 15.4l6.8-6.8"></path>
              <circle cx="9.2" cy="9.2" r="1"></circle>
              <circle cx="14.8" cy="14.8" r="1"></circle>
            </svg>
          </button>
        </div>
      </label>
    `;
  }

  function getDiscountOptionKey(groupIndex, itemIndex) {
    return `${groupIndex}:${itemIndex}`;
  }

  function getDefaultDiscountRuleValues() {
    return discountGroups.flatMap((group) => [
      `# ${group.title}`,
      ...group.items.map((item) => item.separator
        ? item.separator
        : `${item.rates.join(",")}; ${item.title}`)
    ]);
  }

  function parseDiscountRuleValues(values = []) {
    const groups = [];
    let currentGroup = null;
    const ensureGroup = () => {
      if (!currentGroup) {
        currentGroup = { title: "СКИДКИ", items: [] };
        groups.push(currentGroup);
      }
      return currentGroup;
    };
    (values || []).forEach((raw) => {
      const line = String(raw || "").trim();
      if (!line) return;
      if (line.startsWith("#")) {
        currentGroup = { title: line.replace(/^#+\s*/, "").trim() || "СКИДКИ", items: [] };
        groups.push(currentGroup);
        return;
      }
      if (/^или$/i.test(line)) {
        ensureGroup().items.push({ separator: "или" });
        return;
      }
      const match = line.match(/^([\d\s,.;]+)\s*;\s*(.+)$/);
      if (!match) return;
      const rates = match[1]
        .split(/[,\s]+/)
        .map((value) => Number(String(value).replace(",", ".")))
        .filter((value) => Number.isFinite(value) && value > 0 && value <= 100);
      const title = match[2].trim();
      if (!rates.length || !title) return;
      ensureGroup().items.push({ rates: unique(rates), title });
    });
    return groups.filter((group) => group.items.length);
  }

  function getDiscountGroups() {
    return parseDiscountRuleValues(state.data.dictionaries.discountRules || []);
  }

  function getFlatDiscountOptions() {
    return getDiscountGroups().flatMap((group, groupIndex) => (
      group.items
        .map((item, itemIndex) => ({ ...item, groupTitle: group.title, key: getDiscountOptionKey(groupIndex, itemIndex) }))
        .filter((item) => !item.separator)
    ));
  }

  function getDiscountPickerState(record = {}) {
    const picker = state.discountPicker || {};
    const description = String(picker.description ?? record.discountDescription ?? "").trim();
    const option = findDiscountOptionByKey(picker.key)
      || getFlatDiscountOptions().find((item) => item.title === description)
      || getFlatDiscountOptions().find((item) => item.rates.includes(Number(picker.percent ?? record.discount ?? 0)))
      || getFlatDiscountOptions()[0];
    const percent = Number(picker.percent ?? record.discount ?? 0) || option?.rates?.[0] || 0;
    return {
      key: picker.key || option?.key || "",
      description: description || option?.title || "",
      percent
    };
  }

  function renderDiscountPicker(record) {
    const picker = getDiscountPickerState(record);
    const groups = getDiscountGroups();
    const flatOptions = getFlatDiscountOptions();
    const selectedOption = flatOptions.find((item) => item.key === picker.key)
      || flatOptions.find((item) => item.title === picker.description);
    const selectedRates = selectedOption?.rates || (picker.percent ? [picker.percent] : []);
    const selectedPercent = picker.percent || selectedRates[0] || 0;
    return `
      <div class="discount-picker-backdrop" role="presentation">
        <section class="discount-picker" role="dialog" aria-modal="true" aria-label="Скидки">
          <header class="discount-picker-head">
            <h3>Скидки</h3>
            <button class="icon-button" data-action="close-discount-picker" type="button" title="Закрыть" aria-label="Закрыть">
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M7 7l10 10"></path><path d="M17 7L7 17"></path></svg>
            </button>
          </header>
          <div class="discount-picker-body">
            <div class="discount-picker-list-wrap">
              <div class="discount-picker-hint">
                <span>Перечень доступных скидок</span>
                <button class="ghost-button discount-picker-tool-button discount-refresh-button" data-action="refresh-discount-picker" type="button" title="Обновить список из справочника">
                  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 12a8 8 0 0 1 13.7-5.7"></path><path d="M18 4v5h-5"></path><path d="M20 12a8 8 0 0 1-13.7 5.7"></path><path d="M6 20v-5h5"></path></svg>
                  <span>Обновить</span>
                </button>
                <button class="ghost-button discount-picker-tool-button discount-restore-button" data-action="restore-default-discount-rules" type="button" title="Восстановить исходный перечень">
                  <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M3 12a9 9 0 1 0 3-6.7"></path><path d="M3 4v6h6"></path><path d="M12 8v5l3 2"></path></svg>
                  <span>Восстановить</span>
                </button>
              </div>
              <div class="discount-picker-list">
                ${groups.length ? groups.map((group, groupIndex) => `
                  <div class="discount-group-title">${escapeHtml(group.title)}</div>
                  ${group.items.map((item, itemIndex) => item.separator
                    ? `<div class="discount-separator">${escapeHtml(item.separator)}</div>`
                    : `<button class="discount-option ${picker.key === getDiscountOptionKey(groupIndex, itemIndex) ? "active" : ""}" data-action="select-discount-option" data-key="${getDiscountOptionKey(groupIndex, itemIndex)}" type="button">
                        <strong>${escapeHtml(item.rates.join(","))};</strong>
                        <span>${escapeHtml(item.title)}</span>
                      </button>`
                  ).join("")}
                `).join("") : `<div class="discount-empty discount-list-empty">Справочник скидок пуст. Восстановите исходный перечень или добавьте значения в справочнике.</div>`}
              </div>
            </div>
            <aside class="discount-picker-side">
              <label class="discount-rate-box">
                <span>Величина скидки</span>
                <div class="discount-rate-list">
                  ${selectedRates.length ? selectedRates.map((rate) => `
                    <button class="${Number(rate) === Number(selectedPercent) ? "active" : ""}" data-action="select-discount-rate" data-rate="${rate}" type="button" aria-pressed="${Number(rate) === Number(selectedPercent) ? "true" : "false"}">${rate}</button>
                  `).join("") : `<span class="discount-empty">Нет</span>`}
                </div>
              </label>
              <label class="discount-total-box">
                <span>Суммарная скидка, %</span>
                <output>${escapeHtml(selectedPercent)}</output>
              </label>
              <label class="discount-note-box">
                <span>Примечание</span>
                <textarea data-discount-note>${escapeHtml(picker.description)}</textarea>
              </label>
            </aside>
          </div>
          <footer class="discount-picker-actions">
            <button class="primary-button discount-apply-button" data-action="apply-discount-picker" type="button">
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M5 13l4 4L19 7"></path></svg>
              <span>Применить</span>
            </button>
            <button class="ghost-button discount-cancel-button" data-action="close-discount-picker" type="button">
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M7 7l10 10"></path><path d="M17 7L7 17"></path></svg>
              <span>Отмена</span>
            </button>
          </footer>
        </section>
      </div>
    `;
  }

  function renderStudentProgramField(label, value, required) {
    const programNames = unique([
      ...getProgramRows().map((program) => program.name).filter(Boolean),
      value
    ].filter(Boolean));
    return `
      ${label}
        ${renderComboField({
          name: "program",
          type: "search",
          value,
          required,
          options: programNames,
          action: "set-student-program"
        })}
      </label>
    `;
  }

  function renderSearchableStudentField(label, item, value, required) {
    const config = searchableStudentFields[item.key];
    const options = getLookupOptions(config);
    return `
      ${label}
        ${renderComboField({
          name: item.key,
          type: "search",
          value,
          required,
          options
        })}
      </label>
    `;
  }

  function renderComboField({ name, type = "text", value = "", required = "", options = [], action = "", attrs = "" }) {
    const normalizedOptions = unique(options.map((option) => String(option)).filter(Boolean));
    return `
      <div class="combo-field" data-combo-field>
        <div class="combo-input-wrap">
          <input
            name="${escapeAttr(name)}"
            type="${escapeAttr(type)}"
            value="${escapeAttr(value)}"
            autocomplete="off"
            data-combo-input
            ${action ? `data-action="${escapeAttr(action)}"` : ""}
            ${attrs}
            ${required}
          >
          <button class="combo-clear" data-action="clear-combo-value" type="button" title="Очистить" aria-label="Очистить значение">
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M7 7l10 10"></path><path d="M17 7L7 17"></path></svg>
          </button>
        </div>
        <div class="combo-options" data-combo-options>
          ${normalizedOptions.map((option) => `
            <button data-action="select-combo-value" data-value="${escapeAttr(option)}" type="button">
              ${escapeHtml(option)}
            </button>
          `).join("") || `<span class="combo-empty">Нет значений</span>`}
        </div>
      </div>
    `;
  }

  function renderIssuerLookupField(label, item, value, required) {
    const options = item.key === "educationDocumentIssuer"
      ? getEducationDocumentIssuerOptions(value)
      : getPassportIssuerOptions(value);
    return `
      ${label}
        <div class="lookup-field">
          <textarea name="${item.key}" ${required}>${escapeHtml(value)}</textarea>
          <button class="icon-button lookup-trigger" data-action="open-field-lookup" data-field="${item.key}" type="button" title="Найти в базе" aria-label="Найти в базе">
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="11" cy="11" r="6"></circle><path d="M16 16l4 4"></path></svg>
          </button>
          <button class="icon-button lookup-clear" data-action="clear-lookup-value" data-field="${item.key}" type="button" title="Очистить" aria-label="Очистить значение">
            <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M7 7l10 10"></path><path d="M17 7L7 17"></path></svg>
          </button>
          <div class="lookup-panel" data-lookup-panel="${item.key}">
            <input class="lookup-search" data-action="filter-lookup-values" data-field="${item.key}" type="search" placeholder="Поиск по базе" autocomplete="off">
            <div class="lookup-list">
              ${options.map((option) => `
                <button data-action="select-lookup-value" data-field="${item.key}" data-value="${escapeAttr(option)}" type="button">
                  ${escapeHtml(option)}
                </button>
              `).join("") || `<span class="lookup-empty">Значений пока нет</span>`}
            </div>
          </div>
        </div>
      </label>
    `;
  }

  function getProgramRows() {
    return state.data.collections.programs || [];
  }

  function findProgramByName(name) {
    return findProgramInRows(getProgramRows(), name);
  }

  function getStudentGroupNumber(programName, startDate) {
    return buildStudentGroupNumber(programName, startDate, getProgramRows());
  }

  function generateStudentGroupNumber() {
    const form = document.getElementById("recordForm");
    if (!form || form.dataset.config !== "students") return;
    const programName = String(form.querySelector("[name='program']")?.value || state.modal?.draft?.program || "").trim();
    const startDate = String(form.querySelector("[name='startDate']")?.value || state.modal?.draft?.startDate || "").trim();
    const program = findProgramByName(programName);
    if (!programName || !program) {
      alert("Выберите программу обучения из реестра программ.");
      form.querySelector("[name='program']")?.focus();
      return;
    }
    if (!String(program.groupIndex || "").trim()) {
      alert("Для выбранной программы в реестре не указан индекс группы.");
      return;
    }
    if (!startDate) {
      alert("Заполните дату начала обучения.");
      form.querySelector("[name='startDate']")?.focus();
      return;
    }
    const group = getStudentGroupNumber(programName, startDate);
    if (!group) {
      alert("Не удалось сформировать номер группы. Проверьте программу и дату начала обучения.");
      return;
    }
    const groupInput = form.querySelector("[name='group']");
    if (!groupInput) return;
    groupInput.value = group;
    groupInput.dispatchEvent(new Event("input", { bubbles: true }));
    groupInput.dispatchEvent(new Event("change", { bubbles: true }));
    state.modal.draft = {
      ...(state.modal.draft || {}),
      program: programName,
      startDate,
      group
    };
    state.modal.hasDraftChanges = true;
    groupInput.focus({ preventScroll: true });
  }

  function generatePortalPassword() {
    const form = document.getElementById("recordForm");
    const loginInput = form?.querySelector("[name='login']");
    const passwordInput = form?.querySelector("[name='password']");
    if (!loginInput || !passwordInput) return;
    const currentStudent = (state.data.collections.students || [])
      .find((student) => student.id === state.modal?.id) || {};
    const email = String(
      form.querySelector("[name='email']")?.value
      || state.modal?.draft?.email
      || currentStudent.email
      || ""
    ).trim();
    const emailParts = email.split("@");
    const generatedLogin = emailParts.length > 1 ? emailParts[0].trim().toLowerCase() : "";
    if (!generatedLogin) {
      alert("Заполните корректный адрес электронной почты слушателя. Логин формируется из части адреса до символа @.");
      return;
    }
    if (passwordInput.value && !confirm("Пароль уже заполнен. Заменить его новым шестизначным паролем?")) return;
    const random = new Uint32Array(1);
    crypto.getRandomValues(random);
    loginInput.value = generatedLogin;
    passwordInput.value = String(random[0] % 1000000).padStart(6, "0");
    loginInput.dispatchEvent(new Event("input", { bubbles: true }));
    loginInput.dispatchEvent(new Event("change", { bubbles: true }));
    passwordInput.dispatchEvent(new Event("input", { bubbles: true }));
    passwordInput.dispatchEvent(new Event("change", { bubbles: true }));
    state.modal.draft = {
      ...(state.modal.draft || {}),
      email,
      login: loginInput.value,
      password: passwordInput.value
    };
    state.modal.hasDraftChanges = true;
    passwordInput.focus({ preventScroll: true });
    passwordInput.select();
  }

  function updatePortalAccessMessage() {
    const form = document.getElementById("recordForm");
    const messageInput = form?.querySelector("[name='portalAccessMessage']");
    if (!form || !messageInput || form.dataset.config !== "students") return;
    const currentStudent = (state.data.collections.students || [])
      .find((student) => student.id === state.modal?.id) || {};
    const values = {
      ...currentStudent,
      ...(state.modal?.draft || {}),
      login: String(form.querySelector("[name='login']")?.value || ""),
      password: String(form.querySelector("[name='password']")?.value || "")
    };
    const generated = generateStudentCommunicationMessages(values).portalAccessMessage || "";
    messageInput.value = generated;
    state.modal.draft = {
      ...(state.modal.draft || {}),
      login: values.login,
      password: values.password,
      portalAccessMessage: ""
    };
    state.modal.hasDraftChanges = true;
  }

  function getMoodleLoginUrl() {
    const configured = getSdoSettingValue("portalUrl").trim();
    if (!configured) return "";
    try {
      const portalUrl = new URL(/^https?:\/\//i.test(configured) ? configured : `https://${configured}`);
      portalUrl.search = "";
      portalUrl.hash = "";
      if (!/\/login\/index\.php\/?$/i.test(portalUrl.pathname)) {
        portalUrl.pathname = `${portalUrl.pathname.replace(/\/+$/, "")}/login/index.php`;
      }
      return portalUrl.toString();
    } catch (error) {
      return "";
    }
  }

  function openMoodlePortal() {
    const form = document.getElementById("recordForm");
    const username = String(form?.querySelector("[name='login']")?.value || "").trim();
    const password = String(form?.querySelector("[name='password']")?.value || "");
    if (!username) {
      alert("Заполните логин для портала.");
      form?.querySelector("[name='login']")?.focus();
      return;
    }
    if (!password) {
      alert("Заполните или сгенерируйте пароль для портала.");
      form?.querySelector("[name='password']")?.focus();
      return;
    }
    const loginUrl = getMoodleLoginUrl();
    if (!loginUrl) {
      alert("Укажите корректный адрес портала в справочнике «Настройки СДО».");
      return;
    }

    const targetName = `moodlePortal${Date.now()}`;
    const portalWindow = window.open("about:blank", targetName);
    if (!portalWindow) {
      alert("Браузер заблокировал открытие портала. Разрешите всплывающие окна для этого сайта.");
      return;
    }
    const actionUrl = new URL(loginUrl);
    actionUrl.searchParams.set("loginredirect", "1");
    const loginForm = document.createElement("form");
    loginForm.method = "post";
    loginForm.action = actionUrl.toString();
    loginForm.target = targetName;
    loginForm.hidden = true;
    [
      ["anchor", ""],
      ["username", username],
      ["password", password],
      ["rememberusername", "1"]
    ].forEach(([name, value]) => {
      const input = document.createElement("input");
      input.type = "hidden";
      input.name = name;
      input.value = value;
      loginForm.appendChild(input);
    });
    document.body.appendChild(loginForm);
    loginForm.submit();
    loginForm.remove();
  }

  function exportStudentToSdo() {
    const record = collectStudentFormDraft();
    const uploadUsersUrl = normalizeExternalUrl(getSdoSettingValue("uploadUsersUrl"));
    if (!uploadUsersUrl) {
      alert("Укажите корректный адрес страницы загрузки пользователей в справочнике «Настройки СДО».");
      return;
    }
    const login = String(record.login || "").trim();
    const password = String(record.password || "");
    const email = String(record.email || "").trim();
    const nameParts = splitStudentNameForSdo(record.name);
    const program = findProgramByName(record.program);
    const cohort = String(program?.groupIndex || "").trim();
    const required = [
      [login, "Заполните логин для портала.", "login"],
      [password, "Заполните пароль для портала.", "password"],
      [nameParts.lastname, "Заполните ФИО слушателя.", ""],
      [email, "Заполните Email слушателя.", ""],
      [String(record.program || "").trim(), "Выберите программу обучения.", ""],
      [cohort, "Для выбранной программы в реестре не указан индекс группы.", ""]
    ];
    const missing = required.find(([value]) => !value);
    if (missing) {
      alert(missing[1]);
      if (missing[2]) document.querySelector(`[name="${missing[2]}"]`)?.focus({ preventScroll: true });
      return;
    }
    const columns = ["username", "password", "firstname", "lastname", "email", "cohort1"];
    const values = [login, password, nameParts.firstname, nameParts.lastname, email, cohort];
    const content = [
      columns.map(sdoCsvCell).join(";"),
      values.map(sdoCsvCell).join(";")
    ].join("\r\n");
    download(`ЭкспортПользователей_${formatSdoExportDate(new Date())}.csv`, `\ufeff${content}`, "text/csv;charset=utf-8");
    openExternalUrl(uploadUsersUrl);
  }

  function splitStudentNameForSdo(value) {
    const parts = String(value || "").trim().replace(/\s+/g, " ").split(" ").filter(Boolean);
    const lastname = parts.shift() || "";
    return {
      firstname: parts.join(" ") || lastname,
      lastname
    };
  }

  function sdoCsvCell(value) {
    const text = String(value ?? "").trim().replace(/\s{2,}/g, " ");
    return /[;"\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  }

  function formatSdoExportDate(date) {
    return [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, "0"),
      String(date.getDate()).padStart(2, "0")
    ].join(".");
  }

  function getProgramPromoUrl(program) {
    if (!program) return "";
    const rawValue = [
      program.promoSite,
      program.promoUrl,
      program.promoWebsite,
      program.landingUrl,
      program.siteUrl,
      program.website,
      program.url,
      program["На промо сайте"],
      program["Промосайт"],
      program["Промо сайт"]
    ].find((value) => String(value || "").trim());
    return normalizeExternalUrl(rawValue);
  }

  function getProgramPromoButtonTitle(url) {
    return url ? `Перейти на промосайт программы\n${url}` : "Перейти на промосайт программы";
  }

  function updateStudentProgramPromoTitle(programName) {
    const button = document.querySelector("[data-action='open-student-program-promo']");
    if (!button) return;
    const url = getProgramPromoUrl(findProgramByName(programName));
    const title = getProgramPromoButtonTitle(url);
    button.title = title;
    button.setAttribute("aria-label", title);
  }

  function getProgramType(programName, record = {}) {
    const program = findProgramByName(programName);
    return program?.type || record.educationType || "";
  }

  function getProgramTypeOptions(value = "") {
    return unique([
      ...getProgramRows().map((program) => program.type).filter(Boolean),
      value
    ].map((item) => String(item).trim()).filter(Boolean)).sort((a, b) => a.localeCompare(b, "ru"));
  }

  function getLookupOptions(config, extraValues = []) {
    const dictionaryValues = state.data.dictionaries[config.dict] || [];
    const rowValues = (config.fields || []).flatMap(([collection, key]) => (
      state.data.collections[collection] || []
    ).map((row) => row[key]).filter(Boolean));
    return unique([...dictionaryValues, ...rowValues, ...extraValues].map((value) => String(value).trim()).filter(Boolean)).sort((a, b) => a.localeCompare(b, "ru"));
  }

  function getPassportIssuerOptions(currentValue = "") {
    return getLookupOptions({
      dict: "passportIssuers",
      fields: [["students", "passportIssuer"], ["students", "customerPassportIssuer"]]
    }, [currentValue]);
  }

  function getEducationDocumentIssuerOptions(currentValue = "") {
    return getLookupOptions({
      dict: "educationDocumentIssuers",
      fields: [["students", "educationDocumentIssuer"]]
    }, [currentValue]);
  }

  function todayIso() {
    const date = new Date();
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  function normalizeEventState(stateValue, dateValue = "") {
    if (stateValue === "dated" || stateValue === "checked") return stateValue;
    if (dateValue) return "dated";
    return "";
  }

  function nextEventState(stateValue) {
    if (!stateValue) return "dated";
    if (stateValue === "dated") return "checked";
    return "";
  }

  function updateStudentEventRow(row) {
    const key = row.dataset.eventKey;
    const checkbox = row.querySelector("input[type='checkbox']");
    const stateInput = row?.querySelector(`[data-event-state="${key}"]`);
    const dateInput = row?.querySelector(`[data-event-date="${key}"]`);
    const dateLabel = row?.querySelector(`[data-event-date-label="${key}"]`);
    if (!row || !stateInput || !dateInput || !dateLabel) return;
    const nextState = nextEventState(normalizeEventState(stateInput.value, dateInput.value));
    stateInput.value = nextState;
    dateInput.value = nextState === "dated" ? todayIso() : "";
    checkbox.checked = Boolean(nextState);
    row.classList.toggle("is-selected", Boolean(nextState));
    row.classList.toggle("has-date", nextState === "dated");
    dateLabel.textContent = nextState === "dated" ? dateRu(dateInput.value) : "";
  }

  function openStudentEventEditor(row, clientX = 0, clientY = 0) {
    const key = row.dataset.eventKey;
    const editor = document.querySelector("[data-event-editor]");
    const dateInput = editor?.querySelector("[data-event-editor-date]");
    const labelInput = editor?.querySelector("[data-event-editor-label]");
    const dateValue = row.querySelector(`[data-event-date="${key}"]`)?.value || "";
    const labelValue = row.querySelector(`[data-event-label-value="${key}"]`)?.value || row.querySelector("[data-event-label-text]")?.textContent || "";
    if (!editor || !dateInput || !labelInput) return;
    document.querySelectorAll(".student-event-row.is-editing").forEach((item) => item.classList.remove("is-editing"));
    row.classList.add("is-editing");
    editor.dataset.eventKey = key;
    dateInput.value = dateValue;
    labelInput.value = labelValue;
    editor.hidden = false;
    const rect = editor.parentElement.getBoundingClientRect();
    editor.style.left = `${clamp(clientX - rect.left, 8, Math.max(8, rect.width - 320))}px`;
    editor.style.top = `${clamp(clientY - rect.top, 8, Math.max(8, rect.height - 132))}px`;
    labelInput.focus({ preventScroll: true });
    labelInput.select();
  }

  function closeStudentEventEditor() {
    const editor = document.querySelector("[data-event-editor]");
    if (!editor) return;
    editor.hidden = true;
    editor.dataset.eventKey = "";
    document.querySelectorAll(".student-event-row.is-editing").forEach((item) => item.classList.remove("is-editing"));
  }

  function applyStudentEventEditor() {
    const editor = document.querySelector("[data-event-editor]");
    const key = editor?.dataset.eventKey;
    const row = key ? document.querySelector(`.student-event-row[data-event-key="${CSS.escape(key)}"]`) : null;
    const dateInput = editor?.querySelector("[data-event-editor-date]");
    const labelInput = editor?.querySelector("[data-event-editor-label]");
    if (!editor || !key || !row || !dateInput || !labelInput) return;
    const stateInput = row.querySelector(`[data-event-state="${key}"]`);
    const dateHidden = row.querySelector(`[data-event-date="${key}"]`);
    const labelHidden = row.querySelector(`[data-event-label-value="${key}"]`);
    const dateLabel = row.querySelector(`[data-event-date-label="${key}"]`);
    const labelText = row.querySelector(`[data-event-label-text="${key}"]`);
    const newDate = dateInput.value || "";
    const newLabel = labelInput.value.trim();
    if (dateHidden) dateHidden.value = newDate;
    if (labelHidden && newLabel) labelHidden.value = newLabel;
    if (labelText && newLabel) {
      labelText.textContent = newLabel;
      labelText.title = newLabel;
    }
    if (dateLabel) dateLabel.textContent = newDate ? dateRu(newDate) : "";
    if (stateInput) stateInput.value = newDate ? "dated" : (stateInput.value ? "checked" : "");
    const checkbox = row.querySelector("input[type='checkbox']");
    const isSelected = Boolean(stateInput?.value);
    if (checkbox) checkbox.checked = isSelected;
    row.classList.toggle("is-selected", isSelected);
    row.classList.toggle("has-date", stateInput?.value === "dated");
    closeStudentEventEditor();
  }

  function closeComboPanels(except = null) {
    document.querySelectorAll("[data-combo-field].is-open").forEach((field) => {
      if (field !== except) field.classList.remove("is-open");
    });
  }

  function filterComboOptions(input) {
    const field = input.closest("[data-combo-field]");
    const query = input.value.trim().toLowerCase();
    field?.querySelectorAll("[data-action='select-combo-value']").forEach((button) => {
      button.hidden = query && !button.textContent.toLowerCase().includes(query);
    });
  }

  function isChecked(value) {
    if (value === true || value === 1) return true;
    const normalized = String(value || "").trim().toLowerCase();
    if (!normalized || ["нет", "не", "false", "0", "off"].includes(normalized)) return false;
    return true;
  }

  function paymentRowHasData(record, index) {
    return Boolean(record[`payment${index}Date`] || record[`payment${index}Amount`] || record[`payment${index}Note`]);
  }

  function getOpenPaymentRowIndexes() {
    return (state.openPaymentRows || [])
      .map((value) => Number(value))
      .filter((value) => Number.isInteger(value) && value >= 1 && value <= 8);
  }

  function getVisiblePaymentRowIndexes(record) {
    const openRows = new Set(getOpenPaymentRowIndexes());
    return Array.from({ length: 8 }, (_, index) => index + 1)
      .filter((index) => paymentRowHasData(record, index) || openRows.has(index));
  }

  function getNextAvailablePaymentRowIndex(record) {
    const openRows = new Set(getOpenPaymentRowIndexes());
    const hasOpenEmptyRow = [...openRows].some((index) => !paymentRowHasData(record, index));
    if (hasOpenEmptyRow) return "";
    return Array.from({ length: 8 }, (_, index) => index + 1)
      .find((index) => !paymentRowHasData(record, index) && !openRows.has(index)) || "";
  }

  function renderPaymentRows(record) {
    const rowIndexes = getVisiblePaymentRowIndexes(record);
    const nextPaymentRow = getNextAvailablePaymentRowIndex(record);
    return `
      <section class="form-section">
        <div class="payment-section-head">
          <h3>Оплаты слушателя</h3>
          <button class="ghost-button payment-add-button" data-action="add-payment-row" type="button" ${nextPaymentRow ? "" : "disabled"}>Добавить</button>
        </div>
        ${rowIndexes.length ? `<div class="editable-grid payment-grid">
          <div class="editable-grid-head">№</div>
          <div class="editable-grid-head">Дата</div>
          <div class="editable-grid-head">Сумма</div>
          <div class="editable-grid-head">Примечание</div>
          <div class="editable-grid-head"></div>
          ${rowIndexes.map((n) => {
            const hasPayment = paymentRowHasData(record, n);
            return `
              <div class="editable-grid-row payment-grid-row">
                <div class="editable-grid-cell row-number-cell" data-label="№"><strong class="editable-grid-row-number">${n}</strong></div>
                <label class="editable-grid-cell" data-label="Дата">
                  <input name="payment${n}Date" data-payment-index="${n}" type="date" value="${escapeAttr(record[`payment${n}Date`] || "")}">
                </label>
                <label class="editable-grid-cell" data-label="Сумма">
                  <input name="payment${n}Amount" data-payment-index="${n}" type="number" value="${escapeAttr(record[`payment${n}Amount`] || "")}">
                </label>
                <label class="editable-grid-cell" data-label="Примечание">
                  <input name="payment${n}Note" data-payment-index="${n}" value="${escapeAttr(record[`payment${n}Note`] || "")}">
                </label>
                <div class="editable-grid-cell row-action-cell" data-label="Удалить">
                  <button
                    class="payment-row-delete"
                    data-action="delete-payment-row"
                    data-payment-index="${n}"
                    type="button"
                    title="Удалить оплату"
                    aria-label="Удалить оплату ${n}"
                    ${hasPayment ? "" : "disabled"}
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                      <path d="M3 6h18"></path>
                      <path d="M8 6V4h8v2"></path>
                      <path d="M6 6l1 15h10l1-15"></path>
                      <path d="M10 11v6"></path>
                      <path d="M14 11v6"></path>
                    </svg>
                  </button>
                </div>
              </div>
            `;
          }).join("")}
        </div>` : `<p class="payment-empty">Оплаты пока не добавлены.</p>`}
      </section>
    `;
  }

  function getPaymentRowInputs(index) {
    return ["Date", "Amount", "Note"]
      .map((suffix) => document.querySelector(`[name="payment${index}${suffix}"]`))
      .filter(Boolean);
  }

  function syncPaymentRowDeleteButton(index) {
    const button = document.querySelector(`[data-action='delete-payment-row'][data-payment-index="${index}"]`);
    if (!button) return;
    button.disabled = !getPaymentRowInputs(index).some((input) => String(input.value || "").trim());
  }

  function syncPaymentAddButton() {
    const button = document.querySelector("[data-action='add-payment-row']");
    if (!button) return;
    const draft = collectStudentFormDraft();
    button.disabled = !getNextAvailablePaymentRowIndex(draft);
  }

  function compactStudentPayments(record, deletedIndex) {
    const payments = Array.from({ length: 8 }, (_, index) => index + 1)
      .filter((index) => index !== Number(deletedIndex))
      .map((index) => ({
        date: record[`payment${index}Date`] || "",
        amount: record[`payment${index}Amount`] || "",
        note: record[`payment${index}Note`] || ""
      }))
      .filter((payment) => payment.date || payment.amount || payment.note);
    Array.from({ length: 8 }, (_, index) => index + 1).forEach((index) => {
      const payment = payments[index - 1] || {};
      record[`payment${index}Date`] = payment.date || "";
      record[`payment${index}Amount`] = payment.amount || "";
      record[`payment${index}Note`] = payment.note || "";
    });
    return record;
  }

  function clearStudentPaymentRow(index) {
    const inputs = getPaymentRowInputs(index);
    if (!inputs.length || !inputs.some((input) => String(input.value || "").trim())) return;
    if (!confirm("Удалить запись оплаты?")) return;
    if (state.modal) {
      state.modal.draft = compactStudentPayments(collectStudentFormDraft(), index);
      state.modal.hasDraftChanges = true;
    }
    state.openPaymentRows = [];
    render();
  }

  function addStudentPaymentRow() {
    if (!state.modal) return;
    const draft = collectStudentFormDraft();
    const nextIndex = getNextAvailablePaymentRowIndex(draft);
    if (!nextIndex) return;
    state.modal.draft = draft;
    state.openPaymentRows = unique([...getOpenPaymentRowIndexes(), nextIndex]);
    render();
    requestAnimationFrame(() => {
      document.querySelector(`[name="payment${nextIndex}Date"]`)?.focus({ preventScroll: true });
    });
  }

  function getStudentExpenseTypeOptions(record = {}) {
    const inventoryRows = state.data.collections.inventory || [];
    const studentTypes = (state.data.collections.students || []).flatMap((student) => (
      Array.from({ length: 6 }, (_, index) => student[`expense${index + 1}Type`])
    ));
    const currentTypes = Array.from({ length: 6 }, (_, index) => record[`expense${index + 1}Type`]);
    return unique([
      ...(state.data.dictionaries.expenseTypes || []),
      ...(state.data.dictionaries.inventoryTypes || []),
      ...studentTypes,
      ...currentTypes,
      ...(state.data.collections.directExpenses || []).map((expense) => expense.type),
      ...(state.data.collections.generalExpenses || []).map((expense) => expense.workType),
      ...inventoryRows.flatMap((item) => [item.itemType, item.note])
    ].map((value) => String(value || "").trim()).filter(Boolean));
  }

  function getStudentExpenseNoteOptions(record = {}) {
    const studentNotes = (state.data.collections.students || []).flatMap((student) => (
      Array.from({ length: 6 }, (_, index) => student[`expense${index + 1}Note`])
    ));
    const currentNotes = Array.from({ length: 6 }, (_, index) => record[`expense${index + 1}Note`]);
    const directExpenseNotes = (state.data.collections.directExpenses || []).map((expense) => expense.note);
    const generalExpenseNotes = (state.data.collections.generalExpenses || [])
      .flatMap((expense) => [expense.description, expense.otherExpenses]);
    return unique([
      ...(state.data.dictionaries.expenseNotes || []),
      ...studentNotes,
      ...currentNotes,
      ...directExpenseNotes,
      ...generalExpenseNotes
    ].map((value) => String(value || "").trim()).filter(Boolean));
  }

  function expenseRowHasData(record, index) {
    return Boolean(
      record[`expense${index}Date`] ||
      record[`expense${index}Type`] ||
      record[`expense${index}Amount`] ||
      isChecked(record[`expense${index}IsPaid`]) ||
      record[`expense${index}Note`]
    );
  }

  function getOpenExpenseRowIndexes() {
    return (state.openExpenseRows || [])
      .map((value) => Number(value))
      .filter((value) => Number.isInteger(value) && value >= 1 && value <= 6);
  }

  function getVisibleExpenseRowIndexes(record) {
    const openRows = new Set(getOpenExpenseRowIndexes());
    return Array.from({ length: 6 }, (_, index) => index + 1)
      .filter((index) => expenseRowHasData(record, index) || openRows.has(index));
  }

  function getNextAvailableExpenseRowIndex(record) {
    const openRows = new Set(getOpenExpenseRowIndexes());
    const hasOpenEmptyRow = [...openRows].some((index) => !expenseRowHasData(record, index));
    if (hasOpenEmptyRow) return "";
    return Array.from({ length: 6 }, (_, index) => index + 1)
      .find((index) => !expenseRowHasData(record, index) && !openRows.has(index)) || "";
  }

  function renderExpenseRows(record) {
    const typeOptions = getStudentExpenseTypeOptions(record);
    const noteOptions = getStudentExpenseNoteOptions(record);
    const rowIndexes = getVisibleExpenseRowIndexes(record);
    const nextExpenseRow = getNextAvailableExpenseRowIndex(record);
    return `
      <section class="form-section">
        <div class="payment-section-head">
          <h3>Расходы</h3>
          <button class="ghost-button payment-add-button" data-action="add-expense-row" type="button" ${nextExpenseRow ? "" : "disabled"}>Добавить</button>
        </div>
        ${rowIndexes.length ? `<div class="editable-grid expense-grid">
          <div class="editable-grid-head">№</div>
          <div class="editable-grid-head">Дата</div>
          <div class="editable-grid-head">Вид затрат</div>
          <div class="editable-grid-head">Сумма</div>
          <div class="editable-grid-head">Оплач.</div>
          <div class="editable-grid-head">Примечание</div>
          <div class="editable-grid-head"></div>
          ${rowIndexes.map((n) => {
            const type = record[`expense${n}Type`] || "";
            const hasExpense = expenseRowHasData(record, n);
            return `
              <div class="editable-grid-row expense-grid-row">
                <div class="editable-grid-cell row-number-cell" data-label="№"><strong class="editable-grid-row-number">${n}</strong></div>
                <label class="editable-grid-cell" data-label="Дата">
                  <input name="expense${n}Date" data-expense-index="${n}" type="date" value="${escapeAttr(record[`expense${n}Date`] || "")}">
                </label>
                <label class="editable-grid-cell" data-label="Вид затрат">
                  <select name="expense${n}Type" data-expense-index="${n}">
                    <option value=""></option>
                    ${typeOptions.map((option) => `<option ${option === type ? "selected" : ""}>${escapeHtml(option)}</option>`).join("")}
                  </select>
                </label>
                <label class="editable-grid-cell" data-label="Сумма">
                  <input name="expense${n}Amount" data-expense-index="${n}" type="number" value="${escapeAttr(record[`expense${n}Amount`] || "")}">
                </label>
                <label class="editable-grid-cell expense-paid-cell" data-label="Оплач." title="Оплачено">
                  <span class="expense-paid-check">
                    <input name="expense${n}IsPaid" data-expense-index="${n}" type="checkbox" ${isChecked(record[`expense${n}IsPaid`]) ? "checked" : ""}>
                  </span>
                </label>
                <div class="editable-grid-cell expense-note-cell" data-label="Примечание">
                  ${renderComboField({
                    name: `expense${n}Note`,
                    type: "search",
                    value: record[`expense${n}Note`] || "",
                    options: noteOptions,
                    attrs: `data-expense-index="${n}"`
                  })}
                </div>
                <div class="editable-grid-cell row-action-cell" data-label="Удалить">
                  <button
                    class="payment-row-delete"
                    data-action="delete-expense-row"
                    data-expense-index="${n}"
                    type="button"
                    title="Удалить расход"
                    aria-label="Удалить расход ${n}"
                    ${hasExpense ? "" : "disabled"}
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                      <path d="M3 6h18"></path>
                      <path d="M8 6V4h8v2"></path>
                      <path d="M6 6l1 15h10l1-15"></path>
                      <path d="M10 11v6"></path>
                      <path d="M14 11v6"></path>
                    </svg>
                  </button>
                </div>
              </div>
            `;
          }).join("")}
        </div>` : `<p class="payment-empty">Расходы пока не добавлены.</p>`}
      </section>
    `;
  }

  function getExpenseRowInputs(index) {
    return ["Date", "Type", "Amount", "IsPaid", "Note"]
      .map((suffix) => document.querySelector(`[name="expense${index}${suffix}"]`))
      .filter(Boolean);
  }

  function syncExpenseRowDeleteButton(index) {
    const button = document.querySelector(`[data-action='delete-expense-row'][data-expense-index="${index}"]`);
    if (!button) return;
    const draft = collectStudentFormDraft();
    button.disabled = !expenseRowHasData(draft, Number(index));
  }

  function syncExpenseAddButton() {
    const button = document.querySelector("[data-action='add-expense-row']");
    if (!button) return;
    const draft = collectStudentFormDraft();
    button.disabled = !getNextAvailableExpenseRowIndex(draft);
  }

  function compactStudentExpenses(record, deletedIndex) {
    const expenses = Array.from({ length: 6 }, (_, index) => index + 1)
      .filter((index) => index !== Number(deletedIndex))
      .map((index) => ({
        date: record[`expense${index}Date`] || "",
        type: record[`expense${index}Type`] || "",
        amount: record[`expense${index}Amount`] || "",
        isPaid: record[`expense${index}IsPaid`] || "",
        note: record[`expense${index}Note`] || ""
      }))
      .filter((expense) => expense.date || expense.type || expense.amount || isChecked(expense.isPaid) || expense.note);
    Array.from({ length: 6 }, (_, index) => index + 1).forEach((index) => {
      const expense = expenses[index - 1] || {};
      record[`expense${index}Date`] = expense.date || "";
      record[`expense${index}Type`] = expense.type || "";
      record[`expense${index}Amount`] = expense.amount || "";
      record[`expense${index}IsPaid`] = expense.isPaid || "";
      record[`expense${index}Note`] = expense.note || "";
    });
    return record;
  }

  function clearStudentExpenseRow(index) {
    const inputs = getExpenseRowInputs(index);
    if (!inputs.length || !expenseRowHasData(collectStudentFormDraft(), Number(index))) return;
    if (!confirm("Удалить запись расхода?")) return;
    if (state.modal) {
      state.modal.draft = compactStudentExpenses(collectStudentFormDraft(), index);
      state.modal.hasDraftChanges = true;
    }
    state.openExpenseRows = [];
    render();
  }

  function addStudentExpenseRow() {
    if (!state.modal) return;
    const draft = collectStudentFormDraft();
    const nextIndex = getNextAvailableExpenseRowIndex(draft);
    if (!nextIndex) return;
    state.modal.draft = draft;
    state.openExpenseRows = unique([...getOpenExpenseRowIndexes(), nextIndex]);
    render();
    requestAnimationFrame(() => {
      document.querySelector(`[name="expense${nextIndex}Date"]`)?.focus({ preventScroll: true });
    });
  }

  function renderLinkedExpenses(record) {
    const linked = (state.data.collections.directExpenses || []).filter((item) => String(item.uid || "") === String(record.uid || ""));
    return `
      <section class="form-section">
        <h3>Связанные прямые затраты по uid</h3>
        ${linked.length ? miniTable(linked, ["date", "type", "amount", "note", "actStatus"]) : `<div class="empty-state compact"><span>Связанных расходов пока нет</span></div>`}
      </section>
    `;
  }

  function generateStudentCommunicationMessages(record) {
    const greeting = getStudentCommunicationGreeting(record);
    const program = String(record.program || "").trim() || "образовательной программе";
    const email = String(record.email || "").trim() || "Email не указан";
    const mailingAddress = String(record.mailingAddress || "").trim() || "указанный Вами почтовый адрес";
    const postalTrack = String(record.postalTrack || "").trim();
    const isDpo = isStudentDpoProgram(record);
    const surveyUrl = "https://forms.gle/1EcHf4VwVB7rF1e6A";
    const paymentUrl = "https://yookassa.ru/my/i/Z85l1c4uVDu_/l";
    const extensionPaymentUrl = "https://yookassa.ru/my/i/Zqknfk2aqFoq/l";
    const reportUrl = getStudentProgramMessageLink(record);
    const endDate = formatStudentCommunicationDate(getStudentCommunicationEndDate(record)) || "согласованного срока";
    const endDateLong = formatStudentCommunicationLongDate(getStudentCommunicationEndDate(record)) || "согласованного срока";
    const reductionDate = formatStudentCommunicationDate(getStudentCommunicationReductionDate(record));
    const reductionDeadline = reductionDate || "согласованного с Вами срока";
    const daysLeft = getStudentCommunicationDaysLeft(record);
    const referralCode = getStudentReferralCode(record);
    const partnerCoupon = String(record.partnerCoupon || record.coupon || referralCode.toUpperCase()).trim();
    const login = String(record.login || "").trim();
    const password = String(record.password || "").trim();
    const programRecord = findProgramByName(record.program);
    const telegramGroup = String(programRecord?.telegramGroup || "").trim();
    const portalEndDate = formatStudentCommunicationPortalEndDate(getStudentCommunicationEndDate(record)) || "неограничен";
    const issueDocument = String(record.status || "").trim().toLowerCase() !== "без выдачи документа";
    const balance = Number(record.balance || 0);
    const balanceReminder = balance > 0
      ? `\n\nТакже напоминаем, что Вам нужно внести остаток оплаты за обучение ${balance} руб. по следующей ссылке - ${paymentUrl}`
      : "";
    const postalTrackBlock = postalTrack
      ? `\n\nТрек-код: ${postalTrack}\n\nДля отслеживания почтового отправления рекомендуется установить приложение Почты России - http://play.google.com/store/apps/details?id=com.octopod.russianpost.client.android`
      : "";
    const documents = isDpo
      ? "- скан паспорта с пропиской\n- СНИЛС (для граждан РФ)\n- скан документа о высшем или среднем профессиональном образовании с приложением (скан диплома)\n- сведения о месте работы и занимаемой должности (в простой текстовой форме для целей госстатистики, если не указали при подаче заявки)\n- документы о перемене ФИО, если данные в дипломе не совпадают с паспортом\n- сведения о почтовом адресе фактического места жительства с индексом (для отправки документов)\n\nДанные документы нужны для заключения договора и включения сведений в федеральный государственный реестр документов об образовании (ФРДО) по окончании Вашего обучения"
      : "- скан паспорта с пропиской\n- сведения о почтовом адресе фактического места жительства с индексом\n\nДанные документы нужны для заключения договора с последующей выдачей документа об образовании";
    const noEducationDocumentOption = isDpo
      ? ""
      : "\n\nВы можете не предоставлять данные документы, в случае отсутствия необходимости получения документа об образовании\n\nКакой вариант Вам подходит, с выдачей документа или без выдачи?";
    return renderStudentCommunicationTemplates({
      ИмяОтчество: getStudentCommunicationAddressee(record),
      ЕстьИмяОтчество: Boolean(getStudentCommunicationAddressee(record)),
      ДПО: isDpo,
      ЕстьОстатокОплаты: balance > 0,
      ОстатокОплаты: balance,
      ЕстьТрекКод: Boolean(postalTrack),
      ЕстьЛогин: Boolean(login),
      ЕстьТелеграмГруппа: Boolean(telegramGroup),
      ВыдаватьДокумент: issueDocument,
      РеферальныйКод: referralCode,
      ФИОКарточки: String(record.name || "").trim(),
      ПрограммаКарточки: program,
      EmailКарточки: email,
      АдресОтправкиКарточки: mailingAddress,
      ТрекКодКарточки: postalTrack,
      ПартнерскийКупонКарточки: partnerCoupon,
      ДнейДоОкончанияКарточки: daysLeft,
      ДатаОкончанияКарточки: endDate,
      ДатаОкончанияПрописьюКарточки: endDateLong,
      ДатаСокращенияКарточки: reductionDeadline,
      СсылкаПрограммыКарточки: reportUrl,
      ЛогинКарточки: login,
      ПарольКарточки: password,
      СрокОбученияПоКарточки: portalEndDate,
      ТелеграмГруппаПрограммыКарточки: telegramGroup
    });
    /*
     * Старый встроенный набор строк оставлен ниже как справочная копия формул XLSB.
     * Рабочие тексты собираются из редактируемого справочника шаблонов выше.
     */
    return {
      note1: `${greeting}\n\nМеня зовут Симак Роман Сергеевич, я представляю учебный центр Цифровизация Плюс.\n\nПолучили от Вас заявку на программу *${program}*, для зачисления необходимо прислать следующие документы:\n${documents}\n\nПришлите, пожалуйста, свои документы на адрес mail@edu-plus.ru, мы в ответ подготовим Вам документы для оформления на обучение (договор, анкета, согласие на обработку персональных данных и т.д.).\n\nДальнейшую переписку предлагаю вести в Телеграмме https://t.me/simakrs или Максе https://max.ru/u/f9LHodD0cOJFNLoo1J-p9xzwXq9NcNpBiO_awFVbsccTG5PS38I_pQg_iPE${noEducationDocumentOption}`,
      note2: `${greeting}\n\nМеня зовут Симак Роман Сергеевич, я представляю учебный центр Цифровизация Плюс.\n\nОтправили Вам на электронную почту (${email}) комплект документов по курсу *${program}* на подпись для зачисления (письмо могло попасть в спам).\n\nПроверьте его, пожалуйста, если все правильно, подпишите (в местах, выделенных галочкой) и отправьте скан на адрес mail@edu-plus.ru\n\nПодписать можно одним из следующих способов:\n1) Через онлайн-сервис - https://www.ilovepdf.com/ru/sign-pdf (графической подписью)\n2) С помощью сервиса Госключ (после подписи нажать Скачать подпись и отправить ее в ответном сообщении) - https://www.gosuslugi.ru/600373/1/form\n3) От руки\n\nДальнейшую переписку предлагаю вести в Телеграмме https://t.me/simakrs или Максе https://max.ru/u/f9LHodD0cOJFNLoo1J-p9xzwXq9NcNpBiO_awFVbsccTG5PS38I_pQg_iPE`,
      note3: `${greeting}\n\nПоздравляем Вас с завершением обучения по курсу *${program}* и отправляем сюда и на почту (${email}) ${isDpo ? "для согласования макет документа об образовании (проверьте, пожалуйста, личные данные)" : `электронный документ об образовании\n\nБольшая просьба оставить отзыв о пройденном курсе по следующей ссылке ${surveyUrl}`}${balanceReminder}`,
      note4: `${greeting}\n\n${isDpo ? `Отправляем Вам скан документа об образовании. Оригинал отправим по адресу: ${mailingAddress}` : "Отправляем Вам электронный документ об образовании"}\n\nБольшая просьба оставить отзыв о пройденном курсе по следующей ссылке ${surveyUrl}`,
      note5: `${greeting}\n\nОтправили Вам документ об образовании на адрес: ${mailingAddress}${postalTrackBlock}\n\nБольшая просьба оставить отзыв о пройденном курсе по следующей ссылке ${surveyUrl}`,
      note6: `${greeting}\n\nБлагодарим за сотрудничество и дарим купон на дополнительную скидку в 15% на последующее обучение: NEXT15\n\nИ еще одна просьба, сможете отправить своим коллегам, знакомым, разместить в своих соцсетях следующую рекомендацию по нашим курсам?\n\nРекомендую учебный центр Цифровизация Плюс (https://edu-plus.ru?utm_source=${referralCode})\n\nПовышение квалификации, переподготовка, отличный сервис, качество обучения и оперативность.\n\nВот купон на дополнительную скидку в 10% на программы повышения квалификации и переподготовки: SALE10`,
      note7: `${greeting}\n\nДо окончания Вашего обучения по курсу *${program}* остается ${daysLeft} дн.\n\nЧтобы успеть выполнить все до ${endDateLong} рекомендуется активизировать учебный процесс.\n\nДля просмотра текущих оценок по всем дисциплинам/модулям можете воспользоваться следующей ссылкой - ${reportUrl}\n\nВам нужно выполнить задания по всем дисциплинам/модулям и затем пройти итоговую аттестацию до окончания обучения (проходной балл - не менее 50%: оценка <удовлетворительно> от 50% до 69%, оценка <хорошо> от 70% до 89%, оценка <отлично> 90% и выше)\n\n${isDpo ? "После выполнения всех заданий и прохождения итоговой аттестации по окончанию срока обучения направим Вам макет документа об образовании для согласования" : "После выполнения всех заданий и прохождения итоговой аттестации по окончанию срока обучения направим электронный документ об образовании"}\n\nС уважением, Симак Роман Сергеевич\nУчебный центр Цифровизация Плюс`,
      note8: `${greeting}\n\nВы досрочно освоили образовательную программу ${program}.\n\nПредлагаем Вам сократить срок обучения до ${reductionDeadline} (с учетом нормативной продолжительности обучения) для более быстрого получения документа об образовании, заключив дополнительное соглашение к договору\n\nНа всякий случай, отправили Вам на электронную почту (${email}) комплект документов на подпись для сокращения обучения на курсах до ${reductionDeadline} (проверьте его, пожалуйста, если все правильно, подпишите и отправьте скан на адрес mail@edu-plus.ru)`,
      note9: `${greeting}\n\nБлагодарим Вас за сотрудничество и дарим купон на дополнительную скидку в 15% на последующее обучение: ${partnerCoupon}\n\nДанный купон является бессрочным и действует в рамках нашей партнерской программы (https://forms.gle/ArBUi5SB3sw6JHzt6). Вы получите скидку и кэшбэк за свое последующее обучение, а также дополнительный доход от регистраций по купону других слушателей в соответствии с условиями партнерской программы\n\nИ еще одна просьба, сможете отправить своим коллегам, знакомым, разместить в своих соцсетях следующую рекомендацию по нашим курсам?\n\nРекомендую учебный центр Цифровизация Плюс (https://edu-plus.ru?utm_source=${referralCode})\n\nПовышение квалификации, переподготовка, отличный сервис, качество обучения и оперативность.\n\nВот купон на дополнительную скидку в 15% на программы повышения квалификации и переподготовки: ${partnerCoupon}`,
      note10: `${greeting}\n\nВаш срок обучения по программе ${program} подошел к концу - ${endDate}, но программа не освоена в полном объеме.\n\nПредлагаем Вам на выбор два варианта:\n1) Бесплатно продлить срок обучения до ${reductionDeadline}, заключив дополнительное соглашение к договору (не более 1 раза, затем ПЛАТНО 1000 руб. за каждое последующее продление).\n2) Отчислить Вас без выдачи документа об образовании с последующей возможностью бесплатного восстановления (не более 1 раза, затем ПЛАТНО 1000 руб. за каждое последующее восстановление)\n\nНа всякий случай, отправили Вам на электронную почту (${email}) комплект документов на подпись для продления обучения на курсах до ${reductionDeadline} (проверьте его, пожалуйста, если все правильно, подпишите и отправьте скан на адрес mail@edu-plus.ru)\n\nПлатное продление возможно не более двух раз, затем полная оплата курса с заключением нового договора`,
      note11: `${greeting}\n\nВаш срок обучения по программе ${program} подошел к концу - ${endDate}, но программа ПОВТОРНО не освоена в полном объеме.\n\nПредлагаем Вам на выбор два варианта:\n1) ПЛАТНО продлить срок обучения до ${reductionDeadline}, заключив дополнительное соглашение к договору (платно 1000 руб. за каждое продление).\n2) Отчислить Вас без выдачи документа об образовании с последующей возможностью ПЛАТНОГО восстановления (платно 1000 руб. за каждое последующее восстановление)\n\nСсылка на оплату: ${extensionPaymentUrl}\n\nПлатное продление возможно не более двух раз, затем полная оплата курса с заключением нового договора`,
      note12: `${greeting}\n\nОтправляем Вам ссылку для участия в мероприятии ${program} - ${reportUrl}\n\nОтправляем Вам электронный сертификат сюда и на электронную почту (${email}) вместе с записью вебинара\n\nБольшая просьба оставить отзыв, можно написать сюда и прикрепить фотографию (или можем взять из Вашего профиля в вацапе) и мы с Вашего разрешения опубликуем его на странице вебинара\n\nТакже просим заполнить анкету по адресу ${surveyUrl}\n\nПодписывайтесь на наши группы в Телеграм (https://t.me/zifra_plus) и Вконтакте (https://vk.com/zifra_plus)\n\nС уважением, Симак Роман Сергеевич`
    };
  }

  function renderStudentCommunicationTemplates(fields) {
    const templates = normalizeCommunicationTemplates(state.data.dictionaries.communicationTemplates);
    return Object.fromEntries(studentCommunicationMessages.map((message, index) => [
      message.key,
      applyStudentCommunicationTemplate(templates[index], fields)
    ]));
  }

  function applyStudentCommunicationTemplate(template, fields) {
    const definitions = new Map(getCommunicationTemplateFieldDefinitions().map((field) => [field.name, field]));
    const resolveFormula = (formula, stack = []) => {
      let source = resolveStudentCommunicationFormulaConditions(String(formula || ""), fields);
      source = source.replace(/\{([^{}]+)\}/g, (match, fieldName) => {
        if (stack.includes(fieldName)) {
          return Object.prototype.hasOwnProperty.call(fields, fieldName) ? String(fields[fieldName] ?? "") : match;
        }
        const definition = definitions.get(fieldName);
        if (definition) return resolveFormula(definition.formula, [...stack, fieldName]);
        return Object.prototype.hasOwnProperty.call(fields, fieldName) ? String(fields[fieldName] ?? "") : match;
      });
      return resolveStudentCommunicationFormulaConditions(source, fields);
    };
    return resolveFormula(template);
  }

  function resolveStudentCommunicationFormulaConditions(formula, fields) {
    const pattern = /\{\{если:([^{}]+)\}\}((?:(?!\{\{если:|\{\{конец\}\})[\s\S])*)\{\{конец\}\}/g;
    let result = String(formula || "");
    let previous = "";
    while (result !== previous) {
      previous = result;
      result = result.replace(pattern, (match, condition, content) => {
        const delimiter = content.indexOf("{{иначе}}");
        const positive = delimiter >= 0 ? content.slice(0, delimiter) : content;
        const negative = delimiter >= 0 ? content.slice(delimiter + "{{иначе}}".length) : "";
        return isStudentCommunicationFormulaConditionTrue(condition, fields) ? positive : negative;
      });
    }
    return result;
  }

  function isStudentCommunicationFormulaConditionTrue(condition, fields) {
    const normalized = String(condition || "").trim();
    const inverted = normalized.startsWith("!");
    const fieldName = inverted ? normalized.slice(1).trim() : normalized;
    const value = fields[fieldName];
    const truthy = value === true
      || Number(value) > 0
      || ["да", "true", "истина"].includes(String(value || "").trim().toLowerCase());
    return inverted ? !truthy : truthy;
  }

  function getStudentCommunicationGreeting(record) {
    const addressee = getStudentCommunicationAddressee(record);
    return addressee ? `Здравствуйте, ${addressee}!` : "Здравствуйте!";
  }

  function getStudentCommunicationAddressee(record) {
    const words = String(record.name || "").trim().split(/\s+/).filter(Boolean);
    return [words[1], isChecked(record.addressByFirstName) ? "" : words[2]].filter(Boolean).join(" ");
  }

  function isStudentDpoProgram(record) {
    const type = String(getProgramType(record.program, record) || "").toLowerCase();
    return type === "кпк"
      || type === "ппп"
      || type.includes("повышен")
      || type.includes("переподготов");
  }

  function getStudentProgramMessageLink(record) {
    const program = findProgramByName(record.program);
    return [
      record.gradeReportUrl,
      record.eventUrl,
      program?.gradeReportUrl,
      program?.reportUrl,
      getProgramPromoUrl(program)
    ].find((value) => String(value || "").trim()) || "ссылка пока не указана";
  }

  function getStudentCommunicationEndDate(record) {
    return record.extendedEndDate || record.endDate || "";
  }

  function getStudentCommunicationReductionDate(record) {
    return record.reductionEndDate || record.plannedEndDate || record.extendedEndDate || "";
  }

  function getStudentCommunicationDaysLeft(record) {
    if (record.daysLeft !== undefined && record.daysLeft !== "") return record.daysLeft;
    const endDate = new Date(getStudentCommunicationEndDate(record));
    if (Number.isNaN(endDate.getTime())) return 0;
    return Math.ceil((endDate.getTime() - Date.now()) / 86400000);
  }

  function formatStudentCommunicationDate(value) {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return new Intl.DateTimeFormat("ru-RU").format(date);
  }

  function formatStudentCommunicationLongDate(value) {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    const dayMonth = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long" }).format(date);
    const weekday = new Intl.DateTimeFormat("ru-RU", { weekday: "long" }).format(date);
    return `${dayMonth} (${weekday})`;
  }

  function formatStudentCommunicationPortalEndDate(value) {
    if (!value) return "";
    const date = parseOrdersSdoDate(value) || new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    const numericDate = new Intl.DateTimeFormat("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric"
    }).format(date);
    const weekday = new Intl.DateTimeFormat("ru-RU", { weekday: "long" }).format(date);
    return `${numericDate} (${weekday})`;
  }

  function getStudentReferralCode(record) {
    const explicit = String(record.referralCode || record.utmSource || "").trim();
    if (explicit) return explicit;
    const words = String(record.name || "").trim().split(/\s+/).filter(Boolean);
    return transliterateStudentName(`${words[1] || ""}${words[0] || ""}`)
      .replace(/[^A-Za-z0-9]+/g, "")
      .toLowerCase() || "student";
  }

  function clearUnchangedGeneratedCommunicationMessages(values, formElement) {
    const generated = generateStudentCommunicationMessages(values);
    studentCommunicationMessages.forEach((message) => {
      const control = formElement.elements[message.key];
      if (!control) return;
      if (String(control.value || "") === String(generated[message.key] || "")) {
        values[message.key] = "";
      }
    });
  }

  async function copyStudentCommunicationMessage(button) {
    const textarea = getStudentCommunicationTextarea(button.dataset.messageKey);
    if (!textarea) return;
    await copyTextToClipboard(getControlCopyValue(textarea));
    const label = button.querySelector("span");
    if (!label) return;
    const initialText = label.textContent;
    label.textContent = "Скопировано";
    button.classList.add("is-complete");
    window.setTimeout(() => {
      label.textContent = initialText;
      button.classList.remove("is-complete");
    }, 900);
  }

  function editStudentCommunicationMessage(messageKey) {
    const textarea = getStudentCommunicationTextarea(messageKey);
    if (!textarea) return;
    textarea.readOnly = false;
    textarea.closest(".communication-message-card")?.classList.add("is-editing");
    textarea.focus({ preventScroll: true });
    textarea.setSelectionRange(textarea.value.length, textarea.value.length);
  }

  function restoreStudentCommunicationMessage(messageKey) {
    const textarea = getStudentCommunicationTextarea(messageKey);
    if (!textarea || !confirm("Восстановить исходный текст сообщения? Внесенные изменения будут удалены.")) return;
    textarea.value = decodeURIComponent(textarea.dataset.generatedMessage || "");
    textarea.readOnly = true;
    textarea.closest(".communication-message-card")?.classList.remove("is-editing", "is-customized");
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    textarea.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function emailStudentCommunicationMessage(messageKey) {
    const textarea = getStudentCommunicationTextarea(messageKey);
    const email = getCurrentStudentCardValue("email");
    if (!email) {
      alert("Укажите Email слушателя.");
      return;
    }
    const message = studentCommunicationMessages.find((item) => item.key === messageKey);
    const subject = message ? `Учебный центр: ${message.label}` : "Сообщение от учебного центра";
    window.location.href = `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(textarea?.value || "")}`;
  }

  function getCurrentStudentCardValue(key) {
    const formElement = document.getElementById("recordForm");
    const control = formElement?.elements[key];
    const record = (state.data.collections.students || []).find((item) => item.id === state.modal?.id) || {};
    return String(control?.value ?? state.modal?.draft?.[key] ?? record[key] ?? "").trim();
  }

  function getStudentCommunicationTextarea(messageKey) {
    if (!messageKey) return null;
    return document.querySelector(`[data-communication-message="${CSS.escape(messageKey)}"]`);
  }

  function closeSidebar() {
    document.body.classList.add("sidebar-collapsed");
    document.body.classList.remove("sidebar-open");
  }

  function bindSidebarOutsideClick() {
    if (sidebarOutsideClickBound) return;
    sidebarOutsideClickBound = true;
    document.addEventListener("click", (event) => {
      const sidebar = document.querySelector(".sidebar");
      if (!sidebar || document.body.classList.contains("sidebar-collapsed")) return;
      if (event.target.closest("[data-action='toggle-sidebar'], .sidebar")) return;
      if (!document.body.classList.contains("sidebar-open")) return;
      closeSidebar();
    });
  }

  function bindEvents() {
    bindSidebarOutsideClick();
    bindFieldUndoShortcut();
    initializeRecordFormSnapshot(document.getElementById("recordForm"));

    document.querySelectorAll("[data-view]").forEach((button) => {
      button.addEventListener("click", () => {
        state.view = button.dataset.view;
        state.search = "";
        state.statusFilter = "Все";
        state.sort = { key: "", dir: "asc" };
        state.tableOptions = null;
        render();
      });
    });

    document.querySelectorAll("[data-view-shortcut]").forEach((button) => {
      button.addEventListener("click", () => {
        state.view = button.dataset.viewShortcut;
        state.tableOptions = null;
        render();
      });
    });

    document.querySelector("[data-action='toggle-sidebar']")?.addEventListener("click", () => {
      const isCompact = window.matchMedia("(max-width: 1120px)").matches;
      if (document.body.classList.contains("sidebar-collapsed")) {
        document.body.classList.remove("sidebar-collapsed");
        document.body.classList.add("sidebar-open");
        return;
      }
      if (isCompact) {
        document.body.classList.toggle("sidebar-open");
      } else {
        document.body.classList.toggle("sidebar-collapsed");
      }
    });

    document.querySelector("[data-action='collapse-sidebar']")?.addEventListener("click", () => {
      closeSidebar();
    });

    document.querySelector("[data-action='transliterate-student-name']")?.addEventListener("click", () => {
      const source = document.querySelector("[name='name']");
      const target = document.querySelector("[name='nameEnglish']");
      if (!target) return;
      target.value = transliterateStudentName(source?.value || "");
      target.dispatchEvent(new Event("input", { bubbles: true }));
      target.dispatchEvent(new Event("change", { bubbles: true }));
      target.focus();
    });

    document.querySelector("[name='name']")?.addEventListener("input", (event) => {
      autoFillStudentGender(event.target.value);
    });

    document.querySelectorAll("[data-action='open-student-messenger']").forEach((button) => {
      button.addEventListener("click", () => openStudentMessenger(button.dataset.messenger));
    });

    document.querySelector("[data-action='open-student-messenger-url']")?.addEventListener("click", openStudentMessengerUrl);
    document.querySelector("[data-action='open-student-program-promo']")?.addEventListener("click", openStudentProgramPromo);
    document.querySelectorAll("[data-action='shift-orders-sdo-date']").forEach((button) => {
      button.addEventListener("click", (event) => {
        shiftOrdersSdoDate(button.dataset.field, button.dataset.direction, event.altKey);
      });
    });
    document.querySelector("[data-action='generate-contract-number']")?.addEventListener("click", generateContractNumber);
    document.querySelector("[data-action='generate-enrollment-order-number']")?.addEventListener("click", generateEnrollmentOrderNumber);
    document.querySelector("[data-action='generate-expulsion-order-number']")?.addEventListener("click", generateExpulsionOrderNumber);
    document.querySelector("[data-action='generate-group-number']")?.addEventListener("click", generateStudentGroupNumber);
    document.querySelector("[data-action='generate-portal-password']")?.addEventListener("click", generatePortalPassword);
    document.querySelector("[data-action='open-moodle-portal']")?.addEventListener("click", openMoodlePortal);
    document.querySelector("[data-action='export-student-to-sdo']")?.addEventListener("click", exportStudentToSdo);
    ["login", "password"].forEach((fieldName) => {
      const input = document.querySelector(`[name="${fieldName}"]`);
      input?.addEventListener("input", updatePortalAccessMessage);
      input?.addEventListener("change", updatePortalAccessMessage);
    });
    document.querySelector("[data-action='copy-extended-end-date-up']")?.addEventListener("click", copyExtendedEndDateToEndDate);
    document.querySelectorAll("[data-action='copy-communication-message']").forEach((button) => {
      button.addEventListener("click", () => copyStudentCommunicationMessage(button));
    });
    document.querySelectorAll("[data-action='edit-communication-message']").forEach((button) => {
      button.addEventListener("click", () => editStudentCommunicationMessage(button.dataset.messageKey));
    });
    document.querySelectorAll("[data-action='restore-communication-message']").forEach((button) => {
      button.addEventListener("click", () => restoreStudentCommunicationMessage(button.dataset.messageKey));
    });
    document.querySelectorAll("[data-action='email-communication-message']").forEach((button) => {
      button.addEventListener("click", () => emailStudentCommunicationMessage(button.dataset.messageKey));
    });
    document.querySelectorAll("[data-action='copy-address-to']").forEach((button) => {
      button.addEventListener("click", () => copyStudentAddressToField(button.dataset.source, button.dataset.target));
    });
    document.querySelector("[data-action='copy-student-passport-to-customer']")?.addEventListener("click", copyStudentPassportToCustomer);
    document.querySelectorAll("[data-action='check-post-index']").forEach((button) => {
      button.addEventListener("click", () => checkStudentAddressPostIndex(button.dataset.source));
    });
    document.querySelector("[data-action='open-discount-picker']")?.addEventListener("click", openDiscountPicker);
    document.querySelectorAll("[data-action='close-discount-picker']").forEach((button) => {
      button.addEventListener("click", closeDiscountPicker);
    });
    document.querySelector("[data-action='refresh-discount-picker']")?.addEventListener("click", refreshDiscountPicker);
    document.querySelectorAll("[data-action='restore-default-discount-rules']").forEach((button) => {
      button.addEventListener("click", restoreDefaultDiscountRules);
    });
    document.querySelector("[data-action='apply-discount-picker']")?.addEventListener("click", applyDiscountPicker);
    document.querySelectorAll("[data-action='select-discount-option']").forEach((button) => {
      button.addEventListener("click", () => selectDiscountOption(button.dataset.key));
    });
    document.querySelectorAll("[data-action='select-discount-rate']").forEach((button) => {
      button.addEventListener("click", () => selectDiscountRate(button.dataset.rate));
    });
    document.querySelectorAll("[data-action='delete-payment-row']").forEach((button) => {
      button.addEventListener("click", () => clearStudentPaymentRow(button.dataset.paymentIndex));
    });
    document.querySelector("[data-action='add-payment-row']")?.addEventListener("click", addStudentPaymentRow);
    document.querySelectorAll("[data-action='delete-expense-row']").forEach((button) => {
      button.addEventListener("click", () => clearStudentExpenseRow(button.dataset.expenseIndex));
    });
    document.querySelector("[data-action='add-expense-row']")?.addEventListener("click", addStudentExpenseRow);
    document.querySelectorAll("[data-action='navigate-student-card']").forEach((button) => {
      button.addEventListener("click", () => navigateStudentCard(button.dataset.direction));
    });
    document.querySelectorAll("[data-payment-index]").forEach((input) => {
      input.addEventListener("input", () => {
        syncPaymentRowDeleteButton(input.dataset.paymentIndex);
        syncPaymentAddButton();
      });
    });
    document.querySelectorAll("[data-expense-index]").forEach((input) => {
      const syncExpenseControls = () => {
        syncExpenseRowDeleteButton(input.dataset.expenseIndex);
        syncExpenseAddButton();
      };
      input.addEventListener("input", syncExpenseControls);
      input.addEventListener("change", syncExpenseControls);
    });

    document.getElementById("searchInput")?.addEventListener("input", (event) => {
      const cursor = event.target.selectionStart;
      state.search = event.target.value;
      render();
      const input = document.getElementById("searchInput");
      if (input) {
        input.focus({ preventScroll: true });
        input.setSelectionRange(cursor, cursor);
      }
    });

    document.getElementById("statusFilter")?.addEventListener("change", (event) => {
      state.statusFilter = event.target.value;
      render();
    });

    document.getElementById("dictionarySearch")?.addEventListener("input", (event) => {
      const cursor = event.target.selectionStart;
      state.dictionarySearch = event.target.value;
      render();
      const input = document.getElementById("dictionarySearch");
      if (input) {
        input.focus({ preventScroll: true });
        input.setSelectionRange(cursor, cursor);
      }
    });

    document.querySelectorAll("[data-action='select-dictionary']").forEach((button) => {
      button.addEventListener("click", () => {
        state.selectedDictionary = button.dataset.dict;
        render();
      });
    });

    document.querySelectorAll("[data-action='sort']").forEach((button) => {
      button.addEventListener("click", () => {
        const key = button.dataset.key;
        state.sort = {
          key,
          dir: state.sort.key === key && state.sort.dir === "asc" ? "desc" : "asc"
        };
        render();
      });
    });

    document.querySelectorAll("[data-action='create']").forEach((button) => {
      button.addEventListener("click", () => {
        if (button.dataset.config === "students") state.studentCardTab = "main";
        if (button.dataset.config === "students") state.openPaymentRows = [];
        if (button.dataset.config === "students") state.openExpenseRows = [];
        if (button.dataset.config === "students") state.discountPickerOpen = false;
        if (button.dataset.config === "students") state.discountPicker = null;
        state.modal = { config: button.dataset.config, id: "" };
        render();
      });
    });

    document.querySelectorAll("[data-action='edit']").forEach((button) => {
      button.addEventListener("click", () => {
        if (button.dataset.config === "students") state.studentCardTab = "main";
        if (button.dataset.config === "students") state.openPaymentRows = [];
        if (button.dataset.config === "students") state.openExpenseRows = [];
        if (button.dataset.config === "students") state.discountPickerOpen = false;
        if (button.dataset.config === "students") state.discountPicker = null;
        state.modal = { config: button.dataset.config, id: button.dataset.id };
        render();
      });
    });

    document.querySelectorAll("[data-action='delete']").forEach((button) => {
      button.addEventListener("click", () => deleteRecord(button.dataset.config, button.dataset.id));
    });

    document.querySelectorAll("[data-action='toggle-table-options']").forEach((button) => {
      button.addEventListener("click", () => {
        state.tableOptions = state.tableOptions === button.dataset.config ? null : button.dataset.config;
        render();
      });
    });

    document.querySelectorAll("[data-action='reset-table-options']").forEach((button) => {
      button.addEventListener("click", () => resetTableOptions(button.dataset.config));
    });

    document.querySelectorAll("[data-action='refresh-table-data']").forEach((button) => {
      button.addEventListener("click", () => refreshTableData(button.dataset.config));
    });

    document.querySelectorAll("[data-action='close-table-options']").forEach((element) => {
      element.addEventListener("click", () => {
        state.tableOptions = null;
        render();
      });
    });

    bindTableColumnEvents();

    document.querySelectorAll("[data-action='toggle-finance-metric']").forEach((button) => {
      button.addEventListener("click", () => {
        const key = button.dataset.metric;
        if (!key) return;
        state.financeChart[key] = !state.financeChart[key];
        render();
      });
    });

    document.querySelectorAll("[data-combo-field]").forEach((field) => {
      const input = field.querySelector("[data-combo-input]");
      if (!input) return;
      const open = (event) => {
        closeComboPanels(field);
        filterComboOptions(input);
        field.classList.add("is-open");
        if (event?.type === "input" && document.activeElement !== input) {
          input.focus({ preventScroll: true });
        }
      };
      input.addEventListener("focus", open);
      input.addEventListener("click", open);
      input.addEventListener("input", open);
      input.addEventListener("keydown", (event) => {
        if (event.key === "Escape") field.classList.remove("is-open");
      });
      field.addEventListener("pointerdown", (event) => {
        if (event.target.closest("[data-action='select-combo-value'], [data-action='clear-combo-value']")) {
          event.preventDefault();
        }
      });
      field.addEventListener("focusout", (event) => {
        if (event.relatedTarget && field.contains(event.relatedTarget)) return;
        setTimeout(() => {
          if (!field.contains(document.activeElement)) field.classList.remove("is-open");
        }, 0);
      });
    });

    document.querySelectorAll("[data-action='select-combo-value']").forEach((button) => {
      button.addEventListener("click", () => {
        const field = button.closest("[data-combo-field]");
        const input = field?.querySelector("[data-combo-input]");
        if (!input) return;
        input.value = button.dataset.value || "";
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
        field.classList.remove("is-open");
        input.focus();
      });
    });

    document.querySelectorAll("[data-action='clear-combo-value']").forEach((button) => {
      button.addEventListener("click", () => {
        const field = button.closest("[data-combo-field]");
        const input = field?.querySelector("[data-combo-input]");
        if (!input) return;
        input.value = "";
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
        filterComboOptions(input);
        field.classList.add("is-open");
        input.focus();
      });
    });

    document.querySelectorAll("[data-action='set-student-program']").forEach((input) => {
      const syncProgramType = (event) => {
        const program = findProgramByName(event.target.value);
        const educationTypeInput = document.querySelector("[name='educationType']");
        const studyFormInput = document.querySelector("[name='studyForm']");
        const hoursInput = document.querySelector("[name='hours']");
        if (educationTypeInput) educationTypeInput.value = program?.type || "";
        if (studyFormInput && program?.studyForm) studyFormInput.value = program.studyForm;
        if (hoursInput && program?.hours) hoursInput.value = program.hours;
        updateStudentProgramPromoTitle(event.target.value);
      };
      updateStudentProgramPromoTitle(input.value);
      input.addEventListener("input", syncProgramType);
      input.addEventListener("change", syncProgramType);
    });

    bindStudentEventReorderKeys();
    document.querySelectorAll("[data-action='toggle-student-event']").forEach(bindStudentEventRow);

    document.querySelector("[data-action='add-student-event']")?.addEventListener("click", addStudentEvent);

    document.querySelector("[data-student-events-list]")?.addEventListener("dragover", (event) => {
      event.preventDefault();
      const list = event.currentTarget;
      const dragging = list.querySelector(".student-event-row.is-dragging");
      if (!dragging) return;
      const afterElement = getEventDragAfterElement(list, event.clientY);
      if (afterElement) {
        list.insertBefore(dragging, afterElement);
      } else {
        list.appendChild(dragging);
      }
      syncStudentEventOrder();
    });

    document.querySelector("[data-action='close-event-editor']")?.addEventListener("click", closeStudentEventEditor);
    document.querySelector("[data-action='apply-event-editor']")?.addEventListener("click", applyStudentEventEditor);
    document.querySelector("[data-action='delete-student-event']")?.addEventListener("click", deleteStudentEvent);
    document.querySelector("[data-event-editor]")?.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closeStudentEventEditor();
      if (event.key === "Enter" && event.target.matches("[data-event-editor-label]")) {
        event.preventDefault();
        applyStudentEventEditor();
      }
    });

    document.querySelectorAll("[data-action='open-field-lookup']").forEach((button) => {
      button.addEventListener("click", () => {
        const panel = document.querySelector(`[data-lookup-panel="${button.dataset.field}"]`);
        if (!panel) return;
        document.querySelectorAll(".lookup-panel.is-open").forEach((item) => {
          if (item !== panel) item.classList.remove("is-open");
        });
        panel.classList.toggle("is-open");
        panel.querySelector(".lookup-search")?.focus();
      });
    });

    document.querySelectorAll(".lookup-field").forEach((field) => {
      field.addEventListener("pointerdown", (event) => {
        if (event.target.closest("[data-action='select-lookup-value'], [data-action='clear-lookup-value']")) {
          event.preventDefault();
        }
      });
    });

    document.querySelectorAll("[data-action='filter-lookup-values']").forEach((input) => {
      input.addEventListener("input", () => {
        const panel = input.closest(".lookup-panel");
        const query = input.value.trim().toLowerCase();
        panel?.querySelectorAll("[data-action='select-lookup-value']").forEach((button) => {
          button.hidden = query && !button.textContent.toLowerCase().includes(query);
        });
      });
    });

    document.querySelectorAll("[data-action='select-lookup-value']").forEach((button) => {
      button.addEventListener("click", () => {
        const field = button.dataset.field;
        const input = document.querySelector(`[name="${field}"]`);
        if (input) input.value = button.dataset.value || "";
        button.closest(".lookup-panel")?.classList.remove("is-open");
      });
    });

    document.querySelectorAll("[data-action='clear-lookup-value']").forEach((button) => {
      button.addEventListener("click", () => {
        const field = button.dataset.field;
        const input = document.querySelector(`[name="${field}"]`);
        if (input) {
          input.value = "";
          input.focus();
        }
      });
    });

    bindStudentIdentityFieldValidation("inn");
    bindStudentIdentityFieldValidation("snils");
    bindStudentIdentityFieldValidation("customerInn");
    bindStudentIdentityFieldValidation("customerSnils");

    document.querySelectorAll("[data-action='toggle-row-selection']").forEach((checkbox) => {
      checkbox.addEventListener("change", () => toggleRowSelection(checkbox.dataset.config, checkbox.dataset.id, checkbox.checked));
    });

    document.querySelectorAll("[data-action='toggle-all-selection']").forEach((checkbox) => {
      checkbox.addEventListener("change", () => toggleAllSelection(checkbox.dataset.config, checkbox.checked));
    });

    document.querySelectorAll("[data-action='bulk-clear']").forEach((button) => {
      button.addEventListener("click", () => {
        state.selected[button.dataset.config] = [];
        render();
      });
    });

    document.querySelectorAll("[data-action='bulk-export']").forEach((button) => {
      button.addEventListener("click", () => exportCsv(button.dataset.config, getRowsByIds(configs[button.dataset.config].collection, getSelected(button.dataset.config))));
    });

    document.querySelectorAll("[data-action='bulk-status']").forEach((button) => {
      button.addEventListener("click", () => bulkSetStatus(button.dataset.config));
    });

    document.querySelectorAll("[data-action='bulk-delete']").forEach((button) => {
      button.addEventListener("click", () => bulkDelete(button.dataset.config));
    });

    document.querySelectorAll("[data-action='close-modal']").forEach((element) => {
      element.addEventListener("click", (event) => {
        if (event.target === element || (element.tagName === "BUTTON" && element.contains(event.target))) {
          event.preventDefault();
          closeModalWithUnsavedCheck();
        }
      });
    });

    bindStudentTabOrderControls();
    document.querySelectorAll("[data-student-tab]").forEach((button) => {
      button.addEventListener("click", () => {
        if (button.dataset.wasDragged === "true" || Date.now() - lastStudentTabDragEndedAt < 200) {
          button.dataset.wasDragged = "";
          return;
        }
        switchStudentTab(button.dataset.studentTab);
      });
    });

    document.getElementById("studentPhotoInput")?.addEventListener("change", handleStudentPhoto);

    document.querySelector("[data-action='clear-photo']")?.addEventListener("click", async () => {
      const photoInput = document.getElementById("studentPhotoInput");
      const hidden = document.getElementById("studentPhotoData");
      const pathInput = document.getElementById("studentPhotoPath");
      const urlInput = document.getElementById("studentPhotoUrl");
      const preview = document.getElementById("studentPhotoPreview");
      try {
        await deleteStoredPhoto(pathInput?.value || "");
      } catch (error) {
        alert("Не удалось удалить фото из хранилища: " + error.message);
        return;
      }
      if (hidden) hidden.value = "";
      if (pathInput) pathInput.value = "";
      if (urlInput) urlInput.value = "";
      if (photoInput) photoInput.value = "";
      if (preview) {
        preview.classList.remove("has-photo");
        preview.querySelector("img")?.remove();
        if (!preview.querySelector(":scope > span")) {
          preview.insertAdjacentHTML("afterbegin", `<span>${initials(document.querySelector("[name='name']")?.value || "Слушатель")}</span>`);
        }
      }
    });

    document.getElementById("recordForm")?.addEventListener("submit", saveRecord);

    document.querySelectorAll("[data-action='export-json']").forEach((button) => {
      button.addEventListener("click", exportJson);
    });
    document.querySelector("[data-action='reset-state']")?.addEventListener("click", resetState);
    document.querySelector("[data-action='import-json-trigger']")?.addEventListener("click", () => document.getElementById("jsonImport")?.click());
    document.getElementById("jsonImport")?.addEventListener("change", importJson);

    document.querySelectorAll("[data-action='export-csv']").forEach((button) => {
      button.addEventListener("click", () => exportCsv(button.dataset.config));
    });

    document.querySelectorAll("[data-action='dict-remove']").forEach((button) => {
      button.addEventListener("click", () => removeDictionaryValue(button.dataset.dict, button.dataset.value));
    });

    document.querySelectorAll("[data-action='dict-sort']").forEach((button) => {
      button.addEventListener("click", () => sortDictionaryValues(button.dataset.dict, button.dataset.order));
    });

    document.querySelectorAll("[data-action='dict-copy-all']").forEach((button) => {
      button.addEventListener("click", () => copyDictionaryValues(button.dataset.dict));
    });

    document.querySelectorAll("[data-action='dict-clear']").forEach((button) => {
      button.addEventListener("click", () => clearDictionaryValues(button.dataset.dict));
    });

    document.querySelectorAll("[data-action='sort-communication-template-fields']").forEach((button) => {
      button.addEventListener("click", () => sortCommunicationTemplateFields(button.dataset.order));
    });

    document.querySelectorAll("[data-dictionary-values]").forEach(bindDictionaryManualSort);

    document.querySelectorAll("form[data-action='dict-add']").forEach((formElement) => {
      formElement.addEventListener("submit", addDictionaryValue);
      formElement.querySelector("[data-dictionary-add-input]")?.addEventListener("paste", pasteDictionaryValues);
    });
    document.querySelector("form[data-action='save-communication-templates']")?.addEventListener("submit", saveCommunicationTemplates);
    document.querySelector("[data-action='reset-communication-templates']")?.addEventListener("click", resetCommunicationTemplates);
    bindCommunicationTemplateDragAndDrop();
    bindCommunicationTemplateFieldActions();
    document.querySelector("form[data-action='save-data-formulas']")?.addEventListener("submit", saveDataFormulas);
    document.querySelector("[data-action='reset-data-formulas']")?.addEventListener("click", resetDataFormulas);
    bindDataFormulaConstructor();
    document.querySelector("form[data-action='save-sdo-settings']")?.addEventListener("submit", saveSdoSettings);
    document.querySelector("[data-action='reset-sdo-settings']")?.addEventListener("click", resetSdoSettings);

    enhanceCopyableFields();
  }

  function initializeRecordFormSnapshot(form) {
    if (!form) return;
    form.dataset.initialSnapshot = captureFormSnapshot(form);
  }

  function syncStudentCardTabOrderFromDom() {
    const order = [...document.querySelectorAll("[data-student-tab]")]
      .map((button) => button.dataset.studentTab)
      .filter(Boolean);
    if (!order.length) return;
    state.studentCardTabOrder = order;
    persistStudentCardTabOrder(order);
  }

  function getStudentTabDragAfterElement(container, x) {
    return [...container.querySelectorAll("[data-student-tab]:not(.is-dragging)")].reduce((closest, child) => {
      const box = child.getBoundingClientRect();
      const offset = x - box.left - box.width / 2;
      if (offset < 0 && offset > closest.offset) {
        return { offset, element: child };
      }
      return closest;
    }, { offset: Number.NEGATIVE_INFINITY, element: null }).element;
  }

  function closeStudentTabMenu() {
    document.removeEventListener("pointerdown", closeStudentTabMenuOnOutsideClick, { capture: true });
    document.querySelector("[data-student-tab-menu]")?.remove();
  }

  function closeStudentTabMenuOnOutsideClick(event) {
    if (event.target.closest("[data-student-tab-menu]")) {
      document.addEventListener("pointerdown", closeStudentTabMenuOnOutsideClick, { capture: true, once: true });
      return;
    }
    closeStudentTabMenu();
  }

  function resetStudentCardTabOrder() {
    if (state.modal) {
      state.modal.draft = collectStudentFormDraft();
      state.modal.hasDraftChanges = true;
    }
    state.studentCardTabOrder = [];
    localStorage.removeItem(STUDENT_CARD_TAB_ORDER_KEY);
    closeStudentTabMenu();
    render();
  }

  function showStudentTabMenu(x, y) {
    closeStudentTabMenu();
    const menu = document.createElement("div");
    menu.className = "student-tab-menu";
    menu.dataset.studentTabMenu = "";
    menu.innerHTML = `
      <button data-action="reset-student-tab-order" type="button">Восстановить порядок вкладок</button>
    `;
    document.body.appendChild(menu);
    const rect = menu.getBoundingClientRect();
    menu.style.left = `${clamp(x, 8, Math.max(8, window.innerWidth - rect.width - 8))}px`;
    menu.style.top = `${clamp(y, 8, Math.max(8, window.innerHeight - rect.height - 8))}px`;
    menu.querySelector("[data-action='reset-student-tab-order']")?.addEventListener("click", resetStudentCardTabOrder);
    setTimeout(() => {
      document.addEventListener("pointerdown", closeStudentTabMenuOnOutsideClick, { capture: true, once: true });
    });
  }

  function bindStudentTabOrderControls() {
    const container = document.querySelector("[data-student-tabs]");
    if (!container) return;
    container.addEventListener("contextmenu", (event) => {
      if (!event.target.closest("[data-student-tab]")) return;
      event.preventDefault();
      showStudentTabMenu(event.clientX, event.clientY);
    });
    container.addEventListener("dragover", (event) => {
      event.preventDefault();
      const dragging = container.querySelector(".is-dragging[data-student-tab]");
      if (!dragging) return;
      const afterElement = getStudentTabDragAfterElement(container, event.clientX);
      if (afterElement) {
        container.insertBefore(dragging, afterElement);
      } else {
        container.appendChild(dragging);
      }
      syncStudentCardTabOrderFromDom();
    });
    container.addEventListener("drop", (event) => {
      event.preventDefault();
      syncStudentCardTabOrderFromDom();
    });
    container.querySelectorAll("[data-student-tab]").forEach((button) => {
      button.addEventListener("dragstart", (event) => {
        draggedStudentTabId = button.dataset.studentTab || "";
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", draggedStudentTabId);
        button.classList.add("is-dragging");
        document.body.classList.add("student-tab-dragging");
      });
      button.addEventListener("dragend", () => {
        button.classList.remove("is-dragging");
        document.body.classList.remove("student-tab-dragging");
        if (draggedStudentTabId) button.dataset.wasDragged = "true";
        lastStudentTabDragEndedAt = Date.now();
        draggedStudentTabId = "";
        syncStudentCardTabOrderFromDom();
        setTimeout(() => {
          if (button.dataset.wasDragged === "true") button.dataset.wasDragged = "";
        }, 0);
      });
    });
  }

  function switchStudentTab(tabId) {
    if (!tabId || state.studentCardTab === tabId) return;
    if (hasUnsavedFormChanges(document.getElementById("recordForm"))) {
      state.modal.hasDraftChanges = true;
    }
    state.modal.draft = collectStudentFormDraft();
    state.studentCardTab = tabId;
    render();
  }

  function getStudentNavigationRows() {
    const visibleRows = getVisibleRows(configs.students);
    return visibleRows.length ? visibleRows : (state.data.collections.students || []);
  }

  function getStudentCardNavigation(record = {}) {
    const rows = getStudentNavigationRows();
    const index = rows.findIndex((row) => row.id === record.id);
    return {
      index,
      total: rows.length,
      hasPrev: Boolean(record.id) && index > 0,
      hasNext: Boolean(record.id) && index >= 0 && index < rows.length - 1
    };
  }

  function getStudentNavigationTarget(currentId, direction) {
    const rows = getStudentNavigationRows();
    const index = rows.findIndex((row) => row.id === currentId);
    if (index < 0) return null;
    return rows[index + (Number(direction) < 0 ? -1 : 1)] || null;
  }

  function resetStudentCardTransientState() {
    state.openPaymentRows = [];
    state.openExpenseRows = [];
    state.discountPickerOpen = false;
    state.discountPicker = null;
  }

  function openStudentCardById(id) {
    if (!id) return;
    resetStudentCardTransientState();
    state.modal = { config: "students", id };
    render();
  }

  function navigateStudentCard(direction) {
    const formElement = document.getElementById("recordForm");
    if (!formElement || formElement.dataset.config !== "students" || !state.modal?.id) return;
    let currentId = formElement.dataset.id || state.modal.id;
    const hasChanges = state.modal?.hasDraftChanges || hasUnsavedFormChanges(formElement);
    if (hasChanges) {
      if (confirm("Сохранить изменения перед переходом к другой карточке?")) {
        const savedId = saveFormRecord(formElement);
        if (!savedId) return;
        persist();
        currentId = savedId;
      } else if (!confirm("Перейти без сохранения изменений?")) {
        return;
      }
    }
    const target = getStudentNavigationTarget(currentId, direction);
    if (!target) return;
    openStudentCardById(target.id);
  }

  function findDiscountOptionByKey(key) {
    return getFlatDiscountOptions().find((item) => item.key === key) || null;
  }

  function openDiscountPicker() {
    if (!state.modal || state.modal.config !== "students") return;
    const draft = collectStudentFormDraft();
    state.modal.draft = draft;
    state.modal.hasDraftChanges = state.modal.hasDraftChanges || hasUnsavedFormChanges(document.getElementById("recordForm"));
    const picker = getDiscountPickerState(draft);
    const option = findDiscountOptionByKey(picker.key);
    state.discountPicker = {
      key: picker.key,
      description: picker.description,
      percent: picker.percent || option?.rates?.[0] || 0
    };
    state.discountPickerOpen = true;
    render();
  }

  function closeDiscountPicker() {
    state.discountPickerOpen = false;
    state.discountPicker = null;
    render();
  }

  function selectDiscountOption(key) {
    if (!state.modal || state.modal.config !== "students") return;
    const draft = collectStudentFormDraft();
    state.modal.draft = draft;
    state.modal.hasDraftChanges = state.modal.hasDraftChanges || hasUnsavedFormChanges(document.getElementById("recordForm"));
    const option = findDiscountOptionByKey(key);
    if (!option) return;
    const currentPercent = Number(state.discountPicker?.percent || draft.discount || 0);
    state.discountPicker = {
      key,
      description: option.title,
      percent: option.rates.includes(currentPercent) ? currentPercent : option.rates[0]
    };
    state.discountPickerOpen = true;
    render();
  }

  function selectDiscountRate(rate) {
    const percent = Number(rate || 0);
    if (!state.discountPicker || !percent) return;
    state.discountPicker = { ...state.discountPicker, percent };
    state.discountPickerOpen = true;
    if (state.modal?.config === "students") state.modal.draft = collectStudentFormDraft();
    render();
  }

  function refreshDiscountPicker() {
    if (!state.modal || state.modal.config !== "students") {
      render();
      return;
    }
    if (state.modal?.config === "students") state.modal.draft = collectStudentFormDraft();
    const picker = getDiscountPickerState(state.modal?.draft || {});
    const option = findDiscountOptionByKey(picker.key) || getFlatDiscountOptions()[0];
    state.discountPicker = {
      key: option?.key || picker.key || "",
      description: option?.title || picker.description || "",
      percent: option?.rates?.includes(picker.percent) ? picker.percent : (option?.rates?.[0] || picker.percent || 0)
    };
    state.discountPickerOpen = true;
    render();
  }

  function restoreDefaultDiscountRules() {
    if (!confirm("Восстановить исходный перечень скидок? Текущий справочник скидок будет заменен.")) return;
    state.data.dictionaries.discountRules = getDefaultDiscountRuleValues();
    addAudit("Восстановлен справочник", dictionaryTitle("discountRules"), "Исходный перечень скидок");
    persist();
    if (state.modal?.config === "students" && state.discountPickerOpen) refreshDiscountPicker();
    else render();
  }

  function applyDiscountPicker() {
    if (!state.modal || state.modal.config !== "students") return;
    const note = document.querySelector("[data-discount-note]")?.value.trim();
    const picker = getDiscountPickerState(collectStudentFormDraft());
    const draft = {
      ...collectStudentFormDraft(),
      discount: Number(picker.percent || 0),
      discountDescription: note || picker.description || ""
    };
    const paymentTotal = sumStudentPayments(draft);
    if (paymentTotal > 0) draft.paidAmount = paymentTotal;
    draft.balance = calculateStudentBalance(draft);
    state.modal.draft = draft;
    state.modal.hasDraftChanges = true;
    state.discountPickerOpen = false;
    state.discountPicker = null;
    render();
  }

  function collectStudentFormDraft() {
    const formElement = document.getElementById("recordForm");
    if (!formElement || formElement.dataset.config !== "students") return state.modal?.draft || {};
    const rows = state.data.collections.students || [];
    const currentRecord = formElement.dataset.id ? rows.find((row) => row.id === formElement.dataset.id) || {} : {};
    const values = { ...currentRecord, ...(state.modal?.draft || {}) };
    const formData = new FormData(formElement);
    studentAllFields.forEach((item) => {
      if (item.type === "checkbox") {
        if (!formElement.elements[item.key]) return;
        values[item.key] = formData.has(item.key) ? "Да" : "";
        return;
      }
      if (!formData.has(item.key)) return;
      const raw = formData.get(item.key);
      values[item.key] = item.type === "number" ? Number(raw || 0) : String(raw || "");
    });
    formData.forEach((raw, key) => {
      if (/^event_[A-Za-z0-9_-]+_(state|date|label)$/.test(key)) {
        values[key] = String(raw || "");
      }
    });
    clearUnchangedGeneratedCommunicationMessages(values, formElement);
    if (!values.uid) values.uid = getNextUid();
    const selectedProgram = findProgramByName(values.program);
    if (selectedProgram) {
      values.educationType = selectedProgram.type || values.educationType || "";
      values.studyForm = selectedProgram.studyForm || values.studyForm || "";
      values.hours = selectedProgram.hours || values.hours || "";
    }
    return values;
  }

  function captureFormSnapshot(form) {
    const values = Array.from(form.elements || [])
      .filter((control) => control.name && !isSnapshotIgnoredControl(control))
      .map((control) => {
        const tagName = String(control.tagName || "").toLowerCase();
        const type = String(control.type || "").toLowerCase();
        if (tagName === "select" && control.multiple) {
          return {
            name: control.name,
            tagName,
            type,
            values: Array.from(control.selectedOptions || []).map((option) => option.value)
          };
        }
        if (type === "checkbox" || type === "radio") {
          return {
            name: control.name,
            tagName,
            type,
            value: control.value,
            checked: Boolean(control.checked)
          };
        }
        return {
          name: control.name,
          tagName,
          type,
          value: control.value
        };
      });
    return JSON.stringify(values);
  }

  function isSnapshotIgnoredControl(control) {
    const type = String(control.type || "").toLowerCase();
    return ["button", "submit", "reset", "file"].includes(type);
  }

  function hasUnsavedFormChanges(form) {
    if (!form) return false;
    return form.dataset.initialSnapshot !== captureFormSnapshot(form);
  }

  function closeModalWithUnsavedCheck() {
    const form = document.getElementById("recordForm");
    if ((state.modal?.hasDraftChanges || hasUnsavedFormChanges(form)) && !confirm("Есть несохраненные изменения. Закрыть без сохранения?")) {
      return;
    }
    state.modal = null;
    state.discountPickerOpen = false;
    state.discountPicker = null;
    state.openPaymentRows = [];
    state.openExpenseRows = [];
    render();
  }

  function enhanceCopyableFields() {
    const form = document.getElementById("recordForm");
    if (!form) return;
    form.querySelectorAll("input, select, textarea").forEach((control) => {
      if (!isCopyableControl(control)) return;
      if (control.dataset.copyContextBound === "true") return;
      control.dataset.copyContextBound = "true";
      control.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        event.stopPropagation();
        showFieldCopyPopup(control, event.clientX, event.clientY);
      });
    });
  }

  function showFieldCopyPopup(control, x, y) {
    hideFieldCopyPopup();
    const popup = document.createElement("div");
    popup.className = "field-copy-popup";
    popup.dataset.fieldCopyPopup = "";
    popup.innerHTML = `
      <button data-action="copy-field-value" type="button">
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <rect x="9" y="9" width="10" height="10" rx="2"></rect>
          <path d="M5 15V7a2 2 0 0 1 2-2h8"></path>
        </svg>
        <span>Копировать</span>
      </button>
      <span class="field-copy-divider" aria-hidden="true"></span>
      <button class="field-delete-button" data-action="delete-field-value" type="button">
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M4 7h16"></path>
          <path d="M10 11v6"></path>
          <path d="M14 11v6"></path>
          <path d="M6 7l1 14h10l1-14"></path>
          <path d="M9 7V4h6v3"></path>
        </svg>
        <span>Удалить</span>
      </button>
      <button class="field-undo-button" data-action="undo-field-delete" type="button" ${lastDeletedControlState ? "" : "disabled"}>
        <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
          <path d="M9 7 4 12l5 5"></path>
          <path d="M5 12h9a6 6 0 0 1 6 6"></path>
        </svg>
        <span>Отменить</span>
      </button>
    `;
    document.body.appendChild(popup);
    const rect = popup.getBoundingClientRect();
    const maxLeft = Math.max(8, window.innerWidth - rect.width - 8);
    const maxTop = Math.max(8, window.innerHeight - rect.height - 8);
    popup.style.left = `${clamp(x, 8, maxLeft)}px`;
    popup.style.top = `${clamp(y, 8, maxTop)}px`;
    const copyButton = popup.querySelector("[data-action='copy-field-value']");
    let copyStarted = false;
    const copyNow = (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (copyStarted) return;
      copyStarted = true;
      copyTextToClipboard(getControlCopyValue(control));
      popup.classList.add("is-copied");
      window.setTimeout(hideFieldCopyPopup, 140);
    };
    copyButton.addEventListener("pointerdown", copyNow);
    copyButton.addEventListener("click", copyNow);
    const deleteButton = popup.querySelector("[data-action='delete-field-value']");
    let deleteStarted = false;
    const deleteNow = (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (deleteStarted) return;
      deleteStarted = true;
      clearControlValue(control);
      deleteButton.disabled = true;
      undoButton.disabled = false;
    };
    deleteButton.addEventListener("pointerdown", deleteNow);
    deleteButton.addEventListener("click", deleteNow);
    const undoButton = popup.querySelector("[data-action='undo-field-delete']");
    const undoNow = (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (undoButton.disabled) return;
      restoreLastDeletedControl();
      hideFieldCopyPopup();
    };
    undoButton.addEventListener("pointerdown", undoNow);
    undoButton.addEventListener("click", undoNow);
    window.setTimeout(() => {
      document.addEventListener("pointerdown", handleFieldCopyPopupOutside, { once: true });
    }, 0);
  }

  function clearControlValue(control) {
    lastDeletedControlState = captureControlState(control);
    if (control.type === "checkbox" || control.type === "radio") {
      control.checked = false;
    } else if (control.tagName === "SELECT") {
      control.selectedIndex = -1;
    } else {
      control.value = "";
    }
    control.dispatchEvent(new Event("input", { bubbles: true }));
    control.dispatchEvent(new Event("change", { bubbles: true }));
    control.focus({ preventScroll: true });
  }

  function captureControlState(control) {
    const selectedValues = control.tagName === "SELECT"
      ? Array.from(control.selectedOptions || []).map((option) => option.value)
      : [];
    return {
      control,
      name: control.name,
      tagName: control.tagName,
      type: String(control.type || "").toLowerCase(),
      value: control.value,
      checked: Boolean(control.checked),
      selectedIndex: control.selectedIndex,
      selectedValues
    };
  }

  function bindFieldUndoShortcut() {
    if (fieldUndoKeyBound) return;
    fieldUndoKeyBound = true;
    document.addEventListener("keydown", (event) => {
      if (!(event.ctrlKey || event.metaKey) || event.shiftKey || event.key.toLowerCase() !== "z") return;
      if (!lastDeletedControlState) return;
      const form = document.getElementById("recordForm");
      if (!form || !form.contains(document.activeElement)) return;
      event.preventDefault();
      restoreLastDeletedControl();
    });
  }

  function restoreLastDeletedControl() {
    const stateToRestore = lastDeletedControlState;
    const control = getRestorableControl(stateToRestore);
    if (!control) return;
    if (stateToRestore.type === "checkbox" || stateToRestore.type === "radio") {
      control.checked = stateToRestore.checked;
    } else if (stateToRestore.tagName === "SELECT") {
      if (control.multiple) {
        Array.from(control.options).forEach((option) => {
          option.selected = stateToRestore.selectedValues.includes(option.value);
        });
      } else {
        control.selectedIndex = stateToRestore.selectedIndex;
      }
    } else {
      control.value = stateToRestore.value;
    }
    control.dispatchEvent(new Event("input", { bubbles: true }));
    control.dispatchEvent(new Event("change", { bubbles: true }));
    control.focus({ preventScroll: true });
    lastDeletedControlState = null;
  }

  function getRestorableControl(stateToRestore) {
    if (!stateToRestore) return null;
    if (stateToRestore.control?.isConnected) return stateToRestore.control;
    const form = document.getElementById("recordForm");
    const control = form?.elements[stateToRestore.name];
    if (!control) return null;
    if (control.tagName) return control;
    return Array.from(control).find((item) => item.type === stateToRestore.type) || control[0] || null;
  }

  function handleFieldCopyPopupOutside(event) {
    if (event.target.closest("[data-field-copy-popup]")) {
      document.addEventListener("pointerdown", handleFieldCopyPopupOutside, { once: true });
      return;
    }
    hideFieldCopyPopup();
  }

  function hideFieldCopyPopup() {
    document.removeEventListener("pointerdown", handleFieldCopyPopupOutside);
    document.querySelector("[data-field-copy-popup]")?.remove();
  }

  function isCopyableControl(control) {
    const type = String(control.type || "").toLowerCase();
    if (["hidden", "file", "button", "submit", "reset"].includes(type)) return false;
    if (control.matches("[data-action='filter-lookup-values'], [data-event-editor-date], [data-event-editor-label]")) return false;
    return true;
  }

  function getControlCopyValue(control) {
    const selectedText = getSelectedControlText(control);
    if (selectedText) return selectedText;
    if (control.type === "checkbox") return control.checked ? (control.value || "Да") : "Нет";
    if (control.tagName === "SELECT") return control.selectedOptions?.[0]?.textContent || control.value || "";
    return control.value || "";
  }

  function getSelectedControlText(control) {
    if (!["INPUT", "TEXTAREA"].includes(control.tagName)) return "";
    try {
      const start = control.selectionStart;
      const end = control.selectionEnd;
      if (typeof start !== "number" || typeof end !== "number" || end <= start) return "";
      return String(control.value || "").slice(start, end);
    } catch (error) {
      return "";
    }
  }

  async function copyTextToClipboard(text) {
    const value = String(text ?? "");
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(value);
        return;
      } catch (error) {
        console.warn("Не удалось скопировать через Clipboard API", error);
      }
    }
    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
  }

  function saveFormRecord(formElement) {
    if (!formElement) return "";
    const config = configs[formElement.dataset.config];
    const rows = state.data.collections[config.collection];
    const formData = new FormData(formElement);
    const isStudentCard = formElement.dataset.config === "students";
    const currentRecord = formElement.dataset.id ? rows.find((row) => row.id === formElement.dataset.id) || {} : {};
    const values = isStudentCard ? { ...currentRecord, ...(state.modal?.draft || {}) } : {};
    const fields = isStudentCard ? studentAllFields : config.fields;
    fields.forEach((item) => {
      if (item.type === "checkbox") {
        if (!formElement.elements[item.key]) return;
        values[item.key] = formData.has(item.key) ? "Да" : "";
        return;
      }
      if (!formData.has(item.key)) return;
      const raw = formData.get(item.key);
      values[item.key] = item.type === "number" ? Number(raw || 0) : String(raw || "");
    });
    if (isStudentCard) {
      formData.forEach((raw, key) => {
        if (/^event_[A-Za-z0-9_-]+_(state|date|label)$/.test(key)) {
          values[key] = String(raw || "");
        }
      });
      clearUnchangedGeneratedCommunicationMessages(values, formElement);
    }
    if (!formElement.dataset.id && fields.some((item) => item.key === "uid") && !values.uid) {
      values.uid = getNextUid();
    }
    if (isStudentCard) {
      values.inn = normalizeInn(values.inn);
      values.snils = formatSnils(values.snils);
      values.customerInn = normalizeInn(values.customerInn);
      values.customerSnils = formatSnils(values.customerSnils);
      const innInput = formElement.querySelector("[name='inn']");
      const snilsInput = formElement.querySelector("[name='snils']");
      const customerInnInput = formElement.querySelector("[name='customerInn']");
      const customerSnilsInput = formElement.querySelector("[name='customerSnils']");
      if (innInput) innInput.value = values.inn;
      if (snilsInput) snilsInput.value = values.snils;
      if (customerInnInput) customerInnInput.value = values.customerInn;
      if (customerSnilsInput) customerSnilsInput.value = values.customerSnils;
      if (!validateStudentIdentityValue("inn", values.inn, innInput)
        || !validateStudentIdentityValue("snils", values.snils, snilsInput)
        || !validateStudentIdentityValue("customerInn", values.customerInn, customerInnInput)
        || !validateStudentIdentityValue("customerSnils", values.customerSnils, customerSnilsInput)) return "";
      const selectedProgram = findProgramByName(values.program);
      if (selectedProgram) {
        values.educationType = selectedProgram.type || values.educationType || "";
        values.studyForm = selectedProgram.studyForm || values.studyForm || "";
        values.hours = selectedProgram.hours || values.hours || "";
      }
      const paymentTotal = sumStudentPayments(values);
      const expenseTotal = sumStudentExpenses(values);
      if (paymentTotal > 0) values.paidAmount = paymentTotal;
      if (expenseTotal > 0) values.expenseTotal = expenseTotal;
      values.balance = calculateStudentBalance(values);
    }

    let savedId = formElement.dataset.id;
    if (formElement.dataset.id) {
      const index = rows.findIndex((row) => row.id === formElement.dataset.id);
      rows[index] = { ...rows[index], ...values };
      addAudit("Изменена запись", config.title, values.name || values.contractNo || values.code || values.itemType || "");
    } else {
      savedId = makeId(config.collection);
      rows.unshift({ id: savedId, ...values });
      addAudit("Создана запись", config.title, values.name || values.contractNo || values.code || values.itemType || "");
    }
    return savedId;
  }

  function saveRecord(event) {
    event.preventDefault();
    const savedId = saveFormRecord(event.currentTarget);
    if (!savedId) return;
    state.modal = null;
    persist();
    render();
  }

  async function handleStudentPhoto(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      alert("Выберите файл изображения.");
      return;
    }
    const reader = new FileReader();
    reader.onload = async () => {
      const hidden = document.getElementById("studentPhotoData");
      const pathInput = document.getElementById("studentPhotoPath");
      const urlInput = document.getElementById("studentPhotoUrl");
      const preview = document.getElementById("studentPhotoPreview");
      try {
        preview?.classList.add("is-loading");
        const studentName = document.querySelector("[name='name']")?.value || "";
        const uploaded = await uploadStoredPhoto(reader.result, pathInput?.value || "", {
          studentName,
          name: studentName,
          applicationDate: document.querySelector("[name='applicationDate']")?.value || ""
        });
        if (hidden) hidden.value = reader.result;
        if (pathInput) pathInput.value = uploaded.photoPath;
        if (urlInput) urlInput.value = uploaded.photoUrl;
        if (preview) {
          preview.classList.add("has-photo");
          preview.querySelector(":scope > span")?.remove();
          const image = preview.querySelector("img");
          if (image) {
            image.src = uploaded.photoUrl;
          } else {
            preview.insertAdjacentHTML("afterbegin", `<img src="${escapeAttr(uploaded.photoUrl)}" alt="Фото слушателя">`);
          }
        }
      } catch (error) {
        console.warn("Не удалось сохранить фото через app-server.js, фото будет сохранено в карточке", error);
        if (hidden) hidden.value = reader.result;
        if (pathInput) pathInput.value = "";
        if (urlInput) urlInput.value = "";
        if (preview) {
          preview.classList.add("has-photo");
          preview.querySelector(":scope > span")?.remove();
          const image = preview.querySelector("img");
          if (image) {
            image.src = reader.result;
          } else {
            preview.insertAdjacentHTML("afterbegin", `<img src="${escapeAttr(reader.result)}" alt="Фото слушателя">`);
          }
        }
      } finally {
        preview?.classList.remove("is-loading");
        event.target.value = "";
      }
    };
    reader.readAsDataURL(file);
  }

  function photoServerOrigin() {
    return window.location.protocol === "http:" || window.location.protocol === "https:"
      ? window.location.origin
      : defaultPhotoServerOrigin;
  }

  function photoApiUrl(pathname) {
    return `${photoServerOrigin()}${pathname}`;
  }

  function photoPublicUrl(pathOrUrl) {
    const value = String(pathOrUrl || "");
    if (!value) return "";
    if (/^https?:\/\//i.test(value) || value.startsWith("data:")) return value;
    const pathname = value.startsWith("/") ? value : `/${value}`;
    return window.location.protocol === "file:" ? pathname.replace(/^\/+/, "") : pathname;
  }

  async function uploadStoredPhoto(dataUrl, previousPath = "", meta = {}) {
    let response;
    try {
      response = await fetch(photoApiUrl("/api/photos"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dataUrl, previousPath, ...meta })
      });
    } catch (error) {
      throw new Error(`не удалось подключиться к app-server.js (${photoServerOrigin()})`);
    }
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "ошибка загрузки");
    return {
      ...payload,
      photoUrl: photoPublicUrl(payload.photoUrl || payload.photoPath)
    };
  }

  async function deleteStoredPhoto(photoPath) {
    if (!photoPath) return;
    let response;
    try {
      response = await fetch(photoApiUrl("/api/photos"), {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ photoPath })
      });
    } catch (error) {
      throw new Error(`не удалось подключиться к app-server.js (${photoServerOrigin()})`);
    }
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || "ошибка удаления");
    }
  }

  function getStudentPhotoSrc(record) {
    if (record.photoData) return record.photoData;
    if (window.location.protocol === "file:" && record.photoPath) return photoPublicUrl(record.photoPath);
    return photoPublicUrl(record.photoUrl || record.photoPath);
  }

  async function deleteRecord(configId, id) {
    const config = configs[configId];
    const rows = state.data.collections[config.collection];
    const record = rows.find((row) => row.id === id);
    if (!record) return;
    if (!confirm("Удалить запись?")) return;
    if (configId === "students" && record.photoPath) {
      try {
        await deleteStoredPhoto(record.photoPath);
      } catch (error) {
        alert("Запись не удалена: не удалось удалить фото из хранилища. " + error.message);
        return;
      }
    }
    state.data.collections[config.collection] = rows.filter((row) => row.id !== id);
    addAudit("Удалена запись", config.title, record.name || record.contractNo || record.code || record.itemType || id);
    persist();
    render();
  }

  async function bulkDelete(configId) {
    const config = configs[configId];
    const selected = getSelected(configId);
    if (!selected.length) return;
    if (!confirm(`Удалить выбранные записи: ${selected.length}?`)) return;
    const selectedSet = new Set(selected);
    if (configId === "students") {
      const selectedStudents = getRowsByIds(config.collection, selected);
      try {
        for (const student of selectedStudents) {
          if (student.photoPath) await deleteStoredPhoto(student.photoPath);
        }
      } catch (error) {
        alert("Записи не удалены: не удалось удалить фото из хранилища. " + error.message);
        return;
      }
    }
    state.data.collections[config.collection] = (state.data.collections[config.collection] || []).filter((row) => !selectedSet.has(row.id));
    state.selected[configId] = [];
    addAudit("Массовое удаление", config.title, `${selected.length} записей`);
    persist();
    render();
  }

  function bulkSetStatus(configId) {
    const config = configs[configId];
    const selected = getSelected(configId);
    const status = document.getElementById("bulkStatusSelect")?.value;
    if (!selected.length || !status) return;
    const selectedSet = new Set(selected);
    state.data.collections[config.collection] = (state.data.collections[config.collection] || []).map((row) => (
      selectedSet.has(row.id) ? { ...row, status } : row
    ));
    addAudit("Массовое изменение статуса", config.title, `${selected.length} записей: ${status}`);
    persist();
    render();
  }

  function addDictionaryValue(event) {
    event.preventDefault();
    const dict = event.currentTarget.dataset.dict;
    const input = event.currentTarget.querySelector("input");
    const values = parseDictionaryValues(input.value, dict);
    if (!values.length) {
      input.focus();
      return;
    }
    addDictionaryValues(dict, values);
    input.value = "";
    state.dictionaryAddFocus = dict;
    addAudit("Изменен справочник", dictionaryTitle(dict), values.join(", "));
    persist();
    render();
  }

  function saveCommunicationTemplates(event) {
    event.preventDefault();
    collectCommunicationTemplateFormDraft(event.currentTarget);
    addAudit("Изменен справочник", dictionaryTitle("communicationTemplates"), "Сохранены шаблоны сообщений");
    persist();
    render();
  }

  function collectCommunicationTemplateFormDraft(form = document.querySelector("form[data-action='save-communication-templates']")) {
    if (!form) return;
    form.querySelectorAll("[data-template-editor]").forEach(syncCommunicationTemplateEditor);
    state.data.dictionaries.communicationTemplates = studentCommunicationMessages.map((message, index) => (
      replaceCommunicationTemplateFieldAliases(String(form.elements[`template${index}`]?.value || ""))
    ));
    state.data.dictionaries.communicationTemplateDescriptions = studentCommunicationMessages.map((message, index) => (
      String(form.elements[`description${index}`]?.value || "").trim() || message.label
    ));
  }

  function resetCommunicationTemplates() {
    if (!confirm("Восстановить исходные шаблоны типовых сообщений?")) return;
    state.data.dictionaries.communicationTemplates = [...studentCommunicationTemplateDefaults];
    state.data.dictionaries.communicationTemplateDescriptions = studentCommunicationMessages.map((message) => message.label);
    addAudit("Изменен справочник", dictionaryTitle("communicationTemplates"), "Восстановлены исходные шаблоны");
    persist();
    render();
  }

  function saveDataFormulas(event) {
    event.preventDefault();
    const form = event.currentTarget;
    form.querySelectorAll("[data-data-formula-editor]").forEach(syncDataFormulaEditor);
    const current = normalizeDataFormulaTemplates(state.data.dictionaries.dataFormulas);
    state.data.dictionaries.dataFormulas = current.map((formula, index) => ({
      ...formula,
      template: String(form.elements[`formula${index}`]?.value || formula.template)
    }));
    addAudit("Изменен справочник", dictionaryTitle("dataFormulas"), "Сохранены формулы генерации номеров");
    persist();
    render();
  }

  function resetDataFormulas() {
    if (!confirm("Восстановить исходные формулы генерации номеров?")) return;
    state.data.dictionaries.dataFormulas = normalizeDataFormulaTemplates([]);
    addAudit("Изменен справочник", dictionaryTitle("dataFormulas"), "Восстановлены исходные формулы");
    persist();
    render();
  }

  function saveSdoSettings(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const settings = sdoSettingDefaults.map((setting) => ({
      ...setting,
      value: String(form.elements[setting.key]?.value || "").trim()
    }));
    const invalidSetting = settings.find((setting) => !normalizeExternalUrl(setting.value));
    if (invalidSetting) {
      alert(`Укажите корректный адрес: ${invalidSetting.label}.`);
      form.elements[invalidSetting.key]?.focus();
      return;
    }
    state.data.dictionaries.sdoSettings = settings;
    addAudit("Изменен справочник", dictionaryTitle("sdoSettings"), "Сохранены настройки СДО");
    persist();
    render();
  }

  function resetSdoSettings() {
    if (!confirm("Восстановить исходные настройки СДО?")) return;
    state.data.dictionaries.sdoSettings = normalizeSdoSettings([]);
    addAudit("Изменен справочник", dictionaryTitle("sdoSettings"), "Восстановлены исходные настройки СДО");
    persist();
    render();
  }

  function sortCommunicationTemplateFields(order = "asc") {
    collectCommunicationTemplateFormDraft();
    state.communicationTemplateFieldSort = order === "desc" ? "desc" : "asc";
    render();
  }

  function initializeCommunicationTemplateEditorHistory(editor) {
    if (!editor || communicationTemplateEditorHistories.has(editor)) return;
    communicationTemplateEditorHistories.set(editor, {
      undo: [],
      redo: [],
      current: serializeCommunicationTemplateEditor(editor),
      applying: false
    });
  }

  function recordCommunicationTemplateEditorChange(editor) {
    if (!editor) return;
    initializeCommunicationTemplateEditorHistory(editor);
    const history = communicationTemplateEditorHistories.get(editor);
    if (!history || history.applying) return;
    const value = serializeCommunicationTemplateEditor(editor);
    commitCommunicationTemplateEditorChange(editor, history.current, value);
  }

  function commitCommunicationTemplateEditorChange(editor, previousValue, nextValue = serializeCommunicationTemplateEditor(editor)) {
    if (!editor) return;
    initializeCommunicationTemplateEditorHistory(editor);
    const history = communicationTemplateEditorHistories.get(editor);
    if (!history || history.applying || previousValue === nextValue) return;
    history.undo.push(previousValue);
    if (history.undo.length > 100) history.undo.shift();
    history.redo = [];
    history.current = nextValue;
  }

  function syncCommunicationTemplateEditorByType(editor) {
    if (!editor) return;
    if (editor.matches("[data-data-formula-editor]")) syncDataFormulaEditor(editor);
    else if (editor.matches("[data-formula-editor]")) syncCommunicationTemplateFormulaEditor(editor);
    else syncCommunicationTemplateEditor(editor);
  }

  function renderCommunicationTemplateEditorValue(editor, value) {
    if (editor.matches("[data-data-formula-editor]")) {
      editor.innerHTML = renderDataFormulaEditorContent(value);
    } else if (editor.matches("[data-formula-editor]")) {
      editor.innerHTML = renderCommunicationTemplateFormulaEditorContent(value);
    } else {
      editor.innerHTML = renderCommunicationTemplateEditorContent(value);
    }
    syncCommunicationTemplateEditorByType(editor);
  }

  function restoreCommunicationTemplateEditorHistoryValue(editor, value) {
    initializeCommunicationTemplateEditorHistory(editor);
    const history = communicationTemplateEditorHistories.get(editor);
    if (!history) return;
    history.applying = true;
    renderCommunicationTemplateEditorValue(editor, value);
    history.current = value;
    history.applying = false;
    editor.focus({ preventScroll: true });
    setCommunicationTemplateEditorCaretOffset(editor, value.length);
  }

  function undoCommunicationTemplateEditor(editor) {
    initializeCommunicationTemplateEditorHistory(editor);
    const history = communicationTemplateEditorHistories.get(editor);
    if (!history?.undo.length) return false;
    const current = serializeCommunicationTemplateEditor(editor);
    if (current !== history.current) history.current = current;
    const previous = history.undo.pop();
    history.redo.push(history.current);
    restoreCommunicationTemplateEditorHistoryValue(editor, previous);
    return true;
  }

  function redoCommunicationTemplateEditor(editor) {
    initializeCommunicationTemplateEditorHistory(editor);
    const history = communicationTemplateEditorHistories.get(editor);
    if (!history?.redo.length) return false;
    const current = serializeCommunicationTemplateEditor(editor);
    if (current !== history.current) history.current = current;
    const next = history.redo.pop();
    history.undo.push(history.current);
    restoreCommunicationTemplateEditorHistoryValue(editor, next);
    return true;
  }

  function handleCommunicationTemplateEditorHistoryKeydown(event, editor) {
    if (!(event.ctrlKey || event.metaKey)) return false;
    const key = String(event.key || "").toLowerCase();
    const code = String(event.code || "");
    const isUndoKey = key === "z" || code === "KeyZ";
    const isRedoKey = key === "y" || code === "KeyY";
    if (isUndoKey && !event.shiftKey) {
      event.preventDefault();
      return undoCommunicationTemplateEditor(editor);
    }
    if (isRedoKey || (isUndoKey && event.shiftKey)) {
      event.preventDefault();
      return redoCommunicationTemplateEditor(editor);
    }
    return false;
  }

  function bindCommunicationTemplateFieldActions() {
    const form = document.querySelector("form[data-action='save-communication-templates']");
    if (!form) return;
    form.querySelector("[data-action='add-communication-template-field']")?.addEventListener("click", () => (
      showCommunicationTemplateFieldDialog()
    ));
    form.addEventListener("contextmenu", (event) => {
      const token = event.target.closest?.("[data-template-field-name]");
      if (!token || !form.contains(token)) return;
      event.preventDefault();
      event.stopPropagation();
      showCommunicationTemplateFieldMenu(token.dataset.templateFieldName, event.clientX, event.clientY, token);
    });
  }

  function showCommunicationTemplateFieldMenu(fieldName, x, y, sourceToken = null) {
    hideCommunicationTemplateFieldMenu();
    const field = getCommunicationTemplateFieldDefinitions().find((item) => item.name === fieldName);
    if (!field) return;
    const isFormulaBlock = Boolean(
      sourceToken?.matches?.(".communication-template-block") &&
      sourceToken.closest("[data-formula-editor]")
    );
    const isMessageBlock = Boolean(
      sourceToken?.matches?.(".communication-template-block") &&
      sourceToken.closest("[data-template-editor]")
    );
    const formulaEditor = isFormulaBlock ? sourceToken.closest("[data-formula-editor]") : null;
    const formulaOccurrence = isFormulaBlock ? {
      editor: formulaEditor,
      token: sourceToken.dataset.templateToken || sourceToken.textContent || "",
      offset: getCommunicationTemplateNodeStartOffset(formulaEditor, sourceToken)
    } : null;
    const isTemplateBlock = isFormulaBlock || isMessageBlock;
    const isRestored = field.formula === field.initialFormula;
    const popup = document.createElement("div");
    popup.className = "communication-template-field-menu";
    popup.dataset.communicationTemplateFieldMenu = "";
    popup.innerHTML = `
      <button data-action="edit-communication-template-field" type="button">
        ${renderCommunicationTemplateFieldActionIcon("edit")}
        <span>Редактировать</span>
      </button>
      <button class="is-danger" data-action="delete-communication-template-field" type="button" ${isTemplateBlock || field.custom ? "" : "disabled"}>
        ${renderCommunicationTemplateFieldActionIcon("delete")}
        <span>${isFormulaBlock ? "Удалить из формулы" : isMessageBlock ? "Удалить из сообщения" : "Удалить"}</span>
      </button>
      <button data-action="restore-communication-template-field" type="button" ${isRestored ? "disabled" : ""}>
        ${renderCommunicationTemplateFieldActionIcon("restore")}
        <span>Восстановить</span>
      </button>
    `;
    document.body.appendChild(popup);
    const rect = popup.getBoundingClientRect();
    popup.style.left = `${clamp(x, 8, Math.max(8, window.innerWidth - rect.width - 8))}px`;
    popup.style.top = `${clamp(y, 8, Math.max(8, window.innerHeight - rect.height - 8))}px`;
    popup.querySelector("[data-action='edit-communication-template-field']")?.addEventListener("click", () => (
      showCommunicationTemplateFieldDialog(field)
    ));
    popup.querySelector("[data-action='delete-communication-template-field']")?.addEventListener("click", () => {
      if (isFormulaBlock) {
        deleteCommunicationTemplateFormulaOccurrence(sourceToken, formulaOccurrence);
        return;
      }
      if (isMessageBlock) {
        deleteCommunicationTemplateBlock(sourceToken);
        return;
      }
      deleteCommunicationTemplateField(field);
    });
    popup.querySelector("[data-action='restore-communication-template-field']")?.addEventListener("click", () => (
      restoreCommunicationTemplateField(field)
    ));
    window.setTimeout(() => document.addEventListener("pointerdown", closeCommunicationTemplateFieldMenuOnOutsideClick, { capture: true, once: true }));
  }

  function renderCommunicationTemplateFieldActionIcon(action) {
    if (action === "delete") {
      return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16"></path><path d="M10 11v6"></path><path d="M14 11v6"></path><path d="m9 7 1-3h4l1 3"></path><path d="M6 7l1 13h10l1-13"></path></svg>`;
    }
    if (action === "restore") {
      return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7"></path><path d="M3 4v6h6"></path></svg>`;
    }
    return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14 5 5 5"></path><path d="M4 20h5L19 10a3.5 3.5 0 0 0-5-5L4 15z"></path></svg>`;
  }

  function closeCommunicationTemplateFieldMenuOnOutsideClick(event) {
    if (event.target.closest("[data-communication-template-field-menu]")) {
      document.addEventListener("pointerdown", closeCommunicationTemplateFieldMenuOnOutsideClick, { capture: true, once: true });
      return;
    }
    hideCommunicationTemplateFieldMenu();
  }

  function hideCommunicationTemplateFieldMenu() {
    document.removeEventListener("pointerdown", closeCommunicationTemplateFieldMenuOnOutsideClick, { capture: true });
    document.querySelector("[data-communication-template-field-menu]")?.remove();
  }

  function showCommunicationTemplateFieldDialog(field = null) {
    hideCommunicationTemplateFieldMenu();
    document.querySelector("[data-communication-template-field-dialog]")?.remove();
    const isStandardField = Boolean(field && !field.custom);
    const fieldSortOrder = state.communicationTemplateFieldSort === "desc" ? "desc" : "asc";
    const availableFields = sortCommunicationTemplateFieldDefinitions(
      getCommunicationTemplateFieldDefinitions(),
      fieldSortOrder
    );
    const dialog = document.createElement("div");
    dialog.className = "communication-template-field-dialog-backdrop";
    dialog.dataset.communicationTemplateFieldDialog = "";
    dialog.innerHTML = `
      <form class="communication-template-field-dialog">
        <header>
          <strong>${field ? "Редактирование поля" : "Новое поле"}</strong>
          <button data-action="close-communication-template-field-dialog" type="button" title="Закрыть" aria-label="Закрыть">×</button>
        </header>
        <label>
          <span>Название поля</span>
          <input name="fieldName" value="${escapeAttr(field?.name || "")}" placeholder="Например, СсылкаНаКурс" ${field ? "readonly" : ""} ${isStandardField ? 'class="is-standard-field-name"' : ""} required />
        </label>
        <label>
          <span title="Поддерживаются ссылки {Поле} и условия {{если:Условие}}...{{иначе}}...{{конец}}">Формула</span>
          <div
            class="communication-template-editor communication-template-formula-editor"
            contenteditable="true"
            data-formula-editor
            role="textbox"
            aria-label="Формула поля"
            aria-multiline="true"
          >${renderCommunicationTemplateFormulaEditorContent(field?.formula || "")}</div>
          <input name="formula" value="${escapeAttr(field?.formula || "")}" type="hidden" />
        </label>
        <section class="communication-template-field-dialog-fields">
          <div class="communication-template-field-dialog-fields-head">
            <strong>Доступные поля для формулы</strong>
            <span>Перетащите в формулу</span>
          </div>
          <div class="communication-template-field-list">
            ${availableFields.map((availableField) => renderCommunicationTemplateFieldToken(
              availableField,
              "Перетащите поле в формулу. Нажмите правой кнопкой мыши для настройки"
            )).join("")}
          </div>
        </section>
        <footer>
          <button class="ghost-button" data-action="close-communication-template-field-dialog" type="button">Отмена</button>
          <button class="primary-button" type="submit">${field ? "Сохранить" : "Добавить"}</button>
        </footer>
      </form>
    `;
    document.body.appendChild(dialog);
    const close = () => dialog.remove();
    dialog.addEventListener("pointerdown", (event) => {
      if (event.target === dialog) close();
    });
    dialog.querySelectorAll("[data-action='close-communication-template-field-dialog']").forEach((button) => {
      button.addEventListener("click", close);
    });
    dialog.querySelector("form")?.addEventListener("submit", (event) => {
      event.preventDefault();
      saveCommunicationTemplateField(dialog, field);
    });
    bindCommunicationTemplateFieldDialogFields(dialog);
    dialog.querySelector(field ? "[data-formula-editor]" : "[name='fieldName']")?.focus();
  }

  function bindCommunicationTemplateFieldDialogFields(dialog) {
    const tokenMime = "application/x-ais-template-field";
    const editor = dialog.querySelector("[data-formula-editor]");
    if (!editor) return;
    let draggedFormulaBlock = null;
    let formulaHighlightTimer = null;
    initializeCommunicationTemplateEditorHistory(editor);

    editor.addEventListener("compositionstart", () => {
      editor.dataset.composing = "true";
    });
    editor.addEventListener("compositionend", () => {
      editor.dataset.composing = "";
      syncCommunicationTemplateFormulaEditor(editor);
      refreshCommunicationTemplateFormulaEditor(editor, true);
    });
    editor.addEventListener("input", () => {
      recordCommunicationTemplateEditorChange(editor);
      syncCommunicationTemplateFormulaEditor(editor);
      if (editor.dataset.composing === "true") return;
      window.clearTimeout(formulaHighlightTimer);
      formulaHighlightTimer = window.setTimeout(() => {
        refreshCommunicationTemplateFormulaEditor(editor, true);
      }, 140);
    });
    editor.addEventListener("keydown", (event) => {
      if (handleCommunicationTemplateEditorHistoryKeydown(event, editor)) {
        window.clearTimeout(formulaHighlightTimer);
      }
    });
    editor.addEventListener("blur", () => {
      window.clearTimeout(formulaHighlightTimer);
      refreshCommunicationTemplateFormulaEditor(editor);
    });
    dialog.addEventListener("dragstart", (event) => {
      const token = event.target.closest?.("[data-template-token]");
      if (!token || !dialog.contains(token) || !event.dataTransfer) return;
      const value = token.dataset.templateToken || "";
      draggedFormulaBlock = token.matches(".communication-template-block") && token.closest("[data-formula-editor]") ? token : null;
      event.dataTransfer.effectAllowed = draggedFormulaBlock ? "move" : "copy";
      event.dataTransfer.setData("text/plain", value);
      event.dataTransfer.setData(tokenMime, value);
      token.classList.add("is-dragging");
    });
    dialog.addEventListener("dragend", (event) => {
      event.target.closest?.("[data-template-token]")?.classList.remove("is-dragging");
      editor.classList.remove("is-drop-target");
      window.clearTimeout(formulaHighlightTimer);
      syncCommunicationTemplateFormulaEditor(editor);
      draggedFormulaBlock = null;
    });
    dialog.addEventListener("contextmenu", (event) => {
      const token = event.target.closest?.("[data-template-field-name]");
      if (!token || !dialog.contains(token)) return;
      event.preventDefault();
      event.stopPropagation();
      showCommunicationTemplateFieldMenu(token.dataset.templateFieldName, event.clientX, event.clientY, token);
    });
    editor.addEventListener("dragover", (event) => {
      if (!Array.from(event.dataTransfer?.types || []).includes(tokenMime)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = draggedFormulaBlock ? "move" : "copy";
      editor.classList.add("is-drop-target");
    });
    editor.addEventListener("dragleave", () => editor.classList.remove("is-drop-target"));
    editor.addEventListener("drop", (event) => {
      const token = event.dataTransfer?.getData(tokenMime) || "";
      if (!token) return;
      event.preventDefault();
      editor.classList.remove("is-drop-target");
      const range = getCommunicationTemplateDropRange(editor, event.clientX, event.clientY);
      if (draggedFormulaBlock?.contains(range?.startContainer)) return;
      const block = draggedFormulaBlock || createCommunicationTemplateBlock(token);
      const beforeValue = serializeCommunicationTemplateEditor(editor);
      if (range) {
        range.insertNode(block);
      } else {
        editor.append(block);
      }
      commitCommunicationTemplateEditorChange(editor, beforeValue);
      syncCommunicationTemplateFormulaEditor(editor);
      refreshCommunicationTemplateFormulaEditor(editor, true);
      editor.focus({ preventScroll: true });
    });
  }

  function syncCommunicationTemplateFormulaEditor(editor) {
    const hiddenInput = editor.closest("form")?.elements.formula;
    if (hiddenInput) hiddenInput.value = serializeCommunicationTemplateEditor(editor);
  }

  function refreshCommunicationTemplateFormulaEditor(editor, preserveCaret = false) {
    const formula = serializeCommunicationTemplateEditor(editor);
    const caretOffset = preserveCaret ? getCommunicationTemplateEditorCaretOffset(editor) : null;
    editor.innerHTML = renderCommunicationTemplateFormulaEditorContent(formula);
    const hiddenInput = editor.closest("form")?.elements.formula;
    if (hiddenInput) hiddenInput.value = formula;
    if (preserveCaret) setCommunicationTemplateEditorCaretOffset(editor, caretOffset);
  }

  function getCommunicationTemplateEditorCaretOffset(editor) {
    const selection = window.getSelection?.();
    if (!selection?.rangeCount || !editor.contains(selection.anchorNode)) {
      return serializeCommunicationTemplateEditor(editor).length;
    }
    const range = selection.getRangeAt(0).cloneRange();
    range.selectNodeContents(editor);
    range.setEnd(selection.anchorNode, selection.anchorOffset);
    const fragment = document.createElement("div");
    fragment.append(range.cloneContents());
    return serializeCommunicationTemplateEditor(fragment).length;
  }

  function setCommunicationTemplateEditorCaretOffset(editor, offset) {
    const selection = window.getSelection?.();
    if (!selection) return;
    const range = document.createRange();
    let remaining = Math.max(0, Number(offset || 0));
    let placed = false;
    const placeInNode = (node) => {
      if (placed) return;
      if (node.nodeType === Node.TEXT_NODE) {
        const length = node.nodeValue?.length || 0;
        if (remaining <= length) {
          range.setStart(node, remaining);
          placed = true;
          return;
        }
        remaining -= length;
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      if (node.matches("[data-template-token]")) {
        const tokenLength = (node.dataset.templateToken || node.textContent || "").length;
        if (remaining <= 0) {
          range.setStartBefore(node);
          placed = true;
          return;
        }
        if (remaining < tokenLength) {
          range.setStartAfter(node);
          placed = true;
          return;
        }
        remaining -= tokenLength;
        return;
      }
      if (node.tagName === "BR") {
        if (remaining <= 0) {
          range.setStartBefore(node);
          placed = true;
          return;
        }
        remaining -= 1;
        return;
      }
      Array.from(node.childNodes).forEach(placeInNode);
    };
    Array.from(editor.childNodes).forEach(placeInNode);
    if (!placed) {
      range.selectNodeContents(editor);
      range.collapse(false);
    } else {
      range.collapse(true);
    }
    selection.removeAllRanges();
    selection.addRange(range);
  }

  function saveCommunicationTemplateField(dialog, existingField) {
    const form = dialog.querySelector("form");
    dialog.querySelectorAll("[data-formula-editor]").forEach(syncCommunicationTemplateFormulaEditor);
    const name = getCommunicationTemplateFieldAlias(normalizeCommunicationTemplateFieldName(form.elements.fieldName.value));
    const formula = replaceCommunicationTemplateFieldAliases(String(form.elements.formula.value || ""));
    if (!name) {
      form.elements.fieldName.focus();
      return;
    }
    const duplicate = getCommunicationTemplateFieldDefinitions().some((field) => field.name === name);
    if (!existingField && duplicate) {
      alert("Поле с таким названием уже существует.");
      form.elements.fieldName.focus();
      return;
    }
    collectCommunicationTemplateFormDraft();
    if (existingField) {
      state.data.dictionaries.communicationTemplateFieldOverrides[name] = formula;
    } else {
      state.data.dictionaries.communicationTemplateCustomFields.push({ name, formula, initialFormula: formula });
    }
    addAudit(existingField ? "Изменено поле шаблона" : "Добавлено поле шаблона", name, formula);
    persist();
    dialog.remove();
    render();
  }

  function deleteCommunicationTemplateField(field) {
    hideCommunicationTemplateFieldMenu();
    if (!field.custom || !confirm(`Удалить пользовательское поле {${field.name}}? Ссылки на него останутся в сообщениях как обычный текст.`)) return;
    collectCommunicationTemplateFormDraft();
    state.data.dictionaries.communicationTemplateCustomFields = state.data.dictionaries.communicationTemplateCustomFields
      .filter((item) => item.name !== field.name);
    delete state.data.dictionaries.communicationTemplateFieldOverrides[field.name];
    addAudit("Удалено поле шаблона", field.name, "");
    persist();
    render();
  }

  function deleteCommunicationTemplateBlock(block) {
    hideCommunicationTemplateFieldMenu();
    const editor = block?.closest?.("[data-template-editor]");
    if (!editor) return;
    const beforeValue = serializeCommunicationTemplateEditor(editor);
    block.remove();
    commitCommunicationTemplateEditorChange(editor, beforeValue);
    syncCommunicationTemplateEditor(editor);
    editor.focus({ preventScroll: true });
  }

  function deleteCommunicationTemplateFormulaOccurrence(block, occurrence = null) {
    hideCommunicationTemplateFieldMenu();
    const editor = block?.closest?.("[data-formula-editor]") ||
      (occurrence?.editor?.isConnected ? occurrence.editor : document.querySelector("[data-formula-editor]"));
    const token = occurrence?.token || block?.dataset?.templateToken || block?.textContent || "";
    if (!editor || !token) return;
    const beforeValue = serializeCommunicationTemplateEditor(editor);
    if (block?.isConnected && block.closest("[data-formula-editor]") === editor) {
      block.remove();
      commitCommunicationTemplateEditorChange(editor, beforeValue);
      syncCommunicationTemplateFormulaEditor(editor);
    } else {
      const formula = serializeCommunicationTemplateEditor(editor);
      const offset = Number.isFinite(occurrence?.offset) ? occurrence.offset : formula.indexOf(token);
      const safeOffset = formula.slice(offset, offset + token.length) === token ? offset : formula.indexOf(token);
      if (safeOffset < 0) return;
      const nextFormula = `${formula.slice(0, safeOffset)}${formula.slice(safeOffset + token.length)}`;
      editor.innerHTML = renderCommunicationTemplateFormulaEditorContent(nextFormula);
      const hiddenInput = editor.closest("form")?.elements.formula;
      if (hiddenInput) hiddenInput.value = nextFormula;
      commitCommunicationTemplateEditorChange(editor, beforeValue, nextFormula);
    }
    refreshCommunicationTemplateFormulaEditor(editor, true);
    editor.focus({ preventScroll: true });
  }

  function getCommunicationTemplateNodeStartOffset(editor, targetNode) {
    if (!editor || !targetNode) return 0;
    let offset = 0;
    let found = false;
    const walk = (node) => {
      if (found) return;
      if (node === targetNode) {
        found = true;
        return;
      }
      if (node.nodeType === Node.TEXT_NODE) {
        offset += node.nodeValue?.length || 0;
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      if (node.matches("[data-template-token]")) {
        offset += (node.dataset.templateToken || node.textContent || "").length;
        return;
      }
      if (node.tagName === "BR") {
        offset += 1;
        return;
      }
      Array.from(node.childNodes).forEach(walk);
      if (/^(DIV|P)$/.test(node.tagName)) offset += 1;
    };
    Array.from(editor.childNodes).forEach(walk);
    return offset;
  }

  function restoreCommunicationTemplateField(field) {
    hideCommunicationTemplateFieldMenu();
    collectCommunicationTemplateFormDraft();
    delete state.data.dictionaries.communicationTemplateFieldOverrides[field.name];
    addAudit("Восстановлено поле шаблона", field.name, field.initialFormula);
    persist();
    render();
  }

  function bindDataFormulaConstructor() {
    const tokenMime = "application/x-ais-data-formula-token";
    const form = document.querySelector("form[data-action='save-data-formulas']");
    if (!form) return;
    let draggedBlock = null;

    form.addEventListener("dragstart", (event) => {
      const token = event.target.closest?.("[data-template-token]");
      if (!token || !event.dataTransfer) return;
      const value = token.dataset.templateToken || "";
      draggedBlock = token.matches(".data-formula-block") ? token : null;
      event.dataTransfer.effectAllowed = draggedBlock ? "move" : "copy";
      event.dataTransfer.setData(tokenMime, value);
      event.dataTransfer.setData("text/plain", value);
      token.classList.add("is-dragging");
    });

    form.addEventListener("dragend", (event) => {
      event.target.closest?.("[data-template-token]")?.classList.remove("is-dragging");
      form.querySelectorAll("[data-data-formula-editor]").forEach((editor) => {
        editor.classList.remove("is-drop-target");
        syncDataFormulaEditor(editor);
      });
      draggedBlock = null;
    });

    form.querySelectorAll(".data-formula-token").forEach((button) => {
      button.addEventListener("click", () => {
        const activeIndex = form.dataset.activeFormulaIndex || "0";
        const editor = form.querySelector(`[data-data-formula-editor][data-formula-index="${activeIndex}"]`)
          || form.querySelector("[data-data-formula-editor]");
        if (!editor) return;
        const beforeValue = serializeCommunicationTemplateEditor(editor);
        editor.append(createDataFormulaBlock(button.dataset.templateToken || ""));
        commitCommunicationTemplateEditorChange(editor, beforeValue);
        syncDataFormulaEditor(editor);
        editor.focus({ preventScroll: true });
      });
    });

    form.querySelectorAll("[data-data-formula-editor]").forEach((editor) => {
      initializeCommunicationTemplateEditorHistory(editor);
      editor.addEventListener("focus", () => {
        form.dataset.activeFormulaIndex = editor.dataset.formulaIndex || "0";
      });
      editor.addEventListener("input", () => {
        recordCommunicationTemplateEditorChange(editor);
        syncDataFormulaEditor(editor);
      });
      editor.addEventListener("keydown", (event) => {
        handleCommunicationTemplateEditorHistoryKeydown(event, editor);
      });
      editor.addEventListener("blur", () => refreshDataFormulaEditor(editor));
      editor.addEventListener("dragover", (event) => {
        if (!Array.from(event.dataTransfer?.types || []).includes(tokenMime)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = draggedBlock ? "move" : "copy";
        editor.classList.add("is-drop-target");
      });
      editor.addEventListener("dragleave", () => editor.classList.remove("is-drop-target"));
      editor.addEventListener("drop", (event) => {
        const token = event.dataTransfer?.getData(tokenMime);
        if (!token) return;
        event.preventDefault();
        editor.classList.remove("is-drop-target");
        const sourceEditor = draggedBlock?.closest("[data-data-formula-editor]");
        const range = getCommunicationTemplateDropRange(editor, event.clientX, event.clientY);
        if (draggedBlock?.contains(range?.startContainer)) return;
        const beforeValue = serializeCommunicationTemplateEditor(editor);
        const beforeSourceValue = sourceEditor && sourceEditor !== editor
          ? serializeCommunicationTemplateEditor(sourceEditor)
          : "";
        const block = draggedBlock || createDataFormulaBlock(token);
        if (range) range.insertNode(block);
        else editor.append(block);
        if (sourceEditor && sourceEditor !== editor) {
          commitCommunicationTemplateEditorChange(sourceEditor, beforeSourceValue);
          syncDataFormulaEditor(sourceEditor);
        }
        commitCommunicationTemplateEditorChange(editor, beforeValue);
        syncDataFormulaEditor(editor);
        editor.focus({ preventScroll: true });
      });
    });
  }

  function createDataFormulaBlock(token) {
    const block = createCommunicationTemplateBlock(token);
    block.classList.add("data-formula-block");
    block.removeAttribute("data-template-field-name");
    block.title = "Перетащите блок, чтобы изменить формулу";
    return block;
  }

  function syncDataFormulaEditor(editor) {
    const form = editor.closest("form");
    const index = Number(editor.dataset.formulaIndex);
    const value = serializeCommunicationTemplateEditor(editor);
    const hiddenInput = form?.elements[`formula${index}`];
    if (hiddenInput) hiddenInput.value = value;
    const output = editor.closest(".data-formula-item")?.querySelector("output");
    if (output) output.textContent = evaluateDataFormula(value, new Date(2026, 1, 16), 1);
  }

  function refreshDataFormulaEditor(editor) {
    const value = serializeCommunicationTemplateEditor(editor);
    editor.innerHTML = renderDataFormulaEditorContent(value);
    syncDataFormulaEditor(editor);
  }

  function bindCommunicationTemplateDragAndDrop() {
    const tokenMime = "application/x-ais-template-field";
    const form = document.querySelector("form[data-action='save-communication-templates']");
    if (!form) return;
    let draggedTemplateBlock = null;

    form.addEventListener("dragstart", (event) => {
      const token = event.target.closest?.("[data-template-token]");
      if (!token || !event.dataTransfer) return;
      const value = token.dataset.templateToken || "";
      draggedTemplateBlock = token.matches(".communication-template-block") ? token : null;
      event.dataTransfer.effectAllowed = draggedTemplateBlock ? "move" : "copy";
      event.dataTransfer.setData(tokenMime, value);
      event.dataTransfer.setData("text/plain", value);
      token.classList.add("is-dragging");
    });

    form.addEventListener("dragend", (event) => {
      event.target.closest?.("[data-template-token]")?.classList.remove("is-dragging");
      form.querySelectorAll("[data-template-editor]").forEach((editor) => editor.classList.remove("is-drop-target"));
      form.querySelectorAll("[data-template-editor]").forEach(syncCommunicationTemplateEditor);
      draggedTemplateBlock = null;
    });
    form.querySelectorAll("[data-template-editor]").forEach((editor) => {
      let templateHighlightTimer = null;
      initializeCommunicationTemplateEditorHistory(editor);
      editor.addEventListener("compositionstart", () => {
        editor.dataset.composing = "true";
      });
      editor.addEventListener("compositionend", () => {
        editor.dataset.composing = "";
        syncCommunicationTemplateEditor(editor);
        refreshCommunicationTemplateEditor(editor, true);
      });
      editor.addEventListener("input", () => {
        recordCommunicationTemplateEditorChange(editor);
        syncCommunicationTemplateEditor(editor);
        if (editor.dataset.composing === "true") return;
        window.clearTimeout(templateHighlightTimer);
        templateHighlightTimer = window.setTimeout(() => {
          refreshCommunicationTemplateEditor(editor, true);
        }, 140);
      });
      editor.addEventListener("keydown", (event) => {
        if (handleCommunicationTemplateEditorHistoryKeydown(event, editor)) {
          window.clearTimeout(templateHighlightTimer);
        }
      });
      editor.addEventListener("blur", () => {
        window.clearTimeout(templateHighlightTimer);
        refreshCommunicationTemplateEditor(editor);
      });
      editor.addEventListener("dragover", (event) => {
        if (!Array.from(event.dataTransfer?.types || []).includes(tokenMime)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = draggedTemplateBlock ? "move" : "copy";
        editor.classList.add("is-drop-target");
      });
      editor.addEventListener("dragleave", () => editor.classList.remove("is-drop-target"));
      editor.addEventListener("drop", (event) => {
        const token = event.dataTransfer?.getData(tokenMime);
        if (!token) return;
        event.preventDefault();
        editor.classList.remove("is-drop-target");
        const sourceEditor = draggedTemplateBlock?.closest("[data-template-editor]");
        const range = getCommunicationTemplateDropRange(editor, event.clientX, event.clientY);
        if (draggedTemplateBlock?.contains(range?.startContainer)) return;
        const block = draggedTemplateBlock || createCommunicationTemplateBlock(token);
        const beforeEditorValue = serializeCommunicationTemplateEditor(editor);
        const beforeSourceValue = sourceEditor && sourceEditor !== editor
          ? serializeCommunicationTemplateEditor(sourceEditor)
          : "";
        if (range) {
          range.insertNode(block);
        } else {
          editor.append(block);
        }
        if (sourceEditor && sourceEditor !== editor) {
          commitCommunicationTemplateEditorChange(sourceEditor, beforeSourceValue);
          syncCommunicationTemplateEditor(sourceEditor);
        }
        commitCommunicationTemplateEditorChange(editor, beforeEditorValue);
        syncCommunicationTemplateEditor(editor);
        refreshCommunicationTemplateEditor(editor, true);
        editor.focus();
      });
    });
  }

  function createCommunicationTemplateBlock(token) {
    const block = document.createElement("span");
    const fieldName = /^\{[^{}]+\}$/.test(token) ? token.slice(1, -1) : "";
    block.className = "communication-template-block";
    block.contentEditable = "false";
    block.draggable = true;
    block.dataset.templateToken = token;
    if (fieldName) block.dataset.templateFieldName = fieldName;
    block.title = "Нажмите правой кнопкой мыши для настройки поля";
    block.textContent = token;
    return block;
  }

  function getCommunicationTemplateDropRange(editor, clientX, clientY) {
    let range = null;
    if (document.caretRangeFromPoint) {
      range = document.caretRangeFromPoint(clientX, clientY);
    } else if (document.caretPositionFromPoint) {
      const position = document.caretPositionFromPoint(clientX, clientY);
      if (position) {
        range = document.createRange();
        range.setStart(position.offsetNode, position.offset);
        range.collapse(true);
      }
    }
    if (!range || !editor.contains(range.startContainer)) return null;
    const container = range.startContainer.nodeType === Node.ELEMENT_NODE
      ? range.startContainer
      : range.startContainer.parentElement;
    const tokenBlock = container?.closest?.(".communication-template-block");
    if (tokenBlock) {
      const blockRect = tokenBlock.getBoundingClientRect();
      if (clientX > blockRect.left + (blockRect.width / 2)) range.setStartAfter(tokenBlock);
      else range.setStartBefore(tokenBlock);
      range.collapse(true);
    }
    return range;
  }

  function getCommunicationTemplateRangeAtOffset(editor, offset) {
    if (!editor) return null;
    const range = document.createRange();
    let remaining = Math.max(0, Number(offset || 0));
    let placed = false;
    const placeInNode = (node) => {
      if (placed) return;
      if (node.nodeType === Node.TEXT_NODE) {
        const length = node.nodeValue?.length || 0;
        if (remaining <= length) {
          range.setStart(node, remaining);
          placed = true;
          return;
        }
        remaining -= length;
        return;
      }
      if (node.nodeType !== Node.ELEMENT_NODE) return;
      if (node.matches("[data-template-token]")) {
        const tokenLength = (node.dataset.templateToken || node.textContent || "").length;
        if (remaining <= 0) {
          range.setStartBefore(node);
          placed = true;
          return;
        }
        if (remaining < tokenLength) {
          range.setStartAfter(node);
          placed = true;
          return;
        }
        remaining -= tokenLength;
        return;
      }
      if (node.tagName === "BR") {
        if (remaining <= 0) {
          range.setStartBefore(node);
          placed = true;
          return;
        }
        remaining -= 1;
        return;
      }
      Array.from(node.childNodes).forEach(placeInNode);
      if (!placed && /^(DIV|P)$/.test(node.tagName)) {
        if (remaining <= 0) {
          range.setStartAfter(node);
          placed = true;
          return;
        }
        remaining -= 1;
      }
    };
    Array.from(editor.childNodes).forEach(placeInNode);
    if (!placed) {
      range.selectNodeContents(editor);
      range.collapse(false);
    } else {
      range.collapse(true);
    }
    return range;
  }

  function syncCommunicationTemplateEditor(editor) {
    const hiddenInput = editor.closest("form")?.elements[`template${editor.dataset.templateIndex}`];
    if (hiddenInput) hiddenInput.value = serializeCommunicationTemplateEditor(editor);
  }

  function refreshCommunicationTemplateEditor(editor, preserveCaret = false) {
    const template = serializeCommunicationTemplateEditor(editor);
    const caretOffset = preserveCaret ? getCommunicationTemplateEditorCaretOffset(editor) : null;
    editor.innerHTML = renderCommunicationTemplateEditorContent(template);
    const hiddenInput = editor.closest("form")?.elements[`template${editor.dataset.templateIndex}`];
    if (hiddenInput) hiddenInput.value = template;
    if (preserveCaret) setCommunicationTemplateEditorCaretOffset(editor, caretOffset);
  }

  function serializeCommunicationTemplateEditor(editor) {
    const serializeNode = (node) => {
      if (node.nodeType === Node.TEXT_NODE) return node.nodeValue || "";
      if (node.nodeType !== Node.ELEMENT_NODE) return "";
      if (node.matches("[data-template-token]")) return node.dataset.templateToken || node.textContent || "";
      if (node.tagName === "BR") return "\n";
      const text = Array.from(node.childNodes).map(serializeNode).join("");
      return /^(DIV|P)$/.test(node.tagName) ? `${text}\n` : text;
    };
    return Array.from(editor.childNodes).map(serializeNode).join("").replace(/\n$/, "");
  }

  function pasteDictionaryValues(event) {
    const input = event.currentTarget;
    const form = input.closest("form[data-action='dict-add']");
    const dict = form?.dataset.dict;
    const text = event.clipboardData?.getData("text") || "";
    const values = parseDictionaryValues(text, dict);
    if (!dict || values.length <= 1) return;
    if (!confirmDictionaryPaste(values)) return;
    event.preventDefault();
    addDictionaryValues(dict, values);
    input.value = "";
    state.dictionaryAddFocus = dict;
    addAudit("Изменен справочник", dictionaryTitle(dict), values.join(", "));
    persist();
    render();
  }

  function confirmDictionaryPaste(values) {
    const preview = values.slice(0, 30).map((value) => `- ${value}`).join("\n");
    const rest = values.length > 30 ? `\n...и еще ${values.length - 30}` : "";
    return confirm(`Вставить ${values.length} знач. из буфера обмена?\n\n${preview}${rest}`);
  }

  function parseDictionaryValues(text, dict = "") {
    const separator = dict === "discountRules" ? /[\r\n\t]+/ : /[\r\n\t;]+/;
    return unique(String(text || "")
      .split(separator)
      .map((value) => value.trim())
      .filter(Boolean));
  }

  function addDictionaryValues(dict, values) {
    state.data.dictionaries[dict] = unique([...(state.data.dictionaries[dict] || []), ...values]);
  }

  function sortDictionaryValues(dict, order = "asc") {
    const direction = order === "desc" ? -1 : 1;
    state.data.dictionaries[dict] = [...(state.data.dictionaries[dict] || [])]
      .sort((a, b) => direction * String(a).localeCompare(String(b), "ru"));
    addAudit("Сортировка справочника", dictionaryTitle(dict), order === "desc" ? "Я-А" : "А-Я");
    persist();
    render();
  }

  async function copyDictionaryValues(dict) {
    if (!dict) return;
    const values = state.data.dictionaries[dict] || [];
    if (!values.length) {
      alert("В справочнике нет значений для копирования.");
      return;
    }
    await copyTextToClipboard(values.map((value) => String(value ?? "")).join("\n"));
    alert(`Скопировано значений: ${values.length}`);
  }

  function clearDictionaryValues(dict) {
    if (!dict) return;
    const values = state.data.dictionaries[dict] || [];
    if (!values.length) return;
    if (!confirm(`Очистить справочник "${dictionaryTitle(dict)}"?\n\nБудет удалено значений: ${values.length}`)) return;
    state.data.dictionaries[dict] = [];
    addAudit("Очищен справочник", dictionaryTitle(dict), `${values.length} знач.`);
    persist();
    render();
  }

  function bindDictionaryManualSort(list) {
    list.querySelectorAll(".dictionary-value-chip").forEach((chip) => {
      chip.addEventListener("dragstart", (event) => {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", chip.dataset.value || "");
        chip.classList.add("is-dragging");
      });
      chip.addEventListener("dragend", () => {
        chip.classList.remove("is-dragging");
        saveDictionaryManualOrder(list);
      });
    });
    list.addEventListener("dragover", (event) => {
      event.preventDefault();
      const dragging = list.querySelector(".dictionary-value-chip.is-dragging");
      if (!dragging) return;
      const afterElement = getDictionaryDragAfterElement(list, event.clientY);
      if (afterElement == null) {
        list.appendChild(dragging);
      } else {
        list.insertBefore(dragging, afterElement);
      }
    });
  }

  function getDictionaryDragAfterElement(list, y) {
    const chips = [...list.querySelectorAll(".dictionary-value-chip:not(.is-dragging)")];
    return chips.reduce((closest, child) => {
      const box = child.getBoundingClientRect();
      const offset = y - box.top - box.height / 2;
      if (offset < 0 && offset > closest.offset) return { offset, element: child };
      return closest;
    }, { offset: Number.NEGATIVE_INFINITY, element: null }).element;
  }

  function saveDictionaryManualOrder(list) {
    const dict = list.dataset.dict;
    if (!dict) return;
    const ordered = [...list.querySelectorAll(".dictionary-value-chip")]
      .map((chip) => chip.dataset.value)
      .filter(Boolean);
    if (!ordered.length) return;
    state.data.dictionaries[dict] = ordered;
    addAudit("Сортировка справочника", dictionaryTitle(dict), "Ручной порядок");
    persist();
  }

  function restoreDictionaryAddFocus() {
    if (!state.dictionaryAddFocus) return;
    const dict = state.dictionaryAddFocus;
    state.dictionaryAddFocus = "";
    requestAnimationFrame(() => {
      const input = document.querySelector(`form[data-action='dict-add'][data-dict="${CSS.escape(dict)}"] [data-dictionary-add-input]`);
      input?.focus({ preventScroll: true });
    });
  }

  function removeDictionaryValue(dict, value) {
    state.data.dictionaries[dict] = (state.data.dictionaries[dict] || []).filter((item) => item !== value);
    addAudit("Изменен справочник", dictionaryTitle(dict), value);
    persist();
    render();
  }

  function exportJson() {
    download("ais-dopobrazovanie-export.json", JSON.stringify(state.data, null, 2), "application/json");
  }

  function importJson(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        if (!parsed.collections || !parsed.dictionaries) throw new Error("Некорректный файл");
        state.data = ensureDataShape(parsed);
        addAudit("Импорт данных", "Админка", file.name);
        persist();
        render();
      } catch (error) {
        alert("Не удалось импортировать JSON: " + error.message);
      }
    };
    reader.readAsText(file);
  }

  function exportCsv(configId, rowsOverride = null) {
    const config = configs[configId];
    const rows = rowsOverride || getVisibleRows(config);
    const fields = getTableFields(config, configId);
    const header = fields.map((item) => csvCell(item.label)).join(";");
    const body = rows.map((row) => fields.map((item) => csvCell(row[item.key])).join(";")).join("\n");
    download(`${config.collection}.csv`, "\ufeff" + header + "\n" + body, "text/csv;charset=utf-8");
  }

  function resetState() {
    if (!confirm("Сбросить локальные данные к стартовому набору?")) return;
    state.data = ensureDataShape(clone(window.AIS_SEED));
    addAudit("Сброс данных", "Админка", "Возврат к seed.js");
    persist();
    render();
  }

  function addAudit(action, area, details) {
    const audit = state.data.collections.audit || [];
    audit.push({
      id: makeId("log"),
      date: new Date().toLocaleString("ru-RU"),
      user: "Администратор",
      action,
      area,
      details
    });
    state.data.collections.audit = audit.slice(-200);
  }

  function miniTable(rows, keys) {
    if (!rows.length) return `<div class="empty-state compact"><span>Нет данных</span></div>`;
    return `
      <div class="table-wrap compact">
        <table class="data-table mini">
          <tbody>
            ${rows.map((row) => `
              <tr>
                ${keys.map((key) => `<td>${escapeHtml(valueForDisplay(key, row[key]))}</td>`).join("")}
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    `;
  }

  function sumStudentPayments(record) {
    return Array.from({ length: 8 }, (_, index) => Number(record[`payment${index + 1}Amount`] || 0))
      .reduce((sum, value) => sum + value, 0);
  }

  function calculateStudentBalance(record) {
    const contractAmount = Number(record.contractAmount || 0);
    const paidAmount = Number(record.paidAmount || 0);
    const discountPercent = Math.max(0, Math.min(100, Number(record.discount || 0)));
    const discountedAmount = contractAmount * (1 - discountPercent / 100);
    return Math.round((discountedAmount - paidAmount) * 100) / 100;
  }

  function sumStudentExpenses(record) {
    return Array.from({ length: 6 }, (_, index) => Number(record[`expense${index + 1}Amount`] || 0))
      .reduce((sum, value) => sum + value, 0);
  }

  function buildFinanceSeries() {
    const monthMap = new Map();
    (state.data.collections.students || []).forEach((student) => {
      const detailedPayments = Array.from({ length: 8 }, (_, index) => {
        const n = index + 1;
        return {
          date: student[`payment${n}Date`],
          amount: Number(student[`payment${n}Amount`] || 0)
        };
      }).filter((item) => item.amount > 0);
      if (detailedPayments.length) {
        detailedPayments.forEach((payment) => addFinanceAmount(monthMap, payment.date || student.applicationDate || student.startDate, "revenue", payment.amount));
        return;
      }
      addFinanceAmount(monthMap, student.applicationDate || student.startDate || student.endDate, "revenue", Number(student.paidAmount || 0));
    });
    (state.data.collections.directExpenses || []).forEach((expense) => {
      addFinanceAmount(monthMap, expense.date, "direct", Number(expense.amount || 0));
    });
    (state.data.collections.generalExpenses || []).forEach((expense) => {
      addFinanceAmount(monthMap, expense.date || expense.paid, "general", Number(expense.amount || 0));
    });
    return Array.from(monthMap.values()).map((item) => ({ ...item, label: monthLabel(item.key) }));
  }

  function addFinanceAmount(monthMap, dateValue, key, amount) {
    const monthKey = getMonthKey(dateValue);
    if (!monthKey || !amount) return;
    if (!monthMap.has(monthKey)) monthMap.set(monthKey, { key: monthKey, revenue: 0, direct: 0, general: 0 });
    monthMap.get(monthKey)[key] += amount;
  }

  function getMonthKey(value) {
    const text = String(value || "").trim();
    const match = /^(\d{4})-(\d{2})/.exec(text);
    if (match) return `${match[1]}-${match[2]}`;
    const date = new Date(text);
    if (Number.isNaN(date.getTime())) return "";
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  }

  function monthLabel(key) {
    const [year, month] = key.split("-").map(Number);
    return new Intl.DateTimeFormat("ru-RU", { month: "short", year: "2-digit" })
      .format(new Date(year, month - 1, 1))
      .replace(".", "");
  }

  function countBy(rows, key) {
    return rows.reduce((acc, row) => {
      const value = row[key] || "Не задано";
      acc[value] = (acc[value] || 0) + 1;
      return acc;
    }, {});
  }

  function sumBy(rows, key) {
    return rows.reduce((sum, row) => sum + Number(row[key] || 0), 0);
  }

  function normalizeInn(value) {
    return String(value || "").replace(/\D/g, "");
  }

  function normalizeSnils(value) {
    return String(value || "").replace(/\D/g, "");
  }

  function formatSnils(value) {
    const snils = normalizeSnils(value);
    if (snils.length !== 11) return snils;
    return `${snils.slice(0, 3)}-${snils.slice(3, 6)}-${snils.slice(6, 9)} ${snils.slice(9)}`;
  }

  function isValidInn(value) {
    const inn = normalizeInn(value);
    if (!/^\d{10}$|^\d{12}$/.test(inn)) return false;
    const digits = inn.split("").map(Number);
    const checksum = (weights) => weights.reduce((sum, weight, index) => sum + weight * digits[index], 0) % 11 % 10;
    if (inn.length === 10) {
      return checksum([2, 4, 10, 3, 5, 9, 4, 6, 8]) === digits[9];
    }
    return checksum([7, 2, 4, 10, 3, 5, 9, 4, 6, 8]) === digits[10]
      && checksum([3, 7, 2, 4, 10, 3, 5, 9, 4, 6, 8]) === digits[11];
  }

  function isValidSnils(value) {
    const snils = normalizeSnils(value);
    if (!/^\d{11}$/.test(snils)) return false;
    const digits = snils.split("").map(Number);
    const checksum = digits.slice(0, 9).reduce((sum, digit, index) => sum + digit * (9 - index), 0);
    const expected = checksum < 100 ? checksum : checksum === 100 || checksum === 101 ? 0 : checksum % 101 === 100 ? 0 : checksum % 101;
    return expected === Number(snils.slice(9));
  }

  function bindStudentIdentityFieldValidation(field) {
    const input = document.querySelector(`[name="${field}"]`);
    if (!input) return;
    input.addEventListener("input", () => {
      input.setCustomValidity("");
      input.classList.remove("field-invalid");
    });
    input.addEventListener("blur", () => {
      const value = field.toLowerCase().includes("inn") ? normalizeInn(input.value) : formatSnils(input.value);
      input.value = value;
      validateStudentIdentityValue(field, value, input);
    });
  }

  function validateStudentIdentityValue(field, value, input = null) {
    if (!value) {
      input?.setCustomValidity("");
      input?.classList.remove("field-invalid");
      return true;
    }
    const isInn = field.toLowerCase().includes("inn");
    const valid = isInn ? isValidInn(value) : isValidSnils(value);
    const message = isInn
      ? "ИНН заполнен неверно. Проверьте количество цифр и контрольное число."
      : "СНИЛС заполнен неверно. Проверьте количество цифр и контрольное число.";
    if (input) {
      input.setCustomValidity(valid ? "" : message);
      input.classList.toggle("field-invalid", !valid);
      if (!valid) input.reportValidity();
    } else if (!valid) {
      alert(message);
    }
    return valid;
  }

  function normalizeMessengerPhone(value) {
    const digits = String(value || "").replace(/\D/g, "");
    if (digits.length === 11 && digits.startsWith("8")) return `7${digits.slice(1)}`;
    return digits;
  }

  async function openStudentMessenger(messenger) {
    const phoneInput = document.querySelector("[name='phone']");
    const messengerUrlInput = document.querySelector("[name='messengerUrl']");
    const phone = normalizeMessengerPhone(phoneInput?.value || "");
    const phoneForCopy = phone ? `+${phone}` : String(phoneInput?.value || "").trim();
    const customUrl = getMessengerCustomUrl(messenger, messengerUrlInput?.value || "");

    const url = customUrl || getMessengerPhoneUrl(messenger, phone);
    if (!url) {
      alert("Укажите телефон или ссылку мессенджера.");
      return;
    }
    if (messenger === "max") {
      await openMaxMessenger(url, phoneForCopy);
      return;
    }
    openExternalUrl(url);
  }

  function openStudentMessengerUrl() {
    const input = document.querySelector("[name='messengerUrl']");
    const url = parseMessengerUrl(input?.value || "");
    if (!url) {
      alert("Укажите корректный адрес мессенджера.");
      input?.focus();
      return;
    }
    openExternalUrl(getWhatsAppAppUrl(url) || url.href);
  }

  function openStudentProgramPromo() {
    const input = document.querySelector("[name='program']");
    const program = findProgramByName(input?.value || "");
    const url = getProgramPromoUrl(program);
    if (!url) {
      alert("Для выбранной программы не указан адрес промосайта.");
      input?.focus();
      return;
    }
    openExternalUrl(url);
  }

  function getStudentAddressInput(key) {
    return Array.from(document.querySelectorAll("[data-address-field]")).find((input) => input.dataset.addressField === key);
  }

  function copyStudentAddressToField(sourceKey, targetKey) {
    const source = getStudentAddressInput(sourceKey);
    const target = getStudentAddressInput(targetKey);
    if (!source || !target) return;
    const value = source.value.trim();
    if (!value) {
      alert("Заполните адрес для копирования.");
      source.focus();
      return;
    }
    target.value = source.value;
    target.dispatchEvent(new Event("input", { bubbles: true }));
    target.dispatchEvent(new Event("change", { bubbles: true }));
    target.focus({ preventScroll: true });
  }

  function copyStudentPassportToCustomer() {
    const record = (state.data.collections.students || []).find((item) => item.id === state.modal?.id) || {};
    const fieldPairs = [
      ["name", "customer"],
      ["birthDate", "customerBirthDate"],
      ["snils", "customerSnils"],
      ["inn", "customerInn"],
      ["passportType", "customerPassportType"],
      ["passportNumber", "customerPassportNumber"],
      ["passportDate", "customerPassportDate"],
      ["passportIssuer", "customerPassportIssuer"],
      ["passportCode", "customerPassportCode"]
    ];
    let copied = 0;
    fieldPairs.forEach(([sourceKey, targetKey]) => {
      const source = document.querySelector(`[name="${sourceKey}"]`);
      const target = document.querySelector(`[name="${targetKey}"]`);
      if (!target) return;
      target.value = source?.value ?? state.modal?.draft?.[sourceKey] ?? record[sourceKey] ?? "";
      target.dispatchEvent(new Event("input", { bubbles: true }));
      target.dispatchEvent(new Event("change", { bubbles: true }));
      copied += 1;
    });
    if (!copied) return;
    document.querySelector("[name='customerPassportType']")?.focus({ preventScroll: true });
  }

  async function checkStudentAddressPostIndex(sourceKey) {
    const input = getStudentAddressInput(sourceKey);
    const address = input?.value.trim() || "";
    if (!address) {
      alert("Заполните адрес для проверки индекса.");
      input?.focus();
      return;
    }
    const query = `Индекс ${address}`;
    const searchUrl = getYandexPostalIndexSearchUrl(query);
    removePostalIndexPopup();
    const parsedIndex = await findPostalIndexInYandexSearch(query);
    if (!parsedIndex) {
      openYandexPostalIndexSearch(searchUrl);
      return;
    }
    showPostalIndexPopup(input, parsedIndex, query);
  }

  function showPostalIndexPopup(input, index, query) {
    const popup = document.createElement("div");
    popup.className = "postal-index-popup";
    popup.innerHTML = `
      <button data-action="apply-postal-index" type="button">
        <span>Вариант индекса</span>
        <strong>${escapeHtml(index)}</strong>
      </button>
      <button data-action="open-postal-index-search" type="button">
        <span>Найти в интернете...</span>
      </button>
    `;
    document.body.appendChild(popup);
    positionFloatingElement(popup, input);
    popup.querySelector("[data-action='apply-postal-index']")?.addEventListener("click", () => {
      input.value = applyPostalIndexToAddress(input.value, index);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      removePostalIndexPopup();
      input.focus({ preventScroll: true });
    });
    popup.querySelector("[data-action='open-postal-index-search']")?.addEventListener("click", () => {
      removePostalIndexPopup();
      openYandexPostalIndexSearch(getYandexPostalIndexSearchUrl(query));
    });
    setTimeout(() => {
      document.addEventListener("pointerdown", closePostalIndexPopupOnOutsideClick, { capture: true, once: true });
    });
  }

  function closePostalIndexPopupOnOutsideClick(event) {
    if (event.target.closest(".postal-index-popup")) {
      document.addEventListener("pointerdown", closePostalIndexPopupOnOutsideClick, { capture: true, once: true });
      return;
    }
    removePostalIndexPopup();
  }

  function removePostalIndexPopup() {
    document.querySelector(".postal-index-popup")?.remove();
  }

  async function findPostalIndexInYandexSearch(query) {
    try {
      const response = await fetch(`/api/postal-index?query=${encodeURIComponent(query)}`);
      if (!response.ok) return "";
      const result = await response.json();
      return normalizePostalIndex(result.index || "");
    } catch (error) {
      return "";
    }
  }

  function parsePostalIndexFromSearchHtml(html) {
    const text = String(html || "")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;|&#160;/gi, " ")
      .replace(/\s+/g, " ");
    const candidates = [...text.matchAll(/\b\d{6}\b/g)]
      .map((match) => match[0])
      .filter((value) => !/^0{6}$/.test(value));
    return candidates[0] || "";
  }

  function getYandexPostalIndexSearchUrl(query) {
    return `https://yandex.ru/search/?text=${encodeURIComponent(query)}`;
  }

  function openYandexPostalIndexSearch(url, targetWindow = null) {
    if (targetWindow && !targetWindow.closed) {
      targetWindow.location.href = url;
      return;
    }
    openExternalUrl(url);
  }

  function positionFloatingElement(element, anchor) {
    const rect = anchor?.getBoundingClientRect?.();
    if (!rect) return;
    const width = Math.min(270, window.innerWidth - 16);
    element.style.width = `${width}px`;
    element.style.left = `${Math.max(8, Math.min(window.innerWidth - width - 8, rect.right - width))}px`;
    element.style.top = `${Math.max(8, Math.min(window.innerHeight - 110, rect.bottom + 6))}px`;
  }

  function getPostalIndexFromAddress(address) {
    return String(address || "").match(/\b\d{6}\b/)?.[0] || "";
  }

  function normalizePostalIndex(value) {
    const digits = String(value || "").replace(/\D/g, "");
    return digits.length === 6 ? digits : "";
  }

  function applyPostalIndexToAddress(address, index) {
    const value = String(address || "").trim();
    const normalizedIndex = normalizePostalIndex(index);
    if (!normalizedIndex) return value;
    if (!value) return normalizedIndex;
    if (/^\d{6}\b/.test(value)) return value.replace(/^\d{6}\b/, normalizedIndex);
    return `${normalizedIndex}, ${value}`;
  }

  async function openMaxMessenger(url, phoneForCopy) {
    try {
      const response = await fetch(photoApiUrl("/api/max/search"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, phone: phoneForCopy })
      });
      if (response.ok) return;
    } catch (error) {
      // Direct file mode or disabled local server: use the browser-level fallback below.
    }
    if (phoneForCopy) copyTextToClipboard(phoneForCopy);
    openExternalUrl(url);
  }

  function getMessengerCustomUrl(messenger, value) {
    const url = parseMessengerUrl(value);
    if (!url) return "";
    const host = url.hostname.replace(/^www\./i, "").toLowerCase();
    const protocol = url.protocol.toLowerCase();
    const href = url.href;
    if (messenger === "max" && (protocol === "max:" || host === "max.ru" || host === "web.max.ru")) return href;
    if (messenger === "telegram" && (protocol === "tg:" || ["t.me", "telegram.me", "telegram.dog"].includes(host))) return href;
    if (messenger === "whatsapp") return getWhatsAppAppUrl(url);
    return "";
  }

  function getWhatsAppAppUrl(url) {
    const host = url.hostname.replace(/^www\./i, "").toLowerCase();
    const protocol = url.protocol.toLowerCase();
    if (protocol === "whatsapp:") return url.href;
    if (!["wa.me", "whatsapp.com", "api.whatsapp.com", "web.whatsapp.com"].includes(host)) return "";
    const pathPhone = host === "wa.me" ? normalizeMessengerPhone(url.pathname.replace(/^\/+/, "").split("/")[0]) : "";
    const queryPhone = normalizeMessengerPhone(url.searchParams.get("phone") || "");
    const phone = queryPhone || pathPhone;
    const text = url.searchParams.get("text") || "";
    if (!phone) return "";
    const params = new URLSearchParams({ phone });
    if (text) params.set("text", text);
    return `whatsapp://send?${params.toString()}`;
  }

  function parseMessengerUrl(value) {
    const text = String(value || "").trim();
    if (!text) return null;
    try {
      const url = new URL(text);
      const protocol = url.protocol.toLowerCase();
      if (["http:", "https:", "tg:", "whatsapp:", "max:"].includes(protocol)) return url;
    } catch (error) {
      return null;
    }
    return null;
  }

  function normalizeExternalUrl(value) {
    const text = String(value || "").trim();
    if (!text || /^(?:да|нет|yes|no|true|false)$/i.test(text)) return "";
    const candidate = /^[a-z][a-z\d+.-]*:/i.test(text) ? text : `https://${text}`;
    try {
      const url = new URL(candidate);
      if (["http:", "https:"].includes(url.protocol.toLowerCase())) return url.href;
    } catch (error) {
      return "";
    }
    return "";
  }

  function getMessengerPhoneUrl(messenger, phone) {
    if (messenger === "max") return phone ? `max://search?phone=${encodeURIComponent(`+${phone}`)}` : "max://";
    if (messenger === "telegram") return phone ? `tg://resolve?phone=${encodeURIComponent(phone)}` : "";
    if (messenger === "whatsapp") return phone ? `whatsapp://send?phone=${encodeURIComponent(phone)}` : "";
    return "";
  }

  function openExternalUrl(url) {
    const link = document.createElement("a");
    link.href = url;
    link.target = "_blank";
    link.rel = "noreferrer";
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  function unique(values) {
    return Array.from(new Set(values));
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function makeId(prefix) {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  }

  function getNextUid() {
    const values = Object.values(state.data.collections || {})
      .flat()
      .map((row) => Number(row?.uid))
      .filter((value) => Number.isFinite(value));
    return String((values.length ? Math.max(...values) : 0) + 1);
  }

  function ensureRecordUid(config, record = {}) {
    if (state.modal?.id || !config.fields?.some((item) => item.key === "uid")) return record;
    return { ...record, uid: record.uid || getNextUid() };
  }

  function download(filename, content, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }

  function csvCell(value) {
    return `"${String(value ?? "").replaceAll('"', '""')}"`;
  }

  function dictionaryTitle(key) {
    const map = {
      statuses: "Статусы",
      contractTypes: "Виды договоров",
      studyForms: "Формы обучения",
      programStatuses: "Статусы программ",
      expenseTypes: "Виды затрат",
      inventoryTypes: "Виды ТМЦ",
      managers: "Ответственные",
      sources: "Источники",
      citizenships: "Гражданство",
      documentTypes: "Виды документов",
      passportIssuers: "Кем выдан документ",
      educationLevels: "Уровни образования",
      educationDocumentTypes: "Виды документов об образовании",
      educationDocumentIssuers: "Кем выдан документ об образовании",
      workPlaces: "Места работы",
      positions: "Должности",
      employmentCategories: "Категории занятости",
      ovzStatuses: "Статусы ОВЗ",
      fundingSources: "Источники финансирования",
      expenseNotes: "Типовые примечания расходов",
      sdoSettings: "Настройки СДО",
      discountRules: "Скидки",
      dataFormulas: "Конструктор формул данных",
      communicationTemplates: "Шаблоны типовых сообщений",
      roles: "Роли"
    };
    return map[key] || key;
  }

  function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes} Б`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} КБ`;
    return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
  }

  function initials(name) {
    const parts = String(name || "")
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2);
    return parts.map((part) => part[0]?.toUpperCase() || "").join("") || "С";
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function escapeAttr(value) {
    return escapeHtml(value).replaceAll("\n", " ");
  }

  render();
})();
