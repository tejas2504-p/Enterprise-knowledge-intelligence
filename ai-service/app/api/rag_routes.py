from fastapi import APIRouter, Depends, Request
from app.api.dependencies import get_api_key, get_verified_user_context
from app.core.security import VerifiedUserContext
from app.models.query_understanding import QueryUnderstandingRequest, QueryUnderstandingResult
from app.models.rag import RagQueryRequest, RagQueryResponse
from app.services.query_understanding import query_understanding_service
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
    Executes Phase 4 query understanding/rewriting (when enabled), verified access checks,
    semantic vector retrieval with similarity threshold, untrusted evidence context assembly,
    and grounded Gemini answer generation with citations preserving the original question.
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


@router.post("/analyze-query", response_model=QueryUnderstandingResult)
async def analyze_query(
    request: QueryUnderstandingRequest,
    raw_req: Request,
    user_context: VerifiedUserContext = Depends(get_verified_user_context),
):
    """
    Standalone Phase 4 Query Understanding & Rewriting endpoint.
    Classifies intent, extracts keywords/entities, detects ambiguity, decomposes multi-part
    questions, and contextualizes follow-up queries without generating answers or exposing CoT.
    """
    db = getattr(raw_req.app, "mongodb", None)
    kb_name = request.knowledge_base_name

    if request.knowledgeBaseId:
        kb_ctx = await rag_query_service.verify_kb_access(
            knowledge_base_id=request.knowledgeBaseId.strip(),
            db=db,
            user_id=user_context.user_id,
            user_role=user_context.role,
            user_department=user_context.department,
            organization_id=user_context.organization_id,
        )
        kb_name = kb_name or kb_ctx.get("title") or None

    scoped_request = request.model_copy(update={"knowledge_base_name": kb_name})
    return await query_understanding_service.process_query(
        request=scoped_request,
        db=db,
        user_id=user_context.user_id,
        user_role=user_context.role,
        fallback_on_error=True,
    )
