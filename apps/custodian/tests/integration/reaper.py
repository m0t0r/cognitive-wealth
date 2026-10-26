"""The run's reaper: Testcontainers' Ryuk, told which containers to remove when the run ends.

Ryuk removes the containers matching its filters once its last client has been gone for
`RYUK_RECONNECTION_TIMEOUT`, so they go however the run ends: a second Ctrl-C, a SIGTERM, a kill.

This replaces testcontainers-python's own reaper, which (4.15.0) can't be relied on (#173): it
connects before Ryuk listens and never checks Ryuk's `ACK`, so on Docker Desktop the filter can
be lost and nothing is ever removed (testcontainers-python#1114), and at exit it force-removes
Ryuk before Ryuk can remove anything (testcontainers-python#1140). Once both fixes are released,
this module can give way to the library's reaper again.
"""

import atexit
import re
import socket
import time
from functools import cache
from pathlib import Path

from testcontainers.core.config import testcontainers_config
from testcontainers.core.container import DockerContainer
from testcontainers.core.labels import LABEL_SESSION_ID, SESSION_ID

__all__ = ["REAPER_PIN", "reap_this_session", "reaper_image", "register", "start_reaper"]

REAPER_PIN = Path(__file__).parents[4] / "docker/testcontainers/Dockerfile"
"""Pins Testcontainers' reaper for both harnesses; Dependabot bumps it (see the file's header)."""

# `re.MULTILINE` makes `^` and `$` match at each line, so comment lines can't match.
_PINNED = re.compile(r"^FROM\s+(testcontainers/ryuk:[^@\s]+@sha256:[0-9a-f]+)\s*$", re.MULTILINE)

ACK = b"ACK\n"
"""Ryuk's answer to each filter line: it has stored the filter."""

ATTEMPT_TIMEOUT = 1.0
"""Seconds one connection gets to be answered. A listening Ryuk answers in milliseconds."""


def reaper_image(file: Path = REAPER_PIN) -> str:
    """The reaper image, `tag@digest`, from the pin file's `FROM` line.

    The TypeScript harness reads the same line (packages/testing/src/reaper.ts).
    """
    # `:=` assigns and tests in one step, like `if ((match = …))` in TypeScript.
    if match := _PINNED.search(file.read_text()):
        return match.group(1)
    raise LookupError(f"{file} must pin testcontainers/ryuk by tag@digest")


# The library's containers carry the session label, except one of this image: so this module's
# Ryuk doesn't. And the library starts no reaper of its own.
testcontainers_config.ryuk_image = reaper_image()
testcontainers_config.ryuk_disabled = True


def register(address: tuple[str, int], *, filter: str, timeout: float) -> socket.socket:
    """Send Ryuk a filter and return the link once it has answered `ACK`.

    Only the `ACK` shows Ryuk stored the filter. A connection made before Ryuk listens can still
    be accepted, by Docker Desktop's or docker-proxy's port forwarder, and then dropped or left
    silent, so a connection without one is closed and tried again until `timeout` seconds have
    passed. Each try gets `ATTEMPT_TIMEOUT` at most, so one silent connection can't use them all.
    """
    deadline = time.monotonic() + timeout
    while True:
        attempt_timeout = max(min(ATTEMPT_TIMEOUT, deadline - time.monotonic()), 0.1)
        try:
            with socket.create_connection(address, timeout=attempt_timeout) as link:
                link.sendall(f"{filter}\n".encode())
                if link.recv(len(ACK)) == ACK:
                    # `detach` hands the open connection to a new socket, so leaving the `with`
                    # block doesn't close it.
                    return socket.socket(fileno=link.detach())
        except OSError:
            pass  # Refused, reset or timed out: Ryuk isn't listening yet.
        if time.monotonic() > deadline:
            raise TimeoutError(f"Ryuk at {address} didn't acknowledge {filter!r}")
        time.sleep(0.1)


def start_reaper(*, filter: str, reconnection_timeout: str = "10s") -> socket.socket:
    """Start a Ryuk that removes the containers `filter` matches, and return its link.

    Ryuk does that `reconnection_timeout` after the link closes, then removes itself. The link
    closes when this process ends, however it ends, so nothing here ever stops Ryuk.
    """
    ryuk = (
        DockerContainer(reaper_image())
        .with_exposed_ports(8080)
        .with_volume_mapping(testcontainers_config.ryuk_docker_socket, "/var/run/docker.sock", "rw")
        .with_kwargs(privileged=testcontainers_config.ryuk_privileged, auto_remove=True)
        .with_env("RYUK_RECONNECTION_TIMEOUT", reconnection_timeout)
        .start()
    )
    address = (ryuk.get_container_host_ip(), ryuk.get_exposed_port(8080))
    try:
        return register(address, filter=filter, timeout=30)
    except BaseException:
        # `BaseException` includes Ctrl-C. A Ryuk without a filter would only time out.
        ryuk.stop()
        raise


@cache
def reap_this_session() -> None:
    """Start this process's Ryuk, once (`@cache`), for every container the library starts here.

    Call it before starting one: each carries the session's label, which is Ryuk's filter.
    """
    link = start_reaper(filter=f"label={LABEL_SESSION_ID}={SESSION_ID}")
    # Closing the link at exit only says goodbye early (and spares a ResourceWarning); the
    # process ending closes it anyway.
    atexit.register(link.close)
