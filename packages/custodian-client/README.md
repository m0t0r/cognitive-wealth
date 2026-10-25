# @repo/custodian-client

Cognitive Wealth's only way to the custodian. The custodian is a Python service that shares no code with the TypeScript packages ([ADR 0011](../../docs/adr/0011-custodian-simulator-in-python.md)), so this package is generated from its published contract, [`apps/custodian/openapi.json`](../../apps/custodian/openapi.json), by [Orval](https://orval.dev). It gives Cognitive Wealth's server code:

- **A strict Zod schema for every component** of the contract, the Custodian feed's rows and Manifest included, though no route returns them: `SecurityRow`, `AccountRow`, `TransactionRow`, `PositionRow`, `PriceRow`, `Manifest`. Ingestion checks every row of a Delivery with them, so nothing from the custodian is trusted.
- **A `fetch` client** for the custodian's routes (only `GET /health` for now). Every response is parsed with its Zod schema before it's returned.

It's imported as source, like the other workspace packages, and only from server code: the browser never talks to the custodian.

## Using it

```ts
import {
  custodianUrl,
  healthHealthGet,
  PositionRow,
  type PositionRowOutput,
} from "@repo/custodian-client";

// A feed row, read from a Delivery's CSV (an empty value read as null):
const position: PositionRowOutput = PositionRow.parse(csvRow);
position.marketValue; // "3000.00"

// A route: the request goes to CUSTODIAN_URL, and the response is Zod-parsed.
const { data } = await healthHealthGet();
```

### Where the custodian is

Every request goes to **`CUSTODIAN_URL`**, an absolute `http` or `https` URL such as `http://127.0.0.1:8000`, read when the request is made (`src/base-url.ts`). It has no default. Under portless the custodian is at an `https://….localhost` address whose local CA Node doesn't trust, so a guessed default would fail in a more confusing way. When it's missing or malformed, the call throws before anything is sent.

### Names: snake_case on the wire, camelCase in TypeScript

The custodian names fields the Python way (`account_number`), and so do the feed's CSV headers and `openapi.json`. Each generated schema checks those `snake_case` keys, then renames them to camelCase in a `.transform()`. So every schema has two types:

| Type                | Is                         | Fields                                     |
| ------------------- | -------------------------- | ------------------------------------------ |
| `PositionRow`       | `zod.input`: what arrives  | `account_number`, `shares`, `market_value` |
| `PositionRowOutput` | `zod.output`: what you use | `accountNumber`, `shares`, `marketValue`   |

Request bodies aren't renamed back: a generated function that sends one takes the `snake_case` input type. No route takes a body yet. The convention for them is decided with the fee files (#19), and documented with the read endpoints (#55).

### Money stays a string

Money, Shares and Price arrive as decimal strings and stay strings: a JSON number would have gone through a float ([ADR 0013](../../docs/adr/0013-money-shares-prices-and-rates-are-separate-types.md)). The schemas check the scale the custodian always sends:

| Type   | Pattern           | Example     |
| ------ | ----------------- | ----------- |
| Money  | `^-?\d+\.\d{2}$`  | `-9.00`     |
| Shares | `^-?\d+\.\d{6}$`  | `40.000000` |
| Price  | `^-?\d+(\.\d+)?$` | `150.25`    |

## Regenerating

`src/generated/` is Orval's output. Never edit it by hand. It's excluded from Oxlint and Oxfmt, so it stays byte for byte what Orval writes. After the custodian's contract changes:

```sh
pnpm --filter custodian openapi:write              # rewrite apps/custodian/openapi.json from the app
pnpm --filter @repo/custodian-client generate      # rewrite src/generated/ from it
```

Commit both. The settings are in `orval.config.ts`: the `fetch` client, one Zod module (`schemas/index.zod.ts`), strict objects, runtime validation of responses, `CUSTODIAN_URL` as the base URL, and camelCase property names.

To browse the contract instead of reading JSON, run the custodian (`pnpm --filter custodian dev`) and open `/docs`: Swagger UI shows every route and, under **Schemas**, every row with each column's description.

## Tests

`pnpm --filter @repo/custodian-client test` runs, in Node:

- `feed.test.ts`: every row of the two example Deliveries in `apps/custodian/fixtures/feed/` (2 and 6 March) parses; amounts sent as JSON numbers, at the wrong scale or malformed, bad dates, unknown columns and a Manifest without `format_version` are rejected; and fields come out camelCase. The custodian's integration tests keep those Deliveries equal to what its writer writes, and `pnpm --filter custodian feed:examples` rewrites them.
- `generated.test.ts`: Orval run into a temporary folder gives exactly `src/generated/`, so the generated code can't drift from `openapi.json`.
- `client.test.ts` and `base-url.test.ts`: requests go to `CUSTODIAN_URL`, a response the contract doesn't allow is rejected, and nothing is sent without a valid URL.
