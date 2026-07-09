import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import {
	DEFAULT_REQUEST_TIMEOUT_MS,
	DEFAULT_SCAN_TIMEOUT_MS,
	DEFAULT_WITHOUT_RESPONSE,
	DISPOSED_OBJECT_ERROR_TEXT,
	HELPER_ERROR_COMMAND_FAILED,
	HELPER_EVENT_NOTIFICATION,
	HELPER_MESSAGE_TYPE_EVENT,
	SCAN_TIMEOUT_BUFFER_MS,
	UNREACHABLE_ERROR_TEXT,
} from "./constants.js";
import { BadConnectionError } from "./errors.js";
import type {
	HelperConnectPayload,
	HelperMessage,
	HelperNotificationEvent,
	HelperRequest,
	HelperScanDevice,
} from "./helper-protocol.js";
import { WindowsHelperTransportFactory } from "./helper-transport.js";
import type {
	BluetoothDiscovery,
	BluetoothRuntime,
	DiscoveredBluetoothDevice,
} from "./transport.js";

/** Directory of this module (used to resolve package-relative paths). */
const MODULE_DIRECTORY = dirname(fileURLToPath(import.meta.url));
/** Package root directory (two levels up from this module). */
const PACKAGE_ROOT = resolve(MODULE_DIRECTORY, "..", "..");
/** Path to the published self-contained helper executable. */
const PUBLISHED_HELPER_PATH = resolve(
	PACKAGE_ROOT,
	"artifacts",
	"helper",
	"win-x64",
	"BluettiMqtt.BluetoothHelper.exe",
);
/** Path to the helper .csproj for the `dotnet run` source fallback. */
const SOURCE_HELPER_PROJECT = resolve(
	PACKAGE_ROOT,
	"helper",
	"BluettiMqtt.BluetoothHelper",
	"BluettiMqtt.BluetoothHelper.csproj",
);

/**
 * Manages the native Windows helper process and its JSON-lines request protocol.
 *
 * @remarks
 * One client may back several {@link WindowsHelperTransport} instances. Request
 * IDs isolate command responses, while session IDs route unsolicited
 * characteristic notifications to the correct transport. Every pending request
 * has a deadline so a wedged helper cannot stall polling indefinitely.
 *
 * The helper communicates over line-delimited JSON on stdio: Node writes
 * requests to stdin and reads responses/events from stdout. The `ready` event
 * must arrive before any command is accepted.
 *
 * @example
 * ```ts
 * const client = new WindowsHelperClient();
 * await client.waitUntilReady();
 * const devices = await client.scan();
 * const runtime = client.createRuntime();
 * // ... use runtime.transportFactory for device connections ...
 * client.dispose();
 * ```
 *
 * @see WindowsHelperTransport
 * @see createWindowsHelperRuntime
 */
export class WindowsHelperClient implements BluetoothDiscovery {
	/** Spawned helper child process. */
	private readonly process: ChildProcessWithoutNullStreams;
	/** Pending requests awaiting correlated responses, keyed by request ID. */
	private readonly pending = new Map<string, PendingRequest>();
	/** Process-wide notification listeners fanned out to transports. */
	private readonly notificationListeners = new Set<
		(event: HelperNotification) => void
	>();
	/** Promise that resolves when the helper emits its `ready` event. */
	private readonly ready: Promise<void>;
	/** Whether the `ready` event has been received. */
	private readyResolved = false;
	/** Whether {@link dispose} has been called. */
	private disposeRequested = false;

