"""Document text extraction (PDF / DOCX) with an OCR hook.

Primary path uses PyMuPDF (fast, accurate for digital PDFs); pdfplumber is a
fallback for tricky layouts/tables. Scanned/image-only PDFs would route to OCR
(Tesseract) — the hook is provided but OCR is optional at runtime.
"""
from __future__ import annotations

import io
import logging

logger = logging.getLogger(__name__)


def extract_text_from_pdf(data: bytes) -> str:
    """Extract text from a PDF, trying PyMuPDF then pdfplumber."""
    text = _extract_pymupdf(data)
    if text and text.strip():
        return text
    logger.info("PyMuPDF returned empty text, falling back to pdfplumber")
    return _extract_pdfplumber(data)


def _extract_pymupdf(data: bytes) -> str:
    try:
        import fitz  # PyMuPDF

        parts: list[str] = []
        with fitz.open(stream=data, filetype="pdf") as doc:
            for page in doc:
                parts.append(page.get_text("text"))
        return "\n".join(parts)
    except Exception as exc:  # pragma: no cover - defensive
        logger.warning("PyMuPDF extraction failed: %s", exc)
        return ""


def _extract_pdfplumber(data: bytes) -> str:
    try:
        import pdfplumber

        parts: list[str] = []
        with pdfplumber.open(io.BytesIO(data)) as pdf:
            for page in pdf.pages:
                parts.append(page.extract_text() or "")
        return "\n".join(parts)
    except Exception as exc:  # pragma: no cover - defensive
        logger.warning("pdfplumber extraction failed: %s", exc)
        return ""


def extract_text_from_docx(data: bytes) -> str:
    """Extract text from a .docx file."""
    try:
        from docx import Document

        document = Document(io.BytesIO(data))
        return "\n".join(p.text for p in document.paragraphs)
    except Exception as exc:  # pragma: no cover - defensive
        logger.warning("docx extraction failed: %s", exc)
        return ""


def ocr_image_pdf(data: bytes) -> str:  # pragma: no cover - optional dependency
    """OCR fallback for scanned PDFs (requires Tesseract + pytesseract)."""
    try:
        import fitz
        import pytesseract
        from PIL import Image

        parts: list[str] = []
        with fitz.open(stream=data, filetype="pdf") as doc:
            for page in doc:
                pix = page.get_pixmap(dpi=200)
                img = Image.open(io.BytesIO(pix.tobytes("png")))
                parts.append(pytesseract.image_to_string(img, lang="fra+eng"))
        return "\n".join(parts)
    except Exception as exc:
        logger.warning("OCR extraction unavailable: %s", exc)
        return ""


def extract_text(data: bytes, filename: str, content_type: str | None = None) -> str:
    """Dispatch extraction based on file extension / content type."""
    name = (filename or "").lower()
    if name.endswith(".pdf") or (content_type or "").endswith("pdf"):
        text = extract_text_from_pdf(data)
        if not text.strip():
            text = ocr_image_pdf(data)
        return text
    if name.endswith(".docx"):
        return extract_text_from_docx(data)
    # Plain text / unknown -> best effort decode.
    try:
        return data.decode("utf-8", errors="ignore")
    except Exception:  # pragma: no cover
        return ""
