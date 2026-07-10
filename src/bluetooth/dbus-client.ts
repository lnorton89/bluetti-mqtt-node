import { createConnection, type Socket } from "node:net";

/**
 * Minimal D-Bus wire protocol client for talking to BlueZ over the system bus.
 *
 * @remarks
 * Implements only the subset of the D-Bus specification needed for BLE GATT
 * operations: method calls, method replies, and signal subscriptions. All
 * encoding and decoding is hand-rolled to avoid external dependencies.
 *
 * @see https://dbus.freedesktop.org/doc/dbus-specification.html
 */

// ── D-Bus type codes (ASCII values of type signature characters) ─────────────

const TYPE_BYTE = 0x79; // 'y'
const TYPE_BOOLEAN = 0x62; // 'b'
const TYPE_INT16 = 0x6e; // 'n'
const TYPE_UINT16 = 0x71; // 'q'
const TYPE_INT32 = 0x69; // 'i'
const TYPE_UINT32 = 0x75; // 'u'
const TYPE_INT64 = 0x78; // 'x'
const TYPE_UINT64 = 0x74; // 't'
const TYPE_DOUBLE = 0x64; // 'd'
const TYPE_STRING = 0x73; // 's'
const TYPE_OBJECT_PATH = 0x6f; // 'o'
const TYPE_SIGNATURE = 0x67; // 'g'
const TYPE_ARRAY = 0x61; // 'a'
const TYPE_VARIANT = 0x76; // 'v'
const TYPE_STRUCT_OPEN = 0x28; // '('
const TYPE_STRUCT_CLOSE = 0x29; // ')'
const TYPE_DICT_OPEN = 0x7b; // '{'
const TYPE_DICT_CLOSE = 0x7d; // '}'

// ── D-Bus message constants ──────────────────────────────────────────────────

const MESSAGE_METHOD_CALL = 1;
const MESSAGE_METHOD_RETURN = 2;
const MESSAGE_ERROR = 3;
const MESSAGE_SIGNAL = 4;

const HEADER_PATH = 1;
const HEADER_INTERFACE = 2;
const HEADER_MEMBER = 3;
const HEADER_DESTINATION = 4;
const HEADER_SENDER = 5;
const HEADER_SIGNATURE = 6;

const SYSTEM_BUS = "/var/run/dbus/system_bus_socket";
const PROTOCOL_VERSION = 1;

// ── D-Bus value types ────────────────────────────────────────────────────────

/** A D-Bus variant carrying its signature alongside the value. */
export interface DbusVariant {
	readonly signature: string;
	readonly value: DbusValue;
}

/** A dictionary entry used in `a{kv}` D-Bus types. */
export interface DbusDictEntry<K extends string, V> {
	readonly key: K;
	readonly value: V;
}

/**
 * Union of all concrete D-Bus wire types returned by the unmarshaler.
 *
 * @remarks
 * Maps directly to D-Bus type signatures:
 * - `number` ← byte, int16, uint16, int32, uint32, double
 * - `bigint` ← int64, uint64
 * - `boolean` ← boolean
 * - `string` ← string, object path, signature
 * - `Uint8Array` ← byte array
 * - `DbusVariant[]` ← variant array
 * - `DbusVariant` ← variant
 * - `ReadonlyMap<string, DbusVariant>` ← string→variant dict (a{sv})
 * - `DbusDictEntry<string, DbusValue>[]` ← generic dict arrays
 */
export type DbusValue =
	| number
	| bigint
	| boolean
	| string
	| Uint8Array
	| readonly string[]
	| DbusVariant[]
	| DbusVariant
	| ReadonlyMap<string, DbusVariant>
	| DbusDictEntry<string, DbusValue>[];

/** A `a{sv}` — dict from string keys to variant values. */
export type StringVariantDict = ReadonlyMap<string, DbusVariant>;

/** A `a{oa{sa{sv}}}` — the GetManagedObjects reply type. */
export type ManagedObjects = ReadonlyMap<
	string,
	ReadonlyMap<string, StringVariantDict>
>;

// ── Alignment helpers ────────────────────────────────────────────────────────

function alignmentForType(typeCode: number): number {
	switch (typeCode) {
		case TYPE_BYTE:
		case TYPE_SIGNATURE:
		case TYPE_VARIANT:
			return 1;
		case TYPE_INT16:
		case TYPE_UINT16:
			return 2;
		case TYPE_BOOLEAN:
		case TYPE_INT32:
		case TYPE_UINT32:
		case TYPE_DOUBLE:
		case TYPE_STRING:
		case TYPE_OBJECT_PATH:
		case TYPE_ARRAY:
			return 4;
		case TYPE_INT64:
		case TYPE_UINT64:
			return 8;
		case TYPE_STRUCT_OPEN:
			return 8;
		case TYPE_DICT_OPEN:
			return 8;
		default:
			return 1;
	}
}

