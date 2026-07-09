import type { DeviceCommand } from "@core/commands.js";
import { UNKNOWN_ERROR_CODE } from "./constants.js";
import {
	BadConnectionError,
	CommandTimeoutError,
	DeviceBusyError,
	ModbusError,
	ParseError,
} from "./errors.js";
import {
	concatBytes,
	isAsciiControlMessage,
	isRetryableInitializationError,
	sleep,
} from "./session-utils.js";
import type { BluetoothTransport } from "./transport.js";

/**
 * Observable states in the lifetime of one device connection.
 *
 * @see DeviceSession
 */
export enum DeviceSessionState {
	/** No transport connection has been established. */
	NotConnected = "not_connected",
	/** Transport is connected but the notification subscription is not yet active. */
	Connected = "connected",
	/** Fully initialized; commands may be performed. */
	Ready = "ready",
	/** A command is currently in flight, awaiting a notification response. */
	PerformingCommand = "performing_command",
	/** The last command failed; the session can accept a retry. */
	CommandErrorWait = "command_error_wait",
	/** Disconnect is in progress. */
	Disconnecting = "disconnecting",
}

/**
 * Executes serialized MODBUS request/response exchanges over one BLE transport.
 *
 * @remarks
 * Only one command may be active at a time because Bluetti notification
 * packets do not contain request IDs — there is no way to correlate a
 * notification with a specific request. The session buffers notification
 * chunks until a complete, CRC-validated response (or exception) is received.
 *
 * A transport error moves the session out of `Ready`; the owning
 * {@link MultiDeviceManager} must replace the session before polling
 * continues. The session does not self-heal transport-level failures.
 *
 * Initialization order matters: `connectAndInitialize` reads the device name
 * first, then installs the notification subscription **last**, so that `Ready`
 * always implies notifications can complete a command already written to the
 * device.
 *
 * @example
 * ```ts
 * const session = new DeviceSession(address, transport);
 * await session.connectAndInitialize();
 * const response = await session.perform(new ReadHoldingRegisters(10, 40));
 * await session.disconnect();
 * ```
 *
 * @see MultiDeviceManager
 * @see DeviceCommand
 */
export class DeviceSession {
	/** Default timeout for a single command response (10 seconds). */
	static readonly DEFAULT_COMMAND_TIMEOUT_MS = 10_000;
	/** Number of initialization attempts before giving up. */
	static readonly CONNECT_RETRY_COUNT = 3;
	/** Delay between initialization retries. */
	static readonly CONNECT_RETRY_DELAY_MS = 1_000;
	/** GATT characteristic UUID for writing MODBUS requests. */
	static readonly WRITE_UUID = "0000ff02-0000-1000-8000-00805f9b34fb";
	/** GATT characteristic UUID for receiving MODBUS notifications. */
	static readonly NOTIFY_UUID = "0000ff01-0000-1000-8000-00805f9b34fb";
	/** GATT characteristic UUID for the device name (standard 2A00). */
	static readonly DEVICE_NAME_UUID = "00002a00-0000-1000-8000-00805f9b34fb";

	/** Bluetooth MAC address of the connected device. */
	readonly address: string;
	/** Underlying GATT transport used for read/write/subscribe operations. */
	readonly transport: BluetoothTransport;
	/** Current session lifecycle state. */
	state = DeviceSessionState.NotConnected;
	/** Advertised device name read during initialization, or `null` if unknown. */
	name: string | null = null;
	/** Command currently awaiting a notification response, or `null`. */
	private currentCommand: DeviceCommand | null = null;
	/** Accumulated notification bytes for the in-flight command. */
	private responseBuffer: Uint8Array<ArrayBufferLike> = new Uint8Array(0);
	/** Pending response resolver/rejecter for the in-flight command, or `null`. */
	private pendingResponse: {
		resolve: (value: Uint8Array) => void;
		reject: (reason?: unknown) => void;
	} | null = null;
	/** Timeout handle for the in-flight command, or `null` when no command is active. */
	private pendingTimeout: ReturnType<typeof setTimeout> | null = null;

	/**
	 * Creates a session over a transport for the given address.
	 *
	 * @param address - Bluetooth MAC address of the target device.
	 * @param transport - GATT transport to use for this session.
	 * @param commandTimeoutMs - Per-command response timeout (default 10 s).
	 */
	constructor(
		address: string,
		transport: BluetoothTransport,
		private readonly commandTimeoutMs = DeviceSession.DEFAULT_COMMAND_TIMEOUT_MS,
	) {
		this.address = address;
		this.transport = transport;
	}

