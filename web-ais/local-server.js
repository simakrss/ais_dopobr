const http = require("http");

const port = Number(process.env.PORT || 8081);
const host = process.env.HOST || "127.0.0.1";
const appServerOrigin = process.env.AIS_APP_SERVER_ORIGIN || "http://127.0.0.1:19081";
const appServerToken = process.env.AIS_GATEWAY_SHARED_SECRET || "";
const yandexGeocoderApiKey = process.env.YANDEX_GEOCODER_API_KEY || "";
const dgisApiKey = process.env.DGIS_API_KEY || process.env.TWOGIS_API_KEY || "";
const appServerRetryDelays = [0, 250, 500, 1000, 1500, 2000, 2500];
const maxProxyRequestBytes = 48 * 1024 * 1024;
const localDocumentServicesHealthPath = "/api/local-document-services/health";
const ocrHealthUrl = process.env.AIS_OCR_HEALTH_URL || "http://127.0.0.1:8083/health";
const documentConversionHealthUrl = process.env.AIS_DOCUMENT_CONVERSION_HEALTH_URL
  || "http://127.0.0.1:8082/healthcheck";
const trustedRemoteAppOrigins = new Set(
  String(process.env.AIS_REMOTE_APP_ORIGINS || "https://edu-plus.ru,https://www.edu-plus.ru")
    .split(",")
    .map((value) => normalizeOrigin(value))
    .filter(Boolean)
);

function send(res, status, body, contentType = "text/plain; charset=utf-8", headers = {}) {
  res.writeHead(status, {
    "Content-Type": contentType,
    "Cache-Control": "no-store",
    ...headers
  });
  res.end(body);
}

function normalizeOrigin(value) {
  try {
    return new URL(String(value || "").trim()).origin;
  } catch {
    return "";
  }
}

function isLoopbackAddress(value) {
  const address = String(value || "").trim().toLowerCase();
  return address === "127.0.0.1"
    || address === "::1"
    || address === "::ffff:127.0.0.1";
}

function isLoopbackHostname(value) {
  const hostname = String(value || "").trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (hostname === "localhost" || hostname === "::1") return true;
  const parts = hostname.split(".");
  return parts.length === 4
    && parts[0] === "127"
    && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}

function getEffectivePort(url, fallbackProtocol = "http:") {
  if (url.port) return url.port;
  const protocol = url.protocol || fallbackProtocol;
  return protocol === "https:" ? "443" : "80";
}

function isSameRequestOrigin(req, origin) {
  if (!origin) return true;
  try {
    const originUrl = new URL(origin);
    const requestHost = String(req.headers.host || "").trim().toLowerCase();
    if (originUrl.host.toLowerCase() === requestHost) return true;

    const requestUrl = new URL(`http://${requestHost}`);
    const sameLoopbackMachine = isLoopbackHostname(originUrl.hostname)
      && isLoopbackHostname(requestUrl.hostname)
      && isLoopbackAddress(req.socket.remoteAddress);
    return sameLoopbackMachine
      || (
        originUrl.hostname.toLowerCase() === requestUrl.hostname.toLowerCase()
        && getEffectivePort(originUrl) === getEffectivePort(requestUrl)
      );
  } catch {
    return false;
  }
}

function isRemoteDocumentServicePath(pathname) {
  return pathname === localDocumentServicesHealthPath
    || pathname === "/api/contracts/student-document"
    || pathname.startsWith("/api/contracts/student-document-preview/")
    || pathname.startsWith("/api/students/recognize-documents/");
}

function getRequestAccessContext(req, url) {
  const origin = normalizeOrigin(req.headers.origin);
  const crossOrigin = Boolean(origin) && !isSameRequestOrigin(req, origin);
  const trustedRemoteService = crossOrigin
    && trustedRemoteAppOrigins.has(origin)
    && isLoopbackAddress(req.socket.remoteAddress)
    && isRemoteDocumentServicePath(url.pathname);
  return {
    origin,
    crossOrigin,
    trustedRemoteService,
    attachGatewayIdentity: Boolean(appServerToken) && isLoopbackAddress(req.socket.remoteAddress),
    forwardedHost: trustedRemoteService ? new URL(origin).host : String(req.headers.host || `${host}:${port}`)
  };
}

function getRemoteServiceCorsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, HEAD, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Requested-With",
    "Access-Control-Allow-Private-Network": "true",
    "Access-Control-Expose-Headers": "Content-Disposition, X-Generated-Document-Format, X-Generated-Document-File-Name, X-Document-Conversion-Fallback, X-Document-Conversion-Error, X-Document-Preview-Token, X-Yandex-Disk-Saved, X-Yandex-Disk-Path, X-Yandex-Disk-Error, X-Local-Document-Saved, X-Local-Document-Path, X-Local-Document-Error, X-Local-Document-Cancelled, X-AIS-Processing",
    "Access-Control-Max-Age": "600",
    "Vary": "Origin, Access-Control-Request-Private-Network"
  };
}

