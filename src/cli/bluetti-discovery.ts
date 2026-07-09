#!/usr/bin/env node

import {
	createWindowsHelperRuntime,
	WindowsHelperClient,
} from "@bluetooth/helper-client.js";
import { HelpError, hasHelpFlag, runCli } from "./shared.js";

/** CLI usage text printed by `--help`. */
const HELP_TEXT = `Usage: bluetti-mqtt-node-discovery

Scan for nearby Bluetti BLE devices and print them as JSON.
`;

/**
 * Owns the helper for one discovery operation.
 *
 * @remarks
 * Creates a {@link WindowsHelperClient}, scans for nearby BLE devices, prints
 * them as JSON, and disposes the helper.
 */
async function main(): Promise<void> {
	if (hasHelpFlag(process.argv.slice(2))) {
		throw new HelpError(HELP_TEXT);
	}

	const client = new WindowsHelperClient();
	try {
		const runtime = createWindowsHelperRuntime(client);
		const devices = await runtime.discovery?.discover();
		console.log(JSON.stringify(devices ?? [], null, 2));
	} finally {
		client.dispose();
	}
}

runCli(main);
