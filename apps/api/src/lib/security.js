import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { config } from '../config.js';
import {
  clearLoginAttempt,
  getLoginAttempt,
  logLoginAttempt,
  logSecurityEvent,
  setLoginAttempt
} from './store.js';
import { authUser, cleanText, getClientInfo, getIpAddress, nowIso } from './utils.js';

const usernameSchema = z
  .string()
  .min(1)
  .max(24)
  .regex(/^[a-zA-Z0-9_]+$/);

const passwordSchema = z
  .string()
  .min(8)
  .max(64)
  .regex(/^(?=.*[A-Za-z])(?=.*\d).+$/);

const jwkSchema = z.string().min(32).max(12000).refine(val => {
  if (!val) return true;
  try {
    const parsed = JSON.parse(val);
    return parsed.kty && typeof parsed.kty === 'string';
  } catch {
    return false;
  }
}, { message: '公钥格式无效，需要 JWK 格式' });

export const registerSchema = z.object({
  username: usernameSchema,
  password: passwordSchema,
  nickname: z.string().min(1).max(32),
  publicKey: jwkSchema
});

export const loginSchema = z.object({
  username: usernameSchema,
  password: z.string().min(8).max(64)
});

export const credentialsSchema = z
  .object({
    currentPassword: z.string().min(8).max(64),
    newUsername: usernameSchema.optional(),
    newPassword: passwordSchema.optional()
  })
  .refine(input => input.newUsername || input.newPassword, {
    message: '至少填写新账号或新密码',
    path: ['newUsername']
  });

export const profileSchema = z.object({
  nickname: z.string().min(1).max(32).optional(),
  bio: z.string().max(160).optional(),
  avatarUrl: z.string().max(500).optional(),
  publicKey: jwkSchema.optional(),
  preferences: z
    .object({
      theme: z.enum(['light', 'dark', 'system']).optional(),
      notifications: z.boolean().optional(),
      darkMode: z.boolean().optional()
    })
    .optional()
});

export const conversationKeySchema = z.object({
  participantIds: z.array(usernameSchema).length(2),
  envelopes: z.array(
    z.object({
      userId: usernameSchema,
      wrappedKey: z.string().min(32).max(8000)
    })
  ).length(2)
});

export const signToken = user =>
  jwt.sign(
    {
      sub: user.userId,
      username: user.username,
      role: user.role
    },
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn }
  );

export const verifyPassword = (password, passwordHash) => bcrypt.compare(password, passwordHash);
export const hashPassword = password => bcrypt.hash(password, 12);

export const sanitizeProfileInput = input => ({
  nickname: input.nickname ? cleanText(input.nickname, 32) : undefined,
  bio: input.bio ? cleanText(input.bio, 160) : undefined,
  avatarUrl: input.avatarUrl ? cleanText(input.avatarUrl, 500) : undefined,
  publicKey: input.publicKey,
  preferences: input.preferences
});

export const ensureLoginAllowed = async (req, username) => {
  const ipAddress = getIpAddress(req);
  const attempt = getLoginAttempt({ username, ipAddress });
  if (attempt?.lockedUntil && new Date(attempt.lockedUntil).getTime() > Date.now()) {
    const client = getClientInfo(req);
    await logSecurityEvent({
      userId: null,
      level: 'warn',
      eventType: 'login_locked',
      ipAddress,
      browser: client.browser,
      os: client.os,
      details: `${username} locked until ${attempt.lockedUntil}`
    });
    throw new Error('登录失败次数过多，请稍后再试');
  }
};

export const registerFailedLogin = async (req, username, reason) => {
  const ipAddress = getIpAddress(req);
  const client = getClientInfo(req);
  const attempt = getLoginAttempt({ username, ipAddress });
  const failCount = (attempt?.failCount || 0) + 1;
  const lockedUntil = failCount >= 5 ? new Date(Date.now() + 15 * 60 * 1000).toISOString() : null;

  await setLoginAttempt({
    username,
    ipAddress,
    failCount,
    lockedUntil
  });

  await logLoginAttempt({
    userId: null,
    username: username.toLowerCase(),
    status: 'failed',
    ipAddress,
    browser: client.browser,
    os: client.os,
    message: reason
  });

  await logSecurityEvent({
    userId: null,
    level: 'warn',
    eventType: 'login_failed',
    ipAddress,
    browser: client.browser,
    os: client.os,
    details: `${username}: ${reason}`
  });
};

export const registerSuccessfulLogin = async (req, user) => {
  const ipAddress = getIpAddress(req);
  const client = getClientInfo(req);
  await clearLoginAttempt({ username: user.username, ipAddress });
  await logLoginAttempt({
    userId: user.userId,
    username: user.username,
    status: 'success',
    ipAddress,
    browser: client.browser,
    os: client.os,
    message: 'ok'
  });
};

export const buildAuthPayload = ({ user, openimToken }) => ({
  token: signToken(user),
  expiresIn: config.jwtExpiresIn,
  openimToken,
  user: authUser(user),
  serverTime: nowIso()
});
