#!/usr/bin/env python3
"""Install the optional local OCR at startup, without receiving any documents."""

import argparse
import contextlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time
import venv

SOURCE_ROOT = Path(__file__).resolve().parent


@contextlib.contextmanager
def installation_lock(root):
    """OS-owned lock: concurrent CGI starts cannot install into the same environment."""
    handle = (root / "install.lock").open("a+b")
    locked = False
    try:
        if os.name == "nt":
            import msvcrt
            handle.seek(0)
            try:
                msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
                locked = True
            except OSError:
                pass
        else:
            import fcntl
            try:
                fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
                locked = True
            except OSError:
                pass
        yield locked
    finally:
        if locked and os.name == "nt":
            handle.seek(0)
            msvcrt.locking(handle.fileno(), msvcrt.LK_UNLCK, 1)
        handle.close()


def write_state(root, revision, status, **extra):
    payload = {"revision": revision, "status": status, "updatedAt": int(time.time() * 1000), **extra}
    temporary = root / f"state-{os.getpid()}.tmp"
    temporary.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    os.replace(temporary, root / "state.json")


def run(command, *, env=None, timeout=600):
    options = {"cwd": str(SOURCE_ROOT), "env": env, "timeout": timeout, "check": True, "stdin": subprocess.DEVNULL}
    if os.name == "nt":
        options["creationflags"] = subprocess.CREATE_NO_WINDOW
    subprocess.run([str(part) for part in command], **options)


def probe(python, model_root=None, *, download=False):
    env = dict(os.environ)
    if model_root is not None:
        env["OCR_MODEL_DIR"] = str(model_root)
    # Import/version checks and ONNX session creation validate libraries AND model files.
    code = (
        "import server,importlib.metadata,pathlib; "
        "requirements=pathlib.Path('requirements.txt').read_text().splitlines(); "
        "assert all(importlib.metadata.version(line.split('==')[0]) == line.split('==')[1] "
        "for line in requirements if '==' in line); "
        "assert server.cv2 is not None and server.np is not None; "
        f"assert server.get_neural_ocr(download_models={download!r}) is not None"
    )
    try:
        run([python, "-c", code], env=env, timeout=600 if download else 90)
        return True
    except (OSError, subprocess.SubprocessError):
        return False


def ensure_runtime(root, revision):
    root.mkdir(parents=True, exist_ok=True)
    with installation_lock(root) as acquired:
        if not acquired:
            return False
        write_state(root, revision, "checking")
        print("[OCR] Проверка дополнительного движка и кириллических моделей...", flush=True)
        try:
            if probe(sys.executable):
                write_state(root, revision, "ready", mode="base")
                return True
            python = root / "venv" / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
            models = root / "models"
            if python.is_file() and probe(python, models):
                write_state(root, revision, "ready", mode="managed")
                return True
            write_state(root, revision, "installing")
            print("[OCR] Установка библиотек в отдельное окружение АИС...", flush=True)
            if sys.version_info < (3, 10):
                raise RuntimeError("Для набора библиотек OCR требуется Python 3.10 или новее.")
            venv.EnvBuilder(with_pip=True).create(root / "venv")
            run([python, "-m", "pip", "--isolated", "install", "--disable-pip-version-check", "--no-input",
                 "--index-url", "https://pypi.org/simple", "--only-binary=:all:",
                 "--no-binary=antlr4-python3-runtime",
                 "-r", SOURCE_ROOT / "requirements.txt"], timeout=900)
            if not probe(python, models):
                # Keep a recoverable copy if models were truncated or damaged.
                if models.exists():
                    models.rename(root / f"models-backup-{time.time_ns()}")
                print("[OCR] Загрузка моделей распознавания (без передачи документов)...", flush=True)
                if not probe(python, models, download=True):
                    raise RuntimeError("Модели не установлены или не запускаются.")
            if not probe(python, models):
                raise RuntimeError("Проверка установленного движка не пройдена.")
            write_state(root, revision, "ready", mode="managed")
            print("[OCR] Дополнительный движок установлен и проверен.", flush=True)
            return True
        except Exception as error:
            # Detailed diagnostics stay only in the private installation log.
            print(f"[OCR] {type(error).__name__}: {error}", file=sys.stderr, flush=True)
            write_state(root, revision, "failed", error="Дополнительный OCR не установлен. Проверьте интернет, Python 3.10+, модуль venv и права записи. Основной OCR продолжает работу; установка будет повторена при следующем запуске.")
            return False


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--runtime-root", required=True)
    parser.add_argument("--revision", required=True)
    args = parser.parse_args()
    root = Path(args.runtime_root).resolve()
    allowed = (SOURCE_ROOT / "runtime" / "neural").resolve()
    if root.parent != allowed or not re.fullmatch(r"[a-f0-9]{20}", root.name) or not re.fullmatch(r"[a-f0-9]{64}", args.revision):
        parser.error("Invalid managed OCR runtime path or revision")
    return 0 if ensure_runtime(root, args.revision) else 1


if __name__ == "__main__":
    raise SystemExit(main())
