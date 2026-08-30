from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Literal, Optional

from pydantic import BaseModel, Field


class Mode(str, Enum):
    demo = "demo"
    prop = "prop"
    live = "live"


class SystemState(str, Enum):
    running = "running"
    stopped = "stopped"
    halted = "halted"


class MarketTick(BaseModel):
    ts: datetime
    symbol: str
    bid: float
    ask: float
    spread: float
    source: Literal["SIM", "MT5"] = "SIM"


class BiasPoint(BaseModel):
    tf: Literal["D1", "H8", "H1", "M15", "M1"]
    bias: Literal["UP", "DOWN", "NEUTRAL"]
    confidence: float = Field(ge=0.0, le=1.0)
    regime: Literal["TREND", "RANGE", "TRANSITION", "NEWS_RISK", "DEAD"]
    updated_at: datetime


class DecisionIntent(BaseModel):
    ts: datetime
    symbol: str
    action: Literal["NO_TRADE", "BUY", "SELL"]
    reason: str
    bias: list[BiasPoint]
    confidence: float = Field(ge=0.0, le=1.0)
    size: float = Field(ge=0.0, description="Lot size / risk unit; interpreted by router")
    stop_pips: float = Field(ge=0.0)
    take_pips: float = Field(ge=0.0)


class OrderRequest(BaseModel):
    ts: datetime
    symbol: str
    side: Literal["BUY", "SELL"]
    size: float
    order_type: Literal["MARKET"] = "MARKET"
    stop_pips: float
    take_pips: float
    client_order_id: str


class ExecutionEvent(BaseModel):
    ts: datetime
    symbol: str
    client_order_id: str
    status: Literal["ACCEPTED", "REJECTED", "FILLED", "CLOSED"]
    message: str
    fill_price: Optional[float] = None


class HealthSummary(BaseModel):
    ts: datetime
    system_state: SystemState
    mode: Mode
    kill_switch: bool
    last_tick_age_ms: Optional[int]
    last_decision_age_ms: Optional[int]
    notes: list[str] = []