function padTo(offset: number, alignment: number): number {
	const remainder = offset % alignment;
	return remainder === 0 ? 0 : alignment - remainder;
}

// ── Marshal (encode) ─────────────────────────────────────────────────────────

function writeByte(value: number, buf: Buffer, offset: number): number {
	buf.writeUInt8(value, offset);
	return offset + 1;
}

function writeBoolean(value: boolean, buf: Buffer, offset: number): number {
	const padded = offset + padTo(offset, 4);
	buf.writeUInt32LE(value ? 1 : 0, padded);
	return padded + 4;
}

function writeUint16(value: number, buf: Buffer, offset: number): number {
	const padded = offset + padTo(offset, 2);
	buf.writeUInt16LE(value, padded);
	return padded + 2;
}

function writeUint32(value: number, buf: Buffer, offset: number): number {
	const padded = offset + padTo(offset, 4);
	buf.writeUInt32LE(value, padded);
	return padded + 4;
}

function writeBigUint64(value: bigint, buf: Buffer, offset: number): number {
	const padded = offset + padTo(offset, 8);
	buf.writeBigUInt64LE(value, padded);
	return padded + 8;
}

function writeString(value: string, buf: Buffer, offset: number): number {
	const padded = offset + padTo(offset, 4);
	const bytes = Buffer.from(value, "utf-8");
	let pos = writeUint32(bytes.length, buf, padded);
	bytes.copy(buf, pos);
	pos += bytes.length;
	buf.writeUInt8(0, pos);
	return pos + 1;
}

function writeObjectPath(value: string, buf: Buffer, offset: number): number {
	return writeString(value, buf, offset);
}

function writeSignature(value: string, buf: Buffer, offset: number): number {
	buf.writeUInt8(value.length, offset);
	let pos = offset + 1;
	for (const ch of value) {
		buf.writeUInt8(ch.charCodeAt(0), pos);
		pos += 1;
	}
	buf.writeUInt8(0, pos);
	return pos + 1;
}

function writeByteArray(
	value: Uint8Array,
	buf: Buffer,
	offset: number,
): number {
	const padded = offset + padTo(offset, 4);
	let pos = writeUint32(value.length, buf, padded);
	for (const byte of value) {
		pos = writeByte(byte, buf, pos);
	}
	return pos;
}

function writeVariant(
	variant: DbusVariant,
	buf: Buffer,
	offset: number,
): number {
	let pos = writeSignature(variant.signature, buf, offset);
	pos = writeDbusValue(variant.value, variant.signature, buf, pos);
	return pos;
}

function writeStringVariantDict(
	dict: StringVariantDict,
	buf: Buffer,
	offset: number,
): number {
	const padded = offset + padTo(offset, 4);
	const lengthPos = padded;
	let pos = padded + 4;
	const entryAlign = 8;

	for (const [key, variant] of dict) {
		pos += padTo(pos, entryAlign);
		pos = writeString(key, buf, pos);
		pos = writeVariant(variant, buf, pos);
	}

	const arrayLen = pos - (lengthPos + 4);
	writeUint32(arrayLen, buf, lengthPos);
	return pos;
}

/**
 * Marshals a D-Bus value of the given signature into the buffer.
 *
 * @param value - The value to marshal. Must match `signature`.
 * @param signature - D-Bus type signature string.
 * @param buf - Target buffer.
 * @param offset - Starting byte offset.
 * @returns The new offset after writing.
 */
