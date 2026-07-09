/**
 * GATT transport backed by one native helper session.
 *
 * @remarks
 * Each transport owns one GATT session ID on the shared helper client.
 * Notification events from the helper are filtered by session ID and
 * characteristic UUID before being delivered to subscribers.
 */
export class WindowsHelperTransport {
    client;
    /** Helper session ID for this transport's GATT connection, or `null` when disconnected. */
    sessionId = null;
    /** Disposer for the process-wide notification listener, or `null` when disconnected. */
    unsubscribeNotification = null;
    /** Subscribers keyed by normalized characteristic UUID. */
    subscribers = new Map();
    /**
     * @param client - Shared helper client used for all native operations.
     */
    constructor(client) {
        this.client = client;
    }
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
    async connect(address) {
        if (this.sessionId !== null) {
            throw new Error("Helper transport is already connected");
        }
        const connection = await this.client.connect(address);
        this.sessionId = connection.sessionId;
        try {
            this.unsubscribeNotification = this.client.onNotification((event) => {
                if (event.sessionId !== this.sessionId) {
                    return;
                }
                const callback = this.subscribers.get(normalizeUuid(event.uuid));
                callback?.(event.data);
            });
        }
        catch (error) {
            this.sessionId = null;
            try {
                await this.client.disconnect(connection.sessionId);
            }
            catch {
                // Preserve the notification wiring failure that made the transport unusable.
            }
            throw error;
        }
    }
    /**
     * Clears JavaScript ownership and asks the helper to disconnect.
     *
     * @remarks
     * JavaScript-side state (session ID, subscribers, notification listener) is
     * cleared **before** calling the helper's disconnect, so a failing native
     * cleanup cannot leave the transport logically connected. Native cleanup may
     * fail for an already-disposed GATT object.
     */
    async disconnect() {
        const sessionId = this.sessionId;
        this.sessionId = null;
        this.unsubscribeNotification?.();
        this.unsubscribeNotification = null;
        this.subscribers.clear();
        if (sessionId !== null) {
            await this.client.disconnect(sessionId);
        }
    }
    /** Reads a characteristic via the helper client's native session. */
    async readCharacteristic(uuid) {
        return this.client.readCharacteristic(this.requireSessionId(), uuid);
    }
    /** Writes a characteristic via the helper client's native session. */
    async writeCharacteristic(uuid, data) {
        await this.client.writeCharacteristic(this.requireSessionId(), uuid, data);
    }
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
    async subscribe(uuid, onData) {
        const normalizedUuid = normalizeUuid(uuid);
        // Register first to avoid missing an immediate notification, then restore
        // the previous callback if native subscription fails.
        const previous = this.subscribers.get(normalizedUuid);
        this.subscribers.set(normalizedUuid, onData);
        try {
            await this.client.subscribe(this.requireSessionId(), uuid);
        }
        catch (error) {
            if (previous === undefined) {
                this.subscribers.delete(normalizedUuid);
            }
            else {
                this.subscribers.set(normalizedUuid, previous);
            }
            throw error;
        }
    }
    /**
     * Returns the active session ID or throws when not connected.
     *
     * @returns The current helper session ID.
     * @throws {Error} When the transport is not connected.
     */
    requireSessionId() {
        if (this.sessionId === null) {
            throw new Error("Helper transport is not connected");
        }
        return this.sessionId;
    }
}
/**
 * Factory that produces {@link WindowsHelperTransport} instances sharing one
 * helper client.
 */
export class WindowsHelperTransportFactory {
    client;
    /**
     * @param client - Shared helper client that owns the native process.
     */
    constructor(client) {
        this.client = client;
    }
    /** @returns A new transport backed by the shared helper client. */
    create() {
        return new WindowsHelperTransport(this.client);
    }
}
/**
 * Normalizes a UUID to lowercase for consistent map keys.
 *
 * @param uuid - Characteristic UUID in any case.
 * @returns Lowercased UUID string.
 */
function normalizeUuid(uuid) {
    return uuid.toLowerCase();
}
