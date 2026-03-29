#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { WindowsHelperClient, createWindowsHelperRuntime } from "../bluetooth/helper-client.js";
import { BluettiMqttServer } from "../app/server.js";
import { ConsoleLogger, type LogLevel } from "../core/logger.js";
import { HelpError, installSignalHandlers, runCli, UsageError, validateBluetoothAddress } from "./shared.js";

const HELP_TEXT = `Usage: bluetti-mqtt-node --broker <mqtt-url> [options] <BLUETOOTH_MAC...>
       bluetti-mqtt-node --config <path>

Options:
  --broker <mqtt-url>   MQTT broker URL, for example mqtt://127.0.0.1:1883
  --config <path>       Read runtime options from a JSON config file
  --username <value>    MQTT username
  --password <value>    MQTT password
  --interval <seconds>  Poll interval in seconds for continuous mode
  --log-level <level>   debug, info, warn, or error
  --once                Poll and publish once, then exit
  -h, --help            Show this help text
`;

async function main(): Promise<void> {
  const args = await parseArgs(process.argv.slice(2));
  if (args.help) {
    throw new HelpError(HELP_TEXT);
  }

  if (!args.brokerUrl || args.addresses.length === 0) {
    throw new UsageError(HELP_TEXT);
  }

  const logger = new ConsoleLogger(args.logLevel);
  const helper = new WindowsHelperClient();
  let removeSignalHandlers: (() => void) | undefined;
  try {
    const runtime = createWindowsHelperRuntime(helper);
    const mqttOptions: {
      url: string;
      username?: string;
      password?: string;
    } = { url: args.brokerUrl };
    if (args.username !== undefined) {
      mqttOptions.username = args.username;
    }
    if (args.password !== undefined) {
      mqttOptions.password = args.password;
    }

    const server = new BluettiMqttServer({
      addresses: args.addresses,
      transportFactory: runtime.transportFactory,
      intervalMs: args.intervalMs,
      runOnce: args.runOnce,
      mqtt: mqttOptions,
      logger,
    });

    removeSignalHandlers = installSignalHandlers(async () => {
      logger.info("Stopping bluetti-mqtt-node");
      await server.stop();
    });

    logger.info("Starting bluetti-mqtt-node", {
      addresses: args.addresses,
      brokerUrl: args.brokerUrl,
      intervalMs: args.intervalMs,
      runOnce: args.runOnce,
    });
    await server.run();
  } finally {
    removeSignalHandlers?.();
    helper.dispose();
  }
}

interface CliConfigFile {
  readonly broker?: string;
  readonly username?: string;
  readonly password?: string;
  readonly interval?: number;
  readonly once?: boolean;
  readonly addresses?: readonly string[];
  readonly logLevel?: LogLevel;
}

async function parseArgs(argv: readonly string[]): Promise<{
  brokerUrl: string | undefined;
  username: string | undefined;
  password: string | undefined;
  intervalMs: number;
  runOnce: boolean;
  addresses: string[];
  help: boolean;
  logLevel: LogLevel;
}> {
  const addresses: string[] = [];
  let brokerUrl: string | undefined;
  let username: string | undefined;
  let password: string | undefined;
  let intervalMs = 0;
  let runOnce = false;
  let help = false;
  let configPath: string | undefined;
  let logLevel: LogLevel = "info";

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    switch (token) {
      case "-h":
      case "--help":
        help = true;
        break;
      case "--broker":
        brokerUrl = requireValue(argv, index, HELP_TEXT);
        index += 1;
        break;
      case "--config":
        configPath = requireValue(argv, index, HELP_TEXT);
        index += 1;
        break;
      case "--username":
        username = requireValue(argv, index, HELP_TEXT);
        index += 1;
        break;
      case "--password":
        password = requireValue(argv, index, HELP_TEXT);
        index += 1;
        break;
      case "--interval":
        intervalMs = parseIntervalSeconds(requireValue(argv, index, HELP_TEXT), HELP_TEXT);
        index += 1;
        break;
      case "--log-level":
        logLevel = parseLogLevel(requireValue(argv, index, HELP_TEXT), HELP_TEXT);
        index += 1;
        break;
      case "--once":
        runOnce = true;
        break;
      default:
        if (token) {
          addresses.push(validateBluetoothAddress(token));
        }
        break;
    }
  }

  if (configPath !== undefined) {
    const config = await readConfigFile(configPath);
    brokerUrl = brokerUrl ?? config.broker;
    username = username ?? config.username;
    password = password ?? config.password;
    intervalMs = intervalMs > 0 ? intervalMs : (config.interval ?? 0) * 1000;
    runOnce = runOnce || config.once === true;
    logLevel = logLevel !== "info" ? logLevel : (config.logLevel ?? "info");
    if (addresses.length === 0 && config.addresses !== undefined) {
      addresses.push(...config.addresses.map((address) => validateBluetoothAddress(address)));
    }
  }

  return { brokerUrl, username, password, intervalMs, runOnce, addresses, help, logLevel };
}

runCli(main);

function requireValue(argv: readonly string[], index: number, helpText: string): string {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new UsageError(helpText);
  }

  return value;
}

function parseIntervalSeconds(rawValue: string, helpText: string): number {
  const seconds = Number(rawValue);
  if (!Number.isFinite(seconds) || seconds < 0) {
    throw new UsageError(helpText);
  }

  return seconds * 1000;
}

function parseLogLevel(rawValue: string, helpText: string): LogLevel {
  if (rawValue === "debug" || rawValue === "info" || rawValue === "warn" || rawValue === "error") {
    return rawValue;
  }

  throw new UsageError(helpText);
}

async function readConfigFile(path: string): Promise<CliConfigFile> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    throw new UsageError(`Failed to read config file '${path}'.`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new UsageError(`Config file '${path}' must be valid JSON.`);
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new UsageError(`Config file '${path}' must contain a JSON object.`);
  }

  return parsed as CliConfigFile;
}
