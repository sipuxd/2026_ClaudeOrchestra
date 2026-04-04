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
}
html,body{height:100%;overflow:hidden}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;
  background:var(--bg);color:var(--text-primary);display:flex}
button{font-family:inherit;cursor:pointer;border:none;background:none;color:inherit}
input,textarea,select{font-family:inherit;color:var(--text-primary);background:var(--surface);
  border:1px solid var(--border);border-radius:var(--radius-sm);padding:8px 12px;outline:none;font-size:.875rem}
input:focus,textarea:focus,select:focus{border-color:var(--blue)}
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
.main-content{flex:1;height:100vh;overflow-y:auto;position:relative}
.view-container{padding:32px 40px;max-width:1400px;margin:0 auto}

/* --- Dashboard Header --- */
.dashboard-header{margin-bottom:28px}
.dashboard-header h1{font-size:1.5rem;font-weight:600;margin-bottom:4px}
.dashboard-subtitle{color:var(--text-secondary);font-size:.875rem}

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
.project-stats{display:flex;gap:6px;flex-shrink:0}
.mini-pill{font-size:.65rem;font-weight:600;padding:2px 8px;border-radius:10px}
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
.feedback-block{background:rgba(218,54,51,.08);border:1px solid rgba(218,54,51,.3);border-radius:var(--radius);
  padding:14px 16px;margin-bottom:14px}
.feedback-block-title{font-weight:600;font-size:.875rem;color:var(--red-light);margin-bottom:6px;
  display:flex;align-items:center;gap:6px}
.feedback-block-msg{color:var(--text-secondary);font-size:.8125rem;line-height:1.5;margin-bottom:10px;white-space:pre-wrap}
.feedback-block-detail{color:var(--text-muted);font-size:.75rem;margin-bottom:10px;
  max-height:120px;overflow-y:auto;white-space:pre-wrap;font-family:'SF Mono','Fira Code',monospace;
  background:var(--bg);padding:8px;border-radius:var(--radius-sm)}
.feedback-block-actions{display:flex;gap:8px;flex-wrap:wrap}

/* --- Summary Content --- */
.summary-status-top{display:flex;align-items:center;gap:16px;padding:16px;margin-bottom:16px;
  background:var(--bg);border:1px solid var(--border);border-radius:10px}
.summary-status-icon{width:44px;height:44px;border-radius:50%;display:flex;align-items:center;
  justify-content:center;font-size:1.3rem;flex-shrink:0}
.summary-status-top.pass .summary-status-icon{background:rgba(35,134,54,.12);color:var(--green)}
.summary-status-top.fail .summary-status-icon{background:rgba(218,54,51,.12);color:var(--red-light)}
.summary-task{font-size:.875rem;color:var(--text-primary);line-height:1.4}
.summary-status-text{font-size:.75rem;margin-top:4px}
.summary-actions{display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap}
.pipeline-stats{display:flex;gap:0;margin-bottom:20px;background:var(--bg);border:1px solid var(--border);border-radius:10px;padding:12px}
.pipeline-stat{text-align:center;flex:1}
.pipeline-stat-value{font-size:1.05rem;font-weight:700;color:var(--text-primary)}
.pipeline-stat-label{font-size:.65rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:.05em;margin-top:2px}

/* Expandable Agent Sections */
.agent-sections-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
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
.security-result-section h4{font-size:.8125rem;color:var(--text-muted);text-transform:uppercase;margin-bottom:8px}

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
.live-agent-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px}
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
.btn-ghost{color:var(--text-secondary);padding:6px 10px}
.btn-ghost:hover{color:var(--text-primary);background:rgba(255,255,255,.05)}
.btn-sm{padding:5px 10px;font-size:.75rem}
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
  padding:12px;font-family:'SF Mono','Fira Code',monospace;font-size:.75rem;white-space:pre-wrap;
  max-height:200px;overflow-y:auto;color:var(--text-secondary);margin-top:8px}
