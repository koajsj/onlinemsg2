#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="$ROOT_DIR/.env"
ENV_EXAMPLE_FILE="$ROOT_DIR/.env.example"

on_error() {
  local exit_code=$?
  echo "部署失败：第 ${1} 行命令执行出错。" >&2
  exit "$exit_code"
}

trap 'on_error $LINENO' ERR

cd "$ROOT_DIR"

require_command() {
  local command_name="$1"
  local install_hint="$2"
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "缺少依赖：$command_name。$install_hint" >&2
    exit 1
  fi
}

is_root() {
  [ "$(id -u)" -eq 0 ]
}

ensure_apt_package() {
  local package_name="$1"
  if dpkg -s "$package_name" >/dev/null 2>&1; then
    return
  fi

  if ! is_root; then
    echo "缺少系统包：$package_name。请用 root 执行 deploy.sh，让脚本自动安装。" >&2
    exit 1
  fi

  apt-get install -y "$package_name"
}

ensure_base_environment() {
  if ! command -v apt-get >/dev/null 2>&1; then
    return
  fi

  if is_root; then
    export DEBIAN_FRONTEND=noninteractive
    echo "检查基础环境..."
    apt-get update
  fi

  if ! command -v git >/dev/null 2>&1; then
    ensure_apt_package git
  fi

  if ! command -v curl >/dev/null 2>&1; then
    ensure_apt_package curl
  fi

  ensure_apt_package ca-certificates

  if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    return
  fi

  if ! is_root; then
    echo "缺少 Docker 或 docker compose。请用 root 执行 deploy.sh，让脚本自动安装。" >&2
    exit 1
  fi

  echo "自动安装 Docker..."
  curl -fsSL https://get.docker.com | sh

  if ! command -v docker >/dev/null 2>&1; then
    echo "Docker 安装失败。" >&2
    exit 1
  fi

  if ! docker compose version >/dev/null 2>&1; then
    echo "docker compose 插件不可用，请检查 Docker 安装结果。" >&2
    exit 1
  fi
}

random_string() {
  local length="${1:-48}"
  local output=''
  while [ "${#output}" -lt "$length" ]; do
    output="${output}$(LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c "$length" || true)"
  done
  printf '%s' "${output:0:length}"
}

escape_sed_value() {
  printf '%s' "$1" | sed 's/[\/&|\\]/\\&/g'
}

set_env_value() {
  local key="$1"
  local value="$2"
  local escaped
  escaped="$(escape_sed_value "$value")"

  if grep -q "^${key}=" "$ENV_FILE"; then
    sed -i "s|^${key}=.*$|${key}=${escaped}|" "$ENV_FILE"
  else
    printf '%s=%s\n' "$key" "$value" >>"$ENV_FILE"
  fi
}

get_env_file_value() {
  local key="$1"
  local value
  value="$(grep -E "^${key}=" "$ENV_FILE" | tail -n 1 | cut -d= -f2- || true)"
  printf '%s' "$value"
}

is_placeholder_value() {
  local value="$1"
  case "$value" in
    ''|replace_*|changeme*|your_*|example_*)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

ensure_env_file() {
  if [ ! -f "$ENV_FILE" ]; then
    cp "$ENV_EXAMPLE_FILE" "$ENV_FILE"
    echo "已自动创建 .env"
  fi
}

sync_missing_env_keys() {
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in
      ''|'#'*)
        continue
        ;;
    esac

    local key="${line%%=*}"
    if ! grep -q "^${key}=" "$ENV_FILE"; then
      printf '%s\n' "$line" >>"$ENV_FILE"
    fi
  done <"$ENV_EXAMPLE_FILE"
}

detect_public_host() {
  if command -v curl >/dev/null 2>&1; then
    curl --silent --show-error --fail --max-time 10 https://api.ipify.org 2>/dev/null || true
    return
  fi

  if command -v wget >/dev/null 2>&1; then
    wget -q -T 10 -O - https://api.ipify.org 2>/dev/null || true
    return
  fi
}

