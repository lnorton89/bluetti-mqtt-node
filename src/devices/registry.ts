import { AC200M } from "./ac200m.js";
import { AC300 } from "./ac300.js";
import { AC500 } from "./ac500.js";
import { AC60 } from "./ac60.js";
import type { BluettiDevice } from "./device.js";
import { EB3A } from "./eb3a.js";
import { EP500 } from "./ep500.js";
import { EP500P } from "./ep500p.js";
import { EP600 } from "./ep600.js";

const DEVICE_NAME_PATTERN = /^(AC200M|AC300|AC500|AC60|EB3A|EP500P|EP500|EP600)(\d+)$/;

export function isSupportedBluettiName(name: string): boolean {
  return DEVICE_NAME_PATTERN.test(name);
}

export function createDeviceFromAdvertisement(address: string, name: string): BluettiDevice {
  const match = DEVICE_NAME_PATTERN.exec(name);
  if (match === null) {
    throw new Error(`Unsupported Bluetti device name: ${name}`);
  }

  const model = match[1];
  const serialNumber = match[2];
  if (model === undefined || serialNumber === undefined) {
    throw new Error(`Failed to parse Bluetti device name: ${name}`);
  }

  switch (model) {
    case "AC200M":
      return new AC200M(address, serialNumber);
    case "AC300":
      return new AC300(address, serialNumber);
    case "AC500":
      return new AC500(address, serialNumber);
    case "AC60":
      return new AC60(address, serialNumber);
    case "EB3A":
      return new EB3A(address, serialNumber);
    case "EP500":
      return new EP500(address, serialNumber);
    case "EP500P":
      return new EP500P(address, serialNumber);
    case "EP600":
      return new EP600(address, serialNumber);
    default:
      throw new Error(`No device factory implemented for ${model}`);
  }
}
