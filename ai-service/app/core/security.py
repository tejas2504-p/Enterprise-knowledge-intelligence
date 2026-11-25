import base64
import hashlib
import hmac
import json
import time
from dataclasses import dataclass
from typing import Optional

from fastapi import Header, HTTPException, Security, status
from fastapi.security import APIKeyHeader

from app.core.config import settings

api_key_header = APIKeyHeader(name="x-api-key", auto_error=False)
user_context_header = APIKeyHeader(name="x-user-context-token", auto_error=False)


@dataclass
class VerifiedUserContext:
    """Verified user identity forwarded by trusted server-side backend."""

    user_id: str
    role: str = "user"
    department: Optional[str] = None
    organization_id: Optional[str] = None


def _b64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _b64url_decode(data: str) -> bytes:
    padding = "=" * (-len(data) % 4)
    return base64.urlsafe_b64decode(data + padding)


def sign_user_context_token(
    user_id: str,
    role: str = "user",
    department: Optional[str] = None,
    organization_id: Optional[str] = None,
    secret: Optional[str] = None,
    ttl_seconds: int = 60,
) -> str:
    """
    Create a signed HMAC-SHA256 user context token matching Node.js signing logic.
    Intended for server-side signing & automated security tests.
    """
    signing_secret = secret or settings.SERVICE_API_KEY
    now = int(time.time())
    payload = {
        "user_id": user_id,
        "role": role,
        "department": department,
        "organization_id": organization_id,
        "iat": now,
        "exp": now + ttl_seconds,
    }
    encoded_payload = _b64url_encode(
        json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")
    )
    sig_bytes = hmac.new(
        signing_secret.encode("utf-8"),
        encoded_payload.encode("utf-8"),
        hashlib.sha256,
    ).digest()
    return f"{encoded_payload}.{_b64url_encode(sig_bytes)}"


def verify_user_context_token(
    token: str,
    secret: Optional[str] = None,
) -> VerifiedUserContext:
    """
    Cryptographically verify HMAC-SHA256 signed user context forwarded by Node.js.
    Rejects tampered, malformed, or expired user identity assertions.
    """
    if not token or not isinstance(token, str):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing verified user context token",
        )

    parts = token.split(".")
    if len(parts) != 2:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Malformed user context token",
        )

    encoded_payload, provided_sig = parts
    signing_secret = secret or settings.SERVICE_API_KEY

    expected_sig_bytes = hmac.new(
        signing_secret.encode("utf-8"),
        encoded_payload.encode("utf-8"),
        hashlib.sha256,
    ).digest()
    expected_sig = _b64url_encode(expected_sig_bytes)

    if not hmac.compare_digest(provided_sig, expected_sig):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid user context signature",
        )

    try:
        payload = json.loads(_b64url_decode(encoded_payload).decode("utf-8"))
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid user context payload encoding",
        ) from exc

    now = int(time.time())
    exp = payload.get("exp")
    if not isinstance(exp, (int, float)) or now > exp:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User context token has expired",
        )

    user_id = payload.get("user_id")
    if not user_id or not isinstance(user_id, str):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid user context: missing user_id",
        )

    role = payload.get("role") or "user"
    if not isinstance(role, str):
        role = "user"

    department = payload.get("department")
    if department is not None and not isinstance(department, str):
        department = None

    organization_id = payload.get("organization_id")
    if organization_id is not None and not isinstance(organization_id, str):
        organization_id = None

    return VerifiedUserContext(
        user_id=user_id,
        role=role,
        department=department,
        organization_id=organization_id,
    )


def verify_api_key(api_key: str = Security(api_key_header)) -> str:
    if not api_key:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing API Key header",
        )
    if not hmac.compare_digest(api_key, settings.SERVICE_API_KEY):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid API Key",
        )
    return api_key


def verify_trusted_user_context(
    context_token: Optional[str] = Security(user_context_header),
    x_user_id: Optional[str] = Header(None, alias="x-user-id"),
) -> VerifiedUserContext:
    """
    FastAPI dependency verifying server-signed user context.
    Never trusts unsigned client-provided x-user-id or role headers.
    """
    verified = verify_user_context_token(context_token)

    if x_user_id and x_user_id != verified.user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User identity mismatch with verified context token",
        )

    return verified
