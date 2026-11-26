import api from './api';

export const queryRag = async ({
  question,
  knowledgeBaseId,
  conversationId = null,
  top_k,
  similarity_threshold,
}) => {
  const payload = {
    question,
    knowledgeBaseId,
  };
  if (conversationId) payload.conversationId = conversationId;
  if (top_k !== undefined) payload.top_k = top_k;
  if (similarity_threshold !== undefined) payload.similarity_threshold = similarity_threshold;

  const response = await api.post('/rag/query', payload);
  return response.data;
};

export const getConversations = async (knowledgeBaseId = null) => {
  const params = knowledgeBaseId ? { knowledgeBaseId } : {};
  const response = await api.get('/conversations', { params });
  return response.data;
};

export const getConversation = async (id) => {
  const response = await api.get(`/conversations/${id}`);
  return response.data;
};

export const deleteConversation = async (id) => {
  const response = await api.delete(`/conversations/${id}`);
  return response.data;
};
