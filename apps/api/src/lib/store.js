import bcrypt from 'bcryptjs';
import { JSONFilePreset } from 'lowdb/node';
import path from 'node:path';
import { config } from '../config.js';
import { authUser, createId, nowIso } from './utils.js';

const dbFile = path.join(config.dataDir, 'app.json');

const defaultData = {
  users: [],
  loginLogs: [],
  securityEvents: [],
  conversationKeys: [],
  uploads: [],
  loginAttempts: []
};

export const db = await JSONFilePreset(dbFile, defaultData);

const touch = user => {
  user.updatedAt = nowIso();
  return user;
};

export const findUserByUsername = username =>
  db.data.users.find(user => user.username === username.toLowerCase()) || null;

export const findUserById = userId =>
  db.data.users.find(user => user.userId === userId) || null;

export const listUsers = () => db.data.users.map(authUser);

export const listPublicUsers = () => db.data.users.map(authUser);

export const addUser = async input => {
  const timestamp = nowIso();
  const passwordHash = await bcrypt.hash(input.password, 12);
  const user = {
    userId: input.userId,
    username: input.username.toLowerCase(),
    nickname: input.nickname,
    passwordHash,
    role: input.role || 'user',
    avatarUrl: input.avatarUrl || '',
    bio: '',
    publicKey: input.publicKey,
    preferences: {
      theme: 'system',
      notifications: true,
      darkMode: false
    },
    createdAt: timestamp,
    updatedAt: timestamp,
    lastLoginAt: null
  };

  db.data.users.push(user);
  await db.write();
  return user;
};

export const updateUser = async (userId, updater) => {
  const user = findUserById(userId);
  if (!user) {
    return null;
  }

  updater(user);
  touch(user);
  await db.write();
  return user;
};

export const logLoginAttempt = async entry => {
  db.data.loginLogs.unshift({
    id: createId('log_'),
    createdAt: nowIso(),
    ...entry
  });
  db.data.loginLogs = db.data.loginLogs.slice(0, 500);
  await db.write();
};

export const logSecurityEvent = async entry => {
  db.data.securityEvents.unshift({
    id: createId('sec_'),
    createdAt: nowIso(),
    ...entry
  });
  db.data.securityEvents = db.data.securityEvents.slice(0, 500);
  await db.write();
};

export const getLoginAttempt = ({ username, ipAddress }) =>
  db.data.loginAttempts.find(
    item => item.username === username.toLowerCase() && item.ipAddress === ipAddress
  ) || null;

export const setLoginAttempt = async entry => {
  const existing = getLoginAttempt(entry);
  if (existing) {
    Object.assign(existing, entry, { updatedAt: nowIso() });
  } else {
    db.data.loginAttempts.push({
      ...entry,
      username: entry.username.toLowerCase(),
      updatedAt: nowIso()
    });
  }
  await db.write();
};

export const clearLoginAttempt = async ({ username, ipAddress }) => {
  db.data.loginAttempts = db.data.loginAttempts.filter(
    item => !(item.username === username.toLowerCase() && item.ipAddress === ipAddress)
  );
  await db.write();
};

export const saveConversationKeys = async ({ conversationId, envelopes, participantIds, createdBy }) => {
  const timestamp = nowIso();
  db.data.conversationKeys = db.data.conversationKeys.filter(
    item => item.conversationId !== conversationId
  );

  for (const envelope of envelopes) {
    db.data.conversationKeys.push({
      conversationId,
      userId: envelope.userId,
      wrappedKey: envelope.wrappedKey,
      participantIds,
      algorithm: 'RSA-OAEP/AES-GCM',
      createdAt: timestamp,
      updatedAt: timestamp,
      createdBy
    });
  }

  await db.write();
};

export const getConversationKeyForUser = ({ conversationId, userId }) =>
  db.data.conversationKeys.find(
    item => item.conversationId === conversationId && item.userId === userId
  ) || null;

export const addUpload = async entry => {
  db.data.uploads.push({
    id: entry.id,
    ownerId: entry.ownerId,
    allowedUserIds: [...new Set([entry.ownerId, ...(entry.allowedUserIds || [])])],
    originalName: entry.originalName,
    storedName: entry.storedName,
    mimeType: entry.mimeType,
    size: entry.size,
    category: entry.category,
    createdAt: nowIso()
  });
  await db.write();
};

export const getUpload = uploadId =>
  db.data.uploads.find(item => item.id === uploadId) || null;

export const getDashboardStats = () => ({
  totalUsers: db.data.users.length,
  totalAdmins: db.data.users.filter(user => user.role === 'admin').length,
  recentLoginCount: db.data.loginLogs.filter(log => log.status === 'success').slice(0, 20).length,
  securityEventCount: db.data.securityEvents.length
});

if (
  config.defaultAdminUsername &&
  config.defaultAdminPassword &&
  db.data.users.every(user => user.role !== 'admin')
) {
  await addUser({
    userId: config.defaultAdminUsername.toLowerCase(),
    username: config.defaultAdminUsername.toLowerCase(),
    nickname: '管理员',
    password: config.defaultAdminPassword,
    publicKey: '',
    role: 'admin',
    avatarUrl: ''
  });
}
