import hashlib
import re
from typing import Any, Optional
from bson import ObjectId

from app.core.config import settings
from app.models.document import ChunkDocumentRequest, ChunkDocumentResponse, ChunkItem
from app.services.tokenizer import Tokenizer, default_tokenizer


class PageTracker:
    """
    Tracks and resolves page numbers for character offsets within a document.
    Supports both explicit page separators (e.g., form feeds '\\f' or page headers)
    and interpolated page calculations when page_count is known.
    """

    def __init__(self, text: str, page_count: Optional[int] = None):
        self.text_len = len(text)
        self.page_count = page_count
        self.explicit_pages: list[tuple[int, int, int]] = []  # (start_char, end_char, page_num)

        # Detect form-feed '\\f' page breaks commonly emitted by PDF parsers
        ff_positions = [m.start() for m in re.finditer(r"\f", text)]
        if ff_positions:
            start = 0
            page_num = 1
            for pos in ff_positions:
                self.explicit_pages.append((start, pos, page_num))
                start = pos + 1
                page_num += 1
            self.explicit_pages.append((start, self.text_len, page_num))
        else:
            # Check for common page marker patterns, e.g., '--- Page 1 ---' or '[Page 1]'
            marker_pattern = r"(?:---|\bPage\b|\bPAGE\b|\#\#\# Page)\s*(\d+)"
            matches = list(re.finditer(marker_pattern, text))
            if len(matches) > 1:
                for i, match in enumerate(matches):
                    page_num = int(match.group(1))
                    start = match.start()
                    end = matches[i + 1].start() if i + 1 < len(matches) else self.text_len
                    self.explicit_pages.append((start, end, page_num))

    def get_page_info(self, start_char: int, end_char: int) -> tuple[Optional[int], Optional[int], Optional[int]]:
        """
        Returns (primary_page, start_page, end_page) for the given character range.
        """
        if self.explicit_pages:
            effective_end = max(start_char, end_char - 1)
            start_page = None
            end_page = None

            for p_start, p_end, p_num in self.explicit_pages:
                if start_page is None and p_start <= start_char <= p_end:
                    start_page = p_num
                if p_start <= effective_end <= p_end:
                    end_page = p_num

            # Fallbacks if offsets boundary falls outside explicit ranges
            if start_page is None:
                start_page = self.explicit_pages[0][2]
            if end_page is None:
                end_page = self.explicit_pages[-1][2]

            return start_page, start_page, end_page

        if self.page_count and self.page_count > 0:
            if self.text_len == 0:
                return 1, 1, 1
            effective_end = max(start_char, end_char - 1)
            start_page = min(self.page_count, int((start_char / max(1, self.text_len)) * self.page_count) + 1)
            end_page = min(self.page_count, int((effective_end / max(1, self.text_len)) * self.page_count) + 1)
            return start_page, start_page, end_page

        return None, None, None


class TextSegment:
    """
    Represents an atomic text segment with its exact source character offsets.
    """
    def __init__(self, text: str, start_char: int, end_char: int):
        self.text = text
        self.start_char = start_char
        self.end_char = end_char


