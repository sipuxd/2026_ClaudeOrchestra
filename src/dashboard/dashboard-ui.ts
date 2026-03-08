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
        <h2 id="detailTeamName"></h2>
        <span class="complexity-badge" id="detailComplexity"></span>
      </div>
      <div class="detail-timing" id="detailTiming"></div>
    </div>
    <div class="phase-bar" id="phaseBar"></div>
    <div class="task-section" id="taskSection"></div>
    <div class="agent-panels" id="agentPanels"></div>
    <div class="controls-bar" id="controlsBar">
      <button class="btn btn-danger" id="stopBtn" onclick="stopCurrentTeam()">Stop</button>
      <div class="relaunch-group">
        <textarea id="relaunchText" placeholder="Edit task description and re-launch..."></textarea>
        <button class="btn btn-primary" id="relaunchBtn" onclick="relaunchCurrentTeam()">Re-launch</button>
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
    <input type="text" id="modalPath" placeholder="/Users/you/Projects/my-app" autocomplete="off" />
    <label>Task Description</label>
    <textarea id="modalTask" placeholder="Build a..." rows="4"></textarea>
    <div class="modal-actions">
      <button class="btn btn-ghost" onclick="hideNewTeamModal()">Cancel</button>
      <button class="btn btn-primary" onclick="createTeam()">Launch</button>
    </div>
    <div class="modal-error" id="modalError"></div>
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

.team-detail { padding: 24px; }

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
  border-color: var(--phase-color);
  background: var(--phase-color);
  color: #0d1117;
}

.phase-dot.active {
  border-color: var(--phase-color);
  background: var(--phase-color);
  color: #0d1117;
  box-shadow: 0 0 12px var(--phase-color);
  animation: pulse 1.5s infinite;
}

.phase-dot.errored {
  border-color: #f85149;
  background: #f85149;
  color: #0d1117;
}

@keyframes pulse {
  0%, 100% { box-shadow: 0 0 8px var(--phase-color); }
  50% { box-shadow: 0 0 20px var(--phase-color); }
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

.phase-connector.past { background: var(--conn-color); }

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

/* --- Agent Panels --- */
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

/* --- Controls Bar --- */
.controls-bar {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding-top: 8px;
  border-top: 1px solid #30363d;
}

.relaunch-group {
  flex: 1;
  display: flex;
  gap: 8px;
  align-items: flex-start;
}

.relaunch-group textarea {
  flex: 1;
  background: #0d1117;
  border: 1px solid #30363d;
  border-radius: 8px;
  padding: 10px 12px;
  color: #c9d1d9;
  font-family: inherit;
  font-size: 0.85rem;
  resize: vertical;
  min-height: 40px;
  max-height: 120px;
}

.relaunch-group textarea:focus {
  outline: none;
  border-color: #58a6ff;
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

.btn-danger {
  background: #da3633;
  color: #fff;
}
.btn-danger:hover { background: #f85149; }

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
let selectedTeamId = null;
let agentOutputs = {};
let agentPanelCollapsed = {};
let taskStartTimes = {};
let timingIntervals = {};

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
    agentOutputs[t.teamId] = {};
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
  if (teamId === selectedTeamId) renderPhaseBar();
});

evtSource.addEventListener('agent-output', (e) => {
  const { teamId, instance, text } = JSON.parse(e.data);
  if (!agentOutputs[teamId]) agentOutputs[teamId] = {};
  agentOutputs[teamId][instance] = text;
  if (teamId === selectedTeamId) updateAgentPanel(instance, text, false);
});

evtSource.addEventListener('agent-progress', (e) => {
  const { teamId, instance, text } = JSON.parse(e.data);
  if (!agentOutputs[teamId]) agentOutputs[teamId] = {};
  agentOutputs[teamId][instance] = text;
  if (teamId === selectedTeamId) updateAgentPanel(instance, text, true);
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
    // Mark all agent panels as done
    AGENTS.forEach(a => {
      const dot = document.querySelector('#agent-' + CSS.escape(a) + ' .agent-dot');
      if (dot) { dot.className = 'agent-dot done'; }
      const st = document.querySelector('#agent-' + CSS.escape(a) + ' .agent-status');
      if (st) { st.className = 'agent-status done'; st.textContent = 'done'; }
    });
  }
  showNotification('Task ' + (phase === 'done' ? 'completed' : 'errored') + ' for ' + teamId + ' (' + (durationMs / 1000).toFixed(1) + 's)', phase === 'done' ? 'success' : 'error');
});

