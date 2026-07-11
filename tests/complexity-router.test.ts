import { describe, expect, it } from 'vitest';
import { classifyComplexity } from '../src/router/complexity-router.js';

describe('classifyComplexity', () => {
  // --- Simple tasks ---

  it('classifies short file creation as simple', () => {
    expect(classifyComplexity('Create a file called hello.txt')).toBe('simple');
  });

  it('classifies short rename as simple', () => {
    expect(classifyComplexity('Rename foo.js to bar.js')).toBe('simple');
  });

  it('classifies adding a comment as simple', () => {
    expect(classifyComplexity('Add a comment to main.ts explaining the function')).toBe('simple');
  });

  it('classifies short content creation as simple', () => {
    expect(
      classifyComplexity("Create hello.txt with the content 'Hello from ClaudeOrchestra!'"),
    ).toBe('simple');
  });

  it('classifies single-word tasks as simple', () => {
    expect(classifyComplexity('hello')).toBe('simple');
  });

  // --- Standard tasks (keyword triggers) ---

  it('classifies tasks mentioning tests as standard', () => {
    expect(classifyComplexity('Create a utility module with unit tests')).toBe('standard');
  });

  it('classifies tasks mentioning refactor as standard', () => {
    expect(classifyComplexity('Refactor the login component')).toBe('standard');
  });

  it('classifies tasks mentioning API as standard', () => {
    expect(classifyComplexity('Build an API endpoint for users')).toBe('standard');
  });

  it('classifies tasks mentioning implementation as standard', () => {
    expect(classifyComplexity('Implement user authentication')).toBe('standard');
  });

  it('classifies tasks mentioning database as standard', () => {
    expect(classifyComplexity('Add database migration for new schema')).toBe('standard');
  });

  it('classifies tasks mentioning deployment as standard', () => {
    expect(classifyComplexity('Deploy the application to production')).toBe('standard');
  });

  it('classifies tasks mentioning security as standard', () => {
    expect(classifyComplexity('Add security headers to the server')).toBe('standard');
  });

  it('classifies tasks mentioning validation as standard', () => {
    expect(classifyComplexity('Validate user input on the form')).toBe('standard');
  });

  it('classifies tasks mentioning multiple files as standard', () => {
    expect(classifyComplexity('Update multiple files in the src directory')).toBe('standard');
  });

  it('classifies tasks mentioning modules as standard', () => {
    expect(classifyComplexity('Create a new module for data processing')).toBe('standard');
  });

  // --- Destructive intent (always standard, even when short) ---

  it('routes short destructive tasks to standard', () => {
    // These are short and keyword-free by the old rules, but destructive.
    expect(classifyComplexity('delete every row in the users table')).toBe('standard');
    expect(classifyComplexity('drop the schema')).toBe('standard');
    expect(classifyComplexity('truncate the logs')).toBe('standard');
    expect(classifyComplexity('remove the old config')).toBe('standard');
    expect(classifyComplexity('reset the database')).toBe('standard');
    expect(classifyComplexity('rm -rf the cache')).toBe('standard');
    expect(classifyComplexity('rotate the API token')).toBe('standard');
  });

  it('does not misclassify words that merely contain a destructive substring', () => {
    // Whole-word matching: 'reset' in 'preset', 'drop' in 'backdrop', etc.
    expect(classifyComplexity('preset the layout')).toBe('simple');
    expect(classifyComplexity('update the backdrop image')).toBe('simple');
    expect(classifyComplexity('add a form field')).toBe('simple');
  });

  // --- Standard tasks (word count trigger) ---

  it('classifies long descriptions as standard regardless of keywords', () => {
    const longDesc =
      'Create a file in the project root directory that contains a greeting message ' +
      'and make sure the file is properly formatted with correct line endings';
    expect(classifyComplexity(longDesc)).toBe('standard');
  });

  // --- Edge cases ---

  it('is case insensitive for keywords', () => {
    expect(classifyComplexity('Run the TESTS for this module')).toBe('standard');
  });

  it('detects partial keyword matches', () => {
    // 'testing' contains 'test'
    expect(classifyComplexity('Do some testing of the app')).toBe('standard');
  });

  it('handles empty string', () => {
    expect(classifyComplexity('')).toBe('simple');
  });

  it('handles whitespace-only string', () => {
    expect(classifyComplexity('   ')).toBe('simple');
  });
});
