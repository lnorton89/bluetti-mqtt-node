import { WindowsHelperClient, createWindowsHelperRuntime } from "../bluetooth/helper-client.js";
import { BluettiMqttServer } from "../app/server.js";

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.brokerUrl || args.addresses.length === 0) {
    throw new Error("Usage: node dist/cli/bluetti-mqtt.js --broker mqtt://host:1883 <BLUETOOTH_MAC...>");
  }

  const helper = new WindowsHelperClient();
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

    console.log(`Starting bluetti-mqtt-node for ${args.addresses.join(", ")} -> ${args.brokerUrl}`);
    await server.run();
  } finally {
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
} {
  const addresses: string[] = [];
  let brokerUrl: string | undefined;
  let username: string | undefined;
  let password: string | undefined;
  let intervalMs = 0;
  let runOnce = false;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    switch (token) {
      case "--broker":
        brokerUrl = argv[index + 1];
        index += 1;
        break;
      case "--username":
        username = argv[index + 1];
        index += 1;
        break;
      case "--password":
        password = argv[index + 1];
        index += 1;
        break;
      case "--interval":
        intervalMs = Number(argv[index + 1] ?? "0") * 1000;
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

  return { brokerUrl, username, password, intervalMs, runOnce, addresses };
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
