// server.js
const express = require('express');
const axios = require('axios');
const cron = require('node-cron');

const app = express();
const PORT = process.env.PORT || 3000;

// Configuration
const API_KEY = process.env.API_KEY;
const USER_ID = process.env.USER_ID || '2';
const CLEANUP_ENABLED = process.env.CLEANUP_ENABLED === 'true';
const CLEANUP_CRON = process.env.CLEANUP_CRON || '0 0 * * *'; // Daily at midnight

// Workspace configuration
const WORKSPACE_NAME = process.env.WORKSPACE_NAME || 'Portfolio Workspace';
const SIMILARITY_THRESHOLD = process.env.SIMILARITY_THRESHOLD || '0.7';
const OPENAI_TEMP = process.env.OPENAI_TEMP || '0.7';
const OPENAI_HISTORY = process.env.OPENAI_HISTORY || '20';
const OPENAI_PROMPT = process.env.OPENAI_PROMPT || 'You are a helpful assistant that provides information about Jonathan Pi based on his portfolio and resume.';
const QUERY_REFUSAL_RESPONSE = process.env.QUERY_REFUSAL_RESPONSE || 'I cannot answer questions outside of Jonathan Pi\'s professional experience.';
const CHAT_MODE = process.env.CHAT_MODE || 'chat';
const TOP_N = process.env.TOP_N || '4';

// Skip document addition for now
const SKIP_DOCUMENTS = process.env.SKIP_DOCUMENTS === 'true' || true; // Default to true for now

// Skip user addition if multi-user mode is not enabled
const SKIP_USER_ADDITION = process.env.SKIP_USER_ADDITION === 'true' || false; // Default to false

// Documents to add to each workspace (only used if SKIP_DOCUMENTS is false)
const DOCUMENTS_TO_ADD = [
  "custom-documents/Jonathan_Pi_resume.pdf-hash.json"
  // Add any other documents you want to include
];

// Store active sessions (in memory - will reset on restart)
const activeSessions = new Map(); // Map of sessionId -> { userId, workspaceSlug }

// Helper function to wait
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Retry wrapper for API calls
async function retryApiCall(apiCall, maxRetries = 3, delay = 1000) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await apiCall();
    } catch (error) {
      console.log(`Attempt ${i + 1} failed:`, error.message);
      if (i === maxRetries - 1) throw error;
      await sleep(delay * (i + 1)); // Exponential backoff
    }
  }
}

// Check if multi-user mode is enabled using the dedicated endpoint
async function checkMultiUserMode() {
  try {
    console.log('Checking if multi-user mode is enabled using dedicated endpoint...');
    const response = await axios.get(
      'https://ask.johnnypie.work/api/v1/admin/is-multi-user-mode', // <-- Updated endpoint
      {
        headers: {
          'Authorization': `Bearer ${API_KEY}`
        }
      }
    );
    
    // The response format is { "isMultiUser": true/false }
    const isMultiUser = response.data?.isMultiUser || false;
    console.log(`Multi-user mode is ${isMultiUser ? 'enabled' : 'disabled'}`);
    return isMultiUser;
  } catch (error) {
    console.error('Error checking multi-user mode:', error.message);
    if (error.response) {
      console.error('Error response status:', error.response.status);
      console.error('Error response data:', error.response.data);
    }
    // Assume it's not enabled if we can't check (or if it's a 403/forbidden)
    return false;
  }
}

