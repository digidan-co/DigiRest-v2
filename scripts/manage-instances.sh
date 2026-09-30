#!/bin/bash

# Configuration
BASE_DIR="$(pwd)"
CLIENTS_DIR="$BASE_DIR/clients"

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

# Ensure clients directory exists
if [ ! -d "$CLIENTS_DIR" ]; then
    mkdir -p "$CLIENTS_DIR"
fi

function show_help {
    echo "Usage: ./manage-instances.sh [command] [arguments]"
    echo ""
    echo "Commands:"
    echo "  create <name> <port>   Create a new restaurant instance"
    echo "  start <name>           Start a specific instance"
    echo "  stop <name>            Stop a specific instance"
    echo "  restart <name>         Restart a specific instance"
    echo "  delete <name>          Delete an instance (asking for confirmation)"
    echo "  list                   List all instances"
    echo "  logs <name>            Show logs for an instance"
    echo ""
    echo "Example:"
    echo "  ./manage-instances.sh create burger-king 3001"
}

function create_instance {
    NAME=$1
    PORT=$2

    if [ -z "$NAME" ] || [ -z "$PORT" ]; then
        echo -e "${RED}Error: Name and Port are required.${NC}"
        show_help
        exit 1
    fi

    TARGET_DIR="$CLIENTS_DIR/$NAME"

    if [ -d "$TARGET_DIR" ]; then
        echo -e "${RED}Error: Instance '$NAME' already exists.${NC}"
        exit 1
    fi

    echo "Creating instance '$NAME' on port $PORT..."
    mkdir -p "$TARGET_DIR"
    mkdir -p "$TARGET_DIR/uploads"

    # Copy initial database if not exists (or empty)
    # Ideally we start with a fresh schema. The app handles initSchema logic on startup if DB is missing.
    # So we just rely on the app to create pos.sqlite.

    # Create .env
    cat > "$TARGET_DIR/.env" <<EOF
NODE_ENV=production
PORT=3000
# Add any specific config here
EOF

    # Create docker-compose.yml
    cat > "$TARGET_DIR/docker-compose.yml" <<EOF
services:
  app:
    container_name: pos-$NAME
    build: 
      context: ../../
      dockerfile: Dockerfile
    restart: always
    ports:
      - "$PORT:3000"
    volumes:
      - ./uploads:/app/server/uploads
      - ./pos.sqlite:/app/server/pos.sqlite
      - ./.env:/app/server/.env
    environment:
      - NODE_ENV=production
EOF

    echo -e "${GREEN}Instance '$NAME' created.${NC}"
    echo "To start it, run: ./manage-instances.sh start $NAME"
}

function start_instance {
    NAME=$1
    TARGET_DIR="$CLIENTS_DIR/$NAME"

    if [ ! -d "$TARGET_DIR" ]; then
        echo -e "${RED}Instance '$NAME' not found.${NC}"
        exit 1
    fi

    echo "Starting instance '$NAME'..."
    cd "$TARGET_DIR" && docker compose up -d
    echo -e "${GREEN}Instance '$NAME' started!${NC}"
}

function stop_instance {
    NAME=$1
    TARGET_DIR="$CLIENTS_DIR/$NAME"

    if [ ! -d "$TARGET_DIR" ]; then
        echo -e "${RED}Instance '$NAME' not found.${NC}"
        exit 1
    fi

    echo "Stopping instance '$NAME'..."
    cd "$TARGET_DIR" && docker compose down
    echo -e "${GREEN}Instance '$NAME' stopped.${NC}"
}

function delete_instance {
    NAME=$1
    TARGET_DIR="$CLIENTS_DIR/$NAME"

    if [ ! -d "$TARGET_DIR" ]; then
        echo -e "${RED}Instance '$NAME' not found.${NC}"
        exit 1
    fi
    
    echo -e "${RED}WARNING: This will delete all data for '$NAME'.${NC}"
    read -p "Are you sure? (y/N) " confirm
    if [[ $confirm == [yY] || $confirm == [yY][eE][sS] ]]; then
         cd "$TARGET_DIR" && docker compose down
         rm -rf "$TARGET_DIR"
         echo -e "${GREEN}Instance '$NAME' deleted.${NC}"
    else
         echo "Operation cancelled."
    fi
}

function list_instances {
    echo "Registered Instances in $CLIENTS_DIR:"
    ls -1 "$CLIENTS_DIR" | while read line; do
        if [ -f "$CLIENTS_DIR/$line/docker-compose.yml" ]; then
             PORT=$(grep -oP '(?<=- ")\d+(?=:3000")' "$CLIENTS_DIR/$line/docker-compose.yml")
             STATUS=$(cd "$CLIENTS_DIR/$line" && docker compose ps --services --filter "status=running")
             if [ -z "$STATUS" ]; then
                 STATE="${RED}STOPPED${NC}"
             else
                 STATE="${GREEN}RUNNING${NC}"
             fi
             echo -e "- $line (Port: $PORT) [$STATE]"
        fi
    done
}

function show_logs {
    NAME=$1
    TARGET_DIR="$CLIENTS_DIR/$NAME"

    if [ ! -d "$TARGET_DIR" ]; then
        echo -e "${RED}Instance '$NAME' not found.${NC}"
        exit 1
    fi

    cd "$TARGET_DIR" && docker compose logs -f
}


CMD=$1
shift

case "$CMD" in
    create) create_instance "$@" ;;
    start) start_instance "$@" ;;
    stop) stop_instance "$@" ;;
    restart) stop_instance "$@" && start_instance "$@" ;;
    delete) delete_instance "$@" ;;
    list) list_instances ;;
    logs) show_logs "$@" ;;
    *) show_help ;;
esac
