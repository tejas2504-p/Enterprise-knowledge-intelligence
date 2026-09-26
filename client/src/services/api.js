import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || '/api';

const api = axios.create({
  baseURL: API_URL,
  withCredentials: true, // Send cookies with every request
  headers: {
    'Content-Type': 'application/json',
  },
});

// Add a request interceptor
api.interceptors.request.use(
  (config) => {
    // You can add logic here if you need to pass tokens in headers instead of cookies
    // const token = localStorage.getItem('token');
    // if (token) {
    //   config.headers.Authorization = `Bearer ${token}`;
    // }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Add a response interceptor for centralized error handling
api.interceptors.response.use(
  (response) => {
    return response;
  },
  (error) => {
    // Handle global errors here
    if (error.response) {
      // The request was made and the server responded with a status code
      // that falls out of the range of 2xx
      if (error.response.status === 401) {
        // Unauthorized, maybe trigger a logout event if not on auth routes
        console.warn('Unauthorized access, redirecting to login or clearing state');
        // We can emit a custom event to be picked up by AuthContext, or let AuthContext handle its own catches
        if (window.location.pathname !== '/login' && window.location.pathname !== '/register') {
            document.dispatchEvent(new Event('unauthorized'));
        }
      }
    } else if (error.request) {
      // The request was made but no response was received
      console.error('No response received from server', error.request);
    } else {
      // Something happened in setting up the request that triggered an Error
      console.error('Error in request setup', error.message);
    }
    return Promise.reject(error);
  }
);

export default api;
