import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ProjectRunnerManager } from '../src/dashboard/project-runner.js';

// ProjectRunnerManager — these tests focus on framework detection (pure,
// no spawn) and on lifecycle smoke where we run a real, short, predictable
// command. Tests that needed elaborate spawn mocks were avoided — they tend
// to lie about real behavior. The lifecycle tests use the `node` binary
// (always available in CI) emitting a fake "Local: http://localhost:NNNN"
// line, which exercises the same stdout-parse / ready-event path as a real
// dev server.

function makeProject(tmpDir: string, pkg: object | null, files: Record<string, string> = {}) {
  const projDir = fs.mkdtempSync(path.join(tmpDir, 'proj-'));
  if (pkg !== null) {
    fs.writeFileSync(path.join(projDir, 'package.json'), JSON.stringify(pkg, null, 2));
  }
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(projDir, name), content);
  }
  return projDir;
}

describe('ProjectRunnerManager.detectFramework', () => {
  let tmpDir: string;
  let runner: ProjectRunnerManager;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runner-test-'));
    runner = new ProjectRunnerManager();
  });

  afterEach(async () => {
    await runner.stopAll();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('detects Storybook when @storybook/* dep and storybook script exist', () => {
    const dir = makeProject(tmpDir, {
      devDependencies: { '@storybook/react': '8.0.0' },
      scripts: { storybook: 'storybook dev -p 6006' },
    });
    const f = runner.detectFramework(dir);
    expect(f).not.toBeNull();
    expect(f?.name).toBe('storybook');
    expect(f?.command).toBe('npm');
    expect(f?.args).toEqual(['run', 'storybook']);
  });

  it('detects Next when `next` is a dep and dev script exists', () => {
    const dir = makeProject(tmpDir, {
      dependencies: { next: '14.0.0' },
      scripts: { dev: 'next dev' },
    });
    const f = runner.detectFramework(dir);
    expect(f?.name).toBe('next');
    expect(f?.args).toEqual(['run', 'dev']);
  });

  it('detects Vite over plain React when both deps are present', () => {
    const dir = makeProject(tmpDir, {
      dependencies: { react: '18.0.0' },
      devDependencies: { vite: '5.0.0' },
      scripts: { dev: 'vite' },
    });
    const f = runner.detectFramework(dir);
    expect(f?.name).toBe('vite');
  });

  it('detects Next over plain React when both deps are present', () => {
    const dir = makeProject(tmpDir, {
      dependencies: { react: '18.0.0', next: '14.0.0' },
      scripts: { dev: 'next dev' },
    });
    const f = runner.detectFramework(dir);
    expect(f?.name).toBe('next');
  });

  it('falls back to plain React with `start` script (CRA)', () => {
    const dir = makeProject(tmpDir, {
      dependencies: { react: '18.0.0' },
      scripts: { start: 'react-scripts start' },
    });
    const f = runner.detectFramework(dir);
    expect(f?.name).toBe('react');
    expect(f?.args).toEqual(['run', 'start']);
  });

  it('detects Angular', () => {
    const dir = makeProject(tmpDir, {
      dependencies: { '@angular/core': '17.0.0' },
      scripts: { start: 'ng serve' },
    });
    expect(runner.detectFramework(dir)?.name).toBe('angular');
  });

  it('detects Vue', () => {
    const dir = makeProject(tmpDir, {
      dependencies: { vue: '3.0.0' },
      scripts: { dev: 'vite' },
    });
    expect(runner.detectFramework(dir)?.name).toBe('vue');
  });

  it('detects Svelte', () => {
    const dir = makeProject(tmpDir, {
      dependencies: { svelte: '4.0.0' },
      scripts: { dev: 'vite' },
    });
    expect(runner.detectFramework(dir)?.name).toBe('svelte');
  });

  it('falls back to static-html when no package.json but index.html at root', () => {
    const dir = makeProject(tmpDir, null, { 'index.html': '<html></html>' });
    const f = runner.detectFramework(dir);
    expect(f?.name).toBe('static-html');
    expect(f?.command).toBe('python3');
    expect(f?.args).toEqual(['-m', 'http.server', '0']);
  });

  it('returns null when no package.json and no HTML at root', () => {
    const dir = makeProject(tmpDir, null);
    expect(runner.detectFramework(dir)).toBeNull();
  });

  it('returns null when package.json has no known framework and no scripts', () => {
    const dir = makeProject(tmpDir, { name: 'unknown' });
    expect(runner.detectFramework(dir)).toBeNull();
  });

  it('uses generic-dev fallback when a `dev` script exists without a recognized framework dep', () => {
    const dir = makeProject(tmpDir, {
      scripts: { dev: 'some-bundler --serve' },
    });
    const f = runner.detectFramework(dir);
    expect(f?.name).toBe('generic-dev');
  });
});

