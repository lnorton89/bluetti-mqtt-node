#!/usr/bin/env node

import { ReadHoldingRegisters } from "../core/commands.js";
import { normalizeValue, withConnectedDevice } from "./shared.js";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

async function main(): Promise<void> {
  const [, , address] = process.argv;
  if (!address) {
    throw new Error("Usage: node dist/cli/parity-check.js <BLUETOOTH_MAC>");
  }

  await withConnectedDevice(address, async ({ device, session }) => {
    const command = new ReadHoldingRegisters(10, 40);
    const response = await session.perform(command);
    const responseBase64 = Buffer.from(response).toString("base64");

    const tsParsed = normalizeValue(device.parse(command.startingAddress, command.parseResponse(response)));
    const tsCommandBase64 = Buffer.from(command.toBytes()).toString("base64");

    const pythonResult = await runPythonParity({
      address,
      deviceName: session.name ?? device.type,
      startingAddress: command.startingAddress,
      quantity: command.quantity,
      responseBase64,
    });
    const pythonParsed = normalizeValue(pythonResult.parsed);

    const commandMatches = tsCommandBase64 === pythonResult.commandBase64;
    const parsedMatches = JSON.stringify(tsParsed) === JSON.stringify(pythonParsed);

    console.log(JSON.stringify({
      address,
      deviceName: session.name,
      commandMatches,
      parsedMatches,
      responseBase64,
      tsCommandBase64,
      pythonCommandBase64: pythonResult.commandBase64,
      tsParsed,
      pythonParsed,
    }, null, 2));
    if (!commandMatches || !parsedMatches) {
      process.exitCode = 1;
    }
  });
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

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});

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
