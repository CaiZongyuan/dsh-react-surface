import { describe, expect, test } from "bun:test";

import { ReactSurfaceEffectLedger } from "./effect-ledger.ts";

describe("ReactSurfaceEffectLedger", () => {
  test("releases effects in reverse order and only once", () => {
    const ledger = new ReactSurfaceEffectLedger();
    const activation = ledger.begin();
    const released: string[] = [];
    ledger.record(activation, () => released.push("first"));
    ledger.record(activation, () => released.push("second"));

    ledger.dispose(activation);
    ledger.dispose(activation);

    expect(released).toEqual(["second", "first"]);
  });

  test("continues cleanup after one effect fails", () => {
    const ledger = new ReactSurfaceEffectLedger();
    const activation = ledger.begin();
    let released = false;
    ledger.record(activation, () => {
      released = true;
    });
    ledger.record(activation, () => {
      throw new Error("failed");
    });

    ledger.dispose(activation);

    expect(released).toBe(true);
  });
});
