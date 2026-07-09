import { BadConnectionError } from "@bluetooth/errors.js";
import { MultiDeviceManager } from "@bluetooth/manager.js";
import { type Logger } from "@core/logger.js";
import { formatError, STARTUP_RETRY_DELAY_MS } from "./polling-state.js";

/**
 * Retries device connection on recoverable BLE startup errors.
 *
 * @returns `true` when connection succeeds, `false` when stopped.
 */
export async function connectAllWithRecovery(
  connectAll: () => Promise<void>,
  isStopRequested: () => boolean,
  runOnce: boolean,
  logger: Logger,
  sleep: (ms: number) => Promise<void>,
): Promise<boolean> {
  while (!isStopRequested()) {
    try {
      await connectAll();
      return true;
    } catch (error) {
      if (runOnce || !(error instanceof BadConnectionError)) {
        throw error;
      }

      logger.warn("Bluetooth startup failed; retrying", {
        error: formatError(error instanceof Error ? error : new Error(String(error))),
        retryInMs: STARTUP_RETRY_DELAY_MS,
      });
      await sleep(STARTUP_RETRY_DELAY_MS);
    }
  }

  return false;
}

/**
 * Repeatedly attempts to reconnect a lost device until success or stop.
 *
 * @returns `true` when reconnection succeeds, `false` when stopped.
 */
export async function recoverDeviceConnection(
  address: string,
  manager: MultiDeviceManager,
  isStopRequested: () => boolean,
  logger: Logger,
  sleep: (ms: number) => Promise<void>,
): Promise<boolean> {
  logger.warn("Bluetooth connection lost; reconnecting", { address });

  while (!isStopRequested()) {
    try {
      await manager.reconnect(address);
      logger.info("Bluetooth connection recovered", { address });
      return true;
    } catch (error) {
      logger.warn("Bluetooth reconnect failed; retrying", {
        address,
        error: formatError(error instanceof Error ? error : new Error(String(error))),
        retryInMs: STARTUP_RETRY_DELAY_MS,
      });
      await sleep(STARTUP_RETRY_DELAY_MS);
    }
  }

  return false;
}
