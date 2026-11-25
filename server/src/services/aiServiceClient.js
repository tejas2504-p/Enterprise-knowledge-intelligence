import axios from 'axios';
import crypto from 'crypto';
import dotenv from 'dotenv';

dotenv.config();

const AI_SERVICE_URL = process.env.AI_SERVICE_URL || 'http://localhost:8000/api/internal';
const AI_RAG_URL =
  process.env.AI_RAG_URL ||
  (AI_SERVICE_URL.endsWith('/api/internal')
    ? AI_SERVICE_URL.replace(/\/api\/internal$/, '/api/rag')
    : `${AI_SERVICE_URL.replace(/\/$/, '')}/api/rag`);

const getServiceApiKey = () => process.env.SERVICE_API_KEY;

const aiClient = axios.create({
  baseURL: AI_SERVICE_URL,
  headers: {
    'x-api-key': getServiceApiKey(),
    'Content-Type': 'application/json',
  },
  timeout: 60000, // 60s timeout for embedding generation
});

const ragClient = axios.create({
  baseURL: AI_RAG_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 45000, // 45s timeout for retrieval + Gemini answer generation
});

export { aiClient, ragClient };

/**
 * Cryptographically sign the authenticated user's server-verified identity claims
 * so the Python AI service can verify authenticity without trusting client headers.
 */
export const createUserContextToken = (user, organizationId = null) => {
  if (!user || !user._id) {
    throw new Error('Cannot sign user context: authenticated user is required');
  }
  const secret = getServiceApiKey();
  if (!secret) {
    throw new Error('SERVICE_API_KEY is not configured');
  }

  const now = Math.floor(Date.now() / 1000);
  const payload = {
    user_id: user._id.toString(),
    role: user.role || 'user',
    department: user.department ?? null,
    organization_id: organizationId ?? user.organization ?? null,
    iat: now,
    exp: now + 60,
  };

  const encodedPayload = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const signature = crypto
    .createHmac('sha256', secret)
    .update(encodedPayload, 'utf8')
    .digest('base64url');

  return `${encodedPayload}.${signature}`;
};

/**
 * Redact potential secrets/tokens from upstream error messages before logging or forwarding.
 */
const sanitizeUpstreamMessage = (msg) => {
  if (!msg || typeof msg !== 'string') return 'AI service error';
  return msg
    .replace(/AIza[0-9A-Za-z_-]+/g, '[REDACTED_KEY]')
    .replace(/internal_service_key[^\s]*/gi, '[REDACTED_SECRET]')
    .slice(0, 300);
};

/**
 * Format a Mongoose Document instance or plain object into an AI Service IndexDocumentRequest payload.
 */
const formatDocumentForAI = (document) => {
  const kbId = document.knowledgeBase?._id
    ? document.knowledgeBase._id.toString()
    : document.knowledgeBase?.toString();
  const department = document.department || document.knowledgeBase?.department || null;
  const organizationId = document.organization || document.knowledgeBase?.organization || null;

  return {
    document_id: document._id.toString(),
    knowledge_base_id: kbId,
    title: document.title || '',
    text: document.extractedText || '',
    filename: document.originalFileName || null,
    department: department,
    organization_id: organizationId,
    page_count: document.pageCount || null,
    metadata: {
      ...(document.metadata || {}),
      visibility: document.visibility || 'private',
      fileSize: document.fileSize,
      mimeType: document.mimeType,
    },
  };
};

export const indexDocumentInAI = async (document) => {
  try {
    const payload = formatDocumentForAI(document);
    const response = await aiClient.post('/documents/index', payload);
    return response.data;
  } catch (error) {
    const errorMsg = sanitizeUpstreamMessage(error.response?.data?.detail || error.message);
    console.error(`Failed to index document in AI service: ${errorMsg}`);
    throw new Error(`AI Service indexing error: ${errorMsg}`);
  }
};

