#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
COMMON_SCRIPT_NAME="deploy.sh"

on_error() {
  local exit_code=$?
  echo "部署失败：阶段【${CURRENT_STAGE:-未知阶段}】执行出错，位置在第 ${1} 行。" >&2
  exit "$exit_code"
}

trap 'on_error $LINENO' ERR

cd "$ROOT_DIR"
. "$ROOT_DIR/ops/lib/common.sh"

set_stage "准备目录"
mkdir -p data/runtime data/uploads data/components/{mongodb/db,redis,kafka,etcd,minio}

set_stage "检查基础环境"
ensure_base_environment

require_command docker "请先安装 Docker。"
ensure_docker_daemon
if ! docker compose version >/dev/null 2>&1; then
  echo "缺少 docker compose 插件，请先安装后重试。" >&2
  exit 1
fi

set_stage "准备环境变量"
auto_fill_env
ensure_repo_owner_workspace_permissions
load_env

set_stage "检查端口占用"
check_port_free_for_service "${FRONTEND_PORT:-8080}" "前端" "web"
check_port_free_for_service "${OPENIM_MSG_GATEWAY_PORT:-10001}" "OpenIM WebSocket" "openim-server"
check_port_free_for_service "${OPENIM_API_PORT:-10002}" "OpenIM API" "openim-server"
check_port_free_for_service "${MINIO_PORT:-10005}" "MinIO" "minio"
check_port_free_for_service "${MINIO_CONSOLE_PORT:-10004}" "MinIO Console" "minio"

set_stage "校验 Compose 配置"
docker compose config >/dev/null

set_stage "拉取基础镜像"
docker compose pull

set_stage "启动服务"
docker compose up -d --build --remove-orphans

set_stage "等待服务启动"
sleep 5

set_stage "检查服务状态"
assert_service_running mongo
assert_service_running redis
assert_service_running etcd
assert_service_running kafka
assert_service_running minio
assert_service_running openim-server
assert_service_running app-api
assert_service_running web

set_stage "检查 HTTP 可用性"
wait_for_http "http://127.0.0.1:${FRONTEND_PORT:-8080}/" "前端首页"
wait_for_http "http://127.0.0.1:${FRONTEND_PORT:-8080}/api/health" "业务 API 健康检查"

set_stage "输出状态摘要"
print_runtime_summary

echo "部署完成。"
echo "访问地址: http://${APP_DOMAIN:-服务器IP}:${FRONTEND_PORT:-8080}"
echo "自动生成的部署配置已写入: $ENV_FILE"