async function testHttpService(url, timeoutMilliseconds = 1800) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMilliseconds);
  try {
    const response = await fetch(url, {
      method: "GET",
      cache: "no-store",
      signal: controller.signal
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

async function handleLocalDocumentServicesHealth(req, res, accessContext) {
  const [appServerAvailable, ocrAvailable, documentConversionAvailable] = await Promise.all([
    testHttpService(new URL("/api/health", appServerOrigin).toString()),
    testHttpService(ocrHealthUrl),
    testHttpService(documentConversionHealthUrl)
  ]);
  const payload = JSON.stringify({
    ok: appServerAvailable && (ocrAvailable || documentConversionAvailable),
    appServerAvailable,
    ocrAvailable: appServerAvailable && ocrAvailable,
    documentConversionAvailable: appServerAvailable && documentConversionAvailable
  });
  const headers = accessContext.trustedRemoteService
    ? getRemoteServiceCorsHeaders(accessContext.origin)
    : {};
  headers["X-AIS-Processing"] = "local-docker";
  send(
    res,
    200,
    req.method === "HEAD" ? "" : payload,
    "application/json; charset=utf-8",
    headers
  );
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

function readProxyRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let tooLarge = false;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxProxyRequestBytes) {
        tooLarge = true;
        chunks.length = 0;
        return;
      }
      if (!tooLarge) chunks.push(chunk);
    });
    req.on("end", () => {
      if (tooLarge) {
        reject(new Error("Пакет данных превышает допустимый размер."));
        return;
      }
      resolve(chunks.length ? Buffer.concat(chunks) : Buffer.alloc(0));
    });
    req.on("error", reject);
  });
}

function isRetryableAppServerError(error) {
  return ["ECONNREFUSED", "ECONNRESET", "EPIPE", "ETIMEDOUT"].includes(String(error?.code || ""));
}

function forwardToAppServer(req, res, body, accessContext, attempt = 0) {
  const target = new URL(req.url, appServerOrigin);
  const headers = {
    ...req.headers,
    "x-forwarded-host": accessContext.forwardedHost,
    "x-forwarded-proto": accessContext.trustedRemoteService ? "https" : "http",
    "x-forwarded-for": req.socket.remoteAddress || ""
  };
  for (const name of [
    "x-ais-gateway-token",
    "x-ais-session-id",
    "x-ais-user-id",
    "x-ais-user-login",
    "x-ais-user-name",
    "x-ais-user-role"
  ]) delete headers[name];
  if (accessContext.attachGatewayIdentity) {
    headers["x-ais-gateway-token"] = appServerToken;
    if (accessContext.trustedRemoteService) {
      headers["x-ais-session-id"] = "local-browser-services";
      headers["x-ais-user-id"] = "local-browser-services";
      headers["x-ais-user-login"] = "local-services";
      headers["x-ais-user-name"] = "Local services";
      headers["x-ais-user-role"] = "manager";
    }
  }
  delete headers["transfer-encoding"];
  headers["content-length"] = String(body.length);
  let appServerConnected = false;
  const proxyReq = http.request({
    protocol: target.protocol,
    hostname: target.hostname,
    port: target.port,
    method: req.method,
    path: `${target.pathname}${target.search}`,
    headers
  }, (proxyRes) => {
    const responseHeaders = { ...proxyRes.headers };
    if (accessContext.trustedRemoteService) {
      Object.assign(responseHeaders, getRemoteServiceCorsHeaders(accessContext.origin));
      responseHeaders["x-ais-processing"] = "local-docker";
    }
    res.writeHead(proxyRes.statusCode || 502, responseHeaders);
    proxyRes.pipe(res);
  });
  proxyReq.once("socket", (socket) => {
    if (socket.connecting) socket.once("connect", () => { appServerConnected = true; });
    else appServerConnected = true;
  });

  proxyReq.on("error", (error) => {
    const nextAttempt = attempt + 1;
    const requestCanBeRepeated = !appServerConnected
      || ["GET", "HEAD", "OPTIONS"].includes(String(req.method || "GET").toUpperCase());
    if (
      !res.headersSent
      && requestCanBeRepeated
      && isRetryableAppServerError(error)
      && nextAttempt < appServerRetryDelays.length
    ) {
      setTimeout(
        () => forwardToAppServer(req, res, body, accessContext, nextAttempt),
        appServerRetryDelays[nextAttempt]
      );
      return;
    }
    if (!res.headersSent) {
      send(
        res,
        502,
        JSON.stringify({
          error: `Сервер приложения ${appServerOrigin} не ответил после автоматического восстановления. Повторите операцию.`
        }),
        "application/json; charset=utf-8"
      );
      return;
    }
    res.destroy();
  });

  proxyReq.end(body);
}

async function proxyToAppServer(req, res, accessContext) {
  try {
    const body = await readProxyRequestBody(req);
    forwardToAppServer(req, res, body, accessContext);
  } catch (error) {
    if (!res.headersSent) {
      send(res, 413, JSON.stringify({ error: error.message }), "application/json; charset=utf-8");
    }
  }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || `${host}:${port}`}`);
  const accessContext = getRequestAccessContext(req, url);
  if (accessContext.crossOrigin && !accessContext.trustedRemoteService) {
    console.warn(
      `Cross-origin request denied: ${req.method || "GET"} ${url.pathname}; `
      + `origin=${accessContext.origin || "(none)"}; host=${req.headers.host || "(none)"}; `
      + `remote=${req.socket.remoteAddress || "(unknown)"}`
    );
    send(res, 403, "Cross-origin request denied.");
    return;
  }
  if (req.method === "OPTIONS" && accessContext.trustedRemoteService) {
    send(res, 204, "", "text/plain; charset=utf-8", getRemoteServiceCorsHeaders(accessContext.origin));
    return;
  }
  if (
    ["GET", "HEAD"].includes(String(req.method || "GET").toUpperCase())
    && url.pathname === localDocumentServicesHealthPath
  ) {
    handleLocalDocumentServicesHealth(req, res, accessContext).catch((error) => {
      if (!res.headersSent) {
        send(res, 500, JSON.stringify({ ok: false, error: error.message }), "application/json; charset=utf-8");
      }
    });
    return;
  }
  if (url.pathname === "/api/postal-index") {
    handlePostalIndex(req, res, url);
    return;
  }
  proxyToAppServer(req, res, accessContext);
});

server.listen(port, host, () => {
  console.log(`Web AIS local server: http://${host}:${port}/ -> ${appServerOrigin}`);
});
