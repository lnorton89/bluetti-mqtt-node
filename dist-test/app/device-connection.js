import { BadConnectionError } from "@bluetooth/errors.js";
import { formatError, STARTUP_RETRY_DELAY_MS } from "./polling-state.js";
/**
 * Retries device connection on recoverable BLE startup errors.
 *
 * @returns `true` when connection succeeds, `false` when stopped.
 */
export async function connectAllWithRecovery(connectAll, isStopRequested, runOnce, logger, sleep) {
    while (!isStopRequested()) {
        try {
            await connectAll();
            return true;
        }
        catch (error) {
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
export async function recoverDeviceConnection(address, manager, isStopRequested, logger, sleep) {
    logger.warn("Bluetooth connection lost; reconnecting", { address });
    while (!isStopRequested()) {
        try {
            await manager.reconnect(address);
            logger.info("Bluetooth connection recovered", { address });
            return true;
        }
        catch (error) {
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
