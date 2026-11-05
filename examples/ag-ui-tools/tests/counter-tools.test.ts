import { expect, test } from "bun:test";
import { assertObjectJsonSchema } from "@deepseek-ai/dsh-tools";
import {
  counterSetParameters,
  readCounterValue,
} from "../src/client/counter-tools.ts";

test("counter tools use the pinned DSH schema subset", () => {
  expect(() => assertObjectJsonSchema(counterSetParameters)).not.toThrow();
});

test("counter execution preserves integer bounds beyond schema annotations", () => {
  for (const value of [-999, 0, 999]) {
    expect(readCounterValue({ value })).toBe(value);
  }
  for (const input of [
    null,
    [],
    {},
    { value: "1" },
    { value: 1.5 },
    { value: -1000 },
    { value: 1000 },
  ]) {
    expect(() => readCounterValue(input)).toThrow(TypeError);
  }
});
