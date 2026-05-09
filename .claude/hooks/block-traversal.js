// Blocks path traversal attempts (..) in file tool inputs.
// Runs as a PreToolUse hook.

async function main() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  const toolArgs = JSON.parse(Buffer.concat(chunks).toString());
  const filePath = toolArgs.tool_input?.file_path || toolArgs.tool_input?.path || '';

  if (filePath.includes('..')) {
    console.error(
      `Blocked: ".." is not allowed in file paths or file names. Remove ".." from "${filePath}" and try again.`,
    );
    process.exit(2);
  }
}

main();
