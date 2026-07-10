import {
	type DbusCallOptions,
	DbusClient,
	type DbusMessage,
	type DbusValue,
	dictGetBool,
	dictGetNumber,
	dictGetString,
	type ManagedObjects,
	type StringVariantDict,
} from "./dbus-client.js";
import type {
	BluetoothDiscovery,
	BluetoothRuntime,
	BluetoothTransport,
	BluetoothTransportFactory,
	DiscoveredBluetoothDevice,
} from "./transport.js";

// ── Constants ────────────────────────────────────────────────────────────────

const BLUEZ_SERVICE = "org.bluez";
const OBJECT_MANAGER_IFACE = "org.freedesktop.DBus.ObjectManager";
const PROPERTIES_IFACE = "org.freedesktop.DBus.Properties";
const ADAPTER1_IFACE = "org.bluez.Adapter1";
const DEVICE1_IFACE = "org.bluez.Device1";
const GATT_SERVICE1_IFACE = "org.bluez.GattService1";
const GATT_CHAR1_IFACE = "org.bluez.GattCharacteristic1";

const DEFAULT_SCAN_TIMEOUT_MS = 5_000;
const DEFAULT_CALL_TIMEOUT_MS = 30_000;

// ── MAC address helpers ──────────────────────────────────────────────────────

function normalizeAddress(address: string): string {
	return address.replace(/:/g, "").toUpperCase();
}

function formatAddress(raw: string): string {
	const compact = raw.replace(/:/g, "").toUpperCase();
	return compact.replace(/(.{2})(?=.)/g, "$1:");
}

function addressToDevicePath(adapter: string, address: string): string {
	return `${adapter}/dev_${normalizeAddress(address)}`;
}

function normalizeUuid(uuid: string): string {
	return uuid.replace(/-/g, "").toLowerCase();
}

// ── D-Bus variant constructors ───────────────────────────────────────────────

interface DbusVariant {
	readonly signature: string;
	readonly value: DbusValue;
}

function stringVariant(value: string): DbusVariant {
	return { signature: "s", value };
}

function booleanVariant(value: boolean): DbusVariant {
	return { signature: "b", value };
}

// ── Sleep utility ────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}

// ── BlueZ transport ──────────────────────────────────────────────────────────

/**
 * GATT transport backed by BlueZ over D-Bus.
 *
 * @remarks
 * Each transport owns one GATT connection to a single device. BlueZ handles
 * the underlying HCI communication; this transport speaks the D-Bus API that
 * BlueZ exposes for GATT characteristic read/write/subscribe operations.
 *
 * Characteristic discovery happens during {@link connect} by calling
 * `GetManagedObjects` and scanning for service/characteristic entries
 * belonging to this device. The discovered UUID→path map is cached for the
 * transport lifetime.
 *
 * Notifications arrive as `PropertiesChanged` signals on the characteristic
 * path with a `Value` key in the changed-properties dict.
 *
 * @see BlueZTransportFactory
 * @see BluetoothTransport
 */
export class BlueZTransport implements BluetoothTransport {
	private readonly dbus: DbusClient;
	private readonly adapterPath: string;
	private devicePath: string | null = null;
	private readonly characteristics = new Map<string, string>();
	private readonly subscribers = new Map<string, (data: Uint8Array) => void>();
	private unsubscribePropertiesChanged: (() => void) | null = null;

	constructor(dbus: DbusClient, adapterPath: string) {
		this.dbus = dbus;
		this.adapterPath = adapterPath;
	}

	/** @inheritdoc */
	async connect(address: string): Promise<void> {
		if (this.devicePath !== null) {
			throw new Error("BlueZ transport is already connected");
		}

		this.devicePath = addressToDevicePath(this.adapterPath, address);

		try {
			await this.callDevice("Connect");
			this.installPropertiesListener();
			await this.discoverCharacteristics();
		} catch (error) {
			this.devicePath = null;
			throw error;
		}
	}

	/** @inheritdoc */
	async disconnect(): Promise<void> {
		const devicePath = this.devicePath;
		this.devicePath = null;
		this.characteristics.clear();
		this.subscribers.clear();
		this.unsubscribePropertiesChanged?.();
		this.unsubscribePropertiesChanged = null;

		if (devicePath !== null) {
			try {
				await this.deviceCall({
					destination: BLUEZ_SERVICE,
					path: devicePath,
					iface: DEVICE1_IFACE,
					member: "Disconnect",
				});
			} catch {
				// Device may already be disconnected.
			}
		}
	}

