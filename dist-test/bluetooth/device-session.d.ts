import { DeviceCommand } from "@core/commands.js";
import { ModbusError } from "./errors.js";
import type { BluetoothTransport } from "./transport.js";
/**
 * Observable states in the lifetime of one device connection.
 *
 * @see DeviceSession
 */
export declare enum DeviceSessionState {
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
    Disconnecting = "disconnecting"
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
export declare class DeviceSession {
    private readonly commandTimeoutMs;
    /** Default timeout for a single command response (10 seconds). */
    static readonly DEFAULT_COMMAND_TIMEOUT_MS = 10000;
    /** Number of initialization attempts before giving up. */
    static readonly CONNECT_RETRY_COUNT = 3;
    /** Delay between initialization retries. */
    static readonly CONNECT_RETRY_DELAY_MS = 1000;
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
    state: DeviceSessionState;
    /** Advertised device name read during initialization, or `null` if unknown. */
    name: string | null;
    /** Command currently awaiting a notification response, or `null`. */
    private currentCommand;
    /** Accumulated notification bytes for the in-flight command. */
    private responseBuffer;
    /** Pending response resolver/rejecter for the in-flight command, or `null`. */
    private pendingResponse;
    /** Timeout handle for the in-flight command, or `null` when no command is active. */
    private pendingTimeout;
    /**
     * Creates a session over a transport for the given address.
     *
     * @param address - Bluetooth MAC address of the target device.
     * @param transport - GATT transport to use for this session.
     * @param commandTimeoutMs - Per-command response timeout (default 10 s).
     */
    constructor(address: string, transport: BluetoothTransport, commandTimeoutMs?: number);
    /**
     * Whether the session can accept a command.
     *
     * @returns `true` when the state is `Ready` or `PerformingCommand`.
     */
    get isReady(): boolean;
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
    connectAndInitialize(): Promise<void>;
    /**
     * Clears command state and disconnects, even when native cleanup fails.
     *
     * @remarks
     * Clears the pending response, cancels any active timeout, and transitions
     * to `Disconnecting` then `NotConnected`. If `transport.disconnect()`
     * throws, the error propagates but the session state is still reset in the
     * `finally` block.
     */
    disconnect(): Promise<void>;
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
    perform(command: DeviceCommand): Promise<Uint8Array>;
    /**
     * Converts a validated exception frame into its typed MODBUS error.
     *
     * @param command - The command that triggered the exception.
     * @param response - The 5-byte exception response frame.
     * @returns A {@link DeviceBusyError} for exception code 5, or a
     *   {@link ModbusError} for any other code.
     */
    buildModbusException(command: DeviceCommand, response: Uint8Array): ModbusError;
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
    private handleNotification;
    /**
     * Resolves the pending response and clears command state.
     *
     * @param response - Complete validated response bytes.
     */
    private resolvePending;
    /**
     * Rejects the pending response and clears command state.
     *
     * @param error - Error to reject with.
     */
    private rejectPending;
    /**
     * Clears the command timeout, pending response, and response buffer.
     */
    private clearPendingState;
}
