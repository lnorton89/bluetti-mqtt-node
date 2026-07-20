import {
	EXCEPTION_FLAG_MASK,
	FC_READ_HOLDING_REGISTERS,
	FC_WRITE_MULTIPLE_REGISTERS,
	FC_WRITE_SINGLE_REGISTER,
	MODBUS_UNIT_ADDRESS,
} from "@core/constants.js";
import { appendModbusCrc, hasValidModbusCrc } from "@core/crc.js";
import { isAddressWritable } from "@core/types.js";
import { VERSION_DIVISOR, VERSION_WORD_SHIFT } from "@devices/constants.js";
import {
	BLUETTI_DEFINITION_MAP,
	type DeviceDefinition,
} from "@devices/definition.js";
import {
	BoolField,
	DecimalArrayField,
	DecimalField,
	EnumField,
	SerialNumberField,
	StringField,
	SwapStringField,
	UintField,
	VersionField,
} from "@devices/field.js";
import type {
	BluetoothRuntime,
	BluetoothTransport,
	BluetoothTransportFactory,
	DiscoveredBluetoothDevice,
} from "./transport.js";

/** MODBUS exception code for an illegal data address (write outside writable ranges). */
const EXCEPTION_ILLEGAL_DATA_ADDRESS = 2;
/** MODBUS exception code for an illegal (unsupported) function. */
const EXCEPTION_ILLEGAL_FUNCTION = 1;
/** Default serial number for simulated devices when none is supplied. */
const DEFAULT_SERIAL_NUMBER = "2401234567890";
/** Default notification chunk size, mirroring the common BLE ATT payload. */
const DEFAULT_CHUNK_SIZE = 20;
/** Default artificial latency before notification chunks are delivered. */
const DEFAULT_NOTIFY_DELAY_MS = 15;
/** Synthetic RSSI reported for simulated advertisements. */
const SIMULATED_RSSI_DBM = -60;
/** First MAC address assigned by {@link createSimulatedFleet}. */
const FLEET_BASE_ADDRESS = 0x001122334455;

/**
 * Construction options for {@link SimulatedBluettiDevice}.
 *
 * @see SimulatedBluettiDevice
 */
export interface SimulatedBluettiDeviceOptions {
	/** Model family key from the device registry (e.g. `"AC500"`). */
	readonly model: string;
	/** Bluetooth MAC address the device answers on. */
	readonly address: string;
	/** Serial number digits advertised after the model name. */
	readonly serialNumber?: string;
	/** Maximum notification payload size in bytes (default 20). */
	readonly chunkSize?: number;
	/** Artificial latency before notification delivery (default 15 ms). */
	readonly notifyDelayMs?: number;
	/** Raw register overrides applied after default seeding. */
	readonly registers?: Readonly<Record<number, number>>;
	/** Whether live power values drift between reads (default `true`). */
	readonly dynamicValues?: boolean;
}

/**
 * In-memory emulation of one Bluetti power station's MODBUS register bank.
 *
 * @remarks
 * The simulator speaks the same MODBUS-over-BLE dialect that
 * {@link DeviceSession} expects: CRC-protected frames with unit address `1`,
 * function codes `0x03`/`0x06`/`0x10`, echo responses for writes, and 5-byte
 * exception frames. Registers are seeded from the model's
 * {@link DeviceStruct} field schema so every model in the registry produces
 * plausible parsed telemetry without a per-model seed table.
 *
 * Frames with an invalid CRC or foreign unit address are silently ignored,
 * matching real device behavior. Writes outside the model's declared
 * writable ranges return an illegal-data-address exception.
 *
 * @example
 * ```ts
 * const device = new SimulatedBluettiDevice({
 *   model: "AC500",
 *   address: "00:11:22:33:44:55",
 * });
 * const runtime = createSimulatedRuntime([device]);
 * ```
 *
 * @see createSimulatedRuntime
 * @see SimulatedDeviceTransport
 */
