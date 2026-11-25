from fastapi import APIRouter, Depends, Request
from app.api.dependencies import get_api_key, get_verified_user_context
from app.core.security import VerifiedUserContext
from app.models.rag import RagQueryRequest, RagQueryResponse
from app.services.rag_query_service import rag_query_service

router = APIRouter(dependencies=[Depends(get_api_key)])


@router.post("/query", response_model=RagQueryResponse)
async def query_rag(
    request: RagQueryRequest,
    raw_req: Request,
    user_context: VerifiedUserContext = Depends(get_verified_user_context),
):
    """
    Core Retrieval-Augmented Generation (RAG) query endpoint.
    Requires both authenticated service API key and a signed server-side user context token.
    Performs verified access check, semantic vector retrieval with similarity threshold,
    untrusted evidence context assembly, and grounded Gemini answer generation with citations.
    """
    db = getattr(raw_req.app, "mongodb", None)
    return await rag_query_service.execute_query(
        request=request,
        db=db,
        user_id=user_context.user_id,
        user_role=user_context.role,
        user_department=user_context.department,
        organization_id=user_context.organization_id,
    )