	/**
	 * Spawns the helper process and begins reading its stdout.
	 *
	 * @param command - Helper command as `[executable, ...args]`. Defaults to
	 *   the resolved helper path (published artifact or `dotnet run` fallback).
	 * @param requestTimeoutMs - Default per-request deadline (default 30 s).
	 * @throws {Error} When the command array is empty.
	 *
	 * @remarks
	 * The constructor does not wait for the helper to become ready. Call
	 * {@link WindowsHelperClient.waitUntilReady} before issuing commands.
	 */
	constructor(
		command = resolveDefaultHelperCommand(),
		private readonly requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
	) {
		const [file, ...args] = command;
		if (file === undefined) {
			throw new Error("Helper command cannot be empty");
		}

		this.process = spawn(file, args, {
			cwd: process.cwd(),
			stdio: ["pipe", "pipe", "pipe"],
		});

		const lines = createInterface({ input: this.process.stdout });
		this.ready = new Promise<void>((resolve, reject) => {
			lines.on("line", (line) => {
				this.handleLine(line, resolve, reject);
			});
			this.process.once("error", (error) => {
				if (!this.readyResolved) {
					reject(error);
				}
				this.rejectPending(error);
			});
			this.process.stdin.on("error", (error) => {
				this.rejectPending(error);
			});
			this.process.once("exit", (code) => {
				if (this.disposeRequested) {
					if (!this.readyResolved) {
						reject(
							new Error(
								"Windows BLE helper was disposed before becoming ready",
							),
						);
					}
					this.pending.clear();
					return;
				}

				const error = new Error(
					`Windows BLE helper exited with code ${code ?? -1}`,
				);
				if (!this.readyResolved) {
					reject(error);
				}
				this.rejectPending(error);
			});
		});
	}

	/**
	 * Resolves after the helper advertises its `ready` event.
	 *
	 * @returns A promise that rejects if the helper exits or errors before ready.
	 */
	async waitUntilReady(): Promise<void> {
		await this.ready;
	}

	/**
	 * Scans for nearby named Bluetooth advertisements.
	 *
	 * @returns Devices discovered during the scan, filtered to valid entries.
	 *
	 * @see BluetoothDiscovery.discover
	 */
	async discover(): Promise<readonly DiscoveredBluetoothDevice[]> {
		return this.scan();
	}

	/**
	 * Runs a helper scan with a deadline longer than the native scan window.
	 *
	 * @param timeoutMs - Native scan duration in milliseconds (default 5 s).
	 * @returns Valid scan results, filtering out malformed entries.
	 *
	 * @remarks
	 * The request timeout is set to `max(requestTimeoutMs, timeoutMs + 5s)` to
	 * ensure the request does not time out before the scan completes.
	 */
	async scan(
		timeoutMs = DEFAULT_SCAN_TIMEOUT_MS,
	): Promise<readonly HelperScanDevice[]> {
		const payload = await this.request(
			"scan",
			{ timeoutMs },
			Math.max(this.requestTimeoutMs, timeoutMs + SCAN_TIMEOUT_BUFFER_MS),
		);
		const devices = payload?.devices;
		if (!Array.isArray(devices)) {
			return [];
		}

		return devices.flatMap((device) =>
			isHelperScanDevice(device) ? [device] : [],
		);
	}

	/**
	 * Creates one native GATT session for an address.
	 *
	 * @param address - Bluetooth MAC address to connect.
	 * @returns Session identity and device metadata.
	 * @throws {Error} When the helper returns an invalid connect payload.
	 */
	async connect(address: string): Promise<HelperConnectPayload> {
		const payload = await this.request("connect", { address });
		if (!isHelperConnectPayload(payload)) {
			throw new Error("Helper returned an invalid connect payload");
		}
		return payload;
	}

	/**
	 * Releases one native GATT session.
	 *
	 * @param sessionId - Session ID returned by {@link connect}.
	 */
	async disconnect(sessionId: string): Promise<void> {
		await this.request("disconnect", { sessionId });
	}

	/**
	 * Reads a characteristic through an existing native session.
	 *
	 * @param sessionId - Session ID returned by {@link connect}.
	 * @param uuid - Characteristic UUID to read.
	 * @returns The raw characteristic value bytes.
	 * @throws {Error} When the helper returns an invalid payload.
	 */
	async readCharacteristic(
		sessionId: string,
		uuid: string,
	): Promise<Uint8Array> {
		const payload = await this.request("readCharacteristic", {
			sessionId,
			uuid,
		});
		const dataBase64 = payload?.dataBase64;
		if (typeof dataBase64 !== "string") {
			throw new Error("Helper returned an invalid readCharacteristic payload");
		}
		return new Uint8Array(Buffer.from(dataBase64, "base64"));
	}