	/**
	 * Whether the session can accept a command.
	 *
	 * @returns `true` when the state is `Ready` or `PerformingCommand`.
	 */
	get isReady(): boolean {
		return (
			this.state === DeviceSessionState.Ready ||
			this.state === DeviceSessionState.PerformingCommand
		);
	}

	/**
	 * Connects, reads the device name, and installs the response subscription.
	 *
	 * Retries up to {@link DeviceSession.CONNECT_RETRY_COUNT} times on
	 * recoverable initialization errors (e.g. transient GATT unreachable). On
	 * each failed attempt, the transport is disconnected and the session state
	 * is reset before retrying.
	 *
	 * @throws {BadConnectionError} When a recoverable error persists after all
	 *   retries.
	 * @throws {Error} When an unrecoverable error occurs, or when the device
	 *   name cannot be read.
	 *
	 * @remarks
	 * The notification subscription is installed **last** so that reaching the
	 * `Ready` state guarantees that notifications can complete any command
	 * already written to the device.
	 */
	async connectAndInitialize(): Promise<void> {
		let lastError: unknown = null;

		for (
			let attempt = 0;
			attempt < DeviceSession.CONNECT_RETRY_COUNT;
			attempt += 1
		) {
			try {
				await this.transport.connect(this.address);
				this.state = DeviceSessionState.Connected;

				const rawName = await this.transport.readCharacteristic(
					DeviceSession.DEVICE_NAME_UUID,
				);
				this.name = Buffer.from(rawName).toString("ascii");

				// Subscription is installed last so Ready always implies notifications
				// can complete a command already written to the device.
				await this.transport.subscribe(DeviceSession.NOTIFY_UUID, (data) => {
					this.handleNotification(data);
				});
				this.state = DeviceSessionState.Ready;
				return;
			} catch (error) {
				lastError = error;
				this.clearPendingState();
				this.state = DeviceSessionState.NotConnected;
				this.name = null;

				try {
					await this.transport.disconnect();
				} catch {
					// Best effort cleanup before retrying initialization.
				}

				const shouldRetry =
					attempt < DeviceSession.CONNECT_RETRY_COUNT - 1 &&
					isRetryableInitializationError(error);
				if (!shouldRetry) {
					throw error;
				}

				await sleep(DeviceSession.CONNECT_RETRY_DELAY_MS);
			}
		}

		throw lastError instanceof Error
			? lastError
			: new Error(`Failed to initialize Bluetooth session for ${this.address}`);
	}

	/**
	 * Clears command state and disconnects, even when native cleanup fails.
	 *
	 * @remarks
	 * Clears the pending response, cancels any active timeout, and transitions
	 * to `Disconnecting` then `NotConnected`. If `transport.disconnect()`
	 * throws, the error propagates but the session state is still reset in the
	 * `finally` block.
	 */
	async disconnect(): Promise<void> {
		this.clearPendingState();
		this.state = DeviceSessionState.Disconnecting;
		try {
			await this.transport.disconnect();
		} finally {
			this.name = null;
			this.state = DeviceSessionState.NotConnected;
		}
	}

	/**
	 * Sends one command and resolves after a complete validated response arrives.
	 *
	 * @param command - MODBUS command to execute.
	 * @returns The complete, CRC-validated response bytes.
	 * @throws {BadConnectionError} When the session is not ready.
	 * @throws {CommandTimeoutError} When no complete response arrives within
	 *   `commandTimeoutMs`.
	 * @throws {DeviceBusyError} When the device returns a MODBUS busy exception.
	 * @throws {ModbusError} When the device returns a non-busy MODBUS exception.
	 * @throws {ParseError} When the response fails CRC validation or exceeds the
	 *   expected size.
	 *
	 * @remarks
	 * The pending-response waiter is registered **before** the write is sent,
	 * because fast devices may notify before the helper has acknowledged
	 * completion of the write request. A catch handler is attached to the
	 * response promise immediately to prevent expected device-busy rejections
	 * from surfacing as unhandled rejections.
	 *
	 * If the write itself fails, the session transitions to `Disconnecting` and
	 * the pending response is rejected with the transport error.
	 */
	async perform(command: DeviceCommand): Promise<Uint8Array> {
		if (!this.isReady) {
			throw new BadConnectionError(`Device ${this.address} is not ready`);
		}

		this.state = DeviceSessionState.PerformingCommand;
		this.currentCommand = command;
		this.responseBuffer = new Uint8Array(0);

		// Register the waiter before writing. Fast devices may notify before the
		// helper has acknowledged completion of the write request.
		const responsePromise = new Promise<Uint8Array>((resolve, reject) => {
			this.pendingResponse = { resolve, reject };
			this.pendingTimeout = setTimeout(() => {
				this.state = DeviceSessionState.CommandErrorWait;
				this.rejectPending(
					new CommandTimeoutError(
						`Timed out waiting for response from ${this.address} after ${this.commandTimeoutMs} ms`,
					),
				);
			}, this.commandTimeoutMs);
		});
		// Notifications can reject the pending promise before we reach the await below.
		// Attach a handler immediately so expected device-busy responses do not surface
		// as top-level unhandled rejections in the host runtime.
		void responsePromise.catch(() => {});

		try {
			await this.transport.writeCharacteristic(
				DeviceSession.WRITE_UUID,
				command.toBytes(),
			);
		} catch (error) {
			this.state = DeviceSessionState.Disconnecting;
			this.pendingResponse?.reject(error);
			this.clearPendingState();
			throw error;
		}

		try {
			const response = await responsePromise;
			this.state = DeviceSessionState.Ready;
			return response;
		} finally {
			this.clearPendingState();
		}
	}

