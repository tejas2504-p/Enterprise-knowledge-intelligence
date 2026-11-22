import logging
import uuid
from typing import Any, Optional, Sequence

from qdrant_client import QdrantClient
from qdrant_client.http import models
from qdrant_client.http.exceptions import UnexpectedResponse

from app.core.config import settings
from app.models.embedding import EmbeddedChunk
from app.models.vector_store import CollectionMetadata, VectorSearchFilter, VectorSearchResult

logger = logging.getLogger(__name__)


# -----------------------------------------------------------------------------
# Custom Vector Store Exceptions
# -----------------------------------------------------------------------------

class VectorStoreError(Exception):
    """Base exception for vector store operations."""
    pass


class VectorStoreConnectionError(VectorStoreError):
    """Raised when connection to Qdrant fails."""
    pass


class IncompatibleVectorDimensionError(VectorStoreError):
    """Raised when existing collection vector dimension does not match active model dimension."""
    pass


class InvalidVectorError(VectorStoreError):
    """Raised when a vector dimension does not match collection specification."""
    pass


class CollectionNotFoundError(VectorStoreError):
    """Raised when the requested collection does not exist."""
    pass


# -----------------------------------------------------------------------------
# Utilities
# -----------------------------------------------------------------------------

def generate_stable_point_id(document_id: str, chunk_identifier: str | int) -> str:
    """
    Generate deterministic, idempotent UUIDv5 point ID for Qdrant.
    Guarantees that re-indexing the same document chunk targets the exact same vector point ID.
    """
    return str(uuid.uuid5(uuid.NAMESPACE_DNS, f"{document_id}_{chunk_identifier}"))


# -----------------------------------------------------------------------------
# Vector Store Service
# -----------------------------------------------------------------------------

