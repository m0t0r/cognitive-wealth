# Web research when a page is blocked

Primers and ADRs cite primary sources, and a citation must rest on the page itself. A search engine's summary of a page points you to it; it isn't the source. When WebFetch or `curl` can't open a page, work down this ladder until you can read its text, then quote what it actually says.

## The ladder

1. **WebFetch.** It gets most pages, including NIST, eCFR, IRS and SEC.
2. **A docs site's own text versions.** Many documentation sites publish `<site>/llms.txt` (an index of pages) and a `.md` copy of each page (append `.md` to the page URL). Interactive Brokers' Web API docs do.
3. **agent-browser, headed.** Bot protection (Akamai's "Access Denied", a 403) turns away WebFetch, `curl` and a headless browser alike. A visible browser window usually gets through: Schwab's advisor pages did on 2026-10-24.

   ```sh
   agent-browser session id --scope worktree --prefix task    # prints e.g. task-17c08b6004c3
   agent-browser --session task-17c08b6004c3 --headed open https://advisorservices.schwab.com/…
   agent-browser --session task-17c08b6004c3 wait 3000
   agent-browser --session task-17c08b6004c3 get text body
   agent-browser --session task-17c08b6004c3 close
   ```

   Write the session ID out in each command and open one page per command: the worktree guard refuses shell variables and loops around `agent-browser` (CLAUDE.md, "Worktrees"). If the browser is already running headless, `close` it first, since `--headed` applies when the browser starts.

4. **PDFs.** WebFetch saves the PDF to disk and says where. Read it with the Read tool's `pages` option, which needs poppler (`brew install poppler`).

## When nothing opens the page

Keep only the claims you could read on a page you opened. For each claim that's left:

- find another primary source that states it, or
- label it in the text as general practice ("General practice; each Custodian documents its own format"), or
- drop it.

Say in the PR body which pages you read and how, and which claims you labelled or dropped.