	/** @inheritdoc */
	async readCharacteristic(uuid: string): Promise<Uint8Array> {
		const charPath = this.requireCharacteristicPath(uuid);

		const reply = await this.deviceCall({
			destination: BLUEZ_SERVICE,
			path: charPath,
			iface: GATT_CHAR1_IFACE,
			member: "ReadValue",
			signature: "a{sv}",
			body: [new Map<string, DbusVariant>()],
		});

		const value = reply.body[0];
		if (value instanceof Uint8Array) {
			return value;
		}
		throw new Error(
			`ReadValue returned unexpected type: ${value === undefined ? "undefined" : typeof value}`,
		);
	}

	/** @inheritdoc */
	async writeCharacteristic(uuid: string, data: Uint8Array): Promise<void> {
		const charPath = this.requireCharacteristicPath(uuid);
		const options = new Map<string, DbusVariant>();

		await this.deviceCall({
			destination: BLUEZ_SERVICE,
			path: charPath,
			iface: GATT_CHAR1_IFACE,
			member: "WriteValue",
			signature: "aya{sv}",
			body: [data, options],
		});
	}

	/** @inheritdoc */
	async subscribe(
		uuid: string,
		onData: (data: Uint8Array) => void,
	): Promise<void> {
		const charPath = this.requireCharacteristicPath(uuid);
		this.subscribers.set(normalizeUuid(uuid), onData);

		try {
			await this.deviceCall({
				destination: BLUEZ_SERVICE,
				path: charPath,
				iface: GATT_CHAR1_IFACE,
				member: "StartNotify",
			});
		} catch (error) {
			this.subscribers.delete(normalizeUuid(uuid));
			throw error;
		}
	}

	/**
	 * Queries BlueZ's ObjectManager and caches all GATT characteristics
	 * belonging to the connected device.
	 */
	private async discoverCharacteristics(): Promise<void> {
		const reply = await this.deviceCall({
			destination: BLUEZ_SERVICE,
			path: "/",
			iface: OBJECT_MANAGER_IFACE,
			member: "GetManagedObjects",
		});

		const managed = reply.body[0];
		if (!(managed instanceof Map)) {
			throw new Error("GetManagedObjects returned unexpected type");
		}

		const managedObjects = managed as unknown as ManagedObjects;
		const servicePaths = this.collectServicePaths(managedObjects);

		for (const [objectPath, interfaces] of managedObjects) {
			const charProps = interfaces.get(GATT_CHAR1_IFACE);
			if (charProps === undefined) {
				continue;
			}

			const servicePath = dictGetString(charProps, "Service");
			if (servicePath === undefined || !servicePaths.has(servicePath)) {
				continue;
			}

			const uuid = dictGetString(charProps, "UUID");
			if (uuid !== undefined) {
				this.characteristics.set(normalizeUuid(uuid), objectPath);
			}
		}
	}

	/**
	 * Finds all GATT service object paths belonging to this device.
	 */
	private collectServicePaths(managedObjects: ManagedObjects): Set<string> {
		const paths = new Set<string>();
		const devicePath = this.devicePath;

		for (const [, interfaces] of managedObjects) {
			const serviceProps = interfaces.get(GATT_SERVICE1_IFACE);
			if (serviceProps === undefined) {
				continue;
			}

			const serviceDevice = dictGetString(serviceProps, "Device");
			if (serviceDevice !== undefined && serviceDevice === devicePath) {
				// We need the object path, not just the interface properties.
				// Find it by scanning the outer map key.
			}
		}

		// Actually we need the key from the outer map, so re-iterate.
		for (const [objectPath, interfaces] of managedObjects) {
			const serviceProps = interfaces.get(GATT_SERVICE1_IFACE);
			if (serviceProps === undefined) {
				continue;
			}
			const serviceDevice = dictGetString(serviceProps, "Device");
			if (serviceDevice !== undefined && serviceDevice === devicePath) {
				paths.add(objectPath);
			}
		}

		return paths;
	}

