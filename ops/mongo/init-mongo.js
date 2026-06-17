const openimDb = db.getSiblingDB('openim_v3');
const appUser = process.env.OPENIM_MONGO_USERNAME;
const appPassword = process.env.OPENIM_MONGO_PASSWORD;

if (!appUser || !appPassword) {
  throw new Error('缺少 OPENIM_MONGO_USERNAME 或 OPENIM_MONGO_PASSWORD');
}

if (!openimDb.getUser(appUser)) {
  openimDb.createUser({
    user: appUser,
    pwd: appPassword,
    roles: [{ role: 'readWrite', db: 'openim_v3' }]
  });
}
