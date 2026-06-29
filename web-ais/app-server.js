const http = require("node:http");
const https = require("node:https");
const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const zlib = require("node:zlib");

const ROOT = __dirname;
const STORAGE_ROOT = path.join(ROOT, "storage");
const PHOTO_ROOT = path.join(STORAGE_ROOT, "photos");
const DOCUMENT_TEMPLATE_ROOT = path.join(STORAGE_ROOT, "document-templates");
const PORT = Number(process.env.PORT || 8080);
const MAX_JSON_BYTES = 40 * 1024 * 1024;
const MAX_DOCX_BYTES = 24 * 1024 * 1024;
const WORD_TEMPLATE_EXTENSIONS = new Set(["doc", "docx", "docm", "dot", "dotx", "dotm", "rtf"]);
const OPENXML_WORD_EXTENSIONS = new Set(["docx", "docm", "dotx", "dotm"]);
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".docm": "application/vnd.ms-word.document.macroEnabled.12",
  ".dot": "application/msword",
  ".dotx": "application/vnd.openxmlformats-officedocument.wordprocessingml.template",
  ".dotm": "application/vnd.ms-word.template.macroEnabled.12",
  ".rtf": "application/rtf"
};

async function ensureStorage() {
  await fs.mkdir(PHOTO_ROOT, { recursive: true });
  await fs.mkdir(DOCUMENT_TEMPLATE_ROOT, { recursive: true });
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    ...CORS_HEADERS,
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(payload));
}

function sendError(res, status, message) {
  sendJson(res, status, { error: message });
}
function sendFile(res, status, bytes, fileName, contentType) {
  const encodedName = encodeURIComponent(fileName).replace(/['()]/g, escape);
  res.writeHead(status, {
    ...CORS_HEADERS,
    "Content-Type": contentType,
    "Content-Length": bytes.length,
    "Content-Disposition": `attachment; filename*=UTF-8''${encodedName}`,
    "Cache-Control": "no-store"
  });
  res.end(bytes);
}

function escapeXmlText(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/\r\n|\r|\n/g, "&#10;");
}

function escapeXmlAttribute(value) {
  return escapeXmlText(value).replace(/'/g, "&apos;");
}

function safeDocumentFileName(value) {
  const base = safeNamePart(String(value || "договор").replace(/\.docx$/i, ""), "договор");
  return `${base}.docx`;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) ? (0xEDB88320 ^ (value >>> 1)) : (value >>> 1);
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let crc = 0xFFFFFFFF;
  for (let index = 0; index < bytes.length; index += 1) {
    crc = CRC_TABLE[(crc ^ bytes[index]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function findZipEnd(buffer) {
  for (let offset = buffer.length - 22; offset >= 0; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054B50) return offset;
  }
  throw new Error("Некорректный DOCX: не найден центральный каталог ZIP");
}

function readDocxZipEntries(buffer) {
  const endOffset = findZipEnd(buffer);
  const totalEntries = buffer.readUInt16LE(endOffset + 10);
  const centralOffset = buffer.readUInt32LE(endOffset + 16);
  const entries = [];
  let offset = centralOffset;
  for (let index = 0; index < totalEntries; index += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014B50) throw new Error("Некорректный DOCX: ошибка центрального каталога");
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = buffer.subarray(dataOffset, dataOffset + compressedSize);
    let content;
    if (method === 0) content = Buffer.from(compressed);
    else if (method === 8) content = zlib.inflateRawSync(compressed);
    else throw new Error(`DOCX содержит неподдерживаемый метод сжатия ZIP: ${method}`);
    entries.push({ name, content });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function buildDocxZip(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  entries.forEach((entry) => {
    const name = Buffer.from(entry.name, "utf8");
    const content = Buffer.isBuffer(entry.content) ? entry.content : Buffer.from(entry.content);
    const compressed = zlib.deflateRawSync(content, { level: 6 });
    const crc = crc32(content);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034B50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(0, 10);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(content.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, name, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014B50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(0, 12);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(content.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);
    offset += local.length + name.length + compressed.length;
  });
  const centralOffset = offset;
  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054B50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(centralOffset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, ...centralParts, end]);
}

const IMAGE_CONTENT_TYPES = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp"
};

function entryByName(entries, name) {
  return entries.find((entry) => entry.name === name);
}

function nextRelationshipId(relsXml) {
  let maxId = 0;
  for (const match of relsXml.matchAll(/\bId="rId(\d+)"/g)) {
    maxId = Math.max(maxId, Number(match[1]) || 0);
  }
  return `rId${maxId + 1}`;
}

function nextDocPrId(documentXml) {
  let maxId = 0;
  for (const match of documentXml.matchAll(/<wp:docPr\b[^>]*\bid="(\d+)"/g)) {
    maxId = Math.max(maxId, Number(match[1]) || 0);
  }
  return maxId + 1;
}

function ensureContentType(entries, ext, contentType) {
  const entry = entryByName(entries, "[Content_Types].xml");
  if (!entry) return;
  let xml = entry.content.toString("utf8");
  const pattern = new RegExp(`<Default\\b[^>]*\\bExtension="${ext}"`, "i");
  if (pattern.test(xml)) return;
  xml = xml.replace(
    "</Types>",
    `<Default Extension="${escapeXmlAttribute(ext)}" ContentType="${escapeXmlAttribute(contentType)}"/></Types>`
  );
  entry.content = Buffer.from(xml, "utf8");
}

function ensureDocumentRelationshipsEntry(entries) {
  let entry = entryByName(entries, "word/_rels/document.xml.rels");
  if (entry) return entry;
  entry = {
    name: "word/_rels/document.xml.rels",
    content: Buffer.from(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>',
      "utf8"
    )
  };
  entries.push(entry);
  return entry;
}

function addDocumentImageRelationship(entries, target) {
  const relsEntry = ensureDocumentRelationshipsEntry(entries);
  let relsXml = relsEntry.content.toString("utf8");
  const relationshipId = nextRelationshipId(relsXml);
  const relationshipXml = `<Relationship Id="${relationshipId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="${escapeXmlAttribute(target)}"/>`;
  relsXml = relsXml.replace("</Relationships>", `${relationshipXml}</Relationships>`);
  relsEntry.content = Buffer.from(relsXml, "utf8");
  return relationshipId;
}

function uniqueMediaName(entries, ext) {
  let index = 1;
  let name;
  do {
    name = `word/media/ais-photo-${Date.now().toString(36)}-${index}.${ext}`;
    index += 1;
  } while (entryByName(entries, name));
  return name;
}

function imageDimensions(bytes, ext) {
  if (ext === "png" && bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]))) {
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  if ((ext === "jpg" || ext === "jpeg") && bytes.length > 4) {
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xFF) {
        offset += 1;
        continue;
      }
      const marker = bytes[offset + 1];
      const length = bytes.readUInt16BE(offset + 2);
      if (length < 2) break;
      if ((marker >= 0xC0 && marker <= 0xC3) || (marker >= 0xC5 && marker <= 0xC7) || (marker >= 0xC9 && marker <= 0xCB) || (marker >= 0xCD && marker <= 0xCF)) {
        return { width: bytes.readUInt16BE(offset + 7), height: bytes.readUInt16BE(offset + 5) };
      }
      offset += 2 + length;
    }
  }
  if (ext === "gif" && bytes.length >= 10 && bytes.subarray(0, 3).toString("ascii") === "GIF") {
    return { width: bytes.readUInt16LE(6), height: bytes.readUInt16LE(8) };
  }
  if (ext === "webp" && bytes.length >= 30 && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") {
    const format = bytes.subarray(12, 16).toString("ascii");
    if (format === "VP8X" && bytes.length >= 30) {
      return {
        width: 1 + bytes.readUIntLE(24, 3),
        height: 1 + bytes.readUIntLE(27, 3)
      };
    }
    if (format === "VP8 " && bytes.length >= 30) {
      return { width: bytes.readUInt16LE(26) & 0x3FFF, height: bytes.readUInt16LE(28) & 0x3FFF };
    }
    if (format === "VP8L" && bytes.length >= 25) {
      const bits = bytes.readUInt32LE(21);
      return { width: (bits & 0x3FFF) + 1, height: ((bits >> 14) & 0x3FFF) + 1 };
    }
  }
  return { width: 300, height: 400 };
}

const EMU_PER_TWIP = 635;
const EMU_PER_POINT = 12700;
const EMU_PER_INCH = 914400;
const EMU_PER_CM = 360000;

function parseXmlTagNumberAttribute(xml, tagName, attrName) {
  const tagPattern = new RegExp(`<${tagName}\\b[^>]*>`, "i");
  const tag = tagPattern.exec(xml || "")?.[0] || "";
  if (!tag) return null;
  const attrPattern = new RegExp(`\\b${attrName}="([^"]+)"`, "i");
  const value = attrPattern.exec(tag)?.[1];
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function parseXmlTagAttribute(xml, tagName, attrName) {
  const tagPattern = new RegExp(`<${tagName}\\b[^>]*>`, "i");
  const tag = tagPattern.exec(xml || "")?.[0] || "";
  if (!tag) return "";
  const attrPattern = new RegExp(`\\b${attrName}="([^"]+)"`, "i");
  return attrPattern.exec(tag)?.[1] || "";
}

function getEnclosingXmlElement(xml, index, tagName) {
  const start = xml.lastIndexOf(`<${tagName}`, index);
  if (start < 0) return null;
  const previousClose = xml.lastIndexOf(`</${tagName}>`, index);
  if (previousClose > start) return null;
  const end = xml.indexOf(`</${tagName}>`, index);
  if (end < 0) return null;
  return {
    start,
    end: end + tagName.length + 3,
    xml: xml.slice(start, end + tagName.length + 3)
  };
}

function parseTwipsToEmu(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.round(number * EMU_PER_TWIP) : null;
}

function parseCssLengthToEmu(value) {
  const match = /^(-?\d+(?:\.\d+)?)(pt|in|cm|mm|px)?$/i.exec(String(value || "").trim());
  if (!match) return null;
  const number = Number(match[1]);
  if (!Number.isFinite(number) || number <= 0) return null;
  const unit = (match[2] || "pt").toLowerCase();
  if (unit === "pt") return Math.round(number * EMU_PER_POINT);
  if (unit === "in") return Math.round(number * EMU_PER_INCH);
  if (unit === "cm") return Math.round(number * EMU_PER_CM);
  if (unit === "mm") return Math.round(number * EMU_PER_CM / 10);
  if (unit === "px") return Math.round(number * EMU_PER_INCH / 96);
  return null;
}

function parseStyleLengthToEmu(style, property) {
  const pattern = new RegExp(`(?:^|;)\\s*${property}\\s*:\\s*([^;]+)`, "i");
  return parseCssLengthToEmu(pattern.exec(style || "")?.[1]);
}

function getWordFrameImageConstraints(xml, markerIndex) {
  const paragraph = getEnclosingXmlElement(xml, markerIndex, "w:p");
  const framePr = paragraph?.xml.match(/<w:framePr\b[^>]*>/i)?.[0] || "";
  if (!framePr) return null;
  const width = parseTwipsToEmu(/\bw:w="([^"]+)"/i.exec(framePr)?.[1]);
  const height = parseTwipsToEmu(/\bw:h="([^"]+)"/i.exec(framePr)?.[1]);
  if (!width && !height) return null;
  return { width, height, source: "framePr" };
}

function getDrawingFrameImageConstraints(xml, markerIndex) {
  const drawing = getEnclosingXmlElement(xml, markerIndex, "w:drawing");
  if (!drawing) return null;
  const width = parseXmlTagNumberAttribute(drawing.xml, "wp:extent", "cx");
  const height = parseXmlTagNumberAttribute(drawing.xml, "wp:extent", "cy");
  if (!width && !height) return null;
  return { width, height, source: "drawing" };
}

function getVmlFrameImageConstraints(xml, markerIndex) {
  const shapeTags = ["v:shape", "v:rect", "v:roundrect"];
  for (const tagName of shapeTags) {
    const shape = getEnclosingXmlElement(xml, markerIndex, tagName);
    if (!shape) continue;
    const style = parseXmlTagAttribute(shape.xml, tagName, "style");
    const width = parseStyleLengthToEmu(style, "width");
    const height = parseStyleLengthToEmu(style, "height");
    if (width || height) return { width, height, source: "vml" };
  }
  return null;
}

function parseTableCellWidthEmu(cellXml) {
  const tcWTag = cellXml.match(/<w:tcW\b[^>]*>/i)?.[0] || "";
  if (!tcWTag) return null;
  const type = /\bw:type="([^"]+)"/i.exec(tcWTag)?.[1] || "dxa";
  if (type !== "dxa") return null;
  return parseTwipsToEmu(/\bw:w="([^"]+)"/i.exec(tcWTag)?.[1]);
}

function parseTableRowHeightEmu(rowXml) {
  const trHeightTag = rowXml.match(/<w:trHeight\b[^>]*>/i)?.[0] || "";
  if (!trHeightTag) return null;
  return parseTwipsToEmu(/\bw:val="([^"]+)"/i.exec(trHeightTag)?.[1]);
}