`;

const JS = `
(function(){
'use strict';

// ---- State ----
const state = {
  teams: {},           // teamId -> team data
  projects: {},        // projectPath -> { name, teams: Set }
  feedbacks: {},       // teamId -> [ feedback objects ]
  liveOutput: {},      // teamId -> [ { agent, text, type } ]
  currentView: 'dashboard', // 'dashboard' | 'project'
  currentProject: null,
  panelOpen: false,
  panelTeamId: null,
  panelMode: 'summary', // 'summary' | 'live'
  selectedCompact: null,
  activeFilter: null,
  projectFilter: {},   // projectPath -> filter
  settings: { autoScroll: true, soundEnabled: false },
  elapsedTimers: {},
  sseConnected: false,
  securityResults: {}, // teamId -> result string
};

// ---- Helpers ----
function esc(s) { if (!s) return ''; return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
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
function teamNeedsAttention(teamId) {
  const fb = state.feedbacks[teamId];
  return fb && fb.length > 0;
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
    state.projects[projPath] = { name: projPath.split('/').filter(Boolean).pop() || projPath, teams: new Set() };
  }
  state.projects[projPath].teams.add(teamId);
  if (!state.feedbacks[teamId]) state.feedbacks[teamId] = [];
  if (!state.liveOutput[teamId]) state.liveOutput[teamId] = [];
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

function filterTeams(teams, filter) {
  if (!filter) return teams;
  return teams.filter(function(tid) {
    var t = state.teams[tid];
    var cat = getTeamPhaseCategory(t);
    if (filter === 'attention') return cat === 'attention' || teamNeedsAttention(tid);
    return cat === filter;
  });
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
  var pi = phaseIndex(ph);
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
  var labels = ['scan','build','sweep','review','done'];
  for (var s = 0; s < 5; s++) {
    var cls = 'seg-future';
    if (ph === 'errored' || ph === 'cancelled') cls = s <= pi ? 'seg-error' : 'seg-future';
    else if (s < pi || (pi === 4)) cls = 'seg-done';
    else if (s === pi) cls = 'seg-active';
    html += '<div class="progress-segment ' + cls + '" title="' + labels[s] + '"></div>';
  }
  html += '</div>';
  // Phase labels
  html += '<div class="progress-labels">';
  for (var sl = 0; sl < 5; sl++) {
    var lblCls = '';
    if (ph === 'errored' || ph === 'cancelled') lblCls = sl <= pi ? 'lbl-error' : '';
    else if (sl < pi || (pi === 4)) lblCls = 'lbl-done';
    else if (sl === pi) lblCls = 'lbl-active';
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
  var html = '<div class="dashboard-header"><h1>Portfolio</h1>';
  html += '<p class="dashboard-subtitle">' + Object.keys(state.teams).length + ' teams across ' + Object.keys(state.projects).length + ' projects</p></div>';
  html += '<div class="stat-pills" id="globalStatPills"></div>';

  var paths = Object.keys(state.projects).sort();
  if (paths.length === 0) {
    html += '<div class="empty-state"><div class="empty-state-icon">&#9654;</div>';
    html += '<h3>No teams yet</h3><p>Create a team to get started.</p>';
    html += '<button class="btn btn-primary" onclick="window.__modal.createTeam()">+ New Team</button></div>';
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
    // Per-project stat pills
    var pStats = getProjectStats(p);
    html += '<div class="project-stats">';
    if (pStats.attention > 0) html += '<span class="mini-pill pill-error">' + pStats.attention + ' errored</span>';
    if (pStats.active > 0) html += '<span class="mini-pill pill-active">' + pStats.active + ' active</span>';
    if (pStats.review > 0) html += '<span class="mini-pill pill-review">' + pStats.review + ' review</span>';
    if (pStats.pr > 0) html += '<span class="mini-pill pill-pr">' + pStats.pr + ' PR open</span>';
    if (pStats.done > 0) html += '<span class="mini-pill pill-done">' + pStats.done + ' done</span>';
    html += '</div>';
    html += '</div>';
    html += '<div class="team-grid">';
    for (var j = 0; j < filtered.length; j++) {
      html += renderTeamCard(filtered[j], false);
    }
    if (filtered.length === 0) {
      html += '<div style="color:var(--text-muted);font-size:.8125rem;padding:8px">No teams match filter</div>';
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
  html += '<h1>' + esc(proj.name) + '</h1></div>';
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
  var html = '<div class="inline-detail">';
  html += '<div class="inline-detail-header"><h3>' + esc(t.teamName || teamId) + '</h3></div>';
  // Feedback blocks
  html += renderFeedbackBlocks(teamId);
  // Summary info
  html += renderSummaryContent(teamId);
  html += '</div>';
  return html;
}

// ---- Render: Feedback Blocks ----
function renderFeedbackBlocks(teamId) {
  var fbs = state.feedbacks[teamId];
  if (!fbs || fbs.length === 0) return '';
  var html = '';
  for (var i = 0; i < fbs.length; i++) {
    var fb = fbs[i];
    html += '<div class="feedback-block">';
    html += '<div class="feedback-block-title">&#9888; ' + esc(fb.title || 'Action Required') + '</div>';
    html += '<div class="feedback-block-msg">' + esc(fb.message) + '</div>';
    if (fb.detail) {
      html += '<div class="feedback-block-detail">' + esc(fb.detail) + '</div>';
    }
    html += '<div class="feedback-block-actions">';
    if (fb.actions && fb.actions.length > 0) {
      for (var a = 0; a < fb.actions.length; a++) {
        var act = fb.actions[a];
        html += '<button class="btn btn-sm btn-primary" onclick="window.__api.respondFeedback(\\'' + esc(teamId) + '\\',\\'' + esc(fb.id) + '\\',\\'' + esc(act.value) + '\\')">' + esc(act.label) + '</button>';
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
  if (ph !== 'done' && ph !== 'merged' && ph !== 'cancelled') {
    html += '<button class="btn btn-sm btn-secondary" onclick="window.__modal.steerAgent(\\'' + esc(teamId) + '\\')">Steer</button>';
    html += '<button class="btn btn-sm btn-danger" onclick="window.__modal.stopPipeline(\\'' + esc(teamId) + '\\')">Stop</button>';
  }
  if (ph === 'done') {
    html += '<button class="btn btn-sm btn-purple" onclick="window.__modal.createPR(\\'' + esc(teamId) + '\\')">Create PR</button>';
    html += '<button class="btn btn-sm btn-secondary" onclick="window.__modal.securityReview(\\'' + esc(teamId) + '\\')">Security Review</button>';
  }
  if (ph === 'pr_open' && t.prUrl) {
    html += '<a href="' + esc(t.prUrl) + '" target="_blank" class="btn btn-sm btn-purple">View PR #' + (t.prNumber||'') + '</a>';
  }
  if (!t.currentTask && ph !== 'done' && ph !== 'merged' && ph !== 'pr_open') {
    html += '<button class="btn btn-sm btn-green" onclick="window.__modal.assignTask(\\'' + esc(teamId) + '\\')">Assign Task</button>';
  }
  return html;
}

// ---- Render: Summary Content ----
function renderSummaryContent(teamId) {
  var t = state.teams[teamId];
  if (!t) return '';
  var ph = t.currentPhase || 'pre_work';
  var pi = phaseIndex(ph);
  var panelTaskText = t.currentTask ? (t.currentTask.description || t.currentTask).toString() : '';
  var statusInfo = getCardStatusInfo(ph, teamNeedsAttention(teamId), teamId);
  var isDone = ph === 'done' || ph === 'errored' || ph === 'cancelled' || ph === 'merged';

  // Status summary top
  var statusIcon = isDone && ph === 'done' ? '&#10003;' : ph === 'errored' ? '&#10007;' : '&#9888;';
  var statusClass = ph === 'done' || ph === 'merged' ? 'pass' : 'fail';
  var statusText = ph === 'done' ? 'All gates passed' :
    ph === 'errored' ? 'Pipeline errored in ' + phaseLabel(ph) + ' phase' :
    ph === 'pr_open' ? 'PR created — awaiting merge' :
    statusInfo.label;

  var html = '<div class="summary-status-top ' + statusClass + '">';
  html += '<div class="summary-status-icon">' + statusIcon + '</div>';
  html += '<div class="summary-status-info"><div class="summary-task">' + esc(panelTaskText || 'No task assigned') + '</div>';
  html += '<div class="summary-status-text" style="color:' + (statusClass==='pass'?'var(--green)':'var(--red-light)') + '">' + statusText + '</div></div></div>';

  // Action buttons
  html += '<div class="summary-actions">' + renderTeamActionButtons(teamId) + '</div>';

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
    var ag = t.agents ? t.agents[inst] : null;
    var agState = ag ? ag.state : 'spawning';
    var agOutput = (state.liveOutput[teamId] || []).filter(function(e){ return e.agent === inst; }).map(function(e){ return e.text; }).join('\\n');
    var verdict = getAgentVerdict(agOutput, inst);
    var verdictStyle = getVerdictStyle(verdict);

    html += '<div class="agent-section" onclick="toggleAgentSection(this)">';
    html += '<div class="agent-section-header">';
    html += '<span class="agent-chevron">&#9654;</span>';
    html += '<span class="agent-dot-sm" style="background:' + agentColors[inst] + '"></span>';
    html += '<span class="agent-name">' + inst + '</span>';
    html += '<span class="agent-verdict" style="' + verdictStyle + '">' + esc(verdict) + '</span>';
    html += '</div>';
    html += '<div class="agent-section-body">';
    html += '<pre class="agent-output">' + esc(agOutput || agState) + '</pre>';
    html += '</div></div>';
  }
  html += '</div>';

  // Security review result
  if (state.securityResults[teamId]) {
    html += '<div class="security-result-section"><h4>Security Review</h4>';
    html += '<pre class="security-result">' + esc(state.securityResults[teamId]) + '</pre></div>';
  }

  return html;
}

function getAgentVerdict(output, instance) {
  if (!output) return 'PENDING';
  if (output.match(/APPROVED/i)) return 'APPROVED';
  if (output.match(/REVISION.NEEDED/i)) return 'REVISION_NEEDED';
  if (output.match(/REJECTED/i)) return 'REJECTED';
  if (output.match(/BLOCKED/i)) return 'BLOCKED';
  if (output.match(/COMPLETE/i)) return 'Complete';
  if (output.match(/ERRORED|error/i) && instance !== 'Security-1') return 'ERRORED';
  if (output.match(/SKIPPED/i)) return 'SKIPPED';
  var metMatch = output.match(new RegExp('\\\\d+/\\\\d+\\\\s*met','i'));
  if (metMatch) return metMatch[0];
  return 'PENDING';
}

function getVerdictStyle(verdict) {
  if (verdict === 'APPROVED' || verdict === 'Complete' || verdict.includes('met')) return 'background:rgba(63,185,80,.12);color:var(--green)';
  if (verdict === 'SKIPPED' || verdict === 'PENDING') return 'background:rgba(72,79,88,.12);color:var(--text-muted)';
  if (verdict === 'ERRORED' || verdict === 'BLOCKED' || verdict === 'REJECTED') return 'background:rgba(218,54,51,.12);color:var(--red-light)';
  return 'background:rgba(210,153,34,.12);color:var(--amber)';
}

window.toggleAgentSection = function(el) {
  el.classList.toggle('expanded');
};

// ---- Render: Live Content ----
function renderLiveContent(teamId) {
  var t = state.teams[teamId];
  if (!t) return '';
  var ph = t.currentPhase || 'pre_work';
  var pi = phaseIndex(ph);
  var panelTaskText = t.currentTask ? (t.currentTask.description || t.currentTask).toString() : '';

  // Task + elapsed
  var html = '<div class="live-header">';
  html += '<div class="live-task">' + esc(panelTaskText || 'No task') + '</div>';
  html += '<div class="live-elapsed card-elapsed" data-created="' + (t.createdAt||'') + '">' + elapsedSince(t.createdAt) + '</div>';
  html += '</div>';

  // Phase bar with dots
  html += '<div class="live-phase-bar">';
  var labels = ['scan','build','sweep','review','done'];
  for (var s = 0; s < 5; s++) {
    var dotCls = '';
    if (s < pi || pi === 4) dotCls = 'past';
    else if (s === pi) dotCls = 'current';
    html += '<div class="live-phase-step">';
    html += '<div class="live-dot ' + dotCls + '">' + (dotCls==='past'?'&#10003;':(s+1)) + '</div>';
    html += '<div class="live-dot-label ' + dotCls + '">' + labels[s] + '</div></div>';
    if (s < 4) html += '<div class="live-connector ' + (s < pi ? 'past' : '') + '"></div>';
  }
  html += '</div>';

  // 2x2 agent cards
  var agentInstances = ['Security-1','Worker-1','Worker-2','Reviewer-1'];
  var agentColors = { 'Security-1':'#f85149', 'Worker-1':'#3fb950', 'Worker-2':'#3fb950', 'Reviewer-1':'#d2a8ff' };
  html += '<div class="live-agent-grid">';
  for (var a = 0; a < 4; a++) {
    var inst = agentInstances[a];
    var ag = t.agents ? t.agents[inst] : null;
    var agState = ag ? ag.state : 'spawning';
    var isWorking = agState === 'active';
    var isDone = agState === 'done';
    var color = agentColors[inst];
    var output = '';
    var entries = state.liveOutput[teamId] || [];
    for (var ei = entries.length - 1; ei >= 0; ei--) {
      if (entries[ei].agent === inst) { output = entries[ei].text; break; }
    }

    html += '<div class="live-agent-card' + (isWorking ? ' active-agent' : '') + '" style="--agent-color:' + color + '">';
    html += '<div class="live-agent-header">';
    html += '<span class="live-agent-dot ' + (isWorking ? 'working' : isDone ? 'done' : '') + '"></span>';
    html += '<span class="live-agent-name">' + inst + '</span>';
    html += '<span class="live-agent-status" style="color:' + (isWorking ? color : 'var(--text-muted)') + '">' + agState.toUpperCase() + '</span>';
    html += '</div>';
    html += '<div class="live-agent-progress"><div class="live-agent-fill" style="width:' + (isDone ? 100 : isWorking ? 50 : 0) + '%;background:' + color + '"></div></div>';
    html += '<div class="live-agent-output">' + esc(output || (agState === 'spawning' ? 'Waiting...' : '')) + '</div>';
    html += '</div>';
  }
  html += '</div>';

  // Stop + Steer buttons
  html += '<div class="live-actions">';
  html += '<button class="btn btn-danger" style="flex:1" onclick="window.__modal.stopPipeline(\\'' + esc(teamId) + '\\')">Stop Pipeline</button>';
  html += '<button class="btn btn-secondary" style="flex:1" onclick="window.__modal.steerAgent(\\'' + esc(teamId) + '\\')">Steer Agent</button>';
  html += '</div>';

  return html;
}

// ---- Render: Panel ----
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

  var t = state.teams[state.panelTeamId];
  $('panelTitle').textContent = t ? (t.teamName || state.panelTeamId) : state.panelTeamId;

  // Tab highlight
  qsa('.panel-tab').forEach(function(tab) {
    tab.classList.toggle('active', tab.dataset.mode === state.panelMode);
  });

  var body = $('panelBody');
  var html = '';
  // Always show feedback blocks at top
  html += renderFeedbackBlocks(state.panelTeamId);

  if (state.panelMode === 'summary') {
    html += renderSummaryContent(state.panelTeamId);
  } else {
    html += '<div class="live-output" id="liveOutputArea">' + renderLiveContent(state.panelTeamId) + '</div>';
  }
  body.innerHTML = html;

  if (state.panelMode === 'live' && state.settings.autoScroll) {
    var liveArea = $('liveOutputArea');
    if (liveArea) liveArea.scrollTop = liveArea.scrollHeight;
  }
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

// ---- Navigation ----
window.__nav = {
  goToDashboard: function() {
    state.currentView = 'dashboard';
    state.currentProject = null;
    state.selectedCompact = null;
    renderCurrentView();
  },
  goToProject: function(projPath) {
    state.currentView = 'project';
    state.currentProject = projPath;
    state.selectedCompact = null;
    renderCurrentView();
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
    state.panelMode = 'summary';
    renderPanel();
  },
  closePanel: function() {
    state.panelOpen = false;
    state.panelTeamId = null;
    renderPanel();
  },
  switchPanelMode: function(mode) {
    state.panelMode = mode;
    renderPanel();
  }
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
  createTeam: function() {
    openModal('createTeamModal');
    $('ctName').value = '';
    $('ctPath').value = '';
    $('ctTask').value = '';
    setTimeout(function() { $('ctName').focus(); }, 100);
  },
  assignTask: function(teamId) {
    openModal('assignTaskModal');
    $('atTeamId').value = teamId;
    $('atTask').value = '';
    $('atTeamLabel').textContent = teamId;
  },
  stopPipeline: function(teamId) {
    openModal('stopModal');
    $('stopTeamId').value = teamId;
    $('stopTeamLabel').textContent = state.teams[teamId] ? (state.teams[teamId].teamName || teamId) : teamId;
  },
  createPR: function(teamId) {
    openModal('createPRModal');
    $('prTeamId').value = teamId;
    $('prTeamLabel').textContent = state.teams[teamId] ? (state.teams[teamId].teamName || teamId) : teamId;
    $('prStatus').textContent = '';
    $('prSubmitBtn').disabled = false;
  },
  steerAgent: function(teamId) {
    openModal('steerModal');
    $('steerTeamId').value = teamId;
    $('steerMessage').value = '';
    $('steerTeamLabel').textContent = state.teams[teamId] ? (state.teams[teamId].teamName || teamId) : teamId;
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
  pickDirectory: function() {
    fetch('/api/pick-directory', { method: 'POST' })
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (!data.cancelled && data.path) {
          $('ctPath').value = data.path;
        }
      })
      .catch(function() {
        showToast('Could not open folder picker', 'error');
      });
  }
};

// ---- API Calls ----
window.__api = {
  createTeam: function() {
    var name = $('ctName').value.trim();
    var projectPath = $('ctPath').value.trim();
    var task = $('ctTask').value.trim();
    if (!name || !projectPath) {
      showToast('Name and project path are required', 'error');
      return;
    }
    var body = { name: name, projectPath: projectPath };
    if (task) body.task = task;
    if (attachedImages.length > 0) body.images = attachedImages;
    fetch('/api/teams', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function(r) {
      if (!r.ok) return r.json().then(function(d){ throw new Error(d.error || 'Failed'); });
      return r.json();
    }).then(function(data) {
      closeModal();
      showToast('Team "' + name + '" created');
    }).catch(function(e) {
      showToast(e.message, 'error');
    });
  },
  assignTask: function() {
    var teamId = $('atTeamId').value;
    var description = $('atTask').value.trim();
    if (!description) {
      showToast('Task description is required', 'error');
      return;
    }
    var body = { description: description };
    if (attachedImages.length > 0) body.images = attachedImages;
    fetch('/api/teams/' + encodeURIComponent(teamId) + '/task', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function(r) {
      if (!r.ok) return r.json().then(function(d){ throw new Error(d.error||'Failed'); });
      return r.json();
    }).then(function() {
      closeModal();
      showToast('Task assigned');
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
    var message = $('steerMessage').value.trim();
    if (!message) {
      showToast('Message is required', 'error');
      return;
    }
    var body = { message: message };
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
  respondFeedback: function(teamId, feedbackId, value) {
    fetch('/api/teams/' + encodeURIComponent(teamId) + '/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ feedbackId: feedbackId, value: value })
    }).then(function(r) {
      if (!r.ok) return r.json().then(function(d){ throw new Error(d.error||'Failed'); });
      return r.json();
    }).then(function() {
      // Remove the feedback from state
      var fbs = state.feedbacks[teamId];
      if (fbs) {
        state.feedbacks[teamId] = fbs.filter(function(f){ return f.id !== feedbackId; });
      }
      showToast('Feedback sent');
      renderCurrentView();
    }).catch(function(e) {
      showToast(e.message, 'error');
    });
  },
  toggleSetting: function(key) {
    state.settings[key] = !state.settings[key];
    var toggle = $(key === 'autoScroll' ? 'settingAutoScroll' : 'settingSound');
    if (toggle) toggle.classList.toggle('on', state.settings[key]);
  }
};

// ---- SSE Connection ----
function connectSSE() {
  var es = new EventSource('/events');
  es.addEventListener('init', function(e) {
    try {
      var data = JSON.parse(e.data);
      state.sseConnected = true;
      if (data.teams) {
        for (var i = 0; i < data.teams.length; i++) {
          var t = data.teams[i];
          addOrUpdateTeam(t.teamId || t.teamName, t);
        }
      }
      renderCurrentView();
    } catch(err) {
      console.error('[SSE init] Error:', err);
    }
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
    if (state.panelOpen && state.panelTeamId === data.teamId && state.panelMode === 'live') {
      renderPanel();
    }
  });

  es.addEventListener('agent-progress', function(e) {
    var data = JSON.parse(e.data);
    if (!state.liveOutput[data.teamId]) state.liveOutput[data.teamId] = [];
    state.liveOutput[data.teamId].push({ agent: data.instance, text: data.text, type: 'progress' });
    if (state.liveOutput[data.teamId].length > 500) {
      state.liveOutput[data.teamId] = state.liveOutput[data.teamId].slice(-500);
    }
    // Update agent status
    if (state.teams[data.teamId] && state.teams[data.teamId].agents) {
      var ag = state.teams[data.teamId].agents[data.instance];
      if (ag) ag.state = 'active';
    }
    if (state.panelOpen && state.panelTeamId === data.teamId && state.panelMode === 'live') {
      renderPanel();
    }
  });

  es.addEventListener('agent-task', function(e) {
    var data = JSON.parse(e.data);
    if (!state.liveOutput[data.teamId]) state.liveOutput[data.teamId] = [];
    state.liveOutput[data.teamId].push({ agent: data.instance, text: 'Subtask: ' + data.subtask, type: 'output' });
    if (state.panelOpen && state.panelTeamId === data.teamId && state.panelMode === 'live') {
      renderPanel();
    }
  });

  es.addEventListener('task-complete', function(e) {
    var data = JSON.parse(e.data);
    if (state.teams[data.teamId]) {
      state.teams[data.teamId].lastPhaseDuration = data.durationMs;
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
    if (!state.feedbacks[data.teamId]) state.feedbacks[data.teamId] = [];
    // Avoid duplicates
    var existing = state.feedbacks[data.teamId].find(function(f){ return f.id === data.id; });
    if (!existing) {
      state.feedbacks[data.teamId].push({
        id: data.id, type: data.type, title: data.title, message: data.message,
        blocking: data.blocking, actions: data.actions, detail: data.detail, timestamp: data.timestamp
      });
    }
    renderCurrentView();
  });

  es.addEventListener('security-review', function(e) {
    var data = JSON.parse(e.data);
    if (data.result) {
      state.securityResults[data.teamId] = data.result;
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
  if (e.key === 'Escape') {
    if (currentModal) {
      closeModal();
    } else if (state.panelOpen) {
      window.__nav.closePanel();
    }
  }
});

// ---- Init ----
renderCurrentView();
connectSSE();

// Setup image areas after DOM ready
// Expose closeModal/openModal to inline HTML onclick handlers
window.closeModal = closeModal;
window.openModal = openModal;

setTimeout(function() {
  setupImageArea('ctImageArea', 'ctImageInput');
  setupImageArea('atImageArea', 'atImageInput');
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
  <div class="view-container" id="viewContainer"></div>
</main>

<!-- Slide-in Panel -->
<div class="panel-overlay" id="panelOverlay" onclick="window.__nav.closePanel()"></div>
<div class="slide-panel" id="slidePanel">
  <div class="panel-header">
    <h3 id="panelTitle"></h3>
    <button class="panel-close" onclick="window.__nav.closePanel()">&#10005;</button>
  </div>
  <div class="panel-tabs">
    <div class="panel-tab active" data-mode="summary" onclick="window.__nav.switchPanelMode('summary')">Summary</div>
    <div class="panel-tab" data-mode="live" onclick="window.__nav.switchPanelMode('live')">Live</div>
  </div>
  <div class="panel-body" id="panelBody"></div>
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
        <input type="text" id="ctName" placeholder="my-feature-team">
      </div>
      <div class="form-group">
        <label>Project Path</label>
        <div class="folder-picker">
          <input type="text" id="ctPath" placeholder="/path/to/project">
          <button class="btn btn-secondary" onclick="window.__modal.pickDirectory()">Browse</button>
        </div>
      </div>
      <div class="form-group">
        <label>Task (optional)</label>
        <textarea id="ctTask" placeholder="Describe the task to assign immediately..."></textarea>
      </div>
      <div class="form-group">
        <label>Images (optional)</label>
        <div class="image-attach-area" id="ctImageArea">
          Drop images here or click to browse<br><span style="font-size:.75rem;color:var(--text-muted)">You can also paste from clipboard</span>
        </div>
        <input type="file" id="ctImageInput" accept="image/*" multiple style="display:none">
        <div class="image-previews"></div>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="window.__api.createTeam()">Create</button>
    </div>
  </div>

  <!-- Assign Task Modal -->
  <div class="modal" id="assignTaskModal" style="display:none" onclick="event.stopPropagation()">
    <div class="modal-header">
      <h3>Assign Task</h3>
      <button class="panel-close" onclick="closeModal()">&#10005;</button>
    </div>
    <div class="modal-body">
      <input type="hidden" id="atTeamId">
      <p style="color:var(--text-secondary);font-size:.8125rem;margin-bottom:12px">Team: <strong id="atTeamLabel"></strong></p>
      <div class="form-group">
        <label>Task Description</label>
        <textarea id="atTask" placeholder="Describe the task..." rows="4"></textarea>
      </div>
      <div class="form-group">
        <label>Images (optional)</label>
        <div class="image-attach-area" id="atImageArea">
          Drop images or click to browse
        </div>
        <input type="file" id="atImageInput" accept="image/*" multiple style="display:none">
        <div class="image-previews"></div>
      </div>
    </div>
    <div class="modal-footer">
      <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
      <button class="btn btn-primary" onclick="window.__api.assignTask()">Assign</button>
    </div>
  </div>

  <!-- Stop Pipeline Modal -->
  <div class="modal" id="stopModal" style="display:none" onclick="event.stopPropagation()">
    <div class="modal-header">
      <h3>Stop Pipeline</h3>
      <button class="panel-close" onclick="closeModal()">&#10005;</button>
    </div>
    <div class="modal-body">
      <input type="hidden" id="stopTeamId">
      <p style="margin-bottom:12px">Are you sure you want to stop the pipeline for <strong id="stopTeamLabel"></strong>?</p>
      <p style="color:var(--text-secondary);font-size:.8125rem">This will terminate all running agents. The team state will be set to cancelled.</p>
    </div>
    <div class="modal-footer">
      <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
      <button class="btn btn-danger" onclick="window.__api.stopTeam()">Stop Pipeline</button>
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
      <p style="color:var(--text-secondary);font-size:.8125rem;margin-bottom:12px">Send a message to the active agent on <strong id="steerTeamLabel"></strong>.</p>
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