	/**
	 * Writes characteristic bytes through an existing native session.
	 *
	 * @param sessionId - Session ID returned by {@link connect}.
	 * @param uuid - Characteristic UUID to write.
	 * @param data - Payload bytes to send.
	 * @param withoutResponse - When `true`, uses GATT write-without-response.
	 */
	async writeCharacteristic(
		sessionId: string,
		uuid: string,
		data: Uint8Array,
		withoutResponse = DEFAULT_WITHOUT_RESPONSE,
	): Promise<void> {
		await this.request("writeCharacteristic", {
			sessionId,
			uuid,
			dataBase64: Buffer.from(data).toString("base64"),
			withoutResponse,
		});
	}

	/**
	 * Enables native notifications for a characteristic.
	 *
	 * @param sessionId - Session ID returned by {@link connect}.
	 * @param uuid - Characteristic UUID to subscribe to.
	 */
	async subscribe(sessionId: string, uuid: string): Promise<void> {
		await this.request("subscribe", { sessionId, uuid });
	}

	/**
	 * Registers a process-wide notification listener and returns its disposer.
	 *
	 * @param listener - Callback invoked for every notification event from the
	 *   helper. The listener is responsible for filtering by session ID and UUID.
	 * @returns A function that removes the listener when called.
	 *
	 * @remarks
	 * Notification events are not correlated with requests. They fan out to all
	 * listeners; individual {@link WindowsHelperTransport} instances perform
	 * session and UUID filtering.
	 */
	onNotification(listener: (event: HelperNotification) => void): () => void {
		this.notificationListeners.add(listener);
		return () => {
			this.notificationListeners.delete(listener);
		};
	}

	/**
	 * Creates transport and discovery adapters backed by this helper process.
	 *
	 * @returns A {@link BluetoothRuntime} whose factory produces
	 *   {@link WindowsHelperTransport} instances sharing this client.
	 */
	createRuntime(): BluetoothRuntime {
		return createWindowsHelperRuntime(this);
	}

	/**
	 * Rejects pending work, drops listeners, and terminates the helper process.
	 *
	 * @remarks
	 * After disposal, all pending requests are rejected with a disposal error
	 * and no new requests are accepted. The helper process is killed if still
	 * running.
	 */
	dispose(): void {
		this.disposeRequested = true;
		this.rejectPending(new Error("Windows BLE helper disposed"));
		this.notificationListeners.clear();

		if (!this.process.killed) {
			this.process.kill();
		}
	}

	/**
	 * Sends a request to the helper and awaits its correlated response.
	 *
	 * @param command - Helper command name.
	 * @param argumentsObject - Optional command arguments.
	 * @param timeoutMs - Per-request deadline (defaults to the client's
	 *   `requestTimeoutMs`).
	 * @returns The response payload, or `undefined` if the payload was empty.
	 * @throws {Error} When the client has been disposed.
	 * @throws {BadConnectionError} When the request times out.
	 * @throws {Error} When the helper returns an error response.
	 *
	 * @remarks
	 * Correlation state is installed **before** the request line is written to
	 * stdin, because a helper response can arrive immediately after stdin
	 * accepts the line.
	 */
	private async request(
		command: string,
		argumentsObject?: Record<string, unknown>,
		timeoutMs = this.requestTimeoutMs,
	): Promise<Record<string, unknown> | undefined> {
		if (this.disposeRequested) {
			throw new Error("Windows BLE helper disposed");
		}

		await this.waitUntilReady();

		const id = randomUUID();
		const request: HelperRequest = { id, command };
		if (argumentsObject !== undefined) {
			(
				request as HelperRequest & { arguments: Record<string, unknown> }
			).arguments = argumentsObject;
		}

		// Install correlation state before writing: a helper response can arrive
		// immediately after stdin accepts the line.
		const response = new Promise<Record<string, unknown> | undefined>(
			(resolve, reject) => {
				const timeout = setTimeout(() => {
					if (this.pending.delete(id)) {
						reject(
							new BadConnectionError(
								`Windows BLE helper request timed out: ${command}`,
							),
						);
					}
				}, timeoutMs);
				this.pending.set(id, { resolve, reject, timeout });
			},
		);

		try {
			this.process.stdin.write(`${JSON.stringify(request)}\n`);
		} catch (error) {
			const pending = this.pending.get(id);
			if (pending !== undefined) {
				clearTimeout(pending.timeout);
				this.pending.delete(id);
			}
			throw error;
		}
		return response;
	}