	/**
	 * Installs a `PropertiesChanged` signal listener to route characteristic
	 * notification values to subscribers.
	 */
	private installPropertiesListener(): void {
		const devicePath = this.devicePath;

		this.unsubscribePropertiesChanged = this.dbus.onSignal(
			PROPERTIES_IFACE,
			"PropertiesChanged",
			(msg: DbusMessage) => {
				if (
					msg.path === undefined ||
					devicePath === null ||
					!msg.path.startsWith(devicePath)
				) {
					return;
				}

				const changedProps = msg.body[1];
				if (!(changedProps instanceof Map)) {
					return;
				}

				const changedDict = changedProps as StringVariantDict;
				const variant = changedDict.get("Value");
				if (variant === undefined) {
					return;
				}

				if (variant.value instanceof Uint8Array) {
					const uuid = this.pathToUuid(msg.path);
					if (uuid !== null) {
						const subscriber = this.subscribers.get(uuid);
						subscriber?.(variant.value);
					}
				}
			},
		);
	}

	/**
	 * Maps a D-Bus object path back to its normalized UUID.
	 */
	private pathToUuid(charPath: string): string | null {
		for (const [uuid, path] of this.characteristics) {
			if (path === charPath) {
				return uuid;
			}
		}
		return null;
	}

	/**
	 * Returns the cached D-Bus path for a characteristic UUID, or throws.
	 */
	private requireCharacteristicPath(uuid: string): string {
		if (this.devicePath === null) {
			throw new Error("BlueZ transport is not connected");
		}
		const path = this.characteristics.get(normalizeUuid(uuid));
		if (path === undefined) {
			throw new Error(`Characteristic ${uuid} not found on device`);
		}
		return path;
	}

	/**
	 * Calls a Device1 method on the connected device.
	 */
	private async callDevice(member: string): Promise<DbusMessage> {
		if (this.devicePath === null) {
			throw new Error("No device path set");
		}
		return this.deviceCall({
			destination: BLUEZ_SERVICE,
			path: this.devicePath,
			iface: DEVICE1_IFACE,
			member,
		});
	}

	/**
	 * Wraps a D-Bus call.
	 */
	private async deviceCall(opts: DbusCallOptions): Promise<DbusMessage> {
		return this.dbus.call(opts);
	}
}

// ── BlueZ transport factory ───────────────────────────────────────────────────

/**
 * Factory that produces {@link BlueZTransport} instances sharing one D-Bus
 * connection and adapter.
 *
 * @see BlueZTransport
 * @see BluetoothTransportFactory
 */
export class BlueZTransportFactory implements BluetoothTransportFactory {
	private readonly dbus: DbusClient;
	private readonly adapterPath: string;

	constructor(dbus: DbusClient, adapterPath: string) {
		this.dbus = dbus;
		this.adapterPath = adapterPath;
	}

	/** @returns A new transport sharing the D-Bus connection. */
	create(): BluetoothTransport {
		return new BlueZTransport(this.dbus, this.adapterPath);
	}
}

// ── BlueZ discovery ──────────────────────────────────────────────────────────

/**
 * Parses a `StringVariantDict` from BlueZ into a {@link DiscoveredBluetoothDevice},
 * or returns `null` if the required fields are missing.
 */
function parseDeviceProps(
	props: StringVariantDict,
): DiscoveredBluetoothDevice | null {
	const address = dictGetString(props, "Address");
	const name = dictGetString(props, "Name");
	if (address === undefined || name === undefined) {
		return null;
	}

	const rssi = dictGetNumber(props, "RSSI");
	return {
		address: formatAddress(address),
		name,
		...(rssi !== undefined && { rssi }),
	};
}

/**
 * Scans for nearby BLE devices using BlueZ's discovery API.
 *
 * @see BluetoothDiscovery
 */
export class BlueZDiscovery implements BluetoothDiscovery {
	private readonly dbus: DbusClient;
	private readonly adapterPath: string;

	constructor(dbus: DbusClient, adapterPath: string) {
		this.dbus = dbus;
		this.adapterPath = adapterPath;
	}

	/**
	 * Scans for nearby BLE devices.
	 *
	 * @param timeoutMs - Scan duration in milliseconds (default 5 s).
	 * @returns Discovered devices sorted by signal strength.
	 */
	async discover(
		timeoutMs = DEFAULT_SCAN_TIMEOUT_MS,
	): Promise<readonly DiscoveredBluetoothDevice[]> {
		const discovered = new Map<string, DiscoveredBluetoothDevice>();

		const unsubscribe = this.dbus.onSignal(
			OBJECT_MANAGER_IFACE,
			"InterfacesAdded",
			(msg: DbusMessage) => {
				if (msg.path === undefined || !msg.path.startsWith(this.adapterPath)) {
					return;
				}

				const interfaces = msg.body[1];
				if (!(interfaces instanceof Map)) {
					return;
				}

				const deviceProps = (interfaces as Map<string, StringVariantDict>).get(
					DEVICE1_IFACE,
				);
				if (deviceProps === undefined) {
					return;
				}

				const raw = parseDeviceProps(deviceProps);
				if (raw === null || raw.name === undefined) {
					return;
				}

				const device: DiscoveredBluetoothDevice = {
					address: formatAddress(raw.address),
					name: raw.name,
					...(raw.rssi !== undefined && { rssi: raw.rssi }),
				};
				discovered.set(device.address, device);
			},
		);

		await this.setAdapterPower(true);
		await this.setDiscoveryFilter();
		await this.startDiscovery();

		try {
			await sleep(timeoutMs);
		} finally {
			await this.stopDiscovery();
			unsubscribe();
		}

		return [...discovered.values()].sort(
			(a, b) => (b.rssi ?? -999) - (a.rssi ?? -999),
		);
	}

