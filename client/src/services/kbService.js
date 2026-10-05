import api from './api';

export const createKnowledgeBase = async (data) => {
  const response = await api.post('/knowledge-bases', data);
  return response.data;
};

export const getKnowledgeBases = async () => {
  const response = await api.get('/knowledge-bases');
  return response.data;
};

export const getKnowledgeBase = async (id) => {
  const response = await api.get(`/knowledge-bases/${id}`);
  return response.data;
};

export const updateKnowledgeBase = async (id, data) => {
  const response = await api.patch(`/knowledge-bases/${id}`, data);
  return response.data;
};

export const deleteKnowledgeBase = async (id) => {
  const response = await api.delete(`/knowledge-bases/${id}`);
  return response.data;
};