	/**
	 * Converts a validated exception frame into its typed MODBUS error.
	 *
	 * @param command - The command that triggered the exception.
	 * @param response - The 5-byte exception response frame.
	 * @returns A {@link DeviceBusyError} for exception code 5, or a
	 *   {@link ModbusError} for any other code.
	 */
	buildModbusException(
		command: DeviceCommand,
		response: Uint8Array,
	): ModbusError {
		const code = response[2] ?? UNKNOWN_ERROR_CODE;
		if (code === 5) {
			return new DeviceBusyError(
				`MODBUS exception for function ${command.functionCode}: code ${code}`,
				code,
			);
		}
		return new ModbusError(
			`MODBUS exception for function ${command.functionCode}: code ${code}`,
			code,
		);
	}

	/**
	 * Handles an incoming notification chunk for the active command.
	 *
	 * @param data - Raw notification bytes from the subscribed characteristic.
	 *
	 * @remarks
	 * Notifications may split one MODBUS frame into arbitrary BLE chunks, so
	 * received bytes are appended to {@link responseBuffer} until a complete
	 * response or exception is recognized. If an AT control message (e.g.
	 * `AT+NAME?\r`) arrives instead of MODBUS data, the session is marked as
	 * having a bad connection.
	 */
	private handleNotification(data: Uint8Array): void {
		if (this.pendingResponse === null || this.currentCommand === null) {
			return;
		}

		if (isAsciiControlMessage(data)) {
			this.rejectPending(
				new BadConnectionError(
					"Received AT control notification instead of MODBUS response",
				),
			);
			this.state = DeviceSessionState.Disconnecting;
			return;
		}

		// Notifications may split one MODBUS frame into arbitrary BLE chunks.
		this.responseBuffer = concatBytes(this.responseBuffer, data);

		if (this.currentCommand.isExceptionResponse(this.responseBuffer)) {
			this.rejectPending(
				this.buildModbusException(this.currentCommand, this.responseBuffer),
			);
			this.state = DeviceSessionState.Ready;
			return;
		}

		if (this.responseBuffer.length === this.currentCommand.responseSize()) {
			if (this.currentCommand.isValidResponse(this.responseBuffer)) {
				this.resolvePending(this.responseBuffer);
				this.state = DeviceSessionState.Ready;
			} else {
				this.rejectPending(new ParseError("Response CRC validation failed"));
				this.state = DeviceSessionState.CommandErrorWait;
			}
			return;
		}

		if (this.responseBuffer.length > this.currentCommand.responseSize()) {
			this.rejectPending(
				new ParseError("Notification payload exceeded expected response size"),
			);
			this.state = DeviceSessionState.CommandErrorWait;
		}
	}

	/**
	 * Resolves the pending response and clears command state.
	 *
	 * @param response - Complete validated response bytes.
	 */
	private resolvePending(response: Uint8Array): void {
		this.pendingResponse?.resolve(response);
		this.clearPendingState();
	}

	/**
	 * Rejects the pending response and clears command state.
	 *
	 * @param error - Error to reject with.
	 */
	private rejectPending(error: unknown): void {
		this.pendingResponse?.reject(error);
		this.clearPendingState();
	}

	/**
	 * Clears the command timeout, pending response, and response buffer.
	 */
	private clearPendingState(): void {
		if (this.pendingTimeout !== null) {
			clearTimeout(this.pendingTimeout);
			this.pendingTimeout = null;
		}
		this.pendingResponse = null;
		this.currentCommand = null;
		this.responseBuffer = new Uint8Array(0);
	}
}
