// src/workspace.js
// Core logic and utilities for the AnythingLLM SSO service

const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');
const config = require('./config');

// Path to the persistent storage file
const SESSIONS_FILE = path.join(__dirname, '..', 'data', 'sessions.json');

// Helper function to wait
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Retry wrapper for API calls
async function retryApiCall(apiCall, maxRetries = 3, delay = 1000) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await apiCall();
    } catch (error) {
      console.log(`Attempt ${i + 1} failed:`, error.message);
      if (i === maxRetries - 1) throw error;
      await sleep(delay * (i + 1));
    }
  }
}

// Persistent storage functions
async function ensureDataDirectory() {
  const dataDir = path.dirname(SESSIONS_FILE);
  try {
    await fs.mkdir(dataDir, { recursive: true });
  } catch (error) {
    console.error('Error creating data directory:', error.message);
  }
}

async function loadSessions() {
  try {
    await ensureDataDirectory();
    const data = await fs.readFile(SESSIONS_FILE, 'utf8');
    const sessions = JSON.parse(data);
    console.log(`Loaded ${Object.keys(sessions).length} sessions from persistent storage`);
    return sessions;
  } catch (error) {
    if (error.code === 'ENOENT') {
      console.log('No existing sessions file found, starting fresh');
      return {};
    }
    console.error('Error loading sessions:', error.message);
    return {};
  }
}

async function saveSessions(sessions) {
  try {
    await ensureDataDirectory();
    await fs.writeFile(SESSIONS_FILE, JSON.stringify(sessions, null, 2), 'utf8');
    console.log(`Saved ${Object.keys(sessions).length} sessions to persistent storage`);
  } catch (error) {
    console.error('Error saving sessions:', error.message);
  }
}

async function addSession(sessionId, userId, workspaceSlug) {
  const sessions = await loadSessions();
  sessions[sessionId] = {
    userId,
    workspaceSlug,
    createdAt: new Date().toISOString()
  };
  await saveSessions(sessions);
  console.log(`Session ${sessionId} added to persistent storage`);
}

async function removeSession(sessionId) {
  const sessions = await loadSessions();
  delete sessions[sessionId];
  await saveSessions(sessions);
  console.log(`Session ${sessionId} removed from persistent storage`);
}

async function getAllSessions() {
  return await loadSessions();
}

// Check if multi-user mode is enabled using the dedicated endpoint
async function checkMultiUserMode() {
  try {
    console.log('Checking if multi-user mode is enabled using dedicated endpoint...');
    const response = await axios.get(
      'https://anyllm.johnnypie.work/api/v1/admin/is-multi-user-mode',
      {
        headers: {
          Authorization: `Bearer ${config.API_KEY}`,
        },
      }
    );
    const isMultiUser = response.data?.isMultiUser || false;
    console.log(`Multi-user mode is ${isMultiUser ? 'enabled' : 'disabled'}`);
    return isMultiUser;
  } catch (error) {
    console.error('Error checking multi-user mode:', error.message);
    if (error.response) {
      console.error('Error response status:', error.response.status);
      console.error('Error response:', error.response.data);
    }
    return false;
  }
}

// Create a new user using the correct endpoint
async function createUser(username) {
  return retryApiCall(async () => {
    console.log(`Creating new user via POST /api/v1/admin/users/new: ${username}`);
    const isMultiUser = await checkMultiUserMode();
    if (!isMultiUser) {
      throw new Error('Cannot create user: Multi-user mode is not enabled in AnythingLLM.');
    }
    const password = Math.random().toString(36).slice(-8);
    const role = 'default';
    const response = await axios.post(
      'https://anyllm.johnnypie.work/api/v1/admin/users/new',
      { username, password, role },
      {
        headers: {
          Authorization: `Bearer ${config.API_KEY}`,
          'Content-Type': 'application/json',
        },
      }
    );
    console.log('User creation response:', JSON.stringify(response.data, null, 2));
    if (response.data.user && response.data.user.id) {
      console.log(`User created successfully with ID: ${response.data.user.id}`);
      return response.data.user.id;
    }
    throw new Error(response.data.error || 'Failed to create user: No user ID returned');
  });
}

