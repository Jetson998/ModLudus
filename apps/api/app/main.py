from datetime import datetime, timezone
from typing import Any

from fastapi import FastAPI, Header, HTTPException, Request, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, HttpUrl

from .trusted_season import SEASON_ID, TrustedSeasonRuntime

app = FastAPI(title="ModLudus API", version="0.3.2")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type", "X-ModLudus-Admin-Token"],
)
trusted_runtime = TrustedSeasonRuntime.from_environment()


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


@app.get("/api/v1/trusted-seasons/status")
def trusted_season_status() -> dict[str, Any]:
    return trusted_runtime.status()


@app.get("/api/v1/trusted-seasons/runs")
def trusted_season_runs(limit: int = 10) -> dict[str, Any]:
    return {"season_id": SEASON_ID, "runs": trusted_runtime.store.list_runs(max(1, min(50, limit)))}


@app.post("/api/v1/trusted-seasons/runs", status_code=status.HTTP_202_ACCEPTED)
async def start_trusted_season_run(request: Request, admin_token: str = Header(default="", alias="X-ModLudus-Admin-Token")) -> dict[str, Any]:
    client_host = request.client.host if request.client else ""
    if not trusted_runtime.start_authorized(admin_token, client_host):
        if trusted_runtime.status()["start_auth"]["mode"] == "misconfigured":
            raise HTTPException(status_code=503, detail="trusted season write authentication is not configured")
        raise HTTPException(status_code=401, detail="administrator authorization required")
    try:
        return trusted_runtime.start_run()
    except RuntimeError as error:
        message = str(error)
        raise HTTPException(status_code=503 if "configuration" in message else 409, detail=message) from error


@app.get("/api/v1/trusted-seasons/runs/{run_id}")
def trusted_season_run(run_id: str) -> dict[str, Any]:
    run = trusted_runtime.store.get_run(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="trusted season run not found")
    return run


@app.get("/api/v1/trusted-seasons/runs/{run_id}/evidence")
def trusted_season_evidence(run_id: str) -> dict[str, Any]:
    evidence = trusted_runtime.store.get_evidence(run_id)
    if not evidence:
        raise HTTPException(status_code=404, detail="immutable evidence not found")
    return evidence


@app.get("/api/v1/trusted-seasons/runs/{run_id}/audit")
def trusted_season_audit(run_id: str) -> dict[str, Any]:
    if not trusted_runtime.store.get_run(run_id):
        raise HTTPException(status_code=404, detail="trusted season run not found")
    return {"run_id": run_id, "chain_valid": trusted_runtime.store.verify_audit_chain(), "events": trusted_runtime.store.audit_for_run(run_id)}


@app.post("/api/v1/trusted-seasons/runs/{run_id}/verify")
def verify_trusted_season_run(run_id: str) -> dict[str, Any]:
    if not trusted_runtime.store.get_run(run_id):
        raise HTTPException(status_code=404, detail="trusted season run not found")
    return trusted_runtime.verify_run(run_id)


@app.post("/api/v1/endpoints/probe")
def probe_endpoint(payload: EndpointProbe) -> dict[str, Any]:
    # M0 only validates shape. Actual provider calls belong in the worker adapter.
    return {
        "status": "accepted",
        "api_base_url": str(payload.api_base_url).rstrip("/"),
        "models_path": "/v1/models",
        "secret_received": bool(payload.api_key),
    }
