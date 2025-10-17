// src/config.js
// Centralized configuration loaded from environment variables

require('dotenv').config(); // Load .env variables

const PORT = process.env.PORT || 3000;
const CLEANUP_ENABLED = process.env.CLEANUP_ENABLED === 'true';
const CLEANUP_CRON = process.env.CLEANUP_CRON || '0 0 * * *'; // Daily at midnight

const WORKSPACE_NAME = process.env.WORKSPACE_NAME || 'Portfolio Workspace';
const API_KEY = process.env.API_KEY;
const USER_ID = process.env.USER_ID || '2';

const SIMILARITY_THRESHOLD = process.env.SIMILARITY_THRESHOLD || '0.7';
const OPENAI_TEMP = process.env.OPENAI_TEMP || '0.7';
const OPENAI_HISTORY = process.env.OPENAI_HISTORY || '20';
const OPENAI_PROMPT = process.env.OPENAI_PROMPT || "You are a helpful assistant that provides information about Jonathan Pi based on his portfolio and resume.";
const QUERY_REFUSAL_RESPONSE = process.env.QUERY_REFUSAL_RESPONSE || "I cannot answer questions outside of Jonathan Pi's professional experience.";
const CHAT_MODE = process.env.CHAT_MODE || 'chat';
const TOP_N = process.env.TOP_N || '4';

// Feature toggles
// Corrected logic: defaults to false if env var is not 'true'
const SKIP_DOCUMENTS = process.env.SKIP_DOCUMENTS === 'true'; // Defaults to false if not set or set to something other than 'true'
const SKIP_USER_ADDITION = process.env.SKIP_USER_ADDITION === 'true'; // Defaults to false if not set or set to something other than 'true'

// NOTE: DOCUMENTS_TO_ADD is now determined dynamically in workspace.js
// by listing the contents of the 'custom-documents' folder.

module.exports = {
  PORT,
  CLEANUP_ENABLED,
  CLEANUP_CRON,
  WORKSPACE_NAME,
  API_KEY,
  USER_ID,
  SIMILARITY_THRESHOLD,
  OPENAI_TEMP,
  OPENAI_HISTORY,
  OPENAI_PROMPT,
  QUERY_REFUSAL_RESPONSE,
  CHAT_MODE,
  TOP_N,
  SKIP_DOCUMENTS,
  SKIP_USER_ADDITION,
  // DOCUMENTS_TO_ADD is removed as it's now dynamic
};