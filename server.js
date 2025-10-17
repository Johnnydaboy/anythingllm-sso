// server.js
const express = require('express');
const axios = require('axios');
const cron = require('node-cron');

const app = express();
const PORT = process.env.PORT || 3000;

// Configuration
const API_KEY = process.env.API_KEY;
const USER_ID = process.env.USER_ID || '2';
const WORKSPACE_SLUG = process.env.WORKSPACE_SLUG || 'jonathan-pi-assistant';
const CLEANUP_ENABLED = process.env.CLEANUP_ENABLED === 'true';
const CLEANUP_CRON = process.env.CLEANUP_CRON || '0 0 * * *'; // Daily at midnight

// Store active threads (in memory - will reset on restart)
const activeThreads = new Set();

// Cleanup old threads
async function cleanupThreads() {
  try {
    console.log('Starting thread cleanup...');
    console.log(`Found ${activeThreads.size} threads to potentially clean up`);

    // Delete each tracked thread
    for (const threadSlug of activeThreads) {
      try {
        await axios.delete(
          `https://ask.johnnypie.work/api/v1/workspace/${WORKSPACE_SLUG}/thread/${threadSlug}`,
          {
            headers: {
              'Authorization': `Bearer ${API_KEY}`
            }
          }
        );
        console.log(`Deleted thread: ${threadSlug}`);
      } catch (err) {
        console.error(`Failed to delete thread ${threadSlug}:`, err.message);
      }
    }

    // Clear our tracking
    activeThreads.clear();
    console.log('Thread cleanup completed!');
  } catch (error) {
    console.error('Error during thread cleanup:', error.message);
    if (error.response) {
      console.error('Error response:', error.response.data);
    }
  }
}

// Schedule daily cleanup if enabled
if (CLEANUP_ENABLED) {
  console.log(`Thread cleanup scheduled with cron: ${CLEANUP_CRON}`);
  cron.schedule(CLEANUP_CRON, () => {
    console.log('Running scheduled thread cleanup...');
    cleanupThreads();
  });
}

app.get('/', async (req, res) => {
  try {
    console.log('Generating SSO token for user:', USER_ID);
    
    // Call AnythingLLM API to get SSO token
    const response = await axios.get(
      `https://ask.johnnypie.work/api/v1/users/${USER_ID}/issue-auth-token`,
      {
        headers: {
          'Authorization': `Bearer ${API_KEY}`
        }
      }
    );

    const { token, loginPath } = response.data;
    console.log('Token generated:', token);

    // Create a new thread for this session
    const threadId = `thread-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    let threadSlug = threadId; // Default to our generated ID
    
    try {
      const threadResponse = await axios.post(
        `https://ask.johnnypie.work/api/v1/workspace/${WORKSPACE_SLUG}/thread/new`,
        {
          userId: USER_ID,
          name: threadId,
          slug: threadId
        },
        {
          headers: {
            'Authorization': `Bearer ${API_KEY}`,
            'Content-Type': 'application/json'
          }
        }
      );
      
      // Extract the actual slug from the response
      if (threadResponse.data && threadResponse.data.slug) {
        threadSlug = threadResponse.data.slug;
      }
      
      activeThreads.add(threadSlug);
      console.log('Created new thread:', threadSlug);
    } catch (threadErr) {
      console.error('Failed to create thread:', threadErr.message);
      // Continue anyway - user will use default thread
    }

    // Define the target workspace path with thread
    const destinationWorkspace = `/workspace/${WORKSPACE_SLUG}/t/${threadSlug}`;

    // Construct the full SSO URL
    const ssoUrl = new URL(`https://ask.johnnypie.work${loginPath}`);
    ssoUrl.searchParams.append('redirect', destinationWorkspace);
    
    const redirectUrl = ssoUrl.toString();
    console.log('Redirecting to:', redirectUrl);
    
    res.redirect(redirectUrl);
  } catch (error) {
    console.error('Error generating SSO token:', error.message);
    if (error.response) {
      console.error('Error response data:', error.response.data);
      console.error('Error response status:', error.response.status);
    }
    res.status(500).send('Failed to generate SSO token. Please try again.');
  }
});

// Manual cleanup endpoint (for testing)
app.post('/cleanup', async (req, res) => {
  console.log('Manual cleanup triggered');
  await cleanupThreads();
  res.json({ 
    status: 'ok', 
    message: 'Cleanup completed',
    deletedThreads: activeThreads.size
  });
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok',
    activeThreads: Array.from(activeThreads),
    activeThreadsCount: activeThreads.size,
    cleanupEnabled: CLEANUP_ENABLED
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`SSO Redirect Service running on port ${PORT}`);
  console.log(`Workspace: ${WORKSPACE_SLUG}`);
  console.log(`Cleanup enabled: ${CLEANUP_ENABLED}`);
  if (CLEANUP_ENABLED) {
    console.log(`Cleanup schedule: ${CLEANUP_CRON}`);
  }
});