import type { BluetoothTransport, BluetoothTransportFactory } from "./transport.js";
/**
 * Seed data and write capture supplied to {@link MockBluetoothTransport}.
 *
 * @see MockBluetoothTransport
 */
export interface MockBluetoothOptions {
    /** Pre-populated characteristic values keyed by UUID. */
    readonly characteristics?: Readonly<Record<string, Uint8Array>>;
    /** Array that captures all write payloads in order. */
    readonly writes?: Uint8Array[];
}
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
export declare class MockBluetoothTransport implements BluetoothTransport {
    /** Seeded characteristic values keyed by normalized UUID. */
    private readonly characteristics;
    /** Registered notification subscribers keyed by normalized UUID. */
    private readonly subscribers;
    /** Array capturing all write payloads in order. */
    private readonly writes;
    /** Currently connected address, or `null` when disconnected. */
    connectedAddress: string | null;
    /**
     * Creates a mock transport with optional seed data.
     *
     * @param options - Seed characteristics and write capture array.
     */
    constructor(options?: MockBluetoothOptions);
    /** @inheritdoc */
    connect(address: string): Promise<void>;
    /** @inheritdoc */
    disconnect(): Promise<void>;
    /**
     * Returns a defensive copy of the seeded characteristic value.
     *
     * @param uuid - Characteristic UUID to read.
     * @returns A copy of the seeded value.
     * @throws {Error} When not connected or no value is registered for `uuid`.
     */
    readCharacteristic(uuid: string): Promise<Uint8Array>;
    /**
     * Captures a defensive copy of the written payload.
     *
     * @param _uuid - Characteristic UUID (unused by the mock).
     * @param data - Payload bytes to capture.
     */
    writeCharacteristic(_uuid: string, data: Uint8Array): Promise<void>;
    /**
     * Registers a subscriber for the given UUID.
     *
     * @param uuid - Characteristic UUID to subscribe to.
     * @param onData - Callback invoked when {@link emit} is called for this UUID.
     */
    subscribe(uuid: string, onData: (data: Uint8Array) => void): Promise<void>;
    /**
     * Emits a synthetic characteristic notification to the active subscriber.
     *
     * @param uuid - Characteristic UUID with a registered subscriber.
     * @param data - Notification bytes to deliver (a copy is passed to the callback).
     * @throws {Error} When not connected or no subscriber is registered for `uuid`.
     */
    emit(uuid: string, data: Uint8Array): void;
    /**
     * Throws when the transport is not connected.
     *
     * @throws {Error} When `connectedAddress` is `null`.
     */
    private requireConnected;
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
export declare class MockBluetoothTransportFactory implements BluetoothTransportFactory {
    private readonly transport;
    /**
     * @param transport - Mock transport to return from {@link create}.
     */
    constructor(transport: MockBluetoothTransport);
    /** @returns The mock transport passed at construction. */
    create(): BluetoothTransport;
}