function writeDbusValue(
	value: DbusValue,
	signature: string,
	buf: Buffer,
	offset: number,
): number {
	if (signature.length === 0) {
		return offset;
	}

	const firstCode = signature.charCodeAt(0);

	switch (firstCode) {
		case TYPE_BYTE: {
			if (typeof value !== "number") {
				throw typeMismatch("byte (y)", value);
			}
			return writeByte(value, buf, offset);
		}
		case TYPE_BOOLEAN: {
			if (typeof value !== "boolean") {
				throw typeMismatch("boolean (b)", value);
			}
			return writeBoolean(value, buf, offset);
		}
		case TYPE_UINT16: {
			if (typeof value !== "number") {
				throw typeMismatch("uint16 (q)", value);
			}
			return writeUint16(value, buf, offset);
		}
		case TYPE_UINT32: {
			if (typeof value !== "number") {
				throw typeMismatch("uint32 (u)", value);
			}
			return writeUint32(value, buf, offset);
		}
		case TYPE_UINT64: {
			if (typeof value !== "bigint") {
				throw typeMismatch("uint64 (t)", value);
			}
			return writeBigUint64(value, buf, offset);
		}
		case TYPE_STRING: {
			if (typeof value !== "string") {
				throw typeMismatch("string (s)", value);
			}
			return writeString(value, buf, offset);
		}
		case TYPE_OBJECT_PATH: {
			if (typeof value !== "string") {
				throw typeMismatch("object path (o)", value);
			}
			return writeObjectPath(value, buf, offset);
		}
		case TYPE_VARIANT: {
			if (!isDbusVariant(value)) {
				throw typeMismatch("variant (v)", value);
			}
			return writeVariant(value, buf, offset);
		}
		case TYPE_ARRAY: {
			if (signature.length < 2) {
				throw new Error("D-Bus array signature missing element type");
			}
			return writeArrayValue(value, signature.slice(1), buf, offset);
		}
		default:
			throw new Error(
				`Unsupported D-Bus marshal type: 0x${firstCode.toString(16)}`,
			);
	}
}

function writeArrayValue(
	value: DbusValue,
	elementSig: string,
	buf: Buffer,
	offset: number,
): number {
	const elementCode = elementSig.charCodeAt(0);

	if (elementCode === TYPE_BYTE && value instanceof Uint8Array) {
		return writeByteArray(value, buf, offset);
	}

	if (elementCode === TYPE_DICT_OPEN) {
		if (!(value instanceof Map)) {
			throw typeMismatch("dict array (a{...})", value);
		}
		return writeStringVariantDict(value as StringVariantDict, buf, offset);
	}

	if (elementCode === TYPE_VARIANT) {
		if (!Array.isArray(value)) {
			throw typeMismatch("variant array (av)", value);
		}
		const padded = offset + padTo(offset, 4);
		const lengthPos = padded;
		let pos = padded + 4;

		for (const item of value) {
			if (!isDbusVariant(item)) {
				throw typeMismatch("variant (v)", item);
			}
			pos = writeVariant(item, buf, pos);
		}

		const arrayLen = pos - (lengthPos + 4);
		writeUint32(arrayLen, buf, lengthPos);
		return pos;
	}

	throw new Error(
		`Unsupported D-Bus array element: 0x${elementCode.toString(16)}`,
	);
}

function typeMismatch(expected: string, value: unknown): Error {
	return new Error(
		`D-Bus type mismatch: expected ${expected}, got ${typeof value}`,
	);
}

function isDbusVariant(value: unknown): value is DbusVariant {
	return (
		typeof value === "object" &&
		value !== null &&
		"signature" in value &&
		"value" in value
	);
}

// ── Unmarshal (decode) ───────────────────────────────────────────────────────

interface ReadResult<T> {
	readonly value: T;
	readonly next: number;
}

function readByte(buf: Buffer, offset: number): ReadResult<number> {
	return { value: buf.readUInt8(offset), next: offset + 1 };
}

function readBoolean(buf: Buffer, offset: number): ReadResult<boolean> {
	const padded = offset + padTo(offset, 4);
	const raw = buf.readUInt32LE(padded);
	return { value: raw !== 0, next: padded + 4 };
}

function readUint16(buf: Buffer, offset: number): ReadResult<number> {
	const padded = offset + padTo(offset, 2);
	return { value: buf.readUInt16LE(padded), next: padded + 2 };
}

function readUint32(buf: Buffer, offset: number): ReadResult<number> {
	const padded = offset + padTo(offset, 4);
	return { value: buf.readUInt32LE(padded), next: padded + 4 };
}

function readBigUint64(buf: Buffer, offset: number): ReadResult<bigint> {
	const padded = offset + padTo(offset, 8);
	return { value: buf.readBigUInt64LE(padded), next: padded + 8 };
}

function readString(buf: Buffer, offset: number): ReadResult<string> {
	const padded = offset + padTo(offset, 4);
	const len = buf.readUInt32LE(padded);
	const start = padded + 4;
	const value = buf.toString("utf-8", start, start + len);
	const next = start + len + 1; // skip null terminator
	if (buf.readUInt8(next - 1) !== 0) {
		throw new Error("D-Bus string missing null terminator");
	}
	return { value, next };
}

function readSignature(buf: Buffer, offset: number): ReadResult<string> {
	const len = buf.readUInt8(offset);
	const start = offset + 1;
	const value = buf.toString("utf-8", start, start + len);
	const next = start + len + 1;
	if (buf.readUInt8(next - 1) !== 0) {
		throw new Error("D-Bus signature missing null terminator");
	}
	return { value, next };
}

