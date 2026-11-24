from typing import Optional
from fastapi import APIRouter, Depends, Header, Request
from app.api.dependencies import get_api_key
from app.models.rag import RagQueryRequest, RagQueryResponse
from app.services.rag_query_service import rag_query_service

router = APIRouter(dependencies=[Depends(get_api_key)])


@router.post("/query", response_model=RagQueryResponse)
async def query_rag(
    request: RagQueryRequest,
    raw_req: Request,
    x_user_id: Optional[str] = Header(None, alias="x-user-id"),
    x_organization_id: Optional[str] = Header(None, alias="x-organization-id"),
):
    """
    Core Retrieval-Augmented Generation (RAG) query endpoint.
    Performs verified access check, semantic vector retrieval with similarity threshold,
    untrusted evidence context assembly, and grounded Gemini answer generation with citations.
    """
    db = getattr(raw_req.app, "mongodb", None)
    return await rag_query_service.execute_query(
        request=request,
        db=db,
        user_id=x_user_id,
        organization_id=x_organization_id,
    )
