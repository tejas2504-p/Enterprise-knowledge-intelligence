from qdrant_client.http import models as rest
from app.models.document import IndexDocumentRequest, IndexDocumentResponse, DeleteDocumentResponse, DeleteKnowledgeBaseResponse
from app.models.chat import ChatRequest, ChatResponse, SourceSnippet
from app.services.chunking import split_text
from app.services.embeddings import get_embeddings, get_embedding
from app.services.llm import generate_answer
from app.services.vector_store import generate_stable_point_id, vector_store_service
from app.repositories.vector_db import vector_db


class RagService:
    def index_document(self, request: IndexDocumentRequest) -> IndexDocumentResponse:
        chunks = split_text(request.text)
        if not chunks:
            return IndexDocumentResponse(status="success", chunks_indexed=0)
            
        embeddings = get_embeddings(chunks)

        # Cleanly reindex by purging previous points for this document to avoid orphans
        vector_store_service.delete_by_document(request.document_id)
        
        points = []
        for i, (chunk, embedding) in enumerate(zip(chunks, embeddings)):
            point_id = generate_stable_point_id(request.document_id, i)
            points.append(
                rest.PointStruct(
                    id=point_id,
                    vector=embedding,
                    payload={
                        "document_id": request.document_id,
                        "knowledge_base_id": request.knowledge_base_id,
                        "organization_id": request.organization_id,
                        "department": request.department,
                        "filename": request.filename,
                        "title": request.title,
                        "text": chunk,
                        "chunk_index": i,
                    }
                )
            )
            
        vector_db.upsert_vectors(points)
        return IndexDocumentResponse(status="success", chunks_indexed=len(points))

    def delete_document(self, document_id: str) -> DeleteDocumentResponse:
        status = vector_db.delete_by_document(document_id)
        return DeleteDocumentResponse(status=str(status), deleted_chunks=0)

    def delete_knowledge_base(self, knowledge_base_id: str) -> DeleteKnowledgeBaseResponse:
        status = vector_db.delete_by_knowledge_base(knowledge_base_id)
        return DeleteKnowledgeBaseResponse(status=str(status), deleted_chunks=0)

    def chat(self, request: ChatRequest) -> ChatResponse:
        query_vector = get_embedding(request.query)
        
        search_results = vector_db.search(
            query_vector=query_vector, 
            knowledge_base_ids=request.knowledge_base_ids,
            organization_id=getattr(request, "organization_id", None),
            department=getattr(request, "department", None),
            limit=5
        )
        
        sources = []
        context_snippets = []
        for hit in search_results:
            sources.append(
                SourceSnippet(
                    document_id=hit.payload.get("document_id", ""),
                    title=hit.payload.get("title", ""),
                    score=hit.score,
                    text_snippet=hit.payload.get("text", "")
                )
            )
            context_snippets.append(hit.payload.get("text", ""))
            
        answer = generate_answer(request.query, context_snippets, request.chat_history)
        
        return ChatResponse(answer=answer, sources=sources)


rag_service = RagService()
