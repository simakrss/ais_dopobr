(() => {
  const STORAGE_KEY = "ais-dopobr-web-state-v1";
  const TABLE_SETTINGS_KEY = "ais-dopobr-web-table-settings-v1";
  const app = document.getElementById("app");
  const programHourOptions = [1, 2, 4, 16, 36, 72, 144, 300, 600, 1200];
  const defaultPhotoServerOrigin = "http://localhost:8080";
  const financeMetrics = [
    { key: "revenue", label: "Поступления", tone: "income" },
    { key: "direct", label: "Прямые затраты", tone: "direct" },
    { key: "general", label: "Общие затраты", tone: "general" }
  ];
  const dictionaryDefaults = {
    managers: [],
    sources: [],
    citizenships: ["Российская Федерация"],
    documentTypes: ["Паспорт гражданина РФ", "Иностранный паспорт", "Вид на жительство", "Свидетельство о рождении"],
    passportIssuers: []
  };
  const searchableStudentFields = {
    manager: { dict: "managers", fields: [["students", "manager"], ["programs", "manager"]] },
    source: { dict: "sources", fields: [["students", "source"], ["webinars", "source"]] },
    citizenship: { dict: "citizenships", fields: [["students", "citizenship"]] },
    passportType: { dict: "documentTypes", fields: [["students", "passportType"]] }
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
        field("groupIndex", "Индекс группы"),
        field("studyForm", "Форма обучения", "select", false, "studyForms"),
        field("qualification", "Квалификация"),
        field("manager", "Ответственный")
      ],
      table: ["name", "status", "type", "hours", "price", "landingCode", "groupIndex"]
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

  const studentCardTabs = [
    {
      id: "main",
      label: "Основное",
      sections: [
        {
          title: "Обучающийся",
          fields: [
            field("uid", "uid"),
            field("name", "ФИО", "text", true),
            field("status", "Статус", "select", true, "statuses"),
            field("program", "Программа", "text", true),
            field("group", "Группа"),
            field("manager", "Ответственный"),
            field("source", "Источник"),
            field("tags", "Теги", "textarea")
          ]
        },
        {
          title: "Сроки обучения",
          fields: [
            field("applicationDate", "Дата подачи заявки", "date"),
            field("startDate", "Дата начала обучения", "date"),
            field("endDate", "Дата окончания обучения", "date"),
            field("extendedEndDate", "Продленная дата окончания", "date"),
            field("studyForm", "Форма обучения", "select", false, "studyForms"),
            field("educationType", "Вид программы ДПО")
          ]
        }
      ]
    },
    {
      id: "documents",
      label: "Документы",
      sections: [
        {
          title: "Личные документы",
          fields: [
            field("birthDate", "Дата рождения", "date"),
            field("gender", "Пол", "select", false, null, ["", "Женский", "Мужской"]),
            field("citizenship", "Гражданство"),
            field("snils", "СНИЛС"),
            field("inn", "ИНН"),
            field("address", "Адрес места жительства", "textarea"),
            field("passportType", "Вид документа"),
            field("passportNumber", "Серия и номер"),
            field("passportDate", "Дата выдачи", "date"),
            field("passportIssuer", "Кем выдан", "textarea"),
            field("passportCode", "Код подразделения")
          ]
        },
        {
          title: "Документ об образовании",
          fields: [
            field("educationLevel", "Уровень образования"),
            field("educationDocument", "Документ об образовании"),
            field("educationDocumentSeries", "Серия"),
            field("educationDocumentNumber", "Номер"),
            field("educationDocumentDate", "Дата выдачи", "date"),
            field("educationDocumentIssuer", "Кем выдан", "textarea"),
            field("applicationDoc", "Заявление"),
            field("questionnaire", "Анкета"),
            field("documentsStatus", "Состояние комплекта", "textarea")
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
            field("discount", "Скидка"),
            field("fundingSource", "Источник финансирования")
          ]
        }
      ]
    },
    {
      id: "communications",
      label: "Коммуникации",
      sections: [
        {
          title: "Контакты",
          fields: [
            field("phone", "Телефон обучающегося"),
            field("email", "Email"),
            field("telegram", "Аккаунт Telegram"),
            field("whatsapp", "WhatsApp"),
            field("customer", "Заказчик"),
            field("customerPhone", "Телефон заказчика"),
            field("customerEmail", "Email заказчика")
          ]
        },
        {
          title: "Сообщения",
          fields: [
            field("messageLogin", "Сообщение с логином", "textarea"),
            field("lastMessage", "Последнее сообщение", "textarea"),
            field("communicationNotes", "Примечания", "textarea")
          ]
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
      expenses: true
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

  const studentCardFields = studentCardTabs.flatMap((tab) => tab.sections.flatMap((section) => section.fields));
  const studentSideFields = [
    field("note", "Примечание", "textarea")
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
    field(`expense${index + 1}Note`, `Примечание ${index + 1}`)
  ]).flat();
  const studentAllFields = [
    field("photoData", "Фото"),
    field("photoPath", "Путь фото"),
    field("photoUrl", "URL фото"),
    ...studentSideFields,
    ...studentEventFields,
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
    selected: {},
    tableOptions: null,
    tableSettings: loadTableSettings(),
    financeChart: { revenue: true, direct: true, general: true },
    modal: null,
    data: loadState()
  };

  function field(key, label, type = "text", required = false, dict = null, options = null) {
    return { key, label, type, required, dict, options };
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function loadState() {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed && parsed.collections) return ensureDataShape(parsed);
      } catch (error) {
        console.warn("Не удалось прочитать сохраненное состояние", error);
      }
    }
    return ensureDataShape(clone(window.AIS_SEED));
  }

  function ensureDataShape(data) {
    data.dictionaries = data.dictionaries || {};
    Object.entries(dictionaryDefaults).forEach(([key, values]) => {
      data.dictionaries[key] = unique([...(data.dictionaries[key] || []), ...values]);
    });
    return data;
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
    return `
      <section class="panel">
        <div class="section-head">
          <div>
            <p class="eyebrow">Настройки</p>
            <h2>Справочники системы</h2>
          </div>
        </div>
        <div class="dictionary-grid">
          ${Object.entries(dictionaries).map(([key, values]) => `
            <section class="dictionary-box">
              <h3>${dictionaryTitle(key)}</h3>
              <div class="chips">
                ${values.map((value) => `
                  <span class="chip">
                    ${escapeHtml(value)}
                    <button data-action="dict-remove" data-dict="${key}" data-value="${escapeAttr(value)}" type="button">×</button>
                  </span>
                `).join("")}
              </div>
              <form class="inline-form" data-action="dict-add" data-dict="${key}">
                <input name="value" placeholder="Новое значение" autocomplete="off">
                <button class="ghost-button" type="submit">Добавить</button>
              </form>
            </section>
          `).join("")}
        </div>
      </section>
    `;
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
    const record = state.modal.id ? rows.find((row) => row.id === state.modal.id) : ensureRecordUid(config, {});
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
      const options = item.options || state.data.dictionaries[item.dict] || [];
      return `${label}<select name="${item.key}" ${required}>${options.map((option) => `<option ${String(option) === String(value) ? "selected" : ""}>${escapeHtml(option)}</option>`).join("")}</select></label>`;
    }
    if (state.modal?.config === "programs" && item.key === "hours") {
      return renderProgramHoursField(label, value, required);
    }
    return `${label}<input name="${item.key}" type="${item.type}" value="${escapeAttr(value)}" ${required}></label>`;
  }

  function renderStudentModal(record) {
    if (!state.modal.id) record = { ...record, uid: record.uid || getNextUid() };
    const activeTab = studentCardTabs.find((tab) => tab.id === state.studentCardTab) || studentCardTabs[0];
    const title = state.modal.id ? "Карточка слушателя" : "Новая карточка слушателя";
    const photo = getStudentPhotoSrc(record);
    return `
      <div class="modal-backdrop" data-action="close-modal">
        <section class="modal student-modal" role="dialog" aria-modal="true" aria-label="${title}">
          <form id="recordForm" data-config="students" data-id="${record.id || ""}">
            <header class="modal-head student-modal-head">
              <div>
                <p class="eyebrow">Лист Excel: База / форма VBA: КарточкаСлушателя</p>
                <h2>${title}</h2>
              </div>
              <div class="modal-head-actions">
                <span class="student-status">${escapeHtml(record.status || "Новая запись")}</span>
                <button class="ghost-button" data-action="close-modal" type="button">Отмена</button>
                <button class="primary-button" type="submit">Сохранить карточку</button>
              </div>
            </header>

            <div class="student-card-layout">
              <aside class="student-photo-panel">
                <div class="photo-preview ${photo ? "has-photo" : ""}" id="studentPhotoPreview">
                  ${photo ? `<img src="${escapeAttr(photo)}" alt="Фото слушателя">` : `<span>${initials(record.name || "Слушатель")}</span>`}
                </div>
                <input type="hidden" name="photoData" id="studentPhotoData" value="${escapeAttr(record.photoData || "")}">
                <input type="hidden" name="photoPath" id="studentPhotoPath" value="${escapeAttr(record.photoPath || "")}">
                <input type="hidden" name="photoUrl" id="studentPhotoUrl" value="${escapeAttr(record.photoUrl || "")}">
                <label class="photo-upload">
                  <input id="studentPhotoInput" type="file" accept="image/*">
                  <span>Прикрепить фото</span>
                </label>
                <button class="ghost-button" data-action="clear-photo" type="button">Убрать фото</button>
                <div class="student-mini-card">
                  <strong>${escapeHtml(record.name || "Новый слушатель")}</strong>
                  <span>uid: ${escapeHtml(record.uid || "не присвоен")}</span>
                  <span>${escapeHtml(record.program || "Программа не выбрана")}</span>
                </div>
                <div class="student-money-card">
                  <div><span>Договор</span><strong>${money(record.contractAmount || 0)}</strong></div>
                  <div><span>Внесено</span><strong>${money(record.paidAmount || 0)}</strong></div>
                  <div><span>Остаток</span><strong>${money(record.balance || 0)}</strong></div>
                </div>
              </aside>

              <section class="student-card-main">
                <div class="student-tabs" role="tablist">
                  ${studentCardTabs.map((tab) => `
                    <button class="${activeTab.id === tab.id ? "active" : ""}" data-student-tab="${tab.id}" type="button" role="tab">
                      ${escapeHtml(tab.label)}
                    </button>
                  `).join("")}
                </div>
                <div class="student-tab-body">
                  ${renderStudentTabContent(activeTab, record)}
                </div>
              </section>

              <aside class="student-side-panel">
                ${renderStudentSidePanel(record)}
              </aside>
            </div>

          </form>
        </section>
      </div>
    `;
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
    return `
      ${tab.sections.map((section) => `
        <section class="form-section">
          <h3>${escapeHtml(section.title)}</h3>
          <div class="student-form-grid">
            ${section.fields.map((item) => renderStudentField(item, record)).join("")}
          </div>
        </section>
      `).join("")}
      ${tab.payments ? renderPaymentRows(record) : ""}
      ${tab.expenses ? renderExpenseRows(record) : ""}
      ${tab.expenses ? renderLinkedExpenses(record) : ""}
      ${tab.id === "communications" ? renderCommunicationActions(record) : ""}
    `;
  }

  function renderStudentSidePanel(record) {
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
        <div class="student-events-head" aria-hidden="true">
          <span></span>
          <span>Дата</span>
          <span>Событие</span>
        </div>
        <div class="student-events-list">
          ${studentEventTemplates.map((event) => renderStudentEventRow(event, record)).join("")}
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
      <div class="student-event-row ${stateValue ? "is-selected" : ""} ${stateValue === "dated" ? "has-date" : ""}" data-action="toggle-student-event" data-event-key="${escapeAttr(event.key)}" role="button" tabindex="0">
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
        <span class="event-label" data-event-label-text="${escapeAttr(event.key)}">${escapeHtml(labelValue)}</span>
      </div>
    `;
  }

  function renderStudentField(item, record) {
    const value = record[item.key] ?? "";
    const required = item.required ? "required" : "";
    const isWide = item.type === "textarea" || item.key === "program";
    const label = `<label class="${isWide ? "wide-field" : ""}"><span>${escapeHtml(item.label)}${item.required ? " *" : ""}</span>`;
    if (item.key === "program") {
      return renderStudentProgramField(label, value, required);
    }
    if (searchableStudentFields[item.key]) {
      return renderSearchableStudentField(label, item, value, required);
    }
    if (item.key === "passportIssuer") {
      return renderPassportIssuerField(label, item, value, required);
    }
    if (item.key === "educationType") {
      const programType = getProgramType(record.program, record);
      return `${label}<input name="${item.key}" type="text" value="${escapeAttr(programType)}" readonly data-program-autofill="educationType"></label>`;
    }
    if (item.key === "inn") {
      return `${label}<input name="${item.key}" type="text" value="${escapeAttr(value)}" inputmode="numeric" maxlength="12" pattern="\\d{10}|\\d{12}" autocomplete="off"></label>`;
    }
    if (item.type === "checkbox") {
      return `${label}<input name="${item.key}" type="checkbox" value="Да" ${isChecked(value) ? "checked" : ""}></label>`;
    }
    if (item.type === "textarea") {
      return `${label}<textarea name="${item.key}" ${required}>${escapeHtml(value)}</textarea></label>`;
    }
    if (item.type === "select") {
      const options = item.options || state.data.dictionaries[item.dict] || [];
      return `${label}<select name="${item.key}" ${required}>${options.map((option) => `<option ${String(option) === String(value) ? "selected" : ""}>${escapeHtml(option)}</option>`).join("")}</select></label>`;
    }
    return `${label}<input name="${item.key}" type="${item.type}" value="${escapeAttr(value)}" ${required}></label>`;
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

  function renderPassportIssuerField(label, item, value, required) {
    const options = getPassportIssuerOptions(value);
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
    const normalized = String(name || "").trim().toLowerCase();
    if (!normalized) return null;
    return getProgramRows().find((program) => (
      String(program.name || "").trim().toLowerCase() === normalized ||
      String(program.shortName || "").trim().toLowerCase() === normalized
    )) || null;
  }

  function getProgramType(programName, record = {}) {
    const program = findProgramByName(programName);
    return program?.type || record.educationType || "";
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
      fields: [["students", "passportIssuer"]]
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
    if (labelText && newLabel) labelText.textContent = newLabel;
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

  function renderPaymentRows(record) {
    return `
      <section class="form-section">
        <h3>График и фактические оплаты</h3>
        <div class="editable-grid payment-grid">
          <div class="editable-grid-head">№</div>
          <div class="editable-grid-head">Дата</div>
          <div class="editable-grid-head">Сумма</div>
          <div class="editable-grid-head">Комментарий</div>
          ${Array.from({ length: 8 }, (_, index) => {
            const n = index + 1;
            return `
              <strong>${n}</strong>
              <input name="payment${n}Date" type="date" value="${escapeAttr(record[`payment${n}Date`] || "")}">
              <input name="payment${n}Amount" type="number" value="${escapeAttr(record[`payment${n}Amount`] || "")}">
              <input name="payment${n}Note" value="${escapeAttr(record[`payment${n}Note`] || "")}">
            `;
          }).join("")}
        </div>
      </section>
    `;
  }

  function renderExpenseRows(record) {
    return `
      <section class="form-section">
        <h3>Ручные расходы карточки</h3>
        <div class="editable-grid expense-grid">
          <div class="editable-grid-head">№</div>
          <div class="editable-grid-head">Дата</div>
          <div class="editable-grid-head">Вид затрат</div>
          <div class="editable-grid-head">Сумма</div>
          <div class="editable-grid-head">Примечание</div>
          ${Array.from({ length: 6 }, (_, index) => {
            const n = index + 1;
            const type = record[`expense${n}Type`] || "";
            return `
              <strong>${n}</strong>
              <input name="expense${n}Date" type="date" value="${escapeAttr(record[`expense${n}Date`] || "")}">
              <select name="expense${n}Type">
                <option value=""></option>
                ${(state.data.dictionaries.expenseTypes || []).map((option) => `<option ${option === type ? "selected" : ""}>${escapeHtml(option)}</option>`).join("")}
              </select>
              <input name="expense${n}Amount" type="number" value="${escapeAttr(record[`expense${n}Amount`] || "")}">
              <input name="expense${n}Note" value="${escapeAttr(record[`expense${n}Note`] || "")}">
            `;
          }).join("")}
        </div>
      </section>
    `;
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

  function renderCommunicationActions(record) {
    const phone = String(record.phone || "").replace(/[^\d+]/g, "");
    const telegram = record.telegram ? String(record.telegram).replace("@", "") : "";
    return `
      <section class="form-section">
        <h3>Быстрые действия</h3>
        <div class="quick-actions">
          <a class="ghost-button" href="${phone ? `tel:${phone}` : "#"}">Позвонить</a>
          <a class="ghost-button" href="${record.email ? `mailto:${escapeAttr(record.email)}` : "#"}">Email</a>
          <a class="ghost-button" href="${phone ? `https://wa.me/${phone.replace("+", "")}` : "#"}" target="_blank" rel="noreferrer">WhatsApp</a>
          <a class="ghost-button" href="${telegram ? `https://t.me/${escapeAttr(telegram)}` : "#"}" target="_blank" rel="noreferrer">Telegram</a>
        </div>
      </section>
    `;
  }

  function bindEvents() {
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
        if (isCompact) document.body.classList.add("sidebar-open");
        return;
      }
      if (isCompact) {
        document.body.classList.toggle("sidebar-open");
      } else {
        document.body.classList.toggle("sidebar-collapsed");
      }
    });

    document.querySelector("[data-action='collapse-sidebar']")?.addEventListener("click", () => {
      document.body.classList.add("sidebar-collapsed");
      document.body.classList.remove("sidebar-open");
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
        state.modal = { config: button.dataset.config, id: "" };
        render();
      });
    });

    document.querySelectorAll("[data-action='edit']").forEach((button) => {
      button.addEventListener("click", () => {
        if (button.dataset.config === "students") state.studentCardTab = "main";
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
        if (educationTypeInput) educationTypeInput.value = program?.type || "";
      };
      input.addEventListener("input", syncProgramType);
      input.addEventListener("change", syncProgramType);
    });

    document.querySelectorAll("[data-action='toggle-student-event']").forEach((row) => {
      row.addEventListener("click", (event) => {
        event.preventDefault();
        updateStudentEventRow(row);
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
    });

    document.querySelector("[data-action='close-event-editor']")?.addEventListener("click", closeStudentEventEditor);
    document.querySelector("[data-action='apply-event-editor']")?.addEventListener("click", applyStudentEventEditor);
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

    document.querySelector("[name='inn']")?.addEventListener("input", (event) => {
      event.target.setCustomValidity("");
    });

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
        if (event.target === element || element.tagName === "BUTTON") {
          state.modal = null;
          render();
        }
      });
    });

    document.querySelectorAll("[data-student-tab]").forEach((button) => {
      button.addEventListener("click", () => {
        state.studentCardTab = button.dataset.studentTab;
        render();
      });
    });

    document.getElementById("studentPhotoInput")?.addEventListener("change", handleStudentPhoto);

    document.querySelector("[data-action='clear-photo']")?.addEventListener("click", async () => {
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
      if (preview) {
        preview.classList.remove("has-photo");
        preview.innerHTML = `<span>${initials(document.querySelector("[name='name']")?.value || "Слушатель")}</span>`;
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

    document.querySelectorAll("form[data-action='dict-add']").forEach((formElement) => {
      formElement.addEventListener("submit", addDictionaryValue);
    });
  }

  function saveRecord(event) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const config = configs[formElement.dataset.config];
    const rows = state.data.collections[config.collection];
    const formData = new FormData(formElement);
    const isStudentCard = formElement.dataset.config === "students";
    const currentRecord = formElement.dataset.id ? rows.find((row) => row.id === formElement.dataset.id) || {} : {};
    const values = isStudentCard ? { ...currentRecord } : {};
    const fields = isStudentCard ? studentAllFields : config.fields;
    fields.forEach((item) => {
      if (item.type === "checkbox") {
        values[item.key] = formData.has(item.key) ? "Да" : "";
        return;
      }
      if (!formData.has(item.key)) return;
      const raw = formData.get(item.key);
      values[item.key] = item.type === "number" ? Number(raw || 0) : String(raw || "");
    });
    if (!formElement.dataset.id && fields.some((item) => item.key === "uid") && !values.uid) {
      values.uid = getNextUid();
    }
    if (isStudentCard) {
      if (formData.has("inn")) {
        values.inn = normalizeInn(values.inn);
        const innInput = formElement.querySelector("[name='inn']");
        if (innInput) innInput.value = values.inn;
        if (values.inn && !isValidInn(values.inn)) {
          const message = "ИНН должен содержать 10 или 12 цифр и проходить контрольную проверку.";
          if (innInput) {
            innInput.setCustomValidity(message);
            innInput.reportValidity();
          } else {
            alert(message);
          }
          return;
        }
      }
      const selectedProgram = findProgramByName(values.program);
      if (selectedProgram) values.educationType = selectedProgram.type || "";
      const paymentTotal = sumStudentPayments(values);
      const expenseTotal = sumStudentExpenses(values);
      if (paymentTotal > 0) values.paidAmount = paymentTotal;
      if (expenseTotal > 0) values.expenseTotal = expenseTotal;
      values.balance = Number(values.contractAmount || 0) - Number(values.paidAmount || 0);
    }

    if (formElement.dataset.id) {
      const index = rows.findIndex((row) => row.id === formElement.dataset.id);
      rows[index] = { ...rows[index], ...values };
      addAudit("Изменена запись", config.title, values.name || values.contractNo || values.code || values.itemType || "");
    } else {
      rows.unshift({ id: makeId(config.collection), ...values });
      addAudit("Создана запись", config.title, values.name || values.contractNo || values.code || values.itemType || "");
    }
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
        if (hidden) hidden.value = "";
        if (pathInput) pathInput.value = uploaded.photoPath;
        if (urlInput) urlInput.value = uploaded.photoUrl;
        if (preview) {
          preview.classList.add("has-photo");
          preview.innerHTML = `<img src="${escapeAttr(uploaded.photoUrl)}" alt="Фото слушателя">`;
        }
      } catch (error) {
        alert("Не удалось сохранить фото: " + error.message);
      } finally {
        preview?.classList.remove("is-loading");
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
    return window.location.protocol === "file:" ? `${defaultPhotoServerOrigin}${pathname}` : pathname;
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
    return photoPublicUrl(record.photoUrl || record.photoData || record.photoPath);
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
    const value = input.value.trim();
    if (!value) return;
    state.data.dictionaries[dict] = unique([...(state.data.dictionaries[dict] || []), value]);
    input.value = "";
    addAudit("Изменен справочник", dictionaryTitle(dict), value);
    persist();
    render();
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
