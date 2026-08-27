#!/usr/bin/env bash

set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
AGENT_DIR="${PROJECT_DIR}/agent-service"
LOG_DIR="${PROJECT_DIR}/.gapwise-data/logs"
WEB_LOG="${LOG_DIR}/local-ai-web.log"
AGENT_LOG="${LOG_DIR}/local-ai-agent.log"
WEB_PORT="${GAPWISE_LOCAL_WEB_PORT:-3000}"
AGENT_PORT="${GAPWISE_LOCAL_AGENT_PORT:-8080}"
WEB_PID=""
AGENT_PID=""

say() {
  printf '%s\n' "$*"
}

fail() {
  say "Local AI startup failed: $*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "Missing required command '$1'."
}

port_is_open() {
  (exec 3<>"/dev/tcp/127.0.0.1/$1") >/dev/null 2>&1
}

cleanup() {
  trap - EXIT INT TERM
  say ""
  say "Stopping Gapwise local services..."
  if [[ -n "${WEB_PID}" ]] && kill -0 "${WEB_PID}" >/dev/null 2>&1; then
    kill -TERM -- "-${WEB_PID}" >/dev/null 2>&1 || true
  fi
  if [[ -n "${AGENT_PID}" ]] && kill -0 "${AGENT_PID}" >/dev/null 2>&1; then
    kill -TERM -- "-${AGENT_PID}" >/dev/null 2>&1 || true
  fi
  wait "${WEB_PID}" "${AGENT_PID}" 2>/dev/null || true
}

wait_for_service() {
  local name="$1"
  local url="$2"
  local pid="$3"
  local log_file="$4"
  local attempt
  for attempt in $(seq 1 90); do
    if ! kill -0 "${pid}" >/dev/null 2>&1; then
      say ""
      say "${name} stopped during startup. Recent log output:"
      tail -n 60 "${log_file}" 2>/dev/null || true
      fail "${name} did not start."
    fi
    if curl --fail --silent --max-time 1 "${url}" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done
  say ""
  say "${name} did not become ready. Recent log output:"
  tail -n 60 "${log_file}" 2>/dev/null || true
  fail "Timed out waiting for ${name}."
}

require_command npm
require_command uv
require_command gcloud
require_command curl
require_command setsid

[[ -f "${PROJECT_DIR}/package.json" ]] || fail "Run this from the Gapwise repository."
[[ -f "${AGENT_DIR}/pyproject.toml" ]] || fail "The Python ADK service is missing."

if port_is_open "${WEB_PORT}"; then
  fail "Port ${WEB_PORT} is already in use. Stop the existing web server first."
fi
if port_is_open "${AGENT_PORT}"; then
  fail "Port ${AGENT_PORT} is already in use. Stop the existing agent service first."
fi

if ! gcloud auth application-default print-access-token >/dev/null 2>&1; then
  say "Google Application Default Credentials are missing or expired."
  say "Run: gcloud auth application-default login"
  fail "Vertex AI authentication is required."
fi

