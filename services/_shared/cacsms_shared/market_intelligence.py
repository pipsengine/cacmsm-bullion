from __future__ import annotations

from itertools import combinations
from typing import Any


CURRENCIES = ("AUD", "CAD", "EUR", "NZD", "GBP", "USD", "CHF", "JPY", "XAU")
FX_CURRENCIES = tuple(currency for currency in CURRENCIES if currency != "XAU")
TOP_DOWN_TIMEFRAMES = (
    "YTD", "MN1", "W1", "D1", "H12", "H8", "H6", "H4", "H1", "M30", "M15", "M5", "M1", "TICK"
)
TIMEFRAME_WEIGHTS = {
    "YTD": 0.06, "MN1": 0.12, "W1": 0.14, "D1": 0.18,
    "H12": 0.08, "H8": 0.07, "H6": 0.06, "H4": 0.08,
    "H1": 0.07, "M30": 0.05, "M15": 0.04, "M5": 0.025,
    "M1": 0.015, "TICK": 0.01,
}
HTF = ("MN1", "W1", "D1", "H4")
LTF = ("H1", "M30", "M15", "M5")


def _bounded(value: float, low: float = 0.0, high: float = 100.0) -> float:
    return max(low, min(high, value))


def weighted_strength(values: dict[str, float]) -> float:
    available = [(tf, TIMEFRAME_WEIGHTS[tf]) for tf in TOP_DOWN_TIMEFRAMES if tf in values]
    total_weight = sum(weight for _, weight in available)
    if total_weight <= 0.0:
        return 50.0
    return round(sum(float(values[tf]) * weight for tf, weight in available) / total_weight, 1)


def _pair_symbol(base: str, quote: str, symbols: set[str]) -> tuple[str, str] | None:
    direct = f"{base}{quote}"
    inverse = f"{quote}{base}"
    if direct in symbols:
        return direct, "BUY"
    if inverse in symbols:
        return inverse, "SELL"
    return None


def analyze_matrix(
    matrix: dict[str, dict[str, float]],
    *,
    symbols: list[str] | tuple[str, ...] = (),
    connected: bool = True,
    missing_symbols: list[str] | tuple[str, ...] = (),
) -> dict[str, Any]:
    scores = {currency: weighted_strength(matrix.get(currency, {})) for currency in CURRENCIES}
    ranking = sorted(scores, key=lambda currency: (-scores[currency], currency))
    symbol_set = set(symbols)

    pair_candidates = []
    for left, right in combinations(FX_CURRENCIES, 2):
        strong, weak = (left, right) if scores[left] >= scores[right] else (right, left)
        pair = _pair_symbol(strong, weak, symbol_set)
        if not pair:
            continue
        symbol, action = pair
        gap = scores[strong] - scores[weak]
        pair_candidates.append({
            "symbol": symbol,
            "direction": action,
            "strong_currency": strong,
            "weak_currency": weak,
            "strength_gap": round(gap, 1),
        })
    pair_candidates.sort(key=lambda item: (-item["strength_gap"], item["symbol"]))

    xau_values = matrix.get("XAU", {})
    usd_values = matrix.get("USD", {})
    gaps = {tf: float(xau_values.get(tf, 50.0)) - float(usd_values.get(tf, 50.0)) for tf in TOP_DOWN_TIMEFRAMES}
    weighted_gap = round(scores["XAU"] - scores["USD"], 1)
    direction = "BUY" if weighted_gap >= 8.0 else "SELL" if weighted_gap <= -8.0 else "NEUTRAL"
    sign = 1 if direction == "BUY" else -1 if direction == "SELL" else 0
    supporting = [tf for tf in TOP_DOWN_TIMEFRAMES if sign and gaps[tf] * sign >= 8.0]
    conflicting = [tf for tf in TOP_DOWN_TIMEFRAMES if sign and gaps[tf] * sign <= -8.0]
    htf_ratio = sum(1 for tf in HTF if gaps[tf] * sign >= 8.0) / len(HTF) if sign else 0.0
    ltf_ratio = sum(1 for tf in LTF if gaps[tf] * sign >= 5.0) / len(LTF) if sign else 0.0
    data_quality = (1.0 if connected else 0.0) * max(0.0, 1.0 - len(missing_symbols) / max(1, len(symbols)))
    confidence = round(_bounded(
        min(abs(weighted_gap) / 40.0, 1.0) * 35.0
        + htf_ratio * 30.0
        + ltf_ratio * 15.0
        + data_quality * 20.0
    ))

    if not connected or data_quality < 0.85:
        verdict = "NO_TRADE"
    elif abs(weighted_gap) >= 20.0 and htf_ratio >= 0.75 and ltf_ratio >= 0.5 and confidence >= 70:
        verdict = "TECHNICAL_READY"
    elif abs(weighted_gap) >= 12.0 and htf_ratio >= 0.5 and confidence >= 55:
        verdict = "SETUP_FORMING"
    elif abs(weighted_gap) >= 8.0:
        verdict = "WATCH"
    else:
        verdict = "NO_TRADE"

    if htf_ratio >= 0.75 and ltf_ratio >= 0.5:
        regime = "TREND"
    elif direction == "NEUTRAL" or abs(weighted_gap) < 8.0:
        regime = "RANGE"
    else:
        regime = "TRANSITION"

    risk_flags = ["NEWS_STATUS_UNKNOWN"]
    if not connected:
        risk_flags.append("FEED_DISCONNECTED")
    if missing_symbols:
        risk_flags.append("INCOMPLETE_SYMBOL_BASKET")
    if htf_ratio < 0.75:
        risk_flags.append("HTF_NOT_FULLY_ALIGNED")
    if conflicting:
        risk_flags.append("TIMEFRAME_CONFLICT")
    if ltf_ratio < 0.5:
        risk_flags.append("LTF_NOT_CONFIRMED")

    if verdict == "TECHNICAL_READY":
        reason = f"XAU is {abs(weighted_gap):.1f} points {'stronger' if direction == 'BUY' else 'weaker'} than USD with technical confirmation; news and execution checks remain required."
    elif verdict == "SETUP_FORMING":
        reason = f"The XAUUSD strength gap is directional, but confirmation is incomplete on {', '.join(conflicting or [tf for tf in LTF if tf not in supporting])}."
    elif verdict == "WATCH":
        reason = "A directional XAUUSD gap exists, but higher-timeframe confluence is not sufficient for a trade-ready judgment."
    else:
        reason = "No trade: the feed, strength gap, or timeframe alignment does not meet the advisory thresholds."

    return {
        "engine": "SYSTEM_RULES_V1",
        "advisory_only": True,
        "verdict": verdict,
        "symbol": "XAUUSD",
        "direction": direction,
        "confidence": confidence,
        "regime": regime,
        "strength_gap": weighted_gap,
        "xau_strength": scores["XAU"],
        "usd_strength": scores["USD"],
        "strongest": {"currency": ranking[0], "score": scores[ranking[0]]},
        "weakest": {"currency": ranking[-1], "score": scores[ranking[-1]]},
        "supporting_timeframes": supporting,
        "conflicting_timeframes": conflicting,
        "data_quality": round(data_quality * 100.0),
        "risk_flags": risk_flags,
        "reason": reason,
        "candidate_pairs": pair_candidates[:3],
    }


