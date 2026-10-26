"""The reaper image comes from docker/testcontainers/Dockerfile, the one pin Dependabot bumps.

No Docker needed: these only read files. They live next to reaper.py, which they test.
"""

import re
from pathlib import Path

import pytest

from tests.integration.reaper import reaper_image

RYUK = "testcontainers/ryuk:0.14.0@sha256:aaaa"


def write_dockerfile(directory: Path, contents: str) -> Path:
    file = directory / "Dockerfile"
    file.write_text(contents)
    return file


def test_reads_the_from_line_past_its_comments(tmp_path: Path) -> None:
    file = write_dockerfile(
        tmp_path, f"# Never built.\n# FROM in a comment: ignored\nFROM {RYUK}\n"
    )

    assert reaper_image(file) == RYUK


# `parametrize` runs the test once per value, like Vitest's `test.for`.
@pytest.mark.parametrize("contents", ["FROM testcontainers/ryuk:0.14.0\n", "# empty\n"])
def test_refuses_a_file_without_a_tag_and_digest_pin(tmp_path: Path, contents: str) -> None:
    file = write_dockerfile(tmp_path, contents)

    with pytest.raises(LookupError, match="must pin testcontainers/ryuk by tag@digest"):
        reaper_image(file)


def test_reads_the_repos_pin_by_default() -> None:
    assert re.fullmatch(r"testcontainers/ryuk:[^@\s]+@sha256:[0-9a-f]{64}", reaper_image())