function readVariant(buf: Buffer, offset: number): ReadResult<DbusVariant> {
	const sig = readSignature(buf, offset);
	if (sig.value.length === 0) {
		throw new Error("D-Bus variant has empty signature");
	}
	const decoded = readDbusValue(buf, sig.next, sig.value);
	return {
		value: { signature: sig.value, value: decoded.value },
		next: decoded.next,
	};
}

function readByteArray(buf: Buffer, offset: number): ReadResult<Uint8Array> {
	const padded = offset + padTo(offset, 4);
	const len = buf.readUInt32LE(padded);
	const start = padded + 4;
	if (start + len > buf.length) {
		throw new Error("D-Bus byte array extends beyond message");
	}
	return {
		value: new Uint8Array(buf.subarray(start, start + len)),
		next: start + len,
	};
}

function readStringVariantDict(
	buf: Buffer,
	offset: number,
): ReadResult<StringVariantDict> {
	const padded = offset + padTo(offset, 4);
	const arrayLen = buf.readUInt32LE(padded);
	let pos = padded + 4;
	const end = pos + arrayLen;
	const result = new Map<string, DbusVariant>();

	while (pos < end) {
		pos += padTo(pos, 8);
		const key = readString(buf, pos);
		pos = key.next;
		const val = readVariant(buf, pos);
		pos = val.next;
		result.set(key.value, val.value);
	}

	return { value: result, next: end };
}

function readVariantArray(
	buf: Buffer,
	offset: number,
): ReadResult<DbusVariant[]> {
	const padded = offset + padTo(offset, 4);
	const arrayLen = buf.readUInt32LE(padded);
	let pos = padded + 4;
	const end = pos + arrayLen;
	const result: DbusVariant[] = [];

	while (pos < end) {
		const val = readVariant(buf, pos);
		pos = val.next;
		result.push(val.value);
	}

	return { value: result, next: end };
}

function readStringArray(buf: Buffer, offset: number): ReadResult<string[]> {
	const padded = offset + padTo(offset, 4);
	const arrayLen = buf.readUInt32LE(padded);
	let pos = padded + 4;
	const end = pos + arrayLen;
	const result: string[] = [];

	while (pos < end) {
		pos += padTo(pos, 4);
		const val = readString(buf, pos);
		pos = val.next;
		result.push(val.value);
	}

	return { value: result, next: end };
}

/**
 * Reads a D-Bus value of the given signature from the buffer.
 *
 * @param buf - Source buffer.
 * @param offset - Starting byte offset.
 * @param signature - D-Bus type signature string.
 * @returns The decoded value and the next unread offset.
 */
function readDbusValue(
	buf: Buffer,
	offset: number,
	signature: string,
): ReadResult<DbusValue> {
	if (signature.length === 0) {
		return { value: "", next: offset };
	}

	const firstCode = signature.charCodeAt(0);

	switch (firstCode) {
		case TYPE_BYTE:
			return readByte(buf, offset);
		case TYPE_BOOLEAN:
			return readBoolean(buf, offset);
		case TYPE_UINT16:
			return readUint16(buf, offset);
		case TYPE_UINT32:
			return readUint32(buf, offset);
		case TYPE_UINT64:
			return readBigUint64(buf, offset);
		case TYPE_STRING:
		case TYPE_OBJECT_PATH:
			return readString(buf, offset);
		case TYPE_VARIANT:
			return readVariant(buf, offset);
		case TYPE_ARRAY: {
			const elementSig = signature.slice(1);
			const elementCode = elementSig.charCodeAt(0);

			if (elementCode === TYPE_BYTE) {
				return readByteArray(buf, offset);
			}
			if (elementCode === TYPE_DICT_OPEN) {
				return readStringVariantDict(buf, offset);
			}
			if (elementCode === TYPE_VARIANT) {
				return readVariantArray(buf, offset);
			}
			if (elementCode === TYPE_STRING) {
				return readStringArray(buf, offset);
			}
			throw new Error(
				`Unsupported D-Bus array element: 0x${elementCode.toString(16)}`,
			);
		}
		default:
			throw new Error(
				`Unsupported D-Bus unmarshal type: 0x${firstCode.toString(16)}`,
			);
	}
}

// ── D-Bus message frame ──────────────────────────────────────────────────────

/** Header field encoding for the wire. */
interface HeaderFieldEntry {
	readonly code: number;
	readonly signature: string;
	readonly marshal: (buf: Buffer, offset: number) => number;
}