function getTableFrameImageConstraints(xml, markerIndex) {
  const cell = getEnclosingXmlElement(xml, markerIndex, "w:tc");
  const row = getEnclosingXmlElement(xml, markerIndex, "w:tr");
  if (!cell && !row) return null;
  const width = cell ? parseTableCellWidthEmu(cell.xml) : null;
  const height = row ? parseTableRowHeightEmu(row.xml) : null;
  const hasVisibleFrame = Boolean(
    /<w:tcBorders\b/i.test(cell?.xml || "")
    || /<w:tblBorders\b/i.test(getEnclosingXmlElement(xml, markerIndex, "w:tbl")?.xml || "")
  );
  if (!width && !height) return null;
  if (!height && !hasVisibleFrame) return null;
  return { width, height, source: "table" };
}

function getImageFrameConstraints(xml, marker) {
  const markerIndex = xml.indexOf(marker);
  if (markerIndex < 0) return null;
  return getDrawingFrameImageConstraints(xml, markerIndex)
    || getVmlFrameImageConstraints(xml, markerIndex)
    || getWordFrameImageConstraints(xml, markerIndex)
    || getTableFrameImageConstraints(xml, markerIndex);
}

function imageExtentEmu(image, frame = null) {
  const maxWidth = 3 * 360000;
  const maxHeight = 4 * 360000;
  const width = Math.max(1, Number(image.width) || 300);
  const height = Math.max(1, Number(image.height) || 400);
  const aspect = width / height;
  const frameWidth = Number(frame?.width) > 0 ? Number(frame.width) : null;
  const frameHeight = Number(frame?.height) > 0 ? Number(frame.height) : null;
  if (frameHeight) {
    const cy = frameHeight;
    let cx = Math.round(cy * aspect);
    if (frameWidth && cx > frameWidth) cx = frameWidth;
    return { cx: Math.max(1, cx), cy: Math.max(1, cy) };
  }
  if (frameWidth) {
    const cx = frameWidth;
    return { cx: Math.max(1, cx), cy: Math.max(1, Math.round(cx / aspect)) };
  }
  let cx = maxWidth;
  let cy = Math.round(cx / aspect);
  if (cy > maxHeight) {
    cy = maxHeight;
    cx = Math.round(cy * aspect);
  }
  return { cx, cy };
}

function buildImageDrawingXml({ relationshipId, cx, cy, docPrId, name }) {
  const safeName = escapeXmlAttribute(name || "Фото слушателя");
  return `<w:drawing><wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:docPr id="${docPrId}" name="${safeName}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="0" name="${safeName}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:embed="${relationshipId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing>`;
}

function replaceTextMarkerWithXml(xml, marker, replacementXml) {
  const escapedMarker = marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const textNodePattern = new RegExp(`(<w:t\\b[^>]*>)([^<]*)${escapedMarker}([^<]*)(</w:t>)`, "g");
  let replaced = false;
  const result = xml.replace(textNodePattern, (match, openTag, before, after, closeTag) => {
    replaced = true;
    return `${openTag}${before}${closeTag}</w:r><w:r>${replacementXml}</w:r><w:r>${openTag}${after}${closeTag}`;
  });
  if (replaced) return { xml: result, replaced: true };
  if (!xml.includes(marker)) return { xml, replaced: false };
  return { xml: xml.split(marker).join(replacementXml), replaced: true };
}

function insertDocumentImage(entries, fieldName, image) {
  const documentEntry = entryByName(entries, "word/document.xml");
  if (!documentEntry) return false;
  let documentXml = documentEntry.content.toString("utf8");
  const marker = `#${fieldName}#`;
  if (!documentXml.includes(marker)) return false;
  const ext = image.ext === "jpeg" ? "jpg" : image.ext;
  const contentType = IMAGE_CONTENT_TYPES[ext];
  if (!contentType) return false;
  const mediaName = uniqueMediaName(entries, ext);
  const target = mediaName.replace(/^word\//, "");
  const relationshipId = addDocumentImageRelationship(entries, target);
  const frame = getImageFrameConstraints(documentXml, marker);
  const { cx, cy } = imageExtentEmu(image, frame);
  const drawingXml = buildImageDrawingXml({
    relationshipId,
    cx,
    cy,
    docPrId: nextDocPrId(documentXml),
    name: image.name || fieldName
  });
  const replaced = replaceTextMarkerWithXml(documentXml, marker, drawingXml);
  if (!replaced.replaced) return false;
  documentEntry.content = Buffer.from(replaced.xml, "utf8");
  entries.push({ name: mediaName, content: image.bytes });
  ensureContentType(entries, ext, contentType);
  return true;
}

function decodeXmlText(value) {
  return String(value || "")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function parseCustomDocumentProperties(entries) {
  const entry = entryByName(entries, "docProps/custom.xml");
  if (!entry) return [];
  const xml = entry.content.toString("utf8");
  const properties = [];
  const propertyPattern = /<property\b([^>]*)>([\s\S]*?)<\/property>/g;
  for (const match of xml.matchAll(propertyPattern)) {
    const name = /name="([^"]+)"/.exec(match[1])?.[1];
    if (!name) continue;
    const valueMatch = /<vt:[^>]+>([\s\S]*?)<\/vt:[^>]+>/.exec(match[2]);
    if (!valueMatch) continue;
    properties.push({ name: decodeXmlText(name), value: decodeXmlText(valueMatch[1]) });
  }
  return properties;
}

function decodeAssistantOptionText(value) {
  return String(value || "")
    .replace(/_x000d_\r?\n?/gi, "\n")
    .replace(/_x000a_\r?\n?/gi, "\n")
    .replace(/_x000b_/gi, "\u000b")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
}

function parseAssistantOptionBoolean(value) {
  return /^(?:1|да|true|истина)$/i.test(String(value || "").trim());
}

function isAssistantOptionPropertyName(name) {
  const prefix = "Опции";
  const text = String(name || "");
  return text.startsWith(prefix) && /^\d+$/.test(text.slice(prefix.length));
}

function parseAssistantDocumentFieldProperties(properties) {
  const optionProperties = (Array.isArray(properties) ? properties : [])
    .filter((property) => isAssistantOptionPropertyName(property?.name))
    .sort((a, b) => (
      Number(String(a.name).replace(/^Опции/, "")) - Number(String(b.name).replace(/^Опции/, ""))
    ));
  if (!optionProperties.length) return [];
  const configText = decodeAssistantOptionText(optionProperties.map((property) => property.value || "").join(""));
  const fields = [];
  const seen = new Set();
  const sectionPattern = /^\[Поля\\([^\]]+)\]\s*\n([\s\S]*?)(?=^\[[^\]]+\]\s*$|(?![\s\S]))/gm;
  for (const match of configText.matchAll(sectionPattern)) {
    const values = {};
    let currentKey = "";
    String(match[2] || "").split("\n").forEach((line) => {
      const separatorIndex = line.indexOf("=");
      if (separatorIndex > 0) {
        currentKey = line.slice(0, separatorIndex).trim();
        values[currentKey] = line.slice(separatorIndex + 1).replace(/\u000b/g, "\n").trim();
        return;
      }
      if (currentKey && line) values[currentKey] = `${values[currentKey]}\n${line.replace(/\u000b/g, "\n")}`;
    });
    const name = String(values["ИмяПоля"] || "").replace(/^#+|#+$/g, "").trim();
    if (!name || seen.has(name)) continue;
    const formula = String(values["Формула"] || "").trim();
    const fieldNumber = Number.parseInt(String(match[1] || "").trim(), 10);
    const position = Number.parseInt(values["Позиция"], 10);
    fields.push({
      name,
      value: formula,
      fieldNumber: Number.isFinite(fieldNumber) && fieldNumber > 0 ? fieldNumber : undefined,
      position: Number.isFinite(position) && position > 0 ? position : fields.length + 1,
      hideEmpty: parseAssistantOptionBoolean(values["СкрытьПустые"]),
      source: "assistant-options"
    });
    seen.add(name);
  }
  return fields;
}

function getDocumentFormulaPropertiesFromEntries(entries) {
  const properties = parseCustomDocumentProperties(entries);
  return [
    ...properties.filter((property) => !isAssistantOptionPropertyName(property.name)),
    ...parseAssistantDocumentFieldProperties(properties)
  ];
}

function isFormulaLike(value) {
  const text = String(value || "").trim();
  return Boolean(text && (/^=/.test(text) || /\[[^\]]+\]|#[^#]+#|[A-Za-zА-Яа-яЁё_][A-Za-zА-Яа-яЁё0-9_]*\(/.test(text)));
}

function getDocumentFormulaFieldReferences(formula) {
  const result = [];
  const seen = new Set();
  for (const match of String(formula || "").matchAll(/#([^#\r\n]+)#/g)) {
    const name = String(match[1] || "").trim();
    if (!name || seen.has(name)) continue;
    seen.add(name);
    result.push(name);
  }
  return result;
}

function orderDocumentFormulaProperties(properties) {
  const propertiesByName = new Map();
  (Array.isArray(properties) ? properties : []).forEach((property) => {
    const name = String(property?.name || "").trim();
    if (name && isFormulaLike(property?.value)) propertiesByName.set(name, { ...property, name });
  });
  const stateByName = new Map();
  const path = [];
  const ordered = [];
  const visit = (name) => {
    if (stateByName.get(name) === "visiting") {
      const startIndex = path.indexOf(name);
      const cycle = [...path.slice(Math.max(0, startIndex)), name];
      throw new Error(`Обнаружена рекурсия в формулах документа: ${cycle.join(" → ")}.`);
    }
    if (stateByName.get(name) === "visited") return;
    const property = propertiesByName.get(name);
    if (!property) return;
    stateByName.set(name, "visiting");
    path.push(name);
    getDocumentFormulaFieldReferences(property.value)
      .filter((dependency) => propertiesByName.has(dependency))
      .forEach(visit);
    path.pop();
    stateByName.set(name, "visited");
    ordered.push(property);
  };
  for (const name of propertiesByName.keys()) visit(name);
  return ordered;
}

function splitTopLevel(value, delimiter) {
  const parts = [];
  let start = 0;
  let depth = 0;
  let squareDepth = 0;
  let quoted = false;
  const text = String(value || "");
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '"') {
      if (quoted && text[index + 1] === '"') {
        index += 1;
        continue;
      }
      quoted = !quoted;
      continue;
    }
    if (quoted) continue;
    if (char === "[") squareDepth += 1;
    else if (char === "]") squareDepth = Math.max(0, squareDepth - 1);
    else if (char === "(") depth += 1;
    else if (char === ")") depth = Math.max(0, depth - 1);
    else if (char === delimiter && depth === 0 && squareDepth === 0) {
      parts.push(text.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
}

function unwrapFormulaParentheses(value) {
  let text = String(value || "").trim();
  while (text.startsWith("(") && text.endsWith(")")) {
    let depth = 0;
    let quoted = false;
    let wraps = true;
    for (let index = 0; index < text.length; index += 1) {
      const char = text[index];
      if (char === '"') {
        if (quoted && text[index + 1] === '"') index += 1;
        else quoted = !quoted;
        continue;
      }
      if (quoted) continue;
      if (char === "(") depth += 1;
      if (char === ")") depth -= 1;
      if (depth === 0 && index < text.length - 1) {
        wraps = false;
        break;
      }
    }
    if (!wraps) break;
    text = text.slice(1, -1).trim();
  }
  return text;
}

function findTopLevelComparison(value) {
  const text = String(value || "");
  let depth = 0;
  let squareDepth = 0;
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '"') {
      if (quoted && text[index + 1] === '"') {
        index += 1;
        continue;
      }
      quoted = !quoted;
      continue;
    }
    if (quoted) continue;
    if (char === "[") squareDepth += 1;
    else if (char === "]") squareDepth = Math.max(0, squareDepth - 1);
    else if (char === "(") depth += 1;
    else if (char === ")") depth = Math.max(0, depth - 1);
    else if (depth === 0 && squareDepth === 0) {
      const twoChars = text.slice(index, index + 2);
      if ([">=", "<=", "<>"].includes(twoChars)) return { index, operator: twoChars };
      if ([">", "<"].includes(char)) return { index, operator: char };
      if (text.slice(index, index + 2) === "<>") return { index, operator: "<>" };
      if (char === "=") return { index, operator: "=" };
    }
  }
  return null;
}

function formulaValueToString(value) {
  if (value === true) return "ИСТИНА";
  if (value === false) return "ЛОЖЬ";
  if (value === null || value === undefined) return "";
  return String(value);
}

function formulaValueToBoolean(value) {
  if (typeof value === "boolean") return value;
  const text = String(value ?? "").trim().toLowerCase();
  return Boolean(text && text !== "0" && text !== "ложь" && text !== "false");
}

function parseDocumentFormulaDateValue(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.getTime();
  const text = String(value ?? "").trim();
  if (!text) return null;
  const ru = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(text);
  if (ru) return new Date(Number(ru[3]), Number(ru[2]) - 1, Number(ru[1])).getTime();
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])).getTime();
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date.getTime();
}

