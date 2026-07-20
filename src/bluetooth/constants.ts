export const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
export const DEFAULT_SCAN_TIMEOUT_MS = 5_000;
export const SCAN_TIMEOUT_BUFFER_MS = 5_000;
export const DEFAULT_WITHOUT_RESPONSE = false;

export const HELPER_ERROR_COMMAND_FAILED = "command_failed";
export const DISPOSED_OBJECT_ERROR_TEXT = "cannot access a disposed object";
export const UNREACHABLE_ERROR_TEXT = "unreachable";
export const MISSING_CHARACTERISTIC_ERROR_TEXT = "was not found on device";
export const GATT_UNREACHABLE_TEXT = "enumerate GATT services: unreachable";
export const GATT_FAILED_UNREACHABLE_TEXT =
	"failed to enumerate GATT services: unreachable";

export const HELPER_EVENT_READY = "ready";
export const HELPER_EVENT_NOTIFICATION = "notification";
export const HELPER_MESSAGE_TYPE_EVENT = "event";

export const MODBUS_BUSY_EXCEPTION_CODE = 5;
export const DEFAULT_DEVICE_BUSY_MESSAGE = "Device reported MODBUS busy";

export const AT_CONTROL_NAME_MESSAGE = "AT+NAME?\r";
export const AT_CONTROL_ADV_MESSAGE = "AT+ADV?\r";

export const UNKNOWN_ERROR_CODE = -1;