evtSource.addEventListener('error', (e) => {
  const { teamId, message } = JSON.parse(e.data);
  showNotification('Error in ' + teamId + ': ' + message, 'error');
});

// --- Render Functions ---

function renderSidebar() {
  const list = document.getElementById('teamList');
  const ids = Object.keys(teams);
  if (ids.length === 0) {
    list.innerHTML = '<div class="empty-sidebar">No teams yet</div>';
    return;
  }
  // Sort: active teams first, then by name
  const terminal = ['done', 'errored', 'cancelled'];
  ids.sort((a, b) => {
    const aActive = !terminal.includes(teams[a].currentPhase);
    const bActive = !terminal.includes(teams[b].currentPhase);
    if (aActive !== bActive) return aActive ? -1 : 1;
    return a.localeCompare(b);
  });
  list.innerHTML = ids.map(id => {
    const t = teams[id];
    const phase = t.currentPhase;
    const color = PHASE_COLORS[phase] || '#484f58';
    const isActive = id === selectedTeamId;
    return '<div class="team-item' + (isActive ? ' active' : '') + '" onclick="selectTeam(\\'' + escapeAttr(id) + '\\')">'
      + '<span class="team-item-name">' + escapeHtml(t.teamName || id) + '</span>'
      + '<span class="team-item-phase" style="background:' + color + '22;color:' + color + '">' + (PHASE_LABELS[phase] || phase) + '</span>'
      + '</div>';
  }).join('');
}

function selectTeam(teamId) {
  selectedTeamId = teamId;
  renderSidebar();
  renderTeamDetail();
  document.getElementById('noSelection').style.display = 'none';
  document.getElementById('teamDetail').style.display = 'block';
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

  renderPhaseBar();
  renderTaskSection();
  renderAgentPanels();
  renderControlsBar();

  if (taskStartTimes[selectedTeamId]) {
    const elapsed = Date.now() - taskStartTimes[selectedTeamId];
    renderTiming(elapsed);
  }
}

function renderPhaseBar() {
  if (!selectedTeamId || !teams[selectedTeamId]) return;
  const phase = teams[selectedTeamId].currentPhase;
  const currentIdx = PHASES.indexOf(phase);
  const isErrored = phase === 'errored';
  const isCancelled = phase === 'cancelled';

  const bar = document.getElementById('phaseBar');
  bar.innerHTML = PHASES.map((p, i) => {
    const color = PHASE_COLORS[p];
    let dotClass = '';
    if (isErrored || isCancelled) {
      dotClass = i <= Math.max(currentIdx, 0) ? (isErrored ? 'errored' : 'past') : '';
    } else if (i < currentIdx) {
      dotClass = 'past';
    } else if (i === currentIdx) {
      dotClass = 'active';
    }
    const labelClass = dotClass === 'past' || dotClass === 'active' ? dotClass : '';
    const check = dotClass === 'past' ? '&#10003;' : (i + 1);
    const step = '<div class="phase-step">'
      + '<div class="phase-dot ' + dotClass + '" style="--phase-color:' + color + '">' + check + '</div>'
      + '<span class="phase-label ' + labelClass + '">' + PHASE_LABELS[p] + '</span>'
      + '</div>';
    if (i < PHASES.length - 1) {
      const connClass = i < currentIdx ? 'past' : '';
      const connColor = i < currentIdx ? PHASE_COLORS[PHASES[i + 1]] : '#30363d';
      return step + '<div class="phase-connector ' + connClass + '" style="--conn-color:' + connColor + '"></div>';
    }
    return step;
  }).join('');
}

