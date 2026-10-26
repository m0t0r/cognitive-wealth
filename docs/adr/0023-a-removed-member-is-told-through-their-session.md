# ADR 0023: A removed member is told through a notice on their session

- Status: accepted
- Date: 2026-10-26

When a member's active Firm drops them, `getViewer` moves their session to their most recent other membership, or to none (ADR 0002), and says nothing: they suddenly see another Firm's Households, or `/no-workspace`'s "You're not in a workspace yet". In an adviser's app, landing in another Firm's records unannounced risks acting on the wrong Households. [ADR 0022](0022-a-firm-that-leaves-is-deactivated.md) tells the members of a **Deactivated Firm** from the data, since their `member` rows stay (its point 10). A **Removal** (`GLOSSARY.md`) deletes the `member` row, and the `org.member.removed` audit event names only that row's `publicId`, so nothing left in the data says the User was ever in the Firm (#207).

1. **The notice is stored on the session.** When `getViewer` moves a session off a Firm whose membership is gone, it writes that Firm's id to the session row in the same `internalAdapter.updateSession` call that moves `activeOrganizationId`, so the Redis cache stays in step (ADR 0005). A fresh session's first pick of a Firm isn't a move. `getViewer` runs in prefetches and Server Actions too, so the notice is stored whichever request does the move, and it survives the redirect to `/no-workspace`. Showing it only on that request was rejected for ADR 0022's reason: the request may render no page. A cookie can't hold it, because `getViewer` runs in Server Components, which can't set one.
2. **Recording the removal durably was rejected.** The User's `publicId` on the audit event, read on every request, would query `audit_event` by its JSON metadata, follow the User into every later session, and lean on a table row-level security doesn't cover (ADR 0020). Keeping the `member` row with a `removed_at` would fight Better Auth, which deletes it.
3. **One notice per session, the newest.** A second move before the first notice is seen replaces it: the notice is there to say which Firm the User is in now, and the earlier Firm was never on screen.
4. **Removed wins over deactivated.** If the Firm was also deactivated, the notice says the User was removed: once they're off its staff, its status is no longer theirs to know.
5. **It lasts until it's no longer needed.** On an app page it shows on every page until the User dismisses it, switches workspace, or rejoins that Firm; the second sentence names the Firm they're in when the page renders, so it never goes stale. On `/no-workspace` it stays while the session has no Firm, so a reload keeps the explanation. Dismissing clears it from the session through a Server Action. Signing out ends the session and the notice with it.
6. **It names the Firm, not who removed them.** The User knew the Firm, so naming it is nothing new; naming a colleague puts them on a decision the Firm should explain itself. No email is sent.

## Consequences

- Each session is told on its own: a second device gets its own notice when its own session is moved.
- A User who signs out before reading `/no-workspace` signs back in to its generic text, which says "You're not in a workspace" without "yet", so it holds for them too.
- The `session` table gains a nullable column. Firms can't be deleted (ADR 0021), so it can't dangle.
