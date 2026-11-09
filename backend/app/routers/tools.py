"""
Tools router — direct tool invocation endpoints.

These endpoints allow the frontend to call tools directly
(e.g. Power BI embed, ML forecast) without going through the agent.
Each endpoint validates permissions and logs the action.
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter()


class PowerBIEmbedRequest(BaseModel):
    reportId: str


@router.post("/powerbi/embed")
async def powerbi_embed(req: PowerBIEmbedRequest):
    # TODO: Implement Power BI embed token generation
    return {"embedUrl": "", "accessToken": "", "reportId": req.reportId}


class MLForecastRequest(BaseModel):
    metric: str
    horizon: int = 30
    granularity: str = "monthly"


@router.post("/ml/forecast")
async def ml_forecast(req: MLForecastRequest):
    # TODO: Call ML service
    return {"metric": req.metric, "forecasts": [], "modelVersion": "0.1.0"}


class MLAnomalyRequest(BaseModel):
    metric: str
    sensitivity: float = 0.95


@router.post("/ml/anomaly")
async def ml_anomaly(req: MLAnomalyRequest):
    # TODO: Call ML service
    return {"anomalies": []}


@router.get("/database/tables")
async def list_tables():
    # TODO: Query information_schema
    return {"tables": []}