function renderTaskSection() {
  if (!selectedTeamId || !teams[selectedTeamId]) return;
  const t = teams[selectedTeamId];
  const el = document.getElementById('taskSection');
  if (t.currentTask) {
    el.textContent = t.currentTask.description;
    el.style.display = '';
    document.getElementById('relaunchText').value = t.currentTask.description;
  } else {
    el.style.display = 'none';
  }
}

function renderAgentPanels() {
  const container = document.getElementById('agentPanels');
  const outputs = agentOutputs[selectedTeamId] || {};
  const phase = teams[selectedTeamId]?.currentPhase;
  const terminal = ['done', 'errored', 'cancelled'];
  const isDone = terminal.includes(phase);

  container.innerHTML = AGENTS.map(agent => {
    const color = AGENT_COLORS[agent] || '#8b949e';
    const text = outputs[agent] || '';
    const hasText = text.length > 0;
    const collapsed = agentPanelCollapsed[agent] && !hasText ? 'collapsed' : '';
    const dotClass = isDone && hasText ? 'done' : (hasText ? 'active' : '');
    const statusText = isDone && hasText ? 'done' : (hasText ? 'streaming' : 'waiting');
    const statusClass = isDone && hasText ? 'done' : (hasText ? 'streaming' : '');
    return '<div class="agent-panel" id="agent-' + agent + '" style="--agent-color:' + color + '">'
      + '<div class="agent-header" onclick="toggleAgent(\\'' + agent + '\\')">'
      + '<span class="agent-name"><span class="agent-dot ' + dotClass + '" style="--agent-color:' + color + '"></span>' + agent + '</span>'
      + '<span class="agent-status ' + statusClass + '" style="--agent-color:' + color + '">' + statusText + '</span>'
      + '</div>'
      + '<div class="agent-output ' + collapsed + '" id="output-' + agent + '">' + escapeHtml(truncateOutput(text)) + '</div>'
      + '</div>';
  }).join('');
}

function updateAgentPanel(instance, text, streaming) {
  const panel = document.getElementById('agent-' + instance);
  if (!panel) return;

  const outputEl = document.getElementById('output-' + instance);
  if (outputEl) {
    outputEl.textContent = truncateOutput(text);
    outputEl.classList.remove('collapsed');
    outputEl.scrollTop = outputEl.scrollHeight;
  }

  const dot = panel.querySelector('.agent-dot');
  if (dot) {
    dot.className = 'agent-dot ' + (streaming ? 'active' : 'done');
  }

  const statusEl = panel.querySelector('.agent-status');
  if (statusEl) {
    statusEl.className = 'agent-status ' + (streaming ? 'streaming' : 'done');
    statusEl.textContent = streaming ? 'streaming...' : 'complete';
  }

  if (streaming) {
    panel.classList.add('streaming');
  } else {
    panel.classList.remove('streaming');
  }
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
}

async function createTeam() {
  const name = document.getElementById('modalName').value.trim();
  const projectPath = document.getElementById('modalPath').value.trim();
  const task = document.getElementById('modalTask').value.trim();
  const errorEl = document.getElementById('modalError');

  if (!name) { errorEl.textContent = 'Team name is required'; return; }
  if (!projectPath) { errorEl.textContent = 'Project path is required'; return; }

  try {
    const body = { name, projectPath };
    if (task) body.task = task;

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

async function relaunchCurrentTeam() {
  if (!selectedTeamId) return;
  const desc = document.getElementById('relaunchText').value.trim();
  if (!desc) { showNotification('Task description is required', 'error'); return; }

  try {
    const res = await fetch('/api/teams/' + encodeURIComponent(selectedTeamId) + '/task', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: desc }),
    });
    const data = await res.json();
    if (!res.ok) {
      showNotification(data.error || 'Failed to re-launch', 'error');
    }
  } catch (err) {
    showNotification('Network error: ' + err.message, 'error');
  }
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

// --- Keyboard shortcuts ---
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') hideNewTeamModal();
  if (e.key === 'Enter' && document.getElementById('newTeamModal').style.display === 'flex') {
    if (e.target.tagName !== 'TEXTAREA') createTeam();
  }
});
`;
