"""The custodian's published contract: its OpenAPI document (ADR 0011).

Cognitive Wealth can't import this code, so it generates a `fetch` client and Zod schemas from
`openapi.json` (`packages/custodian-client`). Next to the routes, the document carries the
Custodian feed's row models and Manifest as components, though no route returns them yet, so
Ingestion validates each row against the same shapes the writer uses.

The running app serves it at `/openapi.json`, and FastAPI's API docs at `/docs` (Swagger UI)
and `/redoc` show it as pages, Schemas included. `pnpm --filter custodian openapi:write` writes
the same document to `openapi.json` (main.py).
"""

from fastapi import FastAPI
from fastapi.openapi.utils import get_openapi
from pydantic import BaseModel
from pydantic.json_schema import models_json_schema

from custodian.feed import AccountRow, Manifest, PositionRow, PriceRow, SecurityRow, TransactionRow

__all__ = ["FEED_MODELS", "openapi_for"]

FEED_MODELS: list[type[BaseModel]] = [
    AccountRow,
    Manifest,
    PositionRow,
    PriceRow,
    SecurityRow,
    TransactionRow,
]
"""The feed's models. A model they use, such as `ManifestFile` or an enum, comes along."""


def openapi_for(app: FastAPI) -> dict[str, object]:
    """`app`'s routes as OpenAPI, plus the feed's models under `components.schemas`."""
    document = get_openapi(title=app.title, version=app.version, routes=app.routes)
    # "serialization": the rows as the custodian writes them, not as it would read them.
    _, feed = models_json_schema(
        [(model, "serialization") for model in FEED_MODELS],
        ref_template="#/components/schemas/{model}",
    )
    components: dict[str, dict[str, object]] = document.setdefault("components", {})
    schemas = components.setdefault("schemas", {})
    schemas |= feed["$defs"]
    # Sorted by name, as FastAPI sorts the routes' own, so the file reads alphabetically.
    components["schemas"] = dict(sorted(schemas.items()))
    return document
