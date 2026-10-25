"""What the package scripts' command-line entry points share."""

import sys
from collections.abc import Sequence


def script_args(argv: Sequence[str] | None = None) -> list[str]:
    """The arguments a package script was given, without a leading `--`.

    pnpm 12 forwards a script's arguments without needing `--`, and passes one on when it's there:
    `pnpm feed:write -- --date …` runs `python -m custodian.feed -- --date …`. argparse reads
    everything after `--` as positional, so `--date` would go missing; dropping a leading one makes
    both forms work.
    """
    args = list(sys.argv[1:] if argv is None else argv)
    return args[1:] if args[:1] == ["--"] else args
