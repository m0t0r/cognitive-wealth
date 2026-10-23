# ADR 0006: Sign-in emails are sent after the response

- Status: accepted
- Date: 2026-10-22

Requesting a sign-in email returns the same `{ status: true }` for every address. If the request did the eligibility check, the rate limits and the send in-line, its latency would reveal which addresses belong to users or invitees. So the request does only work that costs the same for every address (normalize the email, read the device cookie, resolve the client IP and user agent), and everything else runs in a background task built from those captured values.

`apps/web` runs that task with Next's `after()`. The package default, for callers outside Next, starts it in-process, which only works in a long-lived Node process. Measured on the standalone build, warm responses for known and unknown addresses took the same time (5.2 ms against 4.4 ms on average, within noise).

## Consequences

- **Deployment requirement:** the host must keep `after()` work alive. `next start` and the Docker image do, and drain pending tasks on SIGTERM, so give the platform a stop grace period of 10 to 30 seconds. Serverless hosts must wire `waitUntil` into `after()`. On a host that freezes the process after the response, sign-in emails silently never send.
- A failure in the background task is logged, and the stored link deleted. The response never changes, so failures show up only in logs.
- Better Auth's own `backgroundTasks` handler stays unset: the combined link-and-code email depends on its callbacks being awaited.
