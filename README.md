# Enterprise Knowledge Intelligence Platform

This project is an AI-powered enterprise knowledge platform designed to eventually use Retrieval-Augmented Generation (RAG) to allow users to search and ask questions about organizational documents.

## Project Architecture

This monorepo is structured as follows:

- **`client/`**: React + Vite frontend styled with Tailwind CSS.
- **`server/`**: Node.js + Express.js backend connecting to MongoDB.
- **`ai-service/`**: Python + FastAPI service to handle AI interactions.
- **`docs/`**: Project documentation and architecture diagrams.

## Phase 1 Scope

The current implementation represents Phase 1: the foundational setup.
- Basic scaffolding for the three main services.
- Base configurations for Tailwind CSS, Express, and FastAPI.
- A functional `docker-compose.yml` for future containerization (requires adding Dockerfiles).

*Note: RAG, embeddings, vector databases, and LLM integrations are not implemented in this phase.*

## Future Vision (RAG Architecture)

In upcoming phases, this platform will support RAG (Retrieval-Augmented Generation) by:
1. **Document Ingestion**: Parsing and processing organizational documents.
2. **Embeddings & Vector Store**: Converting text chunks into embeddings and storing them in a vector database.
3. **Retrieval**: Querying the vector database to retrieve relevant document chunks based on user prompts.
4. **Generation**: Using an LLM (Language Model) to generate accurate, context-aware answers.

## Getting Started

You can run each service independently during development:

### Client
```bash
cd client
npm run dev
```

### Server
```bash
cd server
npm run dev
```

### AI Service
```bash
cd ai-service
uvicorn main:app --reload
```