export GOOGLE_CLOUD_PROJECT="${GOOGLE_CLOUD_PROJECT:-gapwise-505217}"
export GOOGLE_CLOUD_LOCATION="${GOOGLE_CLOUD_LOCATION:-global}"
export GOOGLE_GENAI_USE_VERTEXAI="true"
export GAPSWISE_DEMO_MODE="false"
export NEXT_PUBLIC_DEMO_MODE="false"
export USE_FIRESTORE="${USE_FIRESTORE:-true}"
export GAP_AGENT_MODE="live"
export AGENT_MODEL_PROFILE="cheap"
export GEMINI_MODEL="${GEMINI_MODEL:-gemini-3.5-flash-lite}"
export AGENT_GAP_MODEL="${AGENT_GAP_MODEL:-gemini-3.5-flash-lite}"
export AGENT_GAP_THINKING="${AGENT_GAP_THINKING:-low}"
export AGENT_GAP_MAX_OUTPUT_TOKENS="${AGENT_GAP_MAX_OUTPUT_TOKENS:-2048}"
export AGENT_GAP_TIMEOUT_MS="${AGENT_GAP_TIMEOUT_MS:-22000}"
export AGENT_GAP_TIMEOUT_SECONDS="${AGENT_GAP_TIMEOUT_SECONDS:-20}"
export AGENT_GAP_ESCALATION_ENABLED="false"
export GAPSWISE_AGENT_URL="http://127.0.0.1:${AGENT_PORT}"
export GAPSWISE_AGENT_AUTH="false"
export GAPSWISE_APP_URL="http://localhost:${WEB_PORT}"
export GAPSWISE_DEFAULT_USER_ID="demo-user"
export ALLOW_ORIGINS="http://localhost:${WEB_PORT},http://127.0.0.1:${WEB_PORT}"
export ADK_CAPTURE_MESSAGE_CONTENT_IN_SPANS="false"
# Product traces remain available in Decision Map activity. Disable local
# OpenTelemetry export so missing Cloud Monitoring permissions do not create
# misleading retry errors in the terminal.
export OTEL_SDK_DISABLED="true"

# One ephemeral value guarantees that the two local processes trust each other
# without printing or persisting a development secret.
export GAPSWISE_INTERNAL_API_SECRET
GAPSWISE_INTERNAL_API_SECRET="$(uv run --directory "${AGENT_DIR}" python -c 'import secrets; print(secrets.token_hex(32))')"

say "Checking the live ADK model policy..."
uv run --directory "${AGENT_DIR}" python -c \
  'from app.model_policy import validate_live_model_policy; validate_live_model_policy()' \
  >/dev/null

if [[ ! -d "${PROJECT_DIR}/node_modules" ]]; then
  say "Installing web dependencies..."
  npm --prefix "${PROJECT_DIR}" install
fi

mkdir -p "${LOG_DIR}"
: >"${WEB_LOG}"
: >"${AGENT_LOG}"
trap cleanup EXIT INT TERM

say "Starting the Python ADK service on http://127.0.0.1:${AGENT_PORT}..."
setsid bash -c 'cd "$1"; shift; exec "$@"' _ "${AGENT_DIR}" \
  uv run uvicorn app.fast_api_app:app --host 127.0.0.1 --port "${AGENT_PORT}" \
  >"${AGENT_LOG}" 2>&1 &
AGENT_PID="$!"
wait_for_service "ADK service" "http://127.0.0.1:${AGENT_PORT}/docs" "${AGENT_PID}" "${AGENT_LOG}"

say "Starting Gapwise on http://localhost:${WEB_PORT}..."
setsid bash -c 'cd "$1"; shift; exec "$@"' _ "${PROJECT_DIR}" \
  npm run dev -- --port "${WEB_PORT}" \
  >"${WEB_LOG}" 2>&1 &
WEB_PID="$!"
wait_for_service "Gapwise web app" "http://localhost:${WEB_PORT}/api/runtime" "${WEB_PID}" "${WEB_LOG}"

say ""
say "Gapwise is ready with live AI."
say "Web:   http://localhost:${WEB_PORT}"
say "Agent: http://127.0.0.1:${AGENT_PORT}/docs"
say "Mode:  live · ${AGENT_GAP_MODEL} · ${AGENT_GAP_THINKING} thinking"
say ""
say "Load a project, add or ingest context, then open Today."
say "A validated AI recommendation is labeled 'Gap Agent'."
say "If it says 'Project analysis', inspect Decision Map activity for the fallback reason."
say ""
say "Logs:"
say "  ${WEB_LOG}"
say "  ${AGENT_LOG}"
say "Press Ctrl+C to stop both services."
say ""

tail -n 20 -F "${AGENT_LOG}" "${WEB_LOG}" &
TAIL_PID="$!"
wait -n "${WEB_PID}" "${AGENT_PID}"
kill "${TAIL_PID}" >/dev/null 2>&1 || true
fail "One of the local services stopped unexpectedly."
