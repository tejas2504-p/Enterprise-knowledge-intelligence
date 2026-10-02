import api from './api';

export const createKnowledgeBase = async (data) => {
  const response = await api.post('/kbs', data);
  return response.data;
};

export const getKnowledgeBases = async () => {
  const response = await api.get('/kbs');
  return response.data;
};

export const getKnowledgeBase = async (id) => {
  const response = await api.get(`/kbs/${id}`);
  return response.data;
};

export const updateKnowledgeBase = async (id, data) => {
  const response = await api.put(`/kbs/${id}`, data);
  return response.data;
};

export const deleteKnowledgeBase = async (id) => {
  const response = await api.delete(`/kbs/${id}`);
  return response.data;
};
