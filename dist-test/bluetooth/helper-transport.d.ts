import type { BluetoothTransport, BluetoothTransportFactory } from "./transport.js";
import type { WindowsHelperClient } from "./helper-client.js";
/**
 * GATT transport backed by one native helper session.
 *
 * @remarks
 * Each transport owns one GATT session ID on the shared helper client.
 * Notification events from the helper are filtered by session ID and
 * characteristic UUID before being delivered to subscribers.
 */
export declare class WindowsHelperTransport implements BluetoothTransport {
    private readonly client;
    /** Helper session ID for this transport's GATT connection, or `null` when disconnected. */
    private sessionId;
    /** Disposer for the process-wide notification listener, or `null` when disconnected. */
    private unsubscribeNotification;
    /** Subscribers keyed by normalized characteristic UUID. */
    private readonly subscribers;
    /**
     * @param client - Shared helper client used for all native operations.
     */
    constructor(client: WindowsHelperClient);
    /**
     * Connects to a device and registers for notification routing.
     *
     * @param address - Bluetooth MAC address to connect.
     * @throws {Error} When the transport is already connected.
     * @throws {Error} When notification wiring fails after a successful connect.
     *
     * @remarks
     * If the notification listener registration fails after connecting, the
     * native session is disconnected (best-effort) before the error propagates.
     */
    connect(address: string): Promise<void>;
    /**
     * Clears JavaScript ownership and asks the helper to disconnect.
     *
     * @remarks
     * JavaScript-side state (session ID, subscribers, notification listener) is
     * cleared **before** calling the helper's disconnect, so a failing native
     * cleanup cannot leave the transport logically connected. Native cleanup may
     * fail for an already-disposed GATT object.
     */
    disconnect(): Promise<void>;
    /** Reads a characteristic via the helper client's native session. */
    readCharacteristic(uuid: string): Promise<Uint8Array>;
    /** Writes a characteristic via the helper client's native session. */
    writeCharacteristic(uuid: string, data: Uint8Array): Promise<void>;
    /**
     * Registers a subscriber and enables native notifications.
     *
     * @param uuid - Characteristic UUID to subscribe to.
     * @param onData - Callback invoked for each notification.
     *
     * @remarks
     * The subscriber is registered **before** calling the native subscribe, to
     * avoid missing an immediate notification. If native subscription fails, the
     * previous callback (if any) is restored.
     */
    subscribe(uuid: string, onData: (data: Uint8Array) => void): Promise<void>;
    /**
     * Returns the active session ID or throws when not connected.
     *
     * @returns The current helper session ID.
     * @throws {Error} When the transport is not connected.
     */
    private requireSessionId;
}
/**
 * Factory that produces {@link WindowsHelperTransport} instances sharing one
 * helper client.
 */
export declare class WindowsHelperTransportFactory implements BluetoothTransportFactory {
    private readonly client;
    /**
     * @param client - Shared helper client that owns the native process.
     */
    constructor(client: WindowsHelperClient);
    /** @returns A new transport backed by the shared helper client. */
    create(): BluetoothTransport;
}
