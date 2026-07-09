import { BoolField, DecimalArrayField, DecimalField, EnumField, SerialNumberField, StringField, SwapStringField, UintField, VersionField, } from "./field.js";
/**
 * Declarative collection of register-backed telemetry fields.
 */
export class DeviceStruct {
    fields = [];
    addMany(fields) {
        for (const field of fields) {
            this.fields.push(field);
        }
        return this;
    }
    addUintField(name, address, range) {
        this.fields.push(new UintField(name, address, range));
        return this;
    }
    addBoolField(name, address) {
        this.fields.push(new BoolField(name, address));
        return this;
    }
    addEnumField(name, address, enumDefinition) {
        this.fields.push(new EnumField(name, address, enumDefinition));
        return this;
    }
    addDecimalField(name, address, scale, range) {
        this.fields.push(new DecimalField(name, address, scale, range));
        return this;
    }
    addDecimalArrayField(name, address, size, scale) {
        this.fields.push(new DecimalArrayField(name, address, size, scale));
        return this;
    }
    addStringField(name, address, size) {
        this.fields.push(new StringField(name, address, size));
        return this;
    }
    addSwapStringField(name, address, size) {
        this.fields.push(new SwapStringField(name, address, size));
        return this;
    }
    addVersionField(name, address) {
        this.fields.push(new VersionField(name, address));
        return this;
    }
    addSerialNumberField(name, address) {
        this.fields.push(new SerialNumberField(name, address));
        return this;
    }
    parse(startingAddress, data) {
        if (data.length % 2 !== 0) {
            throw new RangeError(`Register data length must be even, got ${data.length}`);
        }
        const registerCount = data.length / 2;
        const registerRangeStart = startingAddress;
        const registerRangeEndExclusive = startingAddress + registerCount;
        const parsed = {};
        for (const field of this.fields) {
            const fieldEndExclusive = field.address + field.size;
            if (field.address < registerRangeStart || fieldEndExclusive > registerRangeEndExclusive) {
                continue;
            }
            const byteStart = (field.address - startingAddress) * 2;
            const byteEnd = byteStart + field.size * 2;
            const value = field.parse(data.slice(byteStart, byteEnd));
            if (field.isInRange(value)) {
                parsed[field.name] = value;
            }
        }
        return parsed;
    }
}
