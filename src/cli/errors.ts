/**
 * User-facing argument or configuration error.
 *
 * Rendered to stderr with exit code 1 by {@link runCli}.
 *
 * @see runCli
 */
export class UsageError extends Error {}

/**
 * Control-flow error used to print help and exit successfully.
 *
 * Rendered to stdout with exit code 0 by {@link runCli}.
 *
 * @see runCli
 */
export class HelpError extends Error {}
