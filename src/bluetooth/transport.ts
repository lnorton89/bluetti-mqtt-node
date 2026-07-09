/**
 * Device advertisement returned by platform discovery.
 *
 * @see BluetoothDiscovery.discover
 */
export interface DiscoveredBluetoothDevice {
	/** Bluetooth MAC address (normalized colon-separated uppercase). */
	readonly address: string;
	/** Advertised device name (e.g. `"AC500-2237000003358"`). */
	readonly name: string;
	/** Received signal strength indicator in dBm, if reported. */
	readonly rssi?: number;
}

/**
 * Platform-neutral GATT operations required by {@link DeviceSession}.
 *
 * @remarks
 * Subscription lifetime matches connection lifetime. Implementations must
 * remove notification callbacks during `disconnect`, even if native cleanup
 * reports a failure. This contract ensures {@link DeviceSession} can rely on
 * a clean slate after reconnecting without leaked listeners.
 *
 * @see BluetoothTransportFactory
 * @see WindowsHelperTransport
 * @see MockBluetoothTransport
 */
export interface BluetoothTransport {
	/**
	 * Opens a GATT connection to the device at `address`.
	 *
	 * @param address - Bluetooth MAC address to connect to.
	 * @throws {Error} When the transport is already connected or the connection fails.
	 */
	connect(address: string): Promise<void>;
	/**
	 * Closes the GATT connection and removes all notification callbacks.
	 *
	 * Implementations must clear subscriber state even if native cleanup fails.
	 */
	disconnect(): Promise<void>;
	/**
	 * Reads the current value of a GATT characteristic.
	 *
	 * @param uuid - Characteristic UUID to read.
	 * @returns The raw characteristic value bytes.
	 * @throws {Error} When not connected or the characteristic is not found.
	 */
	readCharacteristic(uuid: string): Promise<Uint8Array>;
	/**
	 * Writes bytes to a GATT characteristic.
	 *
	 * @param uuid - Characteristic UUID to write.
	 * @param data - Payload bytes to send.
	 */
	writeCharacteristic(uuid: string, data: Uint8Array): Promise<void>;
	/**
	 * Enables notifications for a characteristic and registers a callback.
	 *
	 * @param uuid - Characteristic UUID to subscribe to.
	 * @param onData - Callback invoked for each notification payload.
	 */
	subscribe(uuid: string, onData: (data: Uint8Array) => void): Promise<void>;
}

/**
 * Creates isolated connection transports, potentially sharing a native host.
 *
 * @remarks
 * A single factory (and the native process behind it) may produce multiple
 * transports, each owning one independent GATT session. The
 * {@link MultiDeviceManager} uses one factory to create one transport per
 * configured device address.
 *
 * @see BluetoothRuntime
 */
export interface BluetoothTransportFactory {
	/**
	 * Creates a new transport instance for one device connection.
	 *
	 * @returns A transport that is not yet connected.
	 */
	create(): BluetoothTransport;
}

/**
 * Discovers nearby devices without opening a polling session.
 *
 * @see BluetoothRuntime
 */
export interface BluetoothDiscovery {
	/**
	 * Scans for nearby Bluetooth LE devices and returns their advertisements.
	 *
	 * @returns Devices discovered during the scan window.
	 */
	discover(): Promise<readonly DiscoveredBluetoothDevice[]>;
}

/**
 * Platform runtime containing transport creation and optional discovery.
 *
 * @remarks
 * Bundles the transport factory and discovery adapter for a specific platform
 * (e.g. the Windows helper). The CLI and server consume this to obtain BLE
 * access without depending on platform internals.
 *
 * @see createWindowsHelperRuntime
 */
export interface BluetoothRuntime {
	/** Transport factory for creating per-device GATT connections. */
	readonly transportFactory: BluetoothTransportFactory;
	/** Optional discovery adapter for scanning nearby devices. */
	readonly discovery?: BluetoothDiscovery;
}
