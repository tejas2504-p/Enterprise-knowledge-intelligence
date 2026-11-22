from typing import Optional
from qdrant_client.http import models as rest
from app.services.vector_store import (
    IncompatibleVectorDimensionError,
    InvalidVectorError,
    VectorStoreConnectionError,
    VectorStoreError,
    VectorStoreService,
    generate_stable_point_id,
    vector_store_service,
)


class QdrantRepository:
    """
    Repository wrapper delegating to VectorStoreService, ensuring complete backward compatibility
    with existing callers while providing enterprise vector store capabilities.
    """

    def __init__(self, service: Optional[VectorStoreService] = None):
        self.service = service or vector_store_service

    @property
    def client(self):
        return self.service.get_client()

    @property
    def collection_name(self):
        return self.service.collection_name

    def upsert_vectors(self, points: list[rest.PointStruct]) -> int:
        return self.service.upsert_points(points)

    def delete_by_document(self, document_id: str) -> str:
        self.service.delete_by_document(document_id)
        return "COMPLETED"

    def delete_by_knowledge_base(self, knowledge_base_id: str) -> str:
        self.service.delete_by_knowledge_base(knowledge_base_id)
        return "COMPLETED"

    def search(
        self,
        query_vector: list[float],
        knowledge_base_ids: list[str],
        organization_id: Optional[str] = None,
        department: Optional[str] = None,
        limit: int = 5,
    ):
        results = self.service.search(
            query_vector=query_vector,
            knowledge_base_ids=knowledge_base_ids,
            organization_id=organization_id,
            department=department,
            limit=limit,
        )

        class SearchHit:
            def __init__(self, res):
                self.id = res.point_id
                self.score = res.score
                self.payload = {
                    "document_id": res.document_id,
                    "knowledge_base_id": res.knowledge_base_id,
                    "text": res.text,
                    "title": res.title or "",
                    "filename": res.filename or "",
                    "department": res.department,
                    "organization_id": res.organization_id,
                    "chunk_index": res.chunk_index,
                    "chunk_id": res.chunk_id,
                    "page_number": res.page_number,
                }

        return [SearchHit(r) for r in results]


vector_db = QdrantRepository()

__all__ = [
    "vector_db",
    "QdrantRepository",
    "generate_stable_point_id",
    "VectorStoreError",
    "VectorStoreConnectionError",
    "IncompatibleVectorDimensionError",
    "InvalidVectorError",
]
