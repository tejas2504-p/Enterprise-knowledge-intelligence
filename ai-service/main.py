import os
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from motor.motor_asyncio import AsyncIOMotorClient
from app.core.config import settings
from app.api.routes import router as internal_router
from app.api.rag_routes import router as rag_router

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: Connect to MongoDB
    if settings.MONGODB_URI:
        app.mongodb_client = AsyncIOMotorClient(settings.MONGODB_URI)
        try:
            app.mongodb = app.mongodb_client.get_default_database(default="test")
        except Exception:
            app.mongodb = app.mongodb_client.get_database(settings.MONGODB_DB_NAME)
        print(f"Connected to MongoDB (db={app.mongodb.name})!")
    else:
        print("Warning: MONGODB_URI not found in environment variables.")
    yield
    # Shutdown: Close connection
    if hasattr(app, "mongodb_client"):
        app.mongodb_client.close()
        print("Disconnected from MongoDB.")

app = FastAPI(title="Enterprise Knowledge AI Service", lifespan=lifespan)

@app.get("/")
def read_root():
    return {"message": "AI Service is running"}

@app.get("/health")
async def health_check():
    db_status = "disconnected"
    if hasattr(app, "mongodb_client"):
        try:
            await app.mongodb_client.admin.command('ping')
            db_status = "connected"
        except Exception:
            pass
    return {"status": "ok", "database": db_status}

app.include_router(internal_router, prefix="/api/internal", tags=["internal"])
app.include_router(rag_router, prefix="/api/rag", tags=["rag"])


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    """Prevent internal stack traces or secrets from ever leaking in HTTP responses."""
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error"},
    )
