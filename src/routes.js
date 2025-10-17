// src/routes.js
// Centralized route definitions for the Express app

/**
 * Register all routes on the provided Express app.
 * @param {import('express').Express} app
 * @param {object} config - configuration object from src/config.js
 * @param {object} workspace - module exporting core functions and constants
 * @param {object} templates - { renderSuccessPage, renderErrorPage }
 */
function registerRoutes(app, config, workspace, { renderSuccessPage, renderErrorPage }) {
  // Root route – creates a session and redirects to the workspace
  app.get('/', async (req, res) => {
    let userId = null;
    let workspaceSlug = null;
    let sessionId = null;
    let errorStep = 'Unknown';
    let errorMessage = 'Unknown error occurred';
    let userAddResult = null;

    try {
      // Generate a unique session ID
      sessionId = `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

      // Create a unique username
      const username = `test_${Date.now()}`;

      console.log(`Starting session setup for: ${sessionId}`);

      // Step 1 – create user
      errorStep = 'Creating user';
      userId = await workspace.createUser(username);

      // Step 2 – create workspace
      errorStep = 'Creating workspace';
      workspaceSlug = await workspace.createWorkspace(`${config.WORKSPACE_NAME} - ${sessionId}`);

      // Step 3 – add documents (optional)
      errorStep = 'Adding documents to workspace';
      await workspace.addDocumentsToWorkspace(workspaceSlug); // This function now uses config.SKIP_DOCUMENTS internally

      // Step 4 – add user to workspace
      errorStep = 'Adding user to workspace';
      userAddResult = await workspace.addUserToWorkspace(userId, workspaceSlug);

      // Small waits for eventual consistency
      await workspace.sleep(2000);
      console.log('Waiting 2 seconds for workspace to settle...');
      await workspace.sleep(2000);

      // Step 5 – obtain SSO token
      errorStep = 'Getting SSO token';
      const { token, loginPath } = await workspace.getSSOToken(userId);

      // Track the active session
      workspace.activeSessions.set(sessionId, { userId, workspaceSlug });

      const destinationWorkspace = `/workspace/${workspaceSlug}`;
      const ssoUrl = new URL(`https://ask.johnnypie.work${loginPath}`); // Fixed trailing space
      ssoUrl.searchParams.append('redirect', destinationWorkspace);
      const redirectUrl = ssoUrl.toString();

      const successHtml = renderSuccessPage({
        redirectUrl,
        sessionId,
        workspaceSlug,
        userId,
        // Pass the correct value from config
        SKIP_DOCUMENTS: config.SKIP_DOCUMENTS, // <-- Use config.SKIP_DOCUMENTS
        userAddResult
      });
      res.send(successHtml);
    } catch (error) {
      errorMessage = error.message;
      console.error(`Error at step "${errorStep}":`, errorMessage);
      if (error.response) {
        console.error('Error response ', error.response.data);
        console.error('Error response status:', error.response.status);
      }

      // Cleanup any partially created resources
      if (workspaceSlug) {
        try {
          await workspace.deleteWorkspace(workspaceSlug);
          console.log('Cleaned up workspace due to error');
        } catch (e) {
          console.error('Failed to cleanup workspace:', e.message);
        }
      }
      if (userId) {
        try {
          await workspace.deleteUser(userId);
          console.log('Cleaned up user due to error');
        } catch (e) {
          console.error('Failed to cleanup user:', e.message);
        }
      }

      const errorHtml = renderErrorPage({
        errorStep,
        errorMessage,
        sessionId,
        userId,
        workspaceSlug
      });
      res.status(500).send(errorHtml);
    }
  });

  // Manual cleanup endpoint – useful for testing
  app.post('/cleanup', async (req, res) => {
    console.log('Manual cleanup triggered');
    await workspace.cleanupSessions();
    res.json({
      status: 'ok',
      message: 'Cleanup completed',
      deletedSessions: workspace.activeSessions.size
    });
  });

  // Health‑check endpoint
  app.get('/health', (req, res) => {
    const sessions = [];
    for (const [sessionId, { userId, workspaceSlug }] of workspace.activeSessions) {
      sessions.push({ sessionId, userId, workspaceSlug });
    }
    res.json({
      status: 'ok',
      activeSessions: sessions,
      activeSessionsCount: workspace.activeSessions.size,
      cleanupEnabled: config.CLEANUP_ENABLED,
      // Use the correct value from config for the health check too
      skipDocuments: config.SKIP_DOCUMENTS, // <-- Use config.SKIP_DOCUMENTS
      skipUserAddition: config.SKIP_USER_ADDITION // <-- Use config.SKIP_USER_ADDITION
    });
  });
}

module.exports = { registerRoutes };