/**
 * Resolves a raw enum value while preserving unknown values for diagnostics.
 */
export function enumValue(enumDefinition, rawValue) {
    for (const [name, value] of Object.entries(enumDefinition)) {
        if (value === rawValue) {
            return { name, value };
        }
    }
    return { name: `UNKNOWN_${rawValue}`, value: rawValue };
}
function readUint16BigEndian(data, offset) {
    const high = data[offset];
    const low = data[offset + 1];
    if (high === undefined || low === undefined) {
        throw new RangeError(`Missing uint16 bytes at offset ${offset}`);
    }
    return (high << 8) | low;
}
function readAscii(data) {
    const terminatorIndex = data.indexOf(0);
    const slice = terminatorIndex >= 0 ? data.subarray(0, terminatorIndex) : data;
    return Buffer.from(slice).toString("ascii");
}
function swapBytePairs(data) {
    const swapped = data.slice();
    for (let index = 0; index < swapped.length - 1; index += 2) {
        const current = swapped[index];
        const next = swapped[index + 1];
        if (current === undefined || next === undefined) {
            throw new RangeError(`Missing byte while swapping at offset ${index}`);
        }
        swapped[index] = next;
        swapped[index + 1] = current;
    }
    return swapped;
}
/**
 * Base metadata and decoder contract for one logical telemetry field.
 */
export class DeviceField {
    name;
    address;
    size;
    constructor(name, address, size) {
        this.name = name;
        this.address = address;
        this.size = size;
    }
    isInRange(_value) {
        return true;
    }
}
/**
 * Unsigned 16-bit register field.
 */
export class UintField extends DeviceField {
    range;
    constructor(name, address, range) {
        super(name, address, 1);
        this.range = range;
    }
    parse(data) {
        return readUint16BigEndian(data, 0);
    }
    isInRange(value) {
        return this.range === undefined || (value >= this.range[0] && value <= this.range[1]);
    }
}
/**
 * Boolean field encoded as zero or one in a 16-bit register.
 */
export class BoolField extends DeviceField {
    constructor(name, address) {
        super(name, address, 1);
    }
    parse(data) {
        return readUint16BigEndian(data, 0) === 1;
    }
}
/**
 * Named enum field backed by a 16-bit register.
 */
export class EnumField extends DeviceField {
    enumDefinition;
    constructor(name, address, enumDefinition) {
        super(name, address, 1);
        this.enumDefinition = enumDefinition;
    }
    parse(data) {
        return enumValue(this.enumDefinition, readUint16BigEndian(data, 0));
    }
}
/**
 * Fixed-point decimal stored in one 16-bit register.
 */
export class DecimalField extends DeviceField {
    scale;
    range;
    constructor(name, address, scale, range) {
        super(name, address, 1);
        this.scale = scale;
        this.range = range;
    }
    parse(data) {
        return readUint16BigEndian(data, 0) / 10 ** this.scale;
    }
    isInRange(value) {
        return this.range === undefined || (value >= this.range[0] && value <= this.range[1]);
    }
}
/**
 * Fixed-point decimal array spanning consecutive registers.
 */
export class DecimalArrayField extends DeviceField {
    scale;
    constructor(name, address, size, scale) {
        super(name, address, size);
        this.scale = scale;
    }
    parse(data) {
        const values = [];
        for (let index = 0; index < this.size; index += 1) {
            values.push(readUint16BigEndian(data, index * 2) / 10 ** this.scale);
        }
        return values;
    }
}
/**
 * Null-terminated ASCII string stored in register byte order.
 */
export class StringField extends DeviceField {
    constructor(name, address, size) {
        super(name, address, size);
    }
    parse(data) {
        return readAscii(data);
    }
}
/**
 * ASCII string whose bytes are swapped within each register pair.
 */
export class SwapStringField extends DeviceField {
    constructor(name, address, size) {
        super(name, address, size);
    }
    parse(data) {
        return readAscii(swapBytePairs(data));
    }
}
/**
 * Two-register firmware version scaled by one hundred.
 */
export class VersionField extends DeviceField {
    constructor(name, address) {
        super(name, address, 2);
    }
    parse(data) {
        const low = readUint16BigEndian(data, 0);
        const high = readUint16BigEndian(data, 2);
        return (low + high * 0x1_0000) / 100;
    }
}
/**
 * Four-register unsigned serial number decoded without precision loss.
 */
export class SerialNumberField extends DeviceField {
    constructor(name, address) {
        super(name, address, 4);
    }
    parse(data) {
        const word0 = BigInt(readUint16BigEndian(data, 0));
        const word1 = BigInt(readUint16BigEndian(data, 2));
        const word2 = BigInt(readUint16BigEndian(data, 4));
        const word3 = BigInt(readUint16BigEndian(data, 6));
        return word0 + (word1 << 16n) + (word2 << 32n) + (word3 << 48n);
    }
}