export class SimulatedBluettiDevice {
	/** Bluetooth MAC address the device answers on. */
	readonly address: string;
	/** Advertised BLE name (`model + serialNumber`, no separator). */
	readonly name: string;
	/** Model family key (e.g. `"AC500"`). */
	readonly model: string;
	/** Maximum notification payload size in bytes. */
	readonly chunkSize: number;
	/** Artificial latency before notification delivery. */
	readonly notifyDelayMs: number;
	/** Raw 16-bit register bank; unseeded addresses read as 0. */
	readonly registers = new Map<number, number>();
	/** Device definition backing seeding and writable-range checks. */
	private readonly definition: DeviceDefinition;
	/** Whether live power values drift between reads. */
	private readonly dynamicValues: boolean;
	/** Queued exception codes returned instead of the next responses. */
	private readonly queuedExceptions: number[] = [];
	/** Number of upcoming responses to silently drop. */
	private droppedResponses = 0;

	/**
	 * Creates and seeds a simulated device.
	 *
	 * @param options - Model, address, and optional behavior overrides.
	 * @throws {Error} When `model` is not in the device registry or
	 *   `serialNumber` is not all digits.
	 */
	constructor(options: SimulatedBluettiDeviceOptions) {
		const definition = BLUETTI_DEFINITION_MAP.get(options.model);
		if (definition === undefined) {
			const known = [...BLUETTI_DEFINITION_MAP.keys()].join(", ");
			throw new Error(
				`Unknown simulated device model '${options.model}'. Known models: ${known}`,
			);
		}

		const serialNumber = options.serialNumber ?? DEFAULT_SERIAL_NUMBER;
		if (!/^\d+$/.test(serialNumber)) {
			throw new Error(
				`Simulated serial number must be digits only, got '${serialNumber}'`,
			);
		}

		this.definition = definition;
		this.model = options.model;
		this.address = options.address;
		this.name = `${options.model}${serialNumber}`;
		this.chunkSize = options.chunkSize ?? DEFAULT_CHUNK_SIZE;
		this.notifyDelayMs = options.notifyDelayMs ?? DEFAULT_NOTIFY_DELAY_MS;
		this.dynamicValues = options.dynamicValues ?? true;

		seedRegisters(this.registers, definition, serialNumber);
		for (const [address, value] of Object.entries(options.registers ?? {})) {
			this.registers.set(Number(address), value & 0xffff);
		}
	}

	/**
	 * Queues a MODBUS exception returned instead of the next valid command.
	 *
	 * @param code - Exception code to report (e.g. `5` for device busy).
	 */
	queueException(code: number): void {
		this.queuedExceptions.push(code);
	}

	/**
	 * Silently drops the response to the next valid command.
	 *
	 * @remarks
	 * Used to exercise the {@link CommandTimeoutError} path in consumers.
	 */
	dropNextResponse(): void {
		this.droppedResponses += 1;
	}

	/**
	 * Processes one request frame and returns the response frame, if any.
	 *
	 * @param frame - Raw bytes written to the MODBUS write characteristic.
	 * @returns The complete CRC-protected response frame, or `null` when the
	 *   frame is ignored (bad CRC, foreign unit address, or a dropped response).
	 */
	handleWrite(frame: Uint8Array): Uint8Array | null {
		if (
			frame.length < 4 ||
			frame[0] !== MODBUS_UNIT_ADDRESS ||
			!hasValidModbusCrc(frame)
		) {
			return null;
		}

		if (this.droppedResponses > 0) {
			this.droppedResponses -= 1;
			return null;
		}

		const functionCode = frame[1] as number;
		const queuedException = this.queuedExceptions.shift();
		if (queuedException !== undefined) {
			return this.buildException(functionCode, queuedException);
		}

		switch (functionCode) {
			case FC_READ_HOLDING_REGISTERS:
				return this.handleReadHolding(frame);
			case FC_WRITE_SINGLE_REGISTER:
				return this.handleWriteSingle(frame);
			case FC_WRITE_MULTIPLE_REGISTERS:
				return this.handleWriteMultiple(frame);
			default:
				return this.buildException(functionCode, EXCEPTION_ILLEGAL_FUNCTION);
		}
	}

