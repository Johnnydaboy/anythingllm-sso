// src/workspace.js
// Core logic and utilities for the AnythingLLM SSO service

const axios = require('axios');
// The config module exports an object with all configuration values.
// Import it directly (no destructuring) to access those properties.
const config = require('./config'); // <-- Make sure config is imported here

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
      await sleep(delay * (i + 1)); // Exponential backoff
    }
  }
}

// Check if multi-user mode is enabled using the dedicated endpoint
async function checkMultiUserMode() {
  try {
    console.log('Checking if multi-user mode is enabled using dedicated endpoint...');
    const response = await axios.get(
      'https://ask.johnnypie.work/api/v1/admin/is-multi-user-mode', // Fixed trailing space
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
      console.error('Error response ', error.response.data);
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
      'https://ask.johnnypie.work/api/v1/admin/users/new', // Fixed trailing space
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
      'https://ask.johnnypie.work/api/v1/workspace/new', // Fixed trailing space
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

// --- NEW FUNCTION: List documents in a folder ---
async function listDocumentsInFolder(folderName) {
  return retryApiCall(async () => {
    console.log(`Listing documents in folder: ${folderName}`);
    const response = await axios.get(
      `https://ask.johnnypie.work/api/v1/documents/folder/${folderName}`, // Fixed trailing space
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
const FOLDER_NAME = 'custom-documents'; // Define the folder name

async function addDocumentsToWorkspace(workspaceSlug) {
  // Read the value from the imported config module
  const skipDocuments = config.SKIP_DOCUMENTS; // <-- Read from config

  if (skipDocuments) { // <-- Use the value read from config
    console.log(`Skipping document addition to workspace: ${workspaceSlug}`);
    return { skipped: true };
  }

  return retryApiCall(async () => {
    console.log(`Adding documents to workspace: ${workspaceSlug}`);

    // 1. List documents in the specified folder
    const documents = await listDocumentsInFolder(FOLDER_NAME);

    // 2. Filter documents if needed (e.g., only PDFs, or specific files)
    // Example: Only include files related to resume or portfolio
    // const filteredDocuments = documents.filter(doc => doc.title.includes('resume') || doc.title.includes('portfolio'));
    // For now, include all documents in the folder
    const filteredDocuments = documents;

    // 3. Extract the 'name' field from each document object to create the 'adds' array
    const documentNamesToAdd = filteredDocuments.map(doc => `${FOLDER_NAME}/${doc.name}`);

    console.log(`Documents to add to workspace:`, documentNamesToAdd);

    if (documentNamesToAdd.length === 0) {
        console.log(`No documents found in folder '${FOLDER_NAME}' to add to workspace.`);
        return { added: [], skipped: true, reason: 'No documents found in folder' };
    }

    // 4. Call the update-embeddings endpoint with the dynamic list
    const response = await axios.post(
      `https://ask.johnnypie.work/api/v1/workspace/${workspaceSlug}/update-embeddings`, // Fixed trailing space
      { adds: documentNamesToAdd, deletes: [] }, // Use the dynamic list
      {
        headers: {
          Authorization: `Bearer ${config.API_KEY}`,
          'Content-Type': 'application/json',
        },
      }
    );

    console.log(`Documents added successfully to workspace: ${workspaceSlug}`);
    console.log(`Add response:`, JSON.stringify(response.data, null, 2)); // Log the response
    return response.data;
  });
}


// User‑workspace association
async function addUserToWorkspace(userId, workspaceSlug) {
  // Read the value from the imported config module
  const skipUserAddition = config.SKIP_USER_ADDITION; // <-- Read from config

  if (skipUserAddition) { // <-- Use the value read from config
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
      `https://ask.johnnypie.work/api/v1/admin/workspaces/${workspaceSlug}/manage-users`, // Fixed trailing space
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
    console.log(`API endpoint: https://ask.johnnypie.work/api/v1/users/${userId}/issue-auth-token`); // Fixed trailing space
    const response = await axios.get(
      `https://ask.johnnypie.work/api/v1/users/${userId}/issue-auth-token`, // Fixed trailing space
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
    await axios.delete(`https://ask.johnnypie.work/api/v1/admin/users/${userId}`, { // Fixed trailing space
      headers: { Authorization: `Bearer ${config.API_KEY}` },
    });
    console.log(`Deleted user: ${userId}`);
  } catch (error) {
    console.error(`Error deleting user ${userId}:`, error.message);
    if (error.response) console.error('Error response:', error.response.data);
    throw error;
  }
}

async function deleteWorkspace(workspaceSlug) {
  try {
    await axios.delete(`https://ask.johnnypie.work/api/v1/workspace/${workspaceSlug}`, { // Fixed trailing space
      headers: { Authorization: `Bearer ${config.API_KEY}` },
    });
    console.log(`Deleted workspace: ${workspaceSlug}`);
  } catch (error) {
    console.error(`Error deleting workspace ${workspaceSlug}:`, error.message);
    if (error.response) console.error('Error response:', error.response.data);
    throw error;
  }
}

// Session cleanup
async function cleanupSessions() {
  try {
    console.log('Starting session cleanup...');
    console.log(`Found ${activeSessions.size} sessions to potentially clean up`);
    for (const [sessionId, { userId, workspaceSlug }] of activeSessions) {
      try {
        await deleteWorkspace(workspaceSlug);
        await deleteUser(userId);
        console.log(`Deleted session: ${sessionId} (user: ${userId}, workspace: ${workspaceSlug})`);
      } catch (err) {
        console.error(`Failed to delete session ${sessionId}:`, err.message);
      }
    }
    activeSessions.clear();
    console.log('Session cleanup completed!');
  } catch (error) {
    console.error('Error during session cleanup:', error.message);
    if (error.response) console.error('Error response:', error.response.data);
  }
}

// In‑memory tracking of active sessions
const activeSessions = new Map(); // Map<sessionId, {userId, workspaceSlug}>

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
  // Remove SKIP_DOCUMENTS export from here as it's read from config inside the functions
  sleep,
};