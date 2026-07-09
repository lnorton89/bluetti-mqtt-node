#!/usr/bin/env node
import { DeviceSession } from "@bluetooth/device-session.js";
import { WindowsHelperClient, createWindowsHelperRuntime } from "@bluetooth/helper-client.js";
import { ReadHoldingRegisters } from "@core/commands.js";
import { createDeviceFromAdvertisement } from "@devices/registry.js";
import { hasHelpFlag, HelpError, optionalSingleAddressArg, runCli } from "./shared.js";
/** CLI usage text printed by `--help` or on argument errors. */
const HELP_TEXT = `Usage: bluetti-mqtt-node-probe [BLUETOOTH_MAC]

Without an address, scan for nearby devices.
With an address, connect and run a single register-read probe.
`;
/**
 * Scans without an address or performs one minimal register read.
 *
 * @remarks
 * Without an address argument, scans for nearby devices and prints JSON.
 * With an address, connects, reads the device name, executes
 * `ReadHoldingRegisters(10, 40)`, and prints the parsed result.
 */
async function main() {
    const argv = process.argv.slice(2);
    if (hasHelpFlag(argv)) {
        throw new HelpError(HELP_TEXT);
    }
    const address = optionalSingleAddressArg(argv, HELP_TEXT);
    const client = new WindowsHelperClient();
    let transport = null;
    let operationFailed = false;
    try {
        const runtime = createWindowsHelperRuntime(client);
        if (!address) {
            const devices = await runtime.discovery?.discover();
            console.log(JSON.stringify(devices ?? [], null, 2));
            return;
        }
        transport = runtime.transportFactory.create();
        const session = new DeviceSession(address, transport);
        await session.connectAndInitialize();
        if (session.name === null) {
            throw new Error("Connected device did not report a name");
        }
        console.log(`Connected to ${session.name} at ${address}`);
        const command = new ReadHoldingRegisters(10, 40);
        const response = await session.perform(command);
        console.log(`Received ${response.length} bytes`);
        const device = createDeviceFromAdvertisement(address, session.name);
        const parsed = device.parse(command.startingAddress, command.parseResponse(response));
        console.log(JSON.stringify(parsed, bigintReplacer, 2));
    }
    catch (error) {
        operationFailed = true;
        throw error;
    }
    finally {
        let disconnectError;
        if (transport !== null) {
            try {
                await transport.disconnect();
            }
            catch (error) {
                if (!operationFailed) {
                    disconnectError = error;
                }
            }
        }
        client.dispose();
        if (disconnectError !== undefined) {
            throw disconnectError;
        }
    }
}
runCli(main);
/**
 * JSON.stringify replacer that converts `bigint` values to strings.
 *
 * @param _key - Object key (unused).
 * @param value - Value to convert.
 * @returns String representation for `bigint`, otherwise the value unchanged.
 */
function bigintReplacer(_key, value) {
    return typeof value === "bigint" ? value.toString() : value;
}
