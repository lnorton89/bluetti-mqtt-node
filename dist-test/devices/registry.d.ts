import type { BluettiDevice } from "./device.js";
/**
 * Returns whether an advertisement name matches a supported device family.
 *
 * @param name - Advertised BLE device name (e.g. `"AC500-2237000003358"`).
 * @returns `true` when the name matches the `MODEL` + `serialNumber` pattern
 *   for a known Bluetti model.
 *
 * @see createDeviceFromAdvertisement
 */
export declare function isSupportedBluettiName(name: string): boolean;
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
export declare function createDeviceFromAdvertisement(address: string, name: string): BluettiDevice;
