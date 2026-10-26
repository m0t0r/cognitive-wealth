# Web research when a page is blocked

A citation rests on the page itself, read by you. A search engine's summary of a page tells you where to look; quote the page. When WebFetch can't open a page, work down this ladder until you can read its text.

## The ladder

1. **WebFetch.** It opens most pages; NIST's opened on 2026-10-24.
2. **A docs site's own text versions.** Many documentation sites publish `<site>/llms.txt` (an index of pages) and a `.md` copy of each page (append `.md` to the page URL). Interactive Brokers' Web API docs did on 2026-10-24.
3. **agent-browser, headed.** Bot protection (Akamai's "Access Denied", a 403) turns away WebFetch, `curl` and a headless browser alike. A visible browser window usually opens the page: Schwab's advisor pages did on 2026-10-24.

   ```sh
   agent-browser session id --scope worktree --prefix task    # prints e.g. task-17c08b6004c3
   agent-browser --session task-17c08b6004c3 --headed open https://advisorservices.schwab.com/managing-your-business/tech-integration/daily-data-files
   agent-browser --session task-17c08b6004c3 wait 3000
   agent-browser --session task-17c08b6004c3 get text body
   agent-browser --session task-17c08b6004c3 close
   ```

   Spell the session ID out in each command and open one page per command, as the worktree rules in CLAUDE.md require. `--headed` takes effect when the browser starts, so `close` a headless one first.

   Some sites refuse a second navigation in the same session: on investor.gov (2026-10-25) the first page opened and the next `open` failed with `net::ERR_HTTP2_PROTOCOL_ERROR`, every retry. Then `close` and reopen the session headed for each page, as above. For several pages, put the four commands in a loop in a `.dev/scratch/` script (`for url in "$@"`) and run it with `sh <file> <url> ...`, since loops can't run in the Bash tool from a worktree; give a reviewer subagent the same script.

4. **Another copy of the same primary text.** US government sites turn away WebFetch: eCFR redirects to `unblock.federalregister.gov`, and congress.gov, senate.gov and federalregister.gov return a 403 or a bot check. The same text is published where WebFetch can read it:

   | Text                                | Fetchable copy                                                                  |
   | ----------------------------------- | ------------------------------------------------------------------------------- |
   | a CFR rule (e.g. 17 CFR 240.15c6-1) | govinfo's link service (below), or `law.cornell.edu/cfr/text/<title>/<section>` |
   | a U.S. Code section                 | `law.cornell.edu/uscode/text/<title>/<section>`                                 |
   | a public law                        | govinfo.gov                                                                     |
   | a CRS report                        | its PDF download, not the HTML page                                             |

   For a CFR section, govinfo's link service finds the annual CFR volume itself, so it needs no volume number, and WebFetch reads it: `https://www.govinfo.gov/link/cfr/<title>/<part>?sectionnum=<section>&year=mostrecent&link-type=xml` (for 17 CFR 275.204-2: `/link/cfr/17/275?sectionnum=204-2`). Title 17's annual edition is as of April 1, so it can lag eCFR by months, and so can Cornell's copy: name the edition you read. eCFR itself is no fallback: in a headed agent-browser on 2026-10-26, `get text body` returned only "Unsupported format" (#209).

   Link the official page in the text if you like, but say which copy you read.

5. **PDFs.** WebFetch saves the PDF to disk and says where. Read it with the Read tool's `pages` option, which needs poppler (`brew install poppler`). Without poppler, extract the text with pypdf: a three-line script in `.dev/scratch/` (`PdfReader(sys.argv[1]).pages`, printing each page's `extract_text()`), run with `uv run --no-project --with pypdf python -I <script> <pdf>`.

## Checking an invented identifier isn't a real ticker

The synthetic world uses no real tickers, CUSIPs or ISINs. Check each new Security identifier against Nasdaq Trader's symbol directories, which cover every US-listed symbol and open with plain `curl` or WebFetch: `https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqlisted.txt` (Nasdaq) and `.../otherlisted.txt` (NYSE and the other exchanges), pipe-separated with the symbol first. From a `.dev/scratch/` script (the command holds a URL), `curl -s <url> | grep "^<ID>|"` for each file: no output means it isn't listed; check a real one such as `AAPL` first, so a failed download doesn't read as a pass. The SEC's `company_tickers.json` files return a block page unless the User-Agent names a contact email, which an agent doesn't send for the user (#198).

## When nothing opens the page

Keep only the claims you read on a page you opened. For each claim that's left, find another primary source, label it in the text as general practice, or drop it. Say in the PR body which pages you read and how, and which claims you labelled or dropped.