def analyze_history(rows: list[dict[str, Any]]) -> dict[str, Any]:
    usable = [row for row in rows if isinstance(row.get("values"), dict)]
    if not usable:
        return {
            "engine": "SYSTEM_RULES_V1", "advisory_only": True, "verdict": "INSUFFICIENT_DATA",
            "direction": "NEUTRAL", "confidence": 0, "samples": 0,
            "risk_flags": ["NO_HISTORY"], "reason": "No strength history is available for persistence analysis.",
        }

    window = usable[: min(60, len(usable))]
    latest = window[0]["values"]
    oldest = window[-1]["values"]
    latest_gap = float(latest.get("XAU", 50.0)) - float(latest.get("USD", 50.0))
    oldest_gap = float(oldest.get("XAU", 50.0)) - float(oldest.get("USD", 50.0))
    direction = "BUY" if latest_gap >= 8.0 else "SELL" if latest_gap <= -8.0 else "NEUTRAL"
    sign = 1 if direction == "BUY" else -1 if direction == "SELL" else 0
    aligned = sum(
        1 for row in window
        if (float(row["values"].get("XAU", 50.0)) - float(row["values"].get("USD", 50.0))) * sign >= 8.0
    ) if sign else 0
    persistence = aligned / len(window)
    reversal = latest_gap * oldest_gap < 0.0 and abs(latest_gap - oldest_gap) >= 12.0
    raw_confidence = min(abs(latest_gap) / 40.0, 1.0) * 55.0 + persistence * 45.0
    sample_factor = 0.4 + 0.6 * min(len(window) / 20.0, 1.0)
    confidence = round(_bounded(raw_confidence * sample_factor)) if sign else 0

    if len(window) < 5:
        verdict = "INSUFFICIENT_DATA"
    elif reversal:
        verdict = "REVERSAL"
    elif direction != "NEUTRAL" and len(window) >= 10 and persistence >= 0.8:
        verdict = "PERSISTENT"
    elif direction != "NEUTRAL":
        verdict = "DEVELOPING"
    else:
        verdict = "NEUTRAL"

    ranked = sorted(CURRENCIES, key=lambda currency: (-float(latest.get(currency, 50.0)), currency))
    gap_change = round(latest_gap - oldest_gap, 1)
    risk_flags = []
    if len(window) < 10:
        risk_flags.append("LIMITED_HISTORY_SAMPLE")
    if reversal:
        risk_flags.append("RECENT_REVERSAL")
    if persistence < 0.6:
        risk_flags.append("LOW_PERSISTENCE")

    if verdict == "PERSISTENT":
        reason = f"The XAUUSD {direction.lower()} strength relationship persisted through {persistence * 100:.0f}% of the latest {len(window)} changed snapshots."
    elif verdict == "REVERSAL":
        reason = f"The XAUUSD strength gap reversed and changed by {gap_change:+.1f} points across the sampled history."
    elif verdict == "DEVELOPING":
        reason = "The latest XAUUSD direction is present but has not persisted long enough to confirm stability."
    elif verdict == "NEUTRAL":
        reason = "The latest XAUUSD strength gap is below the directional threshold."
    else:
        reason = "More changed strength snapshots are required before judging persistence."

    return {
        "engine": "SYSTEM_RULES_V1",
        "advisory_only": True,
        "verdict": verdict,
        "symbol": "XAUUSD",
        "direction": direction,
        "confidence": confidence,
        "samples": len(window),
        "persistence_percent": round(persistence * 100.0),
        "current_gap": round(latest_gap, 1),
        "gap_change": gap_change,
        "strongest": {"currency": ranked[0], "score": float(latest.get(ranked[0], 50.0))},
        "weakest": {"currency": ranked[-1], "score": float(latest.get(ranked[-1], 50.0))},
        "risk_flags": risk_flags,
        "reason": reason,
    }
