// Portfolio — Lightweight JSON file tracking projects in the orchestrator's view.
//
// The engine stores this in its own repo (projects.json), alongside registry.json.
// Projects are first-class: they exist independently of any teams in them. Adding
// a team for an unregistered project auto-registers the project.
//
// Atomic writes via temp-file + fs.renameSync() (same pattern as Registry).

import * as fs from 'node:fs';
import * as path from 'node:path';
import { writeJsonFileAtomic } from './atomic-write.js';

export interface Project {
  projectPath: string; // Absolute path on disk
  displayName: string; // Defaults to path's basename
  addedAt: string; // ISO-8601
}

interface PortfolioData {
  projects: Project[];
}

export class Portfolio {
  private readonly portfolioPath: string;

  constructor(portfolioPath: string) {
    this.portfolioPath = path.resolve(portfolioPath);
  }

  /**
   * Load all projects in the portfolio. Returns empty array if file doesn't exist.
   */
  load(): Project[] {
    if (!fs.existsSync(this.portfolioPath)) return [];
    try {
      const content = fs.readFileSync(this.portfolioPath, 'utf-8');
      const data = JSON.parse(content) as PortfolioData;
      return data.projects ?? [];
    } catch {
      return [];
    }
  }

  /**
   * Add a project to the portfolio. If a project with the same projectPath
   * already exists, this is a no-op (idempotent).
   */
  add(project: Project): void {
    const projects = this.load();
    const existing = projects.findIndex((p) => p.projectPath === project.projectPath);
    if (existing >= 0) return;
    projects.push(project);
    this.write(projects);
  }

  /**
   * Remove a project from the portfolio by projectPath.
   */
  remove(projectPath: string): void {
    const resolved = path.resolve(projectPath);
    const projects = this.load().filter((p) => p.projectPath !== resolved);
    this.write(projects);
  }

  /**
   * Check if a project exists in the portfolio.
   */
  has(projectPath: string): boolean {
    const resolved = path.resolve(projectPath);
    return this.load().some((p) => p.projectPath === resolved);
  }

  /**
   * Get a single project by projectPath.
   */
  get(projectPath: string): Project | undefined {
    const resolved = path.resolve(projectPath);
    return this.load().find((p) => p.projectPath === resolved);
  }

  // --- Private ---

  private write(projects: Project[]): void {
    const data: PortfolioData = { projects };
    writeJsonFileAtomic(this.portfolioPath, data);
  }
}
