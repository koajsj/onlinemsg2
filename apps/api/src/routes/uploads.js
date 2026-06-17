import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import express from 'express';
import multer from 'multer';
import { z } from 'zod';
import { config } from '../config.js';
import { asyncHandler } from '../middleware/error.js';
import { addUpload, findUserById, getUpload } from '../lib/store.js';
import { cleanText } from '../lib/utils.js';

const router = express.Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: config.maxAttachmentSize
  }
});

const uploadSchema = z.object({
  category: z.enum(['image', 'file']),
  peerUserId: z.string().min(1).max(24).regex(/^[a-zA-Z0-9_]+$/),
  originalName: z.string().min(1).max(200),
  originalMime: z.string().min(1).max(120)
});

const allowedMimeTypes = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'application/pdf',
  'text/plain',
  'application/zip',
  'application/x-zip-compressed',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
]);

const isImageMimeType = mimeType => mimeType.startsWith('image/');

router.post(
  '/',
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) {
      throw new Error('缺少上传文件');
    }

    const input = uploadSchema.parse(req.body);
    if (!allowedMimeTypes.has(input.originalMime)) {
      res.status(400).json({ message: '文件类型不允许' });
      return;
    }

    const peerUser = findUserById(input.peerUserId);
    if (!peerUser) {
      res.status(400).json({ message: '接收方不存在' });
      return;
    }

    if (input.peerUserId === req.user.userId) {
      res.status(400).json({ message: '不能把文件发送给自己' });
      return;
    }

    if (input.category === 'image' && !isImageMimeType(input.originalMime)) {
      res.status(400).json({ message: '图片消息的文件类型不正确' });
      return;
    }

    if (input.category === 'file' && isImageMimeType(input.originalMime)) {
      res.status(400).json({ message: '图片文件请按图片消息发送' });
      return;
    }

    const uploadId = crypto.randomUUID();
    const storedName = `${uploadId}.bin`;
    const filePath = path.join(config.uploadDir, storedName);
    const originalName = cleanText(input.originalName, 200);
    await fs.writeFile(filePath, req.file.buffer);

    await addUpload({
      id: uploadId,
      ownerId: req.user.userId,
      allowedUserIds: [input.peerUserId.toLowerCase()],
      originalName,
      storedName,
      mimeType: input.originalMime,
      size: req.file.size,
      category: input.category
    });

    res.json({
      upload: {
        id: uploadId,
        size: req.file.size,
        mimeType: input.originalMime,
        category: input.category,
        originalName
      }
    });
  })
);

router.get(
  '/:uploadId',
  asyncHandler(async (req, res) => {
    const uploadInfo = getUpload(req.params.uploadId);
    if (!uploadInfo) {
      res.status(404).json({ message: '文件不存在' });
      return;
    }

    const allowedUserIds = uploadInfo.allowedUserIds || [uploadInfo.ownerId];
    if (!allowedUserIds.includes(req.user.userId)) {
      res.status(403).json({ message: '无权访问该文件' });
      return;
    }

    const filePath = path.join(config.uploadDir, uploadInfo.storedName);
    let data;
    try {
      data = await fs.readFile(filePath);
    } catch (error) {
      if (error?.code === 'ENOENT') {
        res.status(404).json({ message: '文件不存在或已丢失' });
        return;
      }
      throw error;
    }
    res.setHeader('content-type', 'application/octet-stream');
    res.setHeader('x-original-name', encodeURIComponent(uploadInfo.originalName));
    res.send(data);
  })
);

export default router;