	/**
	 * Builds the `[unit, fc, byteCount, ...data, crc]` read response.
	 *
	 * @param frame - Validated read-holding-registers request frame.
	 * @returns The CRC-protected response frame.
	 */
	private handleReadHolding(frame: Uint8Array): Uint8Array {
		const startingAddress = readUint16(frame, 2);
		const quantity = readUint16(frame, 4);
		if (this.dynamicValues) {
			this.driftLiveValues();
		}

		const body = new Uint8Array(3 + quantity * 2);
		body[0] = MODBUS_UNIT_ADDRESS;
		body[1] = FC_READ_HOLDING_REGISTERS;
		body[2] = quantity * 2;
		for (let index = 0; index < quantity; index += 1) {
			const value = this.registers.get(startingAddress + index) ?? 0;
			body[3 + index * 2] = (value >> 8) & 0xff;
			body[4 + index * 2] = value & 0xff;
		}
		return appendModbusCrc(body);
	}

	/**
	 * Applies a single-register write and echoes the request frame.
	 *
	 * @param frame - Validated write-single-register request frame.
	 * @returns The echoed request frame, or an exception frame when the
	 *   address is outside the model's writable ranges.
	 */
	private handleWriteSingle(frame: Uint8Array): Uint8Array {
		const address = readUint16(frame, 2);
		if (!this.isWritable(address)) {
			return this.buildException(
				FC_WRITE_SINGLE_REGISTER,
				EXCEPTION_ILLEGAL_DATA_ADDRESS,
			);
		}

		this.registers.set(address, readUint16(frame, 4));
		return frame.slice();
	}

	/**
	 * Applies a multi-register write and builds the 8-byte echo response.
	 *
	 * @param frame - Validated write-multiple-registers request frame.
	 * @returns The `[unit, fc, address, quantity, crc]` echo, or an exception
	 *   frame when any written address is outside the writable ranges.
	 */
	private handleWriteMultiple(frame: Uint8Array): Uint8Array {
		const startingAddress = readUint16(frame, 2);
		const quantity = readUint16(frame, 4);
		for (let index = 0; index < quantity; index += 1) {
			if (!this.isWritable(startingAddress + index)) {
				return this.buildException(
					FC_WRITE_MULTIPLE_REGISTERS,
					EXCEPTION_ILLEGAL_DATA_ADDRESS,
				);
			}
		}

		for (let index = 0; index < quantity; index += 1) {
			this.registers.set(
				startingAddress + index,
				readUint16(frame, 7 + index * 2),
			);
		}
		// Echo response reuses the leading six request bytes per the MODBUS spec.
		return appendModbusCrc(frame.slice(0, 6));
	}

	/**
	 * Returns whether the model declares the address writable.
	 *
	 * @param address - Register address to test.
	 * @returns `true` when inside a declared writable range.
	 */
	private isWritable(address: number): boolean {
		return isAddressWritable(address, this.definition.writableRanges ?? []);
	}

	/**
	 * Builds a 5-byte MODBUS exception frame.
	 *
	 * @param functionCode - Function code of the failing request.
	 * @param code - Exception code to report.
	 * @returns The CRC-protected exception frame.
	 */
	private buildException(functionCode: number, code: number): Uint8Array {
		return appendModbusCrc(
			new Uint8Array([
				MODBUS_UNIT_ADDRESS,
				functionCode + EXCEPTION_FLAG_MASK,
				code,
			]),
		);
	}

	/**
	 * Randomly wobbles live power registers so repeated polls look alive.
	 *
	 * @remarks
	 * Only transient power values drift; identity fields (serial, versions,
	 * battery percent) stay stable so tests and dashboards can rely on them.
	 */
	private driftLiveValues(): void {
		for (const address of [36, 38]) {
			const current = this.registers.get(address) ?? 0;
			const wobble = Math.floor(Math.random() * 21) - 10;
			this.registers.set(address, Math.max(0, current + wobble) & 0xffff);
		}
	}
}

/**
 * GATT transport adapter over a fleet of simulated devices.
 *
 * @remarks
 * Implements the full {@link BluetoothTransport} contract: the device name
 * characteristic serves the advertised name, MODBUS writes route to
 * {@link SimulatedBluettiDevice.handleWrite}, and response frames are sliced
 * into `chunkSize` notification chunks delivered after `notifyDelayMs`.
 * Subscribers are cleared on `disconnect` per the transport contract.
 *
 * @see createSimulatedRuntime
 */
