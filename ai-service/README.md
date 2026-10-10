# Enterprise Knowledge AI Service

This service handles the Retrieval-Augmented Generation (RAG) pipeline for the Enterprise Knowledge Intelligence Platform.

## Responsibilities
- Text chunking and embedding generation.
- Managing vector data in Qdrant.
- Handling LLM generation with context retrieval.

## Setup
1. `python -m venv venv`
2. `source venv/bin/activate` or `.\venv\Scripts\activate` on Windows
3. `pip install -r requirements.txt`
4. Copy `.env.example` to `.env` and fill out your keys.
5. Run using `uvicorn main:app --reload`
