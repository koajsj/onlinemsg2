import express from 'express';
import os from 'node:os';
import { asyncHandler } from '../middleware/error.js';
import { checkOpenImStatus, getOpenImUserStatuses } from '../lib/openim.js';
import { db, getDashboardStats, listPublicUsers } from '../lib/store.js';
import { config } from '../config.js';

const router = express.Router();

router.get(
  '/summary',
  asyncHandler(async (_req, res) => {
    const stats = getDashboardStats();
    const openim = await checkOpenImStatus();
    res.json({
      stats,
      openim,
      version: config.version,
      domain: config.domain
    });
  })
);

router.get(
  '/users',
  asyncHandler(async (_req, res) => {
    const users = listPublicUsers();
    const statuses = await getOpenImUserStatuses(users.map(user => user.userId));
    const statusMap = new Map(statuses.map(item => [item.userID, item.status]));
    res.json({
      users: users.map(user => ({
        ...user,
        onlineStatus: statusMap.get(user.userId) || 'offline'
      }))
    });
  })
);

router.get(
  '/logins',
  asyncHandler(async (_req, res) => {
    res.json({
      logs: db.data.loginLogs.slice(0, 100)
    });
  })
);

router.get(
  '/security',
  asyncHandler(async (_req, res) => {
    res.json({
      events: db.data.securityEvents.slice(0, 100)
    });
  })
);

router.get(
  '/system',
  asyncHandler(async (_req, res) => {
    const openim = await checkOpenImStatus();
    res.json({
      system: {
        hostname: os.hostname(),
        platform: `${os.platform()} ${os.release()}`,
        nodeVersion: process.version,
        uptimeSeconds: Math.floor(process.uptime()),
        totalMemoryMb: Math.round(os.totalmem() / 1024 / 1024),
        freeMemoryMb: Math.round(os.freemem() / 1024 / 1024),
        cpuModel: os.cpus()[0]?.model || 'unknown',
        version: config.version,
        openim
      }
    });
  })
);

export default router;
