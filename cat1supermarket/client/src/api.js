import axios from 'axios';

const API_BASE_URL = '/api';

// Create axios instance with default config
const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json'
  }
});

// Add token to requests if available
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Handle auth errors
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401 || error.response?.status === 403) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      if (window.location.pathname !== '/') {
        window.location.href = '/';
      }
    }
    return Promise.reject(error);
  }
);

// Auth API
export const authAPI = {
  login: (username, password) => api.post('/auth/login', { username, password }),
  register: (username, password, role) => api.post('/auth/register', { username, password, role }),
  me: () => api.get('/auth/me'),
};

// Inventory API
export const inventoryAPI = {
  getAll: (branch = null) => {
    const params = branch && branch !== 'All' ? { branch } : {};
    return api.get('/inventory', { params });
  },
  addItem: (itemData) => api.post('/inventory', itemData),
  updateItem: (id, data) => api.put(`/inventory/${id}`, data),
  updateStock: (id, stock) => api.put(`/inventory/${id}/stock`, { stock }),
  deleteItem: (id) => api.delete(`/inventory/${id}`),
  getCounties: () => api.get('/inventory/counties'),
  addCounty: (countyData) => api.post('/inventory/counties', countyData),
  updateCounty: (id, countyData) => api.put(`/inventory/counties/${id}`, countyData),
  deleteCounty: (id) => api.delete(`/inventory/counties/${id}`),
  addProduct(param) {

  }
};

// Sales API
export const salesAPI = {
  record: (saleData) => api.post('/sales', saleData),
  getReport: (filters = {}) => api.get('/sales/report', { params: filters }),
  getSummary: (branch = null) => {
    const params = branch && branch !== 'All' ? { branch } : {};
    return api.get('/sales/summary', { params });
  },
  getByProduct: (branch = null) => {
    const params = branch && branch !== 'All' ? { branch } : {};
    return api.get('/sales/by-product', { params });
  },
  getByBranch: () => api.get('/sales/by-branch'),
};

// M-Pesa API
export const mpesaAPI = {
  stkPush: (paymentData) => api.post('/mpesa/stkpush', paymentData),
  stkQuery: (checkoutRequestID) => api.post('/mpesa/stkquery', { checkoutRequestID }),
  getTransactions: () => api.get('/mpesa/transactions'),
  getConfigStatus: () => api.get('/mpesa/config-status'),
  testConnection: () => api.get('/mpesa/test-connection'),
};

// Helper functions for session management
export const session = {
  setToken: (token) => {
    localStorage.setItem('token', token);
  },
  getToken: () => localStorage.getItem('token'),
  setUser: (user) => {
    localStorage.setItem('user', JSON.stringify(user));
  },
  getUser: () => {
    const user = localStorage.getItem('user');
    return user ? JSON.parse(user) : null;
  },
  logout: () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
  },
  isAuthenticated: () => !!localStorage.getItem('token'),
};

export default api;

