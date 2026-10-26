"""The custodian's FastAPI app. Uvicorn (`pnpm dev`) and `TestClient` both load `app` from here."""

import json
import os
from collections.abc import AsyncGenerator, Mapping
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Literal

from fastapi import FastAPI
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel
from sqlalchemy.orm import Session

from custodian.build_record import check_build, market_inputs
from custodian.contract import openapi_for
from custodian.database import engine_from_env

__all__ = ["OPENAPI_PATH", "HealthResponse", "app"]

OPENAPI_PATH = Path(__file__).parents[2] / "openapi.json"
"""`apps/custodian/openapi.json`, committed so Cognitive Wealth builds without Python running."""


class _Custodian(FastAPI):
    def openapi(self) -> dict[str, object]:
        # FastAPI calls this for /openapi.json, which /docs and /redoc read. Built once, as
        # FastAPI's own is, but with the feed's models in it too (contract.py).
        if self.openapi_schema is None:
            self.openapi_schema = openapi_for(self)
        return self.openapi_schema


def _check_market_inputs(environ: Mapping[str, str] = os.environ) -> None:
    """Refuse to start without the pinned Factor file, or on a database built from other inputs.

    Raises `FactorFileError` or `BuildMismatch`. Without `DATABASE_URL` (`pnpm dev`, which serves
    no data yet), there's no history to protect, and only the Factor file is checked.
    """
    inputs = market_inputs(environ)
    if not environ.get("DATABASE_URL"):
        return
    engine = engine_from_env(environ)
    try:
        with Session(engine) as session:
            check_build(session, inputs)
    finally:
        engine.dispose()


@asynccontextmanager
async def _lifespan(app: FastAPI) -> AsyncGenerator[None]:
    # The one `async def`: Starlette only takes an async start-up hook. The check itself is plain
    # blocking code, so it runs in a worker thread, as a `def` route does. Raising here stops
    # Uvicorn before it serves anything.
    await run_in_threadpool(_check_market_inputs)
    yield


app = _Custodian(title="Custodian", lifespan=_lifespan)


class HealthResponse(BaseModel):
    status: Literal["ok"]


@app.get("/health")
def health() -> HealthResponse:
    return HealthResponse(status="ok")


if __name__ == "__main__":
    # `pnpm --filter custodian openapi:write`: rewrite openapi.json from the app.
    OPENAPI_PATH.write_text(json.dumps(app.openapi(), indent=2) + "\n")