// Create a new workspace
async function createWorkspace(workspaceName) {
  return retryApiCall(async () => {
    console.log(`Creating workspace: ${workspaceName}`);
    const response = await axios.post(
      'https://anyllm.johnnypie.work/api/v1/workspace/new',
      {
        name: workspaceName,
        similarityThreshold: parseFloat(config.SIMILARITY_THRESHOLD),
        openAiTemp: parseFloat(config.OPENAI_TEMP),
        openAiHistory: parseInt(config.OPENAI_HISTORY),
        openAiPrompt: config.OPENAI_PROMPT,
        queryRefusalResponse: config.QUERY_REFUSAL_RESPONSE,
        chatMode: config.CHAT_MODE,
        topN: parseInt(config.TOP_N),
      },
      {
        headers: {
          Authorization: `Bearer ${config.API_KEY}`,
          'Content-Type': 'application/json',
        },
      }
    );
    console.log('Workspace creation response:', JSON.stringify(response.data, null, 2));
    const workspaceSlug =
      response.data.workspace?.slug || response.data.workspace?.id || null;
    if (!workspaceSlug) {
      console.error('Could not extract workspace slug from response:', response.data);
      throw new Error('Could not extract workspace slug from response');
    }
    console.log(`Workspace created successfully with slug: ${workspaceSlug}`);
    return workspaceSlug;
  });
}

// List documents in a folder
async function listDocumentsInFolder(folderName) {
  return retryApiCall(async () => {
    console.log(`Listing documents in folder: ${folderName}`);
    const response = await axios.get(
      `https://anyllm.johnnypie.work/api/v1/documents/folder/${folderName}`,
      {
        headers: {
          Authorization: `Bearer ${config.API_KEY}`,
        },
      }
    );
    console.log(`Documents in folder ${folderName} response:`, JSON.stringify(response.data, null, 2));

    if (response.data.error) {
      throw new Error(`Error listing documents: ${response.data.error}`);
    }

    const documents = response.data.documents || [];
    console.log(`Found ${documents.length} documents in folder ${folderName}.`);
    return documents;
  });
}

// Documents handling
const FOLDER_NAME = 'custom-documents';

async function addDocumentsToWorkspace(workspaceSlug) {
  const skipDocuments = config.SKIP_DOCUMENTS;

  if (skipDocuments) {
    console.log(`Skipping document addition to workspace: ${workspaceSlug}`);
    return { skipped: true };
  }

  return retryApiCall(async () => {
    console.log(`Adding documents to workspace: ${workspaceSlug}`);

    const documents = await listDocumentsInFolder(FOLDER_NAME);
    const filteredDocuments = documents;
    const documentNamesToAdd = filteredDocuments.map(doc => `${FOLDER_NAME}/${doc.name}`);

    console.log(`Documents to add to workspace:`, documentNamesToAdd);

    if (documentNamesToAdd.length === 0) {
        console.log(`No documents found in folder '${FOLDER_NAME}' to add to workspace.`);
        return { added: [], skipped: true, reason: 'No documents found in folder' };
    }

    const response = await axios.post(
      `https://anyllm.johnnypie.work/api/v1/workspace/${workspaceSlug}/update-embeddings`,
      { adds: documentNamesToAdd, deletes: [] },
      {
        headers: {
          Authorization: `Bearer ${config.API_KEY}`,
          'Content-Type': 'application/json',
        },
      }
    );

    console.log(`Documents added successfully to workspace: ${workspaceSlug}`);
    console.log(`Add response:`, JSON.stringify(response.data, null, 2));
    return response.data;
  });
}

