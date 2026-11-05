export const counterSetParameters = {
  type: "object",
  properties: {
    value: {
      type: "integer",
      description: "An integer between -999 and 999, inclusive.",
    },
  },
  required: ["value"],
  additionalProperties: false,
} as const;

export function readCounterValue(input: unknown): number {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("Counter input must be an object");
  }
  const value = (input as Record<string, unknown>).value;
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < -999 ||
    value > 999
  ) {
    throw new TypeError(
      "Counter value must be an integer between -999 and 999",
    );
  }
  return value;
}
