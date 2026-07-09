import { BLUETTI_DEFINITION_MAP, BluettiDeviceModel } from "./definition.js";
import type { BluettiDevice } from "./device.js";

/** Regex matching `MODEL<serialNumber>` advertisement names for supported devices. */
const DEVICE_NAME_PATTERN =
	/^(AC200M|AC300|AC500|AC60|EB3A|EP500P|EP500|EP600)(\d+)$/;

/**
 * Returns whether an advertisement name matches a supported device family.
 *
 * @param name - Advertised BLE device name (e.g. `"AC500-2237000003358"`).
 * @returns `true` when the name matches the `MODEL` + `serialNumber` pattern
 *   for a known Bluetti model.
 *
 * @see createDeviceFromAdvertisement
 */
export function isSupportedBluettiName(name: string): boolean {
	return DEVICE_NAME_PATTERN.test(name);
}

/**
 * Creates the device model encoded by a Bluetti advertisement name.
 *
 * @param address - Bluetooth MAC address of the physical device.
 * @param name - Advertised device name (e.g. `"AC500-2237000003358"`).
 * @returns A typed {@link BluettiDevice} subclass for the matched model.
 * @throws {Error} When the name is malformed or belongs to an unsupported model.
 *
 * @example
 * ```ts
 * const device = createDeviceFromAdvertisement("24:4C:AB:2C:24:8E", "AC500-2237000003358");
 * // returns new BluettiDeviceModel("24:4C:AB:2C:24:8E", "2237000003358", ac500Def)
 * ```
 *
 * @remarks
 * The advertisement name is parsed as `MODEL + serialNumber` (no separator).
 * The serial number is passed as a string to preserve leading zeros and large
 * values. Device definitions are looked up from {@link BLUETTI_DEFINITION_MAP}
 * so new models require only a definition entry — no switch statement.
 */
export function createDeviceFromAdvertisement(
	address: string,
	name: string,
): BluettiDevice {
	const match = DEVICE_NAME_PATTERN.exec(name);
	if (match === null) {
		throw new Error(`Unsupported Bluetti device name: ${name}`);
	}

	const model = match[1];
	const serialNumber = match[2];
	if (model === undefined || serialNumber === undefined) {
		throw new Error(`Failed to parse Bluetti device name: ${name}`);
	}

	const def = BLUETTI_DEFINITION_MAP.get(model);
	if (def === undefined) {
		throw new Error(`No device factory implemented for ${model}`);
	}

	return new BluettiDeviceModel(address, serialNumber, def);
}
