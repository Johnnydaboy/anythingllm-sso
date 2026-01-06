# Session Cleanup System

## Overview

The application now uses persistent storage to track all created sessions (users and workspaces) across container restarts. This ensures that cleanup operations can delete all resources, even if the container was restarted.

## How It Works

### Persistent Storage
- All sessions are stored in `/app/data/sessions.json`
- This file is mounted as a volume in Docker, so it persists across container restarts
- Each session entry contains:
  - `userId`: The ID of the created user
  - `workspaceSlug`: The slug of the created workspace
  - `createdAt`: Timestamp when the session was created

### Cleanup Operations

#### Manual Cleanup
Trigger cleanup manually via HTTP POST:

```bash
curl -X POST http://askredirect.johnnypie.work/cleanup
```

Response example:
```json
{
  "status": "ok",
  "message": "Cleanup completed",
  "results": {
    "total": 5,
    "deleted": 4,
    "failed": 1,
    "errors": [
      {
        "sessionId": "session-123",
        "error": "Workspace not found"
      }
    ]
  }
}
```

#### Automated Cleanup (Cron)
If `CLEANUP_ENABLED=true` in your `.env`, cleanup runs automatically based on `CLEANUP_CRON` schedule.

Default: `0 0 * * *` (midnight daily)

### Health Check

Check the current state of sessions:

```bash
curl http://askredirect.johnnypie.work/health
```

Response includes:
- `activeSessions`: Currently active sessions in memory
- `persistentSessions`: All sessions from the persistent storage file
- `activeSessionsCount`: Count of in-memory sessions
- `persistentSessionsCount`: Count of persistent sessions

## Deployment Steps

1. **First Time Setup:**
   ```bash
   # Create the data directory
   mkdir -p data
   
   # Build and start the container
   docker-compose up -d --build
   ```

2. **Upgrading from Old Version:**
   ```bash
   # Stop the container
   docker-compose down
   
   # Create the data directory
   mkdir -p data
   
   # Rebuild and restart
   docker-compose up -d --build
   ```

3. **Cleanup All Sessions:**
   ```bash
   # Run manual cleanup
   curl -X POST http://askredirect.johnnypie.work/cleanup
   ```

## File Locations

- **Host machine:** `./data/sessions.json`
- **Inside container:** `/app/data/sessions.json`

## Important Notes

⚠️ **Data Persistence:**
- The `./data` directory on your host will persist all session data
- Deleting this directory will cause all session tracking to be lost
- The cleanup will still work, but won't be able to find old sessions from before the deletion

⚠️ **Cleanup Behavior:**
- Cleanup attempts to delete BOTH the workspace AND the user
- If either deletion fails, the session is marked as failed but not removed from storage
- Failed sessions will be retried on the next cleanup run
- Check the `errors` array in the cleanup response for details

⚠️ **Container Restart:**
- Sessions are preserved across container restarts
- On startup, the application loads all sessions from `sessions.json`
- Manual cleanup will delete ALL sessions, including those created before the restart

## Troubleshooting

### Sessions not being cleaned up
1. Check the health endpoint to see if sessions are being tracked
2. Review the cleanup response for error details
3. Check AnythingLLM API logs for permission issues

### Data directory issues
```bash
# Ensure proper permissions
chmod 755 data
chown -R 1000:1000 data  # If running as non-root in container
```

### Manual session removal
If you need to manually remove a session from tracking:

```bash
# Edit the sessions.json file
nano data/sessions.json

# Remove the specific session entry and save
```