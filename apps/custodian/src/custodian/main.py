"""The custodian's FastAPI app. Uvicorn (`pnpm dev`) and `TestClient` both load `app` from here."""

import json
from pathlib import Path
from typing import Literal

from fastapi import FastAPI
from pydantic import BaseModel

from custodian.contract import openapi_for

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


app = _Custodian(title="Custodian")


class HealthResponse(BaseModel):
    status: Literal["ok"]


@app.get("/health")
def health() -> HealthResponse:
    return HealthResponse(status="ok")


if __name__ == "__main__":
    # `pnpm --filter custodian openapi:write`: rewrite openapi.json from the app.
    OPENAPI_PATH.write_text(json.dumps(app.openapi(), indent=2) + "\n")
