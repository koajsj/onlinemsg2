#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
COMMON_SCRIPT_NAME="deploy.sh"

on_error() {
  local exit_code=$?
  echo "部署失败：第 ${1} 行命令执行出错。" >&2
  exit "$exit_code"
}

trap 'on_error $LINENO' ERR

cd "$ROOT_DIR"
. "$ROOT_DIR/ops/lib/common.sh"

mkdir -p data/runtime data/uploads data/components/{mongodb/db,redis,kafka,etcd,minio}

ensure_base_environment

require_command docker "请先安装 Docker。"
if ! docker compose version >/dev/null 2>&1; then
  echo "缺少 docker compose 插件，请先安装后重试。" >&2
  exit 1
fi

echo "准备环境变量..."
auto_fill_env
load_env

echo "检查端口占用..."
check_port_free "${FRONTEND_PORT:-8080}" "前端"
check_port_free "${OPENIM_MSG_GATEWAY_PORT:-10001}" "OpenIM WebSocket"
check_port_free "${OPENIM_API_PORT:-10002}" "OpenIM API"
check_port_free "${MINIO_PORT:-10005}" "MinIO"
check_port_free "${MINIO_CONSOLE_PORT:-10004}" "MinIO Console"
check_port_free "${GRAFANA_PORT:-13000}" "Grafana"
check_port_free "12379" "etcd client"
check_port_free "12380" "etcd peer"

echo "校验 Compose 配置..."
docker compose config >/dev/null

echo "拉取基础镜像..."
docker compose pull --ignore-pull-failures

echo "启动服务..."
docker compose up -d --build --remove-orphans

echo "等待服务启动..."
sleep 5

echo "检查服务状态..."
assert_service_running mongo
assert_service_running redis
assert_service_running etcd
assert_service_running kafka
assert_service_running minio
assert_service_running openim-server
assert_service_running app-api
assert_service_running web

docker compose ps

wait_for_http "http://127.0.0.1:${FRONTEND_PORT:-8080}/" "前端首页"
wait_for_http "http://127.0.0.1:${FRONTEND_PORT:-8080}/api/health" "业务 API 健康检查"

echo "部署完成。"
echo "访问地址: http://${APP_DOMAIN:-服务器IP}:${FRONTEND_PORT:-8080}"
echo "自动生成的部署配置已写入: $ENV_FILE"
