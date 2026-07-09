export const HELP_LONG_FLAG = "--help";
export const HELP_SHORT_FLAG = "-h";

export const VALID_LOG_LEVELS = ["debug", "info", "warn", "error"] as const;

export const MAC_COLON_PATTERN = /^([0-9A-F]{2}:){5}[0-9A-F]{2}$/;
export const MAC_HYPHEN_PATTERN = /^([0-9A-F]{2}-){5}[0-9A-F]{2}$/;
export const MAC_COMPACT_PATTERN = /^[0-9A-F]{12}$/;

export const SIGNAL_INTERRUPT = "SIGINT";
export const SIGNAL_TERMINATE = "SIGTERM";
