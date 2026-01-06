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

  // Map to store SSE connections for each session
  const sseConnections = new Map(); // Map<sessionId, res>
  
  // Map to store pending setup promises for each session
  const pendingSetups = new Map(); // Map<sessionId, Promise>

  // SSE endpoint for a specific session
  app.get('/events/:sessionId', (req, res) => {
    const { sessionId } = req.params;
    console.log(`SSE connection opened for session: ${sessionId}`);

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Connection': 'keep-alive',
      'Cache-Control': 'no-cache',
    });

    // Send a heartbeat to keep the connection alive
    const heartbeatInterval = setInterval(() => {
      res.write(': heartbeat\n\n');
    }, 30000); // Send every 30 seconds

    // Store the response object for this session
    sseConnections.set(sessionId, res);
    
    // Send initial connection confirmation
    res.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`);

    // If there's a pending setup for this session, start it now
    const setupPromise = pendingSetups.get(sessionId);
    if (setupPromise) {
      console.log(`Starting background setup for session: ${sessionId}`);
      setupPromise(); // Execute the setup function
      pendingSetups.delete(sessionId);
    }

    req.on('close', () => {
      console.log(`SSE connection closed for session: ${sessionId}`);
      clearInterval(heartbeatInterval);
      sseConnections.delete(sessionId);
      pendingSetups.delete(sessionId); // Clean up any pending setups
    });
  });

  // Helper function to send progress updates via SSE for a specific session
  function sendProgressToSession(sessionId, percent, text) {
    const res = sseConnections.get(sessionId);
    if (res) {
      res.write(`data: ${JSON.stringify({ type: 'progress', percent, text })}\n\n`);
    } else {
      console.log(`No active SSE connection found for session: ${sessionId}. Cannot send progress.`);
    }
  }

  // Helper function to send final content via SSE for a specific session
  function sendFinalToSession(sessionId, type, html) {
    const res = sseConnections.get(sessionId);
    if (res) {
      res.write(`data: ${JSON.stringify({ type, html })}\n\n`);
      res.end(); 
      sseConnections.delete(sessionId); 
      console.log(`Final message sent and SSE connection ended for session: ${sessionId}`);
    } else {
      console.log(`No active SSE connection found for session: ${sessionId}. Cannot send final content.`);
    }
  }

  // Root route – creates a session and redirects to the workspace
  app.get('/', async (req, res) => {
    // Generate a unique session ID for this request
    const sessionId = `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

    // Initial HTML page with SSE listener and loading bar
    const initialHtml = `
<!DOCTYPE html>
<html>
<head>
    <title>Setting up your workspace...</title>
    <style>
        body {
            font-family: Arial, sans-serif;
            display: flex;
            justify-content: center;
            align-items: center;
            height: 100vh;
            margin: 0;
            background-color: #f5f5f5;
        }
        .container {
            text-align: center;
            padding: 40px;
            background: white;
            border-radius: 10px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            max-width: 600px;
        }
        .loading {
            color: #007bff;
            font-size: 24px;
            margin-bottom: 20px;
        }
        .spinner {
            border: 4px solid #f3f3f3;
            border-top: 4px solid #007bff;
            border-radius: 50%;
            width: 40px;
            height: 40px;
            animation: spin 1s linear infinite;
            margin: 20px auto;
        }
        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }
        .progress-bar-container {
            width: 100%;
            background-color: #e0e0e0;
            border-radius: 4px;
            overflow: hidden;
            margin: 20px 0;
        }
        .progress-bar {
            width: 0%;
            height: 20px;
            background-color: #007bff;
            transition: width 0.3s ease;
        }
        .status-text {
            margin-top: 10px;
            font-size: 14px;
            color: #666;
        }
        .final-content {
            display: none;
        }
    </style>
</head>
<body>
    <div class="container">
        <div id="loadingSection">
            <div class="loading">Setting up your workspace...</div>
            <div class="spinner"></div>
            <div class="progress-bar-container">
                <div class="progress-bar" id="progressBar"></div>
            </div>
            <div class="status-text" id="statusText">Establishing connection...</div>
        </div>
        <div id="finalContent" class="final-content"></div>
    </div>
    <script>
        // Connect to the SSE endpoint for this specific session
        const eventSource = new EventSource('/events/${sessionId}');
        
        eventSource.onmessage = function(event) {
            const data = JSON.parse(event.data);
            
            if (data.type === 'connected') {
                console.log('SSE connection established');
                document.getElementById('statusText').textContent = 'Connection established, starting setup...';
            } else if (data.type === 'progress') {
                document.getElementById('progressBar').style.width = data.percent + '%';
                document.getElementById('statusText').textContent = data.text;
            } else if (data.type === 'success') {
                console.log('Received success message via SSE');
                document.getElementById('loadingSection').style.display = 'none';
                document.getElementById('finalContent').innerHTML = data.html;
                document.getElementById('finalContent').style.display = 'block';
                eventSource.close();
            } else if (data.type === 'error') {
                console.log('Received error message via SSE');
                document.getElementById('loadingSection').style.display = 'none';
                document.getElementById('finalContent').innerHTML = data.html;
                document.getElementById('finalContent').style.display = 'block';
                eventSource.close();
            }
        };
        
        eventSource.onerror = function(event) {
            console.error('SSE connection error:', event);
            document.getElementById('statusText').textContent = 'Connection lost. Please refresh the page.';
        };
    </script>
</body>
</html>
  `;

    // Send the initial HTML page to the user
    res.send(initialHtml);

    // --- Background Process Setup (waits for SSE connection) ---
    const setupFunction = async () => {
      let userId = null;
      let workspaceSlug = null;
      let errorStep = 'Unknown';
      let errorMessage = 'Unknown error occurred';
      let userAddResult = null;

      try {
        const username = `test_${Date.now()}`;
        console.log(`Starting session setup for: ${sessionId}`);

        // Step 1 – create user
        sendProgressToSession(sessionId, 10, 'Creating user...');
        errorStep = 'Creating user';
        userId = await workspace.createUser(username);
        console.log(`User created: ${userId}`);

        // Step 2 – create workspace
        sendProgressToSession(sessionId, 25, 'Creating workspace...');
        errorStep = 'Creating workspace';
        workspaceSlug = await workspace.createWorkspace(`${config.WORKSPACE_NAME} - ${sessionId}`);
        console.log(`Workspace created: ${workspaceSlug}`);

        // Step 3 – add documents (optional)
        sendProgressToSession(sessionId, 40, 'Adding documents to workspace...');
        errorStep = 'Adding documents to workspace';
        await workspace.addDocumentsToWorkspace(workspaceSlug);
        console.log(`Documents processed for workspace: ${workspaceSlug}`);

        // Step 4 – add user to workspace
        sendProgressToSession(sessionId, 60, 'Adding user to workspace...');
        errorStep = 'Adding user to workspace';
        userAddResult = await workspace.addUserToWorkspace(userId, workspaceSlug);
        console.log(`User added to workspace: ${workspaceSlug}`);

        // Step 5 – wait for workspace to settle
        sendProgressToSession(sessionId, 75, 'Waiting for workspace to settle...');
        console.log('Waiting for workspace to settle...');
        await workspace.sleep(2000);
        await workspace.sleep(2000);

        // Step 6 – obtain SSO token
        sendProgressToSession(sessionId, 90, 'Getting SSO token...');
        errorStep = 'Getting SSO token';
        const { token, loginPath } = await workspace.getSSOToken(userId);
        console.log(`SSO token obtained for user: ${userId}`);

        // Track the active session (both in-memory and persistent storage)
        workspace.activeSessions.set(sessionId, { userId, workspaceSlug });
        await workspace.addSession(sessionId, userId, workspaceSlug);

        const destinationWorkspace = `/workspace/${workspaceSlug}`;
        const ssoUrl = new URL(`https://anyllm.johnnypie.work${loginPath}`);
        ssoUrl.searchParams.append('redirect', destinationWorkspace);
        const redirectUrl = ssoUrl.toString();

        // Prepare final success HTML content
        const successHtml = `
        <div class="status" style="color: #28a745; font-size: 24px; margin-bottom: 20px;">✅ Workspace loaded successfully!</div>
        <a href="${redirectUrl}" class="link" style="display: inline-block; padding: 12px 24px; background-color: #007bff; color: white; text-decoration: none; border-radius: 5px; font-size: 18px; transition: background-color 0.3s;">Click here to access your workspace</a>
        <div class="info" style="margin-top: 20px; color: #666; font-size: 14px; line-height: 1.5;">
            <strong>Session Details:</strong><br>
            Session ID: ${sessionId}<br>
            Workspace: ${workspaceSlug}<br>
            User ID: ${userId}<br>
            <br>
            This session will be automatically cleaned up at midnight.
        </div>
        <div class="steps" style="text-align: left; margin: 20px 0; padding: 15px; background: #f8f9fa; border-radius: 5px; font-size: 12px; color: #495057;">
            <strong>Setup Steps Completed:</strong><br>
            <div class="step success" style="margin: 5px 0; color: #28a745;">✓ User created successfully</div>
            <div class="step success" style="margin: 5px 0; color: #28a745;">✓ Workspace created successfully</div>
            <div class="step ${config.SKIP_DOCUMENTS ? 'skipped' : 'success'}" style="margin: 5px 0; color: ${config.SKIP_DOCUMENTS ? '#ffc107' : '#28a745'};">${config.SKIP_DOCUMENTS ? '⚠ Documents skipped' : '✓ Documents added to workspace'}</div>
            <div class="step ${userAddResult?.skipped ? 'skipped' : 'success'}" style="margin: 5px 0; color: ${userAddResult?.skipped ? '#ffc107' : '#28a745'};">${userAddResult?.skipped ? '⚠ User addition skipped' : '✓ User added to workspace'}</div>
            <div class="step success" style="margin: 5px 0; color: #28a745;">✓ Waited for workspace to settle</div>
            <div class="step success" style="margin: 5px 0; color: #28a745;">✓ SSO token generated</div>
        </div>
        ${userAddResult?.skipped ? `
        <div class="warning" style="margin-top: 20px; padding: 15px; background: #f8d7da; border-radius: 5px; font-size: 14px; color: #721c24; border-left: 4px solid #dc3545;">
            <strong>Warning:</strong> ${userAddResult.reason || 'User was not added to the workspace'}.
            The workspace is still accessible but may have limited functionality.
        </div>
        ` : ''}
        ${config.SKIP_DOCUMENTS ? `
        <div class="notice" style="margin-top: 20px; padding: 15px; background: #fff3cd; border-radius: 5px; font-size: 14px; color: #856404; border-left: 4px solid #ffc107;">
            <strong>Notice:</strong> Document addition is currently disabled. The workspace is ready to use but won't have access to the portfolio documents.
        </div>
        ` : ''}
      `;

        sendFinalToSession(sessionId, 'success', successHtml);
        console.log(`Backend process for session ${sessionId} completed successfully.`);
      } catch (error) {
        errorMessage = error.message;
        console.error(`Error at step "${errorStep}":`, errorMessage);
        if (error.response) {
          console.error('Error response:', error.response.data);
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
        
        // Remove from persistent storage if it was added
        if (sessionId) {
          try {
            await workspace.removeSession(sessionId);
            console.log('Removed session from persistent storage due to error');
          } catch (e) {
            console.error('Failed to remove session from storage:', e.message);
          }
        }

        // Prepare final error HTML content
        const errorHtml = `
        <div class="error" style="color: #dc3545; font-size: 24px; margin-bottom: 20px;">❌ Failed to set up session</div>
        <p>Something went wrong while creating your workspace. Please try again.</p>
        <a href="/" class="retry" style="display: inline-block; padding: 12px 24px; background-color: #007bff; color: white; text-decoration: none; border-radius: 5px; font-size: 18px; transition: background-color 0.3s; margin: 10px;">Try Again</a>
        <div class="details" style="margin-top: 20px; padding: 15px; background: #f8f9fa; border-radius: 5px; font-size: 12px; color: #495057; text-align: left;">
            <strong>Error Details:</strong><br>
            Failed at: ${errorStep}<br>
            Error: ${errorMessage}<br>
            ${sessionId ? `Session ID: ${sessionId}<br>` : ''}
            ${userId ? `User ID: ${userId}<br>` : ''}
            ${workspaceSlug ? `Workspace: ${workspaceSlug}<br>` : ''}
            <br>
            Any partially created resources have been cleaned up.
        </div>
      `;

        sendFinalToSession(sessionId, 'error', errorHtml);
        console.log(`Backend process for session ${sessionId} failed.`);
      }
    };

    // Store the setup function to be executed when SSE connects
    pendingSetups.set(sessionId, setupFunction);
    console.log(`Setup function registered for session: ${sessionId}, waiting for SSE connection...`);
  });

  // Manual cleanup endpoint – useful for testing
  app.post('/cleanup', async (req, res) => {
    console.log('Manual cleanup triggered');
    try {
      const results = await workspace.cleanupSessions();
      res.json({
        status: 'ok',
        message: 'Cleanup completed',
        results
      });
    } catch (error) {
      res.status(500).json({
        status: 'error',
        message: 'Cleanup failed',
        error: error.message
      });
    }
  });

  // Health‑check endpoint
  app.get('/health', async (req, res) => {
    const sessions = [];
    for (const [sessionId, { userId, workspaceSlug }] of workspace.activeSessions) {
      sessions.push({ sessionId, userId, workspaceSlug });
    }
    
    // Also get persistent sessions
    const persistentSessions = await workspace.getAllSessions();
    
    res.json({
      status: 'ok',
      activeSessions: sessions,
      activeSessionsCount: workspace.activeSessions.size,
      persistentSessions: Object.keys(persistentSessions).map(sessionId => ({
        sessionId,
        ...persistentSessions[sessionId]
      })),
      persistentSessionsCount: Object.keys(persistentSessions).length,
      cleanupEnabled: config.CLEANUP_ENABLED,
      skipDocuments: config.SKIP_DOCUMENTS,
      skipUserAddition: config.SKIP_USER_ADDITION
    });
  });
}

module.exports = { registerRoutes };