export const batchIndexDocumentsInAI = async (documents) => {
  try {
    const formattedDocs = documents.map(formatDocumentForAI);
    const response = await aiClient.post('/documents/batch-index', {
      documents: formattedDocs,
    });
    return response.data;
  } catch (error) {
    const errorMsg = sanitizeUpstreamMessage(error.response?.data?.detail || error.message);
    console.error(`Failed to batch index documents in AI service: ${errorMsg}`);
    throw new Error(`AI Service batch indexing error: ${errorMsg}`);
  }
};

export const chunkDocumentInAI = async (document, options = {}) => {
  try {
    const payload = {
      ...formatDocumentForAI(document),
      ...options,
    };
    const response = await aiClient.post('/documents/chunk', payload);
    return response.data;
  } catch (error) {
    const errorMsg = sanitizeUpstreamMessage(error.response?.data?.detail || error.message);
    console.error(`Failed to chunk document in AI service: ${errorMsg}`);
    throw new Error(`AI Service chunking error: ${errorMsg}`);
  }
};

export const deleteDocumentFromAI = async (documentId) => {
  try {
    const response = await aiClient.delete(`/documents/${documentId}`);
    return response.data;
  } catch (error) {
    const errorMsg = sanitizeUpstreamMessage(error.response?.data?.detail || error.message);
    console.error(`Failed to delete document from AI service: ${errorMsg}`);
    throw new Error(`AI Service deletion error: ${errorMsg}`);
  }
};

export const deleteKnowledgeBaseFromAI = async (kbId) => {
  try {
    const response = await aiClient.delete(`/knowledge-bases/${kbId}`);
    return response.data;
  } catch (error) {
    const errorMsg = sanitizeUpstreamMessage(error.response?.data?.detail || error.message);
    console.error(`Failed to delete knowledge base from AI service: ${errorMsg}`);
    throw new Error(`AI Service KB deletion error: ${errorMsg}`);
  }
};

/**
 * Execute a RAG query against the protected Python AI Service (/api/rag/query)
 * forwarding the authenticated user's verified identity via HMAC-signed context token.
 */
export const queryRagInAI = async ({
  question,
  knowledgeBaseId,
  conversationId = null,
  top_k = undefined,
  similarity_threshold = undefined,
  user,
  organizationId = null,
}) => {
  const apiKey = getServiceApiKey();
  const userContextToken = createUserContextToken(user, organizationId);

  const payload = {
    question,
    knowledgeBaseId,
  };
  if (conversationId) payload.conversationId = conversationId;
  if (top_k !== undefined) payload.top_k = top_k;
  if (similarity_threshold !== undefined) payload.similarity_threshold = similarity_threshold;

  try {
    const response = await ragClient.post('/query', payload, {
      headers: {
        'x-api-key': apiKey,
        'x-user-context-token': userContextToken,
      },
    });
    return response.data;
  } catch (error) {
    const status = error.response?.status;
    const rawDetail = error.response?.data?.detail || error.response?.data?.message || error.message;
    const safeMsg = sanitizeUpstreamMessage(rawDetail);
    console.error(`RAG query via AI service failed (${status || 'network'}): ${safeMsg}`);

    const err = new Error(
      status && status >= 400 && status < 500
        ? safeMsg
        : status
          ? `AI RAG service error: ${safeMsg}`
          : 'AI service is currently unavailable. Please ensure the AI service is running and try again.'
    );
    err.statusCode = status && status >= 400 && status < 500 ? status : status ? 502 : 503;
    throw err;
  }
};

export const chatWithAI = async (query, kbIds, chatHistory = []) => {
  try {
    const response = await aiClient.post('/chat', {
      query,
      knowledge_base_ids: kbIds,
      chat_history: chatHistory,
    });
    return response.data;
  } catch (error) {
    const errorMsg = sanitizeUpstreamMessage(error.response?.data?.detail || error.message);
    console.error(`Failed to chat with AI service: ${errorMsg}`);
    throw new Error(`AI Service chat error: ${errorMsg}`);
  }
};
