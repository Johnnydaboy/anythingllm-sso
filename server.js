// server.js
// Refactored: core logic moved to separate modules under src/
const express = require('express');
const cron = require('node-cron');
const config = require('./src/config');
const workspace = require('./src/workspace');
const { renderSuccessPage, renderErrorPage } = require('./src/template');
const { registerRoutes } = require('./src/routes');

const app = express();
const PORT = config.PORT;

// Schedule daily cleanup if enabled
if (config.CLEANUP_ENABLED) {
  console.log(`Session cleanup scheduled with cron: ${config.CLEANUP_CRON}`);
  cron.schedule(config.CLEANUP_CRON, () => {
    console.log('Running scheduled session cleanup...');
    workspace.cleanupSessions();
  });
}

// Register all route handlers in a separate module
registerRoutes(app, config, workspace, { renderSuccessPage, renderErrorPage });

app.listen(PORT, '0.0.0.0', () => {
  console.log(`SSO Redirect Service running on port ${PORT}`);
  console.log(`Workspace name: ${config.WORKSPACE_NAME}`);
  console.log(`Cleanup enabled: ${config.CLEANUP_ENABLED}`);
  console.log(`Skip documents: ${workspace.SKIP_DOCUMENTS}`);
  console.log(`Skip user addition: ${workspace.SKIP_USER_ADDITION}`);
  if (config.CLEANUP_ENABLED) {
    console.log(`Cleanup schedule: ${config.CLEANUP_CRON}`);
  }
});