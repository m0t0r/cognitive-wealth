"""The local feed store: files kept by key under a directory, as SeaweedFS will keep them (#54)."""

from pathlib import Path

import pytest

from custodian.feed_store import LocalFeedStore


def test_a_file_put_is_got_back_byte_for_byte(tmp_path: Path) -> None:
    store = LocalFeedStore(tmp_path)

    store.put("2026-03-02/prices.csv", b"security,price\nLKBF,10.00\n")

    assert store.get("2026-03-02/prices.csv") == b"security,price\nLKBF,10.00\n"


def test_putting_a_key_again_replaces_its_bytes(tmp_path: Path) -> None:
    store = LocalFeedStore(tmp_path)

    store.put("2026-03-02/prices.csv", b"old\n")
    store.put("2026-03-02/prices.csv", b"new\n")

    assert store.get("2026-03-02/prices.csv") == b"new\n"


def test_list_names_the_keys_under_a_prefix_in_order(tmp_path: Path) -> None:
    store = LocalFeedStore(tmp_path)
    for key in ["2026-03-02/prices.csv", "2026-02-27/prices.csv", "2026-03-02/accounts.csv"]:
        store.put(key, b"")

    assert store.list("2026-03-02/") == ["2026-03-02/accounts.csv", "2026-03-02/prices.csv"]
    assert store.list("") == [
        "2026-02-27/prices.csv",
        "2026-03-02/accounts.csv",
        "2026-03-02/prices.csv",
    ]


def test_a_missing_key_is_a_lookup_error(tmp_path: Path) -> None:
    store = LocalFeedStore(tmp_path)

    with pytest.raises(LookupError, match=r"2026-03-02/manifest\.json"):
        store.get("2026-03-02/manifest.json")
    assert store.list("2026-03-02/") == []


@pytest.mark.parametrize("key", ["../outside.csv", "/etc/passwd", "a/../../b.csv", ""])
def test_a_key_cannot_reach_outside_the_root(tmp_path: Path, key: str) -> None:
    store = LocalFeedStore(tmp_path / "feed")

    with pytest.raises(ValueError, match="key"):
        store.put(key, b"")