class TextChunker:
    """
    Reusable text chunking engine.
    Splits document text into semantically cohesive chunks respecting token size limits,
    configured overlap, paragraph/sentence boundaries, and metadata continuity.
    """

    def __init__(
        self,
        chunk_size: Optional[int] = None,
        chunk_overlap: Optional[int] = None,
        separators: Optional[list[str]] = None,
        tokenizer: Optional[Tokenizer] = None,
        min_chunk_size: Optional[int] = None,
    ):
        self.chunk_size = chunk_size if chunk_size is not None else getattr(settings, "CHUNK_SIZE", 800)
        self.chunk_overlap = chunk_overlap if chunk_overlap is not None else getattr(settings, "CHUNK_OVERLAP", 120)
        self.min_chunk_size = min_chunk_size if min_chunk_size is not None else getattr(settings, "CHUNK_MIN_SIZE", 20)
        self.separators = separators or getattr(
            settings,
            "CHUNK_SEPARATORS",
            ["\f", "\n\n", "\n", ". ", "! ", "? ", "; ", ", ", " ", ""]
        )
        self.tokenizer = tokenizer or default_tokenizer

        if self.chunk_size <= 0:
            raise ValueError(f"chunk_size must be positive, got {self.chunk_size}")
        if self.chunk_overlap < 0:
            raise ValueError(f"chunk_overlap cannot be negative, got {self.chunk_overlap}")
        if self.chunk_overlap >= self.chunk_size:
            raise ValueError(
                f"chunk_overlap ({self.chunk_overlap}) must be strictly less than chunk_size ({self.chunk_size})"
            )

    def _split_into_segments(self, text: str, start_offset: int, separators: list[str]) -> list[TextSegment]:
        """
        Recursively break text into natural units according to separator hierarchy
        until all units are within chunk_size tokens.
        Preserves delimiters and tracks exact character coordinates.
        """
        if not text:
            return []

        if self.tokenizer.count_tokens(text) <= self.chunk_size:
            return [TextSegment(text, start_offset, start_offset + len(text))]

        # Find the first valid separator present in the text
        active_sep = None
        new_separators = []
        for i, sep in enumerate(separators):
            if sep == "":
                active_sep = ""
                new_separators = []
                break
            if sep in text:
                active_sep = sep
                new_separators = separators[i + 1:]
                break

        if active_sep is None:
            active_sep = ""
            new_separators = []

        if active_sep == "":
            # Character fallback: split into chunks of character length matching token budget
            char_step = max(1, self.chunk_size * 3)
            segments: list[TextSegment] = []
            for j in range(0, len(text), char_step):
                sub = text[j:j + char_step]
                segments.append(TextSegment(sub, start_offset + j, start_offset + j + len(sub)))
            return segments

        # Split preserving the separator attached to the preceding text
        parts = text.split(active_sep)
        segments: list[TextSegment] = []
        curr_offset = start_offset

        for i, part in enumerate(parts):
            if i < len(parts) - 1:
                sub_text = part + active_sep
            else:
                sub_text = part

            if not sub_text:
                continue

            seg_start = curr_offset
            seg_end = curr_offset + len(sub_text)
            curr_offset = seg_end

            if self.tokenizer.count_tokens(sub_text) <= self.chunk_size:
                segments.append(TextSegment(sub_text, seg_start, seg_end))
            else:
                # Recurse down separator hierarchy for oversize segment
                sub_segs = self._split_into_segments(sub_text, seg_start, new_separators)
                segments.extend(sub_segs)

        return segments

    def generate_chunk_id(self, document_id: str, chunk_index: int, chunk_text: str) -> str:
        """
        Generate a stable, deterministic chunk identifier based on document ID,
        index, and chunk content SHA256 digest.
        """
        content_hash = hashlib.sha256(chunk_text.strip().encode("utf-8")).hexdigest()[:8]
        return f"{document_id}_c{chunk_index:04d}_{content_hash}"

    def chunk_text(
        self,
        text: str,
        document_id: str,
        knowledge_base_id: str,
        filename: Optional[str] = None,
        department: Optional[str] = None,
        organization_id: Optional[str] = None,
        page_count: Optional[int] = None,
        custom_metadata: Optional[dict[str, Any]] = None,
    ) -> list[ChunkItem]:
        """
        Chunk document text and return a list of structured ChunkItems.
        """
        if not text or not text.strip():
            return []

        page_tracker = PageTracker(text, page_count=page_count)
        segments = self._split_into_segments(text, 0, self.separators)

        raw_chunks: list[dict[str, Any]] = []
        current_segments: list[TextSegment] = []
        current_tokens = 0
        overlap_prefix: Optional[tuple[str, int, int]] = None  # (overlap_text, start_char, end_char)

        for segment in segments:
            seg_tokens = self.tokenizer.count_tokens(segment.text)
            if current_segments and (current_tokens + seg_tokens > self.chunk_size):
                first_seg = current_segments[0]
                last_seg = current_segments[-1]

                if overlap_prefix:
                    chunk_text = overlap_prefix[0] + "".join(s.text for s in current_segments)
                    start_char = overlap_prefix[1]
                else:
                    chunk_text = "".join(s.text for s in current_segments)
                    start_char = first_seg.start_char

                end_char = last_seg.end_char
                chunk_str = chunk_text.strip()

                if chunk_str:
                    raw_chunks.append({
                        "text": chunk_str,
                        "start_char": start_char,
                        "end_char": end_char,
                        "primary_char": first_seg.start_char,
                    })

                # Compute overlap text for next chunk
                overlap_text = self.tokenizer.get_overlap_text(chunk_str, self.chunk_overlap)
                if overlap_text:
                    ov_start = max(start_char, end_char - len(overlap_text))
                    prefix_str = overlap_text + ("\n\n" if "\n" in overlap_text else " ")
                    overlap_prefix = (prefix_str, ov_start, end_char)
                    current_tokens = self.tokenizer.count_tokens(prefix_str) + seg_tokens
                else:
                    overlap_prefix = None
                    current_tokens = seg_tokens

                current_segments = [segment]
            else:
                current_segments.append(segment)
                current_tokens += seg_tokens

        # Finalize the last remaining chunk
        if current_segments:
            first_seg = current_segments[0]
            last_seg = current_segments[-1]
            if overlap_prefix:
                chunk_text = overlap_prefix[0] + "".join(s.text for s in current_segments)
                start_char = overlap_prefix[1]
            else:
                chunk_text = "".join(s.text for s in current_segments)
                start_char = first_seg.start_char

            end_char = last_seg.end_char
            chunk_str = chunk_text.strip()
            if chunk_str:
                raw_chunks.append({
                    "text": chunk_str,
                    "start_char": start_char,
                    "end_char": end_char,
                    "primary_char": first_seg.start_char,
                })

        # Filter out negligible empty chunks if any
        final_raw_chunks = [c for c in raw_chunks if c["text"].strip()]
        total_chunks = len(final_raw_chunks)

        chunk_items: list[ChunkItem] = []
        for idx, item in enumerate(final_raw_chunks):
            chunk_text = item["text"]
            token_count = self.tokenizer.count_tokens(chunk_text)
            char_count = len(chunk_text)
            start_char = item["start_char"]
            end_char = item["end_char"]
            primary_char = item.get("primary_char", start_char)

            page_num, start_page, end_page = page_tracker.get_page_info(primary_char, end_char)
            chunk_id = self.generate_chunk_id(document_id, idx, chunk_text)

            meta: dict[str, Any] = {
                "document_id": document_id,
                "knowledge_base_id": knowledge_base_id,
                "organization_id": organization_id,
                "department": department,
                "filename": filename,
                "chunk_index": idx,
                "total_chunks": total_chunks,
                "token_count": token_count,
                "char_count": char_count,
                "start_char": start_char,
                "end_char": end_char,
                "page_number": page_num,
                "start_page": start_page,
                "end_page": end_page,
            }
            if custom_metadata:
                meta.update(custom_metadata)

            chunk_items.append(
                ChunkItem(
                    chunk_id=chunk_id,
                    text=chunk_text,
                    chunk_index=idx,
                    token_count=token_count,
                    char_count=char_count,
                    start_char=start_char,
                    end_char=end_char,
                    page_number=page_num,
                    metadata=meta,
                )
            )

        return chunk_items


