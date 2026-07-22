"""Persistent single-machine worker for trusted-season jobs."""

import asyncio

from .trusted_season import TrustedSeasonWorker


def main() -> None:
    worker = TrustedSeasonWorker.from_environment()
    print(f"ModLudus trusted worker ready: {worker.worker_id}", flush=True)
    asyncio.run(worker.run_forever())


if __name__ == "__main__":
    main()
