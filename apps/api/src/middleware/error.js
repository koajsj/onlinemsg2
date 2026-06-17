export const asyncHandler = fn => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

export const notFound = (_req, res) => {
  res.status(404).json({ message: '接口不存在' });
};

export const errorHandler = (error, _req, res, _next) => {
  console.error(error);
  const status = error.statusCode || 400;
  res.status(status).json({
    message: error.message || '请求失败'
  });
};
