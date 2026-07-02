"""MinIO / S3-compatible object storage helper for uploaded documents."""

from __future__ import annotations

import io
import uuid
from functools import lru_cache

from minio import Minio

from app.core.config import settings


@lru_cache
def get_minio_client() -> Minio:
    """Return a cached MinIO client configured from settings."""
    return Minio(
        settings.MINIO_ENDPOINT,
        access_key=settings.MINIO_ROOT_USER,
        secret_key=settings.MINIO_ROOT_PASSWORD,
        secure=settings.MINIO_SECURE,
    )


def ensure_bucket() -> None:
    """Create the application bucket if it does not exist yet."""
    client = get_minio_client()
    if not client.bucket_exists(settings.MINIO_BUCKET):
        client.make_bucket(settings.MINIO_BUCKET)


def upload_document(data: bytes, filename: str, content_type: str | None) -> str:
    """Upload bytes and return the generated object key."""
    ensure_bucket()
    client = get_minio_client()
    # Namespace by a UUID to avoid collisions while keeping the original name.
    object_key = f"{uuid.uuid4().hex}/{filename}"
    client.put_object(
        settings.MINIO_BUCKET,
        object_key,
        io.BytesIO(data),
        length=len(data),
        content_type=content_type or "application/octet-stream",
    )
    return object_key


def download_document(object_key: str) -> bytes:
    """Fetch an object's bytes by its key."""
    client = get_minio_client()
    response = client.get_object(settings.MINIO_BUCKET, object_key)
    try:
        return response.read()
    finally:
        response.close()
        response.release_conn()


def delete_document(object_key: str) -> None:
    """Remove a stored object from the bucket (best-effort cleanup)."""
    client = get_minio_client()
    client.remove_object(settings.MINIO_BUCKET, object_key)


def presigned_url(object_key: str, expires_seconds: int = 3600) -> str:
    """Generate a temporary download URL for a stored object."""
    from datetime import timedelta

    client = get_minio_client()
    return client.presigned_get_object(
        settings.MINIO_BUCKET, object_key, expires=timedelta(seconds=expires_seconds)
    )
