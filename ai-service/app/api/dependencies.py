from fastapi import Depends
from app.core.security import VerifiedUserContext, verify_api_key, verify_trusted_user_context


def get_api_key(api_key: str = Depends(verify_api_key)) -> str:
    return api_key


def get_verified_user_context(
    user_context: VerifiedUserContext = Depends(verify_trusted_user_context),
) -> VerifiedUserContext:
    return user_context
