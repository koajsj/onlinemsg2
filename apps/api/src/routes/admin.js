import express from 'express';
import os from 'node:os';
import { asyncHandler } from '../middleware/error.js';
import { checkOpenImStatus, getOpenImUserStatuses } from '../lib/openim.js';
import { db, getDashboardStats, listPublicUsers } from '../lib/store.js';
import { config } from '../config.js';

const router = express.Router();

const parsePagination = query => {
  const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 200);
  const offset = Math.max(Number(query.offset) || 0, 0);
  return { limit, offset };
};

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
  asyncHandler(async (req, res) => {
    const { limit, offset } = parsePagination(req.query);
    const allUsers = listPublicUsers();
    const paged = allUsers.slice(offset, offset + limit);
    const statuses = await getOpenImUserStatuses(paged.map(user => user.userId));
    const statusMap = new Map(statuses.map(item => [item.userID, item.status]));
    res.json({
      users: paged.map(user => ({
        ...user,
        onlineStatus: statusMap.get(user.userId) || 'offline'
      })),
      total: allUsers.length,
      limit,
      offset
    });
  })
);

router.get(
  '/logins',
  asyncHandler(async (req, res) => {
    const { limit, offset } = parsePagination(req.query);
    const total = db.data.loginLogs.length;
    res.json({
      logs: db.data.loginLogs.slice(offset, offset + limit),
      total,
      limit,
      offset
    });
  })
);

router.get(
  '/security',
  asyncHandler(async (req, res) => {
    const { limit, offset } = parsePagination(req.query);
    const total = db.data.securityEvents.length;
    res.json({
      events: db.data.securityEvents.slice(offset, offset + limit),
      total,
      limit,
      offset
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
