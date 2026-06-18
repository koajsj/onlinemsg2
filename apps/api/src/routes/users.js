import express from 'express';
import { asyncHandler } from '../middleware/error.js';
import { clearLoginAttempt, findUserByUsername, logSecurityEvent, updateUser, listPublicUsers } from '../lib/store.js';
import {
  buildAuthPayload,
  credentialsSchema,
  hashPassword,
  profileSchema,
  sanitizeProfileInput,
  verifyPassword
} from '../lib/security.js';
import { getOpenImUserToken, updateOpenImUser } from '../lib/openim.js';
import { authUser, getClientInfo, getIpAddress } from '../lib/utils.js';

const router = express.Router();

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const allUsers = listPublicUsers().filter(user => user.userId !== req.user.userId);
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
    const offset = Math.max(Number(req.query.offset) || 0, 0);
    res.json({
      users: allUsers.slice(offset, offset + limit),
      total: allUsers.length,
      limit,
      offset
    });
  })
);

router.patch(
  '/me',
  asyncHandler(async (req, res) => {
    const parsed = profileSchema.parse(req.body);
    const input = sanitizeProfileInput(parsed);
    const nextUser = {
      nickname: input.nickname ?? req.user.nickname,
      avatarUrl: typeof input.avatarUrl === 'string' ? input.avatarUrl : req.user.avatarUrl
    };

    await updateOpenImUser({
      userId: req.user.userId,
      nickname: nextUser.nickname,
      avatarUrl: nextUser.avatarUrl
    });

    const updated = await updateUser(req.user.userId, user => {
      if (input.nickname) user.nickname = input.nickname;
      if (typeof input.bio === 'string') user.bio = input.bio;
      if (typeof input.avatarUrl === 'string') user.avatarUrl = input.avatarUrl;
      if (typeof input.publicKey === 'string') user.publicKey = input.publicKey;
      if (input.preferences) {
        user.preferences = {
          ...user.preferences,
          ...input.preferences
        };
      }
    });

    res.json({ user: authUser(updated) });
  })
);

router.patch(
  '/me/credentials',
  asyncHandler(async (req, res) => {
    const input = credentialsSchema.parse(req.body);
    const currentUsername = req.user.username;
    const nextUsername = input.newUsername ? input.newUsername.toLowerCase() : currentUsername;
    const usernameChanged = nextUsername !== currentUsername;
    const passwordChanged = typeof input.newPassword === 'string' && input.newPassword.length > 0;

    const isValid = await verifyPassword(input.currentPassword, req.user.passwordHash);
    if (!isValid) {
      throw new Error('当前密码错误');
    }

    if (usernameChanged) {
      const existingUser = findUserByUsername(nextUsername);
      if (existingUser && existingUser.userId !== req.user.userId) {
        throw new Error('新账号已存在');
      }
    }

    const nextPasswordHash = passwordChanged
      ? await hashPassword(input.newPassword)
      : req.user.passwordHash;

    const updated = await updateUser(req.user.userId, user => {
      if (usernameChanged) {
        user.username = nextUsername;
      }
      if (passwordChanged) {
        user.passwordHash = nextPasswordHash;
      }
    });

    const ipAddress = getIpAddress(req);
    const client = getClientInfo(req);
    await clearLoginAttempt({ username: currentUsername, ipAddress });
    await logSecurityEvent({
      userId: req.user.userId,
      level: 'info',
      eventType: 'credentials_updated',
      ipAddress,
      browser: client.browser,
      os: client.os,
      details: `usernameChanged=${usernameChanged}; passwordChanged=${passwordChanged}`
    });

    const openimToken = await getOpenImUserToken(updated.userId);
    res.json({
      ...buildAuthPayload({ user: updated, openimToken }),
      usernameChanged,
      passwordChanged
    });
  })
);

export default router;
