export function assertWallClockBelow(
  elapsedMs: number,
  limitMs: number,
  message: string,
): void {
  if (
    process.env.AVALON_PERF_ASSERTIONS === '1'
    && !(elapsedMs < limitMs)
  ) {
    throw new Error(message)
  }
}
