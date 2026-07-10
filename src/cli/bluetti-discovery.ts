#!/usr/bin/env node

import { createRuntime } from "@bluetooth/runtime.js";
import { hasHelpFlag } from "./args.js";
import { HelpError } from "./errors.js";
import { runCli } from "./process.js";

/** CLI usage text printed by `--help`. */
const HELP_TEXT = `Usage: bluetti-mqtt-node-discovery

Scan for nearby Bluetti BLE devices and print them as JSON.
`;

/**
 * Scans for nearby BLE devices and prints them as JSON.
 *
 * @remarks
 * Creates a platform-appropriate runtime, scans for nearby BLE devices,
 * prints them as JSON, and disposes the runtime.
 */
async function main(): Promise<void> {
	if (hasHelpFlag(process.argv.slice(2))) {
		throw new HelpError(HELP_TEXT);
	}

	const runtime = await createRuntime();
	try {
		const devices = await runtime.discovery?.discover();
		console.log(JSON.stringify(devices ?? [], null, 2));
	} finally {
		runtime.dispose?.();
	}
}

runCli(main);
