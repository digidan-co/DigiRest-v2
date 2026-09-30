#!/bin/bash

echo "🚀 Starting Deployment..."

# 1. Pull latest changes
echo "📥 Pulling latest code..."
git pull origin main

# 2. Stop existing container (optional, up -d --build handles recreation usually)
# echo "🛑 Stopping current container..."
# docker compose down

# 3. Build and Start
echo "🏗️ Building and Starting services..."
docker compose up -d --build

# 4. Cleanup
echo "🧹 Cleaning up unused images..."
docker image prune -f

echo "✅ Deployment Complete! App is running on port 3000."
