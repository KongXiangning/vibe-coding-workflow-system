// Deliberate synthetic verification seed, not production code.
// Only the fixture's two-decimal amount samples are in this verification scope.
export function total(values) { return values.reduce((cents, value) => cents + Math.round(value * 100), 0) / 100; }
