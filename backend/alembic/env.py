"""Alembic environment - online migrations using the app settings + metadata."""
from __future__ import annotations

from logging.config import fileConfig

from alembic import context
from sqlalchemy import create_engine, pool

from app.core.config import settings
from app.core.database import Base

# Import all models so they register on Base.metadata for autogenerate.
import app.models  # noqa: F401

config = context.config
# NOTE: we deliberately do NOT call config.set_main_option("sqlalchemy.url", ...).
# Alembic routes that value through configparser, which treats '%' as
# interpolation syntax and breaks on URL-encoded passwords (e.g. %2C, %25).
# Instead we build the engine directly from settings.DATABASE_URL below.

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def run_migrations_offline() -> None:
    """Run migrations without a DB connection (emit SQL)."""
    context.configure(
        url=settings.DATABASE_URL,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    """Run migrations with a live DB connection."""
    connect_args: dict = {}
    if settings.DB_DISABLE_PREPARED_STATEMENTS:
        connect_args["prepare_threshold"] = None

    # Build directly from the settings URL (bypasses configparser interpolation).
    connectable = create_engine(
        settings.DATABASE_URL,
        poolclass=pool.NullPool,
        connect_args=connect_args,
    )
    with connectable.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