	/**
	 * Rejects all pending requests with the given error and clears the map.
	 *
	 * @param error - Error to reject all pending requests with.
	 */
	private rejectPending(error: unknown): void {
		for (const pending of this.pending.values()) {
			clearTimeout(pending.timeout);
			pending.reject(error);
		}
		this.pending.clear();
	}

	/**
	 * Parses one stdout line and routes it to the appropriate handler.
	 *
	 * @param line - Raw JSON line from the helper's stdout.
	 * @param onReady - Callback invoked when the `ready` event arrives.
	 * @param onReadyError - Callback invoked when an error arrives before ready.
	 *
	 * @remarks
	 * Events are not correlated with requests. Notifications fan out to
	 * transports, which perform the session and UUID filtering. Response and
	 * error lines are matched to pending requests by ID.
	 */
	private handleLine(
		line: string,
		onReady: () => void,
		onReadyError: (reason?: unknown) => void,
	): void {
		let message: HelperMessage;
		try {
			message = JSON.parse(line) as HelperMessage;
		} catch (error) {
			if (!this.readyResolved) {
				onReadyError(error);
			}
			return;
		}

		// Events are not correlated with requests. Notifications fan out to
		// transports, which perform the session and UUID filtering.
		if (message.type === "event") {
			if (message.name === "ready") {
				this.readyResolved = true;
				onReady();
				return;
			}

			if (
				message.name === "notification" &&
				isHelperNotificationEvent(message)
			) {
				const payload = message.payload;
				if (payload !== undefined) {
					const event: HelperNotification = {
						sessionId: payload.sessionId,
						uuid: payload.uuid,
						data: new Uint8Array(Buffer.from(payload.dataBase64, "base64")),
					};
					for (const listener of this.notificationListeners) {
						listener(event);
					}
				}
			}
			return;
		}

		if (message.id === undefined) {
			return;
		}

		const pending = this.pending.get(message.id);
		if (!pending) {
			return;
		}

		this.pending.delete(message.id);
		clearTimeout(pending.timeout);
		if (message.type === "response") {
			pending.resolve(message.payload);
		} else {
			pending.reject(
				createHelperError(message.error.code, message.error.message),
			);
		}
	}
}

/**
 * Creates a typed error from a helper error response.
 *
 * @param code - Stable machine-readable error code.
 * @param message - Human-readable error message.
 * @returns A {@link BadConnectionError} for recoverable connection errors,
 *   or a generic `Error` for other failures.
 *
 * @see isRecoverableBluetoothConnectionError
 */
function createHelperError(code: string, message: string): Error {
	const details = `${code}: ${message}`;
	if (isRecoverableBluetoothConnectionError(code, message)) {
		return new BadConnectionError(details);
	}

	return new Error(details);
}

/**
 * Returns whether a helper error indicates a recoverable connection problem.
 *
 * @param code - Stable error code from the helper.
 * @param message - Error message text.
 * @returns `true` when the error is a `command_failed` whose message indicates
 *   a disposed GATT object or unreachable device.
 */
