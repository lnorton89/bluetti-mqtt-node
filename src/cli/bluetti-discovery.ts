#!/usr/bin/env node

import { createPlatformRuntime } from "@bluetooth/runtime.js";
import { hasHelpFlag } from "./args.js";
import { HelpError, UsageError } from "./errors.js";
import { extractMockFlag } from "./mock-flag.js";
import { runCli } from "./process.js";

/** CLI usage text printed by `--help`. */
const HELP_TEXT = `Usage: bluetti-mqtt-node-discovery [--mock]

Scan for nearby Bluetti BLE devices and print them as JSON.

Options:
  --mock                Use simulated devices instead of native Bluetooth
`;

/**
 * Owns the Bluetooth runtime for one discovery operation.
 *
 * @remarks
 * Selects the platform runtime (or the simulated fleet with `--mock`), scans
 * for BLE devices, prints them as JSON, and disposes the runtime.
 */
async function main(): Promise<void> {
	const argv = process.argv.slice(2);
	if (hasHelpFlag(argv)) {
		throw new HelpError(HELP_TEXT);
	}

	const { mock, rest } = extractMockFlag(argv);
	if (rest.length > 0) {
		throw new UsageError(HELP_TEXT);
	}

	const handle = createPlatformRuntime({ mock });
	try {
		const devices = await handle.runtime.discovery?.discover();
		console.log(JSON.stringify(devices ?? [], null, 2));
	} finally {
		handle.dispose();
	}
}

runCli(main);
