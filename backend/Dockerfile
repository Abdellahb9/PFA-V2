# =============================================================================
# Backend image - FastAPI + Celery + NLP pipeline.
# =============================================================================
FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# System deps for PyMuPDF, pdfplumber, scientific libs and bcrypt.
RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential \
        libpq-dev \
        curl \
        && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --upgrade pip && pip install -r requirements.txt

# Download the French + English spaCy models used by the NLP pipeline.
RUN python -m spacy download fr_core_news_md && \
    python -m spacy download en_core_web_sm

# Pre-download the Sentence-Transformers embedding model so the first request
# (and startup seeding) does not block on a network download at runtime.
RUN python -c "from sentence_transformers import SentenceTransformer; \
    SentenceTransformer('sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2')"

COPY . .

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
