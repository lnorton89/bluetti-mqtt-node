#!/usr/bin/env node

import { createPlatformRuntime } from "@bluetooth/runtime.js";
import {
	hasHelpFlag,
	normalizeValue,
	optionalSingleAddressArg,
} from "./args.js";
import { HelpError } from "./errors.js";
import { extractMockFlag } from "./mock-flag.js";
import { runCli } from "./process.js";
import { runPollingCommands, withConnectedDevice } from "./shared.js";

/** CLI usage text printed by `--help` or on argument errors. */
const HELP_TEXT = `Usage: bluetti-mqtt-node-poll [--mock] [BLUETOOTH_MAC]

Without an address, scan for nearby devices.
With an address, run the standard polling set and print merged parsed state as JSON.

Options:
  --mock                Use simulated devices instead of native Bluetooth
`;

/**
 * Scans without an address or performs one complete polling cycle.
 *
 * @remarks
 * Without an address argument, scans for nearby devices and prints JSON.
 * With an address, connects, runs the device's `pollingCommands` set, and
 * prints per-command and merged parsed state as JSON. With `--mock`, both
 * paths run against the simulated fleet.
 */
async function main(): Promise<void> {
	const argv = process.argv.slice(2);
	if (hasHelpFlag(argv)) {
		throw new HelpError(HELP_TEXT);
	}

	const { mock, rest } = extractMockFlag(argv);
	const address = optionalSingleAddressArg(rest, HELP_TEXT);
	if (!address) {
		const handle = createPlatformRuntime({ mock });
		try {
			const devices = await handle.runtime.discovery?.discover();
			console.log(JSON.stringify(devices ?? [], null, 2));
			return;
		} finally {
			handle.dispose();
		}
	}

	const payload = await withConnectedDevice(
		address,
		async ({ device, session }) => {
			const results = await runPollingCommands(
				session,
				device,
				device.pollingCommands,
			);
			const merged = Object.assign(
				{},
				...results.map((result) => result.parsed),
			);

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
		},
		{ mock },
	);

	console.log(JSON.stringify(payload, null, 2));
}

runCli(main);
