/**
 * Stateful in-memory GATT transport used by protocol and session tests.
 *
 * @remarks
 * Implements the full {@link BluetoothTransport} contract without any native
 * BLE dependency. Characteristic reads return seeded values; writes are
 * captured for later assertion; subscribers receive synthetic notifications
 * via {@link MockBluetoothTransport.emit}.
 *
 * UUIDs are normalized (hyphens stripped, lowercased) before lookup so tests
 * can use either standard UUID notation or compact forms.
 *
 * @example
 * ```ts
 * const mock = new MockBluetoothTransport({
 *   characteristics: { "00002a00-...": Buffer.from("AC500-123") },
 * });
 * const session = new DeviceSession("AA:BB:CC:DD:EE:FF", mock);
 * await session.connectAndInitialize();
 * ```
 *
 * @see DeviceSession
 * @see BluetoothTransport
 */
export class MockBluetoothTransport {
    /** Seeded characteristic values keyed by normalized UUID. */
    characteristics = new Map();
    /** Registered notification subscribers keyed by normalized UUID. */
    subscribers = new Map();
    /** Array capturing all write payloads in order. */
    writes;
    /** Currently connected address, or `null` when disconnected. */
    connectedAddress = null;
    /**
     * Creates a mock transport with optional seed data.
     *
     * @param options - Seed characteristics and write capture array.
     */
    constructor(options = {}) {
        for (const [uuid, value] of Object.entries(options.characteristics ?? {})) {
            this.characteristics.set(normalizeUuid(uuid), value.slice());
        }
        this.writes = options.writes ?? [];
    }
    /** @inheritdoc */
    async connect(address) {
        this.connectedAddress = address;
    }
    /** @inheritdoc */
    async disconnect() {
        this.connectedAddress = null;
        this.subscribers.clear();
    }
    /**
     * Returns a defensive copy of the seeded characteristic value.
     *
     * @param uuid - Characteristic UUID to read.
     * @returns A copy of the seeded value.
     * @throws {Error} When not connected or no value is registered for `uuid`.
     */
    async readCharacteristic(uuid) {
        this.requireConnected();
        const value = this.characteristics.get(normalizeUuid(uuid));
        if (value === undefined) {
            throw new Error(`No mock characteristic value registered for ${uuid}`);
        }
        return value.slice();
    }
    /**
     * Captures a defensive copy of the written payload.
     *
     * @param _uuid - Characteristic UUID (unused by the mock).
     * @param data - Payload bytes to capture.
     */
    async writeCharacteristic(_uuid, data) {
        this.requireConnected();
        this.writes.push(data.slice());
    }
    /**
     * Registers a subscriber for the given UUID.
     *
     * @param uuid - Characteristic UUID to subscribe to.
     * @param onData - Callback invoked when {@link emit} is called for this UUID.
     */
    async subscribe(uuid, onData) {
        this.requireConnected();
        this.subscribers.set(normalizeUuid(uuid), onData);
    }
    /**
     * Emits a synthetic characteristic notification to the active subscriber.
     *
     * @param uuid - Characteristic UUID with a registered subscriber.
     * @param data - Notification bytes to deliver (a copy is passed to the callback).
     * @throws {Error} When not connected or no subscriber is registered for `uuid`.
     */
    emit(uuid, data) {
        this.requireConnected();
        const subscriber = this.subscribers.get(normalizeUuid(uuid));
        if (subscriber === undefined) {
            throw new Error(`No mock subscriber registered for ${uuid}`);
        }
        subscriber(data.slice());
    }
    /**
     * Throws when the transport is not connected.
     *
     * @throws {Error} When `connectedAddress` is `null`.
     */
    requireConnected() {
        if (this.connectedAddress === null) {
            throw new Error("Mock Bluetooth transport is not connected");
        }
    }
}
/**
 * Factory that returns a caller-owned mock transport instance.
 *
 * @remarks
 * Unlike a real factory, this always returns the same transport instance,
 * making it convenient for tests that need to inspect or emit on the mock
 * after creation.
 *
 * @see MockBluetoothTransport
 * @see BluetoothTransportFactory
 */
export class MockBluetoothTransportFactory {
    transport;
    /**
     * @param transport - Mock transport to return from {@link create}.
     */
    constructor(transport) {
        this.transport = transport;
    }
    /** @returns The mock transport passed at construction. */
    create() {
        return this.transport;
    }
}
/**
 * Normalizes a UUID by stripping hyphens and lowercasing.
 *
 * @param uuid - Characteristic UUID in any format.
 * @returns Compact lowercase UUID (no hyphens).
 */
function normalizeUuid(uuid) {
    return uuid.replace(/-/g, "").toLowerCase();
}
