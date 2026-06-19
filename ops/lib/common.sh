ENV_FILE="${ENV_FILE:-$ROOT_DIR/.env}"
ENV_EXAMPLE_FILE="${ENV_EXAMPLE_FILE:-$ROOT_DIR/.env.example}"
COMMON_SCRIPT_NAME="${COMMON_SCRIPT_NAME:-脚本}"
APT_UPDATED="${APT_UPDATED:-0}"
CURRENT_STAGE="${CURRENT_STAGE:-初始化}"

set_stage() {
  CURRENT_STAGE="$1"
  echo
  echo "==> $CURRENT_STAGE"
}

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

has_repo_owner_context() {
  is_root && [ -n "${SUDO_UID:-}" ] && [ -n "${SUDO_GID:-}" ] && [ "${SUDO_UID:-0}" != "0" ]
}

repo_owner_uid() {
  if has_repo_owner_context; then
    printf '%s' "$SUDO_UID"
    return
  fi

  id -u
}

repo_owner_gid() {
  if has_repo_owner_context; then
    printf '%s' "$SUDO_GID"
    return
  fi

  id -g
}

repo_owner_home() {
  if has_repo_owner_context && command -v getent >/dev/null 2>&1; then
    getent passwd "$SUDO_USER" | cut -d: -f6
    return
  fi

  printf '%s' "$HOME"
}

run_as_repo_owner() {
  if has_repo_owner_context && command -v sudo >/dev/null 2>&1; then
    sudo -H -u "#$(repo_owner_uid)" -g "#$(repo_owner_gid)" \
      env HOME="$(repo_owner_home)" \
      "$@"
    return
  fi

  "$@"
}

run_node_container_as_repo_owner() {
  docker run --rm \
    -u "$(repo_owner_uid):$(repo_owner_gid)" \
    -v "$ROOT_DIR:/app" \
    -w /app \
    node:22-bookworm-slim \
    "$@"
}

ensure_repo_owner_workspace_permissions() {
  if has_repo_owner_context; then
    chown -R "$(repo_owner_uid):$(repo_owner_gid)" "$ROOT_DIR"
  fi
}

ensure_apt_package() {
  local package_name="$1"
  if dpkg -s "$package_name" >/dev/null 2>&1; then
    return
  fi

  if ! is_root; then
    echo "缺少系统包：$package_name。请用 root 执行 $COMMON_SCRIPT_NAME，让脚本自动安装。" >&2
    exit 1
  fi

  if [ "$APT_UPDATED" != "1" ]; then
    export DEBIAN_FRONTEND=noninteractive
    echo "安装系统依赖前先刷新软件源..."
    apt-get update
    APT_UPDATED=1
  fi

  apt-get install -y "$package_name"
}

ensure_base_environment() {
  if ! command -v apt-get >/dev/null 2>&1; then
    return
  fi

  echo "检查基础环境..."

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
    echo "缺少 Docker 或 docker compose。请用 root 执行 $COMMON_SCRIPT_NAME，让脚本自动安装。" >&2
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

  ensure_docker_daemon
}

ensure_docker_daemon() {
  if docker info >/dev/null 2>&1; then
    return
  fi

  if command -v systemctl >/dev/null 2>&1; then
    systemctl enable --now docker >/dev/null 2>&1 || true
  elif command -v service >/dev/null 2>&1; then
    service docker start >/dev/null 2>&1 || true
  fi

  if ! docker info >/dev/null 2>&1; then
    echo "Docker 已安装，但 Docker daemon 没有正常运行。" >&2
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
  allowed_origins="http://127.0.0.1:${frontend_port},http://localhost:${frontend_port},http://127.0.0.1:5173,http://localhost:5173,http://${app_domain}:${frontend_port},http://${app_domain}"
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

compose_service_exists() {
  local service_name="$1"
  docker compose ps -a --services 2>/dev/null | grep -qx "$service_name"
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

check_port_free_for_service() {
  local port="$1"
  local label="$2"
  local service_name="$3"
  if compose_service_exists "$service_name"; then
    return
  fi
  check_port_free "$port" "$label"
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

print_runtime_summary() {
  echo
  echo "状态摘要："
  echo "  域名: ${APP_DOMAIN:-257823.xyz}"
  echo "  前端地址: http://${APP_DOMAIN:-服务器IP}:${FRONTEND_PORT:-8080}"
  echo "  API 健康检查: http://127.0.0.1:${FRONTEND_PORT:-8080}/api/health"
  echo "  OpenIM WebSocket: ${OPENIM_MSG_GATEWAY_PORT:-10001}"
  echo "  OpenIM API: ${OPENIM_API_PORT:-10002}"
  docker compose ps
}
