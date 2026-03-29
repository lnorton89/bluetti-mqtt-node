#!/usr/bin/env node

import { WindowsHelperClient, createWindowsHelperRuntime } from "../bluetooth/helper-client.js";

async function main(): Promise<void> {
  const client = new WindowsHelperClient();
  try {
    const runtime = createWindowsHelperRuntime(client);
    const devices = await runtime.discovery?.discover();
    console.log(JSON.stringify(devices ?? [], null, 2));
  } finally {
    client.dispose();
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
