FROM python:3.12-slim-bookworm

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    OCR_PORT=8083

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        imagemagick \
        libgl1 \
        libglib2.0-0 \
        poppler-utils \
        tesseract-ocr \
        tesseract-ocr-eng \
        tesseract-ocr-rus \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r /app/requirements.txt
COPY server.py /app/server.py
# Download public model weights only at installation, not while reading documents.
RUN python -c "import server; assert server.get_neural_ocr(download_models=True) is not None"

RUN useradd --create-home --uid 10001 ocr \
    && chown -R ocr:ocr /app

USER ocr
EXPOSE 8083

CMD ["python", "-u", "/app/server.py"]
