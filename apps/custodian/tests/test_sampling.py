"""The seeded helpers everything random in the world is built on.

The pinned literals below were captured once from these helpers. They're the point of the file: if
a Python upgrade or an edit changes what a seed gives, these fail before a world quietly changes.
"""

from custodian.sampling import between, chance, pick, shuffled, stream


def test_a_stream_gives_the_same_numbers_for_the_same_label() -> None:
    first = stream("1:plan")
    second = stream("1:plan")

    assert [first.random() for _ in range(3)] == [second.random() for _ in range(3)]


def test_streams_with_different_labels_give_different_numbers() -> None:
    assert stream("1:plan").random() != stream("2:plan").random()
    assert stream("1:plan").random() != stream("1:household:0").random()


def test_drawing_from_one_stream_leaves_another_alone() -> None:
    untouched = stream("1:household:1").random()

    other = stream("1:household:0")
    for _ in range(100):
        other.random()

    assert stream("1:household:1").random() == untouched


def test_a_streams_first_numbers_never_change() -> None:
    rng = stream("pinned")

    assert [rng.random() for _ in range(2)] == [0.36288537974147617, 0.9026227984870481]


def test_the_helpers_results_never_change() -> None:
    rng = stream("pinned")

    assert [between(rng, low=1, high=6) for _ in range(5)] == [3, 6, 4, 5, 4]
    assert pick(rng, ["a", "b", "c", "d"]) == "a"
    assert chance(rng, 0.5) is True
    assert shuffled(rng, [1, 2, 3, 4, 5, 6]) == [3, 1, 5, 6, 2, 4]


def test_between_reaches_both_ends_and_nothing_outside_them() -> None:
    rng = stream("range")

    assert {between(rng, low=3, high=5) for _ in range(200)} == {3, 4, 5}


def test_pick_reaches_every_item() -> None:
    rng = stream("pick")

    assert {pick(rng, ["a", "b", "c"]) for _ in range(200)} == {"a", "b", "c"}


def test_chance_of_zero_never_happens_and_of_one_always_does() -> None:
    rng = stream("chance")

    assert not any(chance(rng, 0.0) for _ in range(200))
    assert all(chance(rng, 1.0) for _ in range(200))


def test_shuffled_keeps_every_item_and_leaves_the_original_alone() -> None:
    original = list(range(20))

    result = shuffled(stream("shuffle"), original)

    assert result != original
    assert sorted(result) == original
    assert original == list(range(20))
