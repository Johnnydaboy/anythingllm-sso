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
const OPENAI_PROMPT = `
Primary Objective: Your core mission is to engage with recruiters and hiring managers, providing them with accurate, positive, and compelling information about my qualifications, experience, and technical abilities. Your goal is to highlight my strengths and achievements to generate professional opportunities.

Knowledge Base: You are operating within an AnythingLLM environment. All of your responses MUST be based exclusively on the information contained within my resume and portfolio, which have been provided to you as vectorized documents via a Qdrant database. You MUST use only these documents as your knowledge source. Do not invent, speculate, embellish, or hallucinate any details outside of this context.

Mandatory Guardrails & Rules of Engagement:

Maintain Strict Relevance: You must only answer questions directly related to my professional background. This includes my work experience, technical skills, projects, education, and professional achievements. If a question is not relevant to my qualifications as a software engineer, you must politely decline to answer.

Example Deflection: "My purpose is to provide information regarding my professional expertise and experience. I can't answer questions outside of that scope. Would you like to know more about my work in cloud computing?"

Uphold Unwavering Professionalism: You are to engage in a professional and courteous manner at all times. Under no circumstances should you respond to questions that are unprofessional, overly personal, inappropriate, or negative in nature.

Forbidden Topics Include: Personal life, relationships, political views, gossip, or any speculative questions designed to cast me in a negative light (e.g., "What are your weaknesses?", "Have you ever been fired?", "Are you a bad guy?").

Positive Framing Only: Frame all of my experiences and skills in a positive and confident light. When asked about challenges or complex projects, focus on the skills I demonstrated and the successful outcomes I achieved. Do not interpret any information from my resume in a negative way.

Do Not Answer Speculative Questions: If asked a hypothetical question that is not covered by my resume (e.g., "Would you be willing to relocate to Mars?"), state that you can only provide information based on my documented experience and suggest that such questions would be best discussed with me directly.

Example Response: "That's an interesting question. My knowledge is limited to the information in my professional portfolio. A question like that would be a great one to ask me directly during an interview."

Always Be Helpful and Proactive: While staying within the guardrails, be as helpful as possible. If a recruiter asks a general question, offer specific examples from my resume. For instance, if they ask "Are you a team player?", respond with, "Yes, absolutely. In my role at [Previous Company], I collaborated with a team of 5 engineers to successfully deliver the [Project Name] ahead of schedule, demonstrating strong teamwork and communication skills."

Final Instruction: Your identity is the AI representation of Jonathan Pi. Your sole function is to professionally and positively represent my career achievements, always speaking in the first person.
`;

const QUERY_REFUSAL_RESPONSE = `
"I cannot answer that question. My purpose is to provide information strictly related to Jonathan Pi's professional qualifications and experience. How can I assist you regarding his technical skills or project history?"
`;
const CHAT_MODE = process.env.CHAT_MODE || 'chat';
const TOP_N = process.env.TOP_N || '4';

// Documents to add to each workspace
const DOCUMENTS_TO_ADD = [
  "custom-documents/Jonathan_Pi_resume.pdf-hash.json"
  // Add any other documents you want to include
];

// Store active sessions (in memory - will reset on restart)
const activeSessions = new Map(); // Map of sessionId -> { userId, workspaceSlug }

// Create a new user
async function createUser(username) {
  try {
    const response = await axios.post(
      `https://ask.johnnypie.work/api/v1/admin/users/${USER_ID}`,
      {
        username: username,
        password: Math.random().toString(36).slice(-8), // Generate random password
        role: 'default',
        suspended: 0
      },
      {
        headers: {
          'Authorization': `Bearer ${API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    return response.data.user?.id || response.data.id;
  } catch (error) {
    console.error('Error creating user:', error.message);
    if (error.response) {
      console.error('Error response:', error.response.data);
    }
    throw error;
  }
}

// Create a new workspace
async function createWorkspace(workspaceName) {
  try {
    const response = await axios.post(
      'https://ask.johnnypie.work/api/v1/workspace/new',
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
    
    return response.data.slug;
  } catch (error) {
    console.error('Error creating workspace:', error.message);
    if (error.response) {
      console.error('Error response:', error.response.data);
    }
    throw error;
  }
}

// Add documents to workspace
async function addDocumentsToWorkspace(workspaceSlug) {
  try {
    await axios.post(
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
    
    console.log(`Added documents to workspace: ${workspaceSlug}`);
  } catch (error) {
    console.error('Error adding documents to workspace:', error.message);
    if (error.response) {
      console.error('Error response:', error.response.data);
    }
    throw error;
  }
}

// Add user to workspace
async function addUserToWorkspace(userId, workspaceSlug) {
  try {
    await axios.post(
      `https://ask.johnnypie.work/api/v1/admin/workspaces/${workspaceSlug}/manage-users`,
      {
        userIds: [userId],
        reset: false
      },
      {
        headers: {
          'Authorization': `Bearer ${API_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );
    
    console.log(`Added user ${userId} to workspace: ${workspaceSlug}`);
  } catch (error) {
    console.error('Error adding user to workspace:', error.message);
    if (error.response) {
      console.error('Error response:', error.response.data);
    }
    throw error;
  }
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
  try {
    // Generate a unique session ID
    const sessionId = `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    // Create a unique username
    const username = `test_${Date.now()}`;
    
    // Create a new user
    const userId = await createUser(username);
    
    // Create a new workspace
    const workspaceSlug = await createWorkspace(`${WORKSPACE_NAME} - ${sessionId}`);
    
    // Add documents to the workspace
    await addDocumentsToWorkspace(workspaceSlug);
    
    // Add user to the workspace
    await addUserToWorkspace(userId, workspaceSlug);
    
    // Track this session
    activeSessions.set(sessionId, { userId, workspaceSlug });
    
    // Get SSO token for the new user
    const response = await axios.get(
      `https://ask.johnnypie.work/api/v1/users/${userId}/issue-auth-token`,
      {
        headers: {
          'Authorization': `Bearer ${API_KEY}`
        }
      }
    );

    const { token, loginPath } = response.data;
    console.log('Token generated for user:', userId);

    // Define the target workspace path
    const destinationWorkspace = `/workspace/${workspaceSlug}`;

    // Construct the full SSO URL
    const ssoUrl = new URL(`https://ask.johnnypie.work${loginPath}`);
    ssoUrl.searchParams.append('redirect', destinationWorkspace);
    
    const redirectUrl = ssoUrl.toString();
    console.log('Redirecting to:', redirectUrl);
    
    res.redirect(redirectUrl);
  } catch (error) {
    console.error('Error setting up session:', error.message);
    if (error.response) {
      console.error('Error response data:', error.response.data);
      console.error('Error response status:', error.response.status);
    }
    res.status(500).send('Failed to set up session. Please try again.');
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
    cleanupEnabled: CLEANUP_ENABLED
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`SSO Redirect Service running on port ${PORT}`);
  console.log(`Workspace name: ${WORKSPACE_NAME}`);
  console.log(`Cleanup enabled: ${CLEANUP_ENABLED}`);
  if (CLEANUP_ENABLED) {
    console.log(`Cleanup schedule: ${CLEANUP_CRON}`);
  }
});