function compareDocumentFormulaValues(left, right, operator) {
  if (operator === "=" || operator === "<>") {
    const result = formulaValueToString(left) === formulaValueToString(right);
    return operator === "<>" ? !result : result;
  }
  const leftNumber = typeof left === "number" ? left : Number(String(left ?? "").replace(",", "."));
  const rightNumber = typeof right === "number" ? right : Number(String(right ?? "").replace(",", "."));
  let comparableLeft = leftNumber;
  let comparableRight = rightNumber;
  if (!Number.isFinite(comparableLeft) || !Number.isFinite(comparableRight)) {
    comparableLeft = parseDocumentFormulaDateValue(left);
    comparableRight = parseDocumentFormulaDateValue(right);
  }
  if (comparableLeft === null || comparableRight === null || !Number.isFinite(comparableLeft) || !Number.isFinite(comparableRight)) {
    comparableLeft = formulaValueToString(left);
    comparableRight = formulaValueToString(right);
  }
  if (operator === ">") return comparableLeft > comparableRight;
  if (operator === "<") return comparableLeft < comparableRight;
  if (operator === ">=") return comparableLeft >= comparableRight;
  if (operator === "<=") return comparableLeft <= comparableRight;
  return false;
}

function getFormulaContextValue(name, context) {
  const key = String(name || "").trim();
  if (key && key === String(context?.evaluatingName || "").trim()
    && Object.prototype.hasOwnProperty.call(context.sourceValues, key)) {
    return context.sourceValues[key];
  }
  if (Object.prototype.hasOwnProperty.call(context.fieldValues, key)) return context.fieldValues[key];
  if (Object.prototype.hasOwnProperty.call(context.sourceValues, key)) return context.sourceValues[key];
  const baseKey = key.split("|")[0].trim();
  if (baseKey && baseKey !== key) {
    if (baseKey === String(context?.evaluatingName || "").trim()
      && Object.prototype.hasOwnProperty.call(context.sourceValues, baseKey)) {
      return context.sourceValues[baseKey];
    }
    if (Object.prototype.hasOwnProperty.call(context.fieldValues, baseKey)) return context.fieldValues[baseKey];
    if (Object.prototype.hasOwnProperty.call(context.sourceValues, baseKey)) return context.sourceValues[baseKey];
  }
  return "";
}

function replaceDocumentFormulaReferences(text, context) {
  return String(text ?? "")
    .replace(/#([^#]+)#/g, (_, fieldName) => formulaValueToString(getFormulaContextValue(fieldName, context)))
    .replace(/\[([^\]]+)\]/g, (_, fieldName) => formulaValueToString(getFormulaContextValue(fieldName, context)));
}

function parseDocumentFormulaQuotedLiteral(value) {
  const text = String(value || "");
  if (text.length < 2 || text[0] !== '"') return null;
  let result = "";
  for (let index = 1; index < text.length; index += 1) {
    const char = text[index];
    if (char !== '"') {
      result += char;
      continue;
    }
    if (text[index + 1] === '"') {
      result += '"';
      index += 1;
      continue;
    }
    return index === text.length - 1 ? result : null;
  }
  return null;
}

function evaluateDocumentFormula(formula, context) {
  try {
    return formulaValueToString(evaluateDocumentFormulaExpression(String(formula || "").replace(/^=\s*/, ""), context)).trim();
  } catch {
    return String(formula || "")
      .replace(/^=\s*/, "")
      .replace(/#([^#]+)#/g, (_, fieldName) => formulaValueToString(getFormulaContextValue(fieldName, context)))
      .replace(/\[([^\]]+)\]/g, (_, fieldName) => formulaValueToString(getFormulaContextValue(fieldName, context)))
      .trim();
  }
}

function isGetSqlQueryFormula(value) {
  return /Получить\s*SQL\s*запрос|ПолучитьSQLзапрос/i.test(String(value || ""));
}

function evaluateDocumentFormulaExpression(expression, context) {
  let text = unwrapFormulaParentheses(String(expression || "").trim());
  if (!text) return "";
  if (/^ИСТИНА$/i.test(text)) return true;
  if (/^ЛОЖЬ$/i.test(text)) return false;
  const quotedLiteral = parseDocumentFormulaQuotedLiteral(text);
  if (quotedLiteral !== null) return replaceDocumentFormulaReferences(quotedLiteral, context);
  if (/^-?\d+(?:[.,]\d+)?$/.test(text)) return Number(text.replace(",", "."));
  const concatParts = splitTopLevel(text, "&");
  if (concatParts.length > 1) {
    return concatParts.map((part) => formulaValueToString(evaluateDocumentFormulaExpression(part, context))).join("");
  }
  const comparison = findTopLevelComparison(text);
  if (comparison) {
    const left = evaluateDocumentFormulaExpression(text.slice(0, comparison.index), context);
    const right = evaluateDocumentFormulaExpression(text.slice(comparison.index + comparison.operator.length), context);
    return compareDocumentFormulaValues(left, right, comparison.operator);
  }
  const hashRef = /^#([^#]+)#$/.exec(text);
  if (hashRef) return getFormulaContextValue(hashRef[1], context);
  const sourceRef = /^\[([^\]]+)\]$/.exec(text);
  if (sourceRef) return getFormulaContextValue(sourceRef[1], context);
  const functionMatch = /^([A-Za-zА-Яа-яЁё_][A-Za-zА-Яа-яЁё0-9_]*)\(([\s\S]*)\)$/.exec(text);
  if (functionMatch) {
    return evaluateDocumentFormulaFunction(functionMatch[1], splitTopLevel(functionMatch[2], ";"), context);
  }
  return text
    .replace(/#([^#]+)#/g, (_, fieldName) => formulaValueToString(getFormulaContextValue(fieldName, context)))
    .replace(/\[([^\]]+)\]/g, (_, fieldName) => formulaValueToString(getFormulaContextValue(fieldName, context)));
}

function evaluateDocumentFormulaFunction(name, args, context) {
  const upperName = String(name || "").toUpperCase();
  const value = (index) => evaluateDocumentFormulaExpression(args[index] || "", context);
  const text = (index) => formulaValueToString(value(index));
  if (upperName === "ТДАТА") return new Date();
  if (upperName === "ЕСЛИ") return formulaValueToBoolean(value(0)) ? value(1) : value(2);
  if (upperName === "И") return args.every((arg) => formulaValueToBoolean(evaluateDocumentFormulaExpression(arg, context)));
  if (upperName === "ИЛИ") return args.some((arg) => formulaValueToBoolean(evaluateDocumentFormulaExpression(arg, context)));
  if (upperName === "ЕСЛИОШИБКА") {
    try { return value(0); } catch { return value(1); }
  }
  if (upperName === "ПОИСК") {
    const needle = text(0).toLowerCase();
    const haystack = text(1).toLowerCase();
    const index = haystack.indexOf(needle);
    if (index < 0) throw new Error("ПОИСК: значение не найдено");
    return index + 1;
  }
  if (upperName === "ПОДСТАВИТЬ") return text(0).split(text(1)).join(text(2));
  if (upperName === "СИМВОЛ") return String.fromCharCode(Number(value(0)) || 0);
  if (upperName === "ЛЕВСИМВ") return text(0).slice(0, Number(value(1)) || 0);
  if (upperName === "ТЕКСТ") return formatDocumentFormulaDate(text(0));
  if (upperName === "ПОЛУЧИТЬSQLЗАПРОС" || upperName === "ПОЛУЧИТЬ_SQL_ЗАПРОС") return "";
  if (upperName === "ПОЛУЧИТЬ_ЭЛЕМЕНТ") {
    const delimiter = text(2) || " ";
    const index = Math.max(1, Number(value(1)) || 1) - 1;
    return text(0).split(delimiter).filter(Boolean)[index] || "";
  }
  if (upperName === "ЧИСЛО_В_ПРОПИСЬ") return numberToRussianWords(Number(String(text(0)).replace(/\s+/g, "").replace(",", ".")) || 0);
  if (upperName === "СКЛОНЕНИЕ_ФИО") {
    const grammaticalCase = text(1).toUpperCase();
    const mode = text(2).toUpperCase();
    if (mode === "ИО") {
      const parts = splitFullName(text(0));
      return [parts.firstName, parts.patronymic].filter(Boolean).join(" ");
    }
    if (grammaticalCase === "И") return text(0);
    if (grammaticalCase === "Д") return inflectFioDative(text(0));
    return inflectFioGenitive(text(0));
  }
  return `${name}(${args.map((arg) => formulaValueToString(evaluateDocumentFormulaExpression(arg, context))).join(";")})`;
}

function formatDocumentFormulaDate(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (iso) return `${iso[3]}.${iso[2]}.${iso[1]}`;
  const ru = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(text);
  if (ru) return text;
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return text;
  return `${String(date.getDate()).padStart(2, "0")}.${String(date.getMonth() + 1).padStart(2, "0")}.${date.getFullYear()}`;
}

