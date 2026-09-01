import { expect, test } from "bun:test";

import { inject } from "./index.tsx";

test("waits for split DSH Client services before activation", () => {
  expect(inject).toEqual(["slots", "sessions"]);
});
