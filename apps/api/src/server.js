import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { config } from './config.js';
import { requireAdmin, requireAuth } from './middleware/auth.js';
import { errorHandler, notFound } from './middleware/error.js';
import authRoutes from './routes/auth.js';
import usersRoutes from './routes/users.js';
import keysRoutes from './routes/keys.js';
import uploadsRoutes from './routes/uploads.js';
import adminRoutes from './routes/admin.js';
import { checkOpenImStatus } from './lib/openim.js';

const app = express();

app.set('trust proxy', true);
app.use(
  cors({
    origin(origin, callback) {
      if (!origin || config.frontendOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error('origin not allowed'));
    }
  })
);
app.use(
  helmet({
    crossOriginResourcePolicy: false
  })
);
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false }));

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: '请求过于频繁，请稍后再试' }
});

const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: '上传过于频繁，请稍后再试' }
});

const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: '请求过于频繁，请稍后再试' }
});

const getHealthPayload = async () => {
  const openim = await checkOpenImStatus();
  return {
    ok: true,
    openim,
    version: config.version
  };
};

app.get('/health', async (_req, res) => {
  res.json(await getHealthPayload());
});

app.get('/api/health', async (_req, res) => {
  res.json(await getHealthPayload());
});

app.use(globalLimiter);
app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/users', requireAuth, usersRoutes);
app.use('/api/keys', requireAuth, keysRoutes);
app.use('/api/uploads', requireAuth, uploadLimiter, uploadsRoutes);
app.use('/api/admin', requireAuth, requireAdmin, adminRoutes);

app.use(notFound);
app.use(errorHandler);

const server = app.listen(config.port, () => {
  console.log(`API listening on ${config.port}`);
});

const shutdown = signal => {
  console.log(`${signal} received, shutting down gracefully…`);
  server.close(() => {
    console.log('HTTP server closed');
    process.exit(0);
  });
  setTimeout(() => {
    console.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10_000);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
