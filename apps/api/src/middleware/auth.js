import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { findUserById } from '../lib/store.js';

export const requireAuth = (req, res, next) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';

  if (!token) {
    res.status(401).json({ message: '未登录' });
    return;
  }

  try {
    const payload = jwt.verify(token, config.jwtSecret);
    const user = findUserById(payload.sub);
    if (!user) {
      res.status(401).json({ message: '账号不存在' });
      return;
    }

    req.auth = payload;
    req.user = user;
    next();
  } catch (_error) {
    res.status(401).json({ message: '登录已过期，请重新登录' });
  }
};

export const requireAdmin = (req, res, next) => {
  if (req.user?.role !== 'admin') {
    res.status(403).json({ message: '无权访问' });
    return;
  }

  next();
};
