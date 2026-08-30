from __future__ import annotations

import random
import time
from collections.abc import Callable
from typing import ParamSpec, TypeVar

P = ParamSpec("P")
R = TypeVar("R")


def with_retry(
    *,
    attempts: int = 3,
    base_delay_s: float = 0.2,
    max_delay_s: float = 2.0,
    jitter_s: float = 0.1,
    retry_on: tuple[type[Exception], ...] = (Exception,),
) -> Callable[[Callable[P, R]], Callable[P, R]]:
    """
    Lightweight retry/backoff scaffolding (no external deps).

    Usage:
      @with_retry(attempts=5, base_delay_s=0.1)
      def do_thing(): ...
    """

    def deco(fn: Callable[P, R]) -> Callable[P, R]:
        def wrapped(*args: P.args, **kwargs: P.kwargs) -> R:
            delay = base_delay_s
            last_exc: Exception | None = None
            for i in range(1, attempts + 1):
                try:
                    return fn(*args, **kwargs)
                except retry_on as e:  # noqa: PERF203
                    last_exc = e
                    if i >= attempts:
                        raise
                    sleep_for = min(max_delay_s, delay) + random.uniform(0, jitter_s)
                    time.sleep(sleep_for)
                    delay *= 2
            raise last_exc or RuntimeError("retry: unexpected fallthrough")

        return wrapped

    return deco

