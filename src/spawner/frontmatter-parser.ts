// Parses YAML-like frontmatter from agent .md files.
// No external dependencies — simple line-by-line key: value parsing.
// Frontmatter is delimited by --- markers at the start of the file.

export interface ParsedAgentFile {
  frontmatter: Record<string, string>;
  body: string;
}

export function parseFrontmatter(content: string): ParsedAgentFile {
  const lines = content.split('\n');

  // Must start with ---
  if (lines[0]?.trim() !== '---') {
    return { frontmatter: {}, body: content };
  }

  // Find closing ---
  let closingIndex = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      closingIndex = i;
      break;
    }
  }

  if (closingIndex === -1) {
    return { frontmatter: {}, body: content };
  }

  // Parse key: value pairs between the markers
  const frontmatter: Record<string, string> = {};
  for (let i = 1; i < closingIndex; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith('#')) continue;

    const colonIndex = line.indexOf(':');
    if (colonIndex === -1) continue;

    const key = line.substring(0, colonIndex).trim();
    const value = line.substring(colonIndex + 1).trim();
    frontmatter[key] = value;
  }

  // Everything after the closing --- is the body
  const body = lines
    .slice(closingIndex + 1)
    .join('\n')
    .replace(/^\n+/, '');

  return { frontmatter, body };
}