function isRecoverableBluetoothConnectionError(
	code: string,
	message: string,
): boolean {
	if (code !== HELPER_ERROR_COMMAND_FAILED) {
		return false;
	}

	const normalizedMessage = message.toLowerCase();
	return (
		normalizedMessage.includes(DISPOSED_OBJECT_ERROR_TEXT) ||
		normalizedMessage.includes(UNREACHABLE_ERROR_TEXT)
	);
}

/**
 * Resolves the helper command using environment and artifact precedence.
 *
 * @returns Command array in `[executable, ...args]` form.
 *
 * @remarks
 * Resolution order:
 * 1. `BLUETTI_HELPER_PATH` environment variable
 * 2. Published helper artifact at `artifacts/helper/win-x64/`
 * 3. Source fallback via `dotnet run --project helper/...`
 */
function resolveDefaultHelperCommand(): readonly string[] {
	const helperOverride = process.env.BLUETTI_HELPER_PATH?.trim();
	if (helperOverride) {
		return [helperOverride];
	}

	if (existsSync(PUBLISHED_HELPER_PATH)) {
		return [PUBLISHED_HELPER_PATH];
	}

	return ["dotnet", "run", "--project", SOURCE_HELPER_PROJECT];
}

/**
 * Creates the Windows runtime used by CLIs and embedded bridge applications.
 *
 * @param client - Helper client to back the runtime. Defaults to a new
 *   {@link WindowsHelperClient}.
 * @returns A {@link BluetoothRuntime} with discovery and transport factory.
 *
 * @example
 * ```ts
 * const runtime = createWindowsHelperRuntime();
 * const transport = runtime.transportFactory.create();
 * ```
 */
export function createWindowsHelperRuntime(
	client = new WindowsHelperClient(),
): BluetoothRuntime {
	return {
		discovery: client,
		transportFactory: new WindowsHelperTransportFactory(client),
	};
}

/** Internal state for one pending helper request. */
interface PendingRequest {
	/** Resolves with the response payload. */
	resolve: (value: Record<string, unknown> | undefined) => void;
	/** Rejects with a timeout or helper error. */
	reject: (reason?: unknown) => void;
	/** Timeout handle for the request deadline. */
	timeout?: ReturnType<typeof setTimeout>;
}

/** Internal notification event routed to transport subscribers. */
export interface HelperNotification {
	/** Helper session ID that owns the subscription. */
	readonly sessionId: string;
	/** Characteristic UUID that produced the notification. */
	readonly uuid: string;
	/** Raw notification bytes. */
	readonly data: Uint8Array;
}

/**
 * Type guard for {@link HelperScanDevice}.
 *
 * @param value - Unknown value from a helper response.
 * @returns `true` when `value` has string `address` and `name` properties.
 */
function isHelperScanDevice(value: unknown): value is HelperScanDevice {
	if (typeof value !== "object" || value === null) {
		return false;
	}

	const candidate = value as Record<string, unknown>;
	return (
		typeof candidate.address === "string" && typeof candidate.name === "string"
	);
}

/**
 * Type guard for {@link HelperConnectPayload}.
 *
 * @param value - Unknown value from a helper response.
 * @returns `true` when `value` has string `sessionId`, `address`, and `name`.
 */
function isHelperConnectPayload(value: unknown): value is HelperConnectPayload {
	if (typeof value !== "object" || value === null) {
		return false;
	}

	const candidate = value as Record<string, unknown>;
	return (
		typeof candidate.sessionId === "string" &&
		typeof candidate.address === "string" &&
		typeof candidate.name === "string"
	);
}

/**
 * Type guard for {@link HelperNotificationEvent}.
 *
 * @param message - Any helper message.
 * @returns `true` when the message is a notification event.
 */
function isHelperNotificationEvent(
	message: HelperMessage,
): message is HelperNotificationEvent {
	return (
		message.type === HELPER_MESSAGE_TYPE_EVENT &&
		message.name === HELPER_EVENT_NOTIFICATION
	);
}
