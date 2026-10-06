"""AWS Lambda entry point: the FastAPI app behind API Gateway."""

from mangum import Mangum

from .api import app

handler = Mangum(app, lifespan="off")
