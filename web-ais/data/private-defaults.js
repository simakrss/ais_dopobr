const AIS_PRIVATE_DEFAULTS = Object.freeze({
  studentApplicationsEmail: Object.freeze({
    login: "mail@edu-plus.ru",
    host: "imap.timeweb.ru",
    port: 993,
    smtpHost: "smtp.timeweb.ru",
    smtpPort: 465
  }),
  woocommerceEmailLogin: "mail@zifra-plus.ru",
  representativeName: "Симак Роман Сергеевич",
  contactEmail: "mail@edu-plus.ru",
  telegramUrl: "https://t.me/simakrs",
  maxUrl: "https://max.ru/u/f9LHodD0cOJFNLoo1J-p9xzwXq9NcNpBiO_awFVbsccTG5PS38I_pQg_iPE",
  automaticExpenseRules: [
    "Оплата преподавателю,[АвторскаяСтавка],-Симак Роман Сергеевич",
    "Оплата председателю ИАК,[СтавкаОплатыИАК]",
    "Оплата сотруднику,[СтавкаОплатыСотруднику],Симак Варвара Романовна",
    "Оплата сотруднику,[СтавкаОплатыСотруднику],Симак Юрий Романович",
    "Печать документа об образовании,110,Печатная лавка",
    "Почтовое отправление,130,Почта России"
  ].join("\n"),
  sourceAgentAssignments: "Вконтакте=Симак Варвара Романовна"
});

if (typeof window !== "undefined") window.AIS_PRIVATE_DEFAULTS = AIS_PRIVATE_DEFAULTS;
if (typeof module !== "undefined" && module.exports) module.exports = AIS_PRIVATE_DEFAULTS;
