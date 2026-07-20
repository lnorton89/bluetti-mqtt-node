/** Flag that switches a CLI onto the simulated device runtime. */
export const MOCK_FLAG = "--mock";

/**
 * Splits the `--mock` flag out of a CLI argument list.
 *
 * @param argv - Command-line arguments (excluding the executable).
 * @returns Whether the flag was present, and the remaining arguments in
 *   their original order.
 *
 * @example
 * ```ts
 * extractMockFlag(["--mock", "00:11:22:33:44:55"]);
 * // { mock: true, rest: ["00:11:22:33:44:55"] }
 * ```
 */
export function extractMockFlag(argv: readonly string[]): {
	mock: boolean;
	rest: string[];
} {
	const rest = argv.filter((token) => token !== MOCK_FLAG);
	return { mock: rest.length !== argv.length, rest };
}
