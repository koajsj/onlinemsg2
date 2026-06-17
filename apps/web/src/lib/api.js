const API_BASE = import.meta.env.VITE_API_BASE || '/api';

const buildHeaders = ({ token, isForm }) => {
  const headers = {};
  if (!isForm) {
    headers['content-type'] = 'application/json';
  }
  if (token) {
    headers.authorization = `Bearer ${token}`;
  }
  return headers;
};

export const apiRequest = async (path, options = {}) => {
  const response = await fetch(`${API_BASE}${path}`, {
    method: options.method || 'GET',
    headers: buildHeaders({ token: options.token, isForm: options.body instanceof FormData }),
    body:
      options.body === undefined
        ? undefined
        : options.body instanceof FormData
          ? options.body
          : JSON.stringify(options.body)
  });

  if (!response.ok) {
    let message = '请求失败';
    try {
      const payload = await response.json();
      message = payload.message || message;
    } catch (_error) {
      message = response.statusText || message;
    }
    throw new Error(message);
  }

  return response.json();
};

export const apiBinary = async (path, token) => {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: buildHeaders({ token, isForm: true })
  });

  if (!response.ok) {
    throw new Error('文件获取失败');
  }

  return response.arrayBuffer();
};