class ChunkingService:
    """
    Facade service orchestrating chunking operations, supporting both
    in-memory request processing and direct MongoDB consumption.
    """

    def __init__(self):
        self.default_chunker = TextChunker()

    def chunk_document(self, request: ChunkDocumentRequest) -> ChunkDocumentResponse:
        """
        Process an incoming chunking request using either provided text
        or requested chunk configuration overrides.
        """
        chunker = self._get_chunker_for_request(request)
        chunks = chunker.chunk_text(
            text=request.text or "",
            document_id=request.document_id,
            knowledge_base_id=request.knowledge_base_id,
            filename=request.filename,
            department=request.department,
            organization_id=request.organization_id,
            page_count=request.page_count,
            custom_metadata=request.metadata,
        )
        return ChunkDocumentResponse(
            status="success",
            document_id=request.document_id,
            knowledge_base_id=request.knowledge_base_id,
            total_chunks=len(chunks),
            chunks=chunks,
        )

    async def chunk_document_from_db(
        self,
        db: Any,
        document_id: str,
        chunk_size: Optional[int] = None,
        chunk_overlap: Optional[int] = None,
        tokenizer_strategy: Optional[str] = None,
    ) -> ChunkDocumentResponse:
        """
        Direct internal service interface:
        Fetches an existing processed document record from MongoDB without duplicating extraction,
        extracts metadata and knowledge base context, and performs idempotent chunking.
        """
        if db is None:
            raise ValueError("MongoDB database connection is not available")

        # Support both ObjectId and string representation
        query: dict[str, Any] = {"_id": ObjectId(document_id)} if ObjectId.is_valid(document_id) else {"_id": document_id}
        doc = await db["documents"].find_one(query)

        if not doc:
            raise ValueError(f"Document with ID {document_id} not found in MongoDB")

        extracted_text = doc.get("extractedText", "")
        kb_id = str(doc.get("knowledgeBase", ""))
        filename = doc.get("originalFileName")
        department = doc.get("department")
        organization_id = doc.get("organization")
        page_count = doc.get("pageCount")
        custom_metadata = doc.get("metadata", {})

        # If department or organization are not present on document, query KnowledgeBase collection
        if kb_id and (not department or not organization_id):
            kb_query = {"_id": ObjectId(kb_id)} if ObjectId.is_valid(kb_id) else {"_id": kb_id}
            kb = await db["knowledgebases"].find_one(kb_query)
            if kb:
                if not department:
                    department = kb.get("department")
                if not organization_id:
                    organization_id = kb.get("organization")

        req = ChunkDocumentRequest(
            document_id=str(doc.get("_id", document_id)),
            knowledge_base_id=kb_id,
            text=extracted_text,
            filename=filename,
            department=department,
            organization_id=organization_id,
            page_count=page_count,
            chunk_size=chunk_size,
            chunk_overlap=chunk_overlap,
            tokenizer_strategy=tokenizer_strategy,
            metadata=custom_metadata,
        )
        return self.chunk_document(req)

    def _get_chunker_for_request(self, request: ChunkDocumentRequest) -> TextChunker:
        """
        Instantiate a specialized chunker if request overrides defaults,
        otherwise return the default chunker.
        """
        has_overrides = (
            request.chunk_size is not None
            or request.chunk_overlap is not None
            or request.tokenizer_strategy is not None
        )
        if not has_overrides:
            return self.default_chunker

        tok = Tokenizer(strategy=request.tokenizer_strategy) if request.tokenizer_strategy else self.default_chunker.tokenizer
        return TextChunker(
            chunk_size=request.chunk_size,
            chunk_overlap=request.chunk_overlap,
            tokenizer=tok,
        )


chunking_service = ChunkingService()


def split_text(text: str, chunk_size: int = 800, chunk_overlap: int = 120) -> list[str]:
    """
    Backward-compatible helper function for callers expecting simple list[str].
    """
    if not text or not text.strip():
        return []
    chunker = TextChunker(chunk_size=chunk_size, chunk_overlap=chunk_overlap)
    items = chunker.chunk_text(
        text=text,
        document_id="temp_doc",
        knowledge_base_id="temp_kb",
    )
    return [c.text for c in items]
