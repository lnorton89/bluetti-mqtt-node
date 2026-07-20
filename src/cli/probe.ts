#!/usr/bin/env node

import { DeviceSession } from "@bluetooth/device-session.js";
import { createPlatformRuntime } from "@bluetooth/runtime.js";
import type { BluetoothTransport } from "@bluetooth/transport.js";
import { ReadHoldingRegisters } from "@core/commands.js";
import { createDeviceFromAdvertisement } from "@devices/registry.js";
import { hasHelpFlag, optionalSingleAddressArg } from "./args.js";
import { HelpError } from "./errors.js";
import { extractMockFlag } from "./mock-flag.js";
import { runCli } from "./process.js";

/** CLI usage text printed by `--help` or on argument errors. */
const HELP_TEXT = `Usage: bluetti-mqtt-node-probe [--mock] [BLUETOOTH_MAC]

Without an address, scan for nearby devices.
With an address, connect and run a single register-read probe.

Options:
  --mock                Use simulated devices instead of native Bluetooth
`;

/**
 * Scans without an address or performs one minimal register read.
 *
 * @remarks
 * Without an address argument, scans for nearby devices and prints JSON.
 * With an address, connects, reads the device name, executes
 * `ReadHoldingRegisters(10, 40)`, and prints the parsed result.
 */
async function main(): Promise<void> {
	const argv = process.argv.slice(2);
	if (hasHelpFlag(argv)) {
		throw new HelpError(HELP_TEXT);
	}

	const { mock, rest } = extractMockFlag(argv);
	const address = optionalSingleAddressArg(rest, HELP_TEXT);

	const handle = createPlatformRuntime({ mock });
	let transport: BluetoothTransport | null = null;
	let cleanupComplete = false;
	const cleanup = async (reportDisconnectError: boolean): Promise<void> => {
		if (cleanupComplete) {
			return;
		}

		cleanupComplete = true;
		if (transport !== null) {
			try {
				await transport.disconnect();
			} catch (error) {
				if (reportDisconnectError) {
					throw error;
				}
			}
		}
		handle.dispose();
	};

	try {
		if (!address) {
			const devices = await handle.runtime.discovery?.discover();
			console.log(JSON.stringify(devices ?? [], null, 2));
			await cleanup(true);
			return;
		}

		transport = handle.runtime.transportFactory.create();
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
		const parsed = device.parse(
			command.startingAddress,
			command.parseResponse(response),
		);
		console.log(JSON.stringify(parsed, bigintReplacer, 2));
		await cleanup(true);
	} catch (error) {
		await cleanup(false);
		throw error;
	}
}

runCli(main);

/**
 * JSON.stringify replacer that converts `bigint` values to strings.
 *
 * @param _key - Object key (unused).
 * @param value - Value to convert.
 * @returns String representation for `bigint`, otherwise the value unchanged.
 */
function bigintReplacer(_key: string, value: unknown): unknown {
	return typeof value === "bigint" ? value.toString() : value;
}