/** A decoded D-Bus message. */
export interface DbusMessage {
	readonly type: number;
	readonly serial: number;
	readonly replySerial: number | undefined;
	readonly path: string | undefined;
	readonly iface: string | undefined;
	readonly member: string | undefined;
	readonly errorName: string | undefined;
	readonly destination: string | undefined;
	readonly sender: string | undefined;
	readonly signature: string;
	readonly body: readonly DbusValue[];
}

/** Input for marshaling a method call message. */
export interface DbusCallOptions {
	readonly destination: string;
	readonly path: string;
	readonly iface: string;
	readonly member: string;
	readonly signature?: string;
	readonly body?: readonly DbusValue[];
}

function marshalMessage(
	type: number,
	serial: number,
	signature: string,
	body: readonly DbusValue[],
	fields: readonly HeaderFieldEntry[],
): Buffer {
	const buf = Buffer.alloc(4096);
	let pos = 0;

	buf.writeUInt8(0x6c, pos); // little-endian
	pos += 1;
	buf.writeUInt8(type, pos);
	pos += 1;
	buf.writeUInt8(0, pos); // flags (no reply expected for signals, etc.)
	pos += 1;
	buf.writeUInt8(PROTOCOL_VERSION, pos);
	pos += 1;

	const bodyLenPos = pos;
	pos += 4; // body length placeholder
	buf.writeUInt32LE(serial, pos);
	pos += 4;

	// Header fields array
	const headerArrayLenPos = pos;
	pos += 4; // array length placeholder

	for (const field of fields) {
		pos += padTo(pos, 8); // struct alignment
		pos = writeByte(field.code, buf, pos);
		pos = writeSignature(field.signature, buf, pos);
		pos = field.marshal(buf, pos);
	}

	const headerArrayLen = pos - (headerArrayLenPos + 4);
	buf.writeUInt32LE(headerArrayLen, headerArrayLenPos);

	const bodyStart = (pos + 7) & ~7;
	let bodyPos = bodyStart;

	for (const value of body) {
		bodyPos = writeDbusValue(value, signature, buf, bodyPos);
	}

	const bodyLen = bodyPos - bodyStart;
	buf.writeUInt32LE(bodyLen, bodyLenPos);

	return buf.subarray(0, bodyPos);
}

function buildMethodCall(serial: number, opts: DbusCallOptions): Buffer {
	const signature = opts.signature ?? "";
	const body = opts.body ?? [];

	const fields: HeaderFieldEntry[] = [
		{
			code: HEADER_PATH,
			signature: "o",
			marshal: (b, o) => writeObjectPath(opts.path, b, o),
		},
		{
			code: HEADER_INTERFACE,
			signature: "s",
			marshal: (b, o) => writeString(opts.iface, b, o),
		},
		{
			code: HEADER_MEMBER,
			signature: "s",
			marshal: (b, o) => writeString(opts.member, b, o),
		},
		{
			code: HEADER_DESTINATION,
			signature: "s",
			marshal: (b, o) => writeString(opts.destination, b, o),
		},
	];

	if (signature !== "") {
		fields.push({
			code: HEADER_SIGNATURE,
			signature: "g",
			marshal: (b, o) => writeSignature(signature, b, o),
		});
	}

	return marshalMessage(MESSAGE_METHOD_CALL, serial, signature, body, fields);
}

function unmarshalMessage(buf: Buffer): DbusMessage {
	if (buf.length < 16) {
		throw new Error("D-Bus message too short");
	}

	const endianness = buf.readUInt8(0);
	if (endianness !== 0x6c) {
		throw new Error(
			`Unsupported D-Bus endianness: 0x${endianness.toString(16)}`,
		);
	}

	const msgType = buf.readUInt8(1);
	const protoVersion = buf.readUInt8(3);
	if (protoVersion !== PROTOCOL_VERSION) {
		throw new Error(`Unsupported D-Bus protocol version: ${protoVersion}`);
	}

	const bodyLen = buf.readUInt32LE(4);
	const serial = buf.readUInt32LE(8);
	const headerArrayLen = buf.readUInt32LE(12);

	let pos = 12 + 4; // fixed header + array length field

	const headerEnd = 12 + 4 + headerArrayLen;
	const bodyStartPos = (headerEnd + 7) & ~7;

	let path: string | undefined;
	let iface: string | undefined;
	let member: string | undefined;
	let destination: string | undefined;
	let sender: string | undefined;
	let signature = "";

	while (pos < headerEnd) {
		pos += padTo(pos, 8);
		const fieldCode = buf.readUInt8(pos);
		pos += 1;
		const sig = readSignature(buf, pos);
		pos = sig.next;
		const fieldAlign = alignmentForType(sig.value.charCodeAt(0));
		pos += padTo(pos, fieldAlign);
		const decoded = readDbusValue(buf, pos, sig.value);
		pos = decoded.next;

		switch (fieldCode) {
			case HEADER_PATH:
				path = decoded.value as string;
				break;
			case HEADER_INTERFACE:
				iface = decoded.value as string;
				break;
			case HEADER_MEMBER:
				member = decoded.value as string;
				break;
			case HEADER_DESTINATION:
				destination = decoded.value as string;
				break;
			case HEADER_SENDER:
				sender = decoded.value as string;
				break;
			case HEADER_SIGNATURE:
				signature = decoded.value as string;
				break;
		}
	}

	const body: DbusValue[] = [];
	if (signature !== "" && bodyStartPos + bodyLen <= buf.length) {
		let bodyPos = bodyStartPos;
		const bodyEnd = bodyStartPos + bodyLen;
		let sigIndex = 0;
		while (sigIndex < signature.length && bodyPos < bodyEnd) {
			const remaining = signature.slice(sigIndex);
			const decoded = readDbusValue(buf, bodyPos, remaining);
			bodyPos = decoded.next;
			body.push(decoded.value);
			sigIndex += elementSignatureLength(remaining);
		}
	}

	return {
		type: msgType,
		serial,
		replySerial: undefined,
		path,
		iface,
		member,
		errorName: undefined,
		destination,
		sender,
		signature,
		body,
	};
}

