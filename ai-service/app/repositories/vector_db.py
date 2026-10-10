from qdrant_client import QdrantClient
from qdrant_client.http import models as rest
from app.core.config import settings

class QdrantRepository:
    def __init__(self):
        self.client = QdrantClient(
            url=settings.QDRANT_URL,
            api_key=settings.QDRANT_API_KEY
        )
        self.collection_name = "knowledge_chunks"
        self._init_collection()

    def _init_collection(self):
        try:
            collections = self.client.get_collections()
            if self.collection_name not in [c.name for c in collections.collections]:
                self.client.create_collection(
                    collection_name=self.collection_name,
                    vectors_config=rest.VectorParams(
                        size=1536, # OpenAI ada-002 size
                        distance=rest.Distance.COSINE,
                    ),
                )
        except Exception as e:
            print(f"Error initializing Qdrant collection: {e}")

    def upsert_vectors(self, points: list[rest.PointStruct]):
        self.client.upsert(
            collection_name=self.collection_name,
            points=points
        )

    def delete_by_document(self, document_id: str) -> int:
        res = self.client.delete(
            collection_name=self.collection_name,
            points_selector=rest.Filter(
                must=[
                    rest.FieldCondition(
                        key="document_id",
                        match=rest.MatchValue(value=document_id)
                    )
                ]
            )
        )
        return res.status.name if hasattr(res.status, 'name') else str(res.status)

    def delete_by_knowledge_base(self, knowledge_base_id: str) -> int:
        res = self.client.delete(
            collection_name=self.collection_name,
            points_selector=rest.Filter(
                must=[
                    rest.FieldCondition(
                        key="knowledge_base_id",
                        match=rest.MatchValue(value=knowledge_base_id)
                    )
                ]
            )
        )
        return res.status.name if hasattr(res.status, 'name') else str(res.status)

    def search(self, query_vector: list[float], knowledge_base_ids: list[str], limit: int = 5):
        kb_filter = rest.Filter(
            must=[
                rest.FieldCondition(
                    key="knowledge_base_id",
                    match=rest.MatchAny(any=knowledge_base_ids)
                )
            ]
        )
        return self.client.search(
            collection_name=self.collection_name,
            query_vector=query_vector,
            query_filter=kb_filter,
            limit=limit
        )

vector_db = QdrantRepository()