function numberToRussianWords(value) {
  const number = Math.abs(Math.trunc(Number(value) || 0));
  if (!number) return "ноль";
  const units = [
    { forms: ["", "", ""], gender: "male" },
    { forms: ["тысяча", "тысячи", "тысяч"], gender: "female" },
    { forms: ["миллион", "миллиона", "миллионов"], gender: "male" },
    { forms: ["миллиард", "миллиарда", "миллиардов"], gender: "male" }
  ];
  const parts = [];
  let rest = number;
  let unitIndex = 0;
  while (rest > 0 && unitIndex < units.length) {
    const chunk = rest % 1000;
    if (chunk) parts.unshift(formatRussianNumberChunk(chunk, units[unitIndex]));
    rest = Math.floor(rest / 1000);
    unitIndex += 1;
  }
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

function formatRussianNumberChunk(value, unit) {
  const hundreds = ["", "сто", "двести", "триста", "четыреста", "пятьсот", "шестьсот", "семьсот", "восемьсот", "девятьсот"];
  const tens = ["", "", "двадцать", "тридцать", "сорок", "пятьдесят", "шестьдесят", "семьдесят", "восемьдесят", "девяносто"];
  const teens = ["десять", "одиннадцать", "двенадцать", "тринадцать", "четырнадцать", "пятнадцать", "шестнадцать", "семнадцать", "восемнадцать", "девятнадцать"];
  const onesMale = ["", "один", "два", "три", "четыре", "пять", "шесть", "семь", "восемь", "девять"];
  const onesFemale = ["", "одна", "две", "три", "четыре", "пять", "шесть", "семь", "восемь", "девять"];
  const result = [];
  const h = Math.floor(value / 100);
  const t = Math.floor((value % 100) / 10);
  const o = value % 10;
  if (hundreds[h]) result.push(hundreds[h]);
  if (t === 1) result.push(teens[o]);
  else {
    if (tens[t]) result.push(tens[t]);
    const ones = unit.gender === "female" ? onesFemale : onesMale;
    if (ones[o]) result.push(ones[o]);
  }
  if (unit.forms[0]) result.push(unit.forms[getRussianPluralIndex(value)]);
  return result.join(" ");
}

function getRussianPluralIndex(value) {
  const mod10 = value % 10;
  const mod100 = value % 100;
  if (mod10 === 1 && mod100 !== 11) return 0;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 1;
  return 2;
}

function splitFullName(name) {
  const [surname = "", firstName = "", patronymic = ""] = String(name || "").trim().split(/\s+/).filter(Boolean);
  return { surname, firstName, patronymic };
}

function inferGenderFromFio(name) {
  const { patronymic, firstName } = splitFullName(name);
  if (/вна$/i.test(patronymic) || /[ая]$/i.test(firstName)) return "female";
  return "male";
}

function inflectFioGenitive(name) {
  const gender = inferGenderFromFio(name);
  const parts = splitFullName(name);
  return [
    inflectRussianNamePart(parts.surname, gender, "surname"),
    inflectRussianNamePart(parts.firstName, gender, "firstName"),
    inflectRussianNamePart(parts.patronymic, gender, "patronymic")
  ].filter(Boolean).join(" ");
}

function inflectFioDative(name) {
  const gender = inferGenderFromFio(name);
  const parts = splitFullName(name);
  return [
    inflectRussianNamePartDative(parts.surname, gender, "surname"),
    inflectRussianNamePartDative(parts.firstName, gender, "firstName"),
    inflectRussianNamePartDative(parts.patronymic, gender, "patronymic")
  ].filter(Boolean).join(" ");
}

function inflectRussianNamePart(value, gender, role) {
  if (!value) return "";
  return String(value).split("-").map((part) => inflectRussianSimpleNamePart(part, gender, role)).join("-");
}

function inflectRussianNamePartDative(value, gender, role) {
  if (!value) return "";
  return String(value).split("-").map((part) => inflectRussianSimpleNamePartDative(part, gender, role)).join("-");
}

function inflectRussianSimpleNamePart(value, gender, role) {
  const lower = value.toLowerCase();
  const replaceEnding = (pattern, ending) => value.replace(pattern, ending);
  if (gender === "female") {
    if (role === "patronymic" && /(?:вна|ична)$/i.test(value)) return value.replace(/а$/i, "ы");
    if (/(ская|цкая)$/i.test(value)) return replaceEnding(/ая$/i, "ой");
    if (/(ая|яя)$/i.test(value)) return replaceEnding(/[ая]$/i, "ой");
    if (/(ова|ева|ёва|ина)$/i.test(value)) return replaceEnding(/а$/i, "ой");
    if (/ия$/i.test(value)) return replaceEnding(/ия$/i, "ии");
    if (/я$/i.test(value)) return replaceEnding(/я$/i, "и");
    if (/а$/i.test(value)) return replaceEnding(/а$/i, /[гкхжчшщ]а$/i.test(lower) ? "и" : "ы");
    return value;
  }
  if (role === "patronymic" && /ич$/i.test(value)) return `${value}а`;
  if (/(ский|цкий)$/i.test(value)) return value.replace(/ий$/i, "ого");
  if (/(ый|ой)$/i.test(value)) return value.replace(/[ыо]й$/i, "ого");
  if (/ий$/i.test(value)) return value.replace(/ий$/i, "ия");
  if (/[йь]$/i.test(value)) return value.replace(/[йь]$/i, "я");
  if (/[бвгджзклмнпрстфхцчшщ]$/i.test(value)) return `${value}а`;
  return value;
}

function inflectRussianSimpleNamePartDative(value, gender, role) {
  if (!value) return "";
  const lower = value.toLowerCase();
  const replaceEnding = (pattern, ending) => value.replace(pattern, ending);
  if (gender === "female") {
    if (role === "patronymic" && /(?:вна|ична)$/i.test(value)) return value.replace(/а$/i, "е");
    if (/(ская|цкая)$/i.test(value)) return replaceEnding(/ая$/i, "ой");
    if (/яя$/i.test(value)) return replaceEnding(/яя$/i, "ей");
    if (/ая$/i.test(value)) return replaceEnding(/ая$/i, "ой");
    if (/(ова|ева|ёва|ина)$/i.test(value)) return replaceEnding(/а$/i, "ой");
    if (/ия$/i.test(value)) return replaceEnding(/ия$/i, "ии");
    if (/[ая]$/i.test(value)) return replaceEnding(/[ая]$/i, "е");
    return value;
  }
  if (role === "patronymic" && /ич$/i.test(value)) return `${value}у`;
  if (/(ский|цкий)$/i.test(value)) return value.replace(/ий$/i, "ому");
  if (/(ый|ой)$/i.test(value)) return value.replace(/[ыо]й$/i, "ому");
  if (/ий$/i.test(value)) return value.replace(/ий$/i, "ию");
  if (/[йь]$/i.test(value)) return value.replace(/[йь]$/i, "ю");
  if (/[бвгджзклмнпрстфхцчшщ]$/i.test(lower)) return `${value}у`;
  return value;
}

function applyCustomDocumentPropertyFormulas(templateBytes, fieldValues, sourceValues) {
  const entries = readDocxZipEntries(templateBytes);
  const values = { ...(fieldValues || {}) };
  const context = { fieldValues: values, sourceValues: sourceValues || {} };
  orderDocumentFormulaProperties(getDocumentFormulaPropertiesFromEntries(entries)).forEach((property) => {
    context.evaluatingName = property.name;
    if (isGetSqlQueryFormula(property.value)) {
      const existingValue = getFormulaContextValue(property.name, context) || values[property.name] || "";
      values[property.name] = property.name === "УчебныйПлан"
        ? (getFormulaContextValue("УчебныйПлан", context) || existingValue || "")
        : existingValue;
      context.evaluatingName = "";
      return;
    }
    const existingValue = getFormulaContextValue(property.name, context) || values[property.name] || "";
    const evaluatedValue = evaluateDocumentFormula(property.value, context);
    values[property.name] = evaluatedValue || existingValue;
    context.evaluatingName = "";
  });
  return values;
}

function getIndexedWordFieldPositionMap(entries) {
  const positionMap = new Map();
  getDocumentFormulaPropertiesFromEntries(entries).forEach((property) => {
    const fieldNumber = Number(property.fieldNumber);
    if (Number.isFinite(fieldNumber) && fieldNumber > 0 && property.name) {
      positionMap.set(String(fieldNumber), property.name);
    }
    const position = Number(property.position);
    if (Number.isFinite(position) && position > 0 && property.name && !positionMap.has(String(position))) {
      positionMap.set(String(position), property.name);
    }
  });
  return positionMap;
}

function normalizeExpulsionOrderFieldPositionMap(fieldPositionMap, fieldValues) {
  const values = fieldValues || {};
  const hasExpulsionOrderLists = Object.prototype.hasOwnProperty.call(values, "СписокСвыдачей")
    || Object.prototype.hasOwnProperty.call(values, "СписокБезВыдачи");
  if (!hasExpulsionOrderLists || !fieldPositionMap?.size) return fieldPositionMap;
  const mappedNames = new Set(fieldPositionMap.values());
  if (mappedNames.has("СписокСвыдачей")) return fieldPositionMap;
  const hasKnownAssistantShift = fieldPositionMap.get("6") === "N3"
    && fieldPositionMap.get("7") === "СписокБезВыдачи"
    && fieldPositionMap.get("9") === "N3";
  if (!hasKnownAssistantShift) return fieldPositionMap;
  const normalizedMap = new Map(fieldPositionMap);
  normalizedMap.set("6", "СписокСвыдачей");
  return normalizedMap;
}

function buildWordTextRuns(value) {
  return String(value ?? "").split(/\r\n|\r|\n/).map((line, index) => (
    `${index ? "<w:r><w:br/></w:r>" : ""}<w:r><w:t xml:space="preserve">${escapeXmlText(line)}</w:t></w:r>`
  )).join("");
}

function replaceWordFieldResultXml(resultXml, value) {
  if (/\r|\n/.test(String(value ?? ""))) return buildWordTextRuns(value);
  const escapedValue = escapeXmlText(value);
  let replaced = false;
  const nextXml = String(resultXml || "").replace(/<w:t\b[^>]*>[\s\S]*?<\/w:t>/g, () => {
    if (!replaced) {
      replaced = true;
      return `<w:t xml:space="preserve">${escapedValue}</w:t>`;
    }
    return "<w:t></w:t>";
  });
  if (replaced) return nextXml;
  return `<w:r><w:t xml:space="preserve">${escapedValue}</w:t></w:r>`;
}

function parseIndexedWordFieldInstruction(instruction) {
  const text = decodeXmlText(instruction).replace(/\s+/g, " ").trim();
  const match = /\b(SUBJECT|SEQ(?:UENCE)?)\s+"([^"]*)"[\s\S]*?(?:[\\\/]\s*|\\r\s+)(\d+)/i.exec(text);
  if (!match) return null;
  const position = Number(match[3]);
  if (!Number.isFinite(position) || position <= 0) return null;
  return {
    type: /^SUBJECT$/i.test(match[1]) ? "subject" : "sequence",
    value: match[2],
    position
  };
}

function getComplexWordFieldInstruction(fieldStartXml) {
  return [...String(fieldStartXml || "").matchAll(/<w:instrText\b[^>]*>([\s\S]*?)<\/w:instrText>/g)]
    .map((match) => decodeXmlText(match[1]))
    .join("")
    .replace(/\s+/g, " ")
    .trim();
}

function updateSubjectFieldInstruction(startXml, value) {
  const escapedInstructionValue = escapeXmlText(String(value ?? "").replace(/\r\n|\r|\n/g, " "));
  return String(startXml || "").replace(
    /(SUBJECT\s+)"[^"<]*"([\s\S]*?(?:[\\\/]\s*|\\r\s+)\d+)/i,
    `$1"${escapedInstructionValue}"$2`
  );
}

const ORDER_LIST_DOCUMENT_FIELDS = new Set([
  "\u0421\u043f\u0438\u0441\u043e\u043a",
  "\u0421\u043f\u0438\u0441\u043e\u043a\u0421\u0432\u044b\u0434\u0430\u0447\u0435\u0439",
  "\u0421\u043f\u0438\u0441\u043e\u043a\u0411\u0435\u0437\u0412\u044b\u0434\u0430\u0447\u0438"
]);
const EDUCATION_TRAINING_PLAN_FIELD = "\u0423\u0447\u0435\u0431\u043d\u044b\u0439\u041f\u043b\u0430\u043d";

function shouldRenderDocumentFieldAsParagraphs(fieldName, value) {
  return ORDER_LIST_DOCUMENT_FIELDS.has(String(fieldName || "").trim()) && /\r|\n/.test(String(value ?? ""));
}

function splitDocumentFieldParagraphLines(value) {
  return String(value ?? "").split(/\r\n|\r|\n/);
}

function splitEducationTrainingPlanLines(value) {
  return String(value ?? "").split(/\r\n|\r|\n|\u000b/);
}

function parseEducationTrainingPlanTableRows(value) {
  return splitEducationTrainingPlanLines(value)
    .map((line, index) => {
      const parts = String(line || "").split("\t").map((part) => part.trim());
      if (!parts.some(Boolean)) return null;
      const hasExplicitNumber = parts.length >= 4 && /^\d+[.)]?$/.test(parts[0] || "");
      return {
        number: hasExplicitNumber ? parts[0].replace(/[.)]$/, "") : String(index + 1),
        discipline: hasExplicitNumber ? parts[1] || "" : parts[0] || "",
        hours: hasExplicitNumber ? parts[2] || "" : parts[1] || "",
        grade: hasExplicitNumber ? parts.slice(3).join(" ").trim() : parts.slice(2).join(" ").trim()
      };
    })
    .filter((row) => row && (row.discipline || row.hours || row.grade));
}

function isEmptyDocumentFieldValue(value) {
  return !String(value ?? "").trim();
}

function getWordParagraphText(paragraphXml) {
  return [...String(paragraphXml || "").matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g)]
    .map((match) => decodeXmlText(match[1]))
    .join("");
}

function paragraphHasIndexedDocumentField(paragraphXml, fieldName, fieldPositionMap) {
  if (!fieldPositionMap?.size) return false;
  const targetName = String(fieldName || "").trim();
  if (!targetName) return false;
  const complexFieldPattern = /<w:fldChar\b(?=[^>]*w:fldCharType="begin")[^>]*\/>([\s\S]*?)<w:fldChar\b(?=[^>]*w:fldCharType="separate")[^>]*\/>/g;
  for (const match of String(paragraphXml || "").matchAll(complexFieldPattern)) {
    const indexedField = parseIndexedWordFieldInstruction(getComplexWordFieldInstruction(match[1] || ""));
    if (indexedField && fieldPositionMap.get(String(indexedField.position)) === targetName) return true;
  }
  const simpleFieldPattern = /<w:fldSimple\b[^>]*\bw:instr="([^"]*)"[^>]*>/g;
  for (const match of String(paragraphXml || "").matchAll(simpleFieldPattern)) {
    const indexedField = parseIndexedWordFieldInstruction(match[1] || "");
    if (indexedField && fieldPositionMap.get(String(indexedField.position)) === targetName) return true;
  }
  return false;
}

function paragraphHasDocumentField(paragraphXml, fieldName, fieldPositionMap) {
  const targetName = String(fieldName || "").trim();
  if (!targetName) return false;
  return getWordParagraphText(paragraphXml).includes(`#${targetName}#`)
    || paragraphHasIndexedDocumentField(paragraphXml, targetName, fieldPositionMap);
}

function getWordParagraphNormalizedText(paragraphXml) {
  return getWordParagraphText(paragraphXml).replace(/\s+/g, " ").trim().toLowerCase();
}

function findWordParagraphIndex(paragraphs, predicate) {
  return paragraphs.findIndex((match, index) => predicate(match[0], index));
}

function addWordParagraphRangeRemoval(removeIndexes, startIndex, endIndex) {
  const hasStart = Number.isInteger(startIndex) && startIndex >= 0;
  const hasEnd = Number.isInteger(endIndex) && endIndex >= 0;
  if (hasStart && hasEnd && startIndex <= endIndex) {
    for (let index = startIndex; index <= endIndex; index += 1) removeIndexes.add(index);
    return;
  }
  if (hasStart) removeIndexes.add(startIndex);
  if (hasEnd) removeIndexes.add(endIndex);
}

function addWordParagraphRange(set, startIndex, endIndex) {
  const hasStart = Number.isInteger(startIndex) && startIndex >= 0;
  const hasEnd = Number.isInteger(endIndex) && endIndex >= 0;
  if (hasStart && hasEnd && startIndex <= endIndex) {
    for (let index = startIndex; index <= endIndex; index += 1) set.add(index);
    return;
  }
  if (hasStart) set.add(startIndex);
  if (hasEnd) set.add(endIndex);
}

function findWordFieldEndParagraphIndex(paragraphs, startIndex) {
  if (!Number.isInteger(startIndex) || startIndex < 0 || startIndex >= paragraphs.length) return -1;
  for (let index = startIndex; index < paragraphs.length; index += 1) {
    if (/<w:fldChar\b(?=[^>]*w:fldCharType="end")[^>]*\/>/.test(paragraphs[index][0])) return index;
  }
  return startIndex;
}

function setWordHiddenFalse(xml) {
  return String(xml || "")
    .replace(/<w:vanish\b[^>]*\/>/g, '<w:vanish w:val="false"/>')
    .replace(/<w:vanish\b[^>]*>[\s\S]*?<\/w:vanish>/g, '<w:vanish w:val="false"/>');
}

