"""The custodian's FastAPI app. Uvicorn (`pnpm dev`) and `TestClient` both load `app` from here."""

from typing import Literal

from fastapi import FastAPI
from pydantic import BaseModel

app = FastAPI(title="Custodian")


class HealthResponse(BaseModel):
    status: Literal["ok"]


@app.get("/health")
def health() -> HealthResponse:
    return HealthResponse(status="ok")
