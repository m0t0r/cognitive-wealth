"""The custodian's FastAPI app. `fastapi dev` and `TestClient` both load `app` from here."""

from typing import Literal

from fastapi import FastAPI
from pydantic import BaseModel

app = FastAPI(title="Custodian")


class Health(BaseModel):
    status: Literal["ok"]


@app.get("/health")
def health() -> Health:
    return Health(status="ok")
