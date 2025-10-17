// src/template.js
// HTML rendering helpers for the SSO service

function renderSuccessPage({ redirectUrl, sessionId, workspaceSlug, userId, SKIP_DOCUMENTS, userAddResult }) {
  return `
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
        .status { color: #28a745; font-size: 24px; margin-bottom: 20px; }
        .link { display: inline-block; padding: 12px 24px; background-color: #007bff; color: white; text-decoration: none; border-radius: 5px; font-size: 18px; transition: background-color 0.3s; }
        .link:hover { background-color: #0056b3; }
        .info { margin-top: 20px; color: #666; font-size: 14px; line-height: 1.5; }
        .steps { text-align: left; margin: 20px 0; padding: 15px; background: #f8f9fa; border-radius: 5px; font-size: 12px; color: #495057; }
        .step { margin: 5px 0; }
        .step.success { color: #28a745; }
        .step.skipped { color: #ffc107; }
        .notice { margin-top: 20px; padding: 15px; background: #fff3cd; border-radius: 5px; font-size: 14px; color: #856404; border-left: 4px solid #ffc107; }
        .warning { margin-top: 20px; padding: 15px; background: #f8d7da; border-radius: 5px; font-size: 14px; color: #721c24; border-left: 4px solid #dc3545; }
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
          <div class="step success">✓ Waited for workspace to settle</div>
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
  `;
}

function renderErrorPage({ errorStep, errorMessage, sessionId, userId, workspaceSlug }) {
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <title>Setup Failed</title>
      <style>
        body { font-family: Arial, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background-color: #f5f5f5; }
        .container { text-align: center; padding: 40px; background: white; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); max-width: 600px; }
        .error { color: #dc3545; font-size: 24px; margin-bottom: 20px; }
        .retry { display: inline-block; padding: 12px 24px; background-color: #007bff; color: white; text-decoration: none; border-radius: 5px; font-size: 18px; transition: background-color 0.3s; margin: 10px; }
        .retry:hover { background-color: #0056b3; }
        .details { margin-top: 20px; padding: 15px; background: #f8f9fa; border-radius: 5px; font-size: 12px; color: #495057; text-align: left; }
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
  `;
}

module.exports = { renderSuccessPage, renderErrorPage };
