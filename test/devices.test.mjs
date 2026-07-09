import assert from "node:assert/strict";
import {
	BLUETTI_DEFINITION_MAP,
	BLUETTI_DEFINITIONS,
	BluettiDeviceModel,
} from "../dist/devices/definition.js";
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
} from "../dist/devices/field.js";
import {
	createDeviceFromAdvertisement,
	isSupportedBluettiName,
} from "../dist/devices/registry.js";
import { DeviceStruct } from "../dist/devices/struct.js";

await run();

async function run() {
	testFieldTypes();
	testAllDevicesHaveUniqueTypes();
	testAllDeviceStructsParse();
	testDefinitionMapLookup();
	testBluettiDeviceModel();
	testRegistryCreate();
	testRegistryIsSupported();
	testRejectsUnknownDeviceName();
	console.log("devices smoke test passed");
}

function testFieldTypes() {
	const uint = new UintField("test_uint", 10);
	assert.equal(uint.name, "test_uint");
	assert.equal(uint.address, 10);
	assert.equal(uint.size, 1);

	const bool = new BoolField("test_bool", 20);
	assert.equal(bool.name, "test_bool");
	assert.equal(bool.address, 20);

	const uintRange = new UintField("ranged", 30, [0, 100]);
	assert.equal(uintRange.isInRange(50), true);
	assert.equal(uintRange.isInRange(101), false);

	const enumField = new EnumField("mode", 40, { eco: 1, normal: 2 });
	assert.equal(enumField.enumDefinition.eco, 1);

	const decimal = new DecimalField("voltage", 50, 1);
	assert.equal(decimal.name, "voltage");

	const arr = new DecimalArrayField("cells", 60, 3, 2);
	assert.equal(arr.size, 3);

	const str = new StringField("name", 70, 6);
	assert.equal(str.size, 6);

	const swapStr = new SwapStringField("name", 80, 3);
	assert.equal(swapStr.size, 3);

	const ver = new VersionField("firmware", 90);
	assert.equal(ver.size, 2);

	const sn = new SerialNumberField("serial", 100);
	assert.equal(sn.size, 4);
}

function testAllDevicesHaveUniqueTypes() {
	const types = BLUETTI_DEFINITIONS.map((d) => d.type);
	const unique = new Set(types);
	assert.equal(types.length, unique.size, "device types must be unique");
}

function testAllDeviceStructsParse() {
	for (const def of BLUETTI_DEFINITIONS) {
		const struct = def.buildStruct();
		assert.ok(
			struct instanceof DeviceStruct,
			`${def.type} struct is a DeviceStruct`,
		);
		assert.ok(struct.fields.length > 0, `${def.type} has fields`);

		for (const cmd of def.pollingCommands) {
			const raw = new Uint8Array(cmd.quantity * 2);
			for (let i = 0; i < raw.length; i++) {
				raw[i] = (i * 7 + 3) & 0xff;
			}
			const parsed = struct.parse(cmd.startingAddress, raw);
			assert.ok(
				typeof parsed === "object",
				`${def.type} parse(${cmd.startingAddress}) produced object`,
			);
		}
	}
}

function testDefinitionMapLookup() {
	assert.ok(BLUETTI_DEFINITION_MAP instanceof Map);
	assert.equal(BLUETTI_DEFINITION_MAP.size, BLUETTI_DEFINITIONS.length);

	for (const def of BLUETTI_DEFINITIONS) {
		assert.equal(BLUETTI_DEFINITION_MAP.get(def.type), def);
	}
	assert.equal(BLUETTI_DEFINITION_MAP.get("NONEXISTENT"), undefined);
}

function testBluettiDeviceModel() {
	const ac500Def = BLUETTI_DEFINITION_MAP.get("AC500");
	assert.ok(ac500Def);

	const model = new BluettiDeviceModel(
		"00:11:22:33:44:55",
		"2237000003358",
		ac500Def,
	);
	assert.equal(model.type, "AC500");
	assert.equal(model.address, "00:11:22:33:44:55");
	assert.equal(model.serialNumber, "2237000003358");
	assert.equal(model.packNumMax, 6);
	assert.ok(model.pollingCommands.length > 0);
	assert.ok(model.packPollingCommands.length > 0);
	assert.ok(model.loggingCommands.length > 0);
	assert.ok(model.packLoggingCommands.length > 0);
	assert.ok(model.writableRanges.length > 0);

	assert.equal(model.hasField("total_battery_percent"), true);
	assert.equal(model.hasField("nonexistent"), false);
	assert.equal(model.hasFieldSetter("total_battery_percent"), false);
	assert.equal(model.hasFieldSetter("ac_output_on"), true);
}

function testRegistryCreate() {
	const device = createDeviceFromAdvertisement(
		"00:11:22:33:44:55",
		"AC5002237000003358",
	);
	assert.equal(device.type, "AC500");
	assert.equal(device.serialNumber, "2237000003358");

	assert.ok(isSupportedBluettiName("AC5002237000003358"));
	assert.ok(isSupportedBluettiName("EB3A12345"));
	assert.ok(isSupportedBluettiName("AC600001"));
}

function testRegistryIsSupported() {
	assert.equal(isSupportedBluettiName("AC500"), false);
	assert.equal(isSupportedBluettiName(""), false);
	assert.equal(isSupportedBluettiName("INVALID"), false);
}

function testRejectsUnknownDeviceName() {
	assert.throws(
		() => createDeviceFromAdvertisement("00:00:00:00:00:00", "UNKNOWN123"),
		/Unsupported Bluetti device/,
	);
}