/**
 * Returns the number of characters consumed by one complete type in a signature.
 */
function elementSignatureLength(signature: string): number {
	const firstCode = signature.charCodeAt(0);

	switch (firstCode) {
		case TYPE_BYTE:
		case TYPE_BOOLEAN:
		case TYPE_INT16:
		case TYPE_UINT16:
		case TYPE_INT32:
		case TYPE_UINT32:
		case TYPE_INT64:
		case TYPE_UINT64:
		case TYPE_DOUBLE:
		case TYPE_STRING:
		case TYPE_OBJECT_PATH:
		case TYPE_SIGNATURE:
		case TYPE_VARIANT:
			return 1;
		case TYPE_ARRAY:
			return 1 + elementSignatureLength(signature.slice(1));
		case TYPE_STRUCT_OPEN:
			return structLength(signature);
		case TYPE_DICT_OPEN:
			return dictLength(signature);
		default:
			return 1;
	}
}

function structLength(signature: string): number {
	if (signature.charCodeAt(0) !== TYPE_STRUCT_OPEN) {
		return 0;
	}
	let depth = 1;
	let pos = 1;
	while (pos < signature.length && depth > 0) {
		const code = signature.charCodeAt(pos);
		if (code === TYPE_STRUCT_OPEN) {
			depth += 1;
		} else if (code === TYPE_STRUCT_CLOSE) {
			depth -= 1;
		}
		pos += 1;
	}
	return pos;
}

function dictLength(signature: string): number {
	if (signature.charCodeAt(0) !== TYPE_DICT_OPEN) {
		return 0;
	}
	let depth = 1;
	let pos = 1;
	while (pos < signature.length && depth > 0) {
		const code = signature.charCodeAt(pos);
		if (code === TYPE_DICT_OPEN) {
			depth += 1;
		} else if (code === TYPE_DICT_CLOSE) {
			depth -= 1;
		}
		pos += 1;
	}
	return pos;
}

// ── D-Bus client ─────────────────────────────────────────────────────────────

interface PendingCall {
	readonly resolve: (value: DbusMessage) => void;
	readonly reject: (reason: Error) => void;
	readonly timeout: ReturnType<typeof setTimeout>;
}

type SignalListener = (msg: DbusMessage) => void;

/**
 * Minimal D-Bus client for communicating with BlueZ over the system bus.
 *
 * @remarks
 * Handles connection, authentication, message serialization, method call
 * correlation, and signal dispatch. Only the subset of D-Bus needed for BLE
 * GATT operations is implemented.
 *
 * @example
 * ```ts
 * const dbus = new DbusClient();
 * await dbus.connect();
 * const reply = await dbus.call({
 *   destination: "org.bluez",
 *   path: "/org/bluez/hci0",
 *   iface: "org.bluez.Adapter1",
 *   member: "StartDiscovery",
 * });
 * dbus.close();
 * ```
 */
export class DbusClient {
	private socket: Socket | null = null;
	private buffer = Buffer.alloc(0);
	private readonly pending = new Map<number, PendingCall>();
	private readonly signalListeners = new Map<string, Set<SignalListener>>();
	private nextSerial = 1;
	private readonly timeoutMs: number;

