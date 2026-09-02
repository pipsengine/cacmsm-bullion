from __future__ import annotations

import importlib.util
import os
import sqlite3
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace


def load_market_module():
    module_path = Path(__file__).parents[1] / "services" / "market-data-service" / "app" / "main.py"
    spec = importlib.util.spec_from_file_location("market_history_test", module_path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    import_dir = Path(tempfile.mkdtemp())
    config_path = import_dir / "config.yaml"
    config_path.write_text(
        f"services:\n  market-data-service:\n    tick_db_path: {import_dir.as_posix()}/import-ticks.sqlite3\n",
        encoding="utf-8",
    )
    previous_config = os.environ.get("CONFIG_FILE")
    os.environ["CONFIG_FILE"] = str(config_path)
    try:
        spec.loader.exec_module(module)
    finally:
        if previous_config is None:
            os.environ.pop("CONFIG_FILE", None)
        else:
            os.environ["CONFIG_FILE"] = previous_config
    return module


def test_relative_strength_percentages_have_unique_extremes():
    market = load_market_module()
    values = {currency: float(index) for index, currency in enumerate(market.CCY_ROWS)}
    values["JPY"] = 7.9999

    percentages = market.normalize_strength_percentages(values)

    assert percentages["AUD"] == 0.0
    assert percentages["XAU"] == 100.0
    assert list(percentages.values()).count(0.0) == 1
    assert list(percentages.values()).count(100.0) == 1
    assert percentages["JPY"] == 99.9


def test_flat_snapshot_is_neutral_without_artificial_extremes():
    market = load_market_module()

    percentages = market.normalize_strength_percentages({currency: 0.0 for currency in market.CCY_ROWS})

    assert set(percentages.values()) == {50.0}


def test_cad_strength_increases_when_cad_outperforms_chf():
    market = load_market_module()
    references = {symbol: 1.0 for symbol in market.DEFAULT_SYMBOLS}
    latest = {symbol: {"mid": price} for symbol, price in references.items()}
    latest["CADCHF"] = {"mid": 1.01}

    scores = market.compute_currency_values(latest, references)

    assert scores["CAD"] > 0.0
    assert scores["CHF"] < 0.0
    assert scores["CAD"] > scores["CHF"]


def test_tick_history_is_newest_first_percent_data(tmp_path: Path):
    market = load_market_module()
    store = market.TickStore(str(tmp_path / "ticks.sqlite3"), hours=24)
    now = datetime.now(timezone.utc).timestamp()
    rows = []
    for offset, multiplier in ((-2.0, 1.001), (-1.0, 1.002), (0.0, 1.003)):
        epoch = now + offset
        stamp = datetime.fromtimestamp(epoch, timezone.utc).isoformat()
        for symbol in market.DEFAULT_SYMBOLS:
            mid = 1.0
            if symbol == "EURUSD":
                mid *= multiplier
            rows.append((symbol, stamp, epoch, mid, mid, 0.0, mid, "MT5"))
    store.insert_many(rows)
    feed = market.MarketFeed(
        settings=SimpleNamespace(symbols=market.DEFAULT_SYMBOLS, feed_mode="MT5", history_hours=24),
        store=store,
    )

    payload = feed.build_history(hours=24, limit=2)

    assert payload["sampling"] == "tick"
    assert payload["value_unit"] == "percent"
    assert payload["row_interval_seconds"] is None
    assert len(payload["rows"]) == 2
    assert payload["rows"][0]["timestamp_utc"] > payload["rows"][1]["timestamp_utc"]
    for row in payload["rows"]:
        percentages = list(row["values"].values())
        assert all(0.0 <= value <= 100.0 for value in percentages)
        assert percentages.count(0.0) <= 1
        assert percentages.count(100.0) <= 1


def test_tick_store_rejects_simulated_rows(tmp_path: Path):
    market = load_market_module()
    store = market.TickStore(str(tmp_path / "ticks.sqlite3"), hours=24)
    now = datetime.now(timezone.utc).timestamp()
    stamp = datetime.fromtimestamp(now, timezone.utc).isoformat()

    store.insert_many([("CADCHF", stamp, now, 1.0, 1.0, 0.0, 1.0, "SIM")])

    assert store.symbols_since(since_s=now - 1, symbols=["CADCHF"]) == []


def test_legacy_tick_schema_is_migrated_and_purged(tmp_path: Path):
    market = load_market_module()
    db_path = tmp_path / "legacy-ticks.sqlite3"
    with sqlite3.connect(db_path) as connection:
        connection.execute(
            """CREATE TABLE ticks (
                symbol TEXT NOT NULL, ts_utc TEXT NOT NULL, ts_epoch REAL NOT NULL,
                bid REAL NOT NULL, ask REAL NOT NULL, spread REAL NOT NULL, mid REAL NOT NULL,
                PRIMARY KEY (symbol, ts_epoch)
            )"""
        )
        connection.execute(
            "INSERT INTO ticks VALUES (?, ?, ?, ?, ?, ?, ?)",
            ("CADCHF", "2026-09-02T09:00:00+00:00", 1.0, 0.58, 0.59, 0.01, 0.585),
        )

    store = market.TickStore(str(db_path), hours=24)

    assert store.purged_non_mt5 == 1
    assert store.symbols_since(since_s=0, symbols=["CADCHF"]) == []
