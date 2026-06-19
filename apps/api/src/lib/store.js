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

const userByUsername = new Map();
const userByUserId = new Map();
const loginAttemptMap = new Map();

const rebuildUserIndexes = () => {
  userByUsername.clear();
  userByUserId.clear();
  for (const user of db.data.users) {
    userByUsername.set(user.username, user);
    userByUserId.set(user.userId, user);
  }
};

const rebuildLoginAttemptIndex = () => {
  loginAttemptMap.clear();
  for (const item of db.data.loginAttempts) {
    loginAttemptMap.set(`${item.username}:${item.ipAddress}`, item);
  }
};

rebuildUserIndexes();
rebuildLoginAttemptIndex();

const touch = user => {
  user.updatedAt = nowIso();
  return user;
};

export const findUserByUsername = username =>
  userByUsername.get(username.toLowerCase()) || null;

export const findUserById = userId =>
  userByUserId.get(userId) || null;

export const findUserByIdentity = identity => {
  const normalized = String(identity || '').toLowerCase();
  return db.data.users.find(
    user => user.username === normalized || user.userId === normalized
  ) || null;
};

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
  userByUsername.set(user.username, user);
  userByUserId.set(user.userId, user);
  await db.write();
  return user;
};

export const updateUser = async (userId, updater) => {
  const user = findUserById(userId);
  if (!user) {
    return null;
  }

  const oldUsername = user.username;
  updater(user);
  touch(user);
  if (user.username !== oldUsername) {
    userByUsername.delete(oldUsername);
    userByUsername.set(user.username, user);
  }
  await db.write();
  return user;
};

export const removeUser = async userId => {
  const user = findUserById(userId);
  if (!user) {
    return false;
  }

  userByUsername.delete(user.username);
  userByUserId.delete(user.userId);
  db.data.users = db.data.users.filter(item => item.userId !== userId);
  db.data.conversationKeys = db.data.conversationKeys.filter(
    item => !item.participantIds?.includes(userId)
  );
  db.data.uploads = db.data.uploads.filter(item => item.ownerId !== userId);
  await db.write();
  return true;
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

const loginAttemptKey = (username, ipAddress) =>
  `${username.toLowerCase()}:${ipAddress}`;

export const getLoginAttempt = ({ username, ipAddress }) =>
  loginAttemptMap.get(loginAttemptKey(username, ipAddress)) || null;

export const setLoginAttempt = async entry => {
  const key = loginAttemptKey(entry.username, entry.ipAddress);
  const existing = loginAttemptMap.get(key);
  if (existing) {
    Object.assign(existing, entry, { updatedAt: nowIso() });
  } else {
    const record = {
      ...entry,
      username: entry.username.toLowerCase(),
      updatedAt: nowIso()
    };
    db.data.loginAttempts.push(record);
    loginAttemptMap.set(key, record);
  }
  await db.write();
};

export const clearLoginAttempt = async ({ username, ipAddress }) => {
  const key = loginAttemptKey(username, ipAddress);
  loginAttemptMap.delete(key);
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
