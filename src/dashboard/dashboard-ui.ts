// Dashboard UI — Portfolio View
// Single-page application served by DashboardServer.
// Replaces the legacy sidebar-based layout with a portfolio grid.

export function buildDashboardHTML(): string {
  const CSS = `
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#0d1117;--surface:#161b22;--border:#30363d;
  --text-primary:#e6edf3;--text-secondary:#8b949e;--text-muted:#484f58;
  --blue:#58a6ff;--green:#3fb950;--green-light:#7ee787;
  --red:#da3633;--red-light:#f85149;
  --amber:#d29922;--purple:#a371f7;
  --nav-width:64px;--panel-width:560px;
  --radius:8px;--radius-sm:6px;
  color-scheme:dark;
}
html,body{height:100%;overflow:hidden}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;
  background:var(--bg);color:var(--text-primary);display:flex}
button{font-family:inherit;cursor:pointer;border:none;background:none;color:inherit}
input,textarea,select{font-family:inherit;color:var(--text-primary);background:var(--surface);
  border:1px solid var(--border);border-radius:var(--radius-sm);padding:8px 12px;outline:none;font-size:.875rem}
input:focus,textarea:focus,select:focus{border-color:var(--blue)}
input:-webkit-autofill,input:-webkit-autofill:hover,input:-webkit-autofill:focus,
textarea:-webkit-autofill,textarea:-webkit-autofill:hover,textarea:-webkit-autofill:focus,
select:-webkit-autofill,select:-webkit-autofill:hover,select:-webkit-autofill:focus{
  -webkit-text-fill-color:var(--text-primary);
  caret-color:var(--text-primary);
  -webkit-box-shadow:0 0 0 1000px var(--surface) inset;
  box-shadow:0 0 0 1000px var(--surface) inset;
  border-color:var(--blue);
  transition:background-color 9999s ease-in-out 0s;
}
textarea{resize:vertical}
a{color:var(--blue);text-decoration:none}
a:hover{text-decoration:underline}
::-webkit-scrollbar{width:8px;height:8px}
::-webkit-scrollbar-track{background:transparent}
::-webkit-scrollbar-thumb{background:var(--border);border-radius:4px}
::-webkit-scrollbar-thumb:hover{background:var(--text-muted)}

/* --- Nav Rail --- */
.nav-rail{width:var(--nav-width);min-width:var(--nav-width);height:100vh;background:var(--surface);
  border-right:1px solid var(--border);display:flex;flex-direction:column;align-items:center;
  padding:12px 0;z-index:100;position:relative}
.nav-logo{width:40px;height:40px;border-radius:10px;background:linear-gradient(135deg,var(--blue),var(--purple));
  display:flex;align-items:center;justify-content:center;font-size:18px;font-weight:700;color:#fff;
  margin-bottom:16px;cursor:pointer;flex-shrink:0}
.nav-projects{flex:1;overflow-y:auto;overflow-x:hidden;display:flex;flex-direction:column;align-items:center;
  gap:4px;width:100%;padding:0 8px;scrollbar-width:none}
.nav-projects::-webkit-scrollbar{display:none}
.nav-item{width:40px;height:40px;border-radius:10px;background:var(--bg);border:1px solid var(--border);
  display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:600;
  cursor:pointer;position:relative;transition:border-color .15s,background .15s;flex-shrink:0}
.nav-item:hover{border-color:var(--text-muted)}
.nav-item.active{border-color:var(--blue);background:rgba(88,166,255,.1)}
.nav-badge{position:absolute;top:-4px;right:-4px;min-width:16px;height:16px;border-radius:8px;
  background:var(--red);color:#fff;font-size:10px;font-weight:700;display:flex;align-items:center;
  justify-content:center;padding:0 4px;border:2px solid var(--surface)}
.nav-bottom{display:flex;flex-direction:column;align-items:center;gap:4px;padding-top:8px;
  border-top:1px solid var(--border);width:100%;flex-shrink:0}
.nav-btn{width:40px;height:40px;border-radius:10px;display:flex;align-items:center;justify-content:center;
  font-size:18px;cursor:pointer;transition:background .15s}
.nav-btn:hover{background:var(--bg)}

/* --- Main Content --- */
.main-content{flex:1;height:100vh;display:flex;flex-direction:column;position:relative;overflow:hidden}
.top-tabs{display:flex;gap:2px;padding:8px 12px 0;background:var(--surface);border-bottom:1px solid var(--border);flex-shrink:0}
.top-tab{padding:8px 18px;background:transparent;border:none;border-radius:6px 6px 0 0;color:var(--text-muted);font-size:0.875rem;font-weight:500;cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-1px}
.top-tab:hover{color:var(--text);background:var(--bg)}
.top-tab.active{color:var(--text);background:var(--bg);border-bottom-color:var(--accent)}
.top-tab-pane{flex:1;overflow:hidden;display:none;position:relative}
.top-tab-pane.active{display:flex;flex-direction:column}
.top-tab-pane.portfolio{overflow-y:auto}
.code-frame{flex:1;width:100%;border:none;background:var(--bg)}
/* Masks code-server's white bootstrap HTML during the first paint, then fades
   out once the workbench has time to apply the dark theme. */
.code-frame-overlay{position:absolute;inset:0;background:var(--bg);z-index:10;opacity:1;transition:opacity .25s ease;pointer-events:none}
.code-frame-overlay.fade-out{opacity:0}
.code-empty{flex:1;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:12px;padding:40px;text-align:center;color:var(--text-muted)}
.code-empty h2{color:var(--text);font-size:1.1rem;font-weight:600;margin:0}
.code-empty code{background:var(--surface);padding:6px 10px;border-radius:4px;font-family:var(--mono);font-size:0.875rem;color:var(--text)}
/* width:100% is required because the parent .top-tab-pane.portfolio.active uses
   display:flex — without it the container shrinks to intrinsic content width
   and max-width never takes effect, producing inconsistent per-project widths. */
.view-container{width:100%;max-width:1028px;padding:32px 40px;margin:0 auto;box-sizing:border-box}
/* The all-projects Portfolio overview gets a wider cap. Distinguished from
   individual project detail views by the .dashboard-header direct child
   (project pages render .project-detail-header instead). */
.view-container:has(> .dashboard-header){max-width:1400px}

/* --- Dashboard Header --- */
.dashboard-header{margin-bottom:28px}
.dashboard-heading-row{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
.dashboard-header h1{font-size:1.5rem;font-weight:600;margin-bottom:4px}
.dashboard-subtitle{color:var(--text-secondary);font-size:.875rem}
.runtime-pill{display:inline-flex;align-items:center;gap:6px;padding:5px 10px;border-radius:999px;
  background:var(--surface);border:1px solid var(--border);color:var(--text-secondary);
  font-size:.75rem;text-transform:uppercase;letter-spacing:.04em}
.auth-pill{display:inline-flex;align-items:center;gap:6px;padding:5px 10px;border-radius:999px;
  font-size:.75rem;font-weight:500;background:var(--surface);border:1px solid var(--border);
  color:var(--text-secondary);cursor:pointer;transition:border-color .15s,background .15s}
.auth-pill:hover{border-color:var(--text-muted)}
.auth-pill .auth-dot{width:7px;height:7px;border-radius:50%;background:currentColor;flex-shrink:0}
.auth-pill-loading{color:var(--text-muted);cursor:default}
.auth-pill-loading:hover{border-color:var(--border)}
.auth-pill-ok{color:var(--green);border-color:rgba(63,185,80,.4);background:rgba(63,185,80,.08)}
.auth-pill-off{color:var(--red-light);border-color:rgba(218,54,51,.45);background:rgba(218,54,51,.1)}
.auth-pill-error{color:var(--red-light);border-color:rgba(218,54,51,.45);background:rgba(218,54,51,.1)}
.auth-pill-conflict{color:var(--amber);border-color:rgba(210,153,34,.45);background:rgba(210,153,34,.12)}
.auth-pill-pending{color:var(--blue);border-color:rgba(88,166,255,.4);background:rgba(88,166,255,.1)}
.auth-pill-pending .auth-dot{animation:pulse-dot 1.2s infinite}

/* --- Stat Pills --- */
.stat-pills{display:flex;align-items:center;gap:10px;margin-bottom:28px;flex-wrap:wrap}
.stat-pills .gap{width:56px;flex-shrink:0}
.stat-pill{display:flex;align-items:center;gap:6px;padding:6px 14px;border-radius:20px;
  background:var(--surface);border:1px solid var(--border);font-size:.8125rem;cursor:pointer;
  transition:border-color .15s,background .15s;user-select:none}
.stat-pill:hover{border-color:var(--text-muted)}
.stat-pill.active{border-color:var(--blue);background:rgba(88,166,255,.08)}
.stat-pill .count{font-weight:700}
.stat-pill .dot{width:8px;height:8px;border-radius:50%;flex-shrink:0}
.dot-active{background:var(--blue)}
.dot-review{background:var(--amber)}
.dot-done{background:var(--green)}
.dot-pr{background:var(--purple)}
.dot-attention{background:var(--red)}

/* --- Project Section --- */
.project-section{margin-bottom:36px}
.project-section+.project-section{border-top:1px solid var(--border);padding-top:24px}
.project-section-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;cursor:pointer}
.project-section-header h2{font-size:1.1rem;font-weight:600;margin-right:12px;display:inline}
.project-path-label{color:var(--text-muted);font-size:.75rem;font-family:'SF Mono','Fira Code',monospace;margin-right:12px}
.project-team-count{color:var(--text-secondary);font-size:.8125rem}
.project-stats{display:flex;align-items:center;gap:6px;flex-shrink:0}
/* 50px + parent's 6px gap = 56px separation between the badge cluster and the action buttons */
.project-stats > .mini-pill + button{margin-left:50px}
.mini-pill{font-size:.65rem;font-weight:600;padding:0 8px;border-radius:10px;height:20px;display:inline-flex;align-items:center;box-sizing:border-box}
.pill-error{background:rgba(218,54,51,.12);color:var(--red-light)}
.pill-active{background:rgba(88,166,255,.12);color:var(--blue)}
.pill-review{background:rgba(210,153,34,.12);color:var(--amber)}
.pill-pr{background:rgba(163,113,247,.12);color:var(--purple)}
.pill-done{background:rgba(63,185,80,.12);color:var(--green)}

/* --- Team Cards Grid --- */
.team-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px}
.team-card{background:var(--surface);border:1px solid var(--border);border-radius:12px;
  padding:16px;cursor:pointer;transition:all .2s;position:relative;overflow:hidden}
.team-card:hover{border-color:var(--blue);transform:translateY(-2px);box-shadow:0 4px 12px rgba(0,0,0,.3)}
.team-card.status-active{border-left:3px solid var(--blue)}
.team-card.status-review{border-left:3px solid var(--amber)}
.team-card.status-done{border-left:3px solid var(--green)}
.team-card.status-pr{border-left:3px solid var(--purple)}
.team-card.status-error{border-left:3px solid var(--red)}
.team-card.status-blocked{border-left:3px solid var(--red)}
.team-card.needs-attention{animation:pulse-border 2s ease-in-out infinite}
@keyframes pulse-border{
  0%,100%{border-color:var(--border)}
  50%{border-color:var(--red)}
}
.card-top{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px}
.card-name{font-weight:600;font-size:.9375rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:200px}
.card-phase-badge{font-size:.6875rem;font-weight:600;padding:3px 8px;border-radius:10px;text-transform:uppercase;letter-spacing:.04em}
.phase-pre_work{background:rgba(88,166,255,.15);color:var(--blue)}
.phase-work{background:rgba(88,166,255,.15);color:var(--blue)}
.phase-handoff{background:rgba(210,153,34,.15);color:var(--amber)}
.phase-review{background:rgba(210,153,34,.15);color:var(--amber)}
.phase-done{background:rgba(63,185,80,.15);color:var(--green)}
.phase-pr_open{background:rgba(163,113,247,.15);color:var(--purple)}
.phase-merged{background:rgba(63,185,80,.15);color:var(--green-light)}
.phase-errored{background:rgba(218,54,51,.15);color:var(--red)}
.phase-cancelled{background:rgba(72,79,88,.15);color:var(--text-muted)}
.card-task{color:var(--text-secondary);font-size:.8125rem;line-height:1.4;margin-bottom:10px;
  display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.card-progress{margin-bottom:10px}
.progress-bar{height:6px;background:var(--bg);border-radius:3px;overflow:hidden;display:flex;gap:3px}
.progress-segment{flex:1;border-radius:2px;transition:background .3s}
.seg-done{background:var(--green)}
.seg-active{background:var(--blue);animation:seg-pulse 1.5s ease-in-out infinite}
@keyframes seg-pulse{0%,100%{opacity:1}50%{opacity:.5}}
.seg-future{background:var(--border)}
.seg-error{background:var(--red)}
.progress-labels{display:flex;gap:2px;margin-top:4px}
.progress-label{flex:1;font-size:.55rem;text-align:center;color:var(--text-muted);text-transform:uppercase;letter-spacing:.03em}
.progress-label.lbl-done{color:var(--green)}
.progress-label.lbl-active{color:var(--blue)}
.progress-label.lbl-error{color:var(--red)}
.card-bottom{display:flex;align-items:center;justify-content:space-between;margin-top:2px}
.card-status-label{font-size:.68rem;font-weight:600;padding:2px 8px;border-radius:10px;text-transform:uppercase;letter-spacing:.04em}
.card-agents{display:flex;gap:4px}
.agent-dot{width:20px;height:20px;border-radius:50%;font-size:8px;font-weight:700;
  display:flex;align-items:center;justify-content:center;border:1px solid var(--border)}
.agent-dot.idle{background:var(--bg);color:var(--text-muted)}
.agent-dot.active{background:rgba(88,166,255,.2);color:var(--blue);border-color:var(--blue)}
.agent-dot.done{background:rgba(63,185,80,.2);color:var(--green);border-color:var(--green)}
.card-elapsed{color:var(--text-muted);font-size:.75rem;font-family:'SF Mono','Fira Code',monospace}
.card-attention-badge{position:absolute;top:8px;right:8px;width:10px;height:10px;border-radius:50%;
  background:var(--red);box-shadow:0 0 6px var(--red)}

/* --- Project Detail View --- */
.project-detail-header{display:flex;align-items:center;gap:12px;margin-bottom:24px}
.project-detail-header .back-btn{width:32px;height:32px;border-radius:var(--radius-sm);
  background:var(--surface);border:1px solid var(--border);display:flex;align-items:center;
  justify-content:center;font-size:16px;cursor:pointer;transition:background .15s}
.project-detail-header .back-btn:hover{background:var(--bg)}
.project-detail-header h1{font-size:1.25rem;font-weight:600}
.project-detail-path{color:var(--text-muted);font-size:.75rem;font-family:'SF Mono','Fira Code',monospace;margin-left:44px;margin-bottom:20px}

.compact-card-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px;margin-bottom:16px}
.compact-card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);
  padding:12px 14px;cursor:pointer;transition:border-color .15s;position:relative}
.compact-card:hover{border-color:var(--text-muted)}
.compact-card.selected{border-color:var(--blue);background:rgba(88,166,255,.05)}
.compact-card-top{display:flex;align-items:center;justify-content:space-between;margin-bottom:6px}
.compact-card-name{font-weight:600;font-size:.8125rem}
.compact-card-phase{font-size:.625rem;font-weight:600;padding:2px 6px;border-radius:8px;text-transform:uppercase}
.compact-card-task{color:var(--text-secondary);font-size:.75rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}

.inline-detail{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);
  padding:20px;margin-top:16px}
.inline-detail-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:16px}
.inline-detail-header h3{font-size:1rem;font-weight:600}
.inline-detail-actions{display:flex;gap:8px}

/* --- Slide-in Panel --- */
.panel-overlay{position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.4);
  z-index:200;opacity:0;pointer-events:none;transition:opacity .2s}
.panel-overlay.open{opacity:1;pointer-events:auto}
.slide-panel{position:fixed;top:0;right:0;width:var(--panel-width);height:100vh;
  background:var(--surface);border-left:1px solid var(--border);z-index:201;
  transform:translateX(100%);transition:transform .25s ease;display:flex;flex-direction:column}
.slide-panel.open{transform:translateX(0)}
.panel-header{display:flex;align-items:center;justify-content:space-between;padding:16px 20px;
  border-bottom:1px solid var(--border);flex-shrink:0}
.panel-header h3{font-size:1rem;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:300px}
.panel-close{width:28px;height:28px;border-radius:var(--radius-sm);display:flex;align-items:center;
  justify-content:center;font-size:16px;cursor:pointer;transition:background .15s}
.panel-close:hover{background:var(--bg)}
.panel-tabs{display:flex;border-bottom:1px solid var(--border);flex-shrink:0}
.panel-tab{flex:1;padding:10px;text-align:center;font-size:.8125rem;font-weight:500;
  cursor:pointer;color:var(--text-secondary);border-bottom:2px solid transparent;transition:color .15s,border-color .15s}
.panel-tab:hover{color:var(--text-primary)}
.panel-tab.active{color:var(--blue);border-bottom-color:var(--blue)}
.panel-body{flex:1;overflow-y:auto;padding:16px 20px}

/* --- Feedback Action Block --- */
.feedback-block{background:rgba(88,166,255,.08);border:1px solid rgba(88,166,255,.3);border-radius:var(--radius);
  padding:14px 16px;margin-bottom:14px}
.feedback-block-title{font-weight:600;font-size:.875rem;color:var(--blue);margin-bottom:6px;
  display:flex;align-items:center;gap:6px}
.feedback-block.feedback-info{background:rgba(63,185,80,.08);border-color:rgba(63,185,80,.32)}
.feedback-block.feedback-info .feedback-block-title{color:var(--green)}
.feedback-block.feedback-warning,.feedback-block.feedback-question{background:rgba(210,153,34,.08);border-color:rgba(210,153,34,.35)}
.feedback-block.feedback-warning .feedback-block-title,.feedback-block.feedback-question .feedback-block-title{color:var(--amber)}
.feedback-block.feedback-error{background:rgba(218,54,51,.08);border-color:rgba(218,54,51,.3)}
.feedback-block.feedback-error .feedback-block-title{color:var(--red-light)}
.feedback-block-msg{color:var(--text-secondary);font-size:.8125rem;line-height:1.5;margin-bottom:10px;white-space:pre-wrap}
.feedback-block-detail{color:var(--text-muted);font-size:.75rem;margin-bottom:10px;
  max-height:120px;overflow-y:auto;white-space:pre-wrap;font-family:'SF Mono','Fira Code',monospace;
  background:var(--bg);padding:8px;border-radius:var(--radius-sm)}
.feedback-block-actions{display:flex;gap:8px;flex-wrap:wrap}
.feedback-block-editable{color:var(--text-secondary);font-size:.8125rem;line-height:1.5;white-space:pre-wrap;
  margin-bottom:10px;max-height:240px;overflow-y:auto;background:var(--bg);padding:8px;border-radius:var(--radius-sm)}
.feedback-edit-area{width:100%;box-sizing:border-box;min-height:200px;max-height:400px;resize:vertical;
  color:var(--text-primary);background:var(--bg);border:1px solid var(--blue);border-radius:var(--radius-sm);
  padding:8px 10px;margin-bottom:10px;font-family:'SF Mono','Fira Code',monospace;font-size:.8125rem;line-height:1.5}

/* --- Summary Content --- */
.summary-status-top{display:flex;align-items:center;gap:16px;padding:16px;margin-bottom:16px;
  background:var(--bg);border:1px solid var(--border);border-radius:10px}
.summary-status-icon{width:44px;height:44px;border-radius:50%;display:flex;align-items:center;
  justify-content:center;font-size:1.3rem;flex-shrink:0}
.summary-status-top.pass .summary-status-icon{background:rgba(35,134,54,.12);color:var(--green)}
.summary-status-top.active .summary-status-icon{background:rgba(56,139,253,.14);color:var(--blue)}
.summary-status-top.fail .summary-status-icon{background:rgba(218,54,51,.12);color:var(--red-light)}
.summary-task{font-size:.875rem;color:var(--text-primary);line-height:1.4}
.summary-status-text{font-size:.75rem;margin-top:4px}
.summary-actions{display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap}
.pipeline-stats{display:flex;gap:0;margin-bottom:20px;background:var(--bg);border:1px solid var(--border);border-radius:10px;padding:12px}
.pipeline-stat{text-align:center;flex:1}
.pipeline-stat-value{font-size:1.05rem;font-weight:700;color:var(--text-primary)}
.pipeline-stat-label{font-size:.65rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;margin-top:2px}

/* Expandable Agent Sections */
.agent-sections-grid{display:grid;grid-template-columns:1fr;gap:10px}
.agent-section{background:var(--bg);border:1px solid var(--border);border-radius:10px;overflow:hidden;cursor:pointer}
.agent-section-header{display:flex;align-items:center;gap:10px;padding:12px 14px}
.agent-section-header:hover{background:var(--surface)}
.agent-chevron{font-size:.6rem;color:var(--text-muted);transition:transform .2s}
.agent-section.expanded .agent-chevron{transform:rotate(90deg)}
.agent-dot-sm{width:10px;height:10px;border-radius:50%;flex-shrink:0}
.agent-name{font-weight:600;font-size:.8125rem;color:var(--text-primary)}
.agent-verdict{margin-left:auto;font-size:.6875rem;font-weight:600;padding:2px 8px;border-radius:10px}
.agent-section-body{display:none;padding:12px 14px;border-top:1px solid var(--border)}
.agent-section.expanded .agent-section-body{display:block}
.agent-output{font-family:'SF Mono','Fira Code',monospace;font-size:.75rem;color:var(--text-secondary);
  line-height:1.5;white-space:pre-wrap;word-break:break-word;margin:0;max-height:200px;overflow-y:auto}
.security-result-section{margin-top:16px}
.security-result-section h4{font-size:.8125rem;color:var(--text-muted);text-transform:uppercase;margin:0}
.security-result-head{display:flex;align-items:center;gap:8px;margin-bottom:8px}
.security-result-actions{margin-left:auto;display:flex;gap:4px}

/* --- Live Mode --- */
.live-header{display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:12px}
.live-task{font-size:.8125rem;color:var(--text-secondary);line-height:1.4;flex:1}
.live-elapsed{font-size:.8125rem;color:var(--text-muted);font-variant-numeric:tabular-nums;flex-shrink:0;margin-left:12px}
.live-phase-bar{display:flex;align-items:center;margin-bottom:20px}
.live-phase-step{display:flex;flex-direction:column;align-items:center;gap:6px}
.live-dot{width:28px;height:28px;border-radius:50%;border:2px solid var(--border);background:var(--bg);
  display:flex;align-items:center;justify-content:center;font-size:.75rem;z-index:1;color:var(--text-muted)}
.live-dot.past{border-color:var(--green);background:var(--green);color:#fff;font-weight:700}
.live-dot.current{border-color:var(--blue);background:var(--blue);color:#fff;font-weight:700;box-shadow:0 0 12px rgba(88,166,255,.4)}
.live-dot-label{font-size:.65rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em}
.live-dot-label.past{color:var(--green)}
.live-dot-label.current{color:var(--blue)}
.live-connector{flex:1;height:2px;background:var(--border);margin:0 -2px;margin-bottom:20px}
.live-connector.past{background:var(--green)}
.live-agent-grid{display:grid;grid-template-columns:1fr;gap:10px;margin-bottom:16px}
.live-agent-card{background:var(--bg);border:1px solid var(--border);border-radius:10px;padding:12px}
.live-agent-card.active-agent{border-color:var(--agent-color,var(--blue))}
.live-agent-header{display:flex;align-items:center;gap:8px;margin-bottom:8px}
.live-agent-dot{width:8px;height:8px;border-radius:50%;background:var(--border)}
.live-agent-dot.working{background:var(--agent-color,var(--blue));animation:pulse-dot 1.5s infinite}
.live-agent-dot.done{background:var(--green)}
@keyframes pulse-dot{0%,100%{opacity:1}50%{opacity:.4}}
.live-agent-name{font-weight:600;font-size:.8rem;color:var(--text-primary)}
.live-agent-status{margin-left:auto;font-size:.65rem;text-transform:uppercase;font-weight:600}
.live-agent-progress{height:3px;background:var(--border);border-radius:2px;overflow:hidden;margin-bottom:8px}
.live-agent-fill{height:100%;border-radius:2px;transition:width .5s}
.live-agent-output{font-family:'SF Mono','Fira Code',monospace;font-size:.72rem;color:var(--text-muted);
  line-height:1.5;max-height:80px;overflow-y:auto;white-space:pre-wrap;word-break:break-word}
.live-actions{display:flex;gap:8px}

/* --- Modal --- */
.modal-overlay{position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.6);
  z-index:300;display:flex;align-items:center;justify-content:center;opacity:0;
  pointer-events:none;transition:opacity .2s}
.modal-overlay.open{opacity:1;pointer-events:auto}
.modal{background:var(--surface);border:1px solid var(--border);border-radius:12px;
  width:480px;max-width:calc(100vw - 40px);max-height:calc(100vh - 80px);overflow-y:auto;
  box-shadow:0 8px 30px rgba(0,0,0,.5)}
.modal-header{display:flex;align-items:center;justify-content:space-between;padding:18px 20px;
  border-bottom:1px solid var(--border)}
.modal-header h3{font-size:1rem;font-weight:600}
.modal-body{padding:20px}
.modal-footer{display:flex;justify-content:flex-end;gap:10px;padding:14px 20px;
  border-top:1px solid var(--border)}

.form-group{margin-bottom:16px}
.form-group label{display:block;font-size:.8125rem;color:var(--text-secondary);margin-bottom:6px;font-weight:500}
.form-group input,.form-group textarea,.form-group select{width:100%}
.form-group textarea{min-height:80px}

/* --- Buttons --- */
.btn{padding:8px 16px;border-radius:var(--radius-sm);font-size:.8125rem;font-weight:500;
  transition:background .15s,opacity .15s;display:inline-flex;align-items:center;gap:6px}
.btn:disabled{opacity:.5;cursor:not-allowed}
.btn-primary{background:var(--blue);color:#fff}
.btn-primary:hover:not(:disabled){background:#79b8ff}
.btn-danger{background:var(--red);color:#fff}
.btn-danger:hover:not(:disabled){background:var(--red-light)}
.btn-secondary{background:var(--bg);color:var(--text-secondary);border:1px solid var(--border)}
.btn-secondary:hover:not(:disabled){background:var(--surface);color:var(--text-primary)}
.btn-outline{background:transparent;color:var(--blue);border:1px solid var(--blue)}
.btn-outline:hover:not(:disabled){background:rgba(88,166,255,.1)}
.btn-ghost{color:var(--text-secondary);padding:6px 10px}
.btn-ghost:hover{color:var(--text-primary);background:rgba(255,255,255,.05)}
.btn-sm{padding:5px 10px;font-size:.75rem}
.btn-lg{height:40px;padding:0 20px;font-size:.9375rem;font-weight:600}
.btn-green{background:var(--green);color:#fff}
.btn-green:hover:not(:disabled){background:var(--green-light);color:#000}
.btn-purple{background:var(--purple);color:#fff}
.btn-purple:hover:not(:disabled){opacity:.85}
.btn-amber{background:var(--amber);color:#fff}
.btn-amber:hover:not(:disabled){opacity:.85}

/* --- Folder Picker --- */
.folder-picker{display:flex;gap:8px}
.folder-picker input{flex:1}
.folder-picker button{flex-shrink:0}

/* --- Image Attach --- */
.image-attach-area{border:2px dashed var(--border);border-radius:var(--radius);padding:16px;
  text-align:center;color:var(--text-muted);font-size:.8125rem;cursor:pointer;
  transition:border-color .15s,background .15s;min-height:60px;display:flex;flex-direction:column;
  align-items:center;justify-content:center;gap:4px}
.image-attach-area:hover,.image-attach-area.drag-over{border-color:var(--blue);background:rgba(88,166,255,.05)}
.image-previews{display:flex;gap:8px;margin-top:8px;flex-wrap:wrap}
.image-preview{width:48px;height:48px;border-radius:4px;object-fit:cover;border:1px solid var(--border);position:relative}
.image-preview-container{position:relative;display:inline-block}
.image-preview-remove{position:absolute;top:-4px;right:-4px;width:16px;height:16px;border-radius:50%;
  background:var(--red);color:#fff;font-size:10px;display:flex;align-items:center;justify-content:center;
  cursor:pointer;border:1px solid var(--surface)}

/* --- Toast --- */
.toast-container{position:fixed;bottom:20px;right:20px;z-index:400;display:flex;flex-direction:column-reverse;gap:8px}
.toast{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);
  padding:12px 16px;font-size:.8125rem;box-shadow:0 4px 16px rgba(0,0,0,.4);
  display:flex;align-items:center;gap:8px;animation:toast-in .25s ease;max-width:360px}
.toast.out{animation:toast-out .2s ease forwards}
@keyframes toast-in{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
@keyframes toast-out{to{opacity:0;transform:translateY(10px)}}
.toast-icon{font-size:1rem;flex-shrink:0}
.toast-success .toast-icon{color:var(--green)}
.toast-error .toast-icon{color:var(--red)}
.toast-info .toast-icon{color:var(--blue)}

/* --- Empty State --- */
.empty-state{display:flex;flex-direction:column;align-items:center;justify-content:center;
  padding:60px 20px;color:var(--text-muted)}
.empty-state-icon{font-size:3rem;margin-bottom:16px;opacity:.4}
.empty-state h3{font-size:1.1rem;margin-bottom:8px;color:var(--text-secondary)}
.empty-state p{font-size:.875rem;margin-bottom:20px}

/* --- Settings Panel (inline) --- */
.settings-section{padding:20px}
.settings-section h3{font-size:1rem;font-weight:600;margin-bottom:16px}
.setting-row{display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid var(--border)}
.setting-row label{font-size:.8125rem;color:var(--text-secondary)}
.toggle-switch{width:36px;height:20px;border-radius:10px;background:var(--border);position:relative;cursor:pointer;transition:background .2s}
.toggle-switch.on{background:var(--blue)}
.toggle-switch::after{content:'';position:absolute;top:2px;left:2px;width:16px;height:16px;
  border-radius:50%;background:#fff;transition:transform .2s}
.toggle-switch.on::after{transform:translateX(16px)}

/* --- Spinner --- */
.spinner{width:16px;height:16px;border:2px solid var(--border);border-top-color:var(--blue);
  border-radius:50%;animation:spin .6s linear infinite;display:inline-block}
@keyframes spin{to{transform:rotate(360deg)}}

/* --- Security review result --- */
.security-result{background:var(--bg);border:1px solid var(--border);border-radius:var(--radius-sm);
  padding:12px 14px;font-size:.8125rem;line-height:1.55;color:var(--text-primary);margin-top:8px;
  max-height:360px;overflow-y:auto}
.security-result .sr-h{font-size:.8125rem;font-weight:600;color:var(--text-primary);
  margin:10px 0 4px;letter-spacing:.01em}
.security-result h4.sr-h{font-size:.875rem}
.security-result .sr-p{margin:4px 0;color:var(--text-secondary)}
.security-result .sr-p strong,.security-result .sr-list strong{color:var(--text-primary);font-weight:600}
.security-result .sr-list{margin:4px 0 8px;padding-left:20px;color:var(--text-secondary)}
.security-result .sr-list li{margin:2px 0}
.security-result code{font-family:'SF Mono','Fira Code',monospace;font-size:.75rem;
  background:var(--surface);border:1px solid var(--border);border-radius:4px;padding:1px 5px;color:var(--text-primary)}
.security-result .sr-code{font-family:'SF Mono','Fira Code',monospace;font-size:.75rem;
  background:var(--surface);border:1px solid var(--border);border-radius:6px;padding:10px 12px;
  white-space:pre-wrap;word-break:break-word;color:var(--text-primary);margin:6px 0}
/* Severity callouts inside paragraphs/list items get a colored tint. */
.security-result strong:where(:not(.sr-p strong, .sr-list strong)){color:inherit}

/* ==========================================================================
   Side panel redesign — 4 regions: Header / Agents / Chat / Composer
   See docs/side-panel-redesign.md
   ========================================================================== */
.slide-panel{padding:0}
.slide-panel-redesign{display:flex;flex-direction:column;height:100vh;overflow:hidden}

/* Header region */
.sp-header{flex-shrink:0;padding:14px 18px 12px;border-bottom:1px solid var(--border);background:var(--surface);position:relative}
.sp-header-top{display:flex;align-items:center;gap:8px;margin-bottom:2px}
.sp-header-title{font-size:1rem;font-weight:600;color:var(--text-primary);flex:1;min-width:0;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sp-icon-btn{width:30px;height:30px;border-radius:var(--radius-sm);display:flex;align-items:center;
  justify-content:center;font-size:20px;line-height:1;cursor:pointer;color:var(--text-primary);
  transition:background .15s,color .15s,border-color .15s;flex-shrink:0;background:var(--bg);
  border:1px solid var(--border)}
.sp-icon-btn:hover{background:var(--surface);border-color:var(--text-muted)}
.sp-icon-btn:focus-visible{outline:2px solid var(--blue);outline-offset:1px}
.sp-breadcrumb{font-size:.75rem;color:var(--text-secondary);line-height:1.4;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-bottom:10px}
.sp-status-row{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.sp-status-pill{display:inline-flex;align-items:center;gap:6px;font-size:.6875rem;font-weight:600;
  padding:3px 9px;border-radius:999px;text-transform:uppercase;letter-spacing:.04em;flex-shrink:0}
.sp-status-pill .sp-status-dot{width:7px;height:7px;border-radius:50%;background:currentColor}
.sp-status-pill[data-tone="active"]{background:rgba(88,166,255,.12);color:var(--blue)}
.sp-status-pill[data-tone="review"]{background:rgba(210,153,34,.14);color:var(--amber)}
.sp-status-pill[data-tone="done"]{background:rgba(63,185,80,.14);color:var(--green)}
.sp-status-pill[data-tone="pr"]{background:rgba(163,113,247,.14);color:var(--purple)}
.sp-status-pill[data-tone="blocked"]{background:rgba(218,54,51,.14);color:var(--red-light)}
.sp-status-pill[data-tone="muted"]{background:rgba(72,79,88,.18);color:var(--text-secondary)}
.sp-progress{flex:1;display:flex;align-items:center;gap:4px;min-width:120px}
.sp-progress-tick{flex:1;height:4px;border-radius:2px;background:var(--border);min-width:8px}
.sp-progress-tick.past{background:var(--green)}
.sp-progress-tick.current{background:var(--blue)}
.sp-progress-tick.fail{background:var(--red)}
.sp-progress-label{font-size:.6875rem;color:var(--text-muted);font-variant-numeric:tabular-nums;
  flex-shrink:0;letter-spacing:.02em}
.sp-stats-row{display:flex;gap:14px;margin-top:8px;font-size:.6875rem;color:var(--text-muted)}
.sp-stats-row b{color:var(--text-secondary);font-weight:600}
.sp-cancelled-note{margin-top:8px;font-size:.75rem;color:var(--text-secondary);line-height:1.45;
  background:rgba(218,54,51,.08);border:1px solid rgba(218,54,51,.25);border-radius:var(--radius-sm);
  padding:8px 10px}

/* Overflow menu — used by side panel and inline-detail card */
.sp-overflow-wrap{position:relative}
.inline-overflow-wrap{margin-left:auto}
.sp-overflow-menu{position:absolute;top:calc(100% + 4px);right:0;min-width:180px;
  background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);
  box-shadow:0 8px 24px rgba(0,0,0,.45);padding:4px;z-index:50;
  display:none;flex-direction:column}
.sp-overflow-menu[data-open="true"]{display:flex}
.sp-overflow-item{padding:8px 12px;border-radius:var(--radius-sm);font-size:.8125rem;
  color:var(--text-primary);text-align:left;background:transparent;border:none;cursor:pointer;
  display:flex;align-items:center;gap:8px}
.sp-overflow-item:hover:not(:disabled),.sp-overflow-item:focus-visible{background:var(--bg);outline:none}
.sp-overflow-item:disabled{color:var(--text-muted);cursor:not-allowed;opacity:.55}
.sp-overflow-item[data-danger="true"]{color:var(--red-light)}
.sp-overflow-item[data-danger="true"]:hover{background:rgba(218,54,51,.1)}
.sp-overflow-divider{height:1px;background:var(--border);margin:4px 6px}

/* Agents region */
.sp-agents{flex-shrink:0;padding:12px 18px;border-bottom:1px solid var(--border)}
.sp-section-header{display:flex;align-items:center;gap:8px;padding:4px 0;cursor:pointer;
  background:transparent;border:none;color:var(--text-secondary);width:100%}
.sp-section-label{font-size:.6875rem;font-weight:600;text-transform:uppercase;letter-spacing:.06em;
  color:var(--text-secondary)}
.sp-section-chevron{margin-left:auto;font-size:.6rem;color:var(--text-muted);transition:transform .15s}
.sp-agents[data-collapsed="false"] .sp-section-chevron{transform:rotate(90deg)}
.sp-agents-list{display:grid;grid-template-columns:1fr;gap:6px;margin-top:8px}
.sp-agents[data-collapsed="true"] .sp-agents-list{display:none}
.sp-agent-row{background:var(--bg);border:1px solid var(--border);border-radius:8px;overflow:hidden}
.sp-agent-row-head{display:flex;align-items:center;gap:8px;padding:8px 12px;cursor:pointer;
  background:transparent;border:none;width:100%;text-align:left}
.sp-agent-row-head:hover{background:var(--surface)}
.sp-agent-row-chevron{font-size:.55rem;color:var(--text-muted);transition:transform .15s;width:8px}
.sp-agent-row[data-expanded="true"] .sp-agent-row-chevron{transform:rotate(90deg)}
.sp-agent-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0}
.sp-agent-name{font-weight:600;font-size:.8125rem;color:var(--text-primary)}
.sp-agent-verdict{margin-left:auto;font-size:.6875rem;font-weight:600;padding:2px 8px;border-radius:10px}
.sp-agent-row-body{display:none;padding:10px 14px;border-top:1px solid var(--border);
  font-family:'SF Mono','Fira Code',monospace;font-size:.75rem;color:var(--text-secondary);
  line-height:1.5;white-space:pre-wrap;word-break:break-word;max-height:200px;overflow-y:auto}
.sp-agent-row[data-expanded="true"] .sp-agent-row-body{display:block}
.sp-agents-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}
/* Long feedback messages (e.g. requirements checklists) get a capped scroll
   so they don't push the chat region out of the viewport. */
.sp-agents .feedback-block-msg{max-height:200px;overflow-y:auto;padding-right:6px}

/* Chat region (own scroll) */
.sp-chat{flex:1;min-height:0;display:flex;flex-direction:column;overflow:hidden}
.sp-chat-subheader{position:sticky;top:0;z-index:2;display:flex;align-items:center;gap:8px;
  padding:10px 18px;background:var(--surface);border-bottom:1px solid var(--border)}
.sp-chat-subheader .sp-section-label{flex:1}
.sp-chat-thread{flex:1;overflow-y:auto;padding:14px 18px 8px;display:flex;flex-direction:column;gap:10px}

/* Pinned task card */
.sp-pinned-card{background:var(--bg);border:1px solid var(--border);border-radius:8px;
  padding:12px 14px;display:flex;flex-direction:column;gap:6px}
.sp-pinned-head{display:flex;align-items:center;gap:8px}
.sp-pinned-icon{font-size:.95rem;color:var(--amber)}
.sp-pinned-label{font-size:.6875rem;font-weight:600;text-transform:uppercase;letter-spacing:.06em;
  color:var(--text-secondary)}
.sp-pinned-actions{margin-left:auto;display:flex;gap:6px}
.sp-pinned-btn{background:transparent;border:none;color:var(--text-secondary);font-size:.75rem;
  padding:2px 6px;border-radius:4px;cursor:pointer}
.sp-pinned-btn:hover,.sp-pinned-btn:focus-visible{background:var(--surface);color:var(--text-primary);outline:none}
.sp-pinned-body{font-size:.875rem;color:var(--text-primary);line-height:1.5;white-space:pre-wrap;
  word-break:break-word}
.sp-pinned-body[data-collapsed="true"]{display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;
  overflow:hidden}
.sp-pinned-expand{align-self:flex-start;background:transparent;border:none;color:var(--blue);
  font-size:.75rem;cursor:pointer;padding:2px 0}
.sp-pinned-expand:hover{text-decoration:underline}

/* Day divider + message bubbles */
.sp-day-divider{display:flex;align-items:center;gap:8px;color:var(--text-muted);font-size:.6875rem;
  text-transform:uppercase;letter-spacing:.06em;margin:6px 0}
.sp-day-divider::before,.sp-day-divider::after{content:'';flex:1;height:1px;background:var(--border)}
.sp-msg{display:flex;flex-direction:column;gap:4px;max-width:90%}
.sp-msg.is-user{align-self:flex-end;align-items:flex-end}
.sp-msg.is-coordinator,.sp-msg.is-system{align-self:flex-start;align-items:flex-start}
.sp-msg-meta{font-size:.6875rem;color:var(--text-muted);display:flex;align-items:center;gap:6px}
.sp-msg-author{color:var(--text-secondary);font-weight:600}
.sp-msg-bubble{padding:10px 13px;border-radius:10px;font-size:.875rem;line-height:1.5;
  white-space:pre-wrap;word-wrap:break-word;border:1px solid transparent}
.sp-msg-bubble[data-collapsed="true"]{display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;
  overflow:hidden;white-space:normal}
.sp-msg-toggle{background:transparent;border:none;font-size:.75rem;cursor:pointer;padding:2px 0;
  align-self:flex-start;color:var(--blue)}
.sp-msg.is-user .sp-msg-toggle{color:#cfe5ff}
.sp-msg-toggle:hover{text-decoration:underline}
.sp-msg.is-user .sp-msg-bubble{background:var(--blue);color:#fff;border-color:var(--blue)}
.sp-msg.is-coordinator .sp-msg-bubble{background:var(--bg);color:var(--text-primary);border-color:var(--border)}
.sp-msg.is-system .sp-msg-bubble{background:transparent;color:var(--text-secondary);border-color:var(--border);
  border-style:dashed}
.sp-msg-verdict{font-size:.625rem;font-weight:700;text-transform:uppercase;letter-spacing:.05em;
  opacity:.75;margin-right:4px}
.sp-thread-empty{color:var(--text-secondary);font-size:.875rem;line-height:1.5;text-align:center;
  padding:24px 12px;max-width:380px;align-self:center}

/* Composer */
.sp-composer{flex-shrink:0;padding:12px 18px 14px;border-top:1px solid var(--border);background:var(--surface)}
.sp-composer-box{position:relative;background:var(--bg);border:1px solid var(--border);
  border-radius:10px;padding:8px 10px;transition:border-color .15s}
.sp-composer-box:focus-within{border-color:var(--blue)}
.sp-composer textarea{width:100%;min-height:38px;max-height:160px;background:transparent;border:none;
  outline:none;color:var(--text-primary);font-family:inherit;font-size:.875rem;line-height:1.45;
  resize:none;padding:4px 70px 4px 4px}
.sp-composer-actions{position:absolute;right:6px;bottom:6px;display:flex;align-items:center;gap:6px}
.sp-composer-hint{font-size:.6875rem;color:var(--text-muted);padding:0 4px}
.sp-composer-send{padding:5px 12px;font-size:.75rem;border-radius:6px;background:var(--blue);color:#fff;
  font-weight:600;border:none;cursor:pointer}
.sp-composer-send:disabled{opacity:.4;cursor:not-allowed}
.sp-composer-cancel{padding:5px 10px;font-size:.75rem;border-radius:6px;background:var(--bg);
  border:1px solid var(--border);color:var(--text-secondary);cursor:pointer}
.sp-composer-affordances{font-size:.6875rem;color:var(--text-muted);margin-top:6px;display:flex;gap:10px}
.sp-composer-affordances code{background:var(--bg);border:1px solid var(--border);border-radius:4px;
  padding:1px 5px;font-family:'SF Mono','Fira Code',monospace;font-size:.625rem}

/* Confirm dialog (reuses .modal markup, just adds focus styling) */
.modal[data-confirm="true"] .modal-body{font-size:.875rem;color:var(--text-secondary);line-height:1.5}
.modal[data-confirm="true"] .modal-body strong{color:var(--text-primary)}

/* Responsive: full width on small viewports */
@media (max-width: 639px){
  :root{--panel-width:100vw}
  .slide-panel{border-left:none}
}
@media (min-width: 640px) and (max-width: 1023px){
  :root{--panel-width:420px}
}
`;

  const JS = `
(function(){
'use strict';

// ---- State ----
const state = {
  teams: {},           // teamId -> team data
  projects: {},        // projectPath -> { name, teams: Set, inPortfolio: bool }
  recentlyAddedProjects: new Set(), // projectPaths added via + Add Project this session
  runners: {},          // projectPath -> { state, framework, url, lastError, stdoutTail }
  feedbacks: {},       // teamId -> [ feedback objects ]
  editingFeedback: {}, // feedbackId -> in-progress edited text (draft survives re-renders)
  liveOutput: {},      // teamId -> [ { agent, text, type } ]
  chatMessages: {},    // teamId -> [ { role, content, timestamp, verdict? } ]
  chatPending: {},     // teamId -> bool (true while a coordinator turn is in flight)
  malformedOutputs: {}, // teamId -> instance -> { count, lastRaw } — transient marker for verdict-parse retries
  currentView: 'dashboard', // 'dashboard' | 'project'
  currentProject: null,
  topTab: 'portfolio',      // 'portfolio' | 'code' — outer view selector
  codeServer: { state: 'idle', port: null, error: null, installCommand: null },
  panelOpen: false,
  panelTeamId: null,
  // Side panel redesign UI state — purely client-side; see docs/side-panel-redesign.md.
  panelUI: {
    agentsCollapsed: false,        // global collapse for AGENTS region
    pinnedTaskExpanded: false,     // pinned task collapsed by default per spec
    overflowOpen: false,           // ⋮ menu open
    overflowReturnFocusId: null,   // element id to refocus when the menu closes
    confirmDeleteReturnFocusId: null,
    expandedAgents: {},            // instance name -> bool
    expandedMessages: {},          // timestamp -> bool
    securityResultCollapsed: {},   // teamId -> bool
    inlineOverflowTeamId: null,    // teamId whose inline-detail ⋮ menu is open, or null
  },
  selectedCompact: null,
  activeFilter: null,
  projectFilter: {},   // projectPath -> filter
  settings: { autoScroll: true, soundEnabled: false },
  elapsedTimers: {},
  sseConnected: false,
  securityResults: {}, // teamId -> result string
  runtime: null,
  // Claude account auth (subscription/OAuth). Populated by GET /api/auth/status
  // on dashboard load and after sign-in/out actions. Shape mirrors the CLI's
  // "claude auth status --json" plus { available, engineConflicts, loginInProgress }.
  auth: { available: false, loggedIn: false, loading: true },
  authPollTimer: null,
};

// ---- Helpers ----
function esc(s) { if (!s) return ''; return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }
// Render the small markdown subset emitted by the security-review agent prompt.
// Returns { verdict, body }. verdict is 'PASSED' or 'CONCERNS' if found in the
// first non-empty line, else null. body is safe HTML — every text fragment is
// HTML-escaped before any inline marker (** or backticks) is rewritten to a tag.
function formatSecurityReview(raw) {
  var text = (raw == null ? '' : String(raw)).replace(/\\r\\n/g, '\\n').trim();
  if (!text) return { verdict: null, body: '' };
  var verdict = null;
  var lines = text.split('\\n');
  // First non-empty line: look for the verdict marker.
  for (var i = 0; i < lines.length; i++) {
    var trimmed = lines[i].trim();
    if (!trimmed) continue;
    var m = trimmed.match(/^\\**\\s*(PASSED|CONCERNS)\\s*\\**/i);
    if (m) {
      verdict = m[1].toUpperCase();
      // Strip the verdict token from that line so it doesn't repeat in the body.
      lines[i] = trimmed.replace(m[0], '').replace(/^[\\s\\-—:]+/, '');
    }
    break;
  }

  function renderInline(s) {
    // Escape first; then turn the markdown markers (which survive escaping)
    // into known-safe tags.
    var out = esc(s);
    // Inline code: \`x\` -> <code>x</code>
    out = out.replace(/\`([^\`]+)\`/g, '<code>$1</code>');
    // Bold: **x** -> <strong>x</strong>
    out = out.replace(/\\*\\*([^*]+)\\*\\*/g, '<strong>$1</strong>');
    return out;
  }

  var html = '';
  var inList = false;
  var inCode = false;
  var codeBuf = [];
  for (var j = 0; j < lines.length; j++) {
    var line = lines[j];
    // Fenced code block
    if (/^\\s*\`\`\`/.test(line)) {
      if (!inCode) { inCode = true; codeBuf = []; }
      else {
        inCode = false;
        html += '<pre class="sr-code">' + esc(codeBuf.join('\\n')) + '</pre>';
      }
      continue;
    }
    if (inCode) { codeBuf.push(line); continue; }

    var stripped = line.replace(/^\\s+/, '');
    // Heading
    var hm = stripped.match(/^(#{1,6})\\s+(.+)$/);
    if (hm) {
      if (inList) { html += '</ul>'; inList = false; }
      var level = Math.min(6, hm[1].length + 3); // h1 -> h4 visually
      html += '<h' + level + ' class="sr-h">' + renderInline(hm[2]) + '</h' + level + '>';
      continue;
    }
    // List item: -, *, or numbered "1."
    var lm = stripped.match(/^(?:[-*]|\\d+\\.)\\s+(.+)$/);
    if (lm) {
      if (!inList) { html += '<ul class="sr-list">'; inList = true; }
      html += '<li>' + renderInline(lm[1]) + '</li>';
      continue;
    }
    if (inList) { html += '</ul>'; inList = false; }
    if (!stripped) { html += ''; continue; }
    html += '<p class="sr-p">' + renderInline(line) + '</p>';
  }
  if (inList) html += '</ul>';
  if (inCode) html += '<pre class="sr-code">' + esc(codeBuf.join('\\n')) + '</pre>';
  return { verdict: verdict, body: html };
}
function $(id) { return document.getElementById(id); }
function qs(sel, el) { return (el||document).querySelector(sel); }
function qsa(sel, el) { return (el||document).querySelectorAll(sel); }
function formatDuration(ms) {
  if (!ms || ms < 0) return '0s';
  const s = Math.floor(ms/1000);
  if (s < 60) return s + 's';
  const m = Math.floor(s/60);
  const rs = s % 60;
  if (m < 60) return m + 'm ' + rs + 's';
  const h = Math.floor(m/60);
  return h + 'h ' + (m%60) + 'm';
}
function elapsedSince(iso) {
  if (!iso) return '';
  return formatDuration(Date.now() - new Date(iso).getTime());
}
function shortPath(p) {
  if (!p) return '';
  const parts = p.split('/');
  return parts.length > 2 ? '.../' + parts.slice(-2).join('/') : p;
}
function projectInitials(p) {
  if (!p) return '?';
  const name = p.split('/').filter(Boolean).pop() || '?';
  return name.substring(0,2).toUpperCase();
}
function phaseIndex(ph) {
  const map = { pre_work:0, work:1, handoff:2, review:3, done:4, pr_open:4, merged:4, errored:-1, cancelled:-1 };
  return map[ph] !== undefined ? map[ph] : -1;
}
function phaseLabel(ph) {
  const map = { pre_work:'scan', work:'build', handoff:'sweep', review:'review', done:'done',
    pr_open:'PR open', merged:'merged', errored:'error', cancelled:'cancelled' };
  return map[ph] || ph;
}
// Which agent the Steer button should target right now. Returns null when
// Steer isn't actually usable — the engine throws on sendMessage while a
// pipeline is running, and sessions are wiped when a team is cancelled or
// re-tasked, so Steer is only meaningful in the post-completion window.
//
// In that window, the agent the user almost always wants to follow up with
// is the one that did the final work: Reviewer-1 in a standard pipeline,
// Worker-1 in a simple one. Engine still routes to whatever session is
// open under that name (see sendMessage's targetInstance support).
function getSteerTarget(t) {
  if (!t) return null;
  if (t.currentPhase !== 'done') return null;
  return getTeamComplexity(t) === 'simple' ? 'Worker-1' : 'Reviewer-1';
}

function getTeamComplexity(t) {
  var explicit = (t && t.currentTask && t.currentTask.complexity) || (t && t.complexity) || null;
  if (explicit) return explicit;

  var entries = state.liveOutput[t && t.teamId] || [];
  var workerOutput = entries.some(function(e){ return e.agent === 'Worker-1'; });
  var nonWorkerOutput = entries.some(function(e){ return e.agent && e.agent !== 'Worker-1'; });
  if (workerOutput && !nonWorkerOutput) return 'simple';

  return null;
}
function getProgressModel(t) {
  var ph = t ? (t.currentPhase || 'pre_work') : 'pre_work';
  var simple = getTeamComplexity(t) === 'simple';
  var labels = simple ? ['build','done'] : ['scan','build','sweep','review','done'];
  var complete = ph === 'done' || ph === 'pr_open' || ph === 'merged';
  var idx = simple ? (complete ? labels.length - 1 : 0) : phaseIndex(ph);
  if (idx < 0) idx = 0;
  if (idx >= labels.length) idx = labels.length - 1;
  return { labels: labels, index: idx, complete: complete, simple: simple };
}
function feedbackNeedsAttention(fb) {
  return !!(fb && (fb.blocking || fb.type === 'warning' || fb.type === 'error' || fb.type === 'question'));
}
function teamNeedsAttention(teamId) {
  const fb = state.feedbacks[teamId];
  return !!(fb && fb.some(feedbackNeedsAttention));
}
function getEffectiveAgentState(t, instance) {
  var ph = t ? (t.currentPhase || 'pre_work') : 'pre_work';
  var complexity = getTeamComplexity(t);
  var ag = t && t.agents ? t.agents[instance] : null;
  var raw = ag ? ag.state : 'spawning';

  if (complexity === 'simple' && instance !== 'Worker-1') return 'skipped';

  if (ph === 'done' || ph === 'pr_open' || ph === 'merged') {
    if (raw !== 'errored') return 'done';
  }

  if (raw === 'spawning') return 'waiting';
  return raw || 'waiting';
}
function getAgentOutput(teamId, instance) {
  return (state.liveOutput[teamId] || [])
    .filter(function(e){ return e.agent === instance; })
    .map(function(e){ return e.text; })
    .join('\\n');
}
function getAgentSummaryText(t, instance, agState, output) {
  if (output) return output;

  var complexity = getTeamComplexity(t);
  if (complexity === 'simple' && instance !== 'Worker-1') {
    if (instance === 'Security-1') return 'Skipped: this was routed as a simple task, so no separate security scan or sweep was run.';
    if (instance === 'Worker-2') return 'Skipped: simple tasks run directly through Worker-1, so no independent verification pass was needed.';
    if (instance === 'Reviewer-1') return 'Skipped: simple tasks do not require a separate review pass before completion.';
  }

  if (agState === 'done') {
    if (instance === 'Security-1') return 'Completed security checks for the task. No blocking findings were reported.';
    if (instance === 'Worker-1') return 'Completed the implementation work for the assigned task.';
    if (instance === 'Worker-2') return 'Completed requirements verification for Worker-1 output.';
    if (instance === 'Reviewer-1') return 'Completed final review and approved the work.';
  }

  if (agState === 'active') {
    var ag = t && t.agents ? t.agents[instance] : null;
    return ag && ag.currentJob ? 'Working: ' + ag.currentJob : 'Working on the current phase.';
  }

  if (agState === 'waiting') return 'Waiting for its turn in the pipeline.';
  if (agState === 'skipped') return 'Skipped for this task route.';
  if (agState === 'errored') return 'Errored while running this phase.';
  return agState || 'No activity yet.';
}
function getCardStatusClass(ph, hasAttn, teamId) {
  if (hasAttn) return 'status-blocked';
  if (ph === 'errored' || ph === 'cancelled') return 'status-error';
  if (ph === 'pr_open') return 'status-pr';
  if (ph === 'done' || ph === 'merged') return 'status-done';
  if (ph === 'review') return 'status-review';
  return 'status-active';
}
function getCardStatusInfo(ph, hasAttn, teamId) {
  var t = state.teams[teamId];
  if (hasAttn) return { label: 'Needs Attention', style: 'background:rgba(218,54,51,.12);color:var(--red-light)' };
  if (ph === 'errored') return { label: 'Errored', style: 'background:rgba(218,54,51,.12);color:var(--red-light)' };
  if (ph === 'cancelled') return { label: 'Cancelled', style: 'background:rgba(72,79,88,.12);color:var(--text-muted)' };
  if (ph === 'pr_open') {
    var prNum = t && t.prNumber ? '#' + t.prNumber : '';
    return { label: 'PR ' + prNum + ' Open', style: 'background:rgba(163,113,247,.12);color:var(--purple)' };
  }
  if (ph === 'done') return { label: 'Done', style: 'background:rgba(63,185,80,.12);color:var(--green)' };
  if (ph === 'merged') return { label: 'Merged', style: 'background:rgba(63,185,80,.12);color:var(--green-light)' };
  if (ph === 'review') return { label: 'In Review', style: 'background:rgba(210,153,34,.12);color:var(--amber)' };
  if (ph === 'handoff') return { label: 'Sweeping', style: 'background:rgba(88,166,255,.12);color:var(--blue)' };
  if (ph === 'work') return { label: 'Building', style: 'background:rgba(88,166,255,.12);color:var(--blue)' };
  if (ph === 'pre_work') return { label: 'Scanning', style: 'background:rgba(88,166,255,.12);color:var(--blue)' };
  return { label: 'Active', style: 'background:rgba(88,166,255,.12);color:var(--blue)' };
}
function projectNeedsAttention(projPath) {
  const proj = state.projects[projPath];
  if (!proj) return 0;
  let count = 0;
  for (const tid of proj.teams) {
    if (teamNeedsAttention(tid)) count++;
  }
  return count;
}

// ---- Toast ----
function showToast(message, type) {
  type = type || 'success';
  const container = $('toastContainer');
  const t = document.createElement('div');
  t.className = 'toast toast-' + type;
  const icons = { success: '\\u2713', error: '\\u2717', info: '\\u2139' };
  t.innerHTML = '<span class="toast-icon">' + (icons[type]||'') + '</span><span>' + esc(message) + '</span>';
  container.appendChild(t);
  setTimeout(function() {
    t.classList.add('out');
    setTimeout(function() { t.remove(); }, 200);
  }, 3000);
}

// ---- Data Management ----
function addOrUpdateTeam(teamId, data) {
  const existing = state.teams[teamId];
  state.teams[teamId] = Object.assign(existing || {}, data, { teamId: teamId });
  const t = state.teams[teamId];
  const projPath = t.projectPath || 'Unknown';
  if (!state.projects[projPath]) {
    state.projects[projPath] = { name: projPath.split('/').filter(Boolean).pop() || projPath, teams: new Set(), inPortfolio: false };
  }
  state.projects[projPath].teams.add(teamId);
}

// Add a portfolio entry to local state (called from SSE init + after Add Project API call).
// Creates the project shell if absent, marks inPortfolio=true. Preserves existing teams.
function addPortfolioProject(p) {
  if (!p || !p.projectPath) return;
  if (!state.projects[p.projectPath]) {
    state.projects[p.projectPath] = {
      name: p.displayName || p.projectPath.split('/').filter(Boolean).pop() || p.projectPath,
      teams: new Set(),
      inPortfolio: true,
    };
  } else {
    state.projects[p.projectPath].inPortfolio = true;
    if (p.displayName) state.projects[p.projectPath].name = p.displayName;
  }
}

function getTeamPhaseCategory(team) {
  if (!team) return null;
  const ph = team.currentPhase;
  if (ph === 'errored' || ph === 'cancelled') return 'attention';
  if (ph === 'done' || ph === 'merged') return 'done';
  if (ph === 'pr_open') return 'pr';
  if (ph === 'review') return 'review';
  return 'active';
}

function isTerminalPhase(phase) {
  return phase === 'done' || phase === 'merged' || phase === 'cancelled' || phase === 'errored';
}

function getStats() {
  const stats = { active:0, review:0, done:0, pr:0, attention:0 };
  for (const tid in state.teams) {
    const cat = getTeamPhaseCategory(state.teams[tid]);
    if (cat === 'attention' || teamNeedsAttention(tid)) stats.attention++;
    if (cat === 'active') stats.active++;
    else if (cat === 'review') stats.review++;
    else if (cat === 'done') stats.done++;
    else if (cat === 'pr') stats.pr++;
  }
  return stats;
}

function getProjectStats(projPath) {
  const proj = state.projects[projPath];
  if (!proj) return { active:0, review:0, done:0, pr:0, attention:0 };
  const stats = { active:0, review:0, done:0, pr:0, attention:0 };
  for (const tid of proj.teams) {
    const t = state.teams[tid];
    const cat = getTeamPhaseCategory(t);
    if (cat === 'attention' || teamNeedsAttention(tid)) stats.attention++;
    if (cat === 'active') stats.active++;
    else if (cat === 'review') stats.review++;
    else if (cat === 'done') stats.done++;
    else if (cat === 'pr') stats.pr++;
  }
  return stats;
}

// Render the per-project Run / Open / Stop button cluster (Phase 4).
// Reads state.runners[projPath]; gracefully degrades to a Run button if no
// status is known yet.
function renderRunnerControls(projPath) {
  var r = state.runners[projPath];
  var st = r && r.state ? r.state : 'idle';
  var encPath = esc(projPath).replace(/'/g,"\\\\'");
  var run = '<button class="btn btn-sm btn-green" onclick="event.stopPropagation();window.__runner.run(\\'' + encPath + '\\')">Run</button>';
  var stop = '<button class="btn btn-sm btn-secondary" onclick="event.stopPropagation();window.__runner.stop(\\'' + encPath + '\\')">Stop</button>';
  if (st === 'starting') {
    var fwLabel = r && r.framework ? esc(r.framework) : 'dev server';
    return '<span class="mini-pill pill-active" onclick="event.stopPropagation()">Starting ' + fwLabel + '…</span>' + stop;
  }
  if (st === 'ready' && r && r.url) {
    var open = '<button class="btn btn-sm btn-green" onclick="event.stopPropagation();window.open(\\'' + esc(r.url) + '\\',\\'_blank\\')">Open</button>';
    var runningPill = '<span class="mini-pill pill-active" title="' + esc(r.url) + '" onclick="event.stopPropagation()">Running</span>';
    return runningPill + open + stop;
  }
  if (st === 'error') {
    var errPill = '<span class="mini-pill pill-error" onclick="event.stopPropagation();window.__runner.showError(\\'' + encPath + '\\')" style="cursor:pointer" title="Click for details">Run failed</span>';
    var retry = '<button class="btn btn-sm btn-secondary" onclick="event.stopPropagation();window.__runner.run(\\'' + encPath + '\\')">Try again</button>';
    return errPill + retry;
  }
  return run;
}

function filterTeams(teams, filter) {
  if (!filter) return teams;
  return teams.filter(function(tid) {
    var t = state.teams[tid];
    var cat = getTeamPhaseCategory(t);
    if (filter === 'attention') return cat === 'attention' || teamNeedsAttention(tid);
    return cat === filter;
  });
}

// ---- Render: Claude account auth pill ----
// Surfaces three states: connected (green w/ email + tier), not connected
// (red, click-to-sign-in), and env-var conflict (amber, ANTHROPIC_API_KEY etc.
// set in the shell — engine will refuse to start).
function renderAuthPill() {
  var a = state.auth || {};
  if (a.loading) {
    return '<span class="auth-pill auth-pill-loading" title="Checking Claude account status…">Checking auth…</span>';
  }
  if (a.engineConflicts && a.engineConflicts.length > 0) {
    var keyList = a.engineConflicts.join(', ');
    return '<button class="auth-pill auth-pill-conflict" title="' + esc(keyList) + ' is set in your environment. Unset it for subscription auth." onclick="window.__auth.openModal()">'
      + '<span class="auth-dot"></span>Env conflict</button>';
  }
  if (!a.available) {
    return '<button class="auth-pill auth-pill-error" title="The claude CLI was not found on PATH. Install Claude Code to enable agent runs." onclick="window.__auth.openModal()">'
      + '<span class="auth-dot"></span>CLI not found</button>';
  }
  if (a.loginInProgress) {
    return '<button class="auth-pill auth-pill-pending" title="Complete sign-in in your browser…" onclick="window.__auth.openModal()">'
      + '<span class="auth-dot"></span>Signing in…</button>';
  }
  if (a.loggedIn) {
    var label = a.email || 'Claude account';
    var tier = a.subscriptionType ? ' · ' + a.subscriptionType : '';
    return '<button class="auth-pill auth-pill-ok" title="Click to manage" onclick="window.__auth.openModal()">'
      + '<span class="auth-dot"></span>' + esc(label) + esc(tier) + '</button>';
  }
  return '<button class="auth-pill auth-pill-off" onclick="window.__auth.openModal()">'
    + '<span class="auth-dot"></span>Connect Claude account</button>';
}

// ---- Render: Nav Rail ----
function renderNavRail() {
  var projectsEl = $('navProjects');
  var html = '';
  var paths = Object.keys(state.projects).sort();
  for (var i = 0; i < paths.length; i++) {
    var p = paths[i];
    var proj = state.projects[p];
    var isActive = state.currentView === 'project' && state.currentProject === p;
    var attn = projectNeedsAttention(p);
    html += '<div class="nav-item' + (isActive ? ' active' : '') + '" data-project="' + esc(p) + '" title="' + esc(proj.name) + '\\n' + esc(p) + '" onclick="window.__nav.selectProject(this.dataset.project)">';
    html += projectInitials(p);
    if (attn > 0) html += '<span class="nav-badge">' + attn + '</span>';
    html += '</div>';
  }
  projectsEl.innerHTML = html;
}

// ---- Render: Stat Pills ----
function renderStatPills(containerId, stats, filterKey) {
  var el = $(containerId);
  if (!el) return;
  var current = filterKey === 'global' ? state.activeFilter : (state.projectFilter[filterKey] || null);
  var pills = [
    { key:'active', label:'Active', dot:'dot-active', count: stats.active },
    { key:'review', label:'Review', dot:'dot-review', count: stats.review },
    { key:'done', label:'Done', dot:'dot-done', count: stats.done },
  ];
  var pills2 = [
    { key:'pr', label:'PR Open', dot:'dot-pr', count: stats.pr },
    { key:'attention', label:'Need Attention', dot:'dot-attention', count: stats.attention },
  ];
  var html = '';
  for (var i = 0; i < pills.length; i++) {
    var p = pills[i];
    html += '<div class="stat-pill' + (current === p.key ? ' active' : '') + '" data-filter="' + p.key + '" data-filter-key="' + esc(filterKey) + '">';
    html += '<span class="dot ' + p.dot + '"></span>';
    html += '<span class="count">' + p.count + '</span> ' + p.label;
    html += '</div>';
  }
  html += '<div class="gap"></div>';
  for (var j = 0; j < pills2.length; j++) {
    var p2 = pills2[j];
    html += '<div class="stat-pill' + (current === p2.key ? ' active' : '') + '" data-filter="' + p2.key + '" data-filter-key="' + esc(filterKey) + '">';
    html += '<span class="dot ' + p2.dot + '"></span>';
    html += '<span class="count">' + p2.count + '</span> ' + p2.label;
    html += '</div>';
  }
  el.innerHTML = html;
  // attach click handlers
  qsa('.stat-pill', el).forEach(function(pill) {
    pill.addEventListener('click', function() {
      var fk = this.dataset.filterKey;
      var fv = this.dataset.filter;
      if (fk === 'global') {
        state.activeFilter = state.activeFilter === fv ? null : fv;
      } else {
        state.projectFilter[fk] = state.projectFilter[fk] === fv ? null : fv;
      }
      renderCurrentView();
    });
  });
}

// ---- Render: Team Card ----
function renderTeamCard(teamId, compact) {
  var t = state.teams[teamId];
  if (!t) return '';
  var ph = t.currentPhase || 'pre_work';
  var progress = getProgressModel(t);
  var hasAttn = teamNeedsAttention(teamId);

  if (compact) {
    var selected = state.selectedCompact === teamId;
    var html = '<div class="compact-card' + (selected ? ' selected' : '') + (hasAttn ? ' needs-attention' : '') + '" data-team="' + esc(teamId) + '" onclick="window.__nav.selectCompact(\\'' + esc(teamId).replace(/'/g,"\\\\'") + '\\')">';
    html += '<div class="compact-card-top"><span class="compact-card-name">' + esc(t.teamName || teamId) + '</span>';
    html += '<span class="compact-card-phase phase-' + ph + '">' + phaseLabel(ph) + '</span></div>';
    html += '<div class="compact-card-task">' + esc(t.currentTask ? (t.currentTask.description || t.currentTask).toString().substring(0,80) : 'No task') + '</div>';
    if (hasAttn) html += '<span class="card-attention-badge"></span>';
    html += '</div>';
    return html;
  }

  var statusCls = getCardStatusClass(ph, hasAttn, teamId);
  var html = '<div class="team-card ' + statusCls + (hasAttn ? ' needs-attention' : '') + '" data-team="' + esc(teamId) + '" data-status="' + statusCls.replace('status-','') + '" onclick="window.__nav.openPanel(\\'' + esc(teamId).replace(/'/g,"\\\\'") + '\\')">';
  if (hasAttn) html += '<span class="card-attention-badge"></span>';
  html += '<div class="card-top"><span class="card-name">' + esc(t.teamName || teamId) + '</span>';
  html += '<span class="card-phase-badge phase-' + ph + '">' + phaseLabel(ph) + '</span></div>';
  var taskText = t.currentTask ? (t.currentTask.description || t.currentTask).toString() : 'No task assigned';
  html += '<div class="card-task">' + esc(taskText) + '</div>';
  // Progress bar
  html += '<div class="card-progress"><div class="progress-bar">';
  var labels = progress.labels;
  for (var s = 0; s < labels.length; s++) {
    var cls = 'seg-future';
    if (ph === 'errored' || ph === 'cancelled') cls = s <= progress.index ? 'seg-error' : 'seg-future';
    else if (s < progress.index || progress.complete) cls = 'seg-done';
    else if (s === progress.index) cls = 'seg-active';
    html += '<div class="progress-segment ' + cls + '" title="' + labels[s] + '"></div>';
  }
  html += '</div>';
  // Phase labels
  html += '<div class="progress-labels">';
  for (var sl = 0; sl < labels.length; sl++) {
    var lblCls = '';
    if (ph === 'errored' || ph === 'cancelled') lblCls = sl <= progress.index ? 'lbl-error' : '';
    else if (sl < progress.index || progress.complete) lblCls = 'lbl-done';
    else if (sl === progress.index) lblCls = 'lbl-active';
    html += '<span class="progress-label ' + lblCls + '">' + labels[sl] + '</span>';
  }
  html += '</div></div>';
  // Status label + elapsed time footer
  var statusInfo = getCardStatusInfo(ph, hasAttn, teamId);
  html += '<div class="card-bottom">';
  html += '<span class="card-status-label" style="' + statusInfo.style + '">' + statusInfo.label + '</span>';
  html += '<span class="card-elapsed" data-created="' + (t.createdAt||'') + '">' + elapsedSince(t.createdAt) + '</span>';
  html += '</div></div>';
  return html;
}

// ---- Render: Dashboard View ----
function renderDashboardView() {
  var container = $('viewContainer');
  var stats = getStats();
  var rt = state.runtime || {};
  var runtimeLabel = rt.provider
    ? rt.provider + ' / ' + (rt.auth || 'subscription') + ' / ' + (rt.model || 'default')
    : 'runtime loading';
  // Sort: projects added this session float to the top so the new entry is
  // visible without scrolling; the rest stay alphabetical.
  var paths = Object.keys(state.projects).sort(function(a, b) {
    var aNew = state.recentlyAddedProjects.has(a) ? 0 : 1;
    var bNew = state.recentlyAddedProjects.has(b) ? 0 : 1;
    if (aNew !== bNew) return aNew - bNew;
    return a.localeCompare(b);
  });
  var hasProjects = paths.length > 0;
  var html = '<div class="dashboard-header"><div class="dashboard-heading-row"><h1>Portfolio</h1>';
  html += '<span class="runtime-pill">' + esc(runtimeLabel) + '</span>';
  html += renderAuthPill();
  // Hide the top-right + Add Project button when the empty state is showing
  // (the empty-state CTA below is the primary affordance in that case).
  if (hasProjects) {
    html += '<button class="btn btn-lg btn-primary" style="margin-left:auto" onclick="window.__modal.addProject()">+ Add Project</button>';
  }
  html += '</div>';
  html += '<p class="dashboard-subtitle">' + Object.keys(state.teams).length + ' teams across ' + Object.keys(state.projects).length + ' projects</p></div>';
  html += '<div class="stat-pills" id="globalStatPills"></div>';

  if (!hasProjects) {
    html += '<div class="empty-state"><div class="empty-state-icon">&#9654;</div>';
    html += '<h3>No projects yet</h3><p>Add a project to get started. Teams live inside projects.</p>';
    html += '<button class="btn btn-lg btn-primary" onclick="window.__modal.addProject()">+ Add Project</button></div>';
  }

  for (var i = 0; i < paths.length; i++) {
    var p = paths[i];
    var proj = state.projects[p];
    var teamIds = Array.from(proj.teams);
    var filtered = filterTeams(teamIds, state.activeFilter);
    html += '<div class="project-section">';
    html += '<div class="project-section-header" onclick="window.__nav.goToProject(\\'' + esc(p).replace(/'/g,"\\\\'") + '\\')">';
    html += '<div><h2>' + esc(proj.name) + '</h2>';
    html += '<span class="project-path-label">' + esc(shortPath(p)) + '</span>';
    html += '<span class="project-team-count">' + teamIds.length + ' team' + (teamIds.length!==1?'s':'') + '</span></div>';
    // Per-project stat pills + preview button (only if the project has UI artifacts)
    var pStats = getProjectStats(p);
    html += '<div class="project-stats">';
    if (pStats.attention > 0) html += '<span class="mini-pill pill-error">' + pStats.attention + ' errored</span>';
    if (pStats.active > 0) html += '<span class="mini-pill pill-active">' + pStats.active + ' active</span>';
    if (pStats.review > 0) html += '<span class="mini-pill pill-review">' + pStats.review + ' review</span>';
    if (pStats.pr > 0) html += '<span class="mini-pill pill-pr">' + pStats.pr + ' PR open</span>';
    if (pStats.done > 0) html += '<span class="mini-pill pill-done">' + pStats.done + ' done</span>';
    // Run / Open / Stop cluster (Phase 4: Run in Browser). The button state
    // mirrors state.runners[p].state. event.stopPropagation() everywhere so
    // clicks don't bubble to the section header and navigate away.
    html += renderRunnerControls(p);
    // "Clear done" button — terminal teams (done/merged/cancelled/errored).
    var doneCount = pStats.done + pStats.attention;
    if (doneCount > 0) {
      html += '<button class="btn btn-sm btn-secondary" onclick="event.stopPropagation();window.__modal.clearDoneTeams(\\'' + esc(p).replace(/'/g,"\\\\'") + '\\')">Clear done (' + doneCount + ')</button>';
    }
    // Per-project "+ Add Team" pre-fills the project in the create modal.
    // Always visible so zero-team projects (no empty-state card) still have
    // a one-click affordance from the dashboard.
    html += '<button class="btn btn-sm btn-outline" onclick="event.stopPropagation();window.__modal.createTeam(\\'' + esc(p).replace(/'/g,"\\\\'") + '\\')">+ Add Team</button>';
    // "Remove from portfolio" — only enabled when the project has zero teams.
    // Backend blocks the removal if teams exist anyway; the UI just keeps the
    // affordance hidden in the common case to reduce destructive-click anxiety.
    if (proj.inPortfolio && teamIds.length === 0) {
      html += '<button class="btn btn-sm btn-danger" onclick="event.stopPropagation();window.__modal.removeProject(\\'' + esc(p).replace(/'/g,"\\\\'") + '\\')">Remove from portfolio</button>';
    }
    html += '</div>';
    html += '</div>';
    html += '<div class="team-grid">';
    if (teamIds.length === 0) {
      if (state.recentlyAddedProjects.has(p)) {
        // Just-added project: prominent empty-state card to draw the eye and
        // make the next step obvious. Mirrors the global "No projects yet"
        // pattern.
        html += '<div style="grid-column:1/-1;padding:32px 24px;text-align:center;border:1px dashed var(--border);border-radius:8px">';
        html += '<h3 style="margin-bottom:6px;color:var(--text-primary)">No teams yet</h3>';
        html += '<p style="margin-bottom:14px;color:var(--text-secondary)">Add a team to start work on ' + esc(proj.name) + '. Each team runs the Security → Build → Sweep → Review pipeline independently.</p>';
        html += '<button class="btn btn-outline" onclick="window.__modal.createTeam(\\'' + esc(p).replace(/'/g,"\\\\'") + '\\')">+ Add Team</button>';
        html += '</div>';
      }
      // Otherwise: zero-team projects from prior sessions just show their
      // header. The header already has "+ Add Team" and "Remove from
      // portfolio" buttons; a big empty card per project would be noisy.
    } else {
      for (var j = 0; j < filtered.length; j++) {
        html += renderTeamCard(filtered[j], false);
      }
      if (filtered.length === 0) {
        html += '<div style="color:var(--text-muted);font-size:.8125rem;padding:8px">No teams match filter</div>';
      }
    }
    html += '</div></div>';
  }

  container.innerHTML = html;
  renderStatPills('globalStatPills', stats, 'global');
}

// ---- Render: Project Detail View ----
function renderProjectDetailView() {
  var container = $('viewContainer');
  var p = state.currentProject;
  var proj = state.projects[p];
  if (!proj) { renderDashboardView(); return; }

  var pStats = getProjectStats(p);
  var html = '<div class="project-detail-header">';
  html += '<button class="back-btn" onclick="window.__nav.goToDashboard()">&#8249;</button>';
  html += '<h1>' + esc(proj.name) + '</h1>';
  html += '<div style="margin-left:auto;display:flex;gap:6px;align-items:center">';
  html += renderRunnerControls(p);
  html += '<button class="btn btn-sm btn-outline" onclick="window.__modal.createTeam(\\'' + esc(p).replace(/'/g,"\\\\'") + '\\')">+ Add Team</button>';
  var doneCountDetail = pStats.done + pStats.attention;
  if (doneCountDetail > 0) {
    html += '<button class="btn btn-sm btn-secondary" onclick="window.__modal.clearDoneTeams(\\'' + esc(p).replace(/'/g,"\\\\'") + '\\')">Clear done (' + doneCountDetail + ')</button>';
  }
  html += '</div></div>';
  html += '<div class="project-detail-path">' + esc(p) + '</div>';
  html += '<div class="stat-pills" id="projectStatPills"></div>';

  var teamIds = Array.from(proj.teams);
  var filtered = filterTeams(teamIds, state.projectFilter[p] || null);

  // Auto-select first team if none selected (before rendering cards so selected state applies)
  if (!state.selectedCompact || !proj.teams.has(state.selectedCompact)) {
    if (filtered.length > 0) {
      state.selectedCompact = filtered[0];
    }
  }

  html += '<div class="compact-card-grid">';
  for (var j = 0; j < filtered.length; j++) {
    html += renderTeamCard(filtered[j], true);
  }
  if (filtered.length === 0) {
    html += '<div style="color:var(--text-muted);font-size:.8125rem;padding:8px">No teams match filter</div>';
  }
  html += '</div>';

  // Inline detail for selected compact card
  if (state.selectedCompact && proj.teams.has(state.selectedCompact)) {
    html += renderInlineDetail(state.selectedCompact);
  }

  container.innerHTML = html;
  renderStatPills('projectStatPills', pStats, p);
}

// ---- Render: Inline Detail ----
function renderInlineDetail(teamId) {
  var t = state.teams[teamId];
  if (!t) return '';
  var teamIdAttr = esc(teamId).replace(/'/g, "\\\\'");
  var html = '<div class="inline-detail">';
  html += '<div class="inline-detail-header">';
  html +=   '<h3>' + esc(t.teamName || teamId) + '</h3>';
  html +=   '<div class="sp-overflow-wrap inline-overflow-wrap">';
  html +=     '<button class="sp-icon-btn" id="inlineOverflowBtn-' + esc(teamId) + '" title="More actions" aria-label="Team actions" aria-haspopup="menu" aria-expanded="' + (state.panelUI.inlineOverflowTeamId === teamId ? 'true' : 'false') + '" onclick="window.__panel.toggleInlineOverflow(\\'' + teamIdAttr + '\\', event)">&#8942;</button>';
  html +=     renderInlineOverflowMenu(teamId);
  html +=   '</div>';
  html += '</div>';
  // Feedback blocks
  html += renderFeedbackBlocks(teamId);
  // Summary info
  html += renderSummaryContent(teamId);
  html += '</div>';
  return html;
}

// ---- Render: Feedback Blocks ----
function feedbackBlockClass(fb) {
  if (!fb) return 'feedback-info';
  if (fb.type === 'error') return 'feedback-error';
  if (fb.type === 'warning') return 'feedback-warning';
  if (fb.type === 'question' || fb.blocking) return 'feedback-question';
  return 'feedback-info';
}
function feedbackBlockIcon(fb) {
  if (!fb) return '&#9432;';
  if (fb.type === 'error') return '&#10007;';
  if (fb.type === 'warning' || fb.type === 'question' || fb.blocking) return '&#9888;';
  return '&#10003;';
}
// Locate a feedback object (and its team) by id across all teams. Lets the
// edit handlers take only the UUID feedback id, avoiding team-name interpolation
// in inline handlers.
function findFeedback(feedbackId) {
  for (var tid in state.feedbacks) {
    var arr = state.feedbacks[tid];
    if (!arr) continue;
    for (var i = 0; i < arr.length; i++) {
      if (arr[i].id === feedbackId) return { teamId: tid, fb: arr[i] };
    }
  }
  return null;
}

function renderFeedbackBlocks(teamId) {
  var fbs = state.feedbacks[teamId];
  if (!fbs || fbs.length === 0) return '';
  var html = '';
  for (var i = 0; i < fbs.length; i++) {
    var fb = fbs[i];
    var hasEditable = fb.editableContent != null;
    var editing = Object.prototype.hasOwnProperty.call(state.editingFeedback, fb.id);
    html += '<div class="feedback-block ' + feedbackBlockClass(fb) + '">';
    html += '<div class="feedback-block-title">' + feedbackBlockIcon(fb) + ' ' + esc(fb.title || 'Status') + '</div>';
    html += '<div class="feedback-block-msg">' + esc(fb.message) + '</div>';
    if (fb.detail) {
      html += '<div class="feedback-block-detail">' + esc(fb.detail) + '</div>';
    }
    // Editable body (e.g. the requirements checklist): read-only until the user
    // clicks Edit, then an inline textarea whose draft survives re-renders.
    if (hasEditable) {
      if (editing) {
        html += '<textarea id="fbedit-' + esc(fb.id) + '" class="feedback-edit-area" spellcheck="false" oninput="window.__api.updateFeedbackDraft(\\'' + esc(fb.id) + '\\', this.value)">' + esc(state.editingFeedback[fb.id]) + '</textarea>';
      } else {
        html += '<div class="feedback-block-editable">' + esc(fb.editableContent) + '</div>';
      }
    }
    html += '<div class="feedback-block-actions">';
    if (hasEditable && editing) {
      html += '<button class="btn btn-sm btn-primary" onclick="window.__api.submitFeedbackEdit(\\'' + esc(fb.id) + '\\')">Save &amp; Approve</button>';
      html += '<button class="btn btn-sm btn-ghost" onclick="window.__api.cancelFeedbackEdit(\\'' + esc(fb.id) + '\\')">Cancel</button>';
    } else if (fb.actions && fb.actions.length > 0) {
      for (var a = 0; a < fb.actions.length; a++) {
        var act = fb.actions[a];
        html += '<button class="btn btn-sm btn-primary" onclick="window.__api.respondFeedback(\\'' + esc(teamId) + '\\',\\'' + esc(fb.id) + '\\',\\'' + esc(act.value) + '\\')">' + esc(act.label) + '</button>';
      }
      if (hasEditable) {
        html += '<button class="btn btn-sm btn-secondary" onclick="window.__api.startFeedbackEdit(\\'' + esc(fb.id) + '\\')">Edit</button>';
      }
    } else {
      html += '<button class="btn btn-sm btn-primary" onclick="window.__api.respondFeedback(\\'' + esc(teamId) + '\\',\\'' + esc(fb.id) + '\\',\\'ok\\')">' + 'Acknowledge' + '</button>';
    }
    html += '</div></div>';
  }
  return html;
}

// ---- Render: Team Action Buttons ----
function renderTeamActionButtons(teamId) {
  var t = state.teams[teamId];
  if (!t) return '';
  var ph = t.currentPhase;
  var html = '';
  // Destructive actions (Terminate, Delete) live in the inline-detail ⋮ menu
  // alongside Rename/Duplicate/Archive — mirrors the side panel pattern and
  // keeps red buttons out of the inline action row.
  if (ph === 'done') {
    html += '<button class="btn btn-sm btn-secondary" onclick="window.__modal.securityReview(\\'' + esc(teamId) + '\\')">Security Review</button>';
  }
  if (ph === 'pr_open' && t.prUrl) {
    html += '<a href="' + esc(t.prUrl) + '" target="_blank" class="btn btn-sm btn-purple">View PR #' + (t.prNumber||'') + '</a>';
  }
  return html;
}

// ---- Render: Summary Content ----
function renderSummaryContent(teamId) {
  var t = state.teams[teamId];
  if (!t) return '';
  var ph = t.currentPhase || 'pre_work';
  var progress = getProgressModel(t);
  var panelTaskText = t.currentTask ? (t.currentTask.description || t.currentTask).toString() : '';
  var statusInfo = getCardStatusInfo(ph, teamNeedsAttention(teamId), teamId);
  var isDone = ph === 'done' || ph === 'merged';
  var isFailed = ph === 'errored' || ph === 'cancelled';
  var statusText = ph === 'done' ? 'All gates passed' :
    ph === 'errored' ? 'Pipeline errored in ' + phaseLabel(ph) + ' phase' :
    ph === 'pr_open' ? 'PR created — awaiting merge' :
    statusInfo.label;
  var statusColor = isDone ? 'var(--green)' : isFailed ? 'var(--red-light)' : 'var(--blue)';

  // Header: task description + elapsed, then a phase stepper. Replaces the
  // old "summary-status-top" + "Live tab stepper" — single consolidated view.
  var html = '<div class="live-header">';
  html += '<div class="live-task">' + esc(panelTaskText || 'No task assigned') + '</div>';
  html += '<div class="live-elapsed card-elapsed" data-created="' + (t.createdAt||'') + '">' + elapsedSince(t.createdAt) + '</div>';
  html += '</div>';

  // Phase bar with dots (lifted from the removed Live tab)
  html += '<div class="live-phase-bar">';
  var labels = progress.labels;
  for (var s = 0; s < labels.length; s++) {
    var dotCls = '';
    if (ph === 'errored' || ph === 'cancelled') dotCls = s <= progress.index ? 'fail' : '';
    else if (s < progress.index || progress.complete) dotCls = 'past';
    else if (s === progress.index) dotCls = 'current';
    html += '<div class="live-phase-step">';
    html += '<div class="live-dot ' + dotCls + '">' + (dotCls === 'past' ? '&#10003;' : dotCls === 'fail' ? '&#10007;' : (s + 1)) + '</div>';
    html += '<div class="live-dot-label ' + dotCls + '">' + labels[s] + '</div></div>';
    if (s < labels.length - 1) html += '<div class="live-connector ' + ((s < progress.index || progress.complete) ? 'past' : '') + '"></div>';
  }
  html += '</div>';

  // One-line status text under the stepper (e.g. "All gates passed")
  html += '<div class="summary-status-text" style="color:' + statusColor + ';margin:6px 0 16px;font-size:.875rem">' + statusText + '</div>';

  // Pipeline stats bar
  html += '<div class="pipeline-stats">';
  html += '<div class="pipeline-stat"><div class="pipeline-stat-value">' + elapsedSince(t.createdAt) + '</div><div class="pipeline-stat-label">Duration</div></div>';
  html += '<div class="pipeline-stat"><div class="pipeline-stat-value">' + (t.counters ? t.counters.revisions : 0) + '</div><div class="pipeline-stat-label">Revisions</div></div>';
  html += '<div class="pipeline-stat"><div class="pipeline-stat-value">' + (t.counters ? t.counters.rejections : 0) + '</div><div class="pipeline-stat-label">Rejections</div></div>';
  html += '</div>';

  // Expandable agent sections (2x2 grid)
  var agentInstances = ['Security-1','Worker-1','Worker-2','Reviewer-1'];
  var agentColors = { 'Security-1':'var(--red)', 'Worker-1':'var(--green)', 'Worker-2':'var(--green)', 'Reviewer-1':'var(--amber)' };
  html += '<div class="agent-sections-grid">';
  for (var a = 0; a < agentInstances.length; a++) {
    var inst = agentInstances[a];
    var agState = getEffectiveAgentState(t, inst);
    var agOutput = getAgentOutput(teamId, inst);
    var agSummary = getAgentSummaryText(t, inst, agState, agOutput);
    var verdict = getAgentVerdict(agOutput, inst, agState);
    var verdictStyle = getVerdictStyle(verdict);
    var dotColor = getAgentDotColor(verdict, agState, agentColors[inst]);

    var malformed = (state.malformedOutputs[teamId] || {})[inst];
    html += '<div class="agent-section" onclick="toggleAgentSection(this)">';
    html += '<div class="agent-section-header">';
    html += '<span class="agent-chevron">&#9654;</span>';
    html += '<span class="agent-dot-sm" style="background:' + dotColor + '"></span>';
    html += '<span class="agent-name">' + inst + '</span>';
    html += '<span class="agent-verdict" style="' + verdictStyle + '">' + esc(verdict) + '</span>';
    if (malformed && malformed.count > 0) {
      var mfTitle = 'Verdict parse failed ' + malformed.count + 'x — last: ' + (malformed.lastRaw || '').substring(0, 200);
      html += '<span class="mini-pill pill-error" title="' + esc(mfTitle) + '" style="margin-left:6px">malformed &times;' + malformed.count + '</span>';
    }
    html += '</div>';
    html += '<div class="agent-section-body">';
    html += '<pre class="agent-output">' + esc(agSummary) + '</pre>';
    html += '</div></div>';
  }
  html += '</div>';

  // Security review result
  if (state.securityResults[teamId]) {
    html += '<div class="security-result-section"><h4>Security Review</h4>';
    html += '<pre class="security-result">' + esc(state.securityResults[teamId]) + '</pre></div>';
  }

  // Action buttons at bottom
  html += '<div class="summary-actions" style="margin-top:16px">' + renderTeamActionButtons(teamId) + '</div>';

  return html;
}

// Verdict label for the per-agent card. Trust agState as the primary
// signal — output is only used to refine the DONE state into the specific
// verdict the agent emitted (APPROVED / REVISION_NEEDED / REJECTED / N/M met /
// BLOCKED / SKIPPED / Complete). Previously this function returned 'ACTIVE'
// for any agent that had ever produced output, which made finished agents
// look like they were still running.
function getAgentVerdict(output, instance, agState) {
  if (agState === 'skipped')  return 'SKIPPED';
  if (agState === 'errored')  return 'ERRORED';
  if (agState === 'blocked')  return 'BLOCKED';
  if (agState === 'spawning') return 'SPAWNING';
  if (agState === 'active' || agState === 'working') return 'ACTIVE';
  if (agState === 'done') {
    if (output) {
      if (output.match(/APPROVED/i))         return 'APPROVED';
      if (output.match(/REVISION.NEEDED/i))  return 'REVISION_NEEDED';
      if (output.match(/REJECTED/i))         return 'REJECTED';
      var metMatch = output.match(new RegExp('\\\\d+/\\\\d+\\\\s*met','i'));
      if (metMatch)                          return metMatch[0];
      if (output.match(/BLOCKED/i))          return 'BLOCKED';
      if (output.match(/SKIPPED/i))          return 'SKIPPED';
      if (output.match(/COMPLETE/i))         return 'Complete';
    }
    return 'Complete';
  }
  // 'idle' / 'waiting' / anything unknown
  return 'WAITING';
}

function getVerdictStyle(verdict) {
  if (verdict === 'APPROVED' || verdict === 'Complete' || verdict.includes('met')) return 'background:rgba(63,185,80,.12);color:var(--green)';
  if (verdict === 'ACTIVE') return 'background:rgba(56,139,253,.15);color:var(--blue)';
  if (verdict === 'SPAWNING') return 'background:rgba(72,79,88,.12);color:var(--text-muted)';
  if (verdict === 'SKIPPED' || verdict === 'WAITING') return 'background:rgba(72,79,88,.12);color:var(--text-muted)';
  if (verdict === 'ERRORED' || verdict === 'BLOCKED' || verdict === 'REJECTED') return 'background:rgba(218,54,51,.12);color:var(--red-light)';
  return 'background:rgba(210,153,34,.12);color:var(--amber)';
}

function getAgentDotColor(verdict, agState, activeColor) {
  if (verdict === 'APPROVED' || verdict === 'Complete' || verdict.includes('met')) return 'var(--green)';
  if (verdict === 'ERRORED' || verdict === 'BLOCKED' || verdict === 'REJECTED') return 'var(--red)';
  if (verdict === 'ACTIVE' || agState === 'active') return activeColor || 'var(--blue)';
  if (verdict === 'SKIPPED' || verdict === 'WAITING' || agState === 'skipped') return 'var(--border)';
  return 'var(--amber)';
}

window.toggleAgentSection = function(el) {
  el.classList.toggle('expanded');
};

// ---- Render: Panel (4 regions: Header / Agents / Chat / Composer) ----
// See docs/side-panel-redesign.md.
function renderPanel() {
  var overlay = $('panelOverlay');
  var panel = $('slidePanel');
  if (!state.panelOpen || !state.panelTeamId) {
    overlay.classList.remove('open');
    panel.classList.remove('open');
    return;
  }
  overlay.classList.add('open');
  panel.classList.add('open');

  var teamId = state.panelTeamId;
  // Preserve scroll position across re-renders (innerHTML resets scrollTop to 0).
  // Callers that want a different position set state.panelUI._scrollIntent.
  var prevThread = $('panelChatThread');
  var prevScroll = prevThread ? prevThread.scrollTop : null;
  // Preserve focus + caret in an in-progress requirements edit: an SSE-driven
  // innerHTML swap destroys the live <textarea>, dropping focus and the caret
  // mid-word. Capture the active edit field's id and selection, restore below.
  var activeEl = document.activeElement;
  var focusRestore = null;
  if (activeEl && activeEl.classList && activeEl.classList.contains('feedback-edit-area')) {
    focusRestore = {
      id: activeEl.id,
      start: activeEl.selectionStart,
      end: activeEl.selectionEnd,
    };
  }
  $('panelHeader').innerHTML = renderPanelHeader(teamId);
  $('panelAgents').innerHTML = renderPanelAgents(teamId);
  $('panelAgents').setAttribute('data-collapsed', state.panelUI.agentsCollapsed ? 'true' : 'false');
  $('panelChatSubheader').innerHTML = renderPanelChatSubheader();
  $('panelChatThread').innerHTML = renderPanelChatThread(teamId);
  $('panelComposer').innerHTML = renderPanelComposer(teamId);
  setTimeout(function() {
    var thread = $('panelChatThread');
    if (thread) {
      if (state.panelUI._scrollIntent === 'bottom') {
        thread.scrollTop = thread.scrollHeight;
      } else if (state.panelUI._scrollIntent === 'top') {
        thread.scrollTop = 0;
      } else if (prevScroll !== null) {
        thread.scrollTop = prevScroll;
      }
      state.panelUI._scrollIntent = null;
    }
    // Restore focus + caret into the re-rendered requirements-edit textarea.
    if (focusRestore && focusRestore.id) {
      var edit = document.getElementById(focusRestore.id);
      if (edit) {
        edit.focus();
        try {
          edit.setSelectionRange(focusRestore.start, focusRestore.end);
        } catch (e) {
          /* selection may be out of range after an external edit — ignore */
        }
      }
    }
    // Wire Enter-to-send on the composer textarea. Shift+Enter still inserts a
    // newline. Skip while an IME composition is active so CJK input isn't sent
    // mid-composition.
    var ta = $('chatInput-' + teamId);
    if (ta && !ta.dataset.kbBound) {
      ta.addEventListener('keydown', function(ev) {
        if (ev.key === 'Enter' && !ev.shiftKey && !ev.isComposing) {
          ev.preventDefault();
          window.__api.sendChat(null, teamId);
        }
      });
      ta.dataset.kbBound = '1';
    }
  }, 0);
}

// ---- Render: Panel Header ----
function renderPanelHeader(teamId) {
  var t = state.teams[teamId];
  var teamName = t ? (t.teamName || teamId) : teamId;
  var ph = t ? (t.currentPhase || 'pre_work') : 'pre_work';
  var statusInfo = getCardStatusInfo(ph, teamNeedsAttention(teamId), teamId);
  var statusTone = getStatusTone(ph, teamNeedsAttention(teamId));
  var progress = getProgressModel(t);

  var projectPath = t && t.projectPath ? t.projectPath : '';
  var projectName = projectPath && state.projects[projectPath] ? state.projects[projectPath].name : projectPath;
  var crumbParts = [];
  if (projectName) crumbParts.push(esc(projectName));
  crumbParts.push(esc(teamName));
  var breadcrumb = crumbParts.join(' <span style="color:var(--text-muted)">/</span> ');

  var elapsed = t && t.createdAt ? elapsedSince(t.createdAt) : '';
  var revisions = t && t.counters ? t.counters.revisions : 0;
  var rejections = t && t.counters ? t.counters.rejections : 0;
  var teamIdAttr = esc(teamId).replace(/'/g, "\\\\'");

  var html = '';
  html += '<div class="sp-header-top">';
  html +=   '<div class="sp-header-title" title="' + esc(teamName) + '">' + esc(teamName) + '</div>';
  html +=   '<div class="sp-overflow-wrap">';
  html +=     '<button class="sp-icon-btn" id="panelOverflowBtn" title="More actions" aria-label="Team actions" aria-haspopup="menu" aria-expanded="' + (state.panelUI.overflowOpen ? 'true' : 'false') + '" onclick="window.__panel.toggleOverflow(event)">&#8942;</button>';
  html +=     renderOverflowMenu(teamId);
  html +=   '</div>';
  html +=   '<button class="sp-icon-btn" aria-label="Close panel" onclick="window.__nav.closePanel()">&#10005;</button>';
  html += '</div>';
  if (breadcrumb) html += '<div class="sp-breadcrumb">' + breadcrumb + '</div>';
  html += '<div class="sp-status-row">';
  html +=   '<span class="sp-status-pill" data-tone="' + statusTone + '" aria-label="Status: ' + esc(statusInfo.label) + '"><span class="sp-status-dot" aria-hidden="true"></span>' + esc(statusInfo.label) + '</span>';
  html +=   '<div class="sp-progress" role="progressbar" aria-label="Pipeline progress" aria-valuemin="0" aria-valuemax="' + progress.labels.length + '" aria-valuenow="' + (progress.complete ? progress.labels.length : progress.index) + '">';
  var failure = ph === 'errored' || ph === 'cancelled';
  for (var s = 0; s < progress.labels.length; s++) {
    var cls = '';
    if (failure) cls = s <= progress.index ? 'fail' : '';
    else if (s < progress.index || progress.complete) cls = 'past';
    else if (s === progress.index) cls = 'current';
    html += '<span class="sp-progress-tick ' + cls + '" title="' + esc(progress.labels[s]) + '"></span>';
  }
  html +=   '</div>';
  html +=   '<span class="sp-progress-label">' + esc(elapsed) + '</span>';
  html += '</div>';
  html += '<div class="sp-stats-row">';
  html +=   '<span><b>' + revisions + '</b> revisions</span>';
  html +=   '<span><b>' + rejections + '</b> rejections</span>';
  html += '</div>';
  if (ph === 'cancelled') {
    html += '<div class="sp-cancelled-note">Cancelled teams can be deleted or kept as a record, but not restarted. To run the task again, create a new team.</div>';
  }
  return html;
}

function getStatusTone(ph, hasAttn) {
  if (hasAttn) return 'blocked';
  if (ph === 'errored' || ph === 'cancelled') return 'blocked';
  if (ph === 'pr_open') return 'pr';
  if (ph === 'done' || ph === 'merged') return 'done';
  if (ph === 'review') return 'review';
  if (ph === 'pre_work' || ph === 'work' || ph === 'handoff') return 'active';
  return 'muted';
}

function renderOverflowMenu(teamId) {
  if (!state.panelUI.overflowOpen) return '';
  return overflowMenuMarkup(teamId, 'panel');
}

function renderInlineOverflowMenu(teamId) {
  if (state.panelUI.inlineOverflowTeamId !== teamId) return '';
  return overflowMenuMarkup(teamId, 'inline');
}

// Markup shared by the side-panel ⋮ and the inline-detail ⋮ menus. Both
// expose the same items (Rename/Duplicate/Archive disabled, Terminate, Delete)
// so destructive actions stay in one consistent place across surfaces.
function overflowMenuMarkup(teamId, context) {
  var teamIdAttr = esc(teamId).replace(/'/g, "\\\\'");
  var t = state.teams[teamId];
  var ph = t ? t.currentPhase : 'pre_work';
  var canDelete = ph === 'done' || ph === 'merged' || ph === 'cancelled' || ph === 'errored';
  var canTerminate = !canDelete && ph !== 'pr_open';
  var menuId = context === 'inline' ? 'inlineOverflowMenu-' + esc(teamId) : 'panelOverflowMenu';
  var html = '<div class="sp-overflow-menu" role="menu" data-open="true" id="' + menuId + '" onkeydown="window.__panel.overflowKeydown(event)">';
  html +=   '<button class="sp-overflow-item" role="menuitem" disabled title="Renaming is not yet supported.">Rename</button>';
  html +=   '<button class="sp-overflow-item" role="menuitem" disabled title="Duplicating is not yet supported.">Duplicate</button>';
  html +=   '<button class="sp-overflow-item" role="menuitem" disabled title="Archiving is not yet supported.">Archive</button>';
  html +=   '<div class="sp-overflow-divider" role="separator"></div>';
  if (canTerminate) {
    html += '<button class="sp-overflow-item" role="menuitem" data-danger="true" onclick="window.__panel.terminateFromMenu(\\'' + teamIdAttr + '\\',\\'' + context + '\\')">Terminate team</button>';
  }
  html +=   '<button class="sp-overflow-item" role="menuitem" data-danger="true"' + (canDelete ? '' : ' disabled title="Available once the team is done, cancelled, or errored."') + ' onclick="window.__panel.openConfirmDelete(\\'' + teamIdAttr + '\\',\\'' + context + '\\')">Delete team</button>';
  html += '</div>';
  return html;
}

// ---- Render: Agents Region ----
function renderPanelAgents(teamId) {
  var t = state.teams[teamId];
  var agentInstances = ['Security-1','Worker-1','Worker-2','Reviewer-1'];
  var agentColors = { 'Security-1':'var(--red)', 'Worker-1':'var(--green)', 'Worker-2':'var(--green)', 'Reviewer-1':'var(--amber)' };

  var html = '';
  html += '<button class="sp-section-header" type="button" aria-expanded="' + (state.panelUI.agentsCollapsed ? 'false' : 'true') + '" aria-controls="panelAgentsList" onclick="window.__panel.toggleAgents()">';
  html +=   '<span class="sp-section-label">Agents (' + agentInstances.length + ')</span>';
  html +=   '<span class="sp-section-chevron" aria-hidden="true">&#9654;</span>';
  html += '</button>';
  html += '<div class="sp-agents-list" id="panelAgentsList">';

  for (var a = 0; a < agentInstances.length; a++) {
    var inst = agentInstances[a];
    var agState = getEffectiveAgentState(t, inst);
    var agOutput = getAgentOutput(teamId, inst);
    var agSummary = getAgentSummaryText(t, inst, agState, agOutput);
    var verdict = getAgentVerdict(agOutput, inst, agState);
    var verdictStyle = getVerdictStyle(verdict);
    var dotColor = getAgentDotColor(verdict, agState, agentColors[inst]);
    var expanded = !!state.panelUI.expandedAgents[inst];
    var instAttr = esc(inst).replace(/'/g, "\\\\'");

    html += '<div class="sp-agent-row" data-expanded="' + (expanded ? 'true' : 'false') + '">';
    html +=   '<button class="sp-agent-row-head" type="button" aria-expanded="' + (expanded ? 'true' : 'false') + '" onclick="window.__panel.toggleAgentRow(\\'' + instAttr + '\\')">';
    html +=     '<span class="sp-agent-row-chevron" aria-hidden="true">&#9654;</span>';
    html +=     '<span class="sp-agent-dot" style="background:' + dotColor + '" aria-hidden="true"></span>';
    html +=     '<span class="sp-agent-name">' + esc(inst) + '</span>';
    html +=     '<span class="sp-agent-verdict" style="' + verdictStyle + '" aria-label="Verdict: ' + esc(verdict) + '">' + esc(verdict) + '</span>';
    html +=   '</button>';
    html +=   '<div class="sp-agent-row-body">' + esc(agSummary) + '</div>';
    html += '</div>';
  }
  html += '</div>';

  // Latest ad-hoc Security Review result (when the user runs one from the
  // action row below). Result lands here via the SSE 'security-review' event.
  if (state.securityResults[teamId]) {
    var collapsed = !!state.panelUI.securityResultCollapsed[teamId];
    var teamIdAttr = esc(teamId).replace(/'/g, "\\\\'");
    var formatted = formatSecurityReview(state.securityResults[teamId]);
    html += '<div class="security-result-section" data-collapsed="' + (collapsed ? 'true' : 'false') + '">';
    html +=   '<div class="security-result-head">';
    html +=     '<h4>Security Review</h4>';
    if (formatted.verdict) {
      var vTone = formatted.verdict === 'PASSED' ? 'done' : 'blocked';
      html +=   '<span class="sp-status-pill" data-tone="' + vTone + '" style="margin-left:8px"><span class="sp-status-dot" aria-hidden="true"></span>' + esc(formatted.verdict) + '</span>';
    }
    html +=     '<div class="security-result-actions">';
    html +=       '<button class="sp-pinned-btn" type="button" aria-label="' + (collapsed ? 'Expand' : 'Collapse') + ' security review" onclick="window.__panel.toggleSecurityResult(\\'' + teamIdAttr + '\\')">' + (collapsed ? '&#9660;' : '&#9650;') + '</button>';
    html +=       '<button class="sp-pinned-btn" type="button" aria-label="Clear security review" title="Clear" onclick="window.__panel.clearSecurityResult(\\'' + teamIdAttr + '\\')">&#10005;</button>';
    html +=     '</div>';
    html +=   '</div>';
    if (!collapsed) {
      html += '<div class="security-result">' + formatted.body + '</div>';
    }
    html += '</div>';
  }

  // Inline feedback prompts + per-phase operational actions (Create PR,
  // Security Review). Destructive actions (Terminate / Delete) live in the ⋮ menu.
  html += renderFeedbackBlocks(teamId);
  var actionHtml = renderPanelActionButtons(teamId);
  if (actionHtml) {
    html += '<div class="sp-agents-actions">' + actionHtml + '</div>';
  }
  return html;
}

// Same logic as the old renderTeamActionButtons but without the destructive
// buttons — those moved into the ⋮ overflow menu. Steer is currently omitted
// because the engine can't deliver a side message while the pipeline is
// running, and the post-completion window where it works is confusing.
function renderPanelActionButtons(teamId) {
  var t = state.teams[teamId];
  if (!t) return '';
  var ph = t.currentPhase;
  var html = '';
  if (ph === 'done') {
    html += '<button class="btn btn-sm btn-secondary" onclick="window.__modal.securityReview(\\'' + esc(teamId) + '\\')">Security Review</button>';
  }
  if (ph === 'pr_open' && t.prUrl) {
    html += '<a href="' + esc(t.prUrl) + '" target="_blank" class="btn btn-sm btn-purple">View PR #' + (t.prNumber||'') + '</a>';
  }
  return html;
}

// ---- Render: Chat sub-header ----
function renderPanelChatSubheader() {
  return '<span class="sp-section-label">Chat with Coordinator</span>';
}

// ---- Render: Chat thread (pinned task card + messages + day dividers) ----
function renderPanelChatThread(teamId) {
  var team = state.teams[teamId];
  var messages = state.chatMessages[teamId] || [];
  var pending = !!state.chatPending[teamId];
  var html = '';

  // Pinned "Original Task" card — first child of the thread.
  html += renderPinnedTaskCard(teamId, team);

  if (messages.length === 0 && !pending) {
    html += '<div class="sp-thread-empty">';
    html +=   'No messages yet. Your original task is pinned above.<br>';
    html +=   'Try asking the coordinator about scope, agents, or timeline.';
    html += '</div>';
    return html;
  }

  var lastDay = null;
  for (var i = 0; i < messages.length; i++) {
    var m = messages[i];
    var day = dayKey(m.timestamp);
    if (day !== lastDay) {
      html += '<div class="sp-day-divider" role="separator">' + esc(dayLabel(m.timestamp)) + '</div>';
      lastDay = day;
    }
    html += renderMessageBubble(m);
  }
  if (pending) {
    html += '<div class="sp-msg is-coordinator">';
    html +=   '<div class="sp-msg-meta"><span class="sp-msg-author">Coordinator</span><span>thinking…</span></div>';
    html +=   '<div class="sp-msg-bubble" style="opacity:.7;font-style:italic">Coordinator is thinking…</div>';
    html += '</div>';
  }
  return html;
}

function renderPinnedTaskCard(teamId, team) {
  var taskText = team && team.currentTask ? (team.currentTask.description || team.currentTask).toString() : '';
  if (!taskText) return '';

  var html = '<div class="sp-pinned-card" role="region" aria-label="Original task">';
  html +=   '<div class="sp-pinned-head">';
  html +=     '<span class="sp-pinned-icon" aria-hidden="true">&#128204;</span>';
  html +=     '<span class="sp-pinned-label">Original task</span>';
  html +=     '<div class="sp-pinned-actions">';
  html +=       '<button class="sp-pinned-btn" type="button" aria-label="' + (state.panelUI.pinnedTaskExpanded ? 'Collapse' : 'Expand') + ' original task" onclick="window.__panel.togglePinnedTask()">' + (state.panelUI.pinnedTaskExpanded ? '&#9650;' : '&#9660;') + '</button>';
  html +=     '</div>';
  html +=   '</div>';
  html +=   '<div class="sp-pinned-body" data-collapsed="' + (state.panelUI.pinnedTaskExpanded ? 'false' : 'true') + '">' + esc(taskText) + '</div>';
  if (!state.panelUI.pinnedTaskExpanded && (taskText.split(/\\n/).length > 3 || taskText.length > 220)) {
    html += '<button class="sp-pinned-expand" type="button" onclick="window.__panel.togglePinnedTask()">Expand</button>';
  } else if (state.panelUI.pinnedTaskExpanded) {
    html += '<button class="sp-pinned-expand" type="button" onclick="window.__panel.togglePinnedTask()">Collapse</button>';
  }
  html += '</div>';
  return html;
}

function renderMessageBubble(m) {
  var role = m.role === 'user' ? 'user' : (m.role === 'system' ? 'system' : 'coordinator');
  var author = role === 'user' ? 'You' : (role === 'system' ? 'System' : 'Coordinator');
  var time = formatTime(m.timestamp);
  var verdictPill = (role === 'coordinator' && m.verdict)
    ? '<span class="sp-msg-verdict">' + esc(m.verdict) + '</span>'
    : '';
  var content = m.content || '';
  // Match the pinned-card threshold: long messages render collapsed by default
  // so the thread stays scannable. Each message remembers its own expanded
  // state across re-renders, keyed by timestamp.
  var isLong = content.split(/\\n/).length > 3 || content.length > 220;
  var key = m.timestamp || '';
  var expanded = !!state.panelUI.expandedMessages[key];
  var collapsedAttr = (isLong && !expanded) ? ' data-collapsed="true"' : '';
  var keyAttr = esc(key).replace(/'/g, "\\\\'");

  var html = '<div class="sp-msg is-' + role + '">';
  html +=   '<div class="sp-msg-meta">' + verdictPill + '<span class="sp-msg-author">' + esc(author) + '</span>' + (time ? '<span>' + esc(time) + '</span>' : '') + '</div>';
  html +=   '<div class="sp-msg-bubble"' + collapsedAttr + '>' + esc(content) + '</div>';
  if (isLong) {
    html += '<button class="sp-msg-toggle" type="button" onclick="window.__panel.toggleMessage(\\'' + keyAttr + '\\')">' + (expanded ? 'Collapse' : 'Expand') + '</button>';
  }
  html += '</div>';
  return html;
}

function dayKey(iso) {
  if (!iso) return '__none__';
  var d = new Date(iso);
  if (isNaN(d.getTime())) return '__none__';
  return d.getFullYear() + '-' + (d.getMonth()+1) + '-' + d.getDate();
}
function dayLabel(iso) {
  if (!iso) return 'Today';
  var d = new Date(iso);
  if (isNaN(d.getTime())) return 'Today';
  var now = new Date();
  var sameDay = d.toDateString() === now.toDateString();
  if (sameDay) return 'Today';
  var yest = new Date(now.getTime() - 86400000);
  if (d.toDateString() === yest.toDateString()) return 'Yesterday';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
function formatTime(iso) {
  if (!iso) return '';
  var d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

// ---- Render: Composer ----
function renderPanelComposer(teamId) {
  var pending = !!state.chatPending[teamId];
  var teamIdAttr = esc(teamId).replace(/'/g, "\\\\'");
  var html = '';
  html += '<form class="sp-composer-form" onsubmit="window.__api.sendChat(event, \\'' + teamIdAttr + '\\')">';
  html +=   '<div class="sp-composer-box">';
  html +=     '<textarea id="chatInput-' + esc(teamId) + '" rows="2" aria-label="Message to Coordinator" placeholder="Type a message — e.g. \\'Why did Worker-2 flag X?\\'"' + (pending ? ' disabled' : '') + '></textarea>';
  html +=     '<div class="sp-composer-actions">';
  if (pending) {
    html +=     '<button type="button" class="sp-composer-cancel" aria-label="Cancel coordinator turn" onclick="window.__api.cancelChat(\\'' + teamIdAttr + '\\')">Cancel</button>';
  } else {
    html +=     '<span class="sp-composer-hint" aria-hidden="true">&crarr;</span>';
    html +=     '<button type="submit" class="sp-composer-send" aria-label="Send message">Send</button>';
  }
  html +=     '</div>';
  html +=   '</div>';
  html += '</form>';
  html += '<div class="sp-composer-affordances" aria-hidden="true">';
  html +=   '<span>Replying to Coordinator</span>';
  html +=   '<span><code>&crarr;</code> send</span>';
  html +=   '<span><code>Shift+&crarr;</code> newline</span>';
  html += '</div>';
  return html;
}

// ---- Render: Current View ----
function renderCurrentView() {
  if (state.currentView === 'project') {
    renderProjectDetailView();
  } else {
    renderDashboardView();
  }
  renderNavRail();
  renderPanel();
}

// ---- Code tab (code-server iframe) ----
async function ensureCodeServerStarted() {
  // Idempotent: returns immediately if already 'ready'. Otherwise POST start
  // which lazy-spawns code-server and resolves once /healthz responds.
  if (state.codeServer.state === 'ready') return state.codeServer;
  try {
    const res = await fetch('/api/code-server/start', { method: 'POST' });
    state.codeServer = await res.json();
  } catch (err) {
    state.codeServer = { state: 'error', error: String(err) };
  }
  return state.codeServer;
}
function refreshCodeFrame() {
  const frame = document.getElementById('codeFrame');
  const empty = document.getElementById('codeEmpty');
  const emptyMsg = document.getElementById('codeEmptyMsg');
  if (!frame || !empty || !emptyMsg) return;

  // 1) code-server unavailable — show install hint
  if (state.codeServer.state === 'unavailable') {
    frame.style.display = 'none';
    empty.style.display = 'flex';
    emptyMsg.innerHTML = 'code-server is not installed. Install it with <code>' +
      esc(state.codeServer.installCommand || 'brew install code-server') +
      '</code> and reload.';
    return;
  }
  // 2) starting — loading message
  if (state.codeServer.state === 'starting') {
    frame.style.display = 'none';
    empty.style.display = 'flex';
    emptyMsg.textContent = 'Starting code-server (first launch can take a few seconds)…';
    return;
  }
  // 3) error — surface message
  if (state.codeServer.state === 'error') {
    frame.style.display = 'none';
    empty.style.display = 'flex';
    emptyMsg.textContent = 'Could not start code-server: ' + (state.codeServer.error || 'unknown error');
    return;
  }
  // 4) ready but no project selected — prompt to pick one
  if (!state.currentProject) {
    frame.style.display = 'none';
    empty.style.display = 'flex';
    emptyMsg.textContent = 'Select a project from the sidebar to open it in the embedded editor.';
    return;
  }
  // 5) ready + project selected — point iframe at folder
  const url = 'http://localhost:' + state.codeServer.port + '/?folder=' + encodeURIComponent(state.currentProject);
  const overlay = document.getElementById('codeFrameOverlay');
  if (frame.src !== url) {
    // Show overlay BEFORE swapping src so the user never sees code-server's
    // white bootstrap HTML. Fade it out once the iframe has loaded AND the
    // workbench has had a moment to paint the dark theme.
    if (overlay) {
      overlay.hidden = false;
      overlay.classList.remove('fade-out');
    }
    frame.onload = function() {
      // VS Code keeps async-loading after the load event; give the theme
      // ~500ms to settle before starting the fade.
      setTimeout(function() {
        if (overlay) overlay.classList.add('fade-out');
        // Remove from the DOM flow after the transition completes so it
        // doesn't sit on top of the iframe forever.
        setTimeout(function() { if (overlay) overlay.hidden = true; }, 250);
      }, 500);
    };
    frame.src = url;
  }
  empty.style.display = 'none';
  frame.style.display = 'block';
}

// ---- Claude account auth ----
// Drives the dashboard's "Connect your Claude account" flow. Talks to
// /api/auth/{status,login,login/cancel,logout}. No tokens stored client-side;
// the official CLI owns the credentials.
window.__auth = {
  fetchStatus: function() {
    return fetch('/api/auth/status')
      .then(function(r) { return r.json(); })
      .then(function(data) {
        state.auth = Object.assign({}, data, { loading: false });
        renderCurrentView();
        // If a login is in flight, keep polling so we flip to "connected"
        // as soon as the OAuth callback completes.
        if (state.auth.loginInProgress) {
          if (!state.authPollTimer) {
            state.authPollTimer = setInterval(window.__auth.fetchStatus, 2000);
          }
        } else if (state.authPollTimer) {
          clearInterval(state.authPollTimer);
          state.authPollTimer = null;
        }
        // Refresh the modal body too, if it's open.
        if (currentModal === 'authModal') window.__auth.renderModalBody();
      })
      .catch(function() {
        state.auth = { available: false, loggedIn: false, loading: false, error: 'Status check failed' };
        renderCurrentView();
      });
  },
  openModal: function() {
    openModal('authModal');
    window.__auth.renderModalBody();
    window.__auth.fetchStatus();
  },
  closeModal: function() { closeModal(); },
  renderModalBody: function() {
    var body = $('authModalBody');
    var footer = $('authModalFooter');
    if (!body || !footer) return;
    var a = state.auth || {};
    var bodyHtml = '';
    var footerHtml = '';
    if (a.engineConflicts && a.engineConflicts.length > 0) {
      bodyHtml += '<p style="color:var(--amber);font-weight:600;margin-bottom:8px">Environment conflict</p>';
      bodyHtml += '<p>The following environment variable(s) are set and will block subscription auth:</p>';
      bodyHtml += '<pre style="background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:8px 10px;margin:8px 0;font-size:.8125rem">' + esc(a.engineConflicts.join('\\n')) + '</pre>';
      bodyHtml += '<p style="color:var(--text-secondary);font-size:.8125rem">Unset each of these in the shell you launch the dashboard from, then restart the dashboard.</p>';
      footerHtml = '<button class="btn btn-secondary" onclick="window.__auth.closeModal()">Close</button>';
    } else if (!a.available) {
      bodyHtml += '<p style="color:var(--red-light);font-weight:600;margin-bottom:8px">Claude CLI not found</p>';
      bodyHtml += '<p>The dashboard delegates account auth to the official <strong>claude</strong> CLI, which it could not locate on your PATH.</p>';
      bodyHtml += '<p style="color:var(--text-secondary);font-size:.8125rem;margin-top:8px">Install Claude Code, then reload this page.</p>';
      footerHtml = '<button class="btn btn-secondary" onclick="window.__auth.closeModal()">Close</button>';
    } else if (a.loginInProgress) {
      bodyHtml += '<p>A browser window should have opened for sign-in. Complete the flow there; this dialog will update automatically when you are connected.</p>';
      bodyHtml += '<p style="color:var(--text-secondary);font-size:.8125rem;margin-top:8px">If the browser did not open, run <code>claude auth login</code> in your terminal.</p>';
      footerHtml  = '<button class="btn btn-secondary" onclick="window.__auth.cancelLogin()">Cancel sign-in</button>';
      footerHtml += '<button class="btn btn-primary" disabled><span class="spinner"></span> Waiting…</button>';
    } else if (a.loggedIn) {
      bodyHtml += '<p>Connected as <strong>' + esc(a.email || '(unknown email)') + '</strong>.</p>';
      var rows = [];
      if (a.orgName) rows.push(['Organization', a.orgName]);
      if (a.subscriptionType) rows.push(['Subscription', a.subscriptionType]);
      if (a.authMethod) rows.push(['Method', a.authMethod]);
      if (rows.length > 0) {
        bodyHtml += '<table style="margin-top:10px;font-size:.8125rem;color:var(--text-secondary);width:100%">';
        for (var i = 0; i < rows.length; i++) {
          bodyHtml += '<tr><td style="padding:2px 0;width:120px">' + esc(rows[i][0]) + '</td><td style="color:var(--text-primary)">' + esc(rows[i][1]) + '</td></tr>';
        }
        bodyHtml += '</table>';
      }
      footerHtml  = '<button class="btn btn-secondary" onclick="window.__auth.signOut()">Sign out</button>';
      footerHtml += '<button class="btn btn-primary" onclick="window.__auth.closeModal()">Done</button>';
    } else {
      bodyHtml += '<p>Connect your Claude account to enable the engine.</p>';
      bodyHtml += '<p style="color:var(--text-secondary);font-size:.8125rem;margin-top:8px">Clicking <strong>Sign in</strong> opens your default browser to complete OAuth. The dashboard updates automatically when you finish.</p>';
      footerHtml  = '<button class="btn btn-secondary" onclick="window.__auth.closeModal()">Cancel</button>';
      footerHtml += '<button class="btn btn-primary" onclick="window.__auth.signIn()">Sign in</button>';
    }
    body.innerHTML = bodyHtml;
    footer.innerHTML = footerHtml;
  },
  signIn: function() {
    state.auth = Object.assign({}, state.auth, { loginInProgress: true });
    window.__auth.renderModalBody();
    renderCurrentView();
    fetch('/api/auth/login', { method: 'POST' })
      .then(function(r) {
        if (!r.ok) return r.json().then(function(d){ throw new Error(d.error || 'Login start failed'); });
        return r.json();
      })
      .then(function() {
        // Start polling immediately so we detect completion ASAP.
        if (!state.authPollTimer) state.authPollTimer = setInterval(window.__auth.fetchStatus, 2000);
      })
      .catch(function(e) {
        state.auth = Object.assign({}, state.auth, { loginInProgress: false });
        showToast(e.message, 'error');
        window.__auth.renderModalBody();
        renderCurrentView();
      });
  },
  cancelLogin: function() {
    fetch('/api/auth/login/cancel', { method: 'POST' })
      .then(function() {
        if (state.authPollTimer) { clearInterval(state.authPollTimer); state.authPollTimer = null; }
        window.__auth.fetchStatus();
      })
      .catch(function(e) { showToast(e.message, 'error'); });
  },
  signOut: function() {
    fetch('/api/auth/logout', { method: 'POST' })
      .then(function(r) {
        if (!r.ok) return r.json().then(function(d){ throw new Error(d.error || 'Logout failed'); });
        return r.json();
      })
      .then(function() {
        showToast('Signed out');
        window.__auth.fetchStatus();
      })
      .catch(function(e) { showToast(e.message, 'error'); });
  },
};

// ---- Run in Browser (Phase 4) ----
window.__runner = {
  run: function(projectPath) {
    // Open a placeholder tab synchronously on the user gesture so we can
    // navigate it to the dev-server URL once runner-ready arrives. Popup
    // blockers usually allow this because it's tied to the click; opening a
    // tab later from inside an async SSE handler would be blocked.
    var pendingTab = null;
    try { pendingTab = window.open('about:blank', '_blank'); } catch (e) {}
    // Optimistic update so the UI flips to "Starting…" before the network
    // round-trip; runner-starting SSE will overwrite this with the real
    // framework + command.
    state.runners[projectPath] = { state: 'starting', framework: null, url: null, lastError: null, stdoutTail: [], _pendingTab: pendingTab };
    renderCurrentView();
    fetch('/api/projects/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectPath: projectPath })
    })
      .then(function(r) {
        if (!r.ok) return r.json().then(function(d){ throw new Error(d.error || 'Failed to start'); });
        return r.json();
      })
      .then(function(status) {
        // Preserve the placeholder tab handle across the POST response,
        // which doesn't know about it.
        var existing = state.runners[projectPath] || {};
        state.runners[projectPath] = Object.assign({}, status, { _pendingTab: existing._pendingTab || null });
        renderCurrentView();
      })
      .catch(function(e) {
        var existing = state.runners[projectPath] || {};
        if (existing._pendingTab && !existing._pendingTab.closed) {
          try { existing._pendingTab.close(); } catch (err) {}
        }
        state.runners[projectPath] = { state: 'error', framework: null, url: null, lastError: e.message, stdoutTail: [] };
        showToast(e.message, 'error');
        renderCurrentView();
      });
  },
  stop: function(projectPath) {
    fetch('/api/projects/stop', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectPath: projectPath })
    })
      .then(function(r) {
        if (!r.ok) return r.json().then(function(d){ throw new Error(d.error || 'Failed to stop'); });
      })
      .catch(function(e) { showToast(e.message, 'error'); });
  },
  showError: function(projectPath) {
    var r = state.runners[projectPath];
    if (!r) return;
    var tail = (r.stdoutTail || []).join('\\n') || '(no output captured)';
    var msg = (r.lastError || 'Dev server failed') + '\\n\\nLast lines:\\n' + tail;
    // alert() is plain but the error tail can be long — keep it simple.
    window.alert(msg);
  }
};

// ---- Navigation ----
window.__nav = {
  switchTopTab: async function(tab) {
    if (tab !== 'portfolio' && tab !== 'code') return;
    state.topTab = tab;
    document.getElementById('topTabPortfolio').classList.toggle('active', tab === 'portfolio');
    document.getElementById('topTabCode').classList.toggle('active', tab === 'code');
    document.getElementById('paneportfolio').classList.toggle('active', tab === 'portfolio');
    document.getElementById('panecode').classList.toggle('active', tab === 'code');
    if (tab === 'code') {
      // Render an immediate "Starting…" before awaiting the spawn so the
      // user sees something happen even if code-server cold-starts in 3-5s.
      if (state.codeServer.state !== 'ready') {
        state.codeServer = { state: 'starting' };
        refreshCodeFrame();
      }
      await ensureCodeServerStarted();
      refreshCodeFrame();
    }
  },
  goToDashboard: function() {
    state.currentView = 'dashboard';
    state.currentProject = null;
    state.selectedCompact = null;
    renderCurrentView();
    if (state.topTab === 'code') refreshCodeFrame();
  },
  goToProject: function(projPath) {
    state.currentView = 'project';
    state.currentProject = projPath;
    state.selectedCompact = null;
    renderCurrentView();
    if (state.topTab === 'code') refreshCodeFrame();
  },
  selectProject: function(projPath) {
    if (state.currentView === 'project' && state.currentProject === projPath) {
      window.__nav.goToDashboard();
    } else {
      window.__nav.goToProject(projPath);
    }
  },
  selectCompact: function(teamId) {
    if (state.selectedCompact === teamId) {
      state.selectedCompact = null;
    } else {
      state.selectedCompact = teamId;
    }
    renderCurrentView();
  },
  openPanel: function(teamId) {
    state.panelTeamId = teamId;
    state.panelOpen = true;
    // Reset transient panel UI state when switching teams.
    state.panelUI.agentsCollapsed = (typeof window !== 'undefined' && window.innerHeight && window.innerHeight < 720);
    state.panelUI.pinnedTaskExpanded = false;
    state.panelUI.overflowOpen = false;
    state.panelUI.overflowReturnFocusId = null;
    state.panelUI.expandedAgents = {};
    state.panelUI.expandedMessages = {};
    state.panelUI._scrollIntent = 'bottom';
    renderPanel();
  },
  closePanel: function() {
    state.panelOpen = false;
    state.panelTeamId = null;
    state.panelUI.overflowOpen = false;
    renderPanel();
  }
};

// ---- Side panel handlers (collapse, edit, overflow, confirm-delete) ----
window.__panel = {
  toggleAgents: function() {
    state.panelUI.agentsCollapsed = !state.panelUI.agentsCollapsed;
    renderPanel();
  },
  toggleAgentRow: function(instance) {
    state.panelUI.expandedAgents[instance] = !state.panelUI.expandedAgents[instance];
    renderPanel();
  },
  togglePinnedTask: function() {
    state.panelUI.pinnedTaskExpanded = !state.panelUI.pinnedTaskExpanded;
    // When expanding, scroll the thread to the top so the user can read the
    // full task from the start. Collapsing leaves scroll where it is.
    if (state.panelUI.pinnedTaskExpanded) state.panelUI._scrollIntent = 'top';
    renderPanel();
  },
  toggleMessage: function(key) {
    state.panelUI.expandedMessages[key] = !state.panelUI.expandedMessages[key];
    renderPanel();
  },
  toggleSecurityResult: function(teamId) {
    state.panelUI.securityResultCollapsed[teamId] = !state.panelUI.securityResultCollapsed[teamId];
    renderPanel();
  },
  clearSecurityResult: function(teamId) {
    delete state.securityResults[teamId];
    delete state.panelUI.securityResultCollapsed[teamId];
    renderPanel();
  },
  toggleOverflow: function(ev) {
    if (ev && ev.stopPropagation) ev.stopPropagation();
    // Close the inline-card menu if it's open on another surface.
    state.panelUI.inlineOverflowTeamId = null;
    state.panelUI.overflowOpen = !state.panelUI.overflowOpen;
    state.panelUI.overflowReturnFocusId = 'panelOverflowBtn';
    renderPanel();
    if (state.panelUI.overflowOpen) {
      setTimeout(function() {
        var menu = $('panelOverflowMenu');
        if (!menu) return;
        var items = menu.querySelectorAll('button.sp-overflow-item:not([disabled])');
        if (items.length > 0) items[0].focus();
      }, 0);
    }
  },
  closeOverflow: function() {
    if (!state.panelUI.overflowOpen) return;
    state.panelUI.overflowOpen = false;
    var returnId = state.panelUI.overflowReturnFocusId;
    state.panelUI.overflowReturnFocusId = null;
    renderPanel();
    if (returnId) {
      setTimeout(function() {
        var el = $(returnId);
        if (el) el.focus();
      }, 0);
    }
  },
  toggleInlineOverflow: function(teamId, ev) {
    if (ev && ev.stopPropagation) ev.stopPropagation();
    // Mutually exclusive with the side panel's ⋮.
    state.panelUI.overflowOpen = false;
    var wasOpen = state.panelUI.inlineOverflowTeamId === teamId;
    state.panelUI.inlineOverflowTeamId = wasOpen ? null : teamId;
    state.panelUI.overflowReturnFocusId = 'inlineOverflowBtn-' + teamId;
    renderCurrentView();
    if (state.panelUI.inlineOverflowTeamId) {
      setTimeout(function() {
        var menu = document.getElementById('inlineOverflowMenu-' + teamId);
        if (!menu) return;
        var items = menu.querySelectorAll('button.sp-overflow-item:not([disabled])');
        if (items.length > 0) items[0].focus();
      }, 0);
    }
  },
  closeInlineOverflow: function() {
    if (!state.panelUI.inlineOverflowTeamId) return;
    var returnId = state.panelUI.overflowReturnFocusId;
    state.panelUI.inlineOverflowTeamId = null;
    state.panelUI.overflowReturnFocusId = null;
    renderCurrentView();
    if (returnId) {
      setTimeout(function() {
        var el = document.getElementById(returnId);
        if (el) el.focus();
      }, 0);
    }
  },
  overflowKeydown: function(ev) {
    var menu = $('panelOverflowMenu');
    if (!menu) return;
    var items = Array.prototype.slice.call(menu.querySelectorAll('button.sp-overflow-item:not([disabled])'));
    var idx = items.indexOf(document.activeElement);
    if (ev.key === 'ArrowDown') {
      ev.preventDefault();
      items[(idx + 1) % items.length].focus();
    } else if (ev.key === 'ArrowUp') {
      ev.preventDefault();
      items[(idx - 1 + items.length) % items.length].focus();
    } else if (ev.key === 'Home') {
      ev.preventDefault();
      if (items.length) items[0].focus();
    } else if (ev.key === 'End') {
      ev.preventDefault();
      if (items.length) items[items.length - 1].focus();
    }
  },
  terminateFromMenu: function(teamId, context) {
    if (context === 'inline') window.__panel.closeInlineOverflow();
    else window.__panel.closeOverflow();
    window.__modal.stopPipeline(teamId);
  },
  openConfirmDelete: function(teamId, context) {
    if (context === 'inline') {
      state.panelUI.confirmDeleteReturnFocusId = 'inlineOverflowBtn-' + teamId;
      state.panelUI.inlineOverflowTeamId = null;
    } else {
      state.panelUI.confirmDeleteReturnFocusId = 'panelOverflowBtn';
      state.panelUI.overflowOpen = false;
    }
    renderCurrentView();
    var teamName = state.teams[teamId] ? (state.teams[teamId].teamName || teamId) : teamId;
    $('deleteConfirmTeamId').value = teamId;
    $('deleteConfirmTeamLabel').textContent = teamName;
    $('deleteConfirmTitle').textContent = 'Delete team "' + teamName + '"?';
    openModal('deleteConfirmModal');
    // Focus the Cancel button by default (safer default per spec).
    setTimeout(function() {
      var c = $('deleteConfirmCancel');
      if (c) c.focus();
    }, 0);
  },
  closeConfirmDelete: function() {
    closeModal();
    var returnId = state.panelUI.confirmDeleteReturnFocusId;
    state.panelUI.confirmDeleteReturnFocusId = null;
    if (returnId) {
      setTimeout(function() {
        var el = $(returnId);
        if (el) el.focus();
      }, 0);
    }
  },
  confirmDelete: function() {
    var teamId = $('deleteConfirmTeamId').value;
    var teamName = state.teams[teamId] ? (state.teams[teamId].teamName || teamId) : teamId;
    fetch('/api/teams/' + encodeURIComponent(teamId) + '/stop', { method: 'POST' })
      .then(function(r) {
        if (!r.ok) return r.json().then(function(d){ throw new Error(d.error || 'Failed to delete'); });
        showToast('Team "' + teamName + '" deleted');
      })
      .catch(function(e) { showToast(e.message, 'error'); });
    window.__panel.closeConfirmDelete();
  },
  trapTabInConfirm: function(ev) {
    if (ev.key !== 'Tab') return;
    var first = $('deleteConfirmCancel');
    var last = $('deleteConfirmOk');
    if (!first || !last) return;
    if (ev.shiftKey && document.activeElement === first) {
      ev.preventDefault();
      last.focus();
    } else if (!ev.shiftKey && document.activeElement === last) {
      ev.preventDefault();
      first.focus();
    }
  },
};

// ---- Modals ----
var currentModal = null;
var attachedImages = [];

function openModal(id) {
  $('modalOverlay').classList.add('open');
  // Hide all modals
  qsa('.modal').forEach(function(m){ m.style.display='none'; });
  var modal = $(id);
  if (modal) modal.style.display='block';
  currentModal = id;
  attachedImages = [];
  renderImagePreviews();
}
function closeModal() {
  $('modalOverlay').classList.remove('open');
  currentModal = null;
  attachedImages = [];
}

function renderImagePreviews() {
  var containers = qsa('.image-previews');
  containers.forEach(function(c) {
    var html = '';
    for (var i = 0; i < attachedImages.length; i++) {
      html += '<div class="image-preview-container">';
      html += '<img src="' + attachedImages[i] + '" class="image-preview">';
      html += '<span class="image-preview-remove" onclick="window.__modal.removeImage(' + i + ')">x</span>';
      html += '</div>';
    }
    c.innerHTML = html;
  });
}

function handleImageFile(file) {
  if (!file || !file.type.startsWith('image/')) return;
  var reader = new FileReader();
  reader.onload = function(e) {
    attachedImages.push(e.target.result);
    renderImagePreviews();
  };
  reader.readAsDataURL(file);
}

function setupImageArea(areaId, fileInputId) {
  var area = $(areaId);
  var fileInput = $(fileInputId);
  if (!area || !fileInput) return;

  area.addEventListener('click', function() { fileInput.click(); });
  fileInput.addEventListener('change', function() {
    for (var i = 0; i < fileInput.files.length; i++) {
      handleImageFile(fileInput.files[i]);
    }
    fileInput.value = '';
  });
  area.addEventListener('dragover', function(e) { e.preventDefault(); area.classList.add('drag-over'); });
  area.addEventListener('dragleave', function() { area.classList.remove('drag-over'); });
  area.addEventListener('drop', function(e) {
    e.preventDefault();
    area.classList.remove('drag-over');
    for (var i = 0; i < e.dataTransfer.files.length; i++) {
      handleImageFile(e.dataTransfer.files[i]);
    }
  });
}

// Paste handler (global)
document.addEventListener('paste', function(e) {
  if (!currentModal) return;
  var items = e.clipboardData ? e.clipboardData.items : [];
  for (var i = 0; i < items.length; i++) {
    if (items[i].type.indexOf('image') !== -1) {
      handleImageFile(items[i].getAsFile());
    }
  }
});

window.__modal = {
  createTeam: function(presetPath) {
    openModal('createTeamModal');
    $('ctName').value = '';
    $('ctPath').value = '';
    // Note: ctTask field was removed — first chat message is now the task.

    // Build the Project dropdown from known projects (each rendered with its
    // last-segment name + team count). Last option is the new-project sentinel.
    var sel = $('ctProject');
    sel.innerHTML = '';
    var paths = Object.keys(state.projects).sort();
    var preselected = (presetPath && state.projects[presetPath])
      ? presetPath
      : (state.currentProject && state.projects[state.currentProject]
          ? state.currentProject
          : (paths.length > 0 ? paths[0] : '__new__'));
    for (var i = 0; i < paths.length; i++) {
      var p = paths[i];
      var proj = state.projects[p];
      var opt = document.createElement('option');
      opt.value = p;
      var teamCount = proj.teams ? proj.teams.size : 0;
      opt.textContent = (proj.name || p) + ' (' + teamCount + ' team' + (teamCount === 1 ? '' : 's') + ')';
      sel.appendChild(opt);
    }
    var addNew = document.createElement('option');
    addNew.value = '__new__';
    addNew.textContent = paths.length > 0 ? '+ Add new project…' : '+ Create your first project…';
    sel.appendChild(addNew);
    sel.value = preselected;
    this.onProjectPicked();

    setTimeout(function() { $('ctName').focus(); }, 100);
  },
  onProjectPicked: function() {
    var sel = $('ctProject');
    var pathGroup = $('ctPathGroup');
    if (sel.value === '__new__') {
      pathGroup.style.display = '';
      $('ctPath').value = '';
      setTimeout(function() { $('ctPath').focus(); }, 50);
    } else {
      pathGroup.style.display = 'none';
    }
  },
  addProject: function() {
    // Native macOS Finder folder-picker via /api/pick-directory, which
    // spawns the precompiled Swift binary at tools/pick-folder. Same
    // NSOpenPanel GitHub Desktop opens. Manual path entry only kicks in
    // on hard failure (binary missing, permission denied, etc).
    var promptForPath = function() {
      var p = window.prompt('Type the absolute path to the project folder:', '');
      if (!p || !p.trim()) return;
      postPath(p.trim());
    };
    var postPath = function(projectPath) {
      fetch('/api/portfolio', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectPath: projectPath })
      })
        .then(function(r) {
          if (!r.ok) return r.json().then(function(d){ throw new Error(d.error || 'Failed to add project'); });
          return r.json();
        })
        .then(function(project) {
          addPortfolioProject(project);
          state.recentlyAddedProjects.add(project.projectPath);
          showToast('Added "' + (project.displayName || project.projectPath) + '" to portfolio');
          renderCurrentView();
        })
        .catch(function(e) { showToast(e.message, 'error'); });
    };
    showToast('Opening folder picker — check your Mac if it does not appear within a few seconds.', 'info');
    fetch('/api/pick-directory', { method: 'POST' })
      .then(function(r) {
        return r.json().then(function(d){ return { ok: r.ok, status: r.status, body: d }; });
      })
      .then(function(resp) {
        if (resp.ok && resp.body && resp.body.path) {
          postPath(resp.body.path);
          return;
        }
        if (resp.body && resp.body.cancelled) {
          return; // user cancelled, no error
        }
        // Hard failure — binary missing, unsupported platform, etc.
        showToast('Could not open the folder picker. Paste a path instead.', 'error');
        promptForPath();
      })
      .catch(function() {
        showToast('Could not open the folder picker. Paste a path instead.', 'error');
        promptForPath();
      });
  },
  removeProject: function(projectPath) {
    var proj = state.projects[projectPath];
    var projName = proj ? proj.name : projectPath;
    if (!confirm('Remove "' + projName + '" from the portfolio? Project files on disk are not touched. You can add it back later.')) return;
    fetch('/api/portfolio/' + encodeURIComponent(projectPath), { method: 'DELETE' })
      .then(function(r) {
        if (!r.ok) return r.json().then(function(d){ throw new Error(d.error || 'Failed to remove project'); });
      })
      .then(function() {
        if (state.projects[projectPath]) {
          state.projects[projectPath].inPortfolio = false;
          // If no teams remain, drop the project from view entirely (matches legacy auto-inferred behavior).
          if (state.projects[projectPath].teams.size === 0) {
            delete state.projects[projectPath];
          }
        }
        showToast('Removed "' + projName + '" from portfolio');
        renderCurrentView();
      })
      .catch(function(e) { showToast(e.message, 'error'); });
  },
  stopPipeline: function(teamId) {
    openModal('stopModal');
    $('stopTeamId').value = teamId;
    $('stopTeamLabel').textContent = state.teams[teamId] ? (state.teams[teamId].teamName || teamId) : teamId;
  },
  deleteTeam: function(teamId) {
    var teamName = state.teams[teamId] ? (state.teams[teamId].teamName || teamId) : teamId;
    if (!confirm('Delete team "' + teamName + '"? This removes it from the portfolio. The project files on disk are not touched.')) return;
    fetch('/api/teams/' + encodeURIComponent(teamId) + '/stop', { method: 'POST' })
      .then(function(r) {
        if (!r.ok) return r.json().then(function(d){ throw new Error(d.error || 'Failed to delete'); });
        showToast('Team "' + teamName + '" deleted');
      })
      .catch(function(e) { showToast(e.message, 'error'); });
  },
  clearDoneTeams: function(projectPath) {
    var proj = state.projects[projectPath];
    var projName = proj ? proj.name : projectPath;
    var teamIds = proj ? Array.from(proj.teams) : [];
    var doneCount = 0;
    for (var i = 0; i < teamIds.length; i++) {
      var t = state.teams[teamIds[i]];
      if (t && isTerminalPhase(t.currentPhase)) doneCount++;
    }
    if (doneCount === 0) {
      showToast('No finished teams to clear in ' + projName, 'info');
      return;
    }
    var totalInProject = teamIds.length;
    var willEmptyProject = doneCount === totalInProject;
    var message = 'Delete ' + doneCount + ' finished team' + (doneCount !== 1 ? 's' : '') + ' from "' + projName + '"?';
    if (willEmptyProject) {
      message += '\\n\\nThis is the last team' + (doneCount !== 1 ? 's' : '') + ' in the project — the project will disappear from the dashboard until you create a new team in it.';
    }
    message += '\\n\\nTheir on-disk team data will be removed. Project files on disk are not touched.';
    if (!confirm(message)) return;
    fetch('/api/projects/clear-done', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectPath: projectPath })
    })
      .then(function(r) {
        if (!r.ok) return r.json().then(function(d){ throw new Error(d.error || 'Failed to clear'); });
        return r.json();
      })
      .then(function(d) {
        showToast('Cleared ' + d.cleared + ' team' + (d.cleared !== 1 ? 's' : '') + ' from ' + projName);
      })
      .catch(function(e) { showToast(e.message, 'error'); });
  },
  createPR: function(teamId) {
    openModal('createPRModal');
    $('prTeamId').value = teamId;
    $('prTeamLabel').textContent = state.teams[teamId] ? (state.teams[teamId].teamName || teamId) : teamId;
    $('prStatus').textContent = '';
    $('prSubmitBtn').disabled = false;
  },
  steerAgent: function(teamId, targetInstance) {
    openModal('steerModal');
    $('steerTeamId').value = teamId;
    $('steerTargetInstance').value = targetInstance || '';
    $('steerMessage').value = '';
    var team = state.teams[teamId];
    var teamName = team ? (team.teamName || teamId) : teamId;
    $('steerTeamLabel').textContent = targetInstance
      ? (targetInstance + ' (' + teamName + ')')
      : teamName;
  },
  securityReview: function(teamId) {
    openModal('securityReviewModal');
    $('srTeamId').value = teamId;
    $('srTeamLabel').textContent = state.teams[teamId] ? (state.teams[teamId].teamName || teamId) : teamId;
    $('srStatus').textContent = '';
    $('srSubmitBtn').disabled = false;
  },
  settings: function() {
    openModal('settingsModal');
    var autoScrollToggle = $('settingAutoScroll');
    if (autoScrollToggle) autoScrollToggle.classList.toggle('on', state.settings.autoScroll);
    var soundToggle = $('settingSound');
    if (soundToggle) soundToggle.classList.toggle('on', state.settings.soundEnabled);
  },
  removeImage: function(idx) {
    attachedImages.splice(idx, 1);
    renderImagePreviews();
  },
};

// ---- API Calls ----
window.__api = {
  createTeam: function() {
    var name = $('ctName').value.trim();
    var sel = $('ctProject');
    // If user picked an existing project, use its path. If they picked
    // "+ Add new project", read the revealed path field instead.
    var projectPath = sel && sel.value && sel.value !== '__new__'
      ? sel.value
      : $('ctPath').value.trim();
    if (!name) {
      showToast('Team name is required', 'error');
      return;
    }
    if (!projectPath) {
      showToast(sel && sel.value === '__new__' ? 'New project path is required' : 'Pick a project', 'error');
      return;
    }
    // Body intentionally omits the task field — chat panel is the new task-entry surface.
    var body = { name: name, projectPath: projectPath };
    fetch('/api/teams', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function(r) {
      if (!r.ok) return r.json().then(function(d){ throw new Error(d.error || 'Failed'); });
      return r.json();
    }).then(function() {
      closeModal();
      showToast('Team "' + name + '" created');
      // Auto-open the new team's chat panel and focus the input. The
      // team-created SSE event populates state.teams shortly after; if it
      // hasn't arrived yet, the chat panel renders an empty log.
      window.__nav.openPanel(name);
      setTimeout(function() {
        var inp = document.getElementById('chatInput-' + name);
        if (inp) inp.focus();
      }, 200);
    }).catch(function(e) {
      showToast(e.message, 'error');
    });
  },
  // Send a chat message to a team's Coordinator-1. Wired from the chat-input
  // form's onsubmit. Optimistically marks the team as "pending" so the input
  // disables until the coordinator's response arrives via SSE.
  sendChat: function(ev, teamId) {
    if (ev && ev.preventDefault) ev.preventDefault();
    var inp = $('chatInput-' + teamId);
    if (!inp) return false;
    var msg = (inp.value || '').trim();
    if (!msg) return false;
    inp.value = '';
    state.chatPending[teamId] = true;
    if (state.panelOpen && state.panelTeamId === teamId) renderPanel();
    fetch('/api/teams/' + encodeURIComponent(teamId) + '/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: msg }),
    }).catch(function(e) {
      state.chatPending[teamId] = false;
      showToast('Failed to send message: ' + e.message, 'error');
      if (state.panelOpen && state.panelTeamId === teamId) renderPanel();
    });
    return false;
  },
  // Abort the in-flight coordinator turn. The SSE chat-cancelled event flips
  // chatPending off and re-renders; here we just fire the request.
  cancelChat: function(teamId) {
    fetch('/api/teams/' + encodeURIComponent(teamId) + '/chat/cancel', {
      method: 'POST'
    }).then(function(r) {
      if (r.status === 409) {
        // No turn was in flight by the time the cancel arrived — race with
        // the coordinator finishing on its own. Clear pending defensively.
        state.chatPending[teamId] = false;
        if (state.panelOpen && state.panelTeamId === teamId) renderPanel();
        return;
      }
      if (!r.ok) return r.json().then(function(d){ throw new Error(d.error || 'Failed to cancel'); });
    }).catch(function(e) {
      showToast(e.message, 'error');
    });
  },
  stopTeam: function() {
    var teamId = $('stopTeamId').value;
    fetch('/api/teams/' + encodeURIComponent(teamId) + '/stop', { method: 'POST' })
      .then(function(r) {
        if (!r.ok) return r.json().then(function(d){ throw new Error(d.error||'Failed'); });
        return r.json();
      })
      .then(function() {
        closeModal();
        showToast('Pipeline stopped');
      })
      .catch(function(e) { showToast(e.message, 'error'); });
  },
  createPR: function() {
    var teamId = $('prTeamId').value;
    $('prSubmitBtn').disabled = true;
    $('prStatus').innerHTML = '<span class="spinner"></span> Creating PR...';
    fetch('/api/teams/' + encodeURIComponent(teamId) + '/create-pr', { method: 'POST' })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (data.success) {
          $('prStatus').innerHTML = 'PR created: <a href="' + esc(data.prUrl||'') + '" target="_blank">#' + (data.prNumber||'') + '</a>';
          showToast('PR created');
          setTimeout(closeModal, 1500);
        } else {
          $('prStatus').textContent = 'Failed: ' + (data.error || data.output || 'Unknown error');
          $('prSubmitBtn').disabled = false;
        }
      })
      .catch(function(e) {
        $('prStatus').textContent = 'Error: ' + e.message;
        $('prSubmitBtn').disabled = false;
      });
  },
  steerAgent: function() {
    var teamId = $('steerTeamId').value;
    var targetInstance = $('steerTargetInstance').value;
    var message = $('steerMessage').value.trim();
    if (!message) {
      showToast('Message is required', 'error');
      return;
    }
    var body = { message: message };
    if (targetInstance) body.targetInstance = targetInstance;
    if (attachedImages.length > 0) body.images = attachedImages;
    fetch('/api/teams/' + encodeURIComponent(teamId) + '/ask', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function(r) {
      if (!r.ok) return r.json().then(function(d){ throw new Error(d.error||'Failed'); });
      return r.json();
    }).then(function() {
      closeModal();
      showToast('Message sent to agent');
    }).catch(function(e) {
      showToast(e.message, 'error');
    });
  },
  runSecurityReview: function() {
    var teamId = $('srTeamId').value;
    $('srSubmitBtn').disabled = true;
    $('srStatus').innerHTML = '<span class="spinner"></span> Running security review...';
    fetch('/api/teams/' + encodeURIComponent(teamId) + '/security-review', { method: 'POST' })
      .then(function(r) {
        if (!r.ok) return r.json().then(function(d){ throw new Error(d.error||'Failed'); });
        return r.json();
      })
      .then(function() {
        $('srStatus').textContent = 'Security review started. Results will appear in panel.';
        setTimeout(closeModal, 2000);
      })
      .catch(function(e) {
        $('srStatus').textContent = 'Error: ' + e.message;
        $('srSubmitBtn').disabled = false;
      });
  },
  respondFeedback: function(teamId, feedbackId, value, text) {
    var payload = { feedbackId: feedbackId, value: value };
    if (typeof text === 'string') payload.text = text;
    fetch('/api/teams/' + encodeURIComponent(teamId) + '/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).then(function(r) {
      if (!r.ok) return r.json().then(function(d){ throw new Error(d.error||'Failed'); });
      return r.json();
    }).then(function() {
      // Remove the feedback (and any edit draft) from state
      var fbs = state.feedbacks[teamId];
      if (fbs) {
        state.feedbacks[teamId] = fbs.filter(function(f){ return f.id !== feedbackId; });
      }
      delete state.editingFeedback[feedbackId];
      showToast('Feedback sent');
      renderCurrentView();
    }).catch(function(e) {
      showToast(e.message, 'error');
    });
  },
  startFeedbackEdit: function(feedbackId) {
    var found = findFeedback(feedbackId);
    if (!found) return;
    state.editingFeedback[feedbackId] = found.fb.editableContent || '';
    renderCurrentView();
  },
  updateFeedbackDraft: function(feedbackId, text) {
    // Keep the draft in state so it survives SSE re-renders. Do NOT re-render
    // here — that would recreate the textarea and disrupt typing.
    state.editingFeedback[feedbackId] = text;
  },
  cancelFeedbackEdit: function(feedbackId) {
    delete state.editingFeedback[feedbackId];
    renderCurrentView();
  },
  submitFeedbackEdit: function(feedbackId) {
    var found = findFeedback(feedbackId);
    if (!found) return;
    var text = state.editingFeedback[feedbackId];
    if (typeof text !== 'string' || !text.trim()) {
      showToast('Requirements cannot be empty', 'error');
      return;
    }
    this.respondFeedback(found.teamId, feedbackId, 'approve', text);
  },
  toggleSetting: function(key) {
    state.settings[key] = !state.settings[key];
    var toggle = $(key === 'autoScroll' ? 'settingAutoScroll' : 'settingSound');
    if (toggle) toggle.classList.toggle('on', state.settings[key]);
  }
};

// ---- SSE Connection ----
// Store a blocking-feedback payload into state (dedup by id). Shared by the live
// 'feedback' SSE event and the init snapshot's re-hydration so a reload re-shows
// open prompts.
function storeFeedback(teamId, fb) {
  if (!teamId || !fb) return;
  if (!state.feedbacks[teamId]) state.feedbacks[teamId] = [];
  var existing = state.feedbacks[teamId].find(function(f){ return f.id === fb.id; });
  if (!existing) {
    state.feedbacks[teamId].push({
      id: fb.id, type: fb.type, title: fb.title, message: fb.message,
      blocking: fb.blocking, actions: fb.actions, detail: fb.detail, timestamp: fb.timestamp,
      editableContent: fb.editableContent
    });
  }
}

function connectSSE() {
  var es = new EventSource('/events');
  es.addEventListener('init', function(e) {
    try {
      var data = JSON.parse(e.data);
      state.sseConnected = true;
      if (data.runtime) state.runtime = data.runtime;
      // Seed portfolio FIRST so even projects with zero teams show up in the dashboard.
      if (Array.isArray(data.portfolio)) {
        for (var p = 0; p < data.portfolio.length; p++) {
          addPortfolioProject(data.portfolio[p]);
        }
      }
      if (data.teams) {
        for (var i = 0; i < data.teams.length; i++) {
          var t = data.teams[i];
          addOrUpdateTeam(t.teamId || t.teamName, t);
        }
      }
      // Seed any in-flight project runners so a dashboard reload doesn't
      // forget about already-running dev servers spawned by + Run.
      if (Array.isArray(data.runners)) {
        for (var k = 0; k < data.runners.length; k++) {
          var rs = data.runners[k];
          state.runners[rs.projectPath] = rs;
        }
      }
      // Re-show any open blocking prompts (e.g. the requirements checklist) so a
      // reload doesn't orphan a pipeline suspended waiting for a response.
      if (Array.isArray(data.pendingFeedback)) {
        for (var pf = 0; pf < data.pendingFeedback.length; pf++) {
          storeFeedback(data.pendingFeedback[pf].teamId, data.pendingFeedback[pf].feedback);
        }
      }
      renderCurrentView();
    } catch(err) {
      console.error('[SSE init] Error:', err);
    }
  });

  // Project runner lifecycle (Phase 4)
  es.addEventListener('runner-starting', function(e) {
    var d = JSON.parse(e.data);
    var existing = state.runners[d.projectPath] || {};
    state.runners[d.projectPath] = Object.assign({}, existing, {
      projectPath: d.projectPath,
      state: 'starting',
      framework: d.framework,
      command: d.command,
      url: null,
      lastError: null
    });
    renderCurrentView();
  });
  es.addEventListener('runner-ready', function(e) {
    var d = JSON.parse(e.data);
    var existing = state.runners[d.projectPath] || {};
    // If we opened a placeholder tab on the Run click, navigate it now.
    // Popup blockers that allowed about:blank typically allow this redirect.
    if (existing._pendingTab && !existing._pendingTab.closed) {
      try { existing._pendingTab.location.href = d.url; } catch (err) {}
    }
    state.runners[d.projectPath] = Object.assign({}, existing, {
      projectPath: d.projectPath,
      state: 'ready',
      url: d.url,
      _pendingTab: null,
    });
    showToast('Dev server ready: ' + d.url);
    renderCurrentView();
  });
  es.addEventListener('runner-error', function(e) {
    var d = JSON.parse(e.data);
    var existing = state.runners[d.projectPath] || {};
    if (existing._pendingTab && !existing._pendingTab.closed) {
      try { existing._pendingTab.close(); } catch (err) {}
    }
    state.runners[d.projectPath] = Object.assign({}, existing, {
      projectPath: d.projectPath,
      state: 'error',
      lastError: d.reason,
      stdoutTail: d.stdoutTail || [],
      _pendingTab: null,
    });
    showToast(d.reason, 'error');
    renderCurrentView();
  });
  es.addEventListener('runner-stopped', function(e) {
    var d = JSON.parse(e.data);
    var existing = state.runners[d.projectPath];
    if (existing && existing._pendingTab && !existing._pendingTab.closed) {
      try { existing._pendingTab.close(); } catch (err) {}
    }
    delete state.runners[d.projectPath];
    renderCurrentView();
  });

  es.addEventListener('team-created', function(e) {
    var data = JSON.parse(e.data);
    if (data.team) {
      addOrUpdateTeam(data.teamId, data.team);
    } else {
      addOrUpdateTeam(data.teamId, { teamId: data.teamId });
    }
    renderCurrentView();
  });

  es.addEventListener('task-assigned', function(e) {
    var data = JSON.parse(e.data);
    if (state.teams[data.teamId]) {
      state.teams[data.teamId].currentTask = { description: data.description, assignedAt: data.timestamp };
    }
    renderCurrentView();
  });

  es.addEventListener('task-classified', function(e) {
    var data = JSON.parse(e.data);
    if (state.teams[data.teamId]) {
      state.teams[data.teamId].complexity = data.complexity;
      if (state.teams[data.teamId].currentTask) {
        state.teams[data.teamId].currentTask.complexity = data.complexity;
      }
    }
    renderCurrentView();
  });

  es.addEventListener('phase-transition', function(e) {
    var data = JSON.parse(e.data);
    if (state.teams[data.teamId]) {
      state.teams[data.teamId].currentPhase = data.to;
      state.teams[data.teamId].updatedAt = data.timestamp;
    }
    renderCurrentView();
  });

  es.addEventListener('agent-output', function(e) {
    var data = JSON.parse(e.data);
    if (!state.liveOutput[data.teamId]) state.liveOutput[data.teamId] = [];
    state.liveOutput[data.teamId].push({ agent: data.instance, text: data.text, type: 'output' });
    // Trim to last 500 entries
    if (state.liveOutput[data.teamId].length > 500) {
      state.liveOutput[data.teamId] = state.liveOutput[data.teamId].slice(-500);
    }
    renderCurrentView();
  });

  es.addEventListener('agent-progress', function(e) {
    var data = JSON.parse(e.data);
    if (!state.liveOutput[data.teamId]) state.liveOutput[data.teamId] = [];
    state.liveOutput[data.teamId] = state.liveOutput[data.teamId].filter(function(entry) {
      return !(entry.agent === data.instance && entry.type === 'progress');
    });
    state.liveOutput[data.teamId].push({ agent: data.instance, text: data.text, type: 'progress' });
    if (state.liveOutput[data.teamId].length > 500) {
      state.liveOutput[data.teamId] = state.liveOutput[data.teamId].slice(-500);
    }
    // Update agent status
    if (state.teams[data.teamId] && state.teams[data.teamId].agents) {
      var ag = state.teams[data.teamId].agents[data.instance];
      if (ag) ag.state = 'active';
    }
    renderCurrentView();
  });

  es.addEventListener('agent-task', function(e) {
    var data = JSON.parse(e.data);
    if (!state.liveOutput[data.teamId]) state.liveOutput[data.teamId] = [];
    state.liveOutput[data.teamId].push({ agent: data.instance, text: 'Subtask: ' + data.subtask, type: 'output' });
    if (state.teams[data.teamId] && state.teams[data.teamId].agents) {
      var ag = state.teams[data.teamId].agents[data.instance];
      if (ag) {
        ag.state = 'active';
        ag.currentJob = data.subtask;
      }
    }
    renderCurrentView();
  });

  es.addEventListener('task-complete', function(e) {
    var data = JSON.parse(e.data);
    if (state.teams[data.teamId]) {
      state.teams[data.teamId].lastPhaseDuration = data.durationMs;
      state.teams[data.teamId].currentPhase = data.phase;
    }
    if (!state.liveOutput[data.teamId]) state.liveOutput[data.teamId] = [];
    state.liveOutput[data.teamId].push({ agent: null, text: 'Phase ' + data.phase + ' complete (' + formatDuration(data.durationMs) + ')', type: 'output' });
    renderCurrentView();
  });

  es.addEventListener('error', function(e) {
    var data = JSON.parse(e.data);
    if (state.teams[data.teamId]) {
      state.teams[data.teamId].currentPhase = 'errored';
    }
    if (!state.liveOutput[data.teamId]) state.liveOutput[data.teamId] = [];
    state.liveOutput[data.teamId].push({ agent: null, text: 'Error: ' + data.message, type: 'error' });
    renderCurrentView();
  });

  es.addEventListener('feedback', function(e) {
    var data = JSON.parse(e.data);
    storeFeedback(data.teamId, data);
    renderCurrentView();
  });

  es.addEventListener('security-review', function(e) {
    var data = JSON.parse(e.data);
    if (data.result) {
      state.securityResults[data.teamId] = data.result;
      // Fresh result: expand by default so the user sees the new content.
      if (state.panelUI && state.panelUI.securityResultCollapsed) {
        delete state.panelUI.securityResultCollapsed[data.teamId];
      }
    }
    renderCurrentView();
  });

  es.addEventListener('pr-created', function(e) {
    var data = JSON.parse(e.data);
    if (state.teams[data.teamId]) {
      state.teams[data.teamId].prNumber = data.prNumber;
      state.teams[data.teamId].prUrl = data.prUrl;
      state.teams[data.teamId].currentPhase = 'pr_open';
    }
    showToast('PR #' + data.prNumber + ' created');
    renderCurrentView();
  });

  es.addEventListener('team-archived', function(e) {
    var data = JSON.parse(e.data);
    if (state.teams[data.teamId]) {
      state.teams[data.teamId].currentPhase = 'merged';
      if (data.prUrl) state.teams[data.teamId].prUrl = data.prUrl;
    }
    showToast('Team archived');
    renderCurrentView();
  });

  es.addEventListener('team-deleted', function(e) {
    var data = JSON.parse(e.data);
    var t = state.teams[data.teamId];
    if (t) {
      // Drop the team from the per-project index. If the project is in the
      // portfolio (Phase 3), keep the project visible with its empty state.
      // Otherwise (legacy auto-inferred project), drop it once the last team
      // leaves so the dashboard stays clean.
      var projPath = t.projectPath;
      if (projPath && state.projects[projPath]) {
        state.projects[projPath].teams.delete(data.teamId);
        if (state.projects[projPath].teams.size === 0 && !state.projects[projPath].inPortfolio) {
          delete state.projects[projPath];
        }
      }
      delete state.teams[data.teamId];
    }
    // Drop the team's feedbacks and any in-progress edit drafts so they don't
    // accumulate (and get scanned by findFeedback) for the tab's lifetime.
    var teamFbs = state.feedbacks[data.teamId];
    if (teamFbs) {
      for (var fi = 0; fi < teamFbs.length; fi++) {
        delete state.editingFeedback[teamFbs[fi].id];
      }
      delete state.feedbacks[data.teamId];
    }
    // Also clear any panel that was viewing this team
    if (state.panelTeamId === data.teamId) {
      state.panelOpen = false;
      state.panelTeamId = null;
    }
    renderCurrentView();
  });

  es.addEventListener('chat-message', function(e) {
    var data = JSON.parse(e.data);
    if (!state.chatMessages[data.teamId]) state.chatMessages[data.teamId] = [];
    state.chatMessages[data.teamId].push(data.message);
    // Coordinator response or system note ends the "pending" spinner.
    if (data.message.role !== 'user') {
      state.chatPending[data.teamId] = false;
    }
    if (state.panelOpen && state.panelTeamId === data.teamId) {
      state.panelUI._scrollIntent = 'bottom';
      renderPanel();
    }
  });

  // User clicked × — coordinator turn was aborted. Clear pending state and
  // toast. The deterministic pipeline (if TRIGGER_PIPELINE had fired) keeps
  // running and surfaces via its own events.
  es.addEventListener('chat-cancelled', function(e) {
    var data = JSON.parse(e.data);
    state.chatPending[data.teamId] = false;
    showToast('Coordinator turn cancelled. Any pipeline already started keeps running.', 'info');
    if (state.panelOpen && state.panelTeamId === data.teamId) renderPanel();
  });

  // Verdict parser failed to read an agent response. The orchestrator
  // automatically re-prompts once. Surface it as a per-agent pill (not a
  // toast) so the user sees it in agent context and recurrent flakiness
  // doesn't spam notifications. Also append to the live output log.
  es.addEventListener('malformed-output', function(e) {
    var data = JSON.parse(e.data);
    if (!state.malformedOutputs[data.teamId]) state.malformedOutputs[data.teamId] = {};
    var prev = state.malformedOutputs[data.teamId][data.instance] || { count: 0, lastRaw: '' };
    state.malformedOutputs[data.teamId][data.instance] = {
      count: prev.count + 1,
      lastRaw: data.raw,
    };
    if (!state.liveOutput[data.teamId]) state.liveOutput[data.teamId] = [];
    var preview = (data.raw || '').toString().substring(0, 120);
    state.liveOutput[data.teamId].push({
      agent: data.instance,
      text: 'Malformed verdict, re-prompting: ' + preview,
      type: 'error',
    });
    renderCurrentView();
  });

  // Another client (or this one) resolved a blocking feedback prompt.
  // Filter it out of our local state so the prompt UI disappears in every
  // open tab without requiring a refresh.
  es.addEventListener('feedback-response', function(e) {
    var data = JSON.parse(e.data);
    var fbs = state.feedbacks[data.teamId];
    if (fbs && fbs.length > 0) {
      state.feedbacks[data.teamId] = fbs.filter(function(f) { return f.id !== data.feedbackId; });
    }
    // Drop any in-progress edit draft too (e.g. resolved from another tab), so
    // an orphaned draft doesn't linger as a phantom in-progress edit.
    delete state.editingFeedback[data.feedbackId];
    renderCurrentView();
  });

  es.addEventListener('shutdown', function() {
    state.sseConnected = false;
    showToast('Server shutting down', 'info');
  });

  es.onerror = function() {
    state.sseConnected = false;
    // EventSource auto-reconnects
  };
}

// ---- Elapsed Time Updater ----
function updateElapsedTimers() {
  qsa('.card-elapsed').forEach(function(el) {
    var created = el.dataset.created;
    if (created) {
      var t = state.teams[Object.keys(state.teams).find(function(tid){
        return state.teams[tid].createdAt === created;
      })];
      // Only update if team is still active
      if (t && t.currentPhase !== 'done' && t.currentPhase !== 'merged' && t.currentPhase !== 'cancelled') {
        el.textContent = elapsedSince(created);
      }
    }
  });
}
setInterval(updateElapsedTimers, 1000);

// ---- Keyboard ----
document.addEventListener('keydown', function(e) {
  // Escape priority (innermost first): confirm dialog -> overflow menu -> other modal -> panel.
  if (e.key === 'Escape') {
    if (currentModal === 'deleteConfirmModal') {
      window.__panel.closeConfirmDelete();
      return;
    }
    if (state.panelUI && state.panelUI.overflowOpen) {
      window.__panel.closeOverflow();
      return;
    }
    if (state.panelUI && state.panelUI.inlineOverflowTeamId) {
      window.__panel.closeInlineOverflow();
      return;
    }
    if (currentModal) {
      closeModal();
    } else if (state.panelOpen) {
      window.__nav.closePanel();
    }
    return;
  }
  // Focus trap inside the delete-confirm dialog.
  if (currentModal === 'deleteConfirmModal' && state.panelUI) {
    window.__panel.trapTabInConfirm(e);
  }
});

// Click anywhere outside an overflow menu to close it.
document.addEventListener('click', function(e) {
  if (!state.panelUI) return;
  // Side panel ⋮
  if (state.panelUI.overflowOpen) {
    var wrap = document.querySelector('.slide-panel .sp-overflow-wrap');
    if (!wrap || !wrap.contains(e.target)) window.__panel.closeOverflow();
  }
  // Inline-detail card ⋮
  if (state.panelUI.inlineOverflowTeamId) {
    var inlineWrap = document.querySelector('.inline-detail .sp-overflow-wrap');
    if (!inlineWrap || !inlineWrap.contains(e.target)) window.__panel.closeInlineOverflow();
  }
});

// ---- Init ----
renderCurrentView();
connectSSE();
window.__auth.fetchStatus();

// Setup image areas after DOM ready
// Expose closeModal/openModal to inline HTML onclick handlers
window.closeModal = closeModal;
window.openModal = openModal;

setTimeout(function() {
  setupImageArea('ctImageArea', 'ctImageInput');
  setupImageArea('steerImageArea', 'steerImageInput');
}, 100);

})();
`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>ClaudeOrchestra</title>
<style>${CSS}</style>
</head>
<body>

<!-- Nav Rail -->
<nav class="nav-rail">
  <div class="nav-logo" onclick="window.__nav.goToDashboard()" title="ClaudeOrchestra">CO</div>
  <div class="nav-projects" id="navProjects"></div>
  <div class="nav-bottom">
    <button class="nav-btn" onclick="window.__modal.createTeam()" title="New Team">+</button>
    <button class="nav-btn" onclick="window.__modal.settings()" title="Settings">&#9881;</button>
  </div>
</nav>

<!-- Main Content -->
<main class="main-content">
  <!-- Top tabs: Portfolio (orchestration dashboard) | Code (embedded VS Code via code-server) -->
  <div class="top-tabs">
    <button class="top-tab active" id="topTabPortfolio" onclick="window.__nav.switchTopTab('portfolio')">Portfolio</button>
    <button class="top-tab" id="topTabCode" onclick="window.__nav.switchTopTab('code')">Code</button>
  </div>
  <div class="top-tab-pane portfolio active" id="paneportfolio">
    <div class="view-container" id="viewContainer"></div>
  </div>
  <div class="top-tab-pane" id="panecode">
    <div class="code-empty" id="codeEmpty">
      <h2>Code view</h2>
      <p id="codeEmptyMsg">Select a project from the sidebar to open it in the embedded editor.</p>
    </div>
    <iframe class="code-frame" id="codeFrame" style="display:none" title="Embedded VS Code"></iframe>
    <div class="code-frame-overlay" id="codeFrameOverlay" hidden></div>
  </div>
</main>

<!-- Slide-in Panel — 4 regions: Header / Agents / Chat / Composer (see docs/side-panel-redesign.md) -->
<div class="panel-overlay" id="panelOverlay" onclick="window.__nav.closePanel()"></div>
<div class="slide-panel slide-panel-redesign" id="slidePanel" role="dialog" aria-label="Team detail" aria-modal="false">
  <div class="sp-header" id="panelHeader"></div>
  <div class="sp-agents" id="panelAgents" data-collapsed="false"></div>
  <div class="sp-chat" id="panelChat">
    <div class="sp-chat-subheader" id="panelChatSubheader"></div>
    <div class="sp-chat-thread" id="panelChatThread" tabindex="0" aria-label="Conversation with Coordinator"></div>
  </div>
  <div class="sp-composer" id="panelComposer"></div>
</div>

<!-- Toast Container -->
<div class="toast-container" id="toastContainer"></div>

<!-- Modal Overlay -->
<div class="modal-overlay" id="modalOverlay" onclick="closeModal()">

  <!-- Create Team Modal -->
  <div class="modal" id="createTeamModal" style="display:none" onclick="event.stopPropagation()">
    <div class="modal-header">
      <h3>Create Team</h3>
      <button class="panel-close" onclick="closeModal()">&#10005;</button>
    </div>
    <div class="modal-body">
      <div class="form-group">
        <label>Team Name</label>
        <input type="text" id="ctName" placeholder="my-feature-team" autocomplete="off" autocapitalize="off" spellcheck="false">
      </div>
      <div class="form-group">
        <label>Project</label>
        <select id="ctProject" onchange="window.__modal.onProjectPicked()">
          <!-- Populated dynamically by openCreateTeam(): one option per known project plus "+ Add new project" -->
        </select>
      </div>
      <div class="form-group" id="ctPathGroup" style="display:none">
        <label>New Project Path</label>
        <input type="text" id="ctPath" placeholder="/path/to/project" autocomplete="off" autocapitalize="off" spellcheck="false">
      </div>
      <p style="color:var(--text-muted);font-size:.8125rem;margin-top:8px">After creation, the team's chat panel opens. Your first message becomes the task.</p>
    </div>
    <div class="modal-footer">
      <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="window.__api.createTeam()">Create</button>
    </div>
  </div>

  <!-- Terminate Team Modal -->
  <div class="modal" id="stopModal" style="display:none" onclick="event.stopPropagation()">
    <div class="modal-header">
      <h3>Terminate team</h3>
      <button class="panel-close" onclick="closeModal()">&#10005;</button>
    </div>
    <div class="modal-body">
      <input type="hidden" id="stopTeamId">
      <p style="margin-bottom:12px">Terminate team <strong id="stopTeamLabel"></strong>?</p>
      <p style="color:var(--text-secondary);font-size:.8125rem">This terminates all running agents and marks the team cancelled. The team's on-disk state is preserved but it will be removed from the active dashboard.</p>
    </div>
    <div class="modal-footer">
      <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
      <button class="btn btn-danger" onclick="window.__api.stopTeam()">Terminate team</button>
    </div>
  </div>

  <!-- Create PR Modal -->
  <div class="modal" id="createPRModal" style="display:none" onclick="event.stopPropagation()">
    <div class="modal-header">
      <h3>Create Pull Request</h3>
      <button class="panel-close" onclick="closeModal()">&#10005;</button>
    </div>
    <div class="modal-body">
      <input type="hidden" id="prTeamId">
      <p style="margin-bottom:12px">Create a pull request for <strong id="prTeamLabel"></strong>.</p>
      <p style="color:var(--text-secondary);font-size:.8125rem;margin-bottom:12px">This will push the branch and create a PR via GitHub CLI.</p>
      <div id="prStatus" style="font-size:.8125rem;margin-top:8px"></div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
      <button class="btn btn-purple" id="prSubmitBtn" onclick="window.__api.createPR()">Create PR</button>
    </div>
  </div>

  <!-- Steer Agent Modal -->
  <div class="modal" id="steerModal" style="display:none" onclick="event.stopPropagation()">
    <div class="modal-header">
      <h3>Steer Agent</h3>
      <button class="panel-close" onclick="closeModal()">&#10005;</button>
    </div>
    <div class="modal-body">
      <input type="hidden" id="steerTeamId">
      <input type="hidden" id="steerTargetInstance">
      <p style="color:var(--text-secondary);font-size:.8125rem;margin-bottom:12px">Send a message to <strong id="steerTeamLabel"></strong>.</p>
      <div class="form-group">
        <label>Message</label>
        <textarea id="steerMessage" placeholder="Guide the agent..." rows="4"></textarea>
      </div>
      <div class="form-group">
        <label>Images (optional)</label>
        <div class="image-attach-area" id="steerImageArea">
          Drop images or click to browse
        </div>
        <input type="file" id="steerImageInput" accept="image/*" multiple style="display:none">
        <div class="image-previews"></div>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="window.__api.steerAgent()">Send</button>
    </div>
  </div>

  <!-- Security Review Modal -->
  <div class="modal" id="securityReviewModal" style="display:none" onclick="event.stopPropagation()">
    <div class="modal-header">
      <h3>Security Review</h3>
      <button class="panel-close" onclick="closeModal()">&#10005;</button>
    </div>
    <div class="modal-body">
      <input type="hidden" id="srTeamId">
      <p style="margin-bottom:12px">Run an ad-hoc security review for <strong id="srTeamLabel"></strong>.</p>
      <p style="color:var(--text-secondary);font-size:.8125rem;margin-bottom:12px">This spawns the Security agent to scan the current state of the project.</p>
      <div id="srStatus" style="font-size:.8125rem;margin-top:8px"></div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
      <button class="btn btn-amber" id="srSubmitBtn" onclick="window.__api.runSecurityReview()">Run Review</button>
    </div>
  </div>

  <!-- Claude account auth modal — drives sign-in / sign-out / env-conflict warnings -->
  <div class="modal" id="authModal" style="display:none" role="dialog" aria-modal="true" aria-labelledby="authModalTitle" onclick="event.stopPropagation()">
    <div class="modal-header">
      <h3 id="authModalTitle">Claude account</h3>
      <button class="panel-close" onclick="window.__auth.closeModal()" aria-label="Close">&#10005;</button>
    </div>
    <div class="modal-body" id="authModalBody">
      <!-- Rendered dynamically by window.__auth.renderModalBody() -->
    </div>
    <div class="modal-footer" id="authModalFooter">
      <!-- Rendered dynamically -->
    </div>
  </div>

  <!-- Delete Team Confirm Modal -->
  <div class="modal" id="deleteConfirmModal" data-confirm="true" style="display:none" role="dialog" aria-modal="true" aria-labelledby="deleteConfirmTitle" onclick="event.stopPropagation()">
    <div class="modal-header">
      <h3 id="deleteConfirmTitle">Delete team</h3>
      <button class="panel-close" onclick="window.__panel.closeConfirmDelete()" aria-label="Cancel">&#10005;</button>
    </div>
    <div class="modal-body">
      <input type="hidden" id="deleteConfirmTeamId">
      <p>Delete team <strong id="deleteConfirmTeamLabel"></strong>?</p>
      <p style="margin-top:8px;color:var(--text-muted);font-size:.8125rem">This permanently removes the team and its chat history. This cannot be undone.</p>
    </div>
    <div class="modal-footer">
      <button class="btn btn-secondary" id="deleteConfirmCancel" onclick="window.__panel.closeConfirmDelete()">Cancel</button>
      <button class="btn btn-danger" id="deleteConfirmOk" onclick="window.__panel.confirmDelete()">Delete</button>
    </div>
  </div>

  <!-- Settings Modal -->
  <div class="modal" id="settingsModal" style="display:none" onclick="event.stopPropagation()">
    <div class="modal-header">
      <h3>Settings</h3>
      <button class="panel-close" onclick="closeModal()">&#10005;</button>
    </div>
    <div class="modal-body">
      <div class="settings-section">
        <div class="setting-row">
          <label>Auto-scroll live output</label>
          <div class="toggle-switch on" id="settingAutoScroll" onclick="window.__api.toggleSetting('autoScroll')"></div>
        </div>
        <div class="setting-row">
          <label>Sound notifications</label>
          <div class="toggle-switch" id="settingSound" onclick="window.__api.toggleSetting('soundEnabled')"></div>
        </div>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-primary" onclick="closeModal()">Done</button>
    </div>
  </div>

</div>

<script>${JS}</script>
</body>
</html>`;
}
