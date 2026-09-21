from fastapi import FastAPI

app = FastAPI(title="Enterprise Knowledge AI Service")

@app.get("/")
def read_root():
    return {"message": "AI Service is running"}

@app.get("/health")
def health_check():
    return {"status": "ok"}
