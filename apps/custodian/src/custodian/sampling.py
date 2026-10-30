"""Seeded random numbers that stay the same: the same label gives the same numbers, always.

A seeded generator is a long, fixed list of numbers that only looks random. The seed picks which
list, so a world built from one seed can be built again, byte for byte.

Python promises less than that sounds like. Its docs guarantee two things across versions: a
seeder that stays compatible, and that `random()` keeps giving the same numbers from it. "Most of
the random module's algorithms" may change, `choice`, `randint`, `shuffle` and `sample` among them
(https://docs.python.org/3/library/random.html, "Notes on Reproducibility"). So every helper here
is built on `random()` alone, and a Python upgrade can't quietly change a world.

Why a label, not one seed for everything? Each stream is its own list of numbers. If every
Household drew from one stream, then a Household drawing one more number would change every
Household after it. With a stream each, it changes only itself.
"""

import random
from collections.abc import Sequence

__all__ = ["between", "chance", "pick", "shuffled", "stream"]


def stream(label: str) -> random.Random:
    """The stream of random numbers named `label`, such as "1:household:7".

    Version 2 of the seeder hashes all of a string with SHA-512. It's named here so that a new
    default in a later Python can't change what a label gives, and it's a string so that Python's
    per-process `hash()` is never involved.
    """
    rng = random.Random()
    rng.seed(label, version=2)
    return rng


def chance(rng: random.Random, probability: float) -> bool:
    """True with the given probability: 0.25 is true about one time in four."""
    return rng.random() < probability


def between(rng: random.Random, *, low: int, high: int) -> int:
    """A whole number from `low` to `high`, both included."""
    return low + int(rng.random() * (high - low + 1))


def pick[T](rng: random.Random, items: Sequence[T]) -> T:
    """One of `items`, each as likely as any other."""
    return items[between(rng, low=0, high=len(items) - 1)]


def shuffled[T](rng: random.Random, items: Sequence[T]) -> list[T]:
    """A copy of `items` in a random order (a Fisher-Yates shuffle, last place first)."""
    result = list(items)
    for last in range(len(result) - 1, 0, -1):
        swap_with = between(rng, low=0, high=last)
        result[last], result[swap_with] = result[swap_with], result[last]
    return result
