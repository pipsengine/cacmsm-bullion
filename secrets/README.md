## Secrets (placeholders)

This repository intentionally does **not** contain real secrets.

Recommended patterns:
- Local dev: create a `.env` file (not committed) based on `.env.example`.
- Production: use your platform's secret manager (Kubernetes Secrets, AWS Secrets Manager, Vault, GitHub Actions secrets, etc.).

Suggested secret items (examples):
- `POSTGRES_PASSWORD`
- MT5 account credentials (ONLY on your MT5 machine; never in containers)

This folder can also be used for Docker secrets in production deployments (example structure):
```
secrets/
  postgres_password.txt
  redis_password.txt
```

