"""Where the Custodian feed's files are kept: a small interface, so the store can be swapped.

A key is a path such as `2026-03-02/manifest.json`: the Delivery's As-of date, then the file. For
now `LocalFeedStore` keeps each one as a file under a directory; SeaweedFS will take its place
(#54) without anything else changing, since the writer only calls `put`, and readers (the tests
now, Ingestion in #40) only `get` and `list`.
"""

import os
from pathlib import Path, PurePosixPath
from typing import Protocol
from uuid import uuid4

__all__ = ["FeedStore", "LocalFeedStore"]


class FeedStore(Protocol):
    """Anything with these three methods is a feed store; it needn't subclass this."""

    def put(self, key: str, content: bytes) -> None:
        """Store `content` under `key`, replacing it. A reader sees all of it or none."""
        ...

    def get(self, key: str) -> bytes:
        """The bytes stored under `key`, or a LookupError."""
        ...

    def list(self, prefix: str) -> list[str]:
        """Every key that starts with `prefix`, sorted."""
        ...


class LocalFeedStore:
    """A feed store in a local directory: key `2026-03-02/prices.csv` is that file under `root`."""

    def __init__(self, root: Path) -> None:
        self.root = root

    def put(self, key: str, content: bytes) -> None:
        path = self._path(key)
        path.parent.mkdir(parents=True, exist_ok=True)
        # Written beside the file, then renamed over it in one step, so a reader never finds half
        # a file: it finds the old one or the new one. The temporary name is unique, so two
        # writers can't write into the same one, and it's removed if the write fails.
        partial = path.with_name(f".{path.name}.{uuid4().hex}.partial")
        try:
            partial.write_bytes(content)
            os.replace(partial, path)
        finally:
            partial.unlink(missing_ok=True)

    def get(self, key: str) -> bytes:
        try:
            return self._path(key).read_bytes()
        except FileNotFoundError:
            raise LookupError(f"The feed store has no {key}") from None

    def list(self, prefix: str) -> list[str]:
        if not self.root.is_dir():
            return []
        keys = (
            path.relative_to(self.root).as_posix()
            for path in self.root.rglob("*")
            if path.is_file() and not path.name.startswith(".")
        )
        return sorted(key for key in keys if key.startswith(prefix))

    def _path(self, key: str) -> Path:
        """The file for `key`, refusing a key that would land outside `root`."""
        parts = PurePosixPath(key).parts
        if not parts or PurePosixPath(key).is_absolute() or ".." in parts:
            raise ValueError(f"A feed key is a relative path inside the store, not {key!r}")
        return self.root.joinpath(*parts)
