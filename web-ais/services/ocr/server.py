#!/usr/bin/env python3
"""Local OCR service for Russian identity and education documents."""

from __future__ import annotations

import base64
import binascii
import csv
import difflib
import html
import io
import json
import os
import re
import subprocess
import sys
import tempfile
import time
import unicodedata
import zipfile
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

try:
    import cv2
except (ImportError, OSError):
    cv2 = None


PORT = int(os.environ.get("OCR_PORT", "8083"))
TESSERACT_BINARY = os.environ.get("OCR_TESSERACT_BINARY", "tesseract")
CONVERT_BINARY = os.environ.get("OCR_CONVERT_BINARY", "convert")
IDENTIFY_BINARY = os.environ.get("OCR_IDENTIFY_BINARY", "identify")
PDFTOPPM_BINARY = os.environ.get("OCR_PDFTOPPM_BINARY", "pdftoppm")
PDFTOTEXT_BINARY = os.environ.get("OCR_PDFTOTEXT_BINARY", "pdftotext")
MAX_REQUEST_BYTES = 36 * 1024 * 1024
MAX_FILE_BYTES = 24 * 1024 * 1024
MAX_PDF_PAGES = 20
MAX_TEXT_CHARS = 240_000
PDF_RENDER_MAX_DIMENSION = 2600
OCR_PAGE_WORKERS = max(1, min(2, int(os.environ.get("OCR_PAGE_WORKERS", "2"))))
MAX_OFFICE_ZIP_ENTRIES = 2048
MAX_OFFICE_TEXT_ENTRY_BYTES = 4 * 1024 * 1024
MAX_OFFICE_TEXT_TOTAL_BYTES = 8 * 1024 * 1024
MAX_DOCX_EMBEDDED_IMAGES = 20
MAX_DOCX_EMBEDDED_MEDIA_ENTRIES = 80
MAX_DOCX_EMBEDDED_IMAGE_BYTES = 16 * 1024 * 1024
MAX_DOCX_EMBEDDED_IMAGES_TOTAL_BYTES = 64 * 1024 * 1024
PAGE_PREVIEW_MAX_BYTES = 220 * 1024
PHOTO_CANDIDATE_MAX_BYTES = 220 * 1024
MAX_PHOTO_CANDIDATES = 8
DATE_PATTERN = re.compile(r"\b([0-3]?\d)[.\-/]([01]?\d)[.\-/]((?:19|20)?\d{2})\b")
MONTHS = {
    "января": 1,
    "февраля": 2,
    "марта": 3,
    "апреля": 4,
    "мая": 5,
    "июня": 6,
    "июля": 7,
    "августа": 8,
    "сентября": 9,
    "октября": 10,
    "ноября": 11,
    "декабря": 12,
}
FIELD_LABELS = {
    "name": "ФИО",
    "birthDate": "Дата рождения",
    "gender": "Пол",
    "citizenship": "Гражданство",
    "passportType": "Вид документа",
    "passportNumber": "Серия и номер паспорта",
    "passportDate": "Дата выдачи паспорта",
    "passportCode": "Код подразделения",
    "passportIssuer": "Кем выдан паспорт",
    "registrationAddress": "Адрес места регистрации",
    "snils": "СНИЛС",
    "inn": "ИНН",
    "educationLevel": "Уровень образования",
    "educationDocument": "Документ об образовании",
    "educationDocumentSeries": "Серия документа об образовании",
    "educationDocumentNumber": "Номер документа об образовании",
    "educationDocumentDate": "Дата выдачи документа об образовании",
    "educationDocumentIssuer": "Кем выдан документ об образовании",
    "educationSpecialty": "Специальность",
    "educationQualification": "Квалификация",
    "educationDocumentSurname": "Фамилия в документе",
    "mailingAddress": "Адрес для отправки документов",
    "phone": "Мобильный телефон",
    "email": "Адрес электронной почты",
    "workPlace": "Место работы",
    "position": "Должность",
    "program": "Программа обучения",
    "studyForm": "Форма обучения",
    "hours": "Количество часов",
    "applicationDate": "Дата подачи заявления",
    "startDate": "Дата начала обучения",
    "endDate": "Дата окончания обучения",
    "contractNo": "Номер договора",
    "contractDate": "Дата договора",
}


def run_command(arguments: list[str], timeout: int = 120) -> str:
    completed = subprocess.run(
        arguments,
        check=False,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        timeout=timeout,
    )
    if completed.returncode:
        error = completed.stderr.decode("utf-8", "replace").strip()
        raise RuntimeError(error or f"Command failed: {arguments[0]}")
    return completed.stdout.decode("utf-8", "replace")


def normalize_text(value: str) -> str:
    value = unicodedata.normalize("NFKC", value or "")
    value = value.replace("\r", "\n").replace("\x0c", "\n")
    lines = []
    for raw_line in value.splitlines():
        line = re.sub(r"[ \t]+", " ", raw_line).strip(" |_\t")
        if line:
            lines.append(line)
    return "\n".join(lines)


def merge_ocr_text(primary: str, secondary: str) -> str:
    seen: set[str] = set()
    merged: list[str] = []
    for line in normalize_text(primary + "\n" + secondary).splitlines():
        key = re.sub(r"\W+", "", line, flags=re.UNICODE).casefold()
        if not key or key in seen:
            continue
        seen.add(key)
        merged.append(line)
    return "\n".join(merged)


def decode_text_bytes(file_bytes: bytes) -> str:
    """Decode a plain-text document without replacing valid Cyrillic characters."""
    candidates: list[tuple[int, str]] = []
    for encoding in ("utf-8-sig", "utf-16", "cp1251"):
        try:
            decoded = file_bytes.decode(encoding)
        except (UnicodeDecodeError, LookupError):
            continue
        normalized = normalize_text(decoded)
        if not normalized:
            continue
        letters = len(re.findall(r"[A-Za-zА-ЯЁа-яё]", normalized))
        controls = len(re.findall(r"[\x00-\x08\x0b\x0e-\x1f]", decoded))
        candidates.append((letters * 3 - controls * 20, normalized))
    return max(candidates, key=lambda item: item[0])[1] if candidates else ""


def extract_rtf_text(file_bytes: bytes) -> str:
    source = file_bytes.decode("latin1", "replace")
    codepage_match = re.search(r"\\ansicpg(\d+)", source)
    codepage = f"cp{codepage_match.group(1)}" if codepage_match else "cp1251"

    def decode_hex(match: re.Match[str]) -> str:
        try:
            return bytes.fromhex(match.group(1)).decode(codepage, "replace")
        except (LookupError, UnicodeDecodeError, ValueError):
            return ""

    source = re.sub(r"\\'([0-9a-fA-F]{2})", decode_hex, source)

    def decode_unicode(match: re.Match[str]) -> str:
        value = int(match.group(1))
        if value < 0:
            value += 65536
        try:
            return chr(value)
        except ValueError:
            return ""

    source = re.sub(r"\\u(-?\d+)\??", decode_unicode, source)
    source = re.sub(r"\\(?:par|line|page)\b", "\n", source)
    source = re.sub(r"\\tab\b", "\t", source)
    source = re.sub(r"\{\\\*[^{}]*\}", " ", source)
    source = re.sub(r"\\[a-zA-Z]+-?\d*\s?", "", source)
    source = source.replace(r"\{", "{").replace(r"\}", "}").replace(r"\\", "\\")
    source = source.replace("{", " ").replace("}", " ")
    return normalize_text(source)


def read_safe_office_zip_member(
    archive: zipfile.ZipFile,
    info: zipfile.ZipInfo,
    max_bytes: int,
) -> bytes:
    if info.flag_bits & 0x1:
        raise ValueError("Зашифрованные элементы DOCX не поддерживаются.")
    if info.file_size < 0 or info.file_size > max_bytes:
        raise ValueError("Элемент DOCX после распаковки превышает допустимый размер.")
    with archive.open(info, "r") as source:
        content = source.read(max_bytes + 1)
    if len(content) > max_bytes or len(content) != info.file_size:
        raise ValueError("Некорректный размер распакованного элемента DOCX.")
    return content


def validate_office_zip(archive: zipfile.ZipFile) -> list[zipfile.ZipInfo]:
    entries = archive.infolist()
    if len(entries) > MAX_OFFICE_ZIP_ENTRIES:
        raise ValueError("DOCX содержит слишком много вложенных файлов.")
    return entries


def extract_openxml_text(file_bytes: bytes, mime_type: str) -> str:
    try:
        with zipfile.ZipFile(io.BytesIO(file_bytes)) as archive:
            entries = validate_office_zip(archive)
            if mime_type == "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
                selected = [
                    info
                    for info in entries
                    if re.fullmatch(r"word/(?:document|header\d+|footer\d+)\.xml", info.filename)
                ]
            else:
                selected = [info for info in entries if info.filename == "content.xml"]
            blocks: list[str] = []
            total_bytes = 0
            for info in selected:
                content = read_safe_office_zip_member(archive, info, MAX_OFFICE_TEXT_ENTRY_BYTES)
                total_bytes += len(content)
                if total_bytes > MAX_OFFICE_TEXT_TOTAL_BYTES:
                    raise ValueError("Текстовый слой DOCX превышает допустимый размер.")
                xml = content.decode("utf-8", "replace")
                xml = re.sub(r"<w:(?:br|cr|tab)\b[^>]*/?>", "\n", xml, flags=re.IGNORECASE)
                xml = re.sub(r"</(?:w:p|text:p|text:h)>", "\n", xml, flags=re.IGNORECASE)
                xml = re.sub(r"<[^>]+>", "", xml)
                blocks.append(html.unescape(xml))
            return normalize_text("\n".join(blocks))
    except (KeyError, OSError, ValueError, zipfile.BadZipFile):
        return ""


def embedded_image_extension(content: bytes) -> str:
    if content.startswith(b"\xff\xd8\xff"):
        return ".jpg"
    if content.startswith(b"\x89PNG\r\n\x1a\n"):
        return ".png"
    if content.startswith((b"II*\x00", b"MM\x00*")):
        return ".tif"
    if content.startswith(b"BM"):
        return ".bmp"
    if content.startswith((b"GIF87a", b"GIF89a")):
        return ".gif"
    if len(content) >= 12 and content.startswith(b"RIFF") and content[8:12] == b"WEBP":
        return ".webp"
    return ""


def extract_docx_embedded_images(file_bytes: bytes, workdir: Path) -> list[Path]:
    try:
        with zipfile.ZipFile(io.BytesIO(file_bytes)) as archive:
            entries = validate_office_zip(archive)
            media_entries = [
                info
                for info in entries
                if not info.is_dir()
                and re.fullmatch(r"word/media/[^/]+", info.filename.replace("\\", "/"), re.IGNORECASE)
            ]
            media_entries.sort(key=lambda info: [
                int(part) if part.isdigit() else part.casefold()
                for part in re.split(r"(\d+)", info.filename)
            ])
            result: list[Path] = []
            total_bytes = 0
            for info in media_entries[:MAX_DOCX_EMBEDDED_MEDIA_ENTRIES]:
                if len(result) >= MAX_DOCX_EMBEDDED_IMAGES:
                    break
                content = read_safe_office_zip_member(archive, info, MAX_DOCX_EMBEDDED_IMAGE_BYTES)
                total_bytes += len(content)
                if total_bytes > MAX_DOCX_EMBEDDED_IMAGES_TOTAL_BYTES:
                    raise ValueError("Встроенные изображения DOCX превышают допустимый общий размер.")
                extension = embedded_image_extension(content)
                if not extension:
                    continue
                target = workdir / f"docx-page-{len(result) + 1:03d}{extension}"
                target.write_bytes(content)
                result.append(target)
            return result
    except (KeyError, OSError, zipfile.BadZipFile) as error:
        raise ValueError("Не удалось прочитать встроенные изображения DOCX.") from error


def extract_text_document(file_bytes: bytes, mime_type: str) -> str:
    if mime_type in {"text/plain", "text/csv"}:
        return decode_text_bytes(file_bytes)
    if mime_type == "application/rtf":
        return extract_rtf_text(file_bytes)
    if mime_type in {
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/vnd.oasis.opendocument.text",
    }:
        return extract_openxml_text(file_bytes, mime_type)
    return ""


