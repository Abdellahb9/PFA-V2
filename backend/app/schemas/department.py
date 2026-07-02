"""Department schemas."""

from __future__ import annotations

from pydantic import BaseModel


class DepartmentBase(BaseModel):
    name: str
    code: str
    description: str | None = None
    supervisor_name: str | None = None
    supervisor_email: str | None = None
    capacity: int = 0


class DepartmentCreate(DepartmentBase):
    pass


class DepartmentUpdate(BaseModel):
    code: str | None = None
    name: str | None = None
    description: str | None = None
    supervisor_name: str | None = None
    supervisor_email: str | None = None
    capacity: int | None = None


class DepartmentOut(DepartmentBase):
    id: int

    model_config = {"from_attributes": True}
