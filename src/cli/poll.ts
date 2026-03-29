import { WindowsHelperClient, createWindowsHelperRuntime } from "../bluetooth/helper-client.js";
import { normalizeValue, runPollingCommands, withConnectedDevice } from "./shared.js";

async function main(): Promise<void> {
  const [, , address] = process.argv;
  if (!address) {
    const client = new WindowsHelperClient();
    try {
      const runtime = createWindowsHelperRuntime(client);
      const devices = await runtime.discovery?.discover();
      console.log(JSON.stringify(devices ?? [], null, 2));
      return;
    } finally {
      client.dispose();
    }
  }

  const payload = await withConnectedDevice(address, async ({ device, session }) => {
    const results = await runPollingCommands(session, device, device.pollingCommands);
    const merged = Object.assign({}, ...results.map((result) => result.parsed));

    return {
      address,
      deviceName: session.name,
      deviceType: device.type,
      commands: results.map((result) => ({
        startingAddress: result.command.startingAddress,
        quantity: result.command.quantity,
        responseBase64: Buffer.from(result.response).toString("base64"),
        parsed: normalizeValue(result.parsed),
      })),
      merged: normalizeValue(merged),
    };
  });

  console.log(JSON.stringify(payload, null, 2));
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
