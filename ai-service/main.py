import os
from contextlib import asynccontextmanager
from fastapi import FastAPI
from motor.motor_asyncio import AsyncIOMotorClient
from dotenv import load_dotenv

load_dotenv()

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: Connect to MongoDB
    mongodb_uri = os.getenv("MONGODB_URI")
    if mongodb_uri:
        app.mongodb_client = AsyncIOMotorClient(mongodb_uri)
        app.mongodb = app.mongodb_client.get_database("enterprise_knowledge")
        print("Connected to MongoDB!")
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