describe('ProjectRunnerManager lifecycle', () => {
  let tmpDir: string;
  let runner: ProjectRunnerManager;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'runner-life-'));
    runner = new ProjectRunnerManager();
  });

  afterEach(async () => {
    await runner.stopAll();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('idle status for an unknown project path', () => {
    const status = runner.getStatus('/nope/never/started');
    expect(status.state).toBe('idle');
    expect(status.url).toBeNull();
  });

  it("throws when project can't be detected", async () => {
    const dir = makeProject(tmpDir, null); // no package.json, no html
    await expect(runner.start(dir)).rejects.toThrow(/Couldn't detect framework/);
  });

  it('emits runner-starting then runner-ready when stdout reports a URL, and runner-stopped on stop()', async () => {
    // Build a fake project that uses `node` to print a Vite-style ready line
    // and stay alive until killed. This exercises spawn + stdout parse +
    // ready-event without depending on npm or a real framework being
    // installed in the test environment.
    const script = `
      console.log('Local:   http://localhost:54399/');
      setInterval(() => {}, 1000);
    `;
    const dir = makeProject(
      tmpDir,
      {
        name: 'fake',
        scripts: { dev: `node fake-dev.js` },
      },
      { 'fake-dev.js': script },
    );

    // Detection would call npm; bypass by faking the framework detector.
    (runner as any).detectFramework = () => ({
      name: 'fake-vite',
      command: 'node',
      args: ['fake-dev.js'],
      readyMatchers: [{ regex: /Local:\s*(https?:\/\/\S+)/i }],
    });

    const events: string[] = [];
    runner.on('runner-starting', () => events.push('starting'));
    runner.on('runner-ready', (p) => events.push(`ready:${p.url}`));
    runner.on('runner-stopped', () => events.push('stopped'));

    const status = await runner.start(dir);
    expect(status.state).toBe('starting');

    // Poll for ready (the runner emits asynchronously when stdout arrives).
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline && runner.getStatus(dir).state !== 'ready') {
      await new Promise((r) => setTimeout(r, 50));
    }
    const ready = runner.getStatus(dir);
    expect(ready.state).toBe('ready');
    expect(ready.url).toBe('http://localhost:54399/');

    await runner.stop(dir);
    expect(runner.getStatus(dir).state).toBe('idle');
    expect(events).toContain('starting');
    expect(events.some((e) => e.startsWith('ready:'))).toBe(true);
    expect(events).toContain('stopped');
  }, 15_000);

  it('emits runner-error when the child exits before becoming ready', async () => {
    const dir = makeProject(
      tmpDir,
      { name: 'fake', scripts: { dev: 'node fake.js' } },
      { 'fake.js': "console.log('boom'); process.exit(7);" },
    );
    (runner as any).detectFramework = () => ({
      name: 'fake',
      command: 'node',
      args: ['fake.js'],
      readyMatchers: [{ regex: /never matches/ }],
    });

    const errors: unknown[] = [];
    runner.on('runner-error', (e) => errors.push(e));

    await runner.start(dir);

    // Wait for exit-driven error.
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline && runner.getStatus(dir).state !== 'error') {
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(runner.getStatus(dir).state).toBe('error');
    expect(runner.getStatus(dir).lastError).toMatch(/exited/i);
    expect(errors.length).toBeGreaterThanOrEqual(1);
  }, 15_000);

  it('stopAll terminates every running project', async () => {
    const a = makeProject(
      tmpDir,
      { name: 'a', scripts: { dev: 'node a.js' } },
      { 'a.js': "console.log('Local: http://localhost:1111/'); setInterval(()=>{},1000);" },
    );
    const b = makeProject(
      tmpDir,
      { name: 'b', scripts: { dev: 'node b.js' } },
      { 'b.js': "console.log('Local: http://localhost:2222/'); setInterval(()=>{},1000);" },
    );
    (runner as any).detectFramework = (p: string) => ({
      name: 'fake',
      command: 'node',
      args: [path.basename(p) === path.basename(a) ? 'a.js' : 'b.js'],
      readyMatchers: [{ regex: /Local:\s*(https?:\/\/\S+)/i }],
    });

    await runner.start(a);
    await runner.start(b);

    // Wait for both ready.
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline && runner.getAllStatuses().some((s) => s.state !== 'ready')) {
      await new Promise((r) => setTimeout(r, 50));
    }

    await runner.stopAll();
    expect(runner.getAllStatuses()).toEqual([]);
  }, 20_000);
});
