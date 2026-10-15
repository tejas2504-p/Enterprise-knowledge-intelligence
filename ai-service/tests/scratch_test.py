import re
from app.services.tokenizer import Tokenizer

tokenizer = Tokenizer()

text = """Introduction to RAG.
Retrieval-Augmented Generation (RAG) is an AI framework for retrieving facts from an external knowledge base.

How RAG Works.
First, documents are parsed and converted into text chunks. Then, chunks are embedded into vector representations.
These vectors are stored in a vector database such as Qdrant.

Query Processing.
When a user asks a question, the query is embedded and compared against stored document vectors.
Relevant chunks are retrieved and provided to the LLM as context."""

print("Original token count:", tokenizer.count_tokens(text))
