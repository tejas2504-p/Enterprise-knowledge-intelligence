import api from './api';

export const uploadDocument = async (kbId, file, title) => {
  const formData = new FormData();
  formData.append('kbId', kbId);
  formData.append('file', file);
  if (title) {
    formData.append('title', title);
  }

  const response = await api.post('/documents/upload', formData, {
    headers: {
      'Content-Type': 'multipart/form-data',
    },
  });
  return response.data;
};

export const getDocuments = async (kbId) => {
  const response = await api.get(`/documents/kb/${kbId}`);
  return response.data;
};

export const getDocument = async (id) => {
  const response = await api.get(`/documents/${id}`);
  return response.data;
};

export const deleteDocument = async (id) => {
  const response = await api.delete(`/documents/${id}`);
  return response.data;
};
