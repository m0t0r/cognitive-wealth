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

4. **PDFs.** WebFetch saves the PDF to disk and says where. Read it with the Read tool's `pages` option, which needs poppler (`brew install poppler`).

## When nothing opens the page

Keep only the claims you read on a page you opened. For each claim that's left, find another primary source, label it in the text as general practice, or drop it. Say in the PR body which pages you read and how, and which claims you labelled or dropped.