// User‑workspace association
async function addUserToWorkspace(userId, workspaceSlug) {
  const skipUserAddition = config.SKIP_USER_ADDITION;

  if (skipUserAddition) {
    console.log(`Skipping user addition to workspace: ${workspaceSlug}`);
    return { skipped: true };
  }
  const isMultiUser = await checkMultiUserMode();
  if (!isMultiUser) {
    console.log('Multi-user mode is not enabled. Skipping user addition to workspace.');
    return { skipped: true, reason: 'Multi-user mode not enabled' };
  }
  console.log(`Adding user ${userId} to workspace: ${workspaceSlug}`);
  try {
    const response = await axios.post(
      `https://anyllm.johnnypie.work/api/v1/admin/workspaces/${workspaceSlug}/manage-users`,
      { userIds: [parseInt(userId)], reset: false },
      {
        headers: {
          Authorization: `Bearer ${config.API_KEY}`,
          'Content-Type': 'application/json',
        },
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

// SSO token
async function getSSOToken(userId) {
  return retryApiCall(async () => {
    console.log(`Getting SSO token for user: ${userId}`);
    console.log(`API endpoint: https://anyllm.johnnypie.work/api/v1/users/${userId}/issue-auth-token`);
    const response = await axios.get(
      `https://anyllm.johnnypie.work/api/v1/users/${userId}/issue-auth-token`,
      {
        headers: { Authorization: `Bearer ${config.API_KEY}` },
      }
    );
    console.log('SSO token response:', JSON.stringify(response.data, null, 2));
    const { token, loginPath } = response.data;
    console.log('Token generated successfully for user:', userId);
    return { token, loginPath };
  });
}

// Delete helpers
async function deleteUser(userId) {
  try {
    await axios.delete(`https://anyllm.johnnypie.work/api/v1/admin/users/${userId}`, {
      headers: { Authorization: `Bearer ${config.API_KEY}` },
    });
    console.log(`Deleted user: ${userId}`);
    return true;
  } catch (error) {
    console.error(`Error deleting user ${userId}:`, error.message);
    if (error.response) console.error('Error response:', error.response.data);
    return false;
  }
}

async function deleteWorkspace(workspaceSlug) {
  try {
    await axios.delete(`https://anyllm.johnnypie.work/api/v1/workspace/${workspaceSlug}`, {
      headers: { Authorization: `Bearer ${config.API_KEY}` },
    });
    console.log(`Deleted workspace: ${workspaceSlug}`);
    return true;
  } catch (error) {
    console.error(`Error deleting workspace ${workspaceSlug}:`, error.message);
    if (error.response) console.error('Error response:', error.response.data);
    return false;
  }
}

// Session cleanup - now reads from persistent storage
async function cleanupSessions() {
  try {
    console.log('Starting session cleanup...');
    const sessions = await loadSessions();
    const sessionIds = Object.keys(sessions);
    console.log(`Found ${sessionIds.length} sessions to clean up`);
    
    const results = {
      total: sessionIds.length,
      deleted: 0,
      failed: 0,
      errors: []
    };

    for (const sessionId of sessionIds) {
      const { userId, workspaceSlug, createdAt } = sessions[sessionId];
      console.log(`Attempting to delete session: ${sessionId} (created: ${createdAt})`);
      
      try {
        const workspaceDeleted = await deleteWorkspace(workspaceSlug);
        const userDeleted = await deleteUser(userId);
        
        if (workspaceDeleted && userDeleted) {
          await removeSession(sessionId);
          results.deleted++;
          console.log(`✓ Successfully deleted session: ${sessionId} (user: ${userId}, workspace: ${workspaceSlug})`);
        } else {
          results.failed++;
          results.errors.push({
            sessionId,
            error: 'Partial deletion failure',
            workspaceDeleted,
            userDeleted
          });
          console.log(`⚠ Partial deletion for session ${sessionId}: workspace=${workspaceDeleted}, user=${userDeleted}`);
        }
      } catch (err) {
        results.failed++;
        results.errors.push({
          sessionId,
          error: err.message
        });
        console.error(`✗ Failed to delete session ${sessionId}:`, err.message);
      }
    }
    
    console.log('Session cleanup completed!');
    console.log(`Results: ${results.deleted} deleted, ${results.failed} failed out of ${results.total} total`);
    return results;
  } catch (error) {
    console.error('Error during session cleanup:', error.message);
    if (error.response) console.error('Error response:', error.response.data);
    throw error;
  }
}

// In‑memory tracking of active sessions (kept for backwards compatibility)
// But now we also persist to disk
const activeSessions = new Map();

module.exports = {
  createUser,
  createWorkspace,
  addDocumentsToWorkspace,
  addUserToWorkspace,
  getSSOToken,
  deleteUser,
  deleteWorkspace,
  cleanupSessions,
  activeSessions,
  addSession,
  removeSession,
  getAllSessions,
  sleep,
};