	constructor(timeoutMs = 10_000) {
		this.timeoutMs = timeoutMs;
	}

	/**
	 * Connects to the system bus and performs SASL authentication.
	 *
	 * @throws {Error} When the socket connection or authentication fails.
	 */
	connect(): Promise<void> {
		return new Promise<void>((resolve, reject) => {
			const socket = createConnection({ path: SYSTEM_BUS });
			this.socket = socket;

			let authenticated = false;

			socket.on("connect", () => {
				socket.write("AUTH EXTERNAL 30303030\n");
			});

			socket.on("data", (data: Buffer) => {
				if (!authenticated) {
					const text = data.toString("utf-8");
					if (text.includes("OK")) {
						authenticated = true;
						socket.write("BEGIN\n");
						resolve();
					} else if (text.includes("REJECTED")) {
						reject(new Error("D-Bus authentication rejected"));
						socket.destroy();
					}
					return;
				}

				this.buffer = Buffer.concat([this.buffer, data]);
				this.processBuffer();
			});

			socket.on("error", (error) => {
				if (!authenticated) {
					reject(error);
				}
			});

			socket.on("close", () => {
				this.rejectAllPending(new Error("D-Bus connection closed"));
			});
		});
	}

	/**
	 * Sends a D-Bus method call and waits for its reply.
	 *
	 * @param opts - Call options (destination, path, iface, member, signature, body).
	 * @returns The method reply message.
	 * @throws {Error} When the call times out or the remote returns an error.
	 */
	async call(opts: DbusCallOptions): Promise<DbusMessage> {
		const serial = this.nextSerial++;
		const frame = buildMethodCall(serial, opts);

		return new Promise<DbusMessage>((resolve, reject) => {
			const timeout = setTimeout(() => {
				this.pending.delete(serial);
				reject(
					new Error(
						`D-Bus call ${opts.iface}.${opts.member} timed out after ${this.timeoutMs} ms`,
					),
				);
			}, this.timeoutMs);

			this.pending.set(serial, { resolve, reject, timeout });
			this.write(frame);
		});
	}

	/**
	 * Calls a method and returns the first body value, typed.
	 *
	 * @param opts - Call options.
	 * @returns The first body element, or `undefined` if the body is empty.
	 */
	async callForValue<T extends DbusValue>(
		opts: DbusCallOptions,
	): Promise<T | undefined> {
		const reply = await this.call(opts);
		return reply.body[0] as T | undefined;
	}

	/**
	 * Subscribes to D-Bus signals matching an interface and member name.
	 *
	 * @param iface - Interface name (e.g. `"org.freedesktop.DBus.Properties"`).
	 * @param member - Signal member name (e.g. `"PropertiesChanged"`).
	 * @param listener - Callback invoked for each matching signal.
	 * @returns Unsubscribe function.
	 */
	onSignal(
		iface: string,
		member: string,
		listener: SignalListener,
	): () => void {
		const key = `${iface}.${member}`;
		let listeners = this.signalListeners.get(key);
		if (listeners === undefined) {
			listeners = new Set();
			this.signalListeners.set(key, listeners);
		}
		listeners.add(listener);
		return () => {
			listeners?.delete(listener);
		};
	}

	/**
	 * Closes the D-Bus connection and rejects all pending calls.
	 */
	close(): void {
		if (this.socket !== null) {
			this.socket.destroy();
			this.socket = null;
		}
		this.rejectAllPending(new Error("D-Bus client closed"));
	}

	private write(frame: Buffer): void {
		if (this.socket === null) {
			throw new Error("D-Bus client is not connected");
		}
		this.socket.write(frame);
	}

	private processBuffer(): void {
		while (this.buffer.length >= 16) {
			const bodyLen = this.buffer.readUInt32LE(4);
			const headerArrayLen = this.buffer.readUInt32LE(12);
			const alignedHeader = (12 + 4 + headerArrayLen + 7) & ~7;
			const totalLen = alignedHeader + bodyLen;

			if (this.buffer.length < totalLen) {
				return;
			}

			const frame = this.buffer.subarray(0, totalLen);
			this.buffer = this.buffer.subarray(totalLen);

			try {
				const msg = unmarshalMessage(frame);
				this.routeMessage(msg);
			} catch {
				// Skip malformed messages silently.
			}
		}
	}

	private routeMessage(msg: DbusMessage): void {
		if (msg.type === MESSAGE_METHOD_RETURN || msg.type === MESSAGE_ERROR) {
			const pending = this.pending.get(msg.serial);
			if (pending !== undefined) {
				clearTimeout(pending.timeout);
				this.pending.delete(msg.serial);
				pending.resolve(msg);
			}
			return;
		}

		if (msg.type === MESSAGE_SIGNAL && msg.iface !== undefined) {
			const key = `${msg.iface}.${msg.member}`;
			const listeners = this.signalListeners.get(key);
			if (listeners !== undefined) {
				for (const listener of listeners) {
					listener(msg);
				}
			}
		}
	}

	private rejectAllPending(error: Error): void {
		for (const [, pending] of this.pending) {
			clearTimeout(pending.timeout);
			pending.reject(error);
		}
		this.pending.clear();
	}
}

// ── Type-safe accessors for D-Bus values ─────────────────────────────────────

/** Extracts a string from a `DbusValue`. */
function asString(value: DbusValue | undefined): string {
	if (typeof value === "string") {
		return value;
	}
	throw new Error(`Expected D-Bus string, got ${typeof value}`);
}

/** Extracts a boolean from a `DbusValue`. */
function asBoolean(value: DbusValue | undefined): boolean {
	if (typeof value === "boolean") {
		return value;
	}
	throw new Error(`Expected D-Bus boolean, got ${typeof value}`);
}

/** Extracts a number from a `DbusValue`. */
function asNumber(value: DbusValue | undefined): number {
	if (typeof value === "number") {
		return value;
	}
	throw new Error(`Expected D-Bus number, got ${typeof value}`);
}

/** Extracts a `Uint8Array` from a `DbusValue`. */
function asBytes(value: DbusValue | undefined): Uint8Array {
	if (value instanceof Uint8Array) {
		return value;
	}
	throw new Error(`Expected D-Bus byte array, got ${typeof value}`);
}

/** Extracts a `StringVariantDict` from a `DbusValue`. */
function asDict(value: DbusValue | undefined): StringVariantDict {
	if (value instanceof Map) {
		return value as StringVariantDict;
	}
	throw new Error(`Expected D-Bus dict (a{sv}), got ${typeof value}`);
}

/** Extracts a `ManagedObjects` map from a `DbusValue`. */
function asManagedObjects(value: DbusValue | undefined): ManagedObjects {
	if (value instanceof Map) {
		return value as unknown as ManagedObjects;
	}
	throw new Error("Expected D-Bus managed objects (a{oa{sa{sv}}})");
}

/** Reads a string property from a `StringVariantDict`. */
export function dictGetString(
	dict: StringVariantDict,
	key: string,
): string | undefined {
	const variant = dict.get(key);
	if (variant === undefined) {
		return undefined;
	}
	if (typeof variant.value === "string") {
		return variant.value;
	}
	return undefined;
}

/** Reads a boolean property from a `StringVariantDict`. */
export function dictGetBool(
	dict: StringVariantDict,
	key: string,
): boolean | undefined {
	const variant = dict.get(key);
	if (variant === undefined) {
		return undefined;
	}
	if (typeof variant.value === "boolean") {
		return variant.value;
	}
	return undefined;
}

/** Reads a number property from a `StringVariantDict`. */
export function dictGetNumber(
	dict: StringVariantDict,
	key: string,
): number | undefined {
	const variant = dict.get(key);
	if (variant === undefined) {
		return undefined;
	}
	if (typeof variant.value === "number") {
		return variant.value;
	}
	return undefined;
}

/** Reads a byte array property from a `StringVariantDict`. */
export function dictGetBytes(
	dict: StringVariantDict,
	key: string,
): Uint8Array | undefined {
	const variant = dict.get(key);
	if (variant === undefined) {
		return undefined;
	}
	if (variant.value instanceof Uint8Array) {
		return variant.value;
	}
	return undefined;
}

/** Reads a nested dict property from a `StringVariantDict`. */
export function dictGetDict(
	dict: StringVariantDict,
	key: string,
): StringVariantDict | undefined {
	const variant = dict.get(key);
	if (variant === undefined) {
		return undefined;
	}
	if (variant.value instanceof Map) {
		return variant.value as StringVariantDict;
	}
	return undefined;
}

/** Reads a string array property from a `StringVariantDict`. */
export function dictGetStringArray(
	dict: StringVariantDict,
	key: string,
): readonly string[] | undefined {
	const variant = dict.get(key);
	if (variant === undefined) {
		return undefined;
	}
	const raw = variant.value;
	if (Array.isArray(raw)) {
		const arr = raw as unknown[];
		const strings: string[] = [];
		for (const item of arr) {
			if (typeof item === "string") {
				strings.push(item);
			}
		}
		return strings;
	}
	return undefined;
}

// Exporting the accessor helpers for BlueZ transport use
export { asBoolean, asBytes, asDict, asManagedObjects, asNumber, asString };