export class SimulatedDeviceTransport implements BluetoothTransport {
	/** Currently connected simulated device, or `null` when disconnected. */
	private device: SimulatedBluettiDevice | null = null;
	/** Notification subscribers keyed by normalized UUID. */
	private readonly subscribers = new Map<string, (data: Uint8Array) => void>();

	/**
	 * @param fleet - Simulated devices addressable by this transport.
	 */
	constructor(
		private readonly fleet: ReadonlyMap<string, SimulatedBluettiDevice>,
	) {}

	/** @inheritdoc */
	async connect(address: string): Promise<void> {
		if (this.device !== null) {
			throw new Error("Simulated transport is already connected");
		}

		const device = this.fleet.get(normalizeAddress(address));
		if (device === undefined) {
			throw new Error(`No simulated device at address ${address}`);
		}
		this.device = device;
	}

	/** @inheritdoc */
	async disconnect(): Promise<void> {
		this.device = null;
		this.subscribers.clear();
	}

	/**
	 * Serves the standard device-name characteristic (`2A00`).
	 *
	 * @param uuid - Characteristic UUID to read.
	 * @returns ASCII bytes of the advertised device name.
	 * @throws {Error} When not connected or the characteristic is unknown.
	 */
	async readCharacteristic(uuid: string): Promise<Uint8Array> {
		const device = this.requireConnected();
		if (normalizeUuid(uuid) !== normalizeUuid(DEVICE_NAME_UUID)) {
			throw new Error(`Simulated device has no characteristic ${uuid}`);
		}
		return new Uint8Array(Buffer.from(device.name, "ascii"));
	}

	/**
	 * Routes MODBUS request frames to the connected device.
	 *
	 * @param uuid - Characteristic UUID to write.
	 * @param data - Request frame bytes.
	 * @throws {Error} When not connected or the characteristic is unknown.
	 */
	async writeCharacteristic(uuid: string, data: Uint8Array): Promise<void> {
		const device = this.requireConnected();
		if (normalizeUuid(uuid) !== normalizeUuid(WRITE_UUID)) {
			throw new Error(`Simulated device is not writable at ${uuid}`);
		}

		const response = device.handleWrite(data.slice());
		if (response === null) {
			return;
		}
		this.scheduleNotifications(device, response);
	}

	/** @inheritdoc */
	async subscribe(
		uuid: string,
		onData: (data: Uint8Array) => void,
	): Promise<void> {
		this.requireConnected();
		this.subscribers.set(normalizeUuid(uuid), onData);
	}

	/**
	 * Delivers a response frame as chunked notifications after the latency.
	 *
	 * @param device - Device whose chunking configuration applies.
	 * @param response - Complete response frame to deliver.
	 *
	 * @remarks
	 * Delivery is skipped when the transport disconnected (or re-subscribed
	 * away) before the timer fires, mirroring a dropped BLE notification.
	 */
	private scheduleNotifications(
		device: SimulatedBluettiDevice,
		response: Uint8Array,
	): void {
		setTimeout(() => {
			if (this.device !== device) {
				return;
			}
			const subscriber = this.subscribers.get(normalizeUuid(NOTIFY_UUID));
			if (subscriber === undefined) {
				return;
			}
			for (
				let offset = 0;
				offset < response.length;
				offset += device.chunkSize
			) {
				subscriber(response.slice(offset, offset + device.chunkSize));
			}
		}, device.notifyDelayMs);
	}

	/**
	 * Returns the connected device or throws.
	 *
	 * @returns The connected simulated device.
	 * @throws {Error} When the transport is not connected.
	 */
	private requireConnected(): SimulatedBluettiDevice {
		if (this.device === null) {
			throw new Error("Simulated transport is not connected");
		}
		return this.device;
	}
}

/**
 * Builds a fleet of simulated devices with deterministic sequential addresses.
 *
 * @param models - Model family keys (e.g. `["AC500", "EB3A"]`).
 * @returns One simulated device per model, addressed from
 *   `00:11:22:33:44:55` upward.
 * @throws {Error} When any model is not in the device registry.
 *
 * @example
 * ```ts
 * const [ac500] = createSimulatedFleet(["AC500"]);
 * ac500.address; // "00:11:22:33:44:55"
 * ```
 */
