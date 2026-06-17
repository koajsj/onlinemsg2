# 257823 私有聊天站点

这是一个基于 OpenIM 搭起来的私有在线聊天网站。

重点是：

1. 聊天核心继续用官方 OpenIM。
2. 前端、管理员后台、账号体系、部署脚本、安全审计由本项目补齐。
3. 不改 OpenIM Server / SDK 核心逻辑。
4. 默认前端端口是 `8080`，OpenIM API 是 `10002`，WebSocket 是 `10001`。
5. 不占用 `443`，不强制 HTTPS，不覆盖你服务器现有的 Nginx / SSL。

## 现在已经有的东西

1. 注册、登录、退出登录
2. 单聊、联系人、在线状态
3. 文本、表情、图片、文件消息
4. 消息撤回、已读未读
5. 昵称、头像 URL、个人资料修改
6. 深色模式、通知开关、账号设置
7. 管理员后台
8. 默认管理员初始化
9. 客户端消息加密
10. `deploy.sh` 首次部署
11. `update.sh` 更新重启

## 项目结构

```text
apps/
  api/        业务 API、管理员接口、上传、审计、密钥封装
  web/        Vue3 + Vite 前端
nginx/        前端入口和反向代理
scripts/      容器初始化脚本
data/         运行数据和上传目录
docker-compose.yml
deploy.sh
update.sh
```

## 端口说明

| 服务 | 端口 |
| --- | --- |
| 网站前端 | `8080` |
| OpenIM WebSocket | `10001` |
| OpenIM REST API | `10002` |
| MinIO | `10005` |
| MinIO Console | `10004` |
| Grafana | `13000` |

默认访问地址：

```text
http://服务器IP:8080
http://257823.xyz:8080
```

## 一句话说明部署方式

你不用手动写 `.env`，也不用自己填 JWT 密钥、Mongo 密码、Redis 密码、MinIO 密码。

直接跑：

```bash
bash deploy.sh
```

脚本会自动：

1. 创建 `.env`
2. 补齐缺失配置
3. 生成随机密钥和随机密码
4. 校验端口冲突
5. 校验 `docker compose` 配置
6. 拉镜像并启动服务
7. 检查容器状态
8. 检查首页和 `/api/health`

## VPS 首次部署

下面默认按 Ubuntu / Debian 写。

### 1. 先连服务器

```bash
ssh root@你的服务器IP
```

如果你不是 `root`，把 `root` 换成你自己的用户名。

### 2. 安装基础环境

```bash
apt update
apt install -y git curl ca-certificates
curl -fsSL https://get.docker.com | sh
docker --version
docker compose version
```

看到版本号就说明 Docker 装好了。

### 3. 拉项目

```bash
git clone https://github.com/koajsj/onlinemsg2.git
cd onlinemsg2
```

### 4. 直接部署

```bash
bash deploy.sh
```

部署成功后，直接打开：

```text
http://你的服务器IP:8080
```

如果域名已经解析，也可以打开：

```text
http://257823.xyz:8080
```

## 更新项目

以后更新代码就跑下面这两句：

```bash
cd ~/onlinemsg2
git pull && bash update.sh
```

`update.sh` 会自动做这些事：

1. 拉最新代码
2. 自动补齐 `.env`
3. 自动生成缺失的随机密钥
4. 安装依赖
5. 构建前端
6. 拉镜像
7. 重建并重启服务
8. 检查容器状态
9. 检查首页和 `/api/health`

如果你的 VPS 没装 `npm`，脚本会自动改用 Docker 里的 Node 容器安装和构建。

## 常用命令

首次部署：

```bash
bash deploy.sh
```

更新：

```bash
git pull && bash update.sh
```

看状态：

```bash
docker compose ps
```

看全部日志：

```bash
docker compose logs -f
```

只看后端日志：

```bash
docker compose logs -f app-api
```

只看前端日志：

```bash
docker compose logs -f web
```

停止服务：

```bash
docker compose down
```

重新启动：

```bash
docker compose up -d --build
```

健康检查：

```bash
curl http://127.0.0.1:8080/api/health
```

## 管理员账号

默认管理员账号密码是：

```text
1 / qwer1234
```

注意两件事：

1. 这只是初始化入口。
2. 密码保存时是 `bcrypt` 哈希，不是明文。

管理员登录后，可以直接在网页右侧设置面板里改：

1. 管理员账号
2. 管理员密码

不需要手动改数据文件。

## 注册和登录

当前已经有完整最小流程：

1. 首页默认先显示登录 / 注册页
2. 新用户可以注册
3. 重复账号会被拦截
4. 注册后可直接登录
5. 登录后进入聊天页
6. 退出登录可回到登录页

## 管理员后台

管理员后台当前能看：

1. 用户总数
2. 用户列表
3. 登录日志
4. IP 地址
5. 浏览器信息
6. 系统版本
7. 服务状态
8. 异常登录提示
9. 基础运维信息

## 加密说明

这部分只说真实情况，不夸大。

### 现在已经实现的加密

1. 文本消息在客户端加密，客户端解密。
2. 使用的是 WebCrypto。
3. 消息正文使用 `AES-GCM`。
4. 每个单聊会话都有独立会话密钥。
5. 会话密钥会用参与双方的公钥加密后再保存。
6. 服务端只保存或转发密文，不保存聊天正文明文。
7. 图片和文件也是先在客户端加密，再上传密文二进制。

### 当前加密性质

当前实现属于客户端端到端加密方案，重点保护的是：

1. 文本正文
2. 图片内容
3. 文件内容

### 还看得到的元数据

服务端仍然可能看到这些信息：

1. 谁和谁在聊天
2. 消息发送时间
3. 登录日志
4. 在线状态
5. 上传行为
6. 会话关系

所以这里不宣称“完全匿名”。

### 当前限制

1. 私钥默认保存在当前浏览器本地。
2. 换设备后，旧消息不会自动解密。
3. 默认管理员第一次在某台设备上登录时，需要先在设置页生成或解锁本地私钥，之后这台设备上的新消息才会正常参与加密。
4. 当前重点覆盖单聊，群聊不在这次最小方案里。

## 安全说明

当前已经做了这些基本防护：

1. 登录、注册、上传、管理接口都有权限校验
2. 登录接口有速率限制
3. 登录失败次数过多会临时锁定
4. 上传类型和大小有限制
5. 上传文件名随机化保存
6. 下载附件时会校验当前用户是否有权限
7. 后端对输入做校验和长度限制
8. 前端不直接渲染用户原始 HTML
9. 不提交真实密钥、token、数据库密码、私钥

## 本地开发

如果你要本地开发：

```bash
npm install
npm run dev:api
npm run dev:web
```

构建检查：

```bash
npm run build
```

## 自检清单

部署后建议至少看这几项：

```bash
docker compose ps
curl http://127.0.0.1:8080/api/health
```

再人工确认：

1. `8080` 能打开
2. 没占用 `443`
3. `10001 / 10002` 正常
4. 管理员 `1 / qwer1234` 可以登录
5. 管理员密码不是明文存储
6. 注册、登录、退出正常
7. 文本、图片、文件消息能发
8. 撤回、已读未读正常
9. 手机端布局不乱

## 重要文件

1. [docker-compose.yml](/C:/Users/Administrator/Desktop/onlinemsg2/docker-compose.yml)
2. [deploy.sh](/C:/Users/Administrator/Desktop/onlinemsg2/deploy.sh)
3. [update.sh](/C:/Users/Administrator/Desktop/onlinemsg2/update.sh)
4. [.env.example](/C:/Users/Administrator/Desktop/onlinemsg2/.env.example)
