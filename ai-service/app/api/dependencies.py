from fastapi import Depends
from app.core.security import verify_api_key

def get_api_key(api_key: str = Depends(verify_api_key)):
    return api_key
