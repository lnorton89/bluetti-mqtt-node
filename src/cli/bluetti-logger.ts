import { normalizeValue, runPollingCommands, withConnectedDevice } from "./shared.js";

async function main(): Promise<void> {
  const [, , address] = process.argv;
  if (!address) {
    throw new Error("Usage: node dist/cli/bluetti-logger.js <BLUETOOTH_MAC>");
  }

  const payload = await withConnectedDevice(address, async ({ device, session }) => {
    const results = await runPollingCommands(session, device, device.loggingCommands);
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
    };
  });

  console.log(JSON.stringify(payload, null, 2));
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
