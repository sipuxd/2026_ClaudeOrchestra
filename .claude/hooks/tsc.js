import { execSync } from "child_process";

// Read the JSON payload from stdin
async function readInput() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString());
}

async function main() {
  const input = await readInput();
  const file =
    input.tool_response?.filePath ||
    input.tool_input?.file_path;

  // Only check TypeScript files
  if (!file || !/\.(ts|tsx)$/.test(file)) {
    process.exit(0);
  }

  try {
    execSync("npx tsc --noEmit --incremental --tsBuildInfoFile .claude/.tsbuildinfo", {
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 30000,
    });
  } catch (err) {
    const output = err.stderr?.toString() || err.stdout?.toString() || "";
    if (output) {
      console.error(output);
    }
    process.exit(2);
  }
}

main();
