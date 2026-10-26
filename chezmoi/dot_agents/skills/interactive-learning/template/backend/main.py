"""Local FastAPI app. Add validated scientific endpoints under `/api/`."""

from fastapi import FastAPI
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel

app = FastAPI(title="Interactive learning")


@app.exception_handler(RequestValidationError)
async def validation_error(_request, exception: RequestValidationError) -> JSONResponse:
    """Return validation details without echoing potentially nonfinite input."""
    details = [
        {key: error[key] for key in ("loc", "msg", "type")}
        for error in exception.errors()
    ]
    return JSONResponse(status_code=422, content={"detail": details})


class Health(BaseModel):
    """Liveness status."""

    status: str


@app.get("/api/health")
def health() -> Health:
    """Report that the server is running."""
    return Health(status="ok")
