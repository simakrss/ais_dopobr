const http = require("http");

const port = Number(process.env.PORT || 8081);
const host = process.env.HOST || "127.0.0.1";
const appServerOrigin = process.env.AIS_APP_SERVER_ORIGIN || "http://127.0.0.1:8080";
const yandexGeocoderApiKey = process.env.YANDEX_GEOCODER_API_KEY || "";
const dgisApiKey = process.env.DGIS_API_KEY || process.env.TWOGIS_API_KEY || "";

function send(res, status, body, contentType = "text/plain; charset=utf-8") {
  res.writeHead(status, {
    "Content-Type": contentType,
    "Cache-Control": "no-store"
  });
  res.end(body);
}

function normalizePostalIndex(value) {
  const digits = String(value || "").replace(/\D/g, "");
  return digits.length === 6 ? digits : "";
}

function normalizeAddressQuery(query) {
  return String(query || "")
    .replace(/^индекс\s+/i, "")
    .replace(/(^|[\s,])пр-?т\.?(?=([\s,]|$))/giu, "$1проспект")
    .replace(/(^|[\s,])пр\.?(?=([\s,]|$))/giu, "$1проспект")
    .replace(/(^|[\s,])ул\.?(?=([\s,]|$))/giu, "$1улица")
    .replace(/(^|[\s,])пер\.?(?=([\s,]|$))/giu, "$1переулок")
    .replace(/(^|[\s,])наб\.?(?=([\s,]|$))/giu, "$1набережная")
    .replace(/(^|[\s,])пл\.?(?=([\s,]|$))/giu, "$1площадь")
    .replace(/(^|[\s,])ш\.?(?=([\s,]|$))/giu, "$1шоссе")
    .replace(/,\s*(?:кв|квартира|оф|офис|пом|помещение|комн|комната)\.?\s*[^,]+/giu, "")
    .replace(/\s+/g, " ")
    .trim();
}

async function findPostalIndexWith2gis(query) {
  if (!dgisApiKey) return "";
  const address = normalizeAddressQuery(query);
  if (!address) return "";
  const searchParams = new URLSearchParams({
    key: dgisApiKey,
    q: address,
    locale: "ru_RU",
    type: "building",
    fields: "items.address,items.full_address_name",
    page_size: "3"
  });
  const response = await fetch(`https://catalog.api.2gis.com/3.0/items/geocode?${searchParams.toString()}`, {
    headers: {
      "Accept": "application/json",
      "Accept-Language": "ru-RU,ru;q=0.9,en;q=0.6",
      "User-Agent": "WebAIS/1.0 local postal index lookup"
    }
  });
  if (!response.ok) return "";
  const data = await response.json();
  const items = data?.result?.items || [];
  for (const item of items) {
    const index = normalizePostalIndex(item?.address?.postcode);
    if (index) return index;
  }
  return "";
}

async function findPostalIndexWithYandexGeocoder(query) {
  if (!yandexGeocoderApiKey) return "";
  const address = normalizeAddressQuery(query);
  if (!address) return "";
  const searchParams = new URLSearchParams({
    apikey: yandexGeocoderApiKey,
    geocode: address,
    format: "json",
    lang: "ru_RU",
    results: "5"
  });
  const response = await fetch(`https://geocode-maps.yandex.ru/v1/?${searchParams.toString()}`, {
    headers: {
      "Accept": "application/json",
      "Accept-Language": "ru-RU,ru;q=0.9,en;q=0.6",
      "User-Agent": "WebAIS/1.0 local postal index lookup"
    }
  });
  if (!response.ok) return "";
  const data = await response.json();
  const items = data?.response?.GeoObjectCollection?.featureMember || [];
  for (const item of items) {
    const metadata = item?.GeoObject?.metaDataProperty?.GeocoderMetaData;
    const kind = metadata?.kind || "";
    const index = normalizePostalIndex(metadata?.Address?.postal_code);
    if (index && kind === "house") return index;
  }
  for (const item of items) {
    const metadata = item?.GeoObject?.metaDataProperty?.GeocoderMetaData;
    const index = normalizePostalIndex(metadata?.Address?.postal_code);
    if (index && !/000$/.test(index)) return index;
  }
  return "";
}

async function findPostalIndexWithNominatim(query) {
  const address = normalizeAddressQuery(query);
  if (!address) return "";
  const searchParams = new URLSearchParams({
    format: "jsonv2",
    addressdetails: "1",
    limit: "5",
    countrycodes: "ru",
    q: address
  });
  const response = await fetch(`https://nominatim.openstreetmap.org/search?${searchParams.toString()}`, {
    headers: {
      "Accept": "application/json",
      "Accept-Language": "ru-RU,ru;q=0.9,en;q=0.6",
      "User-Agent": "WebAIS/1.0 local postal index lookup"
    }
  });
  if (!response.ok) return "";
  const results = await response.json();
  if (!Array.isArray(results)) return "";
  for (const result of results) {
    const hasHouse = Boolean(result?.address?.house_number);
    const addressIndex = normalizePostalIndex(result?.address?.postcode);
    if (addressIndex && !(hasHouse && /000$/.test(addressIndex))) return addressIndex;
    const displayIndex = normalizePostalIndex(result?.display_name);
    if (displayIndex && !(hasHouse && /000$/.test(displayIndex))) return displayIndex;
  }
  return "";
}

async function handlePostalIndex(req, res, url) {
  const query = String(url.searchParams.get("query") || "").trim();
  if (!query) {
    send(res, 400, JSON.stringify({ index: "" }), "application/json; charset=utf-8");
    return;
  }
  try {
    const yandexIndex = await findPostalIndexWithYandexGeocoder(query);
    if (yandexIndex) {
      send(res, 200, JSON.stringify({ index: yandexIndex, source: "Yandex Geocoder" }), "application/json; charset=utf-8");
      return;
    }
    const dgisIndex = await findPostalIndexWith2gis(query);
    if (dgisIndex) {
      send(res, 200, JSON.stringify({ index: dgisIndex, source: "2GIS" }), "application/json; charset=utf-8");
      return;
    }
    const index = await findPostalIndexWithNominatim(query);
    send(res, 200, JSON.stringify({ index, source: index ? "OpenStreetMap Nominatim" : "" }), "application/json; charset=utf-8");
  } catch (error) {
    send(res, 200, JSON.stringify({ index: "", source: "" }), "application/json; charset=utf-8");
  }
}

function proxyToAppServer(req, res) {
  const target = new URL(req.url, appServerOrigin);
  const headers = {
    ...req.headers,
    "x-forwarded-host": req.headers.host || `${host}:${port}`,
    "x-forwarded-proto": "http",
    "x-forwarded-for": req.socket.remoteAddress || ""
  };
  const proxyReq = http.request({
    protocol: target.protocol,
    hostname: target.hostname,
    port: target.port,
    method: req.method,
    path: `${target.pathname}${target.search}`,
    headers
  }, (proxyRes) => {
    res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
    proxyRes.pipe(res);
  });

  proxyReq.on("error", () => {
    if (!res.headersSent) {
      send(
        res,
        502,
        JSON.stringify({ error: "Сервер приложения на порту 8080 недоступен." }),
        "application/json; charset=utf-8"
      );
      return;
    }
    res.destroy();
  });

  req.pipe(proxyReq);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || `${host}:${port}`}`);
  if (url.pathname === "/api/postal-index") {
    handlePostalIndex(req, res, url);
    return;
  }
  proxyToAppServer(req, res);
});

server.listen(port, host, () => {
  console.log(`Web AIS local server: http://${host}:${port}/ -> ${appServerOrigin}`);
});
