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
});

export const indexDocumentInAI = async (document) => {
  try {
    const response = await aiClient.post('/documents/index', {
      document_id: document._id.toString(),
      knowledge_base_id: document.knowledgeBase.toString(),
      title: document.title,
      text: document.extractedText,
    });
    return response.data;
  } catch (error) {
    console.error('Failed to index document in AI service:', error.message);
    throw error;
  }
};

export const deleteDocumentFromAI = async (documentId) => {
  try {
    const response = await aiClient.delete(`/documents/${documentId}`);
    return response.data;
  } catch (error) {
    console.error('Failed to delete document from AI service:', error.message);
    throw error;
  }
};

export const deleteKnowledgeBaseFromAI = async (kbId) => {
  try {
    const response = await aiClient.delete(`/knowledge-bases/${kbId}`);
    return response.data;
  } catch (error) {
    console.error('Failed to delete knowledge base from AI service:', error.message);
    throw error;
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
    console.error('Failed to chat with AI service:', error.message);
    throw error;
  }
};
