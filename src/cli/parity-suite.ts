import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { normalizeValue, runPollingCommands, withConnectedDevice } from "./shared.js";

async function main(): Promise<void> {
  const [, , address] = process.argv;
  if (!address) {
    throw new Error("Usage: node dist/cli/parity-suite.js <BLUETOOTH_MAC>");
  }

  const report = await withConnectedDevice(address, async ({ device, session }) => {
    const results = await runPollingCommands(session, device, device.pollingCommands);
    const checks: CommandParityResult[] = [];

    for (const result of results) {
      const responseBase64 = Buffer.from(result.response).toString("base64");
      const tsCommandBase64 = Buffer.from(result.command.toBytes()).toString("base64");
      const tsParsed = normalizeValue(result.parsed);
      const pythonResult = await runPythonParity({
        address,
        deviceName: session.name ?? device.type,
        startingAddress: result.command.startingAddress,
        quantity: result.command.quantity,
        responseBase64,
      });
      const pythonParsed = normalizeValue(pythonResult.parsed);

      checks.push({
        startingAddress: result.command.startingAddress,
        quantity: result.command.quantity,
        commandMatches: tsCommandBase64 === pythonResult.commandBase64,
        parsedMatches: JSON.stringify(tsParsed) === JSON.stringify(pythonParsed),
        tsCommandBase64,
        pythonCommandBase64: pythonResult.commandBase64,
        tsParsed,
        pythonParsed,
      });
    }

    return {
      address,
      deviceName: session.name,
      deviceType: device.type,
      allCommandMatches: checks.every((check) => check.commandMatches),
      allParsedMatches: checks.every((check) => check.parsedMatches),
      checks,
    };
  });

  console.log(JSON.stringify(report, null, 2));
  if (!report.allCommandMatches || !report.allParsedMatches) {
    process.exitCode = 1;
  }
}

async function runPythonParity(input: {
  address: string;
  deviceName: string;
  startingAddress: number;
  quantity: number;
  responseBase64: string;
}): Promise<{ commandBase64: string; parsed: unknown }> {
  const currentDir = dirname(fileURLToPath(import.meta.url));
  const scriptPath = join(currentDir, "../../tools/python_parity.py");
  const command = process.env.BLUETTI_PYTHON ?? "python.bat";
  const args = [
    scriptPath,
    "--address", input.address,
    "--device-name", input.deviceName,
    "--starting-address", String(input.startingAddress),
    "--quantity", String(input.quantity),
    "--response-base64", input.responseBase64,
  ];

  const stdout = await runProcess(command, args);
  return JSON.parse(stdout.trim()) as { commandBase64: string; parsed: unknown };
}

function runProcess(command: string, args: readonly string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      shell: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve(stdout);
        return;
      }

      reject(new Error(stderr.trim() || `Process exited with code ${code ?? -1}`));
    });
  });
}

interface CommandParityResult {
  readonly startingAddress: number;
  readonly quantity: number;
  readonly commandMatches: boolean;
  readonly parsedMatches: boolean;
  readonly tsCommandBase64: string;
  readonly pythonCommandBase64: string;
  readonly tsParsed: unknown;
  readonly pythonParsed: unknown;
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
