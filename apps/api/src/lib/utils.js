import crypto from 'node:crypto';
import { UAParser } from 'ua-parser-js';

export const nowIso = () => new Date().toISOString();
export const createId = (prefix = '') => `${prefix}${crypto.randomUUID()}`;
export const createOperationId = () => `${Date.now()}-${crypto.randomUUID()}`;

export const cleanText = (value, maxLength = 200) => {
  const text = String(value || '')
    .replace(/[<>]/g, '')
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .trim();
  return text.slice(0, maxLength);
};

export const getIpAddress = req => {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim();
  }

  return req.socket.remoteAddress || 'unknown';
};

export const getClientInfo = req => {
  const parser = new UAParser(req.headers['user-agent'] || '');
  const result = parser.getResult();
  const browser = [result.browser.name, result.browser.version].filter(Boolean).join(' ');
  const os = [result.os.name, result.os.version].filter(Boolean).join(' ');

  return {
    browser: browser || 'Unknown',
    os: os || 'Unknown'
  };
};

export const publicUser = user => ({
  userId: user.userId,
  username: user.username,
  nickname: user.nickname,
  avatarUrl: user.avatarUrl,
  bio: user.bio,
  publicKey: user.publicKey,
  role: user.role,
  createdAt: user.createdAt,
  updatedAt: user.updatedAt,
  lastLoginAt: user.lastLoginAt,
  preferences: user.preferences
});

export const authUser = user => ({
  ...publicUser(user),
  isAdmin: user.role === 'admin'
});
