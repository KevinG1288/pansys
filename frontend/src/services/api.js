import axios from 'axios';
import { notificarErrorDeAutenticacion } from '../lib/sesion';

const api = axios.create({
  baseURL: process.env.REACT_APP_API_URL
});

// Agregar token a cada petición automáticamente
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Un 401 (salvo el del login) cierra la sesión; el error se sigue propagando a quien hizo la petición
api.interceptors.response.use(
  (respuesta) => respuesta,
  (error) => {
    notificarErrorDeAutenticacion(error);
    return Promise.reject(error);
  }
);

export default api;
