#!/usr/bin/env node

import { WindowsHelperClient, createWindowsHelperRuntime } from "../bluetooth/helper-client.js";
import { BluettiMqttServer } from "../app/server.js";
import { HelpError, installSignalHandlers, runCli, UsageError } from "./shared.js";

const HELP_TEXT = `Usage: bluetti-mqtt-node --broker <mqtt-url> [options] <BLUETOOTH_MAC...>

Options:
  --broker <mqtt-url>   MQTT broker URL, for example mqtt://127.0.0.1:1883
  --username <value>    MQTT username
  --password <value>    MQTT password
  --interval <seconds>  Poll interval in seconds for continuous mode
  --once                Poll and publish once, then exit
  -h, --help            Show this help text
`;

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    throw new HelpError(HELP_TEXT);
  }

  if (!args.brokerUrl || args.addresses.length === 0) {
    throw new UsageError(HELP_TEXT);
  }

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
    });

    removeSignalHandlers = installSignalHandlers(async () => {
      console.error("Stopping bluetti-mqtt-node...");
      await server.stop();
    });

    console.log(`Starting bluetti-mqtt-node for ${args.addresses.join(", ")} -> ${args.brokerUrl}`);
    await server.run();
  } finally {
    removeSignalHandlers?.();
    helper.dispose();
  }
}

function parseArgs(argv: readonly string[]): {
  brokerUrl: string | undefined;
  username: string | undefined;
  password: string | undefined;
  intervalMs: number;
  runOnce: boolean;
  addresses: string[];
  help: boolean;
} {
  const addresses: string[] = [];
  let brokerUrl: string | undefined;
  let username: string | undefined;
  let password: string | undefined;
  let intervalMs = 0;
  let runOnce = false;
  let help = false;

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
      case "--once":
        runOnce = true;
        break;
      default:
        if (token) {
          addresses.push(token);
        }
        break;
    }
  }

  return { brokerUrl, username, password, intervalMs, runOnce, addresses, help };
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
