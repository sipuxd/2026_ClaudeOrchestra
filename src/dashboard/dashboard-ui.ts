// Dashboard UI — Returns the complete HTML string for the live dashboard.
// All CSS and JavaScript are inline — no build toolchain needed.

export function buildDashboardHTML(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>ClaudeOrchestra</title>
<style>
${CSS}
</style>
</head>
<body>

<div class="sidebar" id="sidebar">
  <div class="sidebar-header">
    <div class="logo">
      <span class="logo-icon">&#9654;</span>
      <span class="logo-text">Claude<span class="logo-accent">Orchestra</span></span>
    </div>
  </div>
  <div class="team-list" id="teamList">
    <div class="empty-sidebar">No teams yet</div>
  </div>
  <button class="new-team-btn" onclick="showNewTeamModal()">+ New Team</button>
</div>

<div class="main-panel" id="mainPanel">
  <div class="no-selection" id="noSelection">
    <div class="no-selection-icon">&#9654;</div>
    <h2>ClaudeOrchestra Dashboard</h2>
    <p>Create a team and launch a task to get started.</p>
    <button class="btn btn-primary" onclick="showNewTeamModal()">+ New Team</button>
  </div>
  <div class="team-detail" id="teamDetail" style="display:none">
    <div class="detail-header">
      <div class="detail-title">
        <button class="btn-back" id="backBtn" onclick="navigateToOverview()" style="display:none">&#8249; Back</button>
        <h2 id="detailTeamName"></h2>
        <span class="complexity-badge" id="detailComplexity"></span>
      </div>
      <div class="detail-header-right">
        <div class="detail-timing" id="detailTiming"></div>
        <button class="btn-side-toggle" id="sidePanelToggle" onclick="toggleSidePanel()" title="Notifications">&#128276;<span class="badge-count" id="feedbackBadge" style="display:none">0</span></button>
      </div>
    </div>
    <div class="detail-project" id="detailProject"></div>
    <div class="phase-bar" id="phaseBar"></div>
    <div class="content-with-side-panel" id="contentWrapper">
      <div class="content-main" id="contentMain">
        <div class="task-section" id="taskSection"></div>
        <div class="agent-overview" id="agentOverview"></div>
        <div class="agent-detail-view" id="agentDetailView" style="display:none"></div>
      </div>
      <div class="side-panel" id="sidePanel">
        <div class="side-panel-header">
          <span>Notifications</span>
          <button class="side-panel-close" onclick="toggleSidePanel()">&times;</button>
        </div>
        <div class="side-panel-content" id="sidePanelContent"></div>
      </div>
    </div>
    <div class="controls-bar" id="controlsBar">
      <div class="controls-actions" id="controlsActions">
        <button class="btn btn-danger" id="stopBtn" onclick="stopCurrentTeam()">Stop</button>
        <button class="btn btn-security-review" id="securityReviewBtn" onclick="handleSecurityReviewClick()" style="display:none">Final Security Review</button>
        <button class="btn btn-merge" id="pushMergeBtn" onclick="pushAndMerge()" style="display:none">Push &amp; Merge to Main</button>
        <button class="btn btn-preview" id="previewBtn" onclick="previewProject()" style="display:none">Preview</button>
      </div>
      <div class="relaunch-group" id="relaunchGroup">
        <label class="relaunch-label">Next Task or Ask</label>
        <div id="imagePreviewStrip" class="image-preview-strip" style="display:none"></div>
        <div class="relaunch-input">
          <div class="relaunch-input-wrapper">
            <div class="prompt-resize-handle" id="promptResizeHandle">&#8597;</div>
            <textarea id="relaunchText" placeholder="Describe what to build next, or ask a question... (paste or drop images)" rows="3"></textarea>
          </div>
          <input type="file" id="imageFileInput" accept="image/*" multiple style="display:none" />
          <div class="relaunch-buttons">
            <button class="btn btn-attach" id="attachBtn" onclick="document.getElementById('imageFileInput').click()" title="Attach images">&#128206;</button>
            <button class="btn btn-primary" id="relaunchBtn" onclick="relaunchCurrentTeam()">Run Task</button>
            <button class="btn btn-ask" id="askBtn" onclick="askAgent()">Ask</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</div>

<div class="modal-overlay" id="newTeamModal" style="display:none" onclick="if(event.target===this)hideNewTeamModal()">
  <div class="modal">
    <h3>New Team</h3>
    <label>Team Name</label>
    <input type="text" id="modalName" placeholder="my-app" autocomplete="off" />
    <label>Project Path</label>
    <div class="path-picker">
      <div class="path-picker-display" id="modalPathDisplay" onclick="pickProjectFolder()">
        <span class="path-picker-placeholder" id="modalPathText">Click to select project folder...</span>
      </div>
      <button class="btn btn-ghost path-picker-btn" onclick="pickProjectFolder()" type="button">Browse</button>
    </div>
    <input type="hidden" id="modalPath" />
    <label>Task Description</label>
    <div id="modalImagePreviewStrip" class="image-preview-strip" style="display:none"></div>
    <textarea id="modalTask" placeholder="Build a... (paste or drop images)" rows="4"></textarea>
    <div class="modal-task-actions">
      <button class="btn btn-attach" onclick="document.getElementById('modalImageFileInput').click()" title="Attach images">&#128206;</button>
      <input type="file" id="modalImageFileInput" accept="image/*" multiple style="display:none" />
    </div>
    <div class="modal-actions">
      <button class="btn btn-ghost" onclick="hideNewTeamModal()">Cancel</button>
      <button class="btn btn-primary" onclick="createTeam()">Launch</button>
    </div>
    <div class="modal-error" id="modalError"></div>
  </div>
</div>

<div class="modal-overlay" id="detailModal" style="display:none" onclick="if(event.target===this)hideDetailModal()">
  <div class="modal" style="max-width:700px">
    <h3 id="detailModalTitle"></h3>
    <pre class="detail-modal-content" id="detailModalContent"></pre>
    <div class="modal-actions">
      <span id="detailModalExtra"></span>
      <button class="btn btn-ghost" onclick="hideDetailModal()">Close</button>
    </div>
  </div>
</div>

<div class="notification-area" id="notificationArea"></div>

<script>
${JS}
</script>
</body>
</html>`;
}

// --- CSS ---

const CSS = `
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, sans-serif;
  background: #0d1117;
  color: #c9d1d9;
  display: flex;
  min-height: 100vh;
  overflow: hidden;
}

/* --- Sidebar --- */
.sidebar {
  width: 280px;
  min-width: 280px;
  background: #161b22;
  border-right: 1px solid #30363d;
  display: flex;
  flex-direction: column;
  height: 100vh;
}

.sidebar-header {
  padding: 20px 16px;
  border-bottom: 1px solid #30363d;
}

.logo {
  display: flex;
  align-items: center;
  gap: 10px;
}

.logo-icon {
  font-size: 1.4rem;
  color: #58a6ff;
}

.logo-text {
  font-size: 1.1rem;
  font-weight: 600;
  color: #f0f6fc;
}

.logo-accent { color: #58a6ff; }

.team-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
}

.empty-sidebar {
  text-align: center;
  color: #484f58;
  padding: 40px 16px;
  font-size: 0.9rem;
}

.sidebar-project-group {
  margin-bottom: 12px;
}

.sidebar-project-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px 4px;
  cursor: pointer;
  user-select: none;
}

