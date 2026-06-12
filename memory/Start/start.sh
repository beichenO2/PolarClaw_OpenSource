#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
# ── Dynamic port allocation via PolarPort ────────────
source "$PROJECT_DIR/../Agent_core/scripts/port-claim.sh"
PORT=$(claim_port "polarmemory-api" "PolarMemory" "3100")
PID_FILE="$SCRIPT_DIR/.pid"

cd "$PROJECT_DIR"

# --- Helpers ---

is_port_listening() {
    lsof -iTCP:"$PORT" -sTCP:LISTEN -P -n -t >/dev/null 2>&1
}

get_port_pid() {
    lsof -iTCP:"$PORT" -sTCP:LISTEN -P -n -t 2>/dev/null | head -1 || true
}

# --- Commands ---

do_start() {
    # Idempotent: if already listening on port, report and exit
    if is_port_listening; then
        OCCUPANT_PID=$(get_port_pid)
        echo "pid=$OCCUPANT_PID"
        echo "port=$PORT"
        echo "PolarMemory already running on port $PORT"
        exit 0
    fi

    # Clean stale PID file
    if [ -f "$PID_FILE" ]; then
        OLD_PID=$(cat "$PID_FILE" 2>/dev/null || true)
        if [ -n "$OLD_PID" ] && kill -0 "$OLD_PID" 2>/dev/null; then
            echo "pid=$OLD_PID"
            echo "port=$PORT"
            exit 0
        fi
        rm -f "$PID_FILE"
    fi

    # Install deps if needed
    if [ ! -d "node_modules" ]; then
        echo "Installing dependencies..."
        npm install
    fi

    # Build TypeScript if needed
    if [ ! -d "dist" ] || [ "src/api_server.ts" -nt "dist/api_server.js" ]; then
        echo "Building TypeScript..."
        npm run build 2>&1 || { echo "Build failed" >&2; exit 1; }
    fi

    # Start daemon in background
    nohup npx tsx src/api_server.ts > /dev/null 2>&1 &
    DAEMON_PID=$!
    echo "$DAEMON_PID" > "$PID_FILE"

    # Wait for port to become available (max 30s)
    for i in $(seq 1 30); do
        if is_port_listening; then
            ACTUAL_PID=$(get_port_pid || echo "$DAEMON_PID")
            echo "pid=$ACTUAL_PID"
            echo "port=$PORT"
            echo "PolarMemory started on port $PORT"
            exit 0
        fi
        sleep 1
    done

    echo "Timed out waiting for port $PORT" >&2
    rm -f "$PID_FILE"
    exit 1
}

do_stop() {
    # Try port-based PID first
    TARGET_PID=""
    if is_port_listening; then
        TARGET_PID=$(get_port_pid)
    fi

    # Fallback to PID file
    if [ -z "$TARGET_PID" ] && [ -f "$PID_FILE" ]; then
        TARGET_PID=$(cat "$PID_FILE" 2>/dev/null || true)
    fi

    if [ -z "$TARGET_PID" ]; then
        echo "PolarMemory is not running"
        rm -f "$PID_FILE"
        exit 0
    fi

    echo "Stopping PolarMemory (pid=$TARGET_PID)..."
    kill "$TARGET_PID" 2>/dev/null || true

    # Wait for process to exit (max 10s)
    for i in $(seq 1 10); do
        if ! kill -0 "$TARGET_PID" 2>/dev/null; then
            break
        fi
        sleep 1
    done

    # Force kill if still alive
    if kill -0 "$TARGET_PID" 2>/dev/null; then
        echo "Process did not exit, sending SIGKILL..."
        kill -9 "$TARGET_PID" 2>/dev/null || true
        sleep 1
    fi

    rm -f "$PID_FILE"
    echo "PolarMemory stopped"
}

do_restart() {
    do_stop
    do_start
}

do_status() {
    if is_port_listening; then
        CURRENT_PID=$(get_port_pid)
        echo "PolarMemory is running"
        echo "pid=$CURRENT_PID"
        echo "port=$PORT"
        exit 0
    fi

    if [ -f "$PID_FILE" ]; then
        OLD_PID=$(cat "$PID_FILE" 2>/dev/null || true)
        if [ -n "$OLD_PID" ] && kill -0 "$OLD_PID" 2>/dev/null; then
            echo "PolarMemory is running (pid=$OLD_PID, port not detected)"
            echo "pid=$OLD_PID"
            exit 0
        fi
    fi

    echo "PolarMemory is not running"
    exit 1
}

# --- Main ---

COMMAND="${1:-start}"

case "$COMMAND" in
    start)
        do_start
        ;;
    stop)
        do_stop
        ;;
    restart)
        do_restart
        ;;
    status)
        do_status
        ;;
    *)
        echo "Usage: bash Start/start.sh [start|stop|restart|status]"
        exit 1
        ;;
esac