export function createSimulatedFleet(
	models: readonly string[],
): SimulatedBluettiDevice[] {
	return models.map(
		(model, index) =>
			new SimulatedBluettiDevice({
				model,
				address: formatAddress(FLEET_BASE_ADDRESS + index),
			}),
	);
}

/**
 * Creates a {@link BluetoothRuntime} backed by simulated devices.
 *
 * @param devices - Simulated devices reachable through the runtime.
 * @returns A runtime whose discovery lists the fleet and whose factory
 *   produces independent transports over it.
 *
 * @remarks
 * Each {@link BluetoothTransportFactory.create} call returns a fresh
 * transport, so the {@link MultiDeviceManager} can hold one isolated GATT
 * session per configured address, exactly as with real hardware.
 *
 * @see createSimulatedFleet
 */
export function createSimulatedRuntime(
	devices: readonly SimulatedBluettiDevice[],
): BluetoothRuntime {
	const fleet = new Map<string, SimulatedBluettiDevice>(
		devices.map((device) => [normalizeAddress(device.address), device]),
	);

	return {
		discovery: {
			async discover(): Promise<readonly DiscoveredBluetoothDevice[]> {
				return devices.map((device) => ({
					address: device.address,
					name: device.name,
					rssi: SIMULATED_RSSI_DBM,
				}));
			},
		},
		transportFactory: {
			create(): BluetoothTransport {
				return new SimulatedDeviceTransport(fleet);
			},
		},
	};
}

/** GATT characteristic UUID for writing MODBUS requests. */
const WRITE_UUID = "0000ff02-0000-1000-8000-00805f9b34fb";
/** GATT characteristic UUID for receiving MODBUS notifications. */
const NOTIFY_UUID = "0000ff01-0000-1000-8000-00805f9b34fb";
/** GATT characteristic UUID for the standard device name (2A00). */
const DEVICE_NAME_UUID = "00002a00-0000-1000-8000-00805f9b34fb";

/**
 * Seeds plausible telemetry into a register bank from a device definition.
 *
 * @param registers - Register bank to populate.
 * @param definition - Device definition whose struct drives the seeding.
 * @param serialNumber - Serial digits encoded into the serial-number field.
 *
 * @remarks
 * Every field in the model's struct receives a type-appropriate default
 * (strings get the model name, enums their first option, decimals a raw
 * value from the name-based table). This keeps all registry models usable
 * without hand-written per-model seed tables.
 */
function seedRegisters(
	registers: Map<number, number>,
	definition: DeviceDefinition,
	serialNumber: string,
): void {
	const struct = definition.buildStruct();
	for (const field of struct.fields) {
		if (field instanceof StringField || field instanceof SwapStringField) {
			writeString(
				registers,
				field.address,
				field.size,
				field.name === "device_type" ? definition.type : "SIM",
				field instanceof SwapStringField,
			);
		} else if (field instanceof SerialNumberField) {
			writeSerialNumber(registers, field.address, BigInt(serialNumber));
		} else if (field instanceof VersionField) {
			writeVersion(registers, field.address, SEED_VERSION);
		} else if (field instanceof DecimalArrayField) {
			for (let index = 0; index < field.size; index += 1) {
				registers.set(field.address + index, SEED_CELL_VOLTAGE_RAW);
			}
		} else if (field instanceof EnumField) {
			const first = Object.values(field.enumDefinition)[0];
			registers.set(field.address, typeof first === "number" ? first : 0);
		} else if (field instanceof BoolField) {
			registers.set(field.address, SEED_BOOL_ON.has(field.name) ? 1 : 0);
		} else if (field instanceof UintField || field instanceof DecimalField) {
			registers.set(field.address, SEED_RAW_VALUES[field.name] ?? 0);
		}
	}

	// pack_num_max mirrors the definition so pack polling loops behave.
	registers.set(91, definition.packNumMax);
}