.sidebar-project-header:hover .sidebar-project-name { color: #c9d1d9; }

.sidebar-project-chevron {
  font-size: 0.55rem;
  color: #484f58;
  transition: transform 0.15s;
}

.sidebar-project-header.collapsed .sidebar-project-chevron {
  transform: rotate(-90deg);
}

.sidebar-project-name {
  font-size: 0.65rem;
  font-weight: 600;
  color: #8b949e;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.sidebar-project-count {
  font-size: 0.6rem;
  color: #484f58;
  margin-left: auto;
}

.sidebar-project-teams {
  overflow: hidden;
}

.sidebar-project-teams.collapsed {
  display: none;
}

.team-item {
  padding: 12px;
  border-radius: 8px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 4px;
  transition: background 0.15s;
}

.team-item:hover { background: #1c2128; }
.team-item.active { background: #1f2937; border: 1px solid #30363d; }

.team-item-name {
  font-weight: 500;
  font-size: 0.9rem;
  color: #e6edf3;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.team-item-phase {
  font-size: 0.7rem;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 10px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  white-space: nowrap;
}

.team-item-delete {
  background: none;
  border: none;
  color: #484f58;
  font-size: 14px;
  cursor: pointer;
  padding: 0 4px;
  line-height: 1;
  flex-shrink: 0;
  display: none;
  transition: color 0.15s;
}
.team-item:hover .team-item-delete { display: block; }
.team-item-delete:hover { color: #f85149; }

.new-team-btn {
  margin: 12px;
  padding: 10px;
  background: #21262d;
  color: #58a6ff;
  border: 1px dashed #30363d;
  border-radius: 8px;
  font-size: 0.9rem;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
}

.new-team-btn:hover { background: #30363d; border-color: #58a6ff; }

/* --- Main Panel --- */
.main-panel {
  flex: 1;
  overflow-y: auto;
  height: 100vh;
}

.no-selection {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: #484f58;
  gap: 12px;
}

.no-selection-icon { font-size: 3rem; color: #30363d; }
.no-selection h2 { color: #8b949e; font-weight: 500; }
.no-selection p { font-size: 0.95rem; }

.team-detail {
  padding: 24px;
  padding-bottom: 180px;
}

.detail-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 20px;
}

.detail-title {
  display: flex;
  align-items: center;
  gap: 12px;
}

.detail-title h2 {
  font-size: 1.4rem;
  color: #f0f6fc;
  font-weight: 600;
}

.complexity-badge {
  font-size: 0.7rem;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 10px;
  text-transform: uppercase;
  background: #1f2937;
  color: #8b949e;
  letter-spacing: 0.5px;
}

.detail-timing {
  font-size: 0.85rem;
  color: #8b949e;
  font-variant-numeric: tabular-nums;
}

.detail-project {
  font-size: 0.8rem;
  color: #484f58;
  font-family: 'SF Mono', 'Fira Code', monospace;
  margin-bottom: 16px;
  padding: 6px 10px;
  background: #0d1117;
  border-radius: 6px;
  border: 1px solid #21262d;
  display: none;
}

.detail-project .project-label {
  color: #8b949e;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  font-size: 0.65rem;
  margin-right: 8px;
}

.detail-project .git-info {
  color: #58a6ff;
  margin-left: 16px;
}

/* --- Phase Bar --- */
.phase-bar {
  display: flex;
  align-items: center;
  gap: 0;
  margin-bottom: 24px;
  padding: 16px 0;
}

.phase-step {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  position: relative;
}

.phase-dot {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: 2px solid #30363d;
  background: #0d1117;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.75rem;
  transition: all 0.3s;
  z-index: 1;
}

.phase-dot.past {
  border-color: #3fb950;
  background: #3fb950;
  color: #fff;
  font-weight: 700;
}

.phase-dot.active {
  border-color: #3fb950;
  background: #3fb950;
  color: #fff;
  font-weight: 700;
  box-shadow: 0 0 12px #3fb950;
  animation: pulse 1.5s infinite;
}

.phase-dot.errored {
  border-color: #f85149;
  background: #f85149;
  color: #fff;
  font-weight: 700;
}

@keyframes pulse {
  0%, 100% { box-shadow: 0 0 8px #3fb950; }
  50% { box-shadow: 0 0 20px #3fb950; }
}

.phase-label {
  font-size: 0.7rem;
  color: #484f58;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  font-weight: 500;
}

.phase-label.past, .phase-label.active { color: #c9d1d9; }

.phase-connector {
  flex: 1;
  height: 2px;
  background: #30363d;
  margin: 0 -2px;
  margin-bottom: 24px;
  transition: background 0.3s;
}

.phase-connector.past { background: #3fb950; }

/* --- Task Section --- */
.task-section {
  background: #161b22;
  border: 1px solid #30363d;
  border-radius: 8px;
  padding: 16px;
  margin-bottom: 20px;
  font-size: 0.9rem;
  line-height: 1.5;
  color: #c9d1d9;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 120px;
  overflow-y: auto;
}

/* --- Content Layout with Side Panel --- */
.content-with-side-panel {
  display: flex;
  gap: 0;
  min-height: 0;
  flex: 1;
  overflow: hidden;
}

.content-main {
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow-y: auto;
  transition: flex 0.3s ease;
}

.side-panel {
  width: 0;
  overflow: hidden;
  background: #161b22;
  border-left: 1px solid transparent;
  transition: width 0.3s ease, border-color 0.3s ease;
  flex-shrink: 0;
}

.side-panel.open {
  width: 340px;
  border-left-color: #30363d;
}

.side-panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px;
  border-bottom: 1px solid #30363d;
  font-weight: 600;
  color: #f0f6fc;
  font-size: 0.9rem;
}

.side-panel-close {
  background: none;
  border: none;
  color: #8b949e;
  font-size: 1.3rem;
  cursor: pointer;
  padding: 0 4px;
}
.side-panel-close:hover { color: #f0f6fc; }

.side-panel-content {
  padding: 12px;
  overflow-y: auto;
  max-height: calc(100vh - 340px);
}

.btn-side-toggle {
  background: #21262d;
  border: 1px solid #30363d;
  color: #c9d1d9;
  padding: 6px 10px;
  border-radius: 8px;
  font-size: 1rem;
  cursor: pointer;
  position: relative;
  transition: background 0.15s;
}
.btn-side-toggle:hover { background: #30363d; }

.badge-count {
  position: absolute;
  top: -4px;
  right: -4px;
  background: #f85149;
  color: #fff;
  font-size: 0.6rem;
  font-weight: 700;
  padding: 1px 5px;
  border-radius: 10px;
  min-width: 16px;
  text-align: center;
}

.detail-header-right {
  display: flex;
  align-items: center;
  gap: 12px;
}

.btn-back {
  background: none;
  border: none;
  color: #58a6ff;
  font-size: 0.95rem;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 6px;
  transition: background 0.15s;
  margin-right: 8px;
}
.btn-back:hover { background: #1f2937; }

/* --- Agent Overview Cards --- */
.agent-overview {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
  margin-bottom: 20px;
}

@media (max-width: 1100px) {
  .agent-overview { grid-template-columns: repeat(2, 1fr); }
}

.agent-card {
  background: #161b22;
  border: 1px solid #30363d;
  border-radius: 12px;
  padding: 16px;
  cursor: pointer;
  transition: border-color 0.2s, transform 0.15s;
}
.agent-card:hover {
  border-color: var(--agent-color);
  transform: translateY(-2px);
}
.agent-card.streaming { border-color: var(--agent-color); }

.agent-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.agent-card-name {
  font-weight: 600;
  font-size: 0.85rem;
  display: flex;
  align-items: center;
  gap: 8px;
}

.agent-card-status {
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  font-weight: 600;
}

.agent-card-progress {
  height: 4px;
  background: #21262d;
  border-radius: 2px;
  margin: 12px 0 8px;
  overflow: hidden;
}

.agent-card-progress-fill {
  height: 100%;
  border-radius: 2px;
  transition: width 0.5s ease;
}

.agent-card-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 8px;
}

.agent-card-link {
  font-size: 0.75rem;
  color: #58a6ff;
}

.agent-card-percent {
  font-size: 0.7rem;
  color: #8b949e;
  font-variant-numeric: tabular-nums;
}

/* --- Agent Detail View --- */

.agent-detail-panel {
  background: #161b22;
  border: 1px solid #30363d;
  border-radius: 12px;
  overflow-y: auto;
  max-height: calc(100vh - 500px);
}

.agent-detail-view {
  margin-bottom: 20px;
}

.agent-detail-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 18px;
  border-bottom: 1px solid #21262d;
}

.agent-detail-name {
  font-weight: 600;
  font-size: 1rem;
  display: flex;
  align-items: center;
  gap: 10px;
}

.agent-detail-right {
  display: flex;
  align-items: center;
  gap: 12px;
}

.agent-detail-output {
  padding: 14px 18px;
  font-family: 'SF Mono', 'Fira Code', monospace;
  font-size: 0.82rem;
  line-height: 1.6;
  color: #c9d1d9;
  white-space: pre-wrap;
  word-break: break-word;
  background: #0d1117;
}

.agent-detail-stream {
  padding: 10px 18px;
  font-family: 'SF Mono', 'Fira Code', monospace;
  font-size: 0.78rem;
  line-height: 1.5;
  color: #7d8590;
  white-space: pre-wrap;
  word-break: break-word;
  background: #010409;
  border-top: 1px solid #21262d;
  display: none;
}
.agent-detail-stream.visible { display: block; }

/* --- Legacy Agent Panels (kept for compat) --- */
.agent-panels {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  margin-bottom: 20px;
}

.agent-panel {
  background: #161b22;
  border: 1px solid #30363d;
  border-radius: 8px;
  overflow: hidden;
  transition: border-color 0.2s;
}

.agent-panel.streaming { border-color: var(--agent-color); }

.agent-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  border-bottom: 1px solid #21262d;
  cursor: pointer;
  user-select: none;
}

.agent-header:hover { background: #1c2128; }

.agent-name {
  font-weight: 600;
  font-size: 0.85rem;
  display: flex;
  align-items: center;
  gap: 8px;
}

.agent-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #30363d;
}

.agent-dot.active { background: var(--agent-color); animation: pulse-dot 1.5s infinite; }
.agent-dot.done { background: #7ee787; }
.agent-dot.error { background: #f85149; }

@keyframes pulse-dot {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}

.agent-status {
  font-size: 0.7rem;
  color: #484f58;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.agent-status.streaming { color: var(--agent-color); }
.agent-status.done { color: #7ee787; }

.agent-subtask {
  font-size: 0.72rem;
  color: #8b949e;
  padding: 4px 14px 0;
  line-height: 1.3;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-style: italic;
}

.agent-output {
  padding: 10px 14px;
  font-family: 'SF Mono', 'Fira Code', monospace;
  font-size: 0.78rem;
  line-height: 1.5;
  color: #8b949e;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 200px;
  overflow-y: auto;
  background: #0d1117;
}

.agent-output.collapsed { display: none; }

.agent-stream {
  padding: 8px 14px;
  font-family: 'SF Mono', 'Fira Code', monospace;
  font-size: 0.72rem;
  line-height: 1.5;
  color: #7d8590;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 180px;
  overflow-y: auto;
  background: #010409;
  border-top: 1px solid #21262d;
  display: none;
}

.agent-stream.visible { display: block; }

.typing-dots {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  margin-left: 6px;
  vertical-align: middle;
}

.typing-dots span {
  display: inline-block;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--agent-color, #58a6ff);
  opacity: 0.4;
  animation: typing-bounce 1.4s ease-in-out infinite;
}

.typing-dots span:nth-child(1) { animation-delay: 0s; }
.typing-dots span:nth-child(2) { animation-delay: 0.2s; }
.typing-dots span:nth-child(3) { animation-delay: 0.4s; }

@keyframes typing-bounce {
  0%, 60%, 100% { transform: translateY(0); opacity: 0.4; }
  30% { transform: translateY(-4px); opacity: 1; }
}

/* --- Controls Bar --- */
.controls-bar {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px 24px 16px;
  border-top: 1px solid #30363d;
  background: #0d1117;
  position: fixed;
  bottom: 0;
  left: 280px;
  right: 0;
  z-index: 5;
}

.controls-actions {
  display: flex;
  gap: 10px;
}

.relaunch-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.relaunch-input-wrapper {
  position: relative;
}

.prompt-resize-handle {
  position: absolute;
  top: 4px;
  right: 6px;
  width: 16px;
  height: 16px;
  cursor: ns-resize;
  color: #484f58;
  font-size: 0.75rem;
  user-select: none;
  transition: color 0.15s;
  z-index: 2;
  display: flex;
  align-items: center;
  justify-content: center;
}
.prompt-resize-handle:hover { color: #8b949e; }

.relaunch-label {
  font-size: 0.7rem;
  font-weight: 600;
  color: #8b949e;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.relaunch-input {
  display: flex;
  gap: 8px;
  align-items: flex-end;
}

.relaunch-input-wrapper { flex: 1; }

.relaunch-input textarea {
  width: 100%;
  background: #0d1117;
  border: 1px solid #30363d;
  border-radius: 8px;
  padding: 10px 12px;
  color: #c9d1d9;
  font-family: inherit;
  font-size: 0.85rem;
  resize: none;
  min-height: 72px;
  max-height: 300px;
}

.relaunch-input textarea:focus {
  outline: none;
  border-color: #58a6ff;
}

.relaunch-buttons {
  display: flex;
  flex-direction: row;
  gap: 6px;
  align-items: flex-end;
}

.btn-ask {
  background: #21262d;
  border: 1px solid #30363d;
  color: #c9d1d9;
  padding: 8px 16px;
  border-radius: 8px;
  font-size: 0.85rem;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.15s, border-color 0.15s;
}
.btn-ask:hover {
  background: #30363d;
  border-color: #484f58;
}
.btn-ask:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-attach {
  background: #21262d;
  border: 1px solid #30363d;
  color: #c9d1d9;
  padding: 8px 10px;
  border-radius: 8px;
  font-size: 1rem;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
}
.btn-attach:hover {
  background: #30363d;
  border-color: #484f58;
}

.image-preview-strip {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
  padding: 4px 0;
}

.img-preview {
  position: relative;
  width: 64px;
  height: 64px;
  border-radius: 6px;
  overflow: hidden;
  border: 1px solid #30363d;
}

.img-preview img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.img-remove {
  position: absolute;
  top: 2px;
  right: 2px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: rgba(0,0,0,0.7);
  color: #fff;
  border: none;
  font-size: 12px;
  line-height: 18px;
  text-align: center;
  cursor: pointer;
  padding: 0;
}

.img-remove:hover {
  background: #f85149;
}

/* --- Buttons --- */
.btn {
  padding: 8px 16px;
  border-radius: 8px;
  font-size: 0.85rem;
  font-weight: 600;
  cursor: pointer;
  border: none;
  transition: all 0.15s;
  white-space: nowrap;
}

.btn-primary {
  background: #238636;
  color: #fff;
}
.btn-primary:hover { background: #2ea043; }
.btn-primary:disabled {
  background: #21262d;
  color: #484f58;
  cursor: not-allowed;
}

.btn-danger {
  background: #da3633;
  color: #fff;
}
.btn-danger:hover { background: #f85149; }

.btn-merge {
  background: #1f6feb;
  color: #fff;
}
.btn-merge:hover { background: #388bfd; }
.btn-merge:disabled {
  background: #21262d;
  color: #484f58;
  cursor: not-allowed;
}

.btn-security-review {
  background: transparent;
  color: #d29922;
  border: 1px solid #d29922;
}
.btn-security-review:hover { background: rgba(210,153,34,0.1); }
.btn-security-review.running {
  background: #21262d;
  color: #484f58;
  border-color: #30363d;
  cursor: not-allowed;
}
.btn-security-review.passed {
  background: #238636;
  color: #fff;
  border-color: #238636;
}
.btn-security-review.passed:hover { background: #2ea043; }
.btn-security-review.concerns {
  background: #da3633;
  color: #fff;
  border-color: #da3633;
}
.btn-security-review.concerns:hover { background: #f85149; }

.btn-preview {
  background: #21262d;
  color: #c9d1d9;
  border: 1px solid #30363d;
}
.btn-preview:hover { background: #30363d; color: #f0f6fc; }

.btn-ghost {
  background: transparent;
  color: #8b949e;
  border: 1px solid #30363d;
}
.btn-ghost:hover { background: #21262d; color: #c9d1d9; }

/* --- Modal --- */
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
  backdrop-filter: blur(4px);
}

.modal {
  background: #161b22;
  border: 1px solid #30363d;
  border-radius: 12px;
  padding: 24px;
  width: 480px;
  max-width: 90vw;
}

.modal h3 {
  font-size: 1.2rem;
  color: #f0f6fc;
  margin-bottom: 20px;
}

.modal label {
  display: block;
  font-size: 0.8rem;
  font-weight: 600;
  color: #8b949e;
  margin-bottom: 6px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.modal input, .modal textarea {
  width: 100%;
  background: #0d1117;
  border: 1px solid #30363d;
  border-radius: 8px;
  padding: 10px 12px;
  color: #c9d1d9;
  font-family: inherit;
  font-size: 0.9rem;
  margin-bottom: 16px;
}

.modal input:focus, .modal textarea:focus {
  outline: none;
  border-color: #58a6ff;
}

.modal textarea { resize: vertical; }

.detail-modal-content {
  background: #0d1117;
  border: 1px solid #30363d;
  border-radius: 8px;
  padding: 14px;
  color: #c9d1d9;
  font-family: 'SF Mono', 'Fira Code', monospace;
  font-size: 0.82rem;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 60vh;
  overflow-y: auto;
}

.modal-task-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 4px;
}

.modal-actions {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  margin-top: 8px;
}

.modal-error {
  color: #f85149;
  font-size: 0.85rem;
  margin-top: 8px;
  min-height: 20px;
}

/* --- Path Picker --- */
.path-picker {
  display: flex;
  gap: 8px;
  margin-bottom: 16px;
  align-items: stretch;
}

.path-picker-display {
  flex: 1;
  background: #0d1117;
  border: 1px solid #30363d;
  border-radius: 8px;
  padding: 10px 12px;
  color: #c9d1d9;
  font-family: 'SF Mono', 'Fira Code', monospace;
  font-size: 0.85rem;
  cursor: pointer;
  display: flex;
  align-items: center;
  min-height: 40px;
  transition: border-color 0.15s;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.path-picker-display:hover { border-color: #58a6ff; }

.path-picker-placeholder { color: #484f58; }

.path-picker-display.has-path .path-picker-placeholder { color: #c9d1d9; }

.path-picker-btn { flex-shrink: 0; }

/* --- Feedback Bar --- */
.feedback-bar {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 16px;
  max-height: 240px;
  overflow-y: auto;
}

.feedback-item {
  background: #161b22;
  border: 1px solid #30363d;
  border-radius: 8px;
  padding: 12px 16px;
  display: flex;
  align-items: flex-start;
  gap: 12px;
  animation: feedback-slide 0.3s ease;
}

.feedback-item.info     { border-left: 3px solid #58a6ff; }
.feedback-item.warning  { border-left: 3px solid #d29922; }
.feedback-item.question { border-left: 3px solid #bc8cff; }
.feedback-item.decision { border-left: 3px solid #f78166; }

.feedback-icon {
  font-size: 16px;
  flex-shrink: 0;
  margin-top: 1px;
  width: 20px;
  text-align: center;
}

.feedback-content { flex: 1; min-width: 0; }

.feedback-title {
  font-weight: 600;
  color: #e6edf3;
  font-size: 0.85rem;
  margin-bottom: 2px;
}

.feedback-message {
  color: #8b949e;
  font-size: 0.8rem;
  line-height: 1.4;
  white-space: pre-wrap;
}

.feedback-time {
  color: #484f58;
  font-size: 0.7rem;
  margin-top: 4px;
}

.feedback-actions {
  display: flex;
  gap: 8px;
  margin-top: 8px;
}

.feedback-actions button {
  background: #21262d;
  border: 1px solid #30363d;
  border-radius: 6px;
  color: #c9d1d9;
  padding: 4px 12px;
  font-size: 0.8rem;
  cursor: pointer;
  transition: background 0.15s;
}
.feedback-actions button:hover {
  background: #30363d;
  border-color: #484f58;
}

.feedback-dismiss {
  background: none;
  border: none;
  color: #484f58;
  font-size: 18px;
  cursor: pointer;
  padding: 0 4px;
  line-height: 1;
  flex-shrink: 0;
  transition: color 0.15s;
}
.feedback-dismiss:hover {
  color: #c9d1d9;
}

.feedback-item.clickable {
  cursor: pointer;
}
.feedback-item.clickable:hover {
  background: #1c2128;
}

@keyframes feedback-slide {
  from { transform: translateY(-8px); opacity: 0; }
  to { transform: translateY(0); opacity: 1; }
}

/* --- Notifications --- */
.notification-area {
  position: fixed;
  top: 16px;
  right: 16px;
  z-index: 200;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.notification {
  background: #161b22;
  border: 1px solid #30363d;
  border-radius: 8px;
  padding: 12px 16px;
  font-size: 0.85rem;
  color: #c9d1d9;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
  animation: slide-in 0.3s ease;
  max-width: 360px;
}

.notification.error { border-color: #f85149; }
.notification.success { border-color: #7ee787; }

@keyframes slide-in {
  from { transform: translateX(100px); opacity: 0; }
  to { transform: translateX(0); opacity: 1; }
}
`;

// --- JavaScript ---

const JS = `
// --- State ---
let teams = {};
let archivedTeams = {};
let selectedTeamId = null;
let agentOutputs = {};
let agentPanelCollapsed = {};
let projectCollapsed = {};
let taskStartTimes = {};
let timingIntervals = {};
let feedbackItems = {};
let agentSubtasks = {};
let agentStreaming = {};
let securityReviewState = {};
let currentView = 'overview';
let selectedAgent = null;
let sidePanelOpen = false;
let attachedImages = [];
let modalAttachedImages = [];

// --- Image helpers ---
function addImageToList(file, list, renderFn) {
  if (!file || !file.type.startsWith('image/')) return;
  if (list.length >= 5) { showNotification('Max 5 images', 'error'); return; }
  const reader = new FileReader();
  reader.onload = () => {
    const base64 = reader.result.split(',')[1];
    list.push({ media_type: file.type, data: base64, name: file.name });
    renderFn();
  };
  reader.readAsDataURL(file);
}

function addImageFile(file) { addImageToList(file, attachedImages, renderImagePreviews); }
function addModalImageFile(file) { addImageToList(file, modalAttachedImages, renderModalImagePreviews); }

function removeImage(idx) { attachedImages.splice(idx, 1); renderImagePreviews(); }
function removeModalImage(idx) { modalAttachedImages.splice(idx, 1); renderModalImagePreviews(); }

function clearImages() { attachedImages = []; renderImagePreviews(); }
function clearModalImages() { modalAttachedImages = []; renderModalImagePreviews(); }

function renderPreviewStrip(list, stripId, removeFn) {
  const strip = document.getElementById(stripId);
  if (!strip) return;
  if (list.length === 0) {
    strip.style.display = 'none';
    strip.innerHTML = '';
    return;
  }
  strip.style.display = 'flex';
  strip.innerHTML = list.map((img, i) =>
    '<div class="img-preview">' +
      '<img src="data:' + img.media_type + ';base64,' + img.data + '" />' +
      '<button class="img-remove" onclick="' + removeFn + '(' + i + ')">&times;</button>' +
    '</div>'
  ).join('');
}

function renderImagePreviews() { renderPreviewStrip(attachedImages, 'imagePreviewStrip', 'removeImage'); }
function renderModalImagePreviews() { renderPreviewStrip(modalAttachedImages, 'modalImagePreviewStrip', 'removeModalImage'); }

function getAndClearImages() {
  if (attachedImages.length === 0) return undefined;
  const imgs = attachedImages.map(i => ({ media_type: i.media_type, data: i.data }));
  clearImages();
  return imgs;
}

function getAndClearModalImages() {
  if (modalAttachedImages.length === 0) return undefined;
  const imgs = modalAttachedImages.map(i => ({ media_type: i.media_type, data: i.data }));
  clearModalImages();
  return imgs;
}

// --- Phase config ---
const PHASES = ['pre_work', 'work', 'handoff', 'review', 'done'];
const PHASE_LABELS = { pre_work: 'Scan', work: 'Build', handoff: 'Sweep', review: 'Review', done: 'Done' };
const PHASE_COLORS = { pre_work: '#58a6ff', work: '#7ee787', handoff: '#f0c55b', review: '#d2a8ff', done: '#7ee787', errored: '#f85149', cancelled: '#484f58' };
const AGENT_COLORS = { 'Security-1': '#f85149', 'Worker-1': '#7ee787', 'Worker-2': '#3fb950', 'Reviewer-1': '#d2a8ff' };
const AGENTS = ['Security-1', 'Worker-1', 'Worker-2', 'Reviewer-1'];

// --- SSE Connection ---
const evtSource = new EventSource('/events');

evtSource.addEventListener('init', (e) => {
  const data = JSON.parse(e.data);
  data.teams.forEach(t => {
    teams[t.teamId] = t;
    agentOutputs[t.teamId] = agentOutputs[t.teamId] || {};
    agentStreaming[t.teamId] = agentStreaming[t.teamId] || {};
  });
  renderSidebar();
});

evtSource.addEventListener('team-created', (e) => {
  const { teamId, team } = JSON.parse(e.data);
  if (team) {
    teams[teamId] = team;
    agentOutputs[teamId] = {};
  }
  renderSidebar();
  if (!selectedTeamId) selectTeam(teamId);
});

evtSource.addEventListener('task-assigned', (e) => {
  const { teamId, description, timestamp } = JSON.parse(e.data);
  if (teams[teamId]) {
    teams[teamId].currentTask = { description, assignedAt: timestamp };
    taskStartTimes[teamId] = Date.now();
    agentOutputs[teamId] = {};
    agentSubtasks[teamId] = {};
    agentStreaming[teamId] = {};
    feedbackItems[teamId] = [];
    securityReviewState[teamId] = { status: 'idle' };
    startTimingInterval(teamId);
  }
  if (teamId === selectedTeamId) renderTeamDetail();
});

evtSource.addEventListener('task-classified', (e) => {
  const { teamId, complexity } = JSON.parse(e.data);
  if (teams[teamId] && teams[teamId].currentTask) {
    teams[teamId].currentTask.complexity = complexity;
  }
  if (teamId === selectedTeamId) renderTeamDetail();
});

evtSource.addEventListener('phase-transition', (e) => {
  const { teamId, to } = JSON.parse(e.data);
  if (teams[teamId]) {
    teams[teamId].currentPhase = to;
  }
  renderSidebar();
  if (teamId === selectedTeamId) {
    renderPhaseBar();
    renderControlsBar();
    if (currentView === 'overview') renderAgentOverview();
  }
});

evtSource.addEventListener('agent-output', (e) => {
  const { teamId, instance, text } = JSON.parse(e.data);
  if (!agentOutputs[teamId]) agentOutputs[teamId] = {};
  agentOutputs[teamId][instance] = text;
  // [Pipeline], [Q&A], and [Security Review] prefixes are status messages — agent is still working
  const isStatus = text.startsWith('[Pipeline]') || text.startsWith('[Q&A]') || text.startsWith('[Security Review]');
  // Clear streaming text when final output arrives (not status messages)
  if (!isStatus) {
    if (agentStreaming[teamId]) agentStreaming[teamId][instance] = '';
    if (teamId === selectedTeamId) updateAgentStream(instance, '');
  }
  if (teamId === selectedTeamId) updateAgentPanel(instance, text, isStatus);
});

evtSource.addEventListener('agent-progress', (e) => {
  const { teamId, instance, text } = JSON.parse(e.data);
  // Store streaming text separately — don't overwrite agent output (status messages)
  if (!agentStreaming[teamId]) agentStreaming[teamId] = {};
  agentStreaming[teamId][instance] = text;
  if (teamId === selectedTeamId) {
    updateAgentStream(instance, text);
    // Also update the dot/status to show "working" if not already
    const panel = document.getElementById('agent-' + instance);
    if (panel) {
      const dot = panel.querySelector('.agent-dot');
      if (dot) dot.className = 'agent-dot active';
      const st = panel.querySelector('.agent-status');
      if (st) { st.className = 'agent-status streaming'; st.textContent = 'working...'; }
      panel.classList.add('streaming');
    }
    // Re-render overview cards during security review so progress bar updates
    if (instance === 'Security-1' && (securityReviewState[teamId] || {}).status === 'running' && currentView === 'overview') {
      renderAgentOverview();
    }
  }
});

evtSource.addEventListener('agent-task', (e) => {
  const { teamId, instance, subtask } = JSON.parse(e.data);
  if (!agentSubtasks[teamId]) agentSubtasks[teamId] = {};
  agentSubtasks[teamId][instance] = subtask;
  if (teamId === selectedTeamId) updateAgentSubtask(instance, subtask);
});

evtSource.addEventListener('task-complete', (e) => {
  const { teamId, phase, durationMs } = JSON.parse(e.data);
  if (teams[teamId]) {
    teams[teamId].currentPhase = phase;
    stopTimingInterval(teamId);
  }
  renderSidebar();
  if (teamId === selectedTeamId) {
    renderPhaseBar();
    renderTiming(durationMs);
    renderControlsBar();
    // Re-render current view
    if (currentView === 'overview') renderAgentOverview();
    else if (currentView === 'detail' && selectedAgent) renderAgentDetailView(selectedAgent);
  }
  showNotification('Task ' + (phase === 'done' ? 'completed' : 'errored') + ' for ' + teamId + ' (' + (durationMs / 1000).toFixed(1) + 's)', phase === 'done' ? 'success' : 'error');
});

evtSource.addEventListener('error', (e) => {
  const { teamId, message } = JSON.parse(e.data);
  showNotification('Error in ' + teamId + ': ' + message, 'error');
});

evtSource.addEventListener('feedback', (e) => {
  const data = JSON.parse(e.data);
  const { teamId } = data;
  if (!feedbackItems[teamId]) feedbackItems[teamId] = [];
  feedbackItems[teamId].push(data);
  if (teamId === selectedTeamId) {
    renderFeedbackBar();
    // Auto-open side panel for blocking feedback (e.g., requirements approval)
    if (data.blocking && !sidePanelOpen) {
      toggleSidePanel();
    }
  }
});

evtSource.addEventListener('security-review', (e) => {
  const data = JSON.parse(e.data);
  const { teamId, status, result } = data;
  securityReviewState[teamId] = { status, result: result || '' };
  if (status === 'running') {
    // Start a fresh timer for the security review
    taskStartTimes[teamId] = Date.now();
    startTimingInterval(teamId);
    // Clear Security-1 streaming/output so it shows as active again
    if (agentStreaming[teamId]) agentStreaming[teamId]['Security-1'] = '';
    if (agentOutputs[teamId]) delete agentOutputs[teamId]['Security-1'];
  } else if (status === 'passed' || status === 'concerns' || status === 'idle') {
    stopTimingInterval(teamId);
    // Clear streaming state for Security-1
    if (agentStreaming[teamId]) agentStreaming[teamId]['Security-1'] = '';
  }
  if (teamId === selectedTeamId) {
    renderSecurityReviewBtn();
    renderAgentOverview();
    if (status !== 'running') renderTiming(Date.now() - (taskStartTimes[teamId] || Date.now()));
  }
});

// --- Image paste/drop/file handlers ---
setTimeout(() => {
  const ta = document.getElementById('relaunchText');
  if (ta) {
    ta.addEventListener('paste', (e) => {
      const items = e.clipboardData && e.clipboardData.items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.startsWith('image/')) {
          e.preventDefault();
          addImageFile(items[i].getAsFile());
        }
      }
    });
    ta.addEventListener('dragover', (e) => { e.preventDefault(); });
    ta.addEventListener('drop', (e) => {
      e.preventDefault();
      const files = e.dataTransfer && e.dataTransfer.files;
      if (!files) return;
      for (let i = 0; i < files.length; i++) {
        if (files[i].type.startsWith('image/')) addImageFile(files[i]);
      }
    });
  }
  const fi = document.getElementById('imageFileInput');
  if (fi) {
    fi.addEventListener('change', (e) => {
      const files = e.target.files;
      for (let i = 0; i < files.length; i++) addImageFile(files[i]);
      e.target.value = '';
    });
  }
  const modalTa = document.getElementById('modalTask');
  if (modalTa) {
    modalTa.addEventListener('paste', (e) => {
      const items = e.clipboardData && e.clipboardData.items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.startsWith('image/')) {
          e.preventDefault();
          addModalImageFile(items[i].getAsFile());
        }
      }
    });
    modalTa.addEventListener('dragover', (e) => { e.preventDefault(); });
    modalTa.addEventListener('drop', (e) => {
      e.preventDefault();
      const files = e.dataTransfer && e.dataTransfer.files;
      if (!files) return;
      for (let i = 0; i < files.length; i++) {
        if (files[i].type.startsWith('image/')) addModalImageFile(files[i]);
      }
    });
  }
  const mfi = document.getElementById('modalImageFileInput');
  if (mfi) {
    mfi.addEventListener('change', (e) => {
      const files = e.target.files;
      for (let i = 0; i < files.length; i++) addModalImageFile(files[i]);
      e.target.value = '';
    });
  }
}, 100);

// --- Render Functions ---

function renderSidebar() {
  const list = document.getElementById('teamList');
  const ids = Object.keys(teams);
  if (ids.length === 0) {
    list.innerHTML = '<div class="empty-sidebar">No teams yet</div>';
    return;
  }

  // Group teams by project path
  const groups = {};
  ids.forEach(id => {
    const proj = teams[id].projectPath || 'Unknown Project';
    if (!groups[proj]) groups[proj] = [];
    groups[proj].push(id);
  });

  // Sort teams within each group: active first, then by name
  const terminal = ['done', 'errored', 'cancelled'];
  Object.values(groups).forEach(group => {
    group.sort((a, b) => {
      const aActive = !terminal.includes(teams[a].currentPhase);
      const bActive = !terminal.includes(teams[b].currentPhase);
      if (aActive !== bActive) return aActive ? -1 : 1;
      return a.localeCompare(b);
    });
  });

  // Sort project groups: projects with active teams first
  const projKeys = Object.keys(groups);
  projKeys.sort((a, b) => {
    const aHasActive = groups[a].some(id => !terminal.includes(teams[id].currentPhase));
    const bHasActive = groups[b].some(id => !terminal.includes(teams[id].currentPhase));
    if (aHasActive !== bHasActive) return aHasActive ? -1 : 1;
    return a.localeCompare(b);
  });

  let html = '';
  projKeys.forEach(proj => {
    const projName = proj.split('/').pop() || proj;
    const isCollapsed = projectCollapsed[proj] || false;
    const colClass = isCollapsed ? ' collapsed' : '';
    html += '<div class="sidebar-project-group">';
    html += '<div class="sidebar-project-header' + colClass + '" onclick="toggleProject(\\'' + escapeAttr(proj) + '\\')">'
      + '<span class="sidebar-project-chevron">&#9660;</span>'
      + '<span class="sidebar-project-name">' + escapeHtml(projName) + '</span>'
      + '<span class="sidebar-project-count">' + groups[proj].length + '</span>'
      + '</div>';
    html += '<div class="sidebar-project-teams' + colClass + '">';
    groups[proj].forEach(id => {
      const t = teams[id];
      const phase = t.currentPhase;
      const color = PHASE_COLORS[phase] || '#484f58';
      const isActive = id === selectedTeamId;
      html += '<div class="team-item' + (isActive ? ' active' : '') + '" onclick="selectTeam(\\'' + escapeAttr(id) + '\\')">'
        + '<span class="team-item-name">' + escapeHtml(t.teamName || id) + '</span>'
        + '<span class="team-item-phase" style="background:' + color + '22;color:' + color + '">' + (PHASE_LABELS[phase] || phase) + '</span>'
        + '<button class="team-item-delete" data-team="' + escapeHtml(id) + '" title="Remove team">&times;</button>'
        + '</div>';
    });
    html += '</div></div>';
  });
  list.innerHTML = html;
}

function selectTeam(teamId) {
  selectedTeamId = teamId;
  currentView = 'overview';
  selectedAgent = null;
  renderSidebar();
  renderTeamDetail();
  document.getElementById('noSelection').style.display = 'none';
  document.getElementById('teamDetail').style.display = 'block';

  // Auto-open side panel if there's pending blocking feedback
  const items = feedbackItems[teamId] || [];
  const hasBlocking = items.some(i => i.blocking);
  if (hasBlocking && !sidePanelOpen) {
    toggleSidePanel();
  }
}

function renderTeamDetail() {
  if (!selectedTeamId || !teams[selectedTeamId]) return;
  const t = teams[selectedTeamId];
  document.getElementById('detailTeamName').textContent = t.teamName || selectedTeamId;

  const complexityEl = document.getElementById('detailComplexity');
  if (t.currentTask && t.currentTask.complexity) {
    complexityEl.textContent = t.currentTask.complexity;
    complexityEl.style.display = '';
  } else {
    complexityEl.style.display = 'none';
  }

  renderProjectInfo();
  renderPhaseBar();
  renderSidePanelContent();
  updateFeedbackBadge();
  renderTaskSection();
  if (currentView === 'detail' && selectedAgent) {
    document.getElementById('agentOverview').style.display = 'none';
    document.getElementById('agentDetailView').style.display = '';
    document.getElementById('backBtn').style.display = '';
    renderAgentDetailView(selectedAgent);
  } else {
    document.getElementById('agentOverview').style.display = '';
    document.getElementById('agentDetailView').style.display = 'none';
    document.getElementById('backBtn').style.display = 'none';
    renderAgentOverview();
  }
  renderControlsBar();

  if (taskStartTimes[selectedTeamId]) {
    const elapsed = Date.now() - taskStartTimes[selectedTeamId];
    renderTiming(elapsed);
  }
}

function renderProjectInfo() {
  if (!selectedTeamId || !teams[selectedTeamId]) return;
  const t = teams[selectedTeamId];
  const el = document.getElementById('detailProject');
  if (t.projectPath) {
    const branch = t.gitBranch || '';
    el.innerHTML = '<span class="project-label">Project</span>' + escapeHtml(t.projectPath)
      + (branch ? '<span class="git-info">' + escapeHtml(branch) + '</span>' : '');
    el.style.display = 'block';
  } else {
    el.style.display = 'none';
  }
}

function renderPhaseBar() {
  if (!selectedTeamId || !teams[selectedTeamId]) return;
  const t = teams[selectedTeamId];
  const phase = t.currentPhase;
  const currentIdx = PHASES.indexOf(phase);
  const isErrored = phase === 'errored';
  const isCancelled = phase === 'cancelled';
  const hasTask = !!t.currentTask;

  const bar = document.getElementById('phaseBar');
  bar.innerHTML = PHASES.map((p, i) => {
    let dotClass = '';
    if (isErrored || isCancelled) {
      dotClass = i <= Math.max(currentIdx, 0) ? (isErrored ? 'errored' : 'past') : '';
    } else if (i < currentIdx) {
      dotClass = 'past';
    } else if (i === currentIdx) {
      dotClass = phase === 'done' ? 'past' : (hasTask ? 'active' : '');
    }
    const labelClass = dotClass === 'past' || dotClass === 'active' ? dotClass : '';
    const content = dotClass === 'past' ? '&#10003;' : (i + 1);
    const step = '<div class="phase-step">'
      + '<div class="phase-dot ' + dotClass + '">' + content + '</div>'
      + '<span class="phase-label ' + labelClass + '">' + PHASE_LABELS[p] + '</span>'
      + '</div>';
    if (i < PHASES.length - 1) {
      const connClass = i < currentIdx ? 'past' : '';
      return step + '<div class="phase-connector ' + connClass + '"></div>';
    }
    return step;
  }).join('');
}

function renderFeedbackBar() {
  // Redirected to side panel
  renderSidePanelContent();
  updateFeedbackBadge();
}

function renderSidePanelContent() {
  const container = document.getElementById('sidePanelContent');
  if (!container) return;
  const items = feedbackItems[selectedTeamId] || [];
  if (!items.length) {
    container.innerHTML = '<div style="text-align:center;color:#484f58;padding:24px;font-size:0.85rem">No notifications yet</div>';
    return;
  }

  const ICONS = { info: '\\u2139\\uFE0F', warning: '\\u26A0\\uFE0F', question: '\\u2753', decision: '\\uD83D\\uDD36' };

  container.innerHTML = items.map((item, idx) => {
    const icon = ICONS[item.type] || '\\u2139\\uFE0F';
    let actionsHtml = '';
    if (item.actions && item.actions.length > 0) {
      actionsHtml = '<div class="feedback-actions">'
        + item.actions.map(a =>
          '<button onclick="respondToFeedback(\\'' + escapeAttr(item.id) + '\\', \\'' + escapeAttr(a.value) + '\\')">'
          + escapeHtml(a.label) + '</button>'
        ).join('')
        + '</div>';
    }
    const timeAgo = formatTimeAgo(item.timestamp);
    const hasDetail = !!item.detail;
    const clickable = hasDetail ? ' clickable' : '';
    const dataAttrs = hasDetail ? ' data-detail-idx="' + idx + '"' : '';
    return '<div class="feedback-item ' + (item.type || 'info') + clickable + '"' + dataAttrs + '>'
      + '<span class="feedback-icon">' + icon + '</span>'
      + '<div class="feedback-content">'
      + '<div class="feedback-title">' + escapeHtml(item.title) + (hasDetail ? ' <span style="font-size:0.7rem;color:#58a6ff;cursor:pointer">View details</span>' : '') + '</div>'
      + '<div class="feedback-message">' + escapeHtml(item.message) + '</div>'
      + actionsHtml
      + '<div class="feedback-time">' + timeAgo + '</div>'
      + '</div>'
      + '<button class="feedback-dismiss" onclick="event.stopPropagation();dismissFeedback(' + idx + ')">&times;</button>'
      + '</div>';
  }).join('');

  container.scrollTop = container.scrollHeight;
}

function toggleSidePanel() {
  sidePanelOpen = !sidePanelOpen;
  const panel = document.getElementById('sidePanel');
  if (sidePanelOpen) {
    panel.classList.add('open');
    renderSidePanelContent();
  } else {
    panel.classList.remove('open');
  }
  updateFeedbackBadge();
}

function updateFeedbackBadge() {
  const badge = document.getElementById('feedbackBadge');
  if (!badge) return;
  const items = feedbackItems[selectedTeamId] || [];
  if (items.length > 0 && !sidePanelOpen) {
    badge.textContent = items.length;
    badge.style.display = '';
  } else {
    badge.style.display = 'none';
  }
}

function dismissFeedback(idx) {
  const items = feedbackItems[selectedTeamId];
  if (items && idx >= 0 && idx < items.length) {
    items.splice(idx, 1);
    renderFeedbackBar();
  }
}

async function respondToFeedback(feedbackId, value) {
  if (!selectedTeamId) return;
  try {
    await fetch('/api/teams/' + encodeURIComponent(selectedTeamId) + '/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ feedbackId, value }),
    });
    // Remove the item from the list
    const items = feedbackItems[selectedTeamId];
    if (items) {
      const idx = items.findIndex(i => i.id === feedbackId);
      if (idx !== -1) items.splice(idx, 1);
    }
    renderFeedbackBar();
    showNotification('Response sent', 'success');
  } catch (err) {
    showNotification('Failed to send response: ' + err.message, 'error');
  }
}

function formatTimeAgo(isoTimestamp) {
  const diff = Date.now() - new Date(isoTimestamp).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 5) return 'just now';
  if (seconds < 60) return seconds + 's ago';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return minutes + 'm ago';
  return Math.floor(minutes / 60) + 'h ago';
}

function renderTaskSection() {
  if (!selectedTeamId || !teams[selectedTeamId]) return;
  const t = teams[selectedTeamId];
  const el = document.getElementById('taskSection');
  if (t.currentTask) {
    let html = escapeHtml(t.currentTask.description);
    if (t.currentTask.requirements) {
      html += '<div style="margin-top:8px;padding-top:8px;border-top:1px solid #21262d;font-size:0.78rem;color:#7ee787">'
        + '<strong>Approved Requirements:</strong><pre style="margin:4px 0 0;white-space:pre-wrap;color:#8b949e;font-size:0.78rem">'
        + escapeHtml(t.currentTask.requirements) + '</pre></div>';
    }
    el.innerHTML = html;
    el.style.display = '';
  } else {
    el.style.display = 'none';
  }
}

function renderAgentPanels() {
  // Legacy — redirected to overview/detail system
  if (currentView === 'detail' && selectedAgent) {
    renderAgentDetailView(selectedAgent);
  } else {
    renderAgentOverview();
  }
}

// --- Navigation ---

function navigateToOverview() {
  currentView = 'overview';
  selectedAgent = null;
  document.getElementById('backBtn').style.display = 'none';
  document.getElementById('agentOverview').style.display = '';
  document.getElementById('agentDetailView').style.display = 'none';
  renderAgentOverview();
}

function navigateToAgent(agent) {
  currentView = 'detail';
  selectedAgent = agent;
  document.getElementById('backBtn').style.display = '';
  document.getElementById('agentOverview').style.display = 'none';
  document.getElementById('agentDetailView').style.display = '';
  renderAgentDetailView(agent);
}

// --- Overview Cards ---

function getAgentProgress(agent) {
  const outputs = agentOutputs[selectedTeamId] || {};
  const streams = agentStreaming[selectedTeamId] || {};
  const phase = teams[selectedTeamId]?.currentPhase;
  const isDone = ['done', 'errored', 'cancelled'].includes(phase);
  const text = outputs[agent] || '';
  const streamText = streams[agent] || '';
  const hasText = text.length > 0;
  const isStreaming = streamText.length > 0;
  const isActive = hasText || isStreaming;

  // Security-1 is re-running during security review — not done yet
  const secReviewRunning = agent === 'Security-1' && (securityReviewState[selectedTeamId] || {}).status === 'running';
  if (secReviewRunning) {
    if (!isActive) return 10;
    return Math.min(90, Math.max(10, Math.floor((streamText.length / 3000) * 90)));
  }

  // Agent has final output and is no longer streaming — it's done
  if (hasText && !isStreaming) return 100;
  // Entire pipeline done
  if (isDone && hasText) return 100;
  if (!isActive) return 0;
  return Math.min(90, Math.max(10, Math.floor((streamText.length / 3000) * 90)));
}

function renderAgentOverview() {
  const container = document.getElementById('agentOverview');
  if (!container) return;
  const outputs = agentOutputs[selectedTeamId] || {};
  const streams = agentStreaming[selectedTeamId] || {};
  const phase = teams[selectedTeamId]?.currentPhase;
  const isDone = ['done', 'errored', 'cancelled'].includes(phase);
  const complexity = teams[selectedTeamId]?.currentTask?.complexity;
  const isSimple = complexity === 'simple';

  const secReviewRunning = (securityReviewState[selectedTeamId] || {}).status === 'running';

  container.innerHTML = AGENTS.map(agent => {
    const skipped = isSimple && agent !== 'Worker-1';
    const color = AGENT_COLORS[agent] || '#8b949e';
    const text = outputs[agent] || '';
    const streamText = streams[agent] || '';
    const hasText = text.length > 0;
    const isStreaming = streamText.length > 0;
    // Security-1 is active (not done) while security review is running
    const isSecReviewing = agent === 'Security-1' && secReviewRunning;
    const isActive = hasText || isStreaming || isSecReviewing;
    const agentDone = isSecReviewing ? false : ((hasText && !isStreaming) || (isDone && hasText));

    if (skipped) {
      return '<div class="agent-card skipped" style="--agent-color:' + color + ';opacity:0.4;cursor:default">'
        + '<div class="agent-card-header">'
        + '<span class="agent-card-name"><span class="agent-dot" style="--agent-color:' + color + '"></span>' + agent + '</span>'
        + '<span class="agent-card-status" style="color:#484f58">SKIPPED</span>'
        + '</div>'
        + '<div class="agent-card-progress"><div class="agent-card-progress-fill" style="width:0%"></div></div>'
        + '<div class="agent-card-footer"><span class="agent-card-percent">Simple task</span></div>'
        + '</div>';
    }

    const dotClass = agentDone ? 'done' : (isActive ? 'active' : '');
    const statusText = agentDone ? 'DONE' : (isSecReviewing ? 'REVIEWING' : (isActive ? 'Working...' : 'IDLE'));
    const statusColor = agentDone ? '#7ee787' : (isActive ? color : '#484f58');
    const progress = getAgentProgress(agent);
    const cardClass = 'agent-card' + (isActive && !agentDone ? ' streaming' : '');

    return '<div class="' + cardClass + '" style="--agent-color:' + color + '" onclick="navigateToAgent(\\'' + agent + '\\')">'
      + '<div class="agent-card-header">'
      + '<span class="agent-card-name"><span class="agent-dot ' + dotClass + '" style="--agent-color:' + color + '"></span>' + agent + '</span>'
      + '<span class="agent-card-status" style="color:' + statusColor + '">' + statusText + '</span>'
      + '</div>'
      + '<div class="agent-card-progress"><div class="agent-card-progress-fill" style="width:' + progress + '%;background:' + color + '"></div></div>'
      + '<div class="agent-card-footer">'
      + '<span class="agent-card-percent">' + progress + '% Complete</span>'
      + '</div>'
      + '</div>';
  }).join('');
}

// --- Detail View ---


function renderAgentDetailView(agent) {
  const container = document.getElementById('agentDetailView');
  if (!container) return;
  const color = AGENT_COLORS[agent] || '#8b949e';
  const outputs = agentOutputs[selectedTeamId] || {};
  const streams = agentStreaming[selectedTeamId] || {};
  const text = outputs[agent] || '';
  const streamText = streams[agent] || '';
  const phase = teams[selectedTeamId]?.currentPhase;
  const isDone = ['done', 'errored', 'cancelled'].includes(phase);
  const hasText = text.length > 0;
  const isStreaming = streamText.length > 0;
  const isSecReviewing = agent === 'Security-1' && (securityReviewState[selectedTeamId] || {}).status === 'running';
  const isActive = hasText || isStreaming || isSecReviewing;
  const agentDone = isSecReviewing ? false : ((hasText && !isStreaming) || (isDone && hasText));
  const dotClass = agentDone ? 'done' : (isActive ? 'active' : '');
  const statusText = agentDone ? 'DONE' : (isSecReviewing ? 'REVIEWING' : (isActive ? 'Working...' : 'IDLE'));
  const statusClass = agentDone ? 'done' : (isActive ? 'streaming' : '');
  const streamVisible = isStreaming ? 'visible' : '';
  const contentHtml = '<div class="agent-detail-output" id="detail-output-' + agent + '">' + escapeHtml(truncateOutput(text)) + '</div>'
    + '<div class="agent-detail-stream ' + streamVisible + '" id="detail-stream-' + agent + '">'
    + escapeHtml(streamText.length > 3000 ? '...' + streamText.slice(-3000) : streamText)
    + (streamVisible ? '<span class="typing-dots"><span></span><span></span><span></span></span>' : '')
    + '</div>';

  container.innerHTML = '<div class="agent-detail-panel" style="--agent-color:' + color + '">'
    + '<div class="agent-detail-header">'
    + '<span class="agent-detail-name"><span class="agent-dot ' + dotClass + '" style="--agent-color:' + color + '"></span>' + agent + '</span>'
    + '<span class="agent-status ' + statusClass + '" style="--agent-color:' + color + '">' + statusText + '</span>'
    + '</div>'
    + contentHtml
    + '</div>';

  // Auto-scroll output/stream
  const outputEl = document.getElementById('detail-output-' + agent);
  if (outputEl) outputEl.scrollTop = outputEl.scrollHeight;
  const streamEl = document.getElementById('detail-stream-' + agent);
  if (streamEl) streamEl.scrollTop = streamEl.scrollHeight;

  // Ensure panel doesn't overlap controls bar
  if (typeof updateDetailPanelHeight === 'function') updateDetailPanelHeight();
}

function updateAgentSubtask(instance, subtask) {
  // Subtasks only used in legacy panels — overview cards don't show them
}

function updateAgentPanel(instance, text, streaming) {
  // Update overview card if in overview mode
  if (currentView === 'overview') {
    renderAgentOverview();
  }
  // Update detail view if this agent is selected
  if (currentView === 'detail' && selectedAgent === instance) {
    renderAgentDetailView(instance);
  }
}

function updateAgentStream(instance, text) {
  // Update overview cards (progress changes)
  if (currentView === 'overview') {
    renderAgentOverview();
  }
  // Update detail view if this agent is selected
  if (currentView === 'detail' && selectedAgent === instance) {
    renderAgentDetailView(instance);
  }
}

function toggleProject(proj) {
  projectCollapsed[proj] = !projectCollapsed[proj];
  renderSidebar();
}

function toggleAgent(agent) {
  const el = document.getElementById('output-' + agent);
  if (!el) return;
  el.classList.toggle('collapsed');
  agentPanelCollapsed[agent] = el.classList.contains('collapsed');
}

function renderControlsBar() {
  if (!selectedTeamId || !teams[selectedTeamId]) return;
  const phase = teams[selectedTeamId].currentPhase;
  const terminal = ['done', 'errored', 'cancelled'];
  const isRunning = !terminal.includes(phase);
  document.getElementById('stopBtn').style.display = isRunning ? '' : 'none';
  document.getElementById('relaunchBtn').disabled = isRunning;

  // Push & Merge button — only visible when phase is done
  const pushMergeBtn = document.getElementById('pushMergeBtn');
  pushMergeBtn.style.display = phase === 'done' ? '' : 'none';
  pushMergeBtn.disabled = false;
  pushMergeBtn.textContent = 'Push & Merge to Main';

  // Preview button — visible when phase is done
  document.getElementById('previewBtn').style.display = phase === 'done' ? '' : 'none';

  // Security review button
  renderSecurityReviewBtn();

  // Ask button — visible when pipeline is not running (terminal state)
  const askBtn = document.getElementById('askBtn');
  askBtn.style.display = !isRunning ? '' : 'none';
  askBtn.disabled = false;
  askBtn.textContent = 'Ask';
}

function renderTiming(ms) {
  const el = document.getElementById('detailTiming');
  const seconds = (ms / 1000).toFixed(1);
  el.textContent = seconds + 's';
}

function startTimingInterval(teamId) {
  stopTimingInterval(teamId);
  timingIntervals[teamId] = setInterval(() => {
    if (teamId !== selectedTeamId) return;
    if (!taskStartTimes[teamId]) return;
    const elapsed = Date.now() - taskStartTimes[teamId];
    renderTiming(elapsed);
  }, 100);
}

function stopTimingInterval(teamId) {
  if (timingIntervals[teamId]) {
    clearInterval(timingIntervals[teamId]);
    delete timingIntervals[teamId];
  }
}

// --- Actions ---

function showNewTeamModal() {
  document.getElementById('newTeamModal').style.display = 'flex';
  document.getElementById('modalName').focus();
  document.getElementById('modalError').textContent = '';
}

function hideNewTeamModal() {
  document.getElementById('newTeamModal').style.display = 'none';
  document.getElementById('modalPathDisplay').classList.remove('has-path');
  document.getElementById('modalPathText').textContent = 'Click to browse for project folder...';
  clearModalImages();
}

// --- Native Folder Picker ---
async function pickProjectFolder() {
  const display = document.getElementById('modalPathDisplay');
  const textEl = document.getElementById('modalPathText');
  const prevText = textEl.textContent;
  textEl.textContent = 'Opening Finder...';

  try {
    const res = await fetch('/api/pick-directory', { method: 'POST' });
    const data = await res.json();

    if (data.cancelled || !data.path) {
      textEl.textContent = prevText === 'Opening Finder...' ? 'Click to select project folder...' : prevText;
      return;
    }

    document.getElementById('modalPath').value = data.path;
    display.classList.add('has-path');
    textEl.textContent = data.path;
  } catch (err) {
    textEl.textContent = 'Click to select project folder...';
    display.classList.remove('has-path');
  }
}

function showDetailModal(title, content, extraHtml) {
  document.getElementById('detailModalTitle').textContent = title;
  document.getElementById('detailModalContent').textContent = content;
  document.getElementById('detailModalExtra').innerHTML = extraHtml || '';
  document.getElementById('detailModal').style.display = 'flex';
}

function hideDetailModal() {
  document.getElementById('detailModal').style.display = 'none';
}

async function createTeam() {
  const name = document.getElementById('modalName').value.trim();
  const projectPath = document.getElementById('modalPath').value.trim();
  const task = document.getElementById('modalTask').value.trim();
  const errorEl = document.getElementById('modalError');

  if (!name) { errorEl.textContent = 'Team name is required'; return; }
  if (!projectPath) { errorEl.textContent = 'Project path is required'; return; }

  const imgs = getAndClearModalImages();
  try {
    const body = { name, projectPath };
    if (task) body.task = task;
    if (imgs) body.images = imgs;

    const res = await fetch('/api/teams', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();

    if (!res.ok) {
      errorEl.textContent = data.error || 'Failed to create team';
      return;
    }

    hideNewTeamModal();
    document.getElementById('modalName').value = '';
    document.getElementById('modalPath').value = '';
    document.getElementById('modalTask').value = '';
    selectTeam(name);
  } catch (err) {
    errorEl.textContent = 'Network error: ' + err.message;
  }
}

async function stopCurrentTeam() {
  if (!selectedTeamId) return;
  if (!confirm('Stop team "' + selectedTeamId + '"? This will terminate all agents.')) return;
  try {
    await fetch('/api/teams/' + encodeURIComponent(selectedTeamId) + '/stop', { method: 'POST' });
  } catch (err) {
    showNotification('Failed to stop: ' + err.message, 'error');
  }
}

async function deleteTeam(teamId) {
  try {
    await fetch('/api/teams/' + encodeURIComponent(teamId) + '/stop', { method: 'POST' });
  } catch {}
  // Remove from client state
  delete teams[teamId];
  delete agentOutputs[teamId];
  delete agentStreaming[teamId];
  delete agentSubtasks[teamId];
  delete feedbackItems[teamId];
  delete securityReviewState[teamId];
  if (selectedTeamId === teamId) {
    selectedTeamId = null;
    currentView = 'overview';
    selectedAgent = null;
    document.getElementById('teamDetail').style.display = 'none';
    document.getElementById('noSelection').style.display = '';
  }
  renderSidebar();
}

async function relaunchCurrentTeam() {
  if (!selectedTeamId) return;
  const desc = document.getElementById('relaunchText').value.trim();
  if (!desc) { showNotification('Task description is required', 'error'); return; }

  const imgs = getAndClearImages();
  try {
    const payload = { description: desc };
    if (imgs) payload.images = imgs;
    const res = await fetch('/api/teams/' + encodeURIComponent(selectedTeamId) + '/task', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) {
      showNotification(data.error || 'Failed to re-launch', 'error');
    } else {
      document.getElementById('relaunchText').value = '';
    }
  } catch (err) {
    showNotification('Network error: ' + err.message, 'error');
  }
}

async function askAgent() {
  if (!selectedTeamId) return;
  const msg = document.getElementById('relaunchText').value.trim();
  if (!msg) { showNotification('Type a question first', 'error'); return; }

  const imgs = getAndClearImages();
  const btn = document.getElementById('askBtn');
  btn.disabled = true;
  btn.textContent = 'Asking...';

  try {
    const payload = { message: msg };
    if (imgs) payload.images = imgs;
    const res = await fetch('/api/teams/' + encodeURIComponent(selectedTeamId) + '/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) {
      showNotification(data.error || 'Failed to ask', 'error');
    } else {
      document.getElementById('relaunchText').value = '';
    }
  } catch (err) {
    showNotification('Network error: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Ask';
  }
}

function renderSecurityReviewBtn() {
  const btn = document.getElementById('securityReviewBtn');
  if (!btn) return;
  if (!selectedTeamId || !teams[selectedTeamId]) { btn.style.display = 'none'; return; }
  const phase = teams[selectedTeamId].currentPhase;
  if (phase !== 'done') { btn.style.display = 'none'; return; }

  btn.style.display = '';
  const state = securityReviewState[selectedTeamId] || { status: 'idle' };

  btn.className = 'btn btn-security-review';
  btn.disabled = false;

  if (state.status === 'running') {
    btn.classList.add('running');
    btn.disabled = true;
    btn.textContent = 'Reviewing...';
  } else if (state.status === 'passed') {
    btn.classList.add('passed');
    btn.textContent = 'Security: Passed';
  } else if (state.status === 'concerns') {
    btn.classList.add('concerns');
    btn.textContent = 'Security: Concerns Found';
  } else {
    btn.textContent = 'Final Security Review';
  }
}

function handleSecurityReviewClick() {
  if (!selectedTeamId) return;
  const state = securityReviewState[selectedTeamId] || { status: 'idle' };
  // If review has results, show them in the detail modal
  if ((state.status === 'passed' || state.status === 'concerns') && state.result) {
    const title = state.status === 'passed' ? 'Security Review: Passed' : 'Security Review: Concerns Found';
    showDetailModal(title, state.result,
      '<button class="btn btn-security-review" onclick="hideDetailModal();runSecurityReview()">Re-run Review</button>');
    return;
  }
  // Otherwise, run the review
  runSecurityReview();
}

async function runSecurityReview() {
  if (!selectedTeamId) return;

  const state = securityReviewState[selectedTeamId] || { status: 'idle' };
  if (state.status === 'running') return;

  securityReviewState[selectedTeamId] = { status: 'running' };
  renderSecurityReviewBtn();

  try {
    const res = await fetch('/api/teams/' + encodeURIComponent(selectedTeamId) + '/security-review', { method: 'POST' });
    const data = await res.json();
    if (!res.ok) {
      showNotification('Security review failed: ' + (data.error || 'Unknown error'), 'error');
      securityReviewState[selectedTeamId] = { status: 'idle' };
      renderSecurityReviewBtn();
    }
    // Actual result comes via SSE
  } catch (err) {
    showNotification('Network error: ' + err.message, 'error');
    securityReviewState[selectedTeamId] = { status: 'idle' };
    renderSecurityReviewBtn();
  }
}

async function pushAndMerge() {
  if (!selectedTeamId) return;
  if (!confirm('Push dev and merge to main for "' + selectedTeamId + '"?\\n\\nThis will push the dev branch, merge it into main, and push main.')) return;

  const btn = document.getElementById('pushMergeBtn');
  btn.disabled = true;
  btn.textContent = 'Pushing...';

  try {
    const res = await fetch('/api/teams/' + encodeURIComponent(selectedTeamId) + '/push-merge', { method: 'POST' });
    const data = await res.json();
    if (data.success) {
      showNotification('Push & Merge succeeded for ' + selectedTeamId, 'success');
      btn.textContent = 'Merged';
    } else {
      showNotification('Push & Merge failed: ' + (data.output || data.error || 'Unknown error'), 'error');
      btn.textContent = 'Push & Merge to Main';
      btn.disabled = false;
    }
  } catch (err) {
    showNotification('Network error: ' + err.message, 'error');
    btn.textContent = 'Push & Merge to Main';
    btn.disabled = false;
  }
}

function previewProject() {
  if (!selectedTeamId || !teams[selectedTeamId]) return;
  window.open('/preview/' + encodeURIComponent(selectedTeamId), '_blank');
}

// --- Helpers ---

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escapeAttr(str) {
  return str.replace(/'/g, "\\\\'").replace(/"/g, '&quot;');
}

function truncateOutput(text) {
  if (!text) return '';
  const MAX = 50000;
  if (text.length <= MAX) return text;
  return '... (truncated) ...\\n' + text.slice(-MAX);
}

function showNotification(message, type) {
  const area = document.getElementById('notificationArea');
  const el = document.createElement('div');
  el.className = 'notification ' + (type || '');
  el.textContent = message;
  area.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transition = 'opacity 0.3s';
    setTimeout(() => el.remove(), 300);
  }, 4000);
}

// --- Prompt resize handle ---
function updateDetailPanelHeight() {
  const controlsBar = document.getElementById('controlsBar');
  if (!controlsBar) return;
  const barH = controlsBar.offsetHeight;
  document.querySelectorAll('.agent-detail-panel').forEach(el => {
    const panelTop = el.getBoundingClientRect().top;
    const maxH = window.innerHeight - panelTop - barH - 48;
    el.style.maxHeight = Math.max(100, maxH) + 'px';
  });
}

setTimeout(() => {
  const handle = document.getElementById('promptResizeHandle');
  const ta = document.getElementById('relaunchText');
  if (handle && ta) {
    let startY = 0;
    let startH = 0;
    handle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      startY = e.clientY;
      startH = ta.offsetHeight;
      const onMove = (ev) => {
        const delta = startY - ev.clientY;
        const newH = Math.min(300, Math.max(72, startH + delta));
        ta.style.height = newH + 'px';
        updateDetailPanelHeight();
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });
  }
  window.addEventListener('resize', updateDetailPanelHeight);
  updateDetailPanelHeight();
}, 200);

// --- Keyboard shortcuts ---
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (document.getElementById('detailModal').style.display === 'flex') { hideDetailModal(); return; }
    if (currentView === 'detail') { navigateToOverview(); return; }
    hideNewTeamModal();
  }
  if (e.key === 'Enter' && document.getElementById('newTeamModal').style.display === 'flex') {
    if (e.target.tagName !== 'TEXTAREA') createTeam();
  }
});

// --- Delegated click for team delete ---
document.addEventListener('click', (e) => {
  const btn = e.target.closest('.team-item-delete');
  if (!btn) return;
  e.stopPropagation();
  const teamId = btn.dataset.team;
  if (!teamId) return;
  if (!confirm('Remove team "' + teamId + '"?')) return;
  deleteTeam(teamId);
});

// --- Delegated click for feedback notifications ---
document.addEventListener('click', (e) => {
  const item = e.target.closest('.feedback-item.clickable');
  if (!item) return;
  const idx = item.dataset.detailIdx;
  if (idx !== undefined) {
    const items = feedbackItems[selectedTeamId] || [];
    const feedback = items[parseInt(idx)];
    if (feedback && feedback.detail) {
      showDetailModal(feedback.title, feedback.detail);
    }
  }
});

`;
