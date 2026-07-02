"""ORM models package.

Importing every model here guarantees they are registered on the shared
declarative ``Base.metadata`` before Alembic autogenerate / create_all runs.
"""

from app.models.application import Application, ApplicationStatus
from app.models.assignment import Assignment, AssignmentStatus
from app.models.candidate import Candidate, CandidateSkill
from app.models.department import Department
from app.models.document import Document, DocumentKind
from app.models.document_chunk import DocumentChunk
from app.models.matching_run import MatchingRun, MatchingRunStatus
from app.models.notification import Notification, NotificationStatus
from app.models.offer import InternshipOffer, OfferSkill, OfferStatus
from app.models.skill import Skill, SkillCategory
from app.models.user import User, UserRole

__all__ = [
    "Application",
    "ApplicationStatus",
    "Assignment",
    "AssignmentStatus",
    "Candidate",
    "CandidateSkill",
    "Department",
    "Document",
    "DocumentChunk",
    "DocumentKind",
    "InternshipOffer",
    "OfferSkill",
    "OfferStatus",
    "MatchingRun",
    "MatchingRunStatus",
    "Notification",
    "NotificationStatus",
    "Skill",
    "SkillCategory",
    "User",
    "UserRole",
]