function applyExpulsionOrderConditionalBlocks(xml, fieldValues, fieldPositionMap) {
  const values = fieldValues || {};
  const hasExpulsionOrderFields = Object.prototype.hasOwnProperty.call(values, "СписокСвыдачей")
    || Object.prototype.hasOwnProperty.call(values, "СписокБезВыдачи");
  if (!hasExpulsionOrderFields) return xml;
  const hasIssuedList = !isEmptyDocumentFieldValue(values["СписокСвыдачей"]);
  const hasWithoutIssueList = !isEmptyDocumentFieldValue(values["СписокБезВыдачи"]);
  const paragraphs = [...String(xml || "").matchAll(/<w:p\b[\s\S]*?<\/w:p>/g)];
  if (!paragraphs.length) return xml;
  const removeIndexes = new Set();
  const revealIndexes = new Set();
  const issuedHeaderIndex = findWordParagraphIndex(paragraphs, (paragraphXml) => {
    const text = getWordParagraphNormalizedText(paragraphXml);
    return text.includes("с выдачей") && !text.includes("без выдачи") && text.includes("документа об образовании");
  });
  const issuedListIndex = findWordParagraphIndex(paragraphs, (paragraphXml) => (
    paragraphHasDocumentField(paragraphXml, "СписокСвыдачей", fieldPositionMap)
  ));
  const issuedListEndIndex = findWordFieldEndParagraphIndex(paragraphs, issuedListIndex);
  const withoutIssueHeaderIndex = findWordParagraphIndex(paragraphs, (paragraphXml) => {
    const text = getWordParagraphNormalizedText(paragraphXml);
    return paragraphHasDocumentField(paragraphXml, "N2", fieldPositionMap)
      || (text.includes("без выдачи") && text.includes("документа об образовании"));
  });
  const withoutIssueListIndex = findWordParagraphIndex(paragraphs, (paragraphXml) => (
    paragraphHasDocumentField(paragraphXml, "СписокБезВыдачи", fieldPositionMap)
  ));
  const withoutIssueListEndIndex = findWordFieldEndParagraphIndex(paragraphs, withoutIssueListIndex);
  if (!hasIssuedList) addWordParagraphRangeRemoval(removeIndexes, issuedHeaderIndex, issuedListEndIndex);
  if (!hasWithoutIssueList) addWordParagraphRangeRemoval(removeIndexes, withoutIssueHeaderIndex, withoutIssueListEndIndex);
  if (hasIssuedList) addWordParagraphRange(revealIndexes, issuedHeaderIndex, issuedListEndIndex);
  if (hasWithoutIssueList) addWordParagraphRange(revealIndexes, withoutIssueHeaderIndex, withoutIssueListEndIndex);
  if (!removeIndexes.size && !revealIndexes.size) return xml;
  let cursor = 0;
  let result = "";
  paragraphs.forEach((match, index) => {
    result += String(xml || "").slice(cursor, match.index);
    if (!removeIndexes.has(index)) {
      result += revealIndexes.has(index) ? setWordHiddenFalse(match[0]) : match[0];
    }
    cursor = match.index + match[0].length;
  });
  return result + String(xml || "").slice(cursor);
}

function getWordParagraphPropertiesXml(paragraphXml) {
  return /<w:pPr\b[\s\S]*?<\/w:pPr>/.exec(String(paragraphXml || ""))?.[0] || "";
}

function getWordParagraphOpenTag(paragraphXml) {
  return /^<w:p\b[^>]*>/.exec(String(paragraphXml || ""))?.[0] || "<w:p>";
}

function getWordClonedParagraphOpenTag(paragraphXml) {
  return getWordParagraphOpenTag(paragraphXml)
    .replace(/\s+w14:paraId="[^"]*"/g, "")
    .replace(/\s+w14:textId="[^"]*"/g, "");
}

function getWordParagraphInnerXml(paragraphXml) {
  const text = String(paragraphXml || "");
  const openTag = getWordParagraphOpenTag(text);
  return text.endsWith("</w:p>")
    ? text.slice(openTag.length, -"</w:p>".length)
    : text.slice(openTag.length);
}

function getWordMarkerRunPropertiesXml(paragraphXml, marker) {
  const text = String(paragraphXml || "");
  const markerIndex = marker ? text.indexOf(marker) : -1;
  const runStart = markerIndex >= 0 ? text.lastIndexOf("<w:r", markerIndex) : text.indexOf("<w:r");
  const runEnd = runStart >= 0 ? text.indexOf("</w:r>", Math.max(markerIndex, runStart)) : -1;
  const runXml = runStart >= 0 && runEnd >= 0 ? text.slice(runStart, runEnd + "</w:r>".length) : text;
  return /<w:rPr\b[\s\S]*?<\/w:rPr>/.exec(runXml)?.[0]
    || /<w:rPr\b[\s\S]*?<\/w:rPr>/.exec(text)?.[0]
    || "";
}

function buildWordRunFromLine(sourceParagraphXml, line, marker = "") {
  const runProperties = getWordMarkerRunPropertiesXml(sourceParagraphXml, marker);
  return `<w:r>${runProperties}<w:t xml:space="preserve">${escapeXmlText(line)}</w:t></w:r>`;
}

function buildWordParagraphFromLine(sourceParagraphXml, line, marker = "") {
  const openTag = getWordClonedParagraphOpenTag(sourceParagraphXml);
  const paragraphProperties = getWordParagraphPropertiesXml(sourceParagraphXml);
  return `${openTag}${paragraphProperties}${buildWordRunFromLine(sourceParagraphXml, line, marker)}</w:p>`;
}

function splitWordTableRowCells(rowXml) {
  return [...String(rowXml || "").matchAll(/<w:tc\b[\s\S]*?<\/w:tc>/g)]
    .map((match) => ({ xml: match[0], index: match.index }));
}

function getWordTableCellOpenTag(cellXml) {
  return /^<w:tc\b[^>]*>/.exec(String(cellXml || ""))?.[0] || "<w:tc>";
}

function getWordTableCellPropertiesXml(cellXml) {
  return /<w:tcPr\b[\s\S]*?<\/w:tcPr>/.exec(String(cellXml || ""))?.[0] || "";
}

function getWordTableCellFirstParagraphXml(cellXml) {
  return /<w:p\b[\s\S]*?<\/w:p>/.exec(String(cellXml || ""))?.[0] || "<w:p></w:p>";
}

function buildWordTableCellValueXml(cellXml, value) {
  const openTag = getWordTableCellOpenTag(cellXml);
  const cellProperties = getWordTableCellPropertiesXml(cellXml);
  const sourceParagraphXml = getWordTableCellFirstParagraphXml(cellXml);
  const lines = splitDocumentFieldParagraphLines(value);
  const paragraphsXml = (lines.length ? lines : [""])
    .map((line) => buildWordParagraphFromLine(sourceParagraphXml, line))
    .join("");
  return `${openTag}${cellProperties}${paragraphsXml}</w:tc>`;
}

function replaceWordTableRowCells(rowXml, nextCells) {
  const cells = splitWordTableRowCells(rowXml);
  if (!cells.length) return rowXml;
  let cursor = 0;
  let result = "";
  cells.forEach((cell, index) => {
    result += String(rowXml || "").slice(cursor, cell.index);
    result += nextCells[index] || cell.xml;
    cursor = cell.index + cell.xml.length;
  });
  return result + String(rowXml || "").slice(cursor);
}

function getEducationTrainingPlanFieldCellIndex(cells, fieldPositionMap) {
  return cells.findIndex((cell) => paragraphHasDocumentField(
    cell.xml,
    EDUCATION_TRAINING_PLAN_FIELD,
    fieldPositionMap
  ));
}

function buildEducationTrainingPlanTableRow(rowXml, row, rowIndex, fieldCellIndex) {
  const cells = splitWordTableRowCells(rowXml);
  if (!cells.length) return rowXml;
  const disciplineIndex = fieldCellIndex >= 0 ? fieldCellIndex : (cells.length >= 4 ? 1 : 0);
  const numberIndex = disciplineIndex > 0 ? disciplineIndex - 1 : -1;
  const hoursIndex = disciplineIndex + 1 < cells.length ? disciplineIndex + 1 : -1;
  const gradeIndex = disciplineIndex + 2 < cells.length ? disciplineIndex + 2 : -1;
  const cellValues = new Map();
  if (numberIndex >= 0) {
    cellValues.set(numberIndex, /<w:numPr\b/.test(cells[numberIndex].xml) ? "" : row.number || String(rowIndex + 1));
  }
  cellValues.set(disciplineIndex, row.discipline || "");
  if (hoursIndex >= 0) cellValues.set(hoursIndex, row.hours || "");
  if (gradeIndex >= 0) cellValues.set(gradeIndex, row.grade || "");
  const nextCells = cells.map((cell, index) => (
    cellValues.has(index) ? buildWordTableCellValueXml(cell.xml, cellValues.get(index)) : cell.xml
  ));
  return replaceWordTableRowCells(rowXml, nextCells);
}

function applyEducationTrainingPlanTableRows(xml, fieldValues, fieldPositionMap) {
  const value = fieldValues?.[EDUCATION_TRAINING_PLAN_FIELD];
  const rows = parseEducationTrainingPlanTableRows(value);
  if (!rows.length) return xml;
  return String(xml || "").replace(/<w:tr\b[\s\S]*?<\/w:tr>/g, (rowXml) => {
    const cells = splitWordTableRowCells(rowXml);
    if (cells.length < 2) return rowXml;
    const fieldCellIndex = getEducationTrainingPlanFieldCellIndex(cells, fieldPositionMap);
    if (fieldCellIndex < 0) return rowXml;
    return rows.map((row, index) => buildEducationTrainingPlanTableRow(rowXml, row, index, fieldCellIndex)).join("");
  });
}

function trimDanglingWordRunStartXml(xml) {
  const text = String(xml || "");
  const runStarts = [...text.matchAll(/<w:r\b[^>]*>/g)];
  const lastRunStart = runStarts.length ? runStarts[runStarts.length - 1].index : -1;
  const lastRunEnd = text.lastIndexOf("</w:r>");
  if (lastRunStart > lastRunEnd) return text.slice(0, lastRunStart);
  return text;
}

function trimLeadingWordRunCloseXml(xml) {
  return String(xml || "").replace(/^\s*<\/w:r>/, "");
}

function buildComplexFieldParagraphsFromLines({
  sourceParagraphXml,
  beforeInner,
  startXml,
  resultXml,
  endXml,
  afterInner,
  lines,
  marker = "",
  spanFieldAcrossParagraphs = true
}) {
  if (!Array.isArray(lines) || !lines.length) return null;
  const openTag = getWordParagraphOpenTag(sourceParagraphXml);
  const clonedOpenTag = getWordClonedParagraphOpenTag(sourceParagraphXml);
  const paragraphProperties = getWordParagraphPropertiesXml(sourceParagraphXml);
  const instruction = getComplexWordFieldInstruction(startXml);
  const beforeFieldXml = trimDanglingWordRunStartXml(beforeInner);
  const afterFieldXml = trimLeadingWordRunCloseXml(afterInner);
  const fieldEndXml = `<w:r><w:fldChar w:fldCharType="end"/></w:r>${afterFieldXml}`;
  if (lines.length === 1) {
    return `${openTag}${beforeFieldXml}${buildComplexFieldStartXmlFromInstruction(instruction)}${buildWordRunFromLine(sourceParagraphXml, lines[0], marker)}${fieldEndXml}</w:p>`;
  }
  if (!spanFieldAcrossParagraphs) {
    const firstParagraphXml = `${openTag}${beforeFieldXml}${buildComplexFieldStartXmlFromInstruction(instruction)}${buildWordRunFromLine(sourceParagraphXml, lines[0], marker)}${fieldEndXml}</w:p>`;
    const restParagraphsXml = lines
      .slice(1)
      .map((line) => `${clonedOpenTag}${paragraphProperties}${buildWordRunFromLine(sourceParagraphXml, line, marker)}</w:p>`)
      .join("");
    return `${firstParagraphXml}${restParagraphsXml}`;
  }
  const firstParagraphXml = `${openTag}${beforeFieldXml}${buildComplexFieldStartXmlFromInstruction(instruction)}${buildWordRunFromLine(sourceParagraphXml, lines[0], marker)}</w:p>`;
  const restParagraphsXml = lines
    .slice(1)
    .map((line, index, restLines) => {
      const isLastLine = index === restLines.length - 1;
      return `${clonedOpenTag}${paragraphProperties}${buildWordRunFromLine(sourceParagraphXml, line, marker)}${isLastLine ? fieldEndXml : ""}</w:p>`;
    })
    .join("");
  return `${firstParagraphXml}${restParagraphsXml}`;
}

function buildComplexFieldStartXmlFromInstruction(instruction) {
  const instructionText = escapeXmlText(decodeXmlText(instruction).replace(/\r\n|\r|\n/g, " "));
  return `<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve">${instructionText}</w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>`;
}

function buildComplexFieldParagraphsFromSimpleField({
  sourceParagraphXml,
  beforeInner,
  encodedInstruction,
  resultXml,
  afterInner,
  lines,
  marker = "",
  spanFieldAcrossParagraphs = true
}) {
  const startXml = buildComplexFieldStartXmlFromInstruction(encodedInstruction);
  const endXml = '<w:r><w:fldChar w:fldCharType="end"/></w:r>';
  return buildComplexFieldParagraphsFromLines({
    sourceParagraphXml,
    beforeInner,
    startXml,
    resultXml,
    endXml,
    afterInner,
    lines,
    marker,
    spanFieldAcrossParagraphs
  });
}

