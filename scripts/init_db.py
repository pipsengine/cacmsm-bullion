from __future__ import annotations

import os

from cacsms_shared.persistence import create_db_engine, init_db


def main() -> None:
    url = os.environ.get("DATABASE_URL")
    if not url:
        raise SystemExit("DATABASE_URL is required")
    engine = create_db_engine(url)
    init_db(engine)
    print("ok: created tables")


if __name__ == "__main__":
    main()

