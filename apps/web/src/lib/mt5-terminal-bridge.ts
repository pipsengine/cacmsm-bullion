import "server-only";

import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type Mt5TerminalSnapshot = {
  ok: boolean;
  connected: boolean;
  captured_at: string;
  error?: string;
  terminal: Record<string, unknown>;
  account: {
    login: number; server: string; company: string; currency: string; leverage: number;
    balance: number; equity: number; margin: number; free_margin: number; margin_level: number;
    floating_pl: number; profit_today: number; swap_today: number; commission_today: number;
    deposits_total: number; credit: number; trade_allowed: boolean;
  };
  symbols: Array<Record<string, unknown>>;
  positions: Array<Record<string, unknown>>;
  pending_orders: Array<Record<string, unknown>>;
  deals: Array<Record<string, unknown>>;
};

export async function readMt5Terminal(): Promise<Mt5TerminalSnapshot> {
  const python = process.env.MT5_PYTHON?.trim() || "python";
  const script = process.env.MT5_SNAPSHOT_SCRIPT?.trim()
    || path.resolve(process.cwd(), "../../scripts/mt5_snapshot.py");
  try {
    const { stdout } = await execFileAsync(python, [script], {
      windowsHide: true,
      timeout: 15_000,
      maxBuffer: 4 * 1024 * 1024,
      env: { ...process.env, PYTHONIOENCODING: "utf-8" }
    });
    const snapshot = JSON.parse(stdout.trim()) as Mt5TerminalSnapshot;
    if (!snapshot.ok || !snapshot.account) throw new Error(snapshot.error || "MT5 returned no account snapshot.");
    return snapshot;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to read the local MT5 terminal: ${message}`);
  }
}

export async function readMt5MarketData(mode: "status" | "snapshot" | "history", hours = 24, limit = 1000): Promise<Record<string, unknown>> {
  const cacheKey = `${mode}:${hours}:${limit}`;
  const holder = globalThis as typeof globalThis & {
    __cacsmsMt5MarketCache?: Map<string, { expires: number; value?: Record<string, unknown>; pending?: Promise<Record<string, unknown>> }>;
  };
  const cache = holder.__cacsmsMt5MarketCache ?? (holder.__cacsmsMt5MarketCache = new Map());
  const cached = cache.get(cacheKey);
  if (cached?.value && cached.expires > Date.now()) return cached.value;
  if (cached?.pending) return cached.pending;

  const pending = readMt5MarketDataUncached(mode, hours, limit);
  cache.set(cacheKey, { expires: 0, pending });
  try {
    const value = await pending;
    cache.set(cacheKey, { expires: Date.now() + 1_000, value });
    return value;
  } catch (error) {
    cache.delete(cacheKey);
    throw error;
  }
}

async function readMt5MarketDataUncached(mode: "status" | "snapshot" | "history", hours: number, limit: number): Promise<Record<string, unknown>> {
  const python = process.env.MT5_PYTHON?.trim() || "python";
  const script = process.env.MT5_MARKET_SCRIPT?.trim()
    || path.resolve(process.cwd(), "../../scripts/mt5_market_data.py");
  try {
    const args = [script, mode];
    if (mode === "history") args.push("--hours", String(hours), "--limit", String(limit));
    if (mode === "snapshot") args.push("--hours", String(hours));
    const { stdout } = await execFileAsync(python, args, {
      windowsHide: true, timeout: 20_000, maxBuffer: 8 * 1024 * 1024,
      env: { ...process.env, PYTHONIOENCODING: "utf-8" }
    });
    const result = JSON.parse(stdout.trim()) as Record<string, unknown>;
    if (result.ok === false) throw new Error(String(result.error || "MT5 market data unavailable."));
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to read MT5 market ${mode}: ${message}`);
  }
}
