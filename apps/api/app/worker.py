"""M0 worker entry point. Queue and provider adapters land in M1."""

import time


def main() -> None:
    print("ModLudus worker ready: queue adapter is planned for M1.", flush=True)
    while True:
        time.sleep(60)


if __name__ == "__main__":
    main()
