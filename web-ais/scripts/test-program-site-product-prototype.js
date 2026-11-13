"use strict";
const assert = require("node:assert/strict");
const pg = require("../program-site-generator");
const link = id => `https://zifra-plus.ru/checkout/?add-to-cart=${id}`;
const template = value => ({fields: {ssylka_na_registraciyu: value}});
assert.equal(pg.prototypeProductId(template(link(5112))), 5112);
assert.equal(pg.prototypeProductId(template("http://zifra-plus.ru/cart/?coupon=abc&amp;add-to-cart=5112")), 5112);
assert.equal(pg.prototypeProductId(template("https://zifra-plus.ru/?x=1&#38;add-to-cart=5112")), 5112);
assert.equal(pg.prototypeProductId({fields: {
  ssylka_na_registraciyu: link(999),
  blok_ceny: [{ssylka_na_registraciyu: link(12)}, {ssylka_na_registraciyu: link(13)}]
}}), 12, "Categories follow the first retained price offer, not a different variant");
for (const bad of ["", "old", "javascript:alert(1)", link(0), link(-1), link("12oops"), link("1.5"), link("0012"),
  link(Number.MAX_SAFE_INTEGER + 1), link(12) + "&add-to-cart=13", "https://evil.example/?add-to-cart=12",
  "https://zifra-plus.ru.evil.example/?add-to-cart=12", "https://user:pass@zifra-plus.ru/?add-to-cart=12",
  "https://zifra-plus.ru:8443/?add-to-cart=12"]) assert.throws(() => pg.prototypeProductId(template(bad)), /прототип/i);
assert.throws(() => pg.prototypeProductId({fields: {blok_opisaniya_kursa: [{ssylka_na_registraciyu: link(12)}]}}), /прототип/i, "Review references are not product prototypes");
assert.equal(pg.prototypeProductId({fields: {review: {ssylka_na_registraciyu: link(12)}, registration: {ssylka_na_registraciyu: link(34)}}}), 34);
console.log("PASS: shop prototype from registration, price-variant priority, HTML entities, trusted URLs and review exclusion");
