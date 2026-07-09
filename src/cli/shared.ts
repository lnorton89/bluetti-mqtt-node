import { DeviceSession } from "@bluetooth/device-session.js";
import {
	createWindowsHelperRuntime,
	WindowsHelperClient,
} from "@bluetooth/helper-client.js";
import type { BluetoothTransport } from "@bluetooth/transport.js";
import type { ReadHoldingRegisters } from "@core/commands.js";
import type { BluettiDevice } from "@devices/device.js";
import { createDeviceFromAdvertisement } from "@devices/registry.js";

/**
 * Runs work with one initialized device and always releases native resources.
 *
 * @param address - Bluetooth MAC address to connect.
 * @param work - Callback receiving the connected device context.
 * @returns The result of `work`.
 * @throws {Error} When connection or initialization fails.
 *
 * @remarks
 * The original operation error takes precedence over a secondary disconnect
 * failure; successful work still reports disconnect failures to the caller.
 * The helper client is always disposed during cleanup.
 *
 * @see ConnectedDeviceContext
 */
export async function withConnectedDevice<T>(
	address: string,
	work: (context: ConnectedDeviceContext) => Promise<T>,
): Promise<T> {
	const client = new WindowsHelperClient();
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
		client.dispose();
	};

	try {
		const runtime = createWindowsHelperRuntime(client);
		transport = runtime.transportFactory.create();
		const session = new DeviceSession(address, transport);
		await session.connectAndInitialize();

		if (session.name === null) {
			throw new Error("Connected device did not report a name");
		}

		const device = createDeviceFromAdvertisement(address, session.name);
		const result = await work({ address, session, device });
		await cleanup(true);
		return result;
	} catch (error) {
		await cleanup(false);
		throw error;
	}
}

/**
 * Executes and decodes a list of read commands in order.
 *
 * @param session - Initialized device session.
 * @param device - Device model for field decoding.
 * @param commands - Ordered list of read commands to execute.
 * @returns Array of results containing the command, raw response, and parsed
 *   fields for each read.
 * @throws {BadConnectionError} When the session is lost mid-sequence.
 * @throws {CommandTimeoutError} When a command times out.
 *
 * @see PollCommandResult
 */
export async function runPollingCommands(
	session: DeviceSession,
	device: BluettiDevice,
	commands: readonly ReadHoldingRegisters[],
): Promise<PollCommandResult[]> {
	const results: PollCommandResult[] = [];
	for (const command of commands) {
		const response = await session.perform(command);
		const parsed = device.parse(
			command.startingAddress,
			command.parseResponse(response),
		);
		results.push({
			command,
			response,
			parsed,
		});
	}
	return results;
}

/**
 * Device objects supplied to a connected CLI operation.
 *
 * @see withConnectedDevice
 */
export interface ConnectedDeviceContext {
	/** Bluetooth MAC address of the connected device. */
	readonly address: string;
	/** Initialized device session for command execution. */
	readonly session: DeviceSession;
	/** Device model for field decoding. */
	readonly device: BluettiDevice;
}

/**
 * Raw and decoded result from one polling command.
 *
 * @see runPollingCommands
 */
export interface PollCommandResult {
	/** The read command that was executed. */
	readonly command: ReadHoldingRegisters;
	/** Raw response bytes from the device. */
	readonly response: Uint8Array;
	/** Decoded field map from parsing the response. */
	readonly parsed: Record<string, unknown>;
}