	private async setAdapterPower(powered: boolean): Promise<void> {
		const variant: DbusVariant = booleanVariant(powered);

		await this.dbus.call({
			destination: BLUEZ_SERVICE,
			path: this.adapterPath,
			iface: PROPERTIES_IFACE,
			member: "Set",
			signature: "ssv",
			body: [ADAPTER1_IFACE, "Powered", variant],
		});
	}

	private async setDiscoveryFilter(): Promise<void> {
		const filter = new Map<string, DbusVariant>();
		filter.set("Transport", stringVariant("le"));

		await this.dbus.call({
			destination: BLUEZ_SERVICE,
			path: this.adapterPath,
			iface: ADAPTER1_IFACE,
			member: "SetDiscoveryFilter",
			signature: "a{sv}",
			body: [filter],
		});
	}

	private async startDiscovery(): Promise<void> {
		await this.dbus.call({
			destination: BLUEZ_SERVICE,
			path: this.adapterPath,
			iface: ADAPTER1_IFACE,
			member: "StartDiscovery",
		});
	}

	private async stopDiscovery(): Promise<void> {
		try {
			await this.dbus.call({
				destination: BLUEZ_SERVICE,
				path: this.adapterPath,
				iface: ADAPTER1_IFACE,
				member: "StopDiscovery",
			});
		} catch {
			// Best effort — discovery may have already stopped.
		}
	}
}

// ── Adapter discovery ────────────────────────────────────────────────────────

/**
 * Returns the first powered HCI adapter object path from BlueZ.
 *
 * @param dbus - Connected D-Bus client.
 * @returns The adapter object path (e.g. `/org/bluez/hci0`).
 * @throws {Error} When no powered adapter is found.
 */
export async function findAdapter(dbus: DbusClient): Promise<string> {
	const reply = await dbus.call({
		destination: BLUEZ_SERVICE,
		path: "/",
		iface: OBJECT_MANAGER_IFACE,
		member: "GetManagedObjects",
	});

	const managed = reply.body[0];
	if (!(managed instanceof Map)) {
		throw new Error("No BlueZ adapters found");
	}

	const managedObjects = managed as unknown as ManagedObjects;

	for (const [objectPath, interfaces] of managedObjects) {
		const adapterProps = interfaces.get(ADAPTER1_IFACE);
		if (adapterProps === undefined) {
			continue;
		}
		const powered = dictGetBool(adapterProps, "Powered");
		if (powered === true) {
			return objectPath;
		}
	}

	// Fall back to the first adapter if none are powered.
	for (const [objectPath, interfaces] of managedObjects) {
		if (interfaces.has(ADAPTER1_IFACE)) {
			return objectPath;
		}
	}

	throw new Error("No Bluetooth adapter found");
}

// ── Runtime creation ─────────────────────────────────────────────────────────

/**
 * Creates a Linux Bluetooth runtime backed by BlueZ over D-Bus.
 *
 * @returns A {@link BluetoothRuntime} with discovery and transport factory.
 *
 * @example
 * ```ts
 * const runtime = await createLinuxRuntime();
 * const transport = runtime.transportFactory.create();
 * ```
 */
export async function createLinuxRuntime(): Promise<BluetoothRuntime> {
	const dbus = new DbusClient(DEFAULT_CALL_TIMEOUT_MS);
	await dbus.connect();

	const adapterPath = await findAdapter(dbus);
	const factory = new BlueZTransportFactory(dbus, adapterPath);
	const discovery = new BlueZDiscovery(dbus, adapterPath);

	return {
		transportFactory: factory,
		discovery,
		dispose: () => dbus.close(),
	};
}