function replaceTextMarkerInsideWordFieldWithParagraphs(paragraphXml, marker, lines) {
  const innerXml = getWordParagraphInnerXml(paragraphXml);
  const complexFieldPattern = /(<w:fldChar\b(?=[^>]*w:fldCharType="begin")[^>]*\/>[\s\S]*?<w:fldChar\b(?=[^>]*w:fldCharType="separate")[^>]*\/>)([\s\S]*?)(<w:fldChar\b(?=[^>]*w:fldCharType="end")[^>]*\/>)/g;
  for (const match of innerXml.matchAll(complexFieldPattern)) {
    if (!String(match[2] || "").includes(marker)) continue;
    return buildComplexFieldParagraphsFromLines({
      sourceParagraphXml: paragraphXml,
      beforeInner: innerXml.slice(0, match.index),
      startXml: match[1],
      resultXml: match[2],
      endXml: match[3],
      afterInner: innerXml.slice(match.index + match[0].length),
      lines,
      marker,
      spanFieldAcrossParagraphs: true
    });
  }
  const simpleFieldPattern = /(<w:fldSimple\b[^>]*\bw:instr="([^"]*)"[^>]*>)([\s\S]*?)(<\/w:fldSimple>)/g;
  for (const match of innerXml.matchAll(simpleFieldPattern)) {
    if (!String(match[3] || "").includes(marker)) continue;
    return buildComplexFieldParagraphsFromSimpleField({
      sourceParagraphXml: paragraphXml,
      beforeInner: innerXml.slice(0, match.index),
      encodedInstruction: match[2],
      resultXml: match[3],
      afterInner: innerXml.slice(match.index + match[0].length),
      lines,
      marker,
      spanFieldAcrossParagraphs: true
    });
  }
  return null;
}

function replaceTextMarkerWithParagraphs(xml, marker, value) {
  const lines = splitDocumentFieldParagraphLines(value);
  if (lines.length < 2) return String(xml || "").split(marker).join(escapeXmlText(value));
  let replaced = false;
  const nextXml = String(xml || "").replace(/<w:p\b[\s\S]*?<\/w:p>/g, (paragraphXml) => {
    if (!paragraphXml.includes(marker)) return paragraphXml;
    replaced = true;
    const fieldParagraphXml = replaceTextMarkerInsideWordFieldWithParagraphs(paragraphXml, marker, lines);
    if (fieldParagraphXml) return fieldParagraphXml;
    const firstParagraphXml = paragraphXml.split(marker).join(escapeXmlText(lines[0]));
    const restParagraphsXml = lines
      .slice(1)
      .map((line) => buildWordParagraphFromLine(paragraphXml, line, marker))
      .join("");
    return `${firstParagraphXml}${restParagraphsXml}`;
  });
  if (replaced) return nextXml;
  return String(xml || "").split(marker).join(lines.map((line) => escapeXmlText(line)).join("&#10;"));
}

function replaceIndexedWordFieldInsideParagraphWithParagraphs(paragraphXml, fieldValues, fieldPositionMap) {
  const innerXml = getWordParagraphInnerXml(paragraphXml);
  const complexFieldPattern = /(<w:fldChar\b(?=[^>]*w:fldCharType="begin")[^>]*\/>[\s\S]*?<w:fldChar\b(?=[^>]*w:fldCharType="separate")[^>]*\/>)([\s\S]*?)(<w:fldChar\b(?=[^>]*w:fldCharType="end")[^>]*\/>)/g;
  for (const match of innerXml.matchAll(complexFieldPattern)) {
    const indexedField = parseIndexedWordFieldInstruction(getComplexWordFieldInstruction(match[1]));
    if (!indexedField) continue;
    const fieldName = fieldPositionMap.get(String(indexedField.position));
    if (!fieldName || !Object.prototype.hasOwnProperty.call(fieldValues, fieldName)) continue;
    const value = fieldValues[fieldName];
    if (!shouldRenderDocumentFieldAsParagraphs(fieldName, value)) continue;
    const lines = splitDocumentFieldParagraphLines(value);
    const isOrderListField = ORDER_LIST_DOCUMENT_FIELDS.has(String(fieldName || "").trim());
    if (isOrderListField && getWordParagraphText(match[2]).trim() === String(lines[0] || "").trim()) continue;
    const startXml = indexedField.type === "subject"
      ? updateSubjectFieldInstruction(match[1], lines[0])
      : match[1];
    return buildComplexFieldParagraphsFromLines({
      sourceParagraphXml: paragraphXml,
      beforeInner: innerXml.slice(0, match.index),
      startXml,
      resultXml: match[2],
      endXml: match[3],
      afterInner: innerXml.slice(match.index + match[0].length),
      lines,
      spanFieldAcrossParagraphs: true
    });
  }
  const simpleFieldPattern = /(<w:fldSimple\b[^>]*\bw:instr="([^"]*)"[^>]*>)([\s\S]*?)(<\/w:fldSimple>)/g;
  for (const match of innerXml.matchAll(simpleFieldPattern)) {
    const indexedField = parseIndexedWordFieldInstruction(match[2] || "");
    if (!indexedField) continue;
    const fieldName = fieldPositionMap.get(String(indexedField.position));
    if (!fieldName || !Object.prototype.hasOwnProperty.call(fieldValues, fieldName)) continue;
    const value = fieldValues[fieldName];
    if (!shouldRenderDocumentFieldAsParagraphs(fieldName, value)) continue;
    const lines = splitDocumentFieldParagraphLines(value);
    const isOrderListField = ORDER_LIST_DOCUMENT_FIELDS.has(String(fieldName || "").trim());
    if (isOrderListField && getWordParagraphText(match[3]).trim() === String(lines[0] || "").trim()) continue;
    return buildComplexFieldParagraphsFromSimpleField({
      sourceParagraphXml: paragraphXml,
      beforeInner: innerXml.slice(0, match.index),
      encodedInstruction: match[2],
      resultXml: match[3],
      afterInner: innerXml.slice(match.index + match[0].length),
      lines,
      spanFieldAcrossParagraphs: true
    });
  }
  return null;
}

function applyIndexedWordFieldParagraphValues(xml, fieldValues, fieldPositionMap) {
  return String(xml || "").replace(/<w:p\b[\s\S]*?<\/w:p>/g, (paragraphXml) => {
    return replaceIndexedWordFieldInsideParagraphWithParagraphs(paragraphXml, fieldValues, fieldPositionMap)
      || paragraphXml;
  });
}

function replaceIndexedComplexFieldAcrossParagraphs(paragraphs, startIndex, fieldValues, fieldPositionMap) {
  const sourceParagraphXml = paragraphs[startIndex]?.[0] || "";
  const innerXml = getWordParagraphInnerXml(sourceParagraphXml);
  const startPattern = /(<w:fldChar\b(?=[^>]*w:fldCharType="begin")[^>]*\/>[\s\S]*?<w:fldChar\b(?=[^>]*w:fldCharType="separate")[^>]*\/>)/g;
  for (const startMatch of innerXml.matchAll(startPattern)) {
    const indexedField = parseIndexedWordFieldInstruction(getComplexWordFieldInstruction(startMatch[1]));
    if (!indexedField) continue;
    const fieldName = fieldPositionMap.get(String(indexedField.position));
    if (!fieldName || !Object.prototype.hasOwnProperty.call(fieldValues, fieldName)) continue;
    if (!ORDER_LIST_DOCUMENT_FIELDS.has(String(fieldName || "").trim())) continue;
    const value = fieldValues[fieldName];
    const lines = splitDocumentFieldParagraphLines(value).filter((line) => String(line || "").trim());
    if (!lines.length) continue;
    const sameParagraphEndMatch = /<w:fldChar\b(?=[^>]*w:fldCharType="end")[^>]*\/>/.exec(innerXml.slice(startMatch.index + startMatch[0].length));
    if (sameParagraphEndMatch) continue;
    for (let endIndex = startIndex + 1; endIndex < paragraphs.length; endIndex += 1) {
      const endInnerXml = getWordParagraphInnerXml(paragraphs[endIndex][0]);
      const endMatch = /<w:fldChar\b(?=[^>]*w:fldCharType="end")[^>]*\/>/.exec(endInnerXml);
      if (!endMatch) continue;
      return {
        endIndex,
        xml: buildComplexFieldParagraphsFromLines({
          sourceParagraphXml,
          beforeInner: innerXml.slice(0, startMatch.index),
          startXml: indexedField.type === "subject"
            ? updateSubjectFieldInstruction(startMatch[1], lines[0])
            : startMatch[1],
          resultXml: "",
          endXml: endMatch[0],
          afterInner: endInnerXml.slice(endMatch.index + endMatch[0].length),
          lines,
          spanFieldAcrossParagraphs: true
        })
      };
    }
  }
  return null;
}

function applyIndexedComplexFieldParagraphValues(xml, fieldValues, fieldPositionMap) {
  const sourceXml = String(xml || "");
  const paragraphs = [...sourceXml.matchAll(/<w:p\b[\s\S]*?<\/w:p>/g)];
  if (!paragraphs.length) return sourceXml;
  let cursor = 0;
  let result = "";
  for (let index = 0; index < paragraphs.length; index += 1) {
    const match = paragraphs[index];
    result += sourceXml.slice(cursor, match.index);
    const replacement = replaceIndexedComplexFieldAcrossParagraphs(paragraphs, index, fieldValues, fieldPositionMap);
    if (replacement?.xml) {
      result += replacement.xml;
      const endMatch = paragraphs[replacement.endIndex];
      cursor = endMatch.index + endMatch[0].length;
      index = replacement.endIndex;
    } else {
      result += match[0];
      cursor = match.index + match[0].length;
    }
  }
  return result + sourceXml.slice(cursor);
}

function applyIndexedComplexFieldValues(xml, fieldValues, fieldPositionMap) {
  return String(xml || "").replace(
    /(<w:fldChar\b(?=[^>]*w:fldCharType="begin")[^>]*\/>[\s\S]*?<w:fldChar\b(?=[^>]*w:fldCharType="separate")[^>]*\/>)([\s\S]*?)(<w:fldChar\b(?=[^>]*w:fldCharType="end")[^>]*\/>)/g,
    (match, startXml, resultXml, endXml) => {
      const indexedField = parseIndexedWordFieldInstruction(getComplexWordFieldInstruction(startXml));
      if (!indexedField) return match;
      const fieldName = fieldPositionMap.get(String(indexedField.position));
      if (!fieldName || !Object.prototype.hasOwnProperty.call(fieldValues, fieldName)) return match;
      const value = fieldValues[fieldName];
      if (shouldRenderDocumentFieldAsParagraphs(fieldName, value)) return match;
      const nextStartXml = indexedField.type === "subject"
        ? updateSubjectFieldInstruction(startXml, value)
        : startXml;
      return `${nextStartXml}${replaceWordFieldResultXml(resultXml, value)}${endXml}`;
    }
  );
}

function applyIndexedSimpleFieldValues(xml, fieldValues, fieldPositionMap) {
  return String(xml || "").replace(
    /(<w:fldSimple\b[^>]*\bw:instr="([^"]*)"[^>]*>)([\s\S]*?)(<\/w:fldSimple>)/g,
    (match, startXml, encodedInstruction, resultXml, endXml) => {
      const indexedField = parseIndexedWordFieldInstruction(encodedInstruction);
      if (!indexedField) return match;
      const fieldName = fieldPositionMap.get(String(indexedField.position));
      if (!fieldName || !Object.prototype.hasOwnProperty.call(fieldValues, fieldName)) return match;
      if (shouldRenderDocumentFieldAsParagraphs(fieldName, fieldValues[fieldName])) return match;
      return `${startXml}${replaceWordFieldResultXml(resultXml, fieldValues[fieldName])}${endXml}`;
    }
  );
}

function applyIndexedWordFieldValues(xml, fieldValues, fieldPositionMap) {
  if (!fieldPositionMap?.size) return xml;
  const complexParagraphXml = applyIndexedComplexFieldParagraphValues(xml, fieldValues, fieldPositionMap);
  const paragraphXml = applyIndexedWordFieldParagraphValues(complexParagraphXml, fieldValues, fieldPositionMap);
  return applyIndexedSimpleFieldValues(
    applyIndexedComplexFieldValues(paragraphXml, fieldValues, fieldPositionMap),
    fieldValues,
    fieldPositionMap
  );
}

