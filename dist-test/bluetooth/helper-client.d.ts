import type { BluetoothDiscovery, BluetoothRuntime, DiscoveredBluetoothDevice } from "./transport.js";
import type { HelperConnectPayload, HelperScanDevice } from "./helper-protocol.js";
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
export declare class WindowsHelperClient implements BluetoothDiscovery {
    private readonly requestTimeoutMs;
    /** Spawned helper child process. */
    private readonly process;
    /** Pending requests awaiting correlated responses, keyed by request ID. */
    private readonly pending;
    /** Process-wide notification listeners fanned out to transports. */
    private readonly notificationListeners;
    /** Promise that resolves when the helper emits its `ready` event. */
    private readonly ready;
    /** Whether the `ready` event has been received. */
    private readyResolved;
    /** Whether {@link dispose} has been called. */
    private disposeRequested;
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
    constructor(command?: readonly string[], requestTimeoutMs?: number);
    /**
     * Resolves after the helper advertises its `ready` event.
     *
     * @returns A promise that rejects if the helper exits or errors before ready.
     */
    waitUntilReady(): Promise<void>;
    /**
     * Scans for nearby named Bluetooth advertisements.
     *
     * @returns Devices discovered during the scan, filtered to valid entries.
     *
     * @see BluetoothDiscovery.discover
     */
    discover(): Promise<readonly DiscoveredBluetoothDevice[]>;
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
    scan(timeoutMs?: number): Promise<readonly HelperScanDevice[]>;
    /**
     * Creates one native GATT session for an address.
     *
     * @param address - Bluetooth MAC address to connect.
     * @returns Session identity and device metadata.
     * @throws {Error} When the helper returns an invalid connect payload.
     */
    connect(address: string): Promise<HelperConnectPayload>;
    /**
     * Releases one native GATT session.
     *
     * @param sessionId - Session ID returned by {@link connect}.
     */
    disconnect(sessionId: string): Promise<void>;
    /**
     * Reads a characteristic through an existing native session.
     *
     * @param sessionId - Session ID returned by {@link connect}.
     * @param uuid - Characteristic UUID to read.
     * @returns The raw characteristic value bytes.
     * @throws {Error} When the helper returns an invalid payload.
     */
    readCharacteristic(sessionId: string, uuid: string): Promise<Uint8Array>;
    /**
     * Writes characteristic bytes through an existing native session.
     *
     * @param sessionId - Session ID returned by {@link connect}.
     * @param uuid - Characteristic UUID to write.
     * @param data - Payload bytes to send.
     * @param withoutResponse - When `true`, uses GATT write-without-response.
     */
    writeCharacteristic(sessionId: string, uuid: string, data: Uint8Array, withoutResponse?: boolean): Promise<void>;
    /**
     * Enables native notifications for a characteristic.
     *
     * @param sessionId - Session ID returned by {@link connect}.
     * @param uuid - Characteristic UUID to subscribe to.
     */
    subscribe(sessionId: string, uuid: string): Promise<void>;
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
    onNotification(listener: (event: HelperNotification) => void): () => void;
    /**
     * Creates transport and discovery adapters backed by this helper process.
     *
     * @returns A {@link BluetoothRuntime} whose factory produces
     *   {@link WindowsHelperTransport} instances sharing this client.
     */
    createRuntime(): BluetoothRuntime;
    /**
     * Rejects pending work, drops listeners, and terminates the helper process.
     *
     * @remarks
     * After disposal, all pending requests are rejected with a disposal error
     * and no new requests are accepted. The helper process is killed if still
     * running.
     */
    dispose(): void;
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
    private request;
    /**
     * Rejects all pending requests with the given error and clears the map.
     *
     * @param error - Error to reject all pending requests with.
     */
    private rejectPending;
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
    private handleLine;
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
export declare function createWindowsHelperRuntime(client?: WindowsHelperClient): BluetoothRuntime;
/** Internal notification event routed to transport subscribers. */
export interface HelperNotification {
    /** Helper session ID that owns the subscription. */
    readonly sessionId: string;
    /** Characteristic UUID that produced the notification. */
    readonly uuid: string;
    /** Raw notification bytes. */
    readonly data: Uint8Array;
}