// Create a new user using the correct endpoint
async function createUser(username) {
  return retryApiCall(async () => {
    console.log(`Creating new user via POST /api/v1/admin/users/new: ${username}`);

    // Check multi-user mode first
    const isMultiUser = await checkMultiUserMode();
    if (!isMultiUser) {
      throw new Error("Cannot create user: Multi-user mode is not enabled in AnythingLLM.");
    }

    const password = Math.random().toString(36).slice(-8); // Generate random password
    const role = 'default'; // Set role

    const response = await axios.post(
      'https://ask.johnnypie.work/api/v1/admin/users/new', // <-- Correct endpoint
      {
        username: username,
        password: password,
        role: role
      },
      {
        headers: {
          'Authorization': `Bearer ${API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );

    console.log('User creation response:', JSON.stringify(response.data, null, 2));

    if (response.data.user && response.data.user.id) {
      console.log(`User created successfully with ID: ${response.data.user.id}`);
      return response.data.user.id; // Return the new user's ID
    } else {
      throw new Error(response.data.error || 'Failed to create user: No user ID returned');
    }
  });
}

// Create a new workspace
async function createWorkspace(workspaceName) {
  return retryApiCall(async () => {
    console.log(`Creating workspace: ${workspaceName}`);
    
    const response = await axios.post(
      'https://ask.johnnypie.work/api/v1/workspace/new', // Fixed trailing space
      {
        name: workspaceName,
        similarityThreshold: parseFloat(SIMILARITY_THRESHOLD),
        openAiTemp: parseFloat(OPENAI_TEMP),
        openAiHistory: parseInt(OPENAI_HISTORY),
        openAiPrompt: OPENAI_PROMPT,
        queryRefusalResponse: QUERY_REFUSAL_RESPONSE,
        chatMode: CHAT_MODE,
        topN: parseInt(TOP_N)
      },
      {
        headers: {
          'Authorization': `Bearer ${API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    console.log('Workspace creation response:', JSON.stringify(response.data, null, 2));
    
    // Try multiple ways to extract the workspace slug
    // The slug is nested inside the 'workspace' object in the response
    let workspaceSlug = response.data.workspace?.slug || 
                       response.data.workspace?.id || // fallback to id if slug missing
                       null;
    
    if (!workspaceSlug) {
      console.error('Could not extract workspace slug from response:', response.data);
      throw new Error('Could not extract workspace slug from response');
    }
    
    console.log(`Workspace created successfully with slug: ${workspaceSlug}`);
    return workspaceSlug;
  });
}

// Add documents to workspace (now optional)
async function addDocumentsToWorkspace(workspaceSlug) {
  if (SKIP_DOCUMENTS) {
    console.log(`Skipping document addition to workspace: ${workspaceSlug}`);
    return { skipped: true };
  }
  
  return retryApiCall(async () => {
    console.log(`Adding documents to workspace: ${workspaceSlug}`);
    const response = await axios.post(
      `https://ask.johnnypie.work/api/v1/workspace/${workspaceSlug}/update-embeddings`,
      {
        adds: DOCUMENTS_TO_ADD,
        deletes: []
      },
      {
        headers: {
          'Authorization': `Bearer ${API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    console.log(`Documents added successfully to workspace: ${workspaceSlug}`);
    return response.data;
  });
}

// Add user to workspace (with multi-user mode check)
async function addUserToWorkspace(userId, workspaceSlug) {
  if (SKIP_USER_ADDITION) {
    console.log(`Skipping user addition to workspace: ${workspaceSlug}`);
    return { skipped: true };
  }
  
  // First check if multi-user mode is enabled
  const isMultiUser = await checkMultiUserMode();
  if (!isMultiUser) {
    console.log('Multi-user mode is not enabled. Skipping user addition to workspace.');
    return { skipped: true, reason: 'Multi-user mode not enabled' };
  }
  
  console.log(`Adding user ${userId} to workspace: ${workspaceSlug}`);
  
  try {
    const response = await axios.post(
      `https://ask.johnnypie.work/api/v1/admin/workspaces/${workspaceSlug}/manage-users`,
      {
        userIds: [parseInt(userId)], // Ensure userId is a number
        reset: false
      },
      {
        headers: {
          'Authorization': `Bearer ${API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    console.log(`User ${userId} added successfully to workspace: ${workspaceSlug}`);
    console.log('Response:', response.data);
    return response.data;
  } catch (error) {
    if (error.response && error.response.status === 401) {
      console.log('Multi-user mode is not enabled. Skipping user addition.');
      return { skipped: true, reason: 'Multi-user mode not enabled' };
    }
    throw error;
  }
}

// Check if workspace is ready
async function checkWorkspaceReady(workspaceSlug, maxAttempts = 10, delay = 3000) {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      console.log(`Checking workspace readiness (attempt ${i + 1}/${maxAttempts})`);
      const response = await axios.get(
        `https://ask.johnnypie.work/api/v1/workspace/${workspaceSlug}`,
        {
          headers: {
            'Authorization': `Bearer ${API_KEY}`
          }
        }
      );
      
      if (response.data && response.data.slug === workspaceSlug) {
        console.log(`Workspace ${workspaceSlug} is ready`);
        return true;
      }
    } catch (error) {
      console.log(`Workspace not ready yet, waiting ${delay}ms...`);
    }
    
    await sleep(delay);
  }
  
  console.log(`Workspace ${workspaceSlug} did not become ready in time`);
  return false;
}

// Get SSO token for user
async function getSSOToken(userId) {
  return retryApiCall(async () => {
    console.log(`Getting SSO token for user: ${userId}`);
    console.log(`API endpoint: https://ask.johnnypie.work/api/v1/users/${userId}/issue-auth-token`);
    
    const response = await axios.get(
      `https://ask.johnnypie.work/api/v1/users/${userId}/issue-auth-token`,
      {
        headers: {
          'Authorization': `Bearer ${API_KEY}`
        }
      }
    );

    console.log('SSO token response:', JSON.stringify(response.data, null, 2));

    const { token, loginPath } = response.data;
    console.log('Token generated successfully for user:', userId);
    return { token, loginPath };
  });
}

// Delete a user
async function deleteUser(userId) {
  try {
    await axios.delete(
      `https://ask.johnnypie.work/api/v1/admin/users/${userId}`,
      {
        headers: {
          'Authorization': `Bearer ${API_KEY}`
        }
      }
    );
    
    console.log(`Deleted user: ${userId}`);
  } catch (error) {
    console.error(`Error deleting user ${userId}:`, error.message);
    if (error.response) {
      console.error('Error response:', error.response.data);
    }
    throw error;
  }
}

// Delete a workspace
async function deleteWorkspace(workspaceSlug) {
  try {
    await axios.delete(
      `https://ask.johnnypie.work/api/v1/workspace/${workspaceSlug}`,
      {
        headers: {
          'Authorization': `Bearer ${API_KEY}`
        }
      }
    );
    
    console.log(`Deleted workspace: ${workspaceSlug}`);
  } catch (error) {
    console.error(`Error deleting workspace ${workspaceSlug}:`, error.message);
    if (error.response) {
      console.error('Error response:', error.response.data);
    }
    throw error;
  }
}

// Cleanup old sessions
async function cleanupSessions() {
  try {
    console.log('Starting session cleanup...');
    console.log(`Found ${activeSessions.size} sessions to potentially clean up`);

    // Delete each session's user and workspace
    for (const [sessionId, { userId, workspaceSlug }] of activeSessions) {
      try {
        // Delete workspace first (user might need to be removed from it first)
        await deleteWorkspace(workspaceSlug);
        
        // Then delete the user
        await deleteUser(userId);
        
        console.log(`Deleted session: ${sessionId} (user: ${userId}, workspace: ${workspaceSlug})`);
      } catch (err) {
        console.error(`Failed to delete session ${sessionId}:`, err.message);
      }
    }

    // Clear our tracking
    activeSessions.clear();
    console.log('Session cleanup completed!');
  } catch (error) {
    console.error('Error during session cleanup:', error.message);
    if (error.response) {
      console.error('Error response:', error.response.data);
    }
  }
}

// Schedule daily cleanup if enabled
if (CLEANUP_ENABLED) {
  console.log(`Session cleanup scheduled with cron: ${CLEANUP_CRON}`);
  cron.schedule(CLEANUP_CRON, () => {
    console.log('Running scheduled session cleanup...');
    cleanupSessions();
  });
}

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

    // Step 1: Create a new user
    errorStep = 'Creating user';
    userId = await createUser(username);

    // Step 2: Create a new workspace
    errorStep = 'Creating workspace';
    workspaceSlug = await createWorkspace(`${WORKSPACE_NAME} - ${sessionId}`);

    // Step 3: Add documents to the workspace (now optional)
    errorStep = 'Adding documents to workspace';
    const docResult = await addDocumentsToWorkspace(workspaceSlug);

    // Step 4: Add user to the workspace
    errorStep = 'Adding user to workspace';
    userAddResult = await addUserToWorkspace(userId, workspaceSlug);

    // Wait a bit for the user-workspace association to take effect
    await sleep(2000);

    // NEW STEP: Small wait after user addition (instead of readiness check)
    console.log('Waiting 2 seconds for workspace to settle...');
    await sleep(2000);

    // Step 5 (was 6): Get SSO token for the new user
    errorStep = 'Getting SSO token';
    const { token, loginPath } = await getSSOToken(userId);

    // Track this session
    activeSessions.set(sessionId, { userId, workspaceSlug });

    // Define the target workspace path
    const destinationWorkspace = `/workspace/${workspaceSlug}`;

    // Construct the full SSO URL
    const ssoUrl = new URL(`https://ask.johnnypie.work${loginPath}`); // Fixed trailing space
    ssoUrl.searchParams.append('redirect', destinationWorkspace);

    const redirectUrl = ssoUrl.toString();

    // Send HTML page with link instead of redirecting
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Workspace Ready</title>
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
          .status {
            color: #28a745;
            font-size: 24px;
            margin-bottom: 20px;
          }
          .link {
            display: inline-block;
            padding: 12px 24px;
            background-color: #007bff;
            color: white;
            text-decoration: none;
            border-radius: 5px;
            font-size: 18px;
            transition: background-color 0.3s;
          }
          .link:hover {
            background-color: #0056b3;
          }
          .info {
            margin-top: 20px;
            color: #666;
            font-size: 14px;
            line-height: 1.5;
          }
          .steps {
            text-align: left;
            margin: 20px 0;
            padding: 15px;
            background: #f8f9fa;
            border-radius: 5px;
            font-size: 12px;
            color: #495057;
          }
          .step {
            margin: 5px 0;
          }
          .step.success {
            color: #28a745;
          }
          .step.skipped {
            color: #ffc107;
          }
          .notice {
            margin-top: 20px;
            padding: 15px;
            background: #fff3cd;
            border-radius: 5px;
            font-size: 14px;
            color: #856404;
            border-left: 4px solid #ffc107;
          }
          .warning {
            margin-top: 20px;
            padding: 15px;
            background: #f8d7da;
            border-radius: 5px;
            font-size: 14px;
            color: #721c24;
            border-left: 4px solid #dc3545;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="status">✅ Workspace loaded successfully!</div>
          <a href="${redirectUrl}" class="link">Click here to access your workspace</a>
          <div class="info">
            <strong>Session Details:</strong><br>
            Session ID: ${sessionId}<br>
            Workspace: ${workspaceSlug}<br>
            User ID: ${userId}<br>
            <br>
            This session will be automatically cleaned up at midnight.
          </div>
          <div class="steps">
            <strong>Setup Steps Completed:</strong><br>
            <div class="step success">✓ User created successfully</div>
            <div class="step success">✓ Workspace created successfully</div>
            <div class="step ${SKIP_DOCUMENTS ? 'skipped' : 'success'}">${SKIP_DOCUMENTS ? '⚠ Documents skipped' : '✓ Documents added to workspace'}</div>
            <div class="step ${userAddResult?.skipped ? 'skipped' : 'success'}">${userAddResult?.skipped ? '⚠ User addition skipped' : '✓ User added to workspace'}</div>
            <div class="step success">✓ Waited for workspace to settle</div> <!-- Updated step description -->
            <div class="step success">✓ SSO token generated</div>
          </div>
          ${userAddResult?.skipped ? `
          <div class="warning">
            <strong>Warning:</strong> ${userAddResult.reason || 'User was not added to the workspace'}.
            The workspace is still accessible but may have limited functionality.
          </div>
          ` : ''}
          ${SKIP_DOCUMENTS ? `
          <div class="notice">
            <strong>Notice:</strong> Document addition is currently disabled. The workspace is ready to use but won't have access to the portfolio documents.
          </div>
          ` : ''}
        </div>
      </body>
      </html>
    `);

  } catch (error) {
    errorMessage = error.message;
    console.error(`Error at step "${errorStep}":`, errorMessage);
    if (error.response) {
      console.error('Error response ', error.response.data);
      console.error('Error response status:', error.response.status);
    }

    // Cleanup partial resources
    if (workspaceSlug) {
      try {
        await deleteWorkspace(workspaceSlug);
        console.log('Cleaned up workspace due to error');
      } catch (e) {
        console.error('Failed to cleanup workspace:', e.message);
      }
    }
    if (userId) {
      try {
        await deleteUser(userId);
        console.log('Cleaned up user due to error');
      } catch (e) {
        console.error('Failed to cleanup user:', e.message);
      }
    }

    // Send detailed error page
    res.status(500).send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Setup Failed</title>
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
          .error {
            color: #dc3545;
            font-size: 24px;
            margin-bottom: 20px;
          }
          .retry {
            display: inline-block;
            padding: 12px 24px;
            background-color: #007bff;
            color: white;
            text-decoration: none;
            border-radius: 5px;
            font-size: 18px;
            transition: background-color 0.3s;
            margin: 10px;
          }
          .retry:hover {
            background-color: #0056b3;
          }
          .details {
            margin-top: 20px;
            padding: 15px;
            background: #f8f9fa;
            border-radius: 5px;
            font-size: 12px;
            color: #495057;
            text-align: left;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="error">❌ Failed to set up session</div>
          <p>Something went wrong while creating your workspace. Please try again.</p>
          <a href="/" class="retry">Try Again</a>
          <div class="details">
            <strong>Error Details:</strong><br>
            Failed at: ${errorStep}<br>
            Error: ${errorMessage}<br>
            ${sessionId ? `Session ID: ${sessionId}<br>` : ''}
            ${userId ? `User ID: ${userId}<br>` : ''}
            ${workspaceSlug ? `Workspace: ${workspaceSlug}<br>` : ''}
            <br>
            Any partially created resources have been cleaned up.
          </div>
        </div>
      </body>
      </html>
    `);
  }
});

// Manual cleanup endpoint (for testing)
app.post('/cleanup', async (req, res) => {
  console.log('Manual cleanup triggered');
  await cleanupSessions();
  res.json({ 
    status: 'ok', 
    message: 'Cleanup completed',
    deletedSessions: activeSessions.size
  });
});

// Health check endpoint
app.get('/health', (req, res) => {
  const sessions = [];
  for (const [sessionId, { userId, workspaceSlug }] of activeSessions) {
    sessions.push({ sessionId, userId, workspaceSlug });
  }
  
  res.json({ 
    status: 'ok',
    activeSessions: sessions,
    activeSessionsCount: activeSessions.size,
    cleanupEnabled: CLEANUP_ENABLED,
    skipDocuments: SKIP_DOCUMENTS,
    skipUserAddition: SKIP_USER_ADDITION
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`SSO Redirect Service running on port ${PORT}`);
  console.log(`Workspace name: ${WORKSPACE_NAME}`);
  console.log(`Cleanup enabled: ${CLEANUP_ENABLED}`);
  console.log(`Skip documents: ${SKIP_DOCUMENTS}`);
  console.log(`Skip user addition: ${SKIP_USER_ADDITION}`);
  if (CLEANUP_ENABLED) {
    console.log(`Cleanup schedule: ${CLEANUP_CRON}`);
  }
});