"""Local FastAPI app serving an exact analytic field decomposition toy."""

from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field

GRID_SIZE = 9
STEP = 2 / (GRID_SIZE - 1)

app = FastAPI(title="Interactive learning template")


@app.exception_handler(RequestValidationError)
async def validation_error(_request, exception: RequestValidationError) -> JSONResponse:
    """Return validation details without echoing potentially nonfinite input."""
    details = [
        {key: error[key] for key in ("loc", "msg", "type")}
        for error in exception.errors()
    ]
    return JSONResponse(status_code=422, content={"detail": details})


class DecompositionRequest(BaseModel):
    """Strength of the potential and rotation parts."""

    model_config = ConfigDict(extra="forbid")

    potential: float = Field(ge=0, le=2, allow_inf_nan=False)
    rotation: float = Field(ge=0, le=2, allow_inf_nan=False)


class Point(BaseModel):
    """Field components at one grid point."""

    x: float
    y: float
    potential_x: float
    potential_y: float
    rotation_x: float
    rotation_y: float
    total_x: float
    total_y: float


class DecompositionResponse(BaseModel):
    """Sampled fields with their exact divergence and curl."""

    potential: float
    rotation: float
    points: list[Point]
    divergence: float
    curl: float


class Health(BaseModel):
    """Liveness status."""

    status: str


@app.get("/api/health")
def health() -> Health:
    """Report that the server is running."""
    return Health(status="ok")


@app.post("/api/decomposition")
def decomposition(req: DecompositionRequest) -> DecompositionResponse:
    """Sample F = a(x, y) + b(-y, x) on a 9x9 grid over [-1, 1]."""
    a, b = req.potential, req.rotation
    points = []
    for j in range(GRID_SIZE):
        y = -1 + j * STEP
        for i in range(GRID_SIZE):
            x = -1 + i * STEP
            px, py = a * x, a * y
            rx, ry = -b * y, b * x
            points.append(
                Point(
                    x=x,
                    y=y,
                    potential_x=px,
                    potential_y=py,
                    rotation_x=rx,
                    rotation_y=ry,
                    total_x=px + rx,
                    total_y=py + ry,
                )
            )
    return DecompositionResponse(
        potential=a, rotation=b, points=points, divergence=2 * a, curl=2 * b
    )
