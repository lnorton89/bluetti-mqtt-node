#!/usr/bin/env node

import { DeviceSession } from "../bluetooth/device-session.js";
import { WindowsHelperClient, createWindowsHelperRuntime } from "../bluetooth/helper-client.js";
import { ReadHoldingRegisters } from "../core/commands.js";
import { createDeviceFromAdvertisement } from "../devices/registry.js";
import { hasHelpFlag, HelpError, optionalSingleAddressArg, runCli } from "./shared.js";

const HELP_TEXT = `Usage: bluetti-mqtt-node-probe [BLUETOOTH_MAC]

Without an address, scan for nearby devices.
With an address, connect and run a single register-read probe.
`;

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (hasHelpFlag(argv)) {
    throw new HelpError(HELP_TEXT);
  }

  const address = optionalSingleAddressArg(argv, HELP_TEXT);

  const client = new WindowsHelperClient();
  try {
    const runtime = createWindowsHelperRuntime(client);
    if (!address) {
      const devices = await runtime.discovery?.discover();
      console.log(JSON.stringify(devices ?? [], null, 2));
      return;
    }

    const transport = runtime.transportFactory.create();
    const session = new DeviceSession(address, transport);
    await session.connectAndInitialize();

    if (session.name === null) {
      throw new Error("Connected device did not report a name");
    }

    console.log(`Connected to ${session.name} at ${address}`);

    const command = new ReadHoldingRegisters(10, 40);
    const response = await session.perform(command);
    console.log(`Received ${response.length} bytes`);

    const device = createDeviceFromAdvertisement(address, session.name);
    const parsed = device.parse(command.startingAddress, command.parseResponse(response));
    console.log(JSON.stringify(parsed, bigintReplacer, 2));
    await transport.disconnect();
  } finally {
    client.dispose();
  }
}

runCli(main);

function bigintReplacer(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value;
}
