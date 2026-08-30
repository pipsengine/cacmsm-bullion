from __future__ import annotations

import json
import logging
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import JSON, Boolean, DateTime, String, Text, UniqueConstraint, create_engine, select
from sqlalchemy.engine import Engine
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column

log = logging.getLogger(__name__)


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    pass


class EventRecord(Base):
    __tablename__ = "event_records"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)

    service: Mapped[str] = mapped_column(String(64), nullable=False)
    event_type: Mapped[str] = mapped_column(String(64), nullable=False)
    stream: Mapped[str | None] = mapped_column(String(128), nullable=True)
    redis_id: Mapped[str | None] = mapped_column(String(128), nullable=True)

    payload: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)


class OrderIdempotencyRecord(Base):
    __tablename__ = "order_idempotency"
    __table_args__ = (UniqueConstraint("idempotency_key", name="uq_order_idempotency_key"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid.uuid4()))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)

    idempotency_key: Mapped[str] = mapped_column(String(128), nullable=False)
    client_order_id: Mapped[str] = mapped_column(String(128), nullable=False)
    payload_json: Mapped[str] = mapped_column(Text, nullable=False)
    routed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    processed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)


def create_db_engine(database_url: str) -> Engine:
    # pool_pre_ping helps long-lived services recover from db restarts.
    return create_engine(database_url, pool_pre_ping=True, future=True)


def init_db(engine: Engine) -> None:
    Base.metadata.create_all(engine)


@dataclass
class EventStore:
    engine: Engine
    service_name: str

    def append(self, *, event_type: str, payload: dict[str, Any], stream: str | None = None, redis_id: str | None = None) -> None:
        with Session(self.engine) as s:
            s.add(
                EventRecord(
                    service=self.service_name,
                    event_type=event_type,
                    payload=payload,
                    stream=stream,
                    redis_id=redis_id,
                )
            )
            s.commit()


@dataclass
class OrderIdempotencyStore:
    engine: Engine

    def register_or_get(self, *, idempotency_key: str, client_order_id: str, payload: dict[str, Any]) -> tuple[bool, str, bool, bool]:
        """
        Returns (created, client_order_id, routed, processed).
        - created=True means this is the first time we see this idempotency_key.
        - created=False means it already existed, and we return the previously stored client_order_id.
        """
        payload_json = json.dumps(payload, separators=(",", ":"), ensure_ascii=False)
        with Session(self.engine) as s:
            rec = OrderIdempotencyRecord(
                idempotency_key=idempotency_key,
                client_order_id=client_order_id,
                payload_json=payload_json,
                processed=False,
            )
            s.add(rec)
            try:
                s.commit()
                return True, client_order_id, False, False
            except IntegrityError:
                s.rollback()
                existing = s.scalar(
                    select(OrderIdempotencyRecord).where(OrderIdempotencyRecord.idempotency_key == idempotency_key)
                )
                if existing:
                    return False, existing.client_order_id, existing.routed, existing.processed
                # Extremely unlikely race; treat as not-created.
                return False, client_order_id, False, False

    def mark_routed(self, *, idempotency_key: str) -> None:
        with Session(self.engine) as s:
            rec = s.scalar(select(OrderIdempotencyRecord).where(OrderIdempotencyRecord.idempotency_key == idempotency_key))
            if not rec:
                return
            rec.routed = True
            s.commit()

    def mark_processed(self, *, idempotency_key: str) -> None:
        with Session(self.engine) as s:
            rec = s.scalar(select(OrderIdempotencyRecord).where(OrderIdempotencyRecord.idempotency_key == idempotency_key))
            if not rec:
                return
            rec.processed = True
            s.commit()
