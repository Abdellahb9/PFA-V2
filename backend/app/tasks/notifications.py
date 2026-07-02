"""Celery task: dispatch notification emails (assignment results, etc.).

For the PFE scope this records notifications and simulates delivery; wiring a
real SMTP server is a one-line change in ``_deliver``.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime

from app.core.celery_app import celery_app
from app.core.database import SessionLocal
from app.models.notification import Notification, NotificationStatus

logger = logging.getLogger(__name__)


def _deliver(notification: Notification) -> None:
    """Send the notification. Replace with real SMTP/Sendgrid integration."""
    # Example real implementation:
    #   import smtplib; with smtplib.SMTP(host) as s: s.send_message(msg)
    logger.info("EMAIL -> %s | %s", notification.recipient_email, notification.subject)


@celery_app.task(name="app.tasks.notifications.send_email")
def send_email(recipient: str, subject: str, body: str, application_id: int | None = None) -> dict:
    """Persist and 'send' a single email notification."""
    db = SessionLocal()
    try:
        notification = Notification(
            recipient_email=recipient,
            subject=subject,
            body=body,
            application_id=application_id,
            status=NotificationStatus.QUEUED,
        )
        db.add(notification)
        db.commit()
        db.refresh(notification)

        try:
            _deliver(notification)
            notification.status = NotificationStatus.SENT
            notification.sent_at = datetime.now(UTC)
        except Exception as exc:  # pragma: no cover
            notification.status = NotificationStatus.FAILED
            notification.error = str(exc)
        db.commit()
        return {"notification_id": notification.id, "status": notification.status.value}
    finally:
        db.close()
