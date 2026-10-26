"""The run's reaper: Ryuk removes the run's containers however the run ends (#173).

The `register` tests need no Docker: a fake Ryuk on a local port plays the parts that matter.
The last test starts a real Ryuk.
"""

import socket
import threading
import time
from collections.abc import Generator, Sequence
from contextlib import contextmanager, suppress
from dataclasses import dataclass, field
from typing import Literal
from uuid import uuid4

import pytest
from docker.errors import NotFound
from testcontainers.core.container import DockerContainer

from tests.integration.postgres import compose_image
from tests.integration.reaper import register, start_reaper

FILTER = "label=org.testcontainers.session-id=probe"


@dataclass
class FakeRyuk:
    address: tuple[str, int]
    filters: list[str] = field(default_factory=list[str])
    """The filter lines it answered with `ACK`."""


type Miss = Literal["drop", "hang"]
"""What Docker Desktop's port forwarder does to a connection made before Ryuk listens: close it
unanswered, or accept it and never answer (#173)."""


@contextmanager
def fake_ryuk(*, misses: Sequence[Miss] = ()) -> Generator[FakeRyuk]:
    """A local server that answers each filter line with `ACK`, as Ryuk does.

    Its first connections get `misses`, one each, before one is answered.
    """
    server = socket.create_server(("127.0.0.1", 0))
    host, port = server.getsockname()
    ryuk = FakeRyuk(address=(host, port))
    hanging: list[socket.socket] = []

    def serve() -> None:
        for miss in [*misses, None]:
            try:
                connection, _ = server.accept()
            except OSError:
                return  # The test closed the server: it's done with this Ryuk.
            if miss == "drop":
                connection.close()
            elif miss == "hang":
                hanging.append(connection)
            else:
                ryuk.filters.append(connection.recv(1024).decode())
                connection.sendall(b"ACK\n")
                # Hold the link open, as Ryuk does, until the test closes it.
                connection.recv(1024)
                connection.close()

    # A daemon thread doesn't keep the test process alive if a test fails before it ends.
    thread = threading.Thread(target=serve, daemon=True)
    thread.start()
    try:
        yield ryuk
    finally:
        server.close()
        for connection in hanging:
            connection.close()


def test_registers_the_filter_with_a_ryuk_that_acks_it() -> None:
    with fake_ryuk() as ryuk:
        register(ryuk.address, filter=FILTER, timeout=5).close()

    assert ryuk.filters == [f"{FILTER}\n"]


def test_retries_until_a_connection_is_acked() -> None:
    with fake_ryuk(misses=["drop", "drop"]) as ryuk:
        register(ryuk.address, filter=FILTER, timeout=5).close()

    assert ryuk.filters == [f"{FILTER}\n"]


def test_gives_up_on_a_silent_connection_and_tries_another() -> None:
    """One silent connection mustn't use up the whole `timeout`."""
    with fake_ryuk(misses=["hang"]) as ryuk:
        register(ryuk.address, filter=FILTER, timeout=5).close()

    assert ryuk.filters == [f"{FILTER}\n"]


def test_refuses_a_ryuk_that_never_acks() -> None:
    """Better a run that fails to start than one whose containers outlive it unnoticed."""
    misses: list[Miss] = ["drop"] * 1_000
    with (
        fake_ryuk(misses=misses) as ryuk,
        pytest.raises(TimeoutError, match="didn't acknowledge"),
    ):
        register(ryuk.address, filter=FILTER, timeout=0.5)

    assert ryuk.filters == []


def test_ryuk_removes_the_matching_containers_once_the_link_closes() -> None:
    """What happens when a run ends without stopping its containers: a kill, a second Ctrl-C."""
    value = uuid4().hex
    # A label of the test's own (the org.testcontainers namespace is reserved), so Ryuk removes
    # this container only.
    link = start_reaper(filter=f"label=test-reaper={value}", reconnection_timeout="1s")
    container = (
        DockerContainer(compose_image())
        .with_command("sleep 600")
        .with_kwargs(labels={"test-reaper": value})
        .start()
    )
    try:
        link.close()

        deadline = time.monotonic() + 20
        while time.monotonic() < deadline and exists(container):
            time.sleep(0.5)
        assert not exists(container)
    finally:
        with suppress(NotFound):
            container.stop()


def exists(container: DockerContainer) -> bool:
    try:
        container.get_wrapped_container().reload()
    except NotFound:
        return False
    return True
