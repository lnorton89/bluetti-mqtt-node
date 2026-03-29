#!/usr/bin/env node

import { normalizeValue, requireSingleAddressArg, runCli, runPollingCommands, withConnectedDevice } from "./shared.js";

const HELP_TEXT = `Usage: bluetti-mqtt-node-logger <BLUETOOTH_MAC>

Run the device logging command set and print parsed results as JSON.
`;

async function main(): Promise<void> {
  const address = requireSingleAddressArg(process.argv.slice(2), HELP_TEXT);

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

runCli(main);