function updateCustomDocumentProperties(entries, fieldValues, allowedNames = null) {
  const entry = entries.find((item) => item.name === "docProps/custom.xml");
  if (!entry) return;
  const values = fieldValues || {};
  let xml = entry.content.toString("utf8");
  xml = xml.replace(
    /(<property\b[^>]*\bname="([^"]+)"[^>]*>)([\s\S]*?)(<\/property>)/g,
    (match, startXml, encodedName, bodyXml, endXml) => {
      const name = decodeXmlText(encodedName);
      if (allowedNames?.size && !allowedNames.has(name)) return match;
      if (!Object.prototype.hasOwnProperty.call(values, name)) return match;
      const value = escapeXmlText(values[name]);
      const nextBody = /<vt:[^>]+>[\s\S]*?<\/vt:[^>]+>/.test(bodyXml)
        ? bodyXml.replace(/(<vt:[^>]+>)[\s\S]*?(<\/vt:[^>]+>)/, `$1${value}$2`)
        : `<vt:lpwstr>${value}</vt:lpwstr>`;
      return `${startXml}${nextBody}${endXml}`;
    }
  );
  entry.content = Buffer.from(xml, "utf8");
}

function fillDocxMarkers(templateBytes, fieldValues, imageValues = {}, propertyUpdateNames = null) {
  const replacements = Object.entries(fieldValues || {})
    .filter(([name]) => String(name || "").trim())
    .map(([name, value]) => {
      const hasImageValue = Object.prototype.hasOwnProperty.call(imageValues, name);
      return {
        marker: `#${name}#`,
        value: hasImageValue ? "" : value,
        renderAsParagraphs: !hasImageValue && shouldRenderDocumentFieldAsParagraphs(name, value)
      };
    });
  const entries = readDocxZipEntries(templateBytes);
  const indexedFieldPositionMap = normalizeExpulsionOrderFieldPositionMap(
    getIndexedWordFieldPositionMap(entries),
    fieldValues
  );
  updateCustomDocumentProperties(entries, fieldValues, propertyUpdateNames);
  Object.entries(imageValues || {}).forEach(([name, image]) => {
    if (image?.bytes?.length) insertDocumentImage(entries, name, image);
  });
  entries.forEach((entry) => {
    if (!/^word\/.+\.xml$/i.test(entry.name)) return;
    let xml = entry.content.toString("utf8");
    xml = applyExpulsionOrderConditionalBlocks(xml, fieldValues, indexedFieldPositionMap);
    xml = applyEducationTrainingPlanTableRows(xml, fieldValues, indexedFieldPositionMap);
    replacements.forEach(({ marker, value, renderAsParagraphs }) => {
      xml = renderAsParagraphs
        ? replaceTextMarkerWithParagraphs(xml, marker, value)
        : xml.split(marker).join(escapeXmlText(value));
    });
    xml = applyIndexedWordFieldValues(xml, fieldValues, indexedFieldPositionMap);
    entry.content = Buffer.from(xml, "utf8");
  });
  return buildDocxZip(entries);
}

function imageExtensionFromPath(value) {
  const ext = path.extname(String(value || "")).replace(/^\./, "").toLowerCase();
  if (ext === "jpeg") return "jpg";
  return IMAGE_CONTENT_TYPES[ext] ? ext : "";
}

function resolveStoredPhotoPath(value) {
  const source = String(value || "").trim();
  if (!source || /^data:/i.test(source)) return null;
  try {
    const url = new URL(source, `http://localhost:${PORT}`);
    if (url.protocol === "http:" || url.protocol === "https:") {
      const decodedPath = decodeURIComponent(url.pathname).replace(/^\/+/, "");
      if (decodedPath.startsWith("storage/photos/")) {
        const fullPath = path.resolve(ROOT, decodedPath);
        return isInsideRoot(fullPath) ? fullPath : null;
      }
    }
  } catch {
    // Ниже обрабатываются обычные файловые пути.
  }
  const webPath = source.replace(/^\/+/, "");
  if (webPath.startsWith("storage/photos/")) {
    const fullPath = path.resolve(ROOT, webPath);
    return isInsideRoot(fullPath) ? fullPath : null;
  }
  if (path.isAbsolute(source)) return source;
  return safePhotoPath(source);
}

async function loadContractPhoto(fieldValues) {
  const source = fieldValues?.["Фото"] || fieldValues?.photo || fieldValues?.photoPath || "";
  if (!source) return null;
  if (/^data:image\//i.test(source)) {
    const parsed = parseDataUrl(source);
    return {
      ...parsed,
      ...imageDimensions(parsed.bytes, parsed.ext),
      name: "Фото слушателя"
    };
  }
  const fullPath = resolveStoredPhotoPath(source);
  if (!fullPath) return null;
  const ext = imageExtensionFromPath(fullPath);
  if (!ext) return null;
  try {
    const bytes = await fs.readFile(fullPath);
    if (!bytes.length) return null;
    return {
      bytes,
      ext,
      mime: IMAGE_CONTENT_TYPES[ext],
      ...imageDimensions(bytes, ext),
      name: path.basename(fullPath)
    };
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

function requestBuffer(url, options = {}, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const transport = target.protocol === "http:" ? http : https;
    const req = transport.request(target, {
      method: options.method || "GET",
      headers: {
        "User-Agent": "AIS-Dopobrazovanie-Web/1.0",
        ...(options.headers || {})
      }
    }, (res) => {
      const location = res.headers.location;
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && location) {
        res.resume();
        if (redirectCount >= 5) {
          reject(new Error("Слишком много перенаправлений при загрузке шаблона."));
          return;
        }
        resolve(requestBuffer(new URL(location, target).toString(), options, redirectCount + 1));
        return;
      }
      if (res.statusCode < 200 || res.statusCode >= 300) {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => reject(new Error(`Не удалось скачать шаблон: HTTP ${res.statusCode} ${Buffer.concat(chunks).toString("utf8").slice(0, 200)}`)));
        return;
      }
      const chunks = [];
      let size = 0;
      res.on("data", (chunk) => {
        size += chunk.length;
        if (size > MAX_DOCX_BYTES) {
          req.destroy(new Error("Скачанный шаблон договора слишком большой."));
          return;
        }
        chunks.push(chunk);
      });
      res.on("end", () => resolve(Buffer.concat(chunks)));
    });
    req.on("error", reject);
    req.setTimeout(30000, () => req.destroy(new Error("Истекло время загрузки шаблона договора.")));
    req.end();
  });
}

async function downloadYandexDiskPublicFile(publicUrl) {
  const apiUrl = `https://cloud-api.yandex.net/v1/disk/public/resources/download?public_key=${encodeURIComponent(publicUrl)}`;
  const json = JSON.parse((await requestBuffer(apiUrl, {
    headers: { Accept: "application/json" }
  })).toString("utf8"));
  if (!json.href) throw new Error("Яндекс.Диск не вернул ссылку на скачивание шаблона.");
  return requestBuffer(json.href);
}

function extractGoogleDriveFileId(publicUrl) {
  const parsed = new URL(publicUrl);
  const byQuery = parsed.searchParams.get("id");
  if (byQuery) return byQuery;
  const fileMatch = /\/file\/d\/([^/]+)/.exec(parsed.pathname);
  if (fileMatch) return fileMatch[1];
  const docMatch = /\/(?:document|spreadsheets|presentation)\/d\/([^/]+)/.exec(parsed.pathname);
  if (docMatch) return docMatch[1];
  return "";
}

function extractGoogleDriveConfirmDownload(html, baseUrl) {
  const uuid = /name="uuid"\s+value="([^"]+)"/i.exec(html)?.[1];
  const confirm = /name="confirm"\s+value="([^"]+)"/i.exec(html)?.[1]
    || /confirm=([0-9A-Za-z_-]+)/i.exec(html)?.[1];
  const id = /name="id"\s+value="([^"]+)"/i.exec(html)?.[1]
    || /[?&]id=([^&"']+)/i.exec(html)?.[1];
  if (confirm && id) {
    const url = new URL("https://drive.google.com/uc");
    url.searchParams.set("export", "download");
    url.searchParams.set("confirm", decodeURIComponent(confirm));
    url.searchParams.set("id", decodeURIComponent(id));
    if (uuid) url.searchParams.set("uuid", decodeURIComponent(uuid));
    return url.toString();
  }
  const href = /href="([^"]*uc\?export=download[^"]+)"/i.exec(html)?.[1]
    || /href="([^"]*\/download\?[^"]+)"/i.exec(html)?.[1];
  return href ? new URL(href.replace(/&amp;/g, "&"), baseUrl).toString() : "";
}

async function downloadGoogleDrivePublicFile(publicUrl) {
  const fileId = extractGoogleDriveFileId(publicUrl);
  const downloadUrl = fileId
    ? `https://drive.google.com/uc?export=download&id=${encodeURIComponent(fileId)}`
    : publicUrl;
  const bytes = await requestBuffer(downloadUrl, {
    headers: { Accept: "application/vnd.openxmlformats-officedocument.wordprocessingml.document,*/*" }
  });
  const firstBytes = bytes.subarray(0, 256).toString("utf8");
  if (!/^\s*</.test(firstBytes) || !/<html|<!doctype html/i.test(firstBytes)) return bytes;
  const confirmUrl = extractGoogleDriveConfirmDownload(bytes.toString("utf8"), downloadUrl);
  if (!confirmUrl) return bytes;
  return requestBuffer(confirmUrl, {
    headers: { Accept: "application/vnd.openxmlformats-officedocument.wordprocessingml.document,*/*" }
  });
}

function oneDriveShareId(publicUrl) {
  return `u!${Buffer.from(publicUrl, "utf8")
    .toString("base64")
    .replace(/=+$/g, "")
    .replace(/\//g, "_")
    .replace(/\+/g, "-")}`;
}

async function downloadOneDrivePublicFile(publicUrl) {
  const apiUrl = `https://api.onedrive.com/v1.0/shares/${oneDriveShareId(publicUrl)}/root/content`;
  return requestBuffer(apiUrl, {
    headers: { Accept: "application/vnd.openxmlformats-officedocument.wordprocessingml.document,*/*" }
  });
}

function isYandexDiskHost(host) {
  return host === "disk.yandex.ru" || host === "yadi.sk";
}

function isGoogleDriveHost(host) {
  return host === "drive.google.com" || host === "docs.google.com";
}

function isOneDriveHost(host) {
  return host === "1drv.ms"
    || host === "onedrive.live.com"
    || host.endsWith(".sharepoint.com")
    || host.endsWith("-my.sharepoint.com");
}

async function loadLocalTemplateBytes(templatePath) {
  const requestedPath = String(templatePath || "").trim();
  if (!requestedPath) throw new Error("Не указана ссылка или путь к шаблону договора.");
  const fullPath = path.isAbsolute(requestedPath)
    ? requestedPath
    : path.resolve(ROOT, requestedPath);
  const extension = path.extname(fullPath).replace(/^\./, "").toLowerCase();
  if (!WORD_TEMPLATE_EXTENSIONS.has(extension)) {
    throw new Error("Шаблон договора должен быть файлом Word.");
  }
  const stat = await fs.stat(fullPath);
  if (!stat.isFile()) throw new Error("Шаблон договора не найден.");
  if (stat.size > MAX_DOCX_BYTES) throw new Error("Шаблон договора слишком большой.");
  return fs.readFile(fullPath);
}

async function loadRemoteTemplateBytes(templateUrl) {
  const parsed = new URL(templateUrl);
  const host = parsed.hostname.toLowerCase();
  let bytes;
  if (isYandexDiskHost(host)) bytes = await downloadYandexDiskPublicFile(templateUrl);
  else if (isGoogleDriveHost(host)) bytes = await downloadGoogleDrivePublicFile(templateUrl);
  else if (isOneDriveHost(host)) bytes = await downloadOneDrivePublicFile(templateUrl);
  else bytes = await requestBuffer(templateUrl);
  if (bytes.length > MAX_DOCX_BYTES) throw new Error("Скачанный шаблон договора слишком большой.");
  return bytes;
}

async function loadTemplateBytes(templateUrl, templatePath) {
  const url = String(templateUrl || "").trim();
  if (!url) return loadLocalTemplateBytes(templatePath);
  try {
    return await loadRemoteTemplateBytes(url);
  } catch (error) {
    if (!String(templatePath || "").trim()) throw error;
    return loadLocalTemplateBytes(templatePath);
  }
}

function getWordTemplateExtension(fileName) {
  return String(fileName || "").split(".").pop()?.toLowerCase() || "";
}

function stripWordTemplateExtension(fileName) {
  return String(fileName || "").replace(/\.(?:doc|docx|docm|dot|dotx|dotm|rtf)$/i, "");
}

function parseWordTemplateDataUrl(dataUrl, fileName) {
  const extension = getWordTemplateExtension(fileName);
  if (!WORD_TEMPLATE_EXTENSIONS.has(extension)) {
    throw new Error("Выберите файл Word: doc, docx, docm, dot, dotx, dotm или rtf.");
  }
  const match = /^data:[^,]*;base64,([\s\S]+)$/i.exec(String(dataUrl || ""));
  if (!match) throw new Error("Expected Word file data URL");
  const bytes = Buffer.from(match[1], "base64");
  if (!bytes.length) throw new Error("Empty Word file");
  if (bytes.length > MAX_DOCX_BYTES) throw new Error("Шаблон договора слишком большой.");
  return bytes;
}

function buildDocumentTemplateFileName(fileName) {
  const extension = WORD_TEMPLATE_EXTENSIONS.has(getWordTemplateExtension(fileName))
    ? getWordTemplateExtension(fileName)
    : "docx";
  const base = safeNamePart(stripWordTemplateExtension(fileName || "template"), "template");
  const suffix = crypto.randomBytes(4).toString("hex");
  return `${base}_${suffix}.${extension}`;
}

function extractWordTextBlocks(xml) {
  const paragraphMatches = [...String(xml || "").matchAll(/<w:p\b[\s\S]*?<\/w:p>/g)];
  const blocks = paragraphMatches.length ? paragraphMatches.map((match) => match[0]) : [String(xml || "")];
  return blocks
    .map((block) => {
      const parts = [];
      for (const textMatch of block.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g)) {
        parts.push(decodeXmlText(textMatch[1]));
      }
      return parts.join("");
    })
    .filter(Boolean);
}

