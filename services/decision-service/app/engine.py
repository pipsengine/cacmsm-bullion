from __future__ import annotations

import logging
import threading
import time
from collections import deque
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Deque, Literal, Optional

from redis import Redis

from cacsms_shared.persistence import EventStore
from cacsms_shared.redis_streams import xadd_json, xread_entries_json

log = logging.getLogger(__name__)


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def parse_iso(ts: str) -> datetime:
    return datetime.fromisoformat(ts.replace("Z", "+00:00"))


@dataclass
class Bias:
    tf: Literal["D1", "H8", "H1", "M15", "M1"]
    bias: Literal["UP", "DOWN", "NEUTRAL"]
    confidence: float
    regime: Literal["TREND", "RANGE", "TRANSITION", "NEWS_RISK", "DEAD"]
    updated_at: str


class DecisionEngine:
    """
    MVP decision engine:
    - regime filter: spread + simple volatility proxy
    - multi-timeframe bias: EMA slope approximations on rolling windows
    - returns DecisionIntent objects to stream:decisions

    This is intentionally simple and deterministic, to provide a working end-to-end skeleton.
    Replace with trained models later.
    """

    def __init__(
        self,
        *,
        redis_client: Redis,
        symbol: str,
        stream_market: str,
        stream_decisions: str,
        key_last_decision_ts: str,
        key_last_market_id: str,
        control_key: str,
        kill_key: str,
        mode_key: str,
        event_store: EventStore | None = None,
    ):
        self._thread: Optional[threading.Thread] = None
        self._stop = threading.Event()
        self._last_id = "$"
        self._mid_prices: Deque[float] = deque(maxlen=2400)  # ~10min at 250ms
        self._spreads: Deque[float] = deque(maxlen=600)
        self._r = redis_client
        self._symbol = symbol
        self._stream_market = stream_market
        self._stream_decisions = stream_decisions
        self._key_last_decision_ts = key_last_decision_ts
        self._key_last_market_id = key_last_market_id
        self._control_key = control_key
        self._kill_key = kill_key
        self._mode_key = mode_key
        self._event_store = event_store

    def start(self):
        if self._thread and self._thread.is_alive():
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._thread.start()

    def stop(self):
        self._stop.set()

    def _ema(self, values: list[float], alpha: float) -> float:
        if not values:
            return 0.0
        ema = values[0]
        for v in values[1:]:
            ema = alpha * v + (1 - alpha) * ema
        return ema

    def _slope_score(self, window: int) -> float:
        # crude slope proxy: ema_fast - ema_slow over window
        if len(self._mid_prices) < window:
            return 0.0
        vals = list(self._mid_prices)[-window:]
        fast = self._ema(vals, alpha=2 / (max(3, window // 6) + 1))
        slow = self._ema(vals, alpha=2 / (max(6, window // 2) + 1))
        return fast - slow

    def _regime(self, spread: float, vol: float) -> tuple[str, bool]:
        # MVP rules:
        # - dead if volatility too low
        # - news risk not implemented (placeholder)
        # - block if spread too high
        if spread > 0.9:
            return "TRANSITION", False
        if vol < 0.02:
            return "DEAD", False
        if vol > 0.22:
            return "TRANSITION", True
        return "TREND", True

    def _bias_from_score(self, score: float, scale: float = 0.25) -> tuple[str, float]:
        # map score to direction + confidence
        if abs(score) < 0.01:
            return "NEUTRAL", 0.35
        conf = min(0.95, max(0.35, abs(score) / scale))
        return ("UP" if score > 0 else "DOWN"), float(conf)

    def _compute_bias(self) -> list[Bias]:
        # Approximate multi-timeframe with different windows over same intraday stream
        # (In production: compute from real MT5 bars per timeframe.)
        tf_windows = {
            "M1": 120,    # ~30s
            "M15": 720,   # ~3m
            "H1": 1400,   # ~6m
            "H8": 2200,   # ~9m
            "D1": 2400,   # ~10m (placeholder)
        }
        spreads = list(self._spreads)
        spread = spreads[-1] if spreads else 0.2
        # vol proxy: std of returns
        prices = list(self._mid_prices)
        if len(prices) < 50:
            vol = 0.0
        else:
            rets = [prices[i] - prices[i - 1] for i in range(1, min(len(prices), 300))]
            mean = sum(rets) / len(rets)
            var = sum((x - mean) ** 2 for x in rets) / max(1, len(rets) - 1)
            vol = var ** 0.5

        regime, tradable = self._regime(spread=spread, vol=vol)
        out: list[Bias] = []
        for tf, w in tf_windows.items():
            score = self._slope_score(w) if tradable else 0.0
            bias, conf = self._bias_from_score(score)
            out.append(
                Bias(
                    tf=tf,  # type: ignore[arg-type]
                    bias=bias,  # type: ignore[arg-type]
                    confidence=conf if tradable else 0.0,
                    regime=regime,  # type: ignore[arg-type]
                    updated_at=utc_now().isoformat(),
                )
            )
        return out

    def _run(self):
        stored_last_id = self._r.get(self._key_last_market_id)
        if stored_last_id:
            self._last_id = stored_last_id

        while not self._stop.is_set():
            running = self._r.get(self._control_key) == "1"
            kill = self._r.get(self._kill_key) == "1"
            if (not running) or kill:
                time.sleep(0.5)
                continue

            entries, self._last_id = xread_entries_json(
                self._r, stream=self._stream_market, last_id=self._last_id, block_ms=1200, count=100
            )
            if not entries:
                continue

            for redis_id, tick in entries:
                if tick.get("symbol") != self._symbol:
                    continue
                bid = float(tick["bid"])
                ask = float(tick["ask"])
                spread = float(tick["spread"])
                mid = (bid + ask) / 2
                self._mid_prices.append(mid)
                self._spreads.append(spread)
                if self._event_store:
                    # Best-effort persistence of inbound market events.
                    try:
                        self._event_store.append(
                            event_type="market_tick",
                            payload=tick,
                            stream=self._stream_market,
                            redis_id=redis_id,
                        )
                    except Exception:  # noqa: BLE001
                        log.exception("failed to persist market_tick")

            bias = self._compute_bias()
            # MVP action selection: trade only if M1 agrees with H1 and confidence passes threshold
            m1 = next(b for b in bias if b.tf == "M1")
            h1 = next(b for b in bias if b.tf == "H1")
            action = "NO_TRADE"
            reason = "Regime/bias not aligned"
            conf = float(min(m1.confidence, h1.confidence))

            if m1.regime in ("DEAD",) or conf < 0.70:
                action = "NO_TRADE"
                reason = "Low confidence or dead regime"
            elif m1.bias == h1.bias and m1.bias != "NEUTRAL":
                action = "BUY" if m1.bias == "UP" else "SELL"
                reason = "M1 aligned with H1"

            size = 0.10 if (self._r.get(self._mode_key) or "demo") != "live" else 0.05
            stop_pips = 120.0  # placeholder: gold points/pips depend on broker symbol
            take_pips = 140.0

            payload = {
                "ts": utc_now().isoformat(),
                "symbol": self._symbol,
                "action": action,
                "reason": reason,
                "bias": [b.__dict__ for b in bias],
                "confidence": conf,
                "size": size if action != "NO_TRADE" else 0.0,
                "stop_pips": stop_pips,
                "take_pips": take_pips,
            }
            xadd_json(self._r, self._stream_decisions, payload)
            self._r.set(self._key_last_market_id, self._last_id)
            self._r.set(self._key_last_decision_ts, payload["ts"])
            if self._event_store:
                try:
                    self._event_store.append(
                        event_type="decision_intent",
                        payload=payload,
                        stream=self._stream_decisions,
                        redis_id=None,
                    )
                except Exception:  # noqa: BLE001
                    log.exception("failed to persist decision_intent")
