import { DeviceSession } from "./device-session.js";
import type { BluetoothTransportFactory } from "./transport.js";

/**
 * Owns active {@link DeviceSession} instances for a fixed set of Bluetooth
 * addresses.
 *
 * @remarks
 * The manager is the single source of truth for which session is active for a
 * given address. Reconnect removes the failed session before exposing its
 * replacement, so callers never retrieve a half-initialized {@link DeviceSession}.
 *
 * Each address gets its own transport from the shared
 * {@link BluetoothTransportFactory}, allowing multiple devices to be polled
 * concurrently without interfering with each other's GATT state.
 *
 * @example
 * ```ts
 * const manager = new MultiDeviceManager(addresses, factory);
 * await manager.connectAll();
 * const session = manager.getSession(addresses[0]!);
 * await session.perform(command);
 * await manager.disconnectAll();
 * ```
 *
 * @see DeviceSession
 * @see BluetoothTransportFactory
 */
export class MultiDeviceManager {
	/** Active device sessions keyed by Bluetooth address. */
	private readonly sessions = new Map<string, DeviceSession>();

	/**
	 * Creates a manager for a fixed set of addresses.
	 *
	 * @param addresses - Bluetooth MAC addresses to manage. Each will get its
	 *   own transport and session.
	 * @param transportFactory - Factory that creates per-device transports.
	 */
	constructor(
		readonly addresses: readonly string[],
		private readonly transportFactory: BluetoothTransportFactory,
	) {}

	/**
	 * Connects every address that does not already have a session.
	 *
	 * @throws {BadConnectionError} When any device fails to initialize (after
	 *   the session's internal retries are exhausted).
	 *
	 * @remarks
	 * Devices are connected sequentially. If one fails, the error propagates
	 * immediately and remaining addresses are not connected. Already-connected
	 * addresses are skipped.
	 */
	async connectAll(): Promise<void> {
		for (const address of this.addresses) {
			if (this.sessions.has(address)) {
				continue;
			}

			const session = new DeviceSession(
				address,
				this.transportFactory.create(),
			);
			await session.connectAndInitialize();
			this.sessions.set(address, session);
		}
	}

	/**
	 * Returns whether an address currently has a command-ready session.
	 *
	 * @param address - Bluetooth MAC address to check.
	 * @returns `true` when a session exists and is in the `Ready` or
	 *   `PerformingCommand` state.
	 */
	isReady(address: string): boolean {
		return this.sessions.get(address)?.isReady ?? false;
	}

	/**
	 * Returns the advertised name for a connected address.
	 *
	 * @param address - Bluetooth MAC address.
	 * @returns The device name read during initialization.
	 * @throws {Error} When no session exists for the address or the name is null.
	 */
	getName(address: string): string {
		const name = this.sessions.get(address)?.name;
		if (name === null || name === undefined) {
			throw new Error(`No connected device name for ${address}`);
		}
		return name;
	}

	/**
	 * Returns the active session for an address.
	 *
	 * @param address - Bluetooth MAC address.
	 * @returns The {@link DeviceSession} for that address.
	 * @throws {Error} When no session is installed for the address.
	 */
	getSession(address: string): DeviceSession {
		const session = this.sessions.get(address);
		if (session === undefined) {
			throw new Error(`No active session for ${address}`);
		}
		return session;
	}

	/**
	 * Replaces one failed session with a newly initialized transport.
	 *
	 * @param address - Bluetooth MAC address to reconnect.
	 * @throws {BadConnectionError} When the new session fails to initialize.
	 *
	 * @remarks
	 * The old session is disconnected (best-effort) and removed from the map
	 * **before** the replacement is created. If the replacement fails, no
	 * session is installed for that address, and the caller must retry.
	 */
	async reconnect(address: string): Promise<void> {
		const existing = this.sessions.get(address);
		if (existing !== undefined) {
			try {
				await existing.disconnect();
			} catch {
				// The old Windows GATT object may already be disposed.
			} finally {
				this.sessions.delete(address);
			}
		}

		const session = new DeviceSession(address, this.transportFactory.create());
		await session.connectAndInitialize();
		this.sessions.set(address, session);
	}

	/**
	 * Disconnects every session while still attempting cleanup after failures.
	 *
	 * @throws {AggregateError} When one or more sessions fail to disconnect.
	 *   Individual errors are collected in `AggregateError.errors`.
	 *
	 * @remarks
	 * Each session is disconnected independently. Failures are collected but do
	 * not prevent remaining sessions from being cleaned up. The sessions map is
	 * cleared regardless of outcome.
	 */
	async disconnectAll(): Promise<void> {
		const failures: Error[] = [];

		for (const [address, session] of this.sessions.entries()) {
			try {
				await session.disconnect();
			} catch (error) {
				failures.push(
					error instanceof Error ? error : new Error(String(error)),
				);
			} finally {
				this.sessions.delete(address);
			}
		}

		if (failures.length > 0) {
			throw new AggregateError(
				failures,
				"Failed to disconnect one or more Bluetooth sessions",
			);
		}
	}
}