auto_fill_env() {
  local app_domain
  local server_public_host
  local frontend_port
  local minio_port
  local detected_host
  local allowed_origins

  ensure_env_file
  sync_missing_env_keys

  app_domain="$(get_env_file_value APP_DOMAIN)"
  server_public_host="$(get_env_file_value SERVER_PUBLIC_HOST)"
  frontend_port="$(get_env_file_value FRONTEND_PORT)"
  minio_port="$(get_env_file_value MINIO_PORT)"

  if is_placeholder_value "$app_domain"; then
    detected_host="$(detect_public_host)"
    app_domain="${detected_host:-257823.xyz}"
    set_env_value APP_DOMAIN "$app_domain"
  fi

  if is_placeholder_value "$server_public_host"; then
    set_env_value SERVER_PUBLIC_HOST "$app_domain"
    server_public_host="$app_domain"
  fi

  if is_placeholder_value "$(get_env_file_value APP_JWT_SECRET)"; then
    set_env_value APP_JWT_SECRET "$(random_string 64)"
  fi

  if is_placeholder_value "$(get_env_file_value OPENIM_SECRET)"; then
    set_env_value OPENIM_SECRET "$(random_string 64)"
  fi

  if is_placeholder_value "$(get_env_file_value MONGO_PASSWORD)"; then
    set_env_value MONGO_PASSWORD "$(random_string 32)"
  fi

  if is_placeholder_value "$(get_env_file_value REDIS_PASSWORD)"; then
    set_env_value REDIS_PASSWORD "$(random_string 32)"
  fi

  if is_placeholder_value "$(get_env_file_value MINIO_SECRET_ACCESS_KEY)"; then
    set_env_value MINIO_SECRET_ACCESS_KEY "$(random_string 32)"
  fi

  if is_placeholder_value "$(get_env_file_value MINIO_ACCESS_KEY_ID)"; then
    set_env_value MINIO_ACCESS_KEY_ID root
  fi

  frontend_port="${frontend_port:-8080}"
  minio_port="${minio_port:-10005}"
  allowed_origins="http://127.0.0.1:${frontend_port},http://localhost:${frontend_port},http://${app_domain}:${frontend_port},http://${app_domain}"
  set_env_value APP_ALLOWED_ORIGINS "$allowed_origins"
  set_env_value MINIO_EXTERNAL_ADDRESS "http://${server_public_host}:${minio_port}"
}

load_env() {
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
}

assert_service_running() {
  local service_name="$1"
  if ! docker compose ps --services --status running | grep -qx "$service_name"; then
    echo "服务未正常运行：$service_name" >&2
    docker compose ps >&2
    exit 1
  fi
}

port_in_use() {
  local port="$1"

  if command -v ss >/dev/null 2>&1; then
    ss -ltn "( sport = :$port )" 2>/dev/null | tail -n +2 | grep -q .
    return
  fi

  if command -v lsof >/dev/null 2>&1; then
    lsof -Pi :"$port" -sTCP:LISTEN -t >/dev/null 2>&1
    return
  fi

  if command -v netstat >/dev/null 2>&1; then
    netstat -ltn 2>/dev/null | awk '{print $4}' | grep -Eq "(^|:)$port$"
    return
  fi

  return 1
}

check_port_free() {
  local port="$1"
  local label="$2"
  if port_in_use "$port"; then
    echo "端口冲突：$label 使用的 $port 已被占用，请先释放或修改 .env。" >&2
    exit 1
  fi
}

http_probe_once() {
  local url="$1"
  if command -v curl >/dev/null 2>&1; then
    curl --fail --silent --show-error --max-time 10 "$url" >/dev/null
    return
  fi

  if command -v wget >/dev/null 2>&1; then
    wget -q -T 10 -O /dev/null "$url"
    return
  fi

  echo "提示：未检测到 curl/wget，跳过 HTTP 可用性探测。" >&2
}

wait_for_http() {
  local url="$1"
  local label="$2"
  local attempts=20
  local index

  for index in $(seq 1 "$attempts"); do
    if http_probe_once "$url"; then
      return
    fi
    sleep 3
  done

  echo "$label 探测失败：$url" >&2
  exit 1
}

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
