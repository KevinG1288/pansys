import axios from 'axios';
import { notificarErrorDeAutenticacion, tokenParaPeticion } from '../lib/sesion';

const api = axios.create({
  baseURL: process.env.REACT_APP_API_URL
});

// Agrega el token de ESTA pestaña. Si otra pestaña cambió de cuenta o cerró la sesión, la petición
// no sale (tokenParaPeticion lanza un error que llega a quien llamó) y la pestaña se sincroniza.
api.interceptors.request.use((config) => {
  const token = tokenParaPeticion();
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
