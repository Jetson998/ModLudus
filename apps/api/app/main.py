from datetime import datetime, timezone
from typing import Any

from fastapi import FastAPI
from pydantic import BaseModel, Field, HttpUrl

app = FastAPI(title="ModLudus API", version="0.1.0")


class EndpointProbe(BaseModel):
    api_base_url: HttpUrl
    api_key: str = Field(min_length=1)


@app.get("/health")
def health() -> dict[str, Any]:
    return {"status": "ok", "service": "modludus-api", "time": datetime.now(timezone.utc).isoformat()}


@app.get("/api/v1/product")
def product() -> dict[str, Any]:
    return {
        "name": "ModLudus",
        "positioning": "基于真实业务任务的多模型竞技与智能选型平台",
        "mvp": {"mode": "single-turn-text", "deployment": "single-machine-docker-compose"},
    }


@app.post("/api/v1/endpoints/probe")
def probe_endpoint(payload: EndpointProbe) -> dict[str, Any]:
    # M0 only validates shape. Actual provider calls belong in the worker adapter.
    return {
        "status": "accepted",
        "api_base_url": str(payload.api_base_url).rstrip("/"),
        "models_path": "/v1/models",
        "secret_received": bool(payload.api_key),
    }