class VectorStoreService:
    """
    Enterprise Vector Store Service managing Qdrant vector operations for document chunks.

    Features:
    - Supports local mode (:memory:, local filesystem) and remote deployment (HTTP/HTTPS, API key, gRPC)
    - Dynamic collection vector dimension configuration based on active embedding model
    - Dimension compatibility checks to prevent incompatible vector space mixing
    - Idempotent upserts via stable UUIDv5 point IDs
    - Clean document re-indexing (purging stale chunks to avoid orphan fragments)
    - Strict boundary-enforced search (organization and knowledge-base isolation before retrieval)
    - Safe error handling for connection failures and missing collections
    """

    def __init__(
        self,
        url: Optional[str] = None,
        api_key: Optional[str] = None,
        local_path: Optional[str] = None,
        collection_name: Optional[str] = None,
        dimension: Optional[int] = None,
        distance: Optional[str] = None,
        timeout: Optional[float] = None,
        prefer_grpc: Optional[bool] = None,
        model_name: Optional[str] = None,
        client: Optional[QdrantClient] = None,
    ):
        self.url = url or getattr(settings, "QDRANT_URL", "http://localhost:6333")
        self.api_key = api_key or getattr(settings, "QDRANT_API_KEY", None)
        self.local_path = local_path or getattr(settings, "QDRANT_LOCAL_PATH", None)
        self.collection_name = collection_name or getattr(settings, "QDRANT_COLLECTION_NAME", "knowledge_chunks")
        self.dimension = dimension if dimension is not None else getattr(settings, "EMBEDDING_DIMENSION", 768)
        self.distance_name = distance or getattr(settings, "QDRANT_DISTANCE", "Cosine")
        self.timeout = timeout if timeout is not None else getattr(settings, "QDRANT_TIMEOUT", 20.0)
        self.prefer_grpc = prefer_grpc if prefer_grpc is not None else getattr(settings, "QDRANT_PREFER_GRPC", False)
        self.model_name = model_name or getattr(settings, "EMBEDDING_MODEL", "text-embedding-004")

        self._client = client
        self._collection_checked = False

    def _resolve_distance(self) -> models.Distance:
        """Resolve distance metric string to Qdrant Distance enum."""
        dist_lower = self.distance_name.lower()
        if dist_lower == "cosine":
            return models.Distance.COSINE
        elif dist_lower == "dot":
            return models.Distance.DOT
        elif dist_lower in ("euclid", "euclidean"):
            return models.Distance.EUCLID
        elif dist_lower == "manhattan":
            return models.Distance.MANHATTAN
        return models.Distance.COSINE

    def get_client(self) -> QdrantClient:
        """Lazily initialize and return the Qdrant client."""
        if self._client is not None:
            return self._client

        try:
            if self.url == ":memory:":
                logger.info("Initializing Qdrant client in in-memory mode (:memory:)")
                self._client = QdrantClient(location=":memory:")
            elif self.local_path:
                logger.info("Initializing Qdrant client in local disk mode at %s", self.local_path)
                self._client = QdrantClient(path=self.local_path)
            else:
                logger.info("Connecting to remote Qdrant at %s", self.url)
                self._client = QdrantClient(
                    url=self.url,
                    api_key=self.api_key,
                    timeout=self.timeout,
                    prefer_grpc=self.prefer_grpc,
                )
            return self._client
        except Exception as exc:
            logger.error("Failed to connect to Qdrant: %s", str(exc))
            raise VectorStoreConnectionError(f"Could not connect to Qdrant vector store: {str(exc)}") from exc

    def ensure_collection(self, allow_recreate: bool = False) -> bool:
        """
        Verify collection exists and matches active embedding dimensions.
        If missing, creates it.
        If dimension mismatch occurs, raises IncompatibleVectorDimensionError
        (unless allow_recreate is True, in which case it drops and recreates).
        """
        client = self.get_client()
        try:
            collections_resp = client.get_collections()
            existing_names = [c.name for c in collections_resp.collections]

            if self.collection_name not in existing_names:
                # Create collection with configured dimension and distance
                logger.info(
                    "Creating Qdrant collection '%s' with dimension=%d, distance=%s for model=%s",
                    self.collection_name, self.dimension, self.distance_name, self.model_name
                )
                client.create_collection(
                    collection_name=self.collection_name,
                    vectors_config=models.VectorParams(
                        size=self.dimension,
                        distance=self._resolve_distance(),
                    ),
                )
                self._collection_checked = True
                return True

            # Collection exists: inspect vector configuration
            coll_info = client.get_collection(self.collection_name)
            vectors_config = coll_info.config.params.vectors

            existing_dim: Optional[int] = None
            if isinstance(vectors_config, models.VectorParams):
                existing_dim = vectors_config.size
            elif isinstance(vectors_config, dict):
                # Named vectors
                first_param = next(iter(vectors_config.values()), None)
                if first_param and hasattr(first_param, "size"):
                    existing_dim = first_param.size

            if existing_dim is not None and existing_dim != self.dimension:
                if allow_recreate:
                    logger.warning(
                        "Dimension mismatch in collection '%s' (existing: %d, configured: %d). Recreating collection.",
                        self.collection_name, existing_dim, self.dimension
                    )
                    client.delete_collection(self.collection_name)
                    client.create_collection(
                        collection_name=self.collection_name,
                        vectors_config=models.VectorParams(
                            size=self.dimension,
                            distance=self._resolve_distance(),
                        ),
                    )
                    self._collection_checked = True
                    return True

                msg = (
                    f"Collection '{self.collection_name}' has vector dimension {existing_dim}, "
                    f"which is incompatible with the configured dimension {self.dimension} for model '{self.model_name}'. "
                    f"Incompatible vectors cannot be mixed in the same collection without a migration strategy "
                    f"or setting allow_recreate=True."
                )
                logger.error(msg)
                raise IncompatibleVectorDimensionError(msg)

            self._collection_checked = True
            return False

        except IncompatibleVectorDimensionError:
            raise
        except Exception as exc:
            logger.error("Failed to ensure collection in Qdrant: %s", str(exc))
            raise VectorStoreConnectionError(f"Failed to access or configure Qdrant collection: {str(exc)}") from exc

    def upsert_chunks(
        self,
        chunks: Sequence[EmbeddedChunk],
        document_id: str,
        knowledge_base_id: str,
        organization_id: Optional[str] = None,
        department: Optional[str] = None,
        filename: Optional[str] = None,
        title: Optional[str] = None,
    ) -> int:
        """
        Idempotently upsert embedded chunks into Qdrant using deterministic UUIDv5 point IDs.
        Stores chunk text and complete metadata as point payload.
        """
        if not chunks:
            return 0

        self.ensure_collection()
        client = self.get_client()

        points: list[models.PointStruct] = []
        for chunk in chunks:
            # Validate chunk dimension against collection dimension
            if len(chunk.embedding) != self.dimension:
                raise InvalidVectorError(
                    f"Chunk vector dimension {len(chunk.embedding)} does not match collection dimension {self.dimension}"
                )

            # Generate deterministic point ID
            point_id = generate_stable_point_id(document_id, chunk.chunk_id or chunk.chunk_index)

            # Assemble rich metadata payload
            payload: dict[str, Any] = {
                "text": chunk.text if hasattr(chunk, "text") and chunk.text else chunk.metadata.get("text", ""),
                "document_id": document_id,
                "knowledge_base_id": knowledge_base_id,
                "organization_id": organization_id or chunk.metadata.get("organization_id"),
                "department": department or chunk.metadata.get("department"),
                "filename": filename or chunk.metadata.get("filename"),
                "title": title or chunk.metadata.get("title"),
                "chunk_id": chunk.chunk_id,
                "chunk_index": chunk.chunk_index,
                "token_count": chunk.token_count,
                "char_count": chunk.char_count,
                "start_char": chunk.start_char,
                "end_char": chunk.end_char,
                "page_number": chunk.page_number,
                "start_page": chunk.metadata.get("start_page"),
                "end_page": chunk.metadata.get("end_page"),
                "total_chunks": chunk.metadata.get("total_chunks"),
                "embedding_model": chunk.model or self.model_name,
                "embedding_dimension": chunk.dimension or self.dimension,
                "content_hash": chunk.content_hash,
                "custom_metadata": chunk.metadata,
            }

            points.append(
                models.PointStruct(
                    id=point_id,
                    vector=chunk.embedding,
                    payload=payload,
                )
            )

        try:
            client.upsert(
                collection_name=self.collection_name,
                points=points,
            )
            return len(points)
        except Exception as exc:
            logger.error("Failed to upsert points into Qdrant: %s", str(exc))
            raise VectorStoreError(f"Failed to upsert points into Qdrant: {str(exc)}") from exc

    def upsert_points(self, points: list[models.PointStruct]) -> int:
        """
        Direct upsert of PointStruct objects (for backward compatibility).
        """
        if not points:
            return 0
        self.ensure_collection()
        client = self.get_client()

        for pt in points:
            if hasattr(pt, "vector") and isinstance(pt.vector, list):
                if len(pt.vector) != self.dimension:
                    raise InvalidVectorError(
                        f"Point vector dimension {len(pt.vector)} does not match collection dimension {self.dimension}"
                    )

        try:
            client.upsert(
                collection_name=self.collection_name,
                points=points,
            )
            return len(points)
        except Exception as exc:
            logger.error("Failed to upsert points: %s", str(exc))
            raise VectorStoreError(f"Failed to upsert points: {str(exc)}") from exc

    def reindex_document(
        self,
        document_id: str,
        chunks: Sequence[EmbeddedChunk],
        knowledge_base_id: str,
        organization_id: Optional[str] = None,
        department: Optional[str] = None,
        filename: Optional[str] = None,
        title: Optional[str] = None,
    ) -> int:
        """
        Reindex document safely when document content or length changes.
        Purges any previous points for the document before upserting new chunks,
        preventing orphan vector chunks from remaining in the index.
        """
        # 1. Purge previous points for this document
        self.delete_by_document(document_id)

        # 2. Upsert newly generated chunks
        return self.upsert_chunks(
            chunks=chunks,
            document_id=document_id,
            knowledge_base_id=knowledge_base_id,
            organization_id=organization_id,
            department=department,
            filename=filename,
            title=title,
        )

    def search(
        self,
        query_vector: list[float],
        organization_id: Optional[str] = None,
        knowledge_base_ids: Optional[list[str]] = None,
        department: Optional[str] = None,
        document_id: Optional[str] = None,
        limit: int = 5,
        score_threshold: Optional[float] = None,
    ) -> list[VectorSearchResult]:
        """
        Perform similarity search in Qdrant with strict pre-retrieval boundary enforcement.

        Enforces tenant (organization_id) and access (knowledge_base_ids) filters at
        the database level BEFORE vector retrieval, ensuring zero unauthorized data leakage.
        """
        # Validate query vector dimension
        if len(query_vector) != self.dimension:
            raise InvalidVectorError(
                f"Query vector dimension {len(query_vector)} does not match collection dimension {self.dimension}"
            )

        # Authorization Boundary Check:
        # If knowledge_base_ids was explicitly provided as an empty list, the caller has 0 authorized KBs.
        # Return empty list immediately without querying the database.
        if knowledge_base_ids is not None and len(knowledge_base_ids) == 0:
            logger.debug("Caller has empty knowledge_base_ids list. Returning empty search result.")
            return []

        self.ensure_collection()
        client = self.get_client()

        # Build strict pre-retrieval filter
        must_conditions: list[models.FieldCondition] = []

        if organization_id:
            must_conditions.append(
                models.FieldCondition(
                    key="organization_id",
                    match=models.MatchValue(value=organization_id),
                )
            )

        if knowledge_base_ids:
            if len(knowledge_base_ids) == 1:
                must_conditions.append(
                    models.FieldCondition(
                        key="knowledge_base_id",
                        match=models.MatchValue(value=knowledge_base_ids[0]),
                    )
                )
            else:
                must_conditions.append(
                    models.FieldCondition(
                        key="knowledge_base_id",
                        match=models.MatchAny(any=knowledge_base_ids),
                    )
                )

        if department:
            must_conditions.append(
                models.FieldCondition(
                    key="department",
                    match=models.MatchValue(value=department),
                )
            )

        if document_id:
            must_conditions.append(
                models.FieldCondition(
                    key="document_id",
                    match=models.MatchValue(value=document_id),
                )
            )

        query_filter = models.Filter(must=must_conditions) if must_conditions else None

        try:
            search_results = client.search(
                collection_name=self.collection_name,
                query_vector=query_vector,
                query_filter=query_filter,
                limit=limit,
                score_threshold=score_threshold,
            )

            results: list[VectorSearchResult] = []
            for hit in search_results:
                payload = hit.payload or {}
                results.append(
                    VectorSearchResult(
                        point_id=str(hit.id),
                        score=float(hit.score),
                        document_id=payload.get("document_id", ""),
                        knowledge_base_id=payload.get("knowledge_base_id", ""),
                        text=payload.get("text", ""),
                        organization_id=payload.get("organization_id"),
                        department=payload.get("department"),
                        chunk_id=payload.get("chunk_id"),
                        chunk_index=payload.get("chunk_index"),
                        total_chunks=payload.get("total_chunks"),
                        filename=payload.get("filename"),
                        title=payload.get("title"),
                        page_number=payload.get("page_number"),
                        start_page=payload.get("start_page"),
                        end_page=payload.get("end_page"),
                        start_char=payload.get("start_char"),
                        end_char=payload.get("end_char"),
                        token_count=payload.get("token_count"),
                        metadata=payload.get("custom_metadata", payload),
                    )
                )

            return results
        except Exception as exc:
            logger.error("Vector search failed: %s", str(exc))
            raise VectorStoreError(f"Vector search failed: {str(exc)}") from exc

    def delete_by_document(self, document_id: str) -> bool:
        """
        Delete all vector points belonging to a specific document.
        """
        self.ensure_collection()
        client = self.get_client()
        try:
            client.delete(
                collection_name=self.collection_name,
                points_selector=models.Filter(
                    must=[
                        models.FieldCondition(
                            key="document_id",
                            match=models.MatchValue(value=document_id),
                        )
                    ]
                ),
            )
            return True
        except Exception as exc:
            logger.error("Failed to delete points for document %s: %s", document_id, str(exc))
            raise VectorStoreError(f"Failed to delete points for document {document_id}: {str(exc)}") from exc

    def delete_by_knowledge_base(self, knowledge_base_id: str) -> bool:
        """
        Delete all vector points belonging to an entire knowledge base.
        """
        self.ensure_collection()
        client = self.get_client()
        try:
            client.delete(
                collection_name=self.collection_name,
                points_selector=models.Filter(
                    must=[
                        models.FieldCondition(
                            key="knowledge_base_id",
                            match=models.MatchValue(value=knowledge_base_id),
                        )
                    ]
                ),
            )
            return True
        except Exception as exc:
            logger.error("Failed to delete points for knowledge base %s: %s", knowledge_base_id, str(exc))
            raise VectorStoreError(f"Failed to delete points for knowledge base {knowledge_base_id}: {str(exc)}") from exc

    def get_collection_metadata(self) -> CollectionMetadata:
        """
        Retrieve metadata and status of the active Qdrant collection.
        """
        client = self.get_client()
        try:
            coll_info = client.get_collection(self.collection_name)
            vectors_config = coll_info.config.params.vectors

            dim = self.dimension
            distance = self.distance_name
            if isinstance(vectors_config, models.VectorParams):
                dim = vectors_config.size
                distance = vectors_config.distance.name if hasattr(vectors_config.distance, "name") else str(vectors_config.distance)

            return CollectionMetadata(
                collection_name=self.collection_name,
                dimension=dim,
                distance=distance,
                points_count=coll_info.points_count or 0,
                status=coll_info.status.name if hasattr(coll_info.status, "name") else str(coll_info.status),
                embedding_model=self.model_name,
            )
        except Exception as exc:
            logger.error("Failed to get collection metadata: %s", str(exc))
            raise VectorStoreError(f"Failed to get collection metadata: {str(exc)}") from exc


# Global instance
vector_store_service = VectorStoreService()