function isValidDocxTextMarkerName(value) {
  const text = String(value || "").trim();
  if (!text || text.length > 120) return false;
  return !/[\\\/&;]/.test(text);
}

function parseDocxTextMarkers(entries) {
  const markers = new Set();
  entries
    .filter((entry) => /^word\/(?:document|header\d*|footer\d*)\.xml$/i.test(entry.name))
    .forEach((entry) => {
      const xml = entry.content.toString("utf8");
      extractWordTextBlocks(xml).forEach((textBlock) => {
        for (const match of textBlock.matchAll(/#([^#<>\r\n]{1,120})#/g)) {
          const marker = match[1].trim();
          if (isValidDocxTextMarkerName(marker)) markers.add(marker);
        }
      });
    });
  return [...markers].filter(Boolean).sort((a, b) => a.localeCompare(b, "ru"));
}

function parseDocxIndexedFields(entries) {
  const fields = [];
  const seen = new Set();
  entries
    .filter((entry) => /^word\/(?:document|header\d*|footer\d*)\.xml$/i.test(entry.name))
    .forEach((entry) => {
      const xml = entry.content.toString("utf8");
      const fieldPattern = /<w:fldChar\b(?=[^>]*w:fldCharType="begin")[^>]*\/>([\s\S]*?)<w:fldChar\b(?=[^>]*w:fldCharType="separate")[^>]*\/>/g;
      for (const fieldMatch of xml.matchAll(fieldPattern)) {
        const indexedField = parseIndexedWordFieldInstruction(getComplexWordFieldInstruction(fieldMatch[1] || ""));
        if (!indexedField || seen.has(indexedField.position)) continue;
        seen.add(indexedField.position);
        fields.push({
          position: indexedField.position,
          value: indexedField.value,
          source: `${indexedField.type}-field`
        });
      }
      const simpleFieldPattern = /<w:fldSimple\b[^>]*\bw:instr="([^"]*)"[^>]*>/g;
      for (const fieldMatch of xml.matchAll(simpleFieldPattern)) {
        const indexedField = parseIndexedWordFieldInstruction(fieldMatch[1] || "");
        if (!indexedField || seen.has(indexedField.position)) continue;
        seen.add(indexedField.position);
        fields.push({
          position: indexedField.position,
          value: indexedField.value,
          source: `${indexedField.type}-field`
        });
      }
    });
  return fields.sort((left, right) => left.position - right.position);
}

function mapIndexedFieldsToDocumentProperties(indexedFields, properties) {
  const propertiesByFieldNumber = new Map();
  const propertiesByPosition = new Map();
  (Array.isArray(properties) ? properties : []).forEach((property) => {
    const fieldNumber = Number(property?.fieldNumber);
    if (Number.isFinite(fieldNumber) && fieldNumber > 0 && property?.name) {
      propertiesByFieldNumber.set(fieldNumber, property);
    }
    const position = Number(property?.position);
    if (Number.isFinite(position) && position > 0 && property?.name) {
      propertiesByPosition.set(position, property);
    }
  });
  return (Array.isArray(indexedFields) ? indexedFields : []).map((field) => {
    const property = propertiesByFieldNumber.get(Number(field.position))
      || propertiesByPosition.get(Number(field.position));
    return {
      ...field,
      name: property?.name || "",
      formula: property?.value || "",
      hideEmpty: Boolean(property?.hideEmpty),
      source: field.source || "indexed-field"
    };
  });
}

function inspectDocxTemplate(templateBytes) {
  const entries = readDocxZipEntries(templateBytes);
  const formulaProperties = getDocumentFormulaPropertiesFromEntries(entries);
  const properties = formulaProperties
    .map((property) => ({
      name: property.name,
      formula: property.value,
      isFormula: isFormulaLike(property.value),
      fieldNumber: property.fieldNumber,
      position: property.position,
      hideEmpty: Boolean(property.hideEmpty),
      source: property.source || "custom-property"
    }))
    .filter((property) => property.name);
  return {
    properties,
    subjectFields: mapIndexedFieldsToDocumentProperties(parseDocxIndexedFields(entries), formulaProperties),
    markers: parseDocxTextMarkers(entries)
  };
}

function inspectWordTemplate(templateBytes, fileName = "") {
  const extension = getWordTemplateExtension(fileName);
  if (extension && WORD_TEMPLATE_EXTENSIONS.has(extension) && !OPENXML_WORD_EXTENSIONS.has(extension)) {
    return { properties: [], markers: [], unsupportedInspection: true };
  }
  try {
    return inspectDocxTemplate(templateBytes);
  } catch (error) {
    return { properties: [], markers: [], unsupportedInspection: true, inspectionMessage: error.message };
  }
}

async function handleDocumentTemplateInspect(req, res) {
  try {
    const body = await readJsonBody(req);
    const templateBytes = await loadTemplateBytes(body.templateUrl, body.templatePath);
    sendJson(res, 200, inspectWordTemplate(templateBytes, body.fileName || body.templateUrl || body.templatePath || ""));
  } catch (error) {
    sendError(res, 400, error.message);
  }
}

async function handleDocumentTemplateUpload(req, res) {
  try {
    const body = await readJsonBody(req);
    const bytes = parseWordTemplateDataUrl(body.dataUrl, body.fileName);
    const fileName = buildDocumentTemplateFileName(body.fileName);
    const fullPath = path.join(DOCUMENT_TEMPLATE_ROOT, fileName);
    await fs.writeFile(fullPath, bytes);
    sendJson(res, 201, {
      templatePath: `storage/document-templates/${fileName}`,
      fileName,
      ...inspectWordTemplate(bytes, fileName)
    });
  } catch (error) {
    sendError(res, 400, error.message);
  }
}

async function handleContractDocument(req, res) {
  try {
    const body = await readJsonBody(req);
    const templateBytes = await loadTemplateBytes(body.templateUrl, body.templatePath);
    const inputFieldValues = body.fieldValues || {};
    const fieldValues = body.useCustomDocumentProperties
      ? applyCustomDocumentPropertyFormulas(templateBytes, inputFieldValues, body.sourceValues || {})
      : inputFieldValues;
    const propertyUpdateNames = new Set(Object.keys(inputFieldValues || {}));
    const photo = await loadContractPhoto(fieldValues);
    const result = fillDocxMarkers(templateBytes, fieldValues, photo ? { "Фото": photo } : { "Фото": null }, propertyUpdateNames);
    sendFile(
      res,
      200,
      result,
      safeDocumentFileName(body.fileName || "договор"),
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    );
  } catch (error) {
    sendError(res, 400, error.message);
  }
}

async function readJsonBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_JSON_BYTES) throw new Error("Payload is too large");
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function parseDataUrl(dataUrl) {
  const match = /^data:(image\/(png|jpeg|jpg|webp|gif));base64,([\s\S]+)$/i.exec(String(dataUrl || ""));
  if (!match) throw new Error("Expected image data URL");
  const ext = match[2].toLowerCase() === "jpeg" ? "jpg" : match[2].toLowerCase();
  const bytes = Buffer.from(match[3], "base64");
  if (!bytes.length) throw new Error("Empty image");
  return { bytes, ext, mime: match[1].toLowerCase() };
}

function safeNamePart(value, fallback) {
  const cleaned = String(value || "")
    .normalize("NFC")
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "")
    .replace(/\s+/g, "_")
    .replace(/[^\p{L}\p{N}_().-]+/gu, "")
    .replace(/_+/g, "_")
    .replace(/^[_\-.]+|[_\-.]+$/g, "")
    .slice(0, 80);
  return cleaned || fallback;
}

function safeDatePart(value) {
  const text = String(value || "").trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const date = new Date(text);
  if (!Number.isNaN(date.getTime())) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }
  return "без-даты-заявки";
}

function buildPhotoFileName(body, ext) {
  const name = safeNamePart(body.studentName || body.studentFio || body.fio || body.fullName || body.name, "без-ФИО");
  const date = safeNamePart(safeDatePart(body.applicationDate), "без-даты-заявки");
  const suffix = crypto.randomBytes(4).toString("hex");
  return `${name}_${date}_${suffix}.${ext}`;
}

function safePhotoPath(photoPath) {
  const fileName = path.basename(String(photoPath || ""));
  if (!/^[\p{L}\p{N}_().-]+\.(png|jpe?g|webp|gif)$/iu.test(fileName)) return null;
  return path.join(PHOTO_ROOT, fileName);
}

function isInsideRoot(fullPath) {
  const relativePath = path.relative(ROOT, fullPath);
  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}

async function deletePhoto(photoPath) {
  const fullPath = safePhotoPath(photoPath);
  if (!fullPath) return false;
  try {
    await fs.unlink(fullPath);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

async function handlePhotoUpload(req, res) {
  try {
    const body = await readJsonBody(req);
    const { bytes, ext } = parseDataUrl(body.dataUrl);
    if (body.previousPath) await deletePhoto(body.previousPath);
    const fileName = buildPhotoFileName(body, ext);
    const fullPath = path.join(PHOTO_ROOT, fileName);
    await fs.writeFile(fullPath, bytes);
    sendJson(res, 201, {
      photoPath: `storage/photos/${fileName}`,
      photoUrl: `/storage/photos/${encodeURIComponent(fileName)}`
    });
  } catch (error) {
    sendError(res, 400, error.message);
  }
}

async function handlePhotoDelete(req, res) {
  try {
    const body = await readJsonBody(req);
    const deleted = await deletePhoto(body.photoPath);
    sendJson(res, 200, { deleted });
  } catch (error) {
    sendError(res, 400, error.message);
  }
}

async function serveStatic(req, res) {
  const requestUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const decodedPath = decodeURIComponent(requestUrl.pathname);
  const relativePath = decodedPath === "/" ? "index.html" : decodedPath.replace(/^\/+/, "");
  const fullPath = path.resolve(ROOT, relativePath);
  if (!isInsideRoot(fullPath)) {
    sendError(res, 403, "Forbidden");
    return;
  }
  try {
    if (path.extname(fullPath).toLowerCase() === ".php") {
      sendError(res, 404, "Not found");
      return;
    }
    const stat = await fs.stat(fullPath);
    if (stat.isDirectory()) {
      res.writeHead(301, { Location: `${requestUrl.pathname.replace(/\/$/, "")}/index.html` });
      res.end();
      return;
    }
    const ext = path.extname(fullPath).toLowerCase();
    const headers = { ...CORS_HEADERS, "Content-Type": MIME_TYPES[ext] || "application/octet-stream" };
    if (decodedPath.startsWith("/storage/photos/")) headers["Cache-Control"] = "public, max-age=31536000, immutable";
    if (req.method === "HEAD") {
      res.writeHead(200, headers);
      res.end();
      return;
    }
    const file = await fs.readFile(fullPath);
    res.writeHead(200, headers);
    res.end(file);
  } catch (error) {
    if (error.code === "ENOENT") {
      sendError(res, 404, "Not found");
      return;
    }
    sendError(res, 500, error.message);
  }
}

async function route(req, res) {
  if (req.method === "OPTIONS") {
    res.writeHead(204, CORS_HEADERS);
    res.end();
    return;
  }
  if (req.method === "GET" && req.url === "/api/health") {
    sendJson(res, 200, { ok: true, storage: "storage/photos" });
    return;
  }
  if (req.method === "POST" && req.url === "/api/photos") {
    await handlePhotoUpload(req, res);
    return;
  }
  if (req.method === "DELETE" && req.url === "/api/photos") {
    await handlePhotoDelete(req, res);
    return;
  }
  if (req.method === "POST" && req.url === "/api/documents/template-inspect") {
    await handleDocumentTemplateInspect(req, res);
    return;
  }
  if (req.method === "POST" && req.url === "/api/documents/template-upload") {
    await handleDocumentTemplateUpload(req, res);
    return;
  }
  if (req.method === "POST" && req.url === "/api/contracts/student-document") {
    await handleContractDocument(req, res);
    return;
  }
  if (req.method === "POST" && req.url === "/send-mail.php") {
    sendError(res, 501, "PHP-отправщик доступен только на веб-сервере с настроенным PHP mail().");
    return;
  }
  if (req.method === "GET" || req.method === "HEAD") {
    await serveStatic(req, res);
    return;
  }
  sendError(res, 405, "Method not allowed");
}

ensureStorage()
  .then(() => {
    http.createServer((req, res) => {
      route(req, res).catch((error) => sendError(res, 500, error.message));
    }).listen(PORT, () => {
      console.log(`АИС Допобразование Web: http://localhost:${PORT}`);
      console.log(`Фото: ${PHOTO_ROOT}`);
    });
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