def is_usable_text_layer(value: str) -> bool:
    normalized = normalize_text(value)
    letters = len(re.findall(r"[A-Za-zА-ЯЁа-яё]", normalized))
    replacement_count = normalized.count("\ufffd")
    return len(normalized) >= 40 and letters >= 20 and replacement_count <= max(2, len(normalized) // 200)


def extract_pdf_text_pages(source_path: Path) -> list[str]:
    try:
        completed = subprocess.run(
            [
                PDFTOTEXT_BINARY,
                "-f",
                "1",
                "-l",
                str(MAX_PDF_PAGES),
                "-enc",
                "UTF-8",
                "-layout",
                str(source_path),
                "-",
            ],
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=60,
        )
        if completed.returncode:
            return []
        decoded = completed.stdout.decode("utf-8", "replace")
        return [normalize_text(page) for page in decoded.split("\x0c")]
    except (OSError, subprocess.SubprocessError):
        return []


def tesseract_text(
    image_path: Path,
    page_segmentation_mode: int,
    languages: str = "rus+eng",
    whitelist: str = "",
    timeout: int = 90,
) -> str:
    arguments = [
        TESSERACT_BINARY,
        str(image_path),
        "stdout",
        "-l",
        languages,
        "--oem",
        "1",
        "--psm",
        str(page_segmentation_mode),
        "-c",
        "preserve_interword_spaces=1",
    ]
    if whitelist:
        arguments.extend(["-c", f"tessedit_char_whitelist={whitelist}"])
    return run_command(arguments, timeout=timeout)


def parse_tesseract_words(tsv_text: str) -> list[dict[str, Any]]:
    words: list[dict[str, Any]] = []
    for row in csv.DictReader(io.StringIO(tsv_text or ""), delimiter="\t"):
        text = str(row.get("text") or "").strip()
        if not text or str(row.get("level") or "") != "5":
            continue
        try:
            left = int(row.get("left") or 0)
            top = int(row.get("top") or 0)
            width = int(row.get("width") or 0)
            height = int(row.get("height") or 0)
            confidence = float(row.get("conf") or -1)
        except (TypeError, ValueError):
            continue
        if width <= 0 or height <= 0:
            continue
        words.append({
            "text": text,
            "left": left,
            "top": top,
            "width": width,
            "height": height,
            "confidence": confidence,
            "lineKey": (
                int(row.get("block_num") or 0),
                int(row.get("par_num") or 0),
                int(row.get("line_num") or 0),
            ),
        })
    return words


def tesseract_text_with_words(
    image_path: Path,
    page_segmentation_mode: int,
    languages: str = "rus+eng",
    timeout: int = 90,
) -> tuple[str, list[dict[str, Any]]]:
    output_base = image_path.with_name(f"{image_path.stem}-ocr-{page_segmentation_mode}")
    run_command(
        [
            TESSERACT_BINARY,
            str(image_path),
            str(output_base),
            "-l",
            languages,
            "--oem",
            "1",
            "--psm",
            str(page_segmentation_mode),
            "-c",
            "preserve_interword_spaces=1",
            "txt",
            "tsv",
        ],
        timeout=timeout,
    )
    text_path = output_base.with_suffix(".txt")
    tsv_path = output_base.with_suffix(".tsv")
    text = text_path.read_text(encoding="utf-8", errors="replace") if text_path.exists() else ""
    tsv_text = tsv_path.read_text(encoding="utf-8", errors="replace") if tsv_path.exists() else ""
    return text, parse_tesseract_words(tsv_text)


def ocr_image(
    image_path: Path,
    *,
    try_snils_rotations: bool = False,
) -> tuple[str, Path, list[dict[str, Any]]]:
    processed_path = image_path.with_name(f"{image_path.stem}-prepared.png")
    run_command(
        [
            CONVERT_BINARY,
            str(image_path),
            "-auto-orient",
            "-strip",
            "-colorspace",
            "Gray",
            "-resize",
            "2600x2600>",
            "-contrast-stretch",
            "1%x1%",
            "-sharpen",
            "0x0.8",
            str(processed_path),
        ],
        timeout=60,
    )
    primary, words = tesseract_text_with_words(processed_path, 11)
    secondary = ""
    primary_normalized = normalize_text(primary)
    if len(primary_normalized) < 40:
        secondary = tesseract_text(processed_path, 6)
    best_text = merge_ocr_text(primary, secondary)
    best_path = processed_path
    best_words = words
    best_score = snils_ocr_text_score(best_text) if try_snils_rotations else 0
    if try_snils_rotations and best_score < 250:
        for angle in (90, 270, 180):
            rotated_path = image_path.with_name(f"{image_path.stem}-prepared-{angle}.png")
            run_command(
                [
                    CONVERT_BINARY,
                    str(processed_path),
                    "-rotate",
                    str(angle),
                    str(rotated_path),
                ],
                timeout=60,
            )
            rotated_primary, rotated_words = tesseract_text_with_words(rotated_path, 11)
            rotated_secondary = ""
            if len(normalize_text(rotated_primary)) < 40:
                rotated_secondary = tesseract_text(rotated_path, 6)
            rotated_text = merge_ocr_text(rotated_primary, rotated_secondary)
            rotated_score = snils_ocr_text_score(rotated_text)
            if rotated_score > best_score:
                best_text = rotated_text
                best_path = rotated_path
                best_words = rotated_words
                best_score = rotated_score
            if best_score >= 250:
                break
    return best_text, best_path, best_words


def render_pages(source_path: Path, mime_type: str, workdir: Path) -> list[Path]:
    if mime_type == "application/pdf":
        prefix = workdir / "page"
        run_command(
            [
                PDFTOPPM_BINARY,
                "-f",
                "1",
                "-l",
                str(MAX_PDF_PAGES),
                "-scale-to",
                str(PDF_RENDER_MAX_DIMENSION),
                "-jpeg",
                "-jpegopt",
                "quality=92",
                str(source_path),
                str(prefix),
            ],
            timeout=90,
        )
        pages = sorted(
            workdir.glob("page-*.jpg"),
            key=lambda item: int(re.search(r"(\d+)$", item.stem).group(1)),
        )
        if not pages:
            raise RuntimeError("PDF не содержит страниц, доступных для распознавания.")
        return pages
    return [source_path]


def image_dimensions(image_path: Path) -> tuple[int, int]:
    output = run_command(
        [IDENTIFY_BINARY, "-format", "%w %h", str(image_path)],
        timeout=20,
    )
    width, height = (int(value) for value in output.strip().split())
    return width, height


def crop_ocr_region(
    image_path: Path,
    region_name: str,
    box: tuple[float, float, float, float],
    *,
    psm: int,
    languages: str = "rus+eng",
    whitelist: str = "",
    normalize: bool = False,
    resize_percent: int = 100,
) -> str:
    width, height = image_dimensions(image_path)
    left = max(0, round(width * box[0]))
    top = max(0, round(height * box[1]))
    crop_width = min(width - left, max(1, round(width * box[2])))
    crop_height = min(height - top, max(1, round(height * box[3])))
    target = image_path.with_name(f"{image_path.stem}-{region_name}.png")
    arguments = [
        CONVERT_BINARY,
        str(image_path),
        "-crop",
        f"{crop_width}x{crop_height}+{left}+{top}",
        "+repage",
        "-strip",
    ]
    if normalize:
        arguments.extend(["-colorspace", "Gray", "-normalize", "-sharpen", "0x1"])
    if resize_percent != 100:
        arguments.extend(["-resize", f"{resize_percent}%"])
    arguments.append(str(target))
    run_command(arguments, timeout=40)
    return tesseract_text(
        target,
        psm,
        languages=languages,
        whitelist=whitelist,
        timeout=45,
    )


def ocr_passport_regions(image_path: Path) -> str:
    issuer = crop_ocr_region(
        image_path,
        "passport-issuer",
        (0.154, 0.073, 0.718, 0.073),
        psm=7,
    )
    issue_date = crop_ocr_region(
        image_path,
        "passport-date",
        (0.154, 0.162, 0.41, 0.115),
        psm=6,
        languages="eng",
        whitelist="0123456789.-/",
    )
    department_code = crop_ocr_region(
        image_path,
        "passport-code",
        (0.641, 0.162, 0.282, 0.115),
        psm=7,
        languages="eng",
        whitelist="0123456789-",
    )
    identity = crop_ocr_region(
        image_path,
        "passport-identity",
        (0.23, 0.462, 0.718, 0.385),
        psm=11,
        normalize=True,
    )
    mrz = crop_ocr_region(
        image_path,
        "passport-mrz",
        (0.013, 0.898, 0.974, 0.066),
        psm=7,
        languages="eng",
        whitelist="ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<",
        resize_percent=200,
    )
    return normalize_text(
        f"Паспорт выдан: {issuer}\n"
        f"Дата выдачи паспорта: {issue_date}\n"
        f"Код подразделения: {department_code}\n"
        f"{identity}\n"
        f"MRZ: {mrz}"
    )


def ocr_passport_registration_region(image_path: Path) -> str:
    registration = crop_ocr_region(
        image_path,
        "passport-registration",
        (0.045, 0.02, 0.91, 0.61),
        psm=6,
        normalize=True,
        resize_percent=170,
    )
    sparse_registration = crop_ocr_region(
        image_path,
        "passport-registration-sparse",
        (0.045, 0.02, 0.91, 0.61),
        psm=11,
        normalize=True,
        resize_percent=170,
    )
    return normalize_text(
        "Место жительства\n"
        + merge_ocr_text(registration, sparse_registration)
    )


def only_digits(value: str) -> str:
    translations = str.maketrans(
        {
            "O": "0",
            "o": "0",
            "О": "0",
            "о": "0",
            "I": "1",
            "i": "1",
            "l": "1",
            "|": "1",
            "Z": "2",
            "z": "2",
            "З": "3",
            "з": "3",
            "S": "5",
            "s": "5",
            "Б": "6",
            "б": "6",
            "B": "8",
        }
    )
    return re.sub(r"\D", "", str(value or "").translate(translations))


def is_valid_mrz_check(value: str, check_digit: str) -> bool:
    digits = only_digits(value)
    check = only_digits(check_digit)
    if len(digits) != len(value) or len(check) != 1:
        return False
    weights = (7, 3, 1)
    return sum(int(item) * weights[index % 3] for index, item in enumerate(digits)) % 10 == int(check)


def recover_mrz_digits(value: str, check_digit: str) -> list[str]:
    alternatives = {
        "O": ("0",),
        "Q": ("0",),
        "D": ("0",),
        "I": ("1",),
        "L": ("1",),
        "Z": ("2", "3"),
        "S": ("5",),
        "G": ("6",),
        "B": ("8",),
    }
    candidates = [""]
    for character in str(value or "").upper():
        choices = (character,) if character.isdigit() else alternatives.get(character, ())
        if not choices:
            return []
        candidates = [prefix + choice for prefix in candidates for choice in choices]
        if len(candidates) > 32:
            return []
    return [candidate for candidate in candidates if is_valid_mrz_check(candidate, check_digit)]


def parse_mrz_birth_date(value: str) -> str:
    digits = only_digits(value)
    if len(digits) != 6:
        return ""
    year_short = int(digits[:2])
    current_short_year = date.today().year % 100
    year = 2000 + year_short if year_short <= current_short_year else 1900 + year_short
    try:
        parsed = date(year, int(digits[2:4]), int(digits[4:6]))
    except ValueError:
        return ""
    return parsed.isoformat()


def normalize_passport_issuer(value: str) -> str:
    source = re.sub(r"\s+", " ", str(value or "")).strip(" <>|_=.,;:-")
    translations = str.maketrans({
        "A": "А",
        "B": "В",
        "C": "С",
        "E": "Е",
        "H": "Н",
        "K": "К",
        "M": "М",
        "O": "О",
        "P": "Р",
        "T": "Т",
        "X": "Х",
        "Y": "У",
        "a": "а",
        "c": "с",
        "e": "е",
        "o": "о",
        "p": "р",
        "x": "х",
        "y": "у",
        "r": "г",
    })
    source = source.translate(translations).upper()
    source = re.sub(r"\bВЫ[ДЛ]АН\b.*$", "", source, flags=re.IGNORECASE).strip(" <>|_=.,;:-")
    authority = re.search(
        r"(?:(?:ГУ|УМВД|ОМВД|МВД|УФМС|ФМС|ОВД|ОТДЕЛ(?:ЕНИЕ|ОМ)?|УПРАВЛЕНИЕ)\b.*)",
        source,
        re.IGNORECASE,
    )
    if authority:
        source = authority.group(0)
    return re.sub(r"\s+", " ", source).strip(" <>|_=.,;:-")


def is_plausible_passport_issuer(value: str) -> bool:
    return bool(re.search(
        r"\b(?:ГУ|УМВД|ОМВД|МВД|УФМС|ФМС|ОВД|ОТДЕЛ(?:ЕНИЕ|ОМ)?|УПРАВЛЕНИЕ)\b",
        str(value or ""),
        re.IGNORECASE,
    ))


def passport_name_part(
    lines: list[str],
    label_pattern: str,
    *,
    prefer_previous: bool = False,
) -> tuple[str, str]:
    pattern = re.compile(label_pattern, re.IGNORECASE)
    excluded = {
        "фамилия",
        "имя",
        "отчество",
        "пол",
        "жен",
        "муж",
        "место",
        "рождения",
        "гор",
    }
    for index, line in enumerate(lines):
        match = pattern.search(line)
        if not match:
            continue
        tail = re.sub(r"^[\s:.,-]+", "", line[match.end():])
        indexes = [index - 1, index + 1, index - 2, index + 2] if prefer_previous else [
            index + 1,
            index - 1,
            index + 2,
            index - 2,
        ]
        candidates = [(tail, line)] if tail else []
        candidates.extend(
            (lines[candidate_index], f"{line} {lines[candidate_index]}")
            for candidate_index in indexes
            if 0 <= candidate_index < len(lines)
        )
        for candidate, evidence in candidates:
            words = re.findall(r"[А-ЯЁ][А-ЯЁа-яё-]{1,}", candidate)
            if len(words) != 1 or words[0].casefold() in excluded:
                continue
            return clean_person_part(words[0]), evidence
    return "", ""


def extract_passport_mrz(
    text: str,
    fields: dict[str, dict[str, Any]],
) -> None:
    for raw_line in normalize_text(text).splitlines():
        compact = re.sub(r"[^A-Z0-9<]", "", raw_line.upper())
        match = re.search(
            r"([A-Z0-9]{9})([A-Z0-9])RUS([A-Z0-9]{6})([A-Z0-9])([MF])<{3,}([A-Z0-9<]+)",
            compact,
        )
        if not match:
            continue
        document_number, document_check, birth, birth_check, gender, optional = match.groups()
        document_candidates = recover_mrz_digits(document_number, document_check)
        optional_digits = only_digits(optional)
        if (
            document_candidates
            and optional_digits
        ):
            document_digits = document_candidates[0]
            full_number = f"{document_digits[:3]}{optional_digits[0]}{document_digits[3:]}"
            add_field(
                fields,
                "passportNumber",
                f"{full_number[:2]} {full_number[2:4]} {full_number[4:]}",
                0.99,
                raw_line,
            )
        for birth_digits in recover_mrz_digits(birth, birth_check):
            birth_date = parse_mrz_birth_date(birth_digits)
            if birth_date:
                add_field(fields, "birthDate", birth_date, 0.99, raw_line)
                break
        add_field(
            fields,
            "gender",
            "Женский" if gender == "F" else "Мужской",
            0.98,
            raw_line,
        )
        break


def is_valid_inn(value: str) -> bool:
    digits = only_digits(value)
    if len(digits) not in (10, 12):
        return False
    numbers = [int(item) for item in digits]

    def checksum(weights: list[int]) -> int:
        return sum(weight * numbers[index] for index, weight in enumerate(weights)) % 11 % 10

    if len(numbers) == 10:
        return checksum([2, 4, 10, 3, 5, 9, 4, 6, 8]) == numbers[9]
    return (
        checksum([7, 2, 4, 10, 3, 5, 9, 4, 6, 8]) == numbers[10]
        and checksum([3, 7, 2, 4, 10, 3, 5, 9, 4, 6, 8]) == numbers[11]
    )


def is_valid_snils(value: str) -> bool:
    digits = only_digits(value)
    if len(digits) != 11:
        return False
    checksum = sum(int(digits[index]) * (9 - index) for index in range(9))
    expected = checksum if checksum < 100 else 0 if checksum in (100, 101) else checksum % 101
    if expected == 100:
        expected = 0
    return expected == int(digits[9:])


def format_snils(value: str) -> str:
    digits = only_digits(value)
    if len(digits) != 11:
        return digits
    return f"{digits[:3]}-{digits[3:6]}-{digits[6:9]} {digits[9:]}"


SNILS_GROUPED_PATTERN = re.compile(
    r"(?<![0-9A-Za-zА-Яа-яЁё])"
    r"([0-9OОЗзБбS]{2,3})\D{1,3}([0-9OОЗзБбS]{3})\D{1,3}"
    r"([0-9OОЗзБбS]{3})\D{1,3}([0-9OОЗзБбS]{2})"
    r"(?![0-9A-Za-zА-Яа-яЁё])"
)


def recover_snils(value: str) -> tuple[str, bool]:
    """Return an exact or uniquely checksum-corrected OCR value."""
    digits = only_digits(value)
    if len(digits) != 11:
        return "", False
    if is_valid_snils(digits):
        return format_snils(digits), False
    recovered = {
        candidate
        # The last two digits are the control number, so use them to repair a
        # single OCR error in the nine-digit account number, not vice versa.
        for index in range(9)
        for replacement in "0123456789"
        if replacement != digits[index]
        for candidate in (digits[:index] + replacement + digits[index + 1:],)
        if is_valid_snils(candidate)
    }
    if len(recovered) == 1:
        return format_snils(recovered.pop()), True
    return "", False


def snils_candidates(
    value: str,
    *,
    allow_missing_leading_zero: bool = False,
) -> list[tuple[str, str, bool]]:
    candidates: list[tuple[str, str, bool]] = []
    for match in SNILS_GROUPED_PATTERN.finditer(str(value or "")):
        groups = match.groups()
        if len(only_digits(groups[0])) == 2 and not allow_missing_leading_zero:
            continue
        first_group = only_digits(groups[0]).zfill(3)
        raw = format_snils(first_group + "".join(groups[1:]))
        recovered, corrected = recover_snils(raw)
        candidates.append((raw, recovered, corrected))
    return candidates


def snils_ocr_text_score(value: str) -> int:
    source = normalize_text(value)
    folded = source.casefold()
    score = min(len(re.findall(r"[А-ЯЁа-яё]{3,}", source)), 30)
    score += 100 * sum(marker in folded for marker in ("снилс", "страхов", "пенсион"))
    for raw, recovered, corrected in snils_candidates(
        source,
        allow_missing_leading_zero=True,
    ):
        if recovered:
            score += 180 if not corrected else 130
        elif len(only_digits(raw)) == 11:
            score += 30
    return score


def parse_date(value: str) -> str:
    numeric = DATE_PATTERN.search(value or "")
    if numeric:
        day, month, year = (int(item) for item in numeric.groups())
        if year < 100:
            year += 2000 if year < 30 else 1900
        if 1 <= day <= 31 and 1 <= month <= 12 and 1900 <= year <= 2100:
            return f"{year:04d}-{month:02d}-{day:02d}"
    named = re.search(
        r"\b([0-3]?\d)\s+(" + "|".join(MONTHS) + r")\s+((?:19|20)?\d{2})\b",
        str(value or "").casefold(),
    )
    if named:
        day = int(named.group(1))
        month = MONTHS[named.group(2)]
        year = int(named.group(3))
        if year < 100:
            year += 2000 if year < 30 else 1900
        if 1 <= day <= 31:
            return f"{year:04d}-{month:02d}-{day:02d}"
    return ""


def nearby_text(lines: list[str], index: int, radius: int = 1) -> str:
    start = max(0, index - radius)
    end = min(len(lines), index + radius + 1)
    return " ".join(lines[start:end])


def find_labeled_date(lines: list[str], labels: tuple[str, ...]) -> tuple[str, str]:
    for index, line in enumerate(lines):
        folded = line.casefold()
        if not any(label in folded for label in labels):
            continue
        for end_index in range(index, min(len(lines), index + 5)):
            sample = " ".join(lines[index:end_index + 1])
            parsed = parse_date(sample)
            if parsed:
                return parsed, sample
        for start_index in range(index - 1, max(-1, index - 3), -1):
            sample = " ".join(lines[start_index:index + 1])
            parsed = parse_date(sample)
            if parsed:
                return parsed, sample
    return "", ""


def clean_person_part(value: str) -> str:
    words = re.findall(r"[А-ЯЁA-Z][А-ЯЁA-Zа-яёa-z-]{1,}", value or "")
    if not words:
        return ""
    return " ".join(word[:1].upper() + word[1:].lower() for word in words[:4])


def value_after_label(lines: list[str], label_pattern: str) -> tuple[str, str]:
    pattern = re.compile(label_pattern, re.IGNORECASE)
    for index, line in enumerate(lines):
        match = pattern.search(line)
        if not match:
            continue
        tail = re.sub(r"^[\s:.,-]+", "", line[match.end():])
        if tail:
            return tail, line
        if index + 1 < len(lines):
            return lines[index + 1], f"{line} {lines[index + 1]}"
    return "", ""


EDUCATION_SURNAME_STOP_WORDS = {
    "фамилия",
    "имя",
    "отчество",
    "выпускник",
    "выпускника",
    "обладатель",
    "обладателя",
    "студент",
    "студента",
    "гражданин",
    "гражданину",
    "гражданка",
    "гражданке",
    "диплом",
    "приложение",
    "документ",
    "образование",
    "образовании",
    "квалификация",
    "специальность",
    "регистрационный",
    "номер",
    "дата",
    "выдачи",
    "российская",
    "федерация",
    "университет",
    "институт",
    "академия",
    "колледж",
    "техникум",
}


def normalize_education_surname_candidate(value: str) -> str:
    words = re.findall(r"[А-ЯЁ][А-ЯЁа-яё-]{1,39}", str(value or ""), re.IGNORECASE)
    for word in words:
        folded = word.casefold()
        if folded in EDUCATION_SURNAME_STOP_WORDS or len(folded) < 3:
            continue
        return clean_person_part(word)
    return ""


def extract_education_surname(
    text: str,
    lines: list[str],
    fields: dict[str, dict[str, Any]],
) -> None:
    label_pattern = re.compile(
        r"\bфамили[яи]\b(?:\s+(?:выпускника|обладателя|студента))?\s*[:.\-–—]?\s*(.*)$",
        re.IGNORECASE,
    )
    for index, line in enumerate(lines):
        label_match = label_pattern.search(line)
        if not label_match:
            continue
        tail = label_match.group(1).strip()
        if re.search(r"\b(?:имя|отчество)\b", tail, re.IGNORECASE):
            tail = ""
        surname = normalize_education_surname_candidate(tail)
        evidence = line
        if not surname:
            for candidate_line in lines[index + 1:index + 4]:
                if not candidate_line.strip():
                    continue
                if re.match(r"^\s*(?:имя|отчество)\b", candidate_line, re.IGNORECASE):
                    break
                surname = normalize_education_surname_candidate(candidate_line)
                if surname:
                    evidence = f"{line} {candidate_line}"
                    break
        if surname:
            add_field(fields, "educationDocumentSurname", surname, 0.96, evidence)
            return

    testimony_match = re.search(
        r"(?:свидетельствует\s+о\s+том,?\s+что|удостоверяет,?\s+что|подтверждает,?\s+что|"
        r"(?:настоящий\s+)?диплом\s+выдан(?:а)?)\s+"
        r"(?:гражданину|гражданке)?\s*([А-ЯЁ][А-ЯЁа-яё-]+)\s+"
        r"([А-ЯЁ][А-ЯЁа-яё-]+)(?:\s+([А-ЯЁ][А-ЯЁа-яё-]+))?",
        text,
        re.IGNORECASE,
    )
    if testimony_match:
        surname = normalize_education_surname_candidate(testimony_match.group(1))
        if surname:
            add_field(fields, "educationDocumentSurname", surname, 0.84, testimony_match.group(0))


def classify_document(text: str, file_name: str) -> list[str]:
    source = f"{file_name}\n{text}".casefold()
    scores = {
        "passport": sum(marker in source for marker in (
            "паспорт", "passport", "российская федерация", "код подразделения", "место рождения"
        )),
        "snils": sum(marker in source for marker in (
            "снилс", "страховое свидетельство", "индивидуального лицевого счета"
        )),
        "inn": sum(marker in source for marker in (
            "инн", "идентификационный номер налогоплательщика", "налоговом органе"
        )),
        "education": sum(marker in source for marker in (
            "диплом", "документ об образовании", "квалификац", "специальност"
        )),
        "application": sum(marker in source for marker in (
            "заявление поступающего", "персональные данные", "дата подачи заявления"
        )),
        "contract": sum(marker in source for marker in (
            "договор №", "предмет договора", "стороны заключили настоящий договор"
        )),
    }
    return [name for name, score in scores.items() if score > 0]


def add_field(
    fields: dict[str, dict[str, Any]],
    key: str,
    value: str,
    confidence: float,
    evidence: str,
) -> None:
    cleaned = re.sub(r"\s+", " ", str(value or "")).strip(" ,;:-")
    if not cleaned:
        return
    candidate = {
        "key": key,
        "label": FIELD_LABELS[key],
        "value": cleaned[:2000],
        "confidence": round(max(0.0, min(1.0, confidence)), 2),
        "evidence": re.sub(r"\s+", " ", evidence or "").strip()[:280],
    }
    current = fields.get(key)
    if current is None or candidate["confidence"] > current["confidence"]:
        fields[key] = candidate


def extract_address_after_label(
    lines: list[str],
    label_pattern: str,
    stop_pattern: str,
) -> tuple[str, str]:
    label = re.compile(label_pattern, re.IGNORECASE)
    stop = re.compile(stop_pattern, re.IGNORECASE)
    address_marker = re.compile(
        r"(?:\b\d{6}\b|\bг\.|\bгород\b|\bул\.|\bулиц|\bпр-?кт|\bпроспект|"
        r"\bд\.|\bдом\b|\bкв\.|\bквартир|\bобл\.|\bобласт|\bкрай\b|\bрайон)",
        re.IGNORECASE,
    )
    for index, line in enumerate(lines):
        if not label.search(line):
            continue
        candidates: list[str] = []
        evidence = [line]
        for candidate in lines[index + 1:index + 12]:
            if stop.search(candidate):
                break
            evidence.append(candidate)
            folded = candidate.casefold()
            has_postal_address = bool(re.search(r"\b\d{6}\b", candidate))
            if (
                (candidate.startswith("(") and not has_postal_address)
                or "гражданство" in folded
                or "паспорту" in folded
                or ("например" in folded and not has_postal_address)
            ):
                continue
            if address_marker.search(candidate) and re.search(r"\d", candidate):
                value = candidate.strip(" ,;")
                value_start = re.search(r"(?:\b\d{6}\b|\bг\.)", value, re.IGNORECASE)
                if value_start:
                    value = value[value_start.start():].strip(" ,;")
                candidates.append(value)
        if candidates:
            value = max(candidates, key=len)
            return value, " ".join(evidence)
    return "", ""


def extract_application_fields(
    text: str,
    lines: list[str],
    fields: dict[str, dict[str, Any]],
) -> None:
    surname, surname_evidence = value_after_label(lines, r"^\s*фамили[яи]\b")
    first_name, first_name_evidence = value_after_label(lines, r"^\s*им[яи]\b")
    patronymic, patronymic_evidence = value_after_label(lines, r"^\s*отчеств[оа]\b")
    name_parts = [clean_person_part(value) for value in (surname, first_name, patronymic)]
    full_name = " ".join(value for value in name_parts if value)
    if len(name_parts[0]) >= 2 and len(name_parts[1]) >= 2:
        add_field(
            fields,
            "name",
            full_name,
            0.99,
            " ".join((surname_evidence, first_name_evidence, patronymic_evidence)),
        )

    birth_date, birth_evidence = find_labeled_date(lines, ("дата рождения",))
    if birth_date:
        add_field(fields, "birthDate", birth_date, 0.99, birth_evidence)

    citizenship, citizenship_evidence = value_after_label(lines, r"^\s*гражданство\b")
    if citizenship:
        add_field(fields, "citizenship", citizenship, 0.98, citizenship_evidence)

    registration_address, registration_evidence = extract_address_after_label(
        lines,
        r"адрес\s+постоянного\s+места|жительств[ао]\s*\(регистрац",
        r"адрес\s+для\s+отправки|мобильн\w*\s+телефон|электронн\w*\s+почт",
    )
    if registration_address:
        add_field(fields, "registrationAddress", registration_address, 0.98, registration_evidence)

    mailing_address, mailing_evidence = extract_address_after_label(
        lines,
        r"адрес\s+для\s+отправки\s+документ",
        r"мобильн\w*\s+телефон|электронн\w*\s+почт|снилс",
    )
    if mailing_address:
        add_field(fields, "mailingAddress", mailing_address, 0.98, mailing_evidence)

    phone_match = re.search(
        r"(?:мобильн\w*\s+телефон|телефон)\s*[:.]?\s*(\+?\d[\d\s()\-]{8,18}\d)",
        text,
        re.IGNORECASE,
    )
    if phone_match:
        phone = "+" + only_digits(phone_match.group(1)) if phone_match.group(1).strip().startswith("+") else only_digits(phone_match.group(1))
        add_field(fields, "phone", phone, 0.99, phone_match.group(0))

    email_match = re.search(
        r"(?:адрес\s+электронной\s+почты|e-?mail)\s*[:.]?\s*"
        r"([A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,})",
        text,
        re.IGNORECASE,
    )
    if email_match:
        add_field(fields, "email", email_match.group(1).lower(), 0.99, email_match.group(0))

    passport_type, passport_type_evidence = value_after_label(lines, r"^\s*вид\s+документа\b")
    if passport_type:
        add_field(fields, "passportType", passport_type, 0.99, passport_type_evidence)
    passport_number_match = re.search(
        r"(?:серия\s*,?\s*номер|паспорт\s*:)\s*([0-9]{2})\s*([0-9]{2})\s*([0-9]{6})",
        text,
        re.IGNORECASE,
    )
    if passport_number_match:
        passport_number = " ".join(passport_number_match.groups())
        add_field(fields, "passportNumber", passport_number, 0.99, passport_number_match.group(0))
    passport_date, passport_date_evidence = find_labeled_date(lines, ("дата выдачи",))
    if passport_date:
        add_field(fields, "passportDate", passport_date, 0.98, passport_date_evidence)
    passport_issuer, passport_issuer_evidence = value_after_label(lines, r"^\s*кем\s+выдан\b")
    normalized_issuer = normalize_passport_issuer(passport_issuer)
    if not re.search(r"\b(?:МВД|ФМС|ОВД|ОТДЕЛ|УПРАВЛЕНИЕ)\b", normalized_issuer, re.IGNORECASE):
        normalized_issuer = ""
        for index, line in enumerate(lines):
            if not re.match(r"^\s*кем\s+выдан\b", line, re.IGNORECASE):
                continue
            nearby_lines = lines[max(0, index - 2):index] + lines[index + 1:index + 3]
            authority_line = next(
                (
                    candidate
                    for candidate in nearby_lines
                    if re.search(r"\b(?:ГУ|УМВД|ОМВД|МВД|УФМС|ФМС|ОВД|ОТДЕЛ|УПРАВЛЕНИЕ)\b", candidate, re.IGNORECASE)
                ),
                "",
            )
            if authority_line:
                normalized_issuer = normalize_passport_issuer(authority_line)
                passport_issuer_evidence = " ".join(lines[max(0, index - 2):index + 3])
            break
    if normalized_issuer:
        add_field(fields, "passportIssuer", normalized_issuer, 0.98, passport_issuer_evidence)

    work_place, work_place_evidence = value_after_label(lines, r"^\s*место\s+работы\s*\(.*\)\s*[:.]?")
    if work_place:
        add_field(fields, "workPlace", work_place, 0.96, work_place_evidence)
    position, position_evidence = value_after_label(lines, r"^\s*должность\b")
    inline_position = re.search(
        r"специальность\s+или\s+([^\n]{3,120})$",
        position,
        re.IGNORECASE,
    )
    if inline_position and "направление обучения" not in inline_position.group(1).casefold():
        position = inline_position.group(1).strip(" :(),")
    if position and "специальность или" not in position.casefold():
        add_field(fields, "position", position, 0.95, position_evidence)
    else:
        for index, line in enumerate(lines):
            if not re.match(r"^\s*должность\b", line, re.IGNORECASE):
                continue
            for candidate in lines[index + 1:index + 5]:
                candidate_value = candidate.strip(" :(),")
                candidate_folded = candidate_value.casefold()
                if not candidate_value or "направление обучения" in candidate_folded:
                    continue
                if re.search(r"[А-ЯЁа-яёA-Za-z]{3,}", candidate_value):
                    add_field(
                        fields,
                        "position",
                        candidate_value,
                        0.95,
                        " ".join(lines[index:index + 5]),
                    )
                    break
            break

    program_match = re.search(
        r"дополнительн\w*\s+профессиональн\w*\s+программе\s*:\s*\n\s*([^\n]{6,300})",
        text,
        re.IGNORECASE,
    )
    if program_match:
        program = re.sub(r"\s*\(\d{2,4}\s*ч\.?\)\s*$", "", program_match.group(1)).strip()
        add_field(fields, "program", program, 0.99, program_match.group(0))
        hours_match = re.search(r"\((\d{2,4})\s*ч", program_match.group(1), re.IGNORECASE)
        if hours_match:
            add_field(fields, "hours", hours_match.group(1), 0.99, program_match.group(1))

    study_form_match = re.search(r"форма\s+обучения\s*[–—:\-]?\s*([^\n)]{3,100})", text, re.IGNORECASE)
    if study_form_match:
        source = study_form_match.group(1).casefold()
        study_form = "Дистанционная" if "дистанц" in source else "Очно-заочная" if "очно" in source else "Заочная" if "заоч" in source else ""
        if study_form:
            add_field(fields, "studyForm", study_form, 0.98, study_form_match.group(0))

    training_period = re.search(
        r"(?:срок\s+обучения\s+с|\bс)\s*([0-3]?\d[./-][01]?\d[./-](?:19|20)\d{2})\s*(?:г\.?\s*)?по\s*"
        r"([0-3]?\d[./-][01]?\d[./-](?:19|20)\d{2})",
        text,
        re.IGNORECASE,
    )
    if training_period:
        add_field(fields, "startDate", parse_date(training_period.group(1)), 0.99, training_period.group(0))
        add_field(fields, "endDate", parse_date(training_period.group(2)), 0.99, training_period.group(0))

    application_date, application_evidence = find_labeled_date(lines, ("дата подачи заявления",))
    if application_date:
        add_field(fields, "applicationDate", application_date, 0.99, application_evidence)

    contract_number = re.search(
        r"договор\s*(?:№|no\.?)\s*([A-ZА-ЯЁ0-9/\-]+)",
        text,
        re.IGNORECASE,
    )
    if contract_number:
        add_field(fields, "contractNo", contract_number.group(1), 0.99, contract_number.group(0))
        contract_tail = text[contract_number.end():contract_number.end() + 500]
        contract_date = parse_date(contract_tail)
        if contract_date:
            add_field(fields, "contractDate", contract_date, 0.97, contract_tail[:200])

    education_match = re.search(
        r"сведения\s+о\s+предыдущем\s+уровне\s+образования([\s\S]{0,1200}?)(?:\n\s*я\s*,|ознакомлен)",
        text,
        re.IGNORECASE,
    )
    if education_match:
        education_text = education_match.group(1)
        document_match = re.search(r"вид\s+документа\s+об\s+образовании\s+([^\n]{4,180})", education_text, re.IGNORECASE)
        if document_match:
            add_field(fields, "educationDocument", document_match.group(1), 0.99, document_match.group(0))
        series_match = re.search(r"\bсерия\s+([A-ZА-ЯЁ0-9\-]{2,20})", education_text, re.IGNORECASE)
        number_match = re.search(r"номер\s+документа\s+([A-ZА-ЯЁ0-9\-]{3,30})", education_text, re.IGNORECASE)
        if series_match:
            add_field(fields, "educationDocumentSeries", series_match.group(1), 0.99, series_match.group(0))
        if number_match:
            add_field(fields, "educationDocumentNumber", number_match.group(1), 0.99, number_match.group(0))
        education_date, education_date_evidence = find_labeled_date(
            normalize_text(education_text).splitlines(),
            ("дата выдачи",),
        )
        if education_date:
            add_field(fields, "educationDocumentDate", education_date, 0.99, education_date_evidence)
        education_issuer = re.search(r"кем\s+выдан\s*:?\s*([^\n]{4,240})", education_text, re.IGNORECASE)
        if education_issuer:
            add_field(fields, "educationDocumentIssuer", education_issuer.group(1), 0.99, education_issuer.group(0))
        if name_parts[0]:
            add_field(fields, "educationDocumentSurname", name_parts[0], 0.98, surname_evidence)


def extract_identity_numbers(
    text: str,
    lines: list[str],
    kinds: list[str],
    fields: dict[str, dict[str, Any]],
) -> None:
    for index, line in enumerate(lines):
        folded = line.casefold()
        if "снилс" in folded or "snils" in folded:
            evidence = nearby_text(lines, index, 2)
            for raw, recovered, corrected in snils_candidates(
                evidence,
                allow_missing_leading_zero=True,
            ):
                if recovered:
                    add_field(
                        fields,
                        "snils",
                        recovered,
                        0.9 if corrected else 0.99,
                        f"{evidence} (OCR: {raw})" if corrected else evidence,
                    )
                else:
                    add_field(fields, "snils", raw, 0.55, evidence)
        if "инн" in folded or "inn" in folded:
            if "инн/кпп" in folded or "инн / кпп" in folded:
                continue
            allowed_lengths = {12} if "application" in kinds or "contract" in kinds else {10, 12}
            for match in re.finditer(r"(?<!\d)(\d(?:[\s-]?\d){9,11})(?!\d)", line):
                value = only_digits(match.group(1))
                if len(value) not in allowed_lengths:
                    continue
                add_field(fields, "inn", value, 0.99 if is_valid_inn(value) else 0.55, line)

    for raw, recovered, corrected in snils_candidates(
        text,
        allow_missing_leading_zero="snils" in kinds,
    ):
        if recovered and (not corrected or "snils" in kinds):
            add_field(
                fields,
                "snils",
                recovered,
                0.88 if corrected else 0.98,
                f"OCR: {raw}" if corrected else raw,
            )


REGISTRATION_ADDRESS_LABEL = re.compile(
    r"(?:(?:почтовый\s+)?адрес(?:\s+(?:фактического|постоянного))?\s+места\s+жительства|"
    r"мест[оа]\s+жительств[ао]|(?:адрес|место)\s+регистраци[ия]|"
    r"зарегистрирован(?:а|о|ы)?(?:\s+по\s+месту\s+жительства)?|"
    r"прописан(?:а|о|ы)?(?:\s+по\s+адресу)?)",
    re.IGNORECASE,
)
REGISTRATION_ADDRESS_STRONG_LABEL = re.compile(
    r"(?:(?:почтовый\s+)?адрес(?:\s+(?:фактического|постоянного))?\s+места\s+жительства|"
    r"зарегистрирован(?:а|о|ы)?|прописан(?:а|о|ы)?|(?:адрес|место)\s+регистраци[ия])",
    re.IGNORECASE,
)
REGISTRATION_ADDRESS_STOP = re.compile(
    r"(?:снят(?:а|о|ы)?\s+с\s+регистрацион|орган\s+регистрацион|"
    r"подпись|личн(?:ая|ой)\s+подпись|паспорт\s+выдан|код\s+подразделения|"
    r"дата\s+выдачи|место\s+рождения|фамили[яи]|отчеств[оа]|с\s+уважением|"
    r"(?:фио|телефон|e-?mail|электронн(?:ая|ой)\s+почт[аы]|должность|организация|компания)\s*:)",
    re.IGNORECASE,
)
REGISTRATION_ADDRESS_AUTHORITY = re.compile(
    r"\b(?:мвд|фмс|уфмс|овд|омвд|отдел(?:ение|ом)?|управление)\b",
    re.IGNORECASE,
)
REGISTRATION_ADDRESS_PARTS = re.compile(
    r"(?:\bг(?:ор(?:од)?)?\.?\s|\bул(?:ица)?\.?\s|\bд(?:ом)?\.?\s*\d|"
    r"\bкв(?:артира)?\.?\s*\d|\bкорп(?:ус)?\.?\s*\d|\bстр(?:оение)?\.?\s*\d|"
    r"\bобл(?:асть)?\.?\s|\bр-?н\.?\s|\bрайон\b|\bкрай\b|"
    r"\bс(?:ело)?\.?\s|\bп(?:ос[её]лок)?\.?\s|\bпгт\b|"
    r"\bпросп(?:ект)?\.?\s|\bпр-?кт\.?\s|\bпер(?:еулок)?\.?\s|"
    r"\bбульвар\b|\bб-р\b|\bшоссе\b|\bнаб(?:ережная)?\.?\s)",
    re.IGNORECASE,
)


def clean_registration_address_line(value: str) -> str:
    source = unicodedata.normalize("NFKC", str(value or ""))
    source = REGISTRATION_ADDRESS_LABEL.sub(" ", source)
    source = re.sub(r"\bпо\s+адресу\b", " ", source, flags=re.IGNORECASE)
    source = re.sub(
        r"^\s*[0-3]?\d[./-][01]?\d[./-](?:19|20)?\d{2}\s*(?:г\.?|года)?\s*",
        "",
        source,
        flags=re.IGNORECASE,
    )
    source = re.sub(
        r"^\s*[0-3]?\d\s+(?:января|февраля|марта|апреля|мая|июня|июля|"
        r"августа|сентября|октября|ноября|декабря)\s+(?:19|20)?\d{2}\s*(?:г\.?|года)?\s*",
        "",
        source,
        flags=re.IGNORECASE,
    )
    source = re.sub(r"[|_=]+", " ", source)
    source = re.sub(r"\s+([,.;])", r"\1", source)
    return re.sub(r"\s+", " ", source).strip(" ,;:.-")


def registration_address_score(value: str) -> tuple[int, int]:
    source = str(value or "")
    if REGISTRATION_ADDRESS_AUTHORITY.search(source):
        return -10, 0
    parts = len(REGISTRATION_ADDRESS_PARTS.findall(source))
    words = len(re.findall(r"[А-ЯЁа-яё]{3,}", source))
    digits = len(re.findall(r"\d+", source))
    score = parts * 4 + min(words, 8) + min(digits, 4)
    return score, parts


def normalize_registration_address(lines: list[str]) -> str:
    cleaned: list[str] = []
    for line in lines:
        if REGISTRATION_ADDRESS_STOP.search(line) or REGISTRATION_ADDRESS_AUTHORITY.search(line):
            break
        value = clean_registration_address_line(line)
        if not value or parse_date(value):
            continue
        if len(re.findall(r"[А-ЯЁа-яё]", value)) < 2:
            continue
        cleaned.append(value)
    result = ", ".join(cleaned)
    result = re.sub(r"(?:\s*,\s*){2,}", ", ", result)
    return result.strip(" ,;:.-")


def extract_registration_address(
    lines: list[str],
    fields: dict[str, dict[str, Any]],
) -> None:
    candidates: list[tuple[int, int, str, str]] = []
    for index, line in enumerate(lines):
        exact_heading = bool(re.fullmatch(r"\W*мест[оа]\s+жительств[ао]\W*", line, re.IGNORECASE))
        if not exact_heading and not REGISTRATION_ADDRESS_STRONG_LABEL.search(line):
            continue
        address = normalize_registration_address(lines[index:index + 10])
        score, parts = registration_address_score(address)
        if parts >= 2 or (parts >= 1 and score >= 9 and bool(re.search(r"\d", address))):
            candidates.append((score + 8, index, address, nearby_text(lines, index + 2, 4)))

    if not candidates:
        return
    score, _, address, evidence = max(candidates, key=lambda item: (item[0], len(item[2])))
    confidence = 0.9 if score >= 24 else 0.8 if score >= 17 else 0.68
    add_field(fields, "registrationAddress", address, confidence, evidence)


def extract_passport(
    text: str,
    lines: list[str],
    fields: dict[str, dict[str, Any]],
) -> None:
    add_field(fields, "passportType", "Паспорт гражданина РФ", 0.98, "Паспорт РФ")
    add_field(fields, "citizenship", "Российская Федерация", 0.85, "Российская Федерация")
    extract_passport_mrz(text, fields)

    passport_number_patterns = (
        r"(?:серия|сер\.?)\s*([0-9OО]{2})\s*([0-9OО]{2}).{0,20}?(?:номер|№)\s*([0-9OО]{6})",
        r"(?<!\d)([0-9OО]{2})\s+([0-9OО]{2})\s+([0-9OО]{6})(?!\d)",
        r"(?<!\d)([0-9OО]{4})\s+([0-9OО]{6})(?!\d)",
    )
    for pattern in passport_number_patterns:
        match = re.search(pattern, text, re.IGNORECASE | re.DOTALL)
        if not match:
            continue
        groups = match.groups()
        if len(groups) == 3:
            value = f"{only_digits(groups[0])} {only_digits(groups[1])} {only_digits(groups[2])}"
        else:
            series = only_digits(groups[0])
            value = f"{series[:2]} {series[2:]} {only_digits(groups[1])}"
        if len(only_digits(value)) == 10:
            add_field(fields, "passportNumber", value, 0.9, match.group(0))
            break

    code_match = re.search(
        r"код\s+подразделения\s*[:.]?\s*([0-9OОЗз]{3})\s*[-–—]\s*([0-9OОЗз]{3})(?!\d)",
        text,
        re.IGNORECASE,
    )
    if code_match:
        code = f"{only_digits(code_match.group(1))}-{only_digits(code_match.group(2))}"
        add_field(fields, "passportCode", code, 0.96, code_match.group(0))

    issue_date, issue_evidence = find_labeled_date(
        lines,
        ("дата выдачи", "паспорт выдан", "паспорт вылан"),
    )
    if issue_date:
        add_field(fields, "passportDate", issue_date, 0.9, issue_evidence)
    birth_date, birth_evidence = find_labeled_date(lines, ("дата рождения", "родил"))
    if birth_date:
        add_field(fields, "birthDate", birth_date, 0.9, birth_evidence)

    folded_text = text.casefold()
    if re.search(r"\bжен(?:ский|щина)?\b", folded_text):
        add_field(fields, "gender", "Женский", 0.88, "Пол: женский")
    elif re.search(r"\bмуж(?:ской|чина)?\b", folded_text):
        add_field(fields, "gender", "Мужской", 0.88, "Пол: мужской")

    surname, surname_evidence = passport_name_part(
        lines,
        r"\bфамили[яи]\b",
        prefer_previous=True,
    )
    first_name, name_evidence = passport_name_part(lines, r"(?<!фамил)\bим[яи]\b")
    patronymic, patronymic_evidence = passport_name_part(lines, r"\bотчеств[оа]\b")
    if surname and first_name:
        full_name = " ".join(item for item in (surname, first_name, patronymic) if item)
        add_field(
            fields,
            "name",
            full_name,
            0.86 if patronymic else 0.72,
            " ".join((surname_evidence, name_evidence, patronymic_evidence)),
        )

    for index, line in enumerate(lines):
        folded = line.casefold()
        if (
            not re.search(r"паспорт\s+вы[дл]ан", folded)
            and not re.search(r"^\s*вы[дл]ан\b", folded)
        ):
            continue
        tail = re.split(
            r"паспорт\s+вы[дл]ан|вы[дл]ан",
            line,
            maxsplit=1,
            flags=re.IGNORECASE,
        )[-1].strip(" :")
        parts = [tail] if tail else []
        for next_line in lines[index + 1:index + 5]:
            next_folded = next_line.casefold()
            if (
                parse_date(next_line)
                or "код подразделения" in next_folded
                or "дата выдачи" in next_folded
            ):
                break
            parts.append(next_line)
        issuer = normalize_passport_issuer(" ".join(parts))
        if len(issuer) >= 8 and is_plausible_passport_issuer(issuer):
            add_field(fields, "passportIssuer", issuer, 0.78, nearby_text(lines, index, 3))
            break
    if "passportIssuer" not in fields:
        for line in lines:
            if not re.search(r"\b(?:мвд|фмс|овд|отдел|управление)\b", line, re.IGNORECASE):
                continue
            issuer = normalize_passport_issuer(line)
            if len(issuer) >= 8 and is_plausible_passport_issuer(issuer):
                add_field(fields, "passportIssuer", issuer, 0.72, line)
                break


def extract_education(
    text: str,
    lines: list[str],
    fields: dict[str, dict[str, Any]],
) -> None:
    folded = text.casefold()
    document_type = "Диплом о высшем образовании"
    level = ""
    if "среднем профессиональном" in folded or "среднего профессионального" in folded:
        document_type = "Диплом о среднем профессиональном образовании"
        level = "СПО"
    elif "начальном профессиональном" in folded or "начального профессионального" in folded:
        document_type = "Диплом о начальном профессиональном образовании"
    elif "бакалавр" in folded:
        level = "Бакалавр"
    elif "магистр" in folded:
        level = "Магистр"
    elif "специалист" in folded:
        level = "Специалист"
    add_field(fields, "educationDocument", document_type, 0.88, "Диплом")
    if level:
        add_field(fields, "educationLevel", level, 0.82, document_type)

    labeled_number = re.search(
        r"(?:серия|сер\.?)\s*([A-ZА-ЯЁ0-9-]{2,12}).{0,30}?(?:номер|№)\s*([A-ZА-ЯЁ0-9-]{4,20})",
        text,
        re.IGNORECASE | re.DOTALL,
    )
    if labeled_number:
        add_field(fields, "educationDocumentSeries", labeled_number.group(1), 0.88, labeled_number.group(0))
        add_field(fields, "educationDocumentNumber", labeled_number.group(2), 0.9, labeled_number.group(0))
    else:
        number_match = re.search(
            r"(?:диплом|документ).{0,100}?\b([0-9]{5,6})\s+([0-9]{6,8})\b",
            text,
            re.IGNORECASE | re.DOTALL,
        )
        if number_match:
            add_field(fields, "educationDocumentSeries", number_match.group(1), 0.68, number_match.group(0))
            add_field(fields, "educationDocumentNumber", number_match.group(2), 0.72, number_match.group(0))

    issue_date, issue_evidence = find_labeled_date(lines, ("дата выдачи", "выдан"))
    if issue_date:
        add_field(fields, "educationDocumentDate", issue_date, 0.88, issue_evidence)

    for index, line in enumerate(lines):
        folded_line = line.casefold()
        if (
            "квалификац" not in folded_line
            or (
                "присвоен" not in folded_line
                and not re.match(r"^\s*квалификаци[яи]\b", folded_line)
            )
        ):
            continue
        following_lines = lines[index + 1:index + 7]
        following = next(
            (
                candidate
                for candidate in following_lines
                if re.search(r"\b\d{2}\.\d{2}\.\d{2}\b", candidate)
            ),
            "",
        ) or next(
            (
                candidate
                for candidate in following_lines
                if re.search(r"\b(?:бакалавр|магистр|специалист)\b", candidate, re.IGNORECASE)
            ),
            following_lines[0] if following_lines else "",
        )
        label_match = re.search(
            r"квалификаци[яи](?:\s*\(и\))?\s*:?\s*(.*)$",
            line,
            re.IGNORECASE,
        )
        tail = label_match.group(1).strip(" :(),") if label_match else ""
        qualification_source = tail or following
        qualification_name = re.split(
            r"\s+\d{2}\.\d{2}\.\d{2}\b",
            qualification_source,
            maxsplit=1,
        )[0].strip(" :(),")
        if qualification_name and "квалификац" not in qualification_name.casefold():
            add_field(
                fields,
                "educationQualification",
                qualification_name,
                0.9,
                f"{line} {following}",
            )
        program_match = re.search(
            r"\b\d{2}\.\d{2}\.\d{2}\s+([^\n]{4,180})",
            qualification_source,
        )
        if program_match:
            add_field(
                fields,
                "educationSpecialty",
                program_match.group(1),
                0.9,
                qualification_source,
            )
        if qualification_name or program_match:
            break

    specialty_match = re.search(
        r"(?:по\s+специальности|специальность)\s*[:«\"]?\s*([^\n»\"]{4,180})",
        text,
        re.IGNORECASE,
    )
    if specialty_match:
        add_field(fields, "educationSpecialty", specialty_match.group(1), 0.75, specialty_match.group(0))
    qualification_match = re.search(
        r"(?:квалификация|присвоена\s+квалификация)\s*[:«\"]?\s*([^\n»\"]{3,160})",
        text,
        re.IGNORECASE,
    )
    if qualification_match:
        add_field(
            fields,
            "educationQualification",
            qualification_match.group(1),
            0.78,
            qualification_match.group(0),
        )

    diploma_index = next(
        (index for index, line in enumerate(lines) if "диплом" in line.casefold()),
        -1,
    )
    institution_markers = (
        "университет",
        "институт",
        "академ",
        "колледж",
        "техникум",
        "училищ",
        "образовательн",
    )
    candidates = []
    search_lines = lines[:diploma_index] if diploma_index > 0 else lines[:12]
    for index, line in enumerate(search_lines):
        if any(marker in line.casefold() for marker in institution_markers):
            candidate = " ".join(search_lines[index:index + 3])
            candidates.append(candidate)
    if candidates:
        issuer = max(candidates, key=len)
        add_field(fields, "educationDocumentIssuer", issuer, 0.68, issuer)

    extract_education_surname(text, lines, fields)


def extract_fields(text: str, file_name: str) -> tuple[list[str], list[dict[str, Any]]]:
    lines = normalize_text(text).splitlines()
    kinds = classify_document(text, file_name)
    fields: dict[str, dict[str, Any]] = {}
    extract_identity_numbers(text, lines, kinds, fields)
    is_application_document = "application" in kinds or "contract" in kinds
    if is_application_document:
        extract_application_fields(text, lines, fields)
    elif Path(file_name).suffix.casefold() in {".txt", ".rtf", ".doc", ".docx", ".odt"}:
        extract_registration_address(lines, fields)
    if "passport" in kinds:
        extract_passport(text, lines, fields)
        passport_source = f"{file_name}\n{text}".casefold()
        passport_file_hint = bool(re.search(r"(?:паспорт|passport)", file_name, re.IGNORECASE))
        passport_identity_score = sum(marker in passport_source for marker in (
            "российская федерация",
            "код подразделения",
            "место рождения",
        ))
        if (
            (passport_file_hint or passport_identity_score >= 2)
            and "registrationAddress" not in fields
        ):
            extract_registration_address(lines, fields)
    if "education" in kinds and not is_application_document:
        extract_education(text, lines, fields)
    kinds = [
        kind
        for kind in kinds
        if kind not in {"inn", "snils"} or kind in fields
    ]
    return kinds, list(fields.values())


def normalize_preview_match_text(value: str) -> str:
    source = unicodedata.normalize("NFKC", str(value or "")).casefold()
    source = re.sub(r"\b(\d{4})-(\d{2})-(\d{2})\b", r"\3.\2.\1", source)
    return re.sub(r"[^0-9a-zа-яё]+", " ", source, flags=re.IGNORECASE).strip()


def group_ocr_words(words: list[dict[str, Any]]) -> list[dict[str, Any]]:
    grouped: dict[tuple[int, int, int], list[dict[str, Any]]] = {}
    for word in words:
        grouped.setdefault(tuple(word["lineKey"]), []).append(word)
    lines: list[dict[str, Any]] = []
    for line_words in grouped.values():
        line_words.sort(key=lambda item: item["left"])
        left = min(item["left"] for item in line_words)
        top = min(item["top"] for item in line_words)
        right = max(item["left"] + item["width"] for item in line_words)
        bottom = max(item["top"] + item["height"] for item in line_words)
        text = " ".join(item["text"] for item in line_words)
        lines.append({
            "text": text,
            "normalized": normalize_preview_match_text(text),
            "left": left,
            "top": top,
            "width": right - left,
            "height": bottom - top,
        })
    return sorted(lines, key=lambda item: (item["top"], item["left"]))


def preview_match_score(line_text: str, target_text: str) -> float:
    line = normalize_preview_match_text(line_text)
    target = normalize_preview_match_text(target_text)
    if not line or not target:
        return 0.0
    compact_line = line.replace(" ", "")
    compact_target = target.replace(" ", "")
    if len(compact_line) >= 4 and (compact_line in compact_target or compact_target in compact_line):
        return 1.0 + min(len(compact_line), len(compact_target)) / 1000
    line_tokens = set(line.split())
    target_tokens = set(target.split())
    token_score = len(line_tokens & target_tokens) / max(1, min(len(line_tokens), len(target_tokens)))
    sequence_score = difflib.SequenceMatcher(None, compact_line, compact_target).ratio()
    line_digits = only_digits(line)
    target_digits = only_digits(target)
    digit_score = 0.0
    if len(line_digits) >= 4 and len(target_digits) >= 4:
        if line_digits in target_digits or target_digits in line_digits:
            digit_score = 0.95
        else:
            digit_score = difflib.SequenceMatcher(None, line_digits, target_digits).ratio() * 0.8
    return max(token_score * 0.9, sequence_score * 0.72, digit_score)


def field_preview_targets(field: dict[str, Any]) -> list[str]:
    targets = [
        str(field.get("value") or ""),
        str(field.get("evidence") or ""),
        str(field.get("label") or ""),
    ]
    return [target for target in targets if normalize_preview_match_text(target)]


def fallback_preview_box(key: str, width: int, height: int) -> tuple[int, int, int, int]:
    passport_top = {"passportIssuer", "passportDate", "passportCode", "passportType", "citizenship"}
    passport_identity = {"name", "birthDate", "gender"}
    if key in passport_top:
        return round(width * 0.03), round(height * 0.03), round(width * 0.94), round(height * 0.32)
    if key in passport_identity:
        return round(width * 0.08), round(height * 0.39), round(width * 0.88), round(height * 0.48)
    if key == "passportNumber":
        if width >= height:
            return round(width * 0.76), round(height * 0.04), round(width * 0.22), round(height * 0.92)
        return round(width * 0.03), round(height * 0.78), round(width * 0.94), round(height * 0.20)
    if key == "registrationAddress":
        return round(width * 0.04), round(height * 0.02), round(width * 0.92), round(height * 0.60)
    return round(width * 0.04), round(height * 0.12), round(width * 0.92), round(height * 0.76)


def render_field_preview(
    field: dict[str, Any],
    page_result: dict[str, Any],
    line: dict[str, Any] | None,
) -> dict[str, Any]:
    image_path = Path(page_result["imagePath"])
    width, height = image_dimensions(image_path)
    if line:
        vertical_padding = max(42, round(line["height"] * 3.8))
        top = max(0, line["top"] - vertical_padding)
        bottom = min(height, line["top"] + line["height"] + vertical_padding)
        left = max(0, round(width * 0.025))
        right = min(width, round(width * 0.975))
        box = (left, top, max(1, right - left), max(1, bottom - top))
    else:
        box = fallback_preview_box(str(field.get("key") or ""), width, height)
    left, top, crop_width, crop_height = box
    output_path = image_path.with_name(f"{image_path.stem}-preview-{field['key']}.jpg")
    run_command(
        [
            CONVERT_BINARY,
            str(image_path),
            "-crop",
            f"{crop_width}x{crop_height}+{left}+{top}",
            "+repage",
            "-resize",
            "960x420>",
            "-quality",
            "76",
            str(output_path),
        ],
        timeout=35,
    )
    preview_bytes = output_path.read_bytes()
    if len(preview_bytes) > 180 * 1024:
        run_command(
            [
                CONVERT_BINARY,
                str(output_path),
                "-resize",
                "760x340>",
                "-quality",
                "62",
                str(output_path),
            ],
            timeout=25,
        )
        preview_bytes = output_path.read_bytes()
    return {
        "page": int(page_result["page"]),
        "mimeType": "image/jpeg",
        "base64": base64.b64encode(preview_bytes).decode("ascii"),
        "box": {
            "x": round(left / width, 5),
            "y": round(top / height, 5),
            "width": round(crop_width / width, 5),
            "height": round(crop_height / height, 5),
        },
    }


def render_page_preview(page_result: dict[str, Any]) -> dict[str, Any]:
    source_path = Path(page_result.get("sourceImagePath") or page_result["imagePath"])
    image_path = Path(page_result["imagePath"])
    output_path = image_path.with_name(f"{image_path.stem}-page-preview.jpg")
    preview_bytes = b""
    for max_dimension, quality in ((1800, 80), (1500, 68), (1200, 56)):
        run_command(
            [
                CONVERT_BINARY,
                str(source_path),
                "-auto-orient",
                "-strip",
                "-resize",
                f"{max_dimension}x{max_dimension}>",
                "-quality",
                str(quality),
                str(output_path),
            ],
            timeout=45,
        )
        preview_bytes = output_path.read_bytes()
        if len(preview_bytes) <= PAGE_PREVIEW_MAX_BYTES:
            break
    return {
        "page": int(page_result["page"]),
        "mimeType": "image/jpeg",
        "base64": base64.b64encode(preview_bytes).decode("ascii"),
    }


def clamp_photo_box(
    box: tuple[int, int, int, int],
    width: int,
    height: int,
) -> tuple[int, int, int, int]:
    left, top, crop_width, crop_height = box
    left = max(0, min(width - 1, int(left)))
    top = max(0, min(height - 1, int(top)))
    crop_width = max(1, min(width - left, int(crop_width)))
    crop_height = max(1, min(height - top, int(crop_height)))
    return left, top, crop_width, crop_height


def expand_face_photo_box(
    face_box: tuple[int, int, int, int],
    width: int,
    height: int,
) -> tuple[int, int, int, int]:
    face_x, face_y, face_width, face_height = face_box
    crop_width = max(face_width * 2.2, face_height * 1.65)
    crop_height = crop_width * 1.34
    center_x = face_x + face_width / 2
    top = face_y - face_height * 0.58
    return clamp_photo_box(
        (
            round(center_x - crop_width / 2),
            round(top),
            round(crop_width),
            round(crop_height),
        ),
        width,
        height,
    )


def photo_box_overlap(
    first: tuple[int, int, int, int],
    second: tuple[int, int, int, int],
) -> float:
    first_right = first[0] + first[2]
    first_bottom = first[1] + first[3]
    second_right = second[0] + second[2]
    second_bottom = second[1] + second[3]
    overlap_width = max(0, min(first_right, second_right) - max(first[0], second[0]))
    overlap_height = max(0, min(first_bottom, second_bottom) - max(first[1], second[1]))
    overlap = overlap_width * overlap_height
    return overlap / max(1, min(first[2] * first[3], second[2] * second[3]))


def render_photo_candidate(
    page_result: dict[str, Any],
    box: tuple[int, int, int, int],
    confidence: float,
    method: str,
    index: int,
) -> dict[str, Any]:
    image_path = Path(page_result.get("sourceImagePath") or page_result["imagePath"])
    width, height = image_dimensions(image_path)
    left, top, crop_width, crop_height = clamp_photo_box(box, width, height)
    output_path = image_path.with_name(f"{image_path.stem}-photo-{index}.jpg")
    preview_bytes = b""
    for max_dimension, quality in ((1200, 86), (900, 76), (700, 66)):
        run_command(
            [
                CONVERT_BINARY,
                str(image_path),
                "-auto-orient",
                "-crop",
                f"{crop_width}x{crop_height}+{left}+{top}",
                "+repage",
                "-strip",
                "-resize",
                f"{max_dimension}x{max_dimension}>",
                "-quality",
                str(quality),
                str(output_path),
            ],
            timeout=45,
        )
        preview_bytes = output_path.read_bytes()
        if len(preview_bytes) <= PHOTO_CANDIDATE_MAX_BYTES:
            break
    return {
        "page": int(page_result["page"]),
        "mimeType": "image/jpeg",
        "base64": base64.b64encode(preview_bytes).decode("ascii"),
        "confidence": round(max(0.0, min(1.0, confidence)), 2),
        "method": method,
        "box": {
            "x": round(left / width, 5),
            "y": round(top / height, 5),
            "width": round(crop_width / width, 5),
            "height": round(crop_height / height, 5),
        },
    }


def detect_page_faces(page_result: dict[str, Any]) -> list[tuple[int, int, int, int]]:
    if cv2 is None:
        return []
    image_path = str(page_result.get("sourceImagePath") or page_result["imagePath"])
    image = cv2.imread(image_path)
    if image is None:
        return []
    grayscale = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    cascade_path = str(Path(cv2.data.haarcascades) / "haarcascade_frontalface_default.xml")
    cascade = cv2.CascadeClassifier(cascade_path)
    if cascade.empty():
        return []
    min_side = max(42, round(min(image.shape[0], image.shape[1]) * 0.035))
    faces = cascade.detectMultiScale(
        grayscale,
        scaleFactor=1.08,
        minNeighbors=5,
        minSize=(min_side, min_side),
    )
    width = int(image.shape[1])
    height = int(image.shape[0])
    return [
        expand_face_photo_box(tuple(int(value) for value in face), width, height)
        for face in faces
    ]


def detect_photo_candidates(
    page_results: list[dict[str, Any]],
    document_types: list[str],
    file_name: str,
    mime_type: str,
) -> list[dict[str, Any]]:
    candidates: list[dict[str, Any]] = []
    used_boxes: dict[int, list[tuple[int, int, int, int]]] = {}
    for page_result in page_results:
        page_number = int(page_result["page"])
        for box in detect_page_faces(page_result):
            if any(photo_box_overlap(box, existing) >= 0.68 for existing in used_boxes.get(page_number, [])):
                continue
            try:
                candidates.append(render_photo_candidate(
                    page_result,
                    box,
                    0.94,
                    "face",
                    len(candidates) + 1,
                ))
                used_boxes.setdefault(page_number, []).append(box)
            except (OSError, RuntimeError, subprocess.SubprocessError):
                continue
            if len(candidates) >= MAX_PHOTO_CANDIDATES:
                return candidates

    if "passport" in document_types and page_results:
        page_result = page_results[0]
        width, height = image_dimensions(Path(page_result.get("sourceImagePath") or page_result["imagePath"]))
        passport_box = clamp_photo_box(
            (
                round(width * 0.035),
                round(height * 0.405),
                round(width * 0.305),
                round(height * 0.515),
            ),
            width,
            height,
        )
        if not any(photo_box_overlap(passport_box, existing) >= 0.5 for existing in used_boxes.get(1, [])):
            try:
                candidates.append(render_photo_candidate(
                    page_result,
                    passport_box,
                    0.72,
                    "passport",
                    len(candidates) + 1,
                ))
            except (OSError, RuntimeError, subprocess.SubprocessError):
                pass

    photo_name_hint = bool(re.search(r"(?:фото|photo|avatar|аватар)", file_name, re.IGNORECASE))
    if not candidates and photo_name_hint and mime_type.startswith("image/") and page_results:
        page_result = page_results[0]
        width, height = image_dimensions(Path(page_result.get("sourceImagePath") or page_result["imagePath"]))
        target_width = min(width, round(height * 0.75))
        named_photo_box = ((width - target_width) // 2, 0, target_width, height)
        try:
            candidates.append(render_photo_candidate(
                page_result,
                named_photo_box,
                0.82,
                "photo-file",
                1,
            ))
        except (OSError, RuntimeError, subprocess.SubprocessError):
            pass
    return candidates[:MAX_PHOTO_CANDIDATES]


def attach_field_previews(fields: list[dict[str, Any]], page_results: list[dict[str, Any]]) -> None:
    if not fields or not page_results:
        return
    for page_result in page_results:
        page_result["lines"] = group_ocr_words(page_result.get("words") or [])
    for field in fields:
        targets = field_preview_targets(field)
        key = str(field.get("key") or "")
        candidate_pages = page_results
        evidence_page = int(field.get("evidencePage") or 0)
        best_page = next(
            (
                page_result
                for page_result in candidate_pages
                if int(page_result.get("page") or 0) == evidence_page
            ),
            candidate_pages[0],
        )
        if key == "registrationAddress":
            best_page = next(
                (
                    page_result
                    for page_result in reversed(candidate_pages)
                    if REGISTRATION_ADDRESS_LABEL.search(str(page_result.get("text") or ""))
                ),
                candidate_pages[-1],
            )
        best_line: dict[str, Any] | None = None
        best_score = 0.0
        if key != "registrationAddress":
            for page_result in candidate_pages:
                for line in page_result.get("lines") or []:
                    score = max((preview_match_score(line["text"], target) for target in targets), default=0.0)
                    if score > best_score:
                        best_score = score
                        best_page = page_result
                        best_line = line
        try:
            field["preview"] = render_field_preview(
                field,
                best_page,
                None if key == "registrationAddress" else (
                    best_line if best_score >= (0.9 if key == "passportNumber" else 0.45) else None
                ),
            )
        except (OSError, RuntimeError, subprocess.SubprocessError):
            continue


def assign_field_evidence_pages(
    fields: list[dict[str, Any]],
    page_results: list[dict[str, Any]],
) -> None:
    for field in fields:
        evidence = normalize_preview_match_text(str(field.get("evidence") or ""))
        value = normalize_preview_match_text(str(field.get("value") or ""))
        targets = [target for target in (evidence, value) if len(target.replace(" ", "")) >= 4]
        if not targets:
            continue
        best_page = 0
        best_score = 0.0
        for page_result in page_results:
            page_text = normalize_preview_match_text(str(page_result.get("text") or ""))
            if not page_text:
                continue
            score = max(
                (
                    1.0 if target in page_text else difflib.SequenceMatcher(None, target, page_text).ratio()
                    for target in targets
                ),
                default=0.0,
            )
            if score > best_score:
                best_score = score
                best_page = int(page_result.get("page") or 0)
        if best_page and best_score >= 0.18:
            field["evidencePage"] = best_page


def render_referenced_page_previews(
    fields: list[dict[str, Any]],
    page_results: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    referenced_pages = {
        int(field.get("preview", {}).get("page") or 0)
        for field in fields
        if isinstance(field.get("preview"), dict)
    }
    previews: list[dict[str, Any]] = []
    for page_result in page_results:
        if int(page_result["page"]) not in referenced_pages:
            continue
        try:
            previews.append(render_page_preview(page_result))
        except (OSError, RuntimeError, subprocess.SubprocessError):
            continue
    return previews


def decode_document_payload(payload: dict[str, Any]) -> tuple[str, str, str, bytes]:
    file_name = Path(str(payload.get("fileName") or "document")).name[:180]
    mime_type = str(payload.get("mimeType") or "").split(";", 1)[0].lower().strip()
    allowed_types = {
        "image/jpeg": ".jpg",
        "image/png": ".png",
        "application/pdf": ".pdf",
        "text/plain": ".txt",
        "text/csv": ".csv",
        "application/rtf": ".rtf",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
        "application/vnd.oasis.opendocument.text": ".odt",
    }
    if mime_type not in allowed_types:
        raise ValueError("Поддерживаются JPG, PNG, PDF, TXT, CSV, RTF, DOCX и ODT.")
    try:
        file_bytes = base64.b64decode(str(payload.get("base64") or ""), validate=True)
    except (ValueError, binascii.Error) as error:
        raise ValueError("Файл передан в некорректном формате.") from error
    if not file_bytes or len(file_bytes) > MAX_FILE_BYTES:
        raise ValueError("Файл пустой или превышает 24 МБ.")
    if mime_type == "application/pdf" and not file_bytes.startswith(b"%PDF-"):
        raise ValueError("Содержимое файла не является PDF.")
    if mime_type == "image/png" and not file_bytes.startswith(b"\x89PNG\r\n\x1a\n"):
        raise ValueError("Содержимое файла не является PNG.")
    if mime_type == "image/jpeg" and not file_bytes.startswith(b"\xff\xd8\xff"):
        raise ValueError("Содержимое файла не является JPG.")
    if mime_type == "application/rtf" and not file_bytes.lstrip().startswith(b"{\\rtf"):
        raise ValueError("Содержимое файла не является RTF.")
    if mime_type in {
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/vnd.oasis.opendocument.text",
    } and not file_bytes.startswith(b"PK"):
        raise ValueError("Содержимое текстового документа имеет некорректный формат.")
    return file_name, mime_type, allowed_types[mime_type], file_bytes


def decode_image_conversion_payload(payload: dict[str, Any]) -> tuple[str, str, bytes]:
    file_name = Path(str(payload.get("fileName") or "image")).name[:180]
    mime_type = str(payload.get("mimeType") or "").split(";", 1)[0].lower().strip()
    extension_by_mime_type = {
        "image/avif": ".avif",
        "image/bmp": ".bmp",
        "image/emf": ".emf",
        "image/gif": ".gif",
        "image/heic": ".heic",
        "image/heif": ".heif",
        "image/jpeg": ".jpg",
        "image/jp2": ".jp2",
        "image/png": ".png",
        "image/svg+xml": ".svg",
        "image/tiff": ".tiff",
        "image/webp": ".webp",
        "image/wmf": ".wmf",
        "image/x-pcx": ".pcx",
        "image/x-icon": ".ico",
    }
    allowed_extensions = {
        ".avif", ".bmp", ".dds", ".dib", ".dng", ".emf", ".exr", ".gif",
        ".hdr", ".heic", ".heif", ".icns", ".ico", ".jfif", ".jp2",
        ".j2k", ".jpe", ".jpeg", ".jpg", ".pbm", ".pcx", ".pgm", ".png",
        ".pnm", ".ppm", ".ras", ".sgi", ".svg", ".tga", ".tif", ".tiff",
        ".webp", ".wmf", ".xbm", ".xpm",
    }
    extension = Path(file_name).suffix.lower()
    if extension not in allowed_extensions:
        extension = extension_by_mime_type.get(mime_type, "")
    if extension not in allowed_extensions:
        raise ValueError("Формат изображения не поддерживается для преобразования в JPG.")
    try:
        file_bytes = base64.b64decode(str(payload.get("base64") or ""), validate=True)
    except (ValueError, binascii.Error) as error:
        raise ValueError("Изображение передано в некорректном формате.") from error
    if not file_bytes or len(file_bytes) > MAX_FILE_BYTES:
        raise ValueError("Изображение пустое или превышает 24 МБ.")
    return file_name, extension, file_bytes


def convert_image_to_jpeg(payload: dict[str, Any]) -> dict[str, Any]:
    file_name, extension, file_bytes = decode_image_conversion_payload(payload)
    with tempfile.TemporaryDirectory(prefix="ais-image-convert-") as temp_dir:
        workdir = Path(temp_dir)
        source_path = workdir / f"source{extension}"
        output_path = workdir / "converted.jpg"
        source_path.write_bytes(file_bytes)
        run_command(
            [
                CONVERT_BINARY,
                f"{source_path}[0]",
                "-auto-orient",
                "-background",
                "white",
                "-alpha",
                "remove",
                "-alpha",
                "off",
                "-strip",
                "-colorspace",
                "sRGB",
                "-quality",
                "92",
                str(output_path),
            ],
            timeout=90,
        )
        output_bytes = output_path.read_bytes() if output_path.exists() else b""
        if not output_bytes.startswith(b"\xff\xd8\xff"):
            raise RuntimeError("Конвертер не сформировал корректный JPG-файл.")
        if len(output_bytes) > MAX_FILE_BYTES:
            raise RuntimeError("Преобразованный JPG-файл превышает 24 МБ.")
        output_name = f"{Path(file_name).stem or 'image'}.jpg"
        return {
            "ok": True,
            "fileName": output_name,
            "mimeType": "image/jpeg",
            "size": len(output_bytes),
            "base64": base64.b64encode(output_bytes).decode("ascii"),
        }


def render_document_page(payload: dict[str, Any]) -> dict[str, Any]:
    file_name, mime_type, extension, file_bytes = decode_document_payload(payload)
    if not (mime_type.startswith("image/") or mime_type == "application/pdf"):
        raise ValueError("Для текстового файла выбор области изображения недоступен.")
    requested_page = max(1, min(MAX_PDF_PAGES, int(payload.get("page") or 1)))
    with tempfile.TemporaryDirectory(prefix="ais-ocr-page-") as temp_dir:
        workdir = Path(temp_dir)
        source_path = workdir / f"source{extension}"
        source_path.write_bytes(file_bytes)
        page_paths = render_pages(source_path, mime_type, workdir)
        if requested_page > len(page_paths):
            raise ValueError("Указанная страница отсутствует в документе.")
        preview = render_page_preview({
            "page": requested_page,
            "imagePath": str(page_paths[requested_page - 1]),
            "sourceImagePath": str(page_paths[requested_page - 1]),
        })
        return {
            "ok": True,
            "fileName": file_name,
            "page": requested_page,
            "pageCount": len(page_paths),
            "preview": preview,
        }


def recognize(payload: dict[str, Any]) -> dict[str, Any]:
    started_at = time.perf_counter()
    file_name, mime_type, extension, file_bytes = decode_document_payload(payload)

    with tempfile.TemporaryDirectory(prefix="ais-ocr-") as temp_dir:
        workdir = Path(temp_dir)
        source_path = workdir / f"source{extension}"
        source_path.write_bytes(file_bytes)
        native_visual_document = mime_type.startswith("image/") or mime_type == "application/pdf"
        document_text_layer = ""
        embedded_docx_pages: list[Path] = []
        if mime_type == "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
            document_text_layer = extract_text_document(file_bytes, mime_type)
            embedded_docx_pages = extract_docx_embedded_images(file_bytes, workdir)
        is_visual_document = native_visual_document or bool(embedded_docx_pages)
        if not is_visual_document:
            text = document_text_layer or extract_text_document(file_bytes, mime_type)
            if not is_usable_text_layer(text):
                raise ValueError("В текстовом файле не найден пригодный для обработки текст.")
            document_types, fields = extract_fields(text, file_name)
            return {
                "ok": True,
                "fileName": file_name,
                "mimeType": mime_type,
                "pageCount": 1,
                "pages": [{
                    "page": 1,
                    "characters": len(text),
                    "durationMs": 0,
                    "method": "text",
                }],
                "documentTypes": document_types,
                "fields": fields,
                "pagePreviews": [],
                "photoCandidates": [],
                "textPreview": text[:3000],
                "textExtraction": "text",
                "durationMs": round((time.perf_counter() - started_at) * 1000),
            }

        page_paths = embedded_docx_pages or render_pages(source_path, mime_type, workdir)
        pdf_text_pages = extract_pdf_text_pages(source_path) if mime_type == "application/pdf" else []
        passport_hint = bool(re.search(r"(?:паспорт|passport)", file_name, re.IGNORECASE))
        snils_hint = bool(re.search(r"(?:снилс|snils|страхов)", file_name, re.IGNORECASE))

        def recognize_page(item: tuple[int, Path]) -> dict[str, Any]:
            page_number, page_path = item
            page_started_at = time.perf_counter()
            text_layer = (
                pdf_text_pages[page_number - 1]
                if page_number <= len(pdf_text_pages)
                else ""
            )
            if is_usable_text_layer(text_layer):
                page_text = text_layer
                prepared_path = page_path
                words: list[dict[str, Any]] = []
                extraction_method = "text-layer"
            else:
                page_text, prepared_path, words = ocr_image(
                    page_path,
                    try_snils_rotations=snils_hint,
                )
                extraction_method = "ocr"
            page_source = page_text.casefold()
            registration_hint = (
                page_number > 1
                or bool(re.search(r"(?:мест\w*\s+житель|регистрац|пропис)", page_source))
                or (
                    len(page_paths) == 1
                    and bool(re.search(
                        r"(?:passport|паспорт).*?(?:2|пропис|регистрац)",
                        file_name,
                        re.IGNORECASE,
                    ))
                )
            )
            if extraction_method == "ocr" and passport_hint and page_number == 1 and not registration_hint:
                page_text = merge_ocr_text(page_text, ocr_passport_regions(page_path))
            if extraction_method == "ocr" and passport_hint and registration_hint:
                page_text = merge_ocr_text(page_text, ocr_passport_registration_region(page_path))
            return {
                "page": page_number,
                "text": page_text,
                "durationMs": round((time.perf_counter() - page_started_at) * 1000),
                "imagePath": str(prepared_path),
                "sourceImagePath": str(page_path),
                "words": words,
                "method": extraction_method,
            }

        page_items = list(enumerate(page_paths, 1))
        with ThreadPoolExecutor(max_workers=min(OCR_PAGE_WORKERS, len(page_items))) as executor:
            recognized_pages = list(executor.map(recognize_page, page_items))
        recognized_pages.sort(key=lambda item: item["page"])
        page_results = [
            {
                "page": item["page"],
                "characters": len(item["text"]),
                "durationMs": item["durationMs"],
                "method": item["method"],
            }
            for item in recognized_pages
        ]
        all_text = [document_text_layer, *[item["text"] for item in recognized_pages]]
        text = normalize_text("\n".join(all_text))[:MAX_TEXT_CHARS]
        document_types, fields = extract_fields(text, file_name)
        registration_page_present = any(
            REGISTRATION_ADDRESS_LABEL.search(str(item.get("text") or ""))
            for item in recognized_pages
        )
        if (
            passport_hint
            and "passport" in document_types
            and registration_page_present
            and not any(field.get("key") == "registrationAddress" for field in fields)
        ):
            fields.append({
                "key": "registrationAddress",
                "label": FIELD_LABELS["registrationAddress"],
                "value": "",
                "confidence": 0.0,
                "evidence": "Место жительства",
                "manualEntry": True,
            })
        assign_field_evidence_pages(fields, recognized_pages)
        attach_field_previews(fields, recognized_pages)
        page_previews = render_referenced_page_previews(fields, recognized_pages)
        photo_candidates = detect_photo_candidates(
            recognized_pages,
            document_types,
            file_name,
            mime_type,
        )
        extraction_methods = {str(item.get("method") or "ocr") for item in recognized_pages}
        if is_usable_text_layer(document_text_layer):
            extraction_methods.add("text")
        text_extraction = (
            next(iter(extraction_methods))
            if len(extraction_methods) == 1
            else "mixed"
        )
        return {
            "ok": True,
            "fileName": file_name,
            "mimeType": mime_type,
            "pageCount": len(page_paths),
            "pages": page_results,
            "documentTypes": document_types,
            "fields": fields,
            "pagePreviews": page_previews,
            "photoCandidates": photo_candidates,
            "textPreview": text[:3000],
            "textExtraction": text_extraction,
            "durationMs": round((time.perf_counter() - started_at) * 1000),
        }


class Handler(BaseHTTPRequestHandler):
    server_version = "AISLocalOCR/1.0"

    def log_message(self, format_string: str, *args: Any) -> None:
        # Do not write document names, OCR text or personal data to logs.
        print(f"{self.address_string()} {self.command} {self.path} {args[1] if len(args) > 1 else ''}")

    def send_json(self, status: int, payload: dict[str, Any]) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        if self.path == "/health":
            self.send_json(200, {"ok": True, "engine": "tesseract", "languages": ["rus", "eng"]})
            return
        self.send_json(404, {"error": "Not found"})

    def do_POST(self) -> None:
        if self.path not in {"/v1/recognize", "/v1/render-page", "/v1/convert-image"}:
            self.send_json(404, {"error": "Not found"})
            return
        try:
            content_length = int(self.headers.get("Content-Length", "0"))
            if content_length <= 0 or content_length > MAX_REQUEST_BYTES:
                raise ValueError("Запрос пустой или превышает допустимый размер.")
            payload = json.loads(self.rfile.read(content_length).decode("utf-8"))
            if self.path == "/v1/render-page":
                result = render_document_page(payload)
            elif self.path == "/v1/convert-image":
                result = convert_image_to_jpeg(payload)
            else:
                result = recognize(payload)
            self.send_json(200, result)
        except subprocess.TimeoutExpired:
            self.send_json(504, {"error": "Истекло время распознавания файла."})
        except (ValueError, RuntimeError, json.JSONDecodeError) as error:
            self.send_json(400, {"error": str(error)})
        except Exception:
            self.send_json(500, {"error": "Внутренняя ошибка локального OCR-сервиса."})


def runtime_health() -> dict[str, Any]:
    languages_output = run_command([TESSERACT_BINARY, "--list-langs"], timeout=30)
    available_languages = {
        line.strip()
        for line in languages_output.splitlines()
        if line.strip() and not line.lower().startswith("list of available")
    }
    required_languages = {"rus", "eng"}
    missing_languages = sorted(required_languages - available_languages)
    if missing_languages:
        raise RuntimeError("Не установлены языки OCR: " + ", ".join(missing_languages))
    return {
        "ok": True,
        "engine": "tesseract",
        "languages": sorted(required_languages),
        "mode": "cli",
    }


def run_cli(arguments: list[str]) -> int:
    try:
        if arguments == ["--health"]:
            payload = runtime_health()
        elif arguments == ["--recognize-stdin"]:
            source = sys.stdin.buffer.read(MAX_REQUEST_BYTES + 1)
            if not source or len(source) > MAX_REQUEST_BYTES:
                raise ValueError("Запрос пустой или превышает допустимый размер.")
            payload = recognize(json.loads(source.decode("utf-8")))
        elif arguments == ["--render-page-stdin"]:
            source = sys.stdin.buffer.read(MAX_REQUEST_BYTES + 1)
            if not source or len(source) > MAX_REQUEST_BYTES:
                raise ValueError("Запрос пустой или превышает допустимый размер.")
            payload = render_document_page(json.loads(source.decode("utf-8")))
        elif arguments == ["--convert-image-stdin"]:
            source = sys.stdin.buffer.read(MAX_REQUEST_BYTES + 1)
            if not source or len(source) > MAX_REQUEST_BYTES:
                raise ValueError("Запрос пустой или превышает допустимый размер.")
            payload = convert_image_to_jpeg(json.loads(source.decode("utf-8")))
        else:
            raise ValueError("Неизвестный режим запуска OCR.")
        sys.stdout.write(json.dumps(payload, ensure_ascii=False, separators=(",", ":")))
        return 0
    except subprocess.TimeoutExpired:
        error = "Истекло время распознавания файла."
    except (ValueError, RuntimeError, json.JSONDecodeError) as exception:
        error = str(exception)
    except Exception:
        error = "Внутренняя ошибка OCR-сервиса."
    sys.stderr.write(json.dumps({"ok": False, "error": error}, ensure_ascii=False))
    return 1


if __name__ == "__main__":
    if len(sys.argv) > 1:
        raise SystemExit(run_cli(sys.argv[1:]))
    print(f"AIS local OCR: http://0.0.0.0:{PORT}")
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()
