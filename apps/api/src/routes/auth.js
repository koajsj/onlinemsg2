import express from 'express';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/error.js';
import { findUserByUsername, updateUser } from '../lib/store.js';
import { ensureOpenImUser, getOpenImUserToken } from '../lib/openim.js';
import {
  buildAuthPayload,
  ensureLoginAllowed,
  loginSchema,
  registerFailedLogin,
  registerSchema,
  registerSuccessfulLogin,
  verifyPassword
} from '../lib/security.js';
import { addUser } from '../lib/store.js';

const router = express.Router();

router.post(
  '/register',
  asyncHandler(async (req, res) => {
    const input = registerSchema.parse(req.body);
    const username = input.username.toLowerCase();
    if (findUserByUsername(username)) {
      throw new Error('账号已存在');
    }

    const user = await addUser({
      userId: username,
      username,
      nickname: input.nickname,
      password: input.password,
      publicKey: input.publicKey,
      role: 'user'
    });

    await ensureOpenImUser({
      userId: user.userId,
      nickname: user.nickname,
      avatarUrl: user.avatarUrl
    });

    const openimToken = await getOpenImUserToken(user.userId);
    await registerSuccessfulLogin(req, user);
    await updateUser(user.userId, current => {
      current.lastLoginAt = new Date().toISOString();
    });

    res.json(buildAuthPayload({ user, openimToken }));
  })
);

router.post(
  '/login',
  asyncHandler(async (req, res) => {
    const input = loginSchema.parse(req.body);
    const username = input.username.toLowerCase();
    await ensureLoginAllowed(req, username);

    const user = findUserByUsername(username);
    if (!user) {
      await registerFailedLogin(req, username, '账号不存在');
      throw new Error('账号或密码错误');
    }

    const isValid = await verifyPassword(input.password, user.passwordHash);
    if (!isValid) {
      await registerFailedLogin(req, username, '密码错误');
      throw new Error('账号或密码错误');
    }

    await ensureOpenImUser({
      userId: user.userId,
      nickname: user.nickname,
      avatarUrl: user.avatarUrl
    });

    const openimToken = await getOpenImUserToken(user.userId);
    await registerSuccessfulLogin(req, user);
    await updateUser(user.userId, current => {
      current.lastLoginAt = new Date().toISOString();
    });

    res.json(buildAuthPayload({ user, openimToken }));
  })
);

router.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({ user: buildAuthPayload({ user: req.user, openimToken: '' }).user });
  })
);

router.post(
  '/logout',
  asyncHandler(async (_req, res) => {
    res.json({ ok: true });
  })
);

export default router;
