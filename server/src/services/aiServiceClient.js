import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const AI_SERVICE_URL = process.env.AI_SERVICE_URL || 'http://localhost:8000/api/internal';
const API_KEY = process.env.SERVICE_API_KEY;

const aiClient = axios.create({
  baseURL: AI_SERVICE_URL,
  headers: {
    'x-api-key': API_KEY,
    'Content-Type': 'application/json',
  },
  timeout: 60000, // 60s timeout for embedding generation
});

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
    const errorMsg = error.response?.data?.detail || error.message;
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
    const errorMsg = error.response?.data?.detail || error.message;
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
    const errorMsg = error.response?.data?.detail || error.message;
    console.error(`Failed to chunk document in AI service: ${errorMsg}`);
    throw new Error(`AI Service chunking error: ${errorMsg}`);
  }
};

export const deleteDocumentFromAI = async (documentId) => {
  try {
    const response = await aiClient.delete(`/documents/${documentId}`);
    return response.data;
  } catch (error) {
    const errorMsg = error.response?.data?.detail || error.message;
    console.error(`Failed to delete document from AI service: ${errorMsg}`);
    throw new Error(`AI Service deletion error: ${errorMsg}`);
  }
};

export const deleteKnowledgeBaseFromAI = async (kbId) => {
  try {
    const response = await aiClient.delete(`/knowledge-bases/${kbId}`);
    return response.data;
  } catch (error) {
    const errorMsg = error.response?.data?.detail || error.message;
    console.error(`Failed to delete knowledge base from AI service: ${errorMsg}`);
    throw new Error(`AI Service KB deletion error: ${errorMsg}`);
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
    const errorMsg = error.response?.data?.detail || error.message;
    console.error(`Failed to chat with AI service: ${errorMsg}`);
    throw new Error(`AI Service chat error: ${errorMsg}`);
  }
};
