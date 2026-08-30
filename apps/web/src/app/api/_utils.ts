export function env(name: string, fallback: string) {
  return process.env[name] || fallback;
}

export const SERVICE_BASE = {
  control: env("CONTROL_API_URL", "http://localhost:8000"),
  decision: env("DECISION_API_URL", "http://localhost:8002"),
  execution: env("EXECUTION_API_URL", "http://localhost:8003"),
  monitoring: env("MONITORING_API_URL", "http://localhost:8004"),
  market: env("MARKET_API_URL", "http://localhost:8001")
};