/** Firmware version reported by simulated devices (`4013.27`). */
const SEED_VERSION = 4013.27;
/** Raw per-cell voltage (3.31 V at the common two-decimal scale). */
const SEED_CELL_VOLTAGE_RAW = 331;
/** Boolean fields seeded on; everything else defaults off. */
const SEED_BOOL_ON: ReadonlySet<string> = new Set([
	"ac_output_on",
	"dc_output_on",
	"bluetooth_connected",
]);
/**
 * Raw seed values for uint/decimal fields, keyed by field name.
 *
 * @remarks
 * Values are raw register contents; decimal fields divide by their scale at
 * parse time, so e.g. `total_battery_voltage` 5230 reads as 523.0 / 52.30
 * depending on the model's declared scale. Precision differences across
 * models are acceptable for simulation purposes.
 */
const SEED_RAW_VALUES: Readonly<Record<string, number>> = {
	dc_input_power: 120,
	ac_input_power: 0,
	ac_output_power: 350,
	dc_output_power: 45,
	total_battery_percent: 88,
	pack_battery_percent: 88,
	power_generation: 123,
	pack_num: 1,
	pack_voltage: 5230,
	total_battery_voltage: 5230,
	internal_ac_voltage: 1204,
	internal_ac_frequency: 5998,
	battery_range_start: 0,
	battery_range_end: 100,
};

/**
 * Encodes an ASCII string into consecutive registers.
 *
 * @param registers - Register bank to write into.
 * @param address - First register address.
 * @param size - Register count available for the string.
 * @param text - ASCII text (truncated/NUL-padded to fit).
 * @param swapped - Whether byte pairs are stored low-byte first
 *   (`SwapStringField` layout).
 */
function writeString(
	registers: Map<number, number>,
	address: number,
	size: number,
	text: string,
	swapped: boolean,
): void {
	for (let index = 0; index < size; index += 1) {
		const first = text.charCodeAt(index * 2) || 0;
		const second = text.charCodeAt(index * 2 + 1) || 0;
		registers.set(
			address + index,
			swapped ? (second << 8) | first : (first << 8) | second,
		);
	}
}

/**
 * Encodes a serial number as four little-word-first registers.
 *
 * @param registers - Register bank to write into.
 * @param address - First register address.
 * @param serial - Serial number value.
 */
function writeSerialNumber(
	registers: Map<number, number>,
	address: number,
	serial: bigint,
): void {
	for (let index = 0; index < 4; index += 1) {
		registers.set(
			address + index,
			Number((serial >> BigInt(index * 16)) & 0xffffn),
		);
	}
}

/**
 * Encodes a version number as low/high word registers.
 *
 * @param registers - Register bank to write into.
 * @param address - First register address (low word).
 * @param version - Version value (e.g. `4013.27`).
 */
function writeVersion(
	registers: Map<number, number>,
	address: number,
	version: number,
): void {
	const scaled = Math.round(version * VERSION_DIVISOR);
	registers.set(address, scaled % VERSION_WORD_SHIFT);
	registers.set(address + 1, Math.floor(scaled / VERSION_WORD_SHIFT));
}

/**
 * Reads a 16-bit big-endian value from a frame.
 *
 * @param frame - Source bytes.
 * @param offset - Byte offset of the high byte.
 * @returns The unsigned 16-bit value (missing bytes read as 0).
 */
function readUint16(frame: Uint8Array, offset: number): number {
	return (((frame[offset] ?? 0) << 8) | (frame[offset + 1] ?? 0)) & 0xffff;
}

/**
 * Formats a 48-bit integer as a colon-separated uppercase MAC address.
 *
 * @param value - 48-bit address value.
 * @returns Address in `XX:XX:XX:XX:XX:XX` form.
 */
function formatAddress(value: number): string {
	const compact = value.toString(16).padStart(12, "0").toUpperCase();
	return compact.match(/.{2}/g)?.join(":") ?? compact;
}

/**
 * Normalizes a MAC address to uppercase colon-separated form for map keys.
 *
 * @param address - Address in colon, hyphen, or compact notation.
 * @returns Normalized address string.
 */
function normalizeAddress(address: string): string {
	const compact = address.replace(/[:-]/g, "").toUpperCase();
	return compact.match(/.{2}/g)?.join(":") ?? address.toUpperCase();
}

/**
 * Normalizes a UUID by stripping hyphens and lowercasing.
 *
 * @param uuid - Characteristic UUID in any format.
 * @returns Compact lowercase UUID (no hyphens).
 */
function normalizeUuid(uuid: string): string {
	return uuid.replace(/-/g, "").toLowerCase();
}
