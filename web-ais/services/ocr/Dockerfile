FROM python:3.12-slim-bookworm

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    OCR_PORT=8083

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        imagemagick \
        poppler-utils \
        tesseract-ocr \
        tesseract-ocr-eng \
        tesseract-ocr-rus \
    && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir opencv-python-headless==4.10.0.84

WORKDIR /app
COPY server.py /app/server.py

RUN useradd --create-home --uid 10001 ocr \
    && chown -R ocr:ocr /app

USER ocr
EXPOSE 8083

CMD ["python", "-u", "/app/server.py"]
