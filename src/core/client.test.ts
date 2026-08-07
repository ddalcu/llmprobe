import { describe, expect, test } from "vitest";

import { isTransportFailure } from "./client";

describe("isTransportFailure", () => {
  test("a refused connection is the target being gone", () => {
    const err = Object.assign(new TypeError("fetch failed"), {
      cause: Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:8080"), {
        code: "ECONNREFUSED",
      }),
    });
    expect(isTransportFailure(err)).toBe(true);
  });

  test("a socket that hangs up mid-response counts", () => {
    expect(isTransportFailure(new Error("socket hang up"))).toBe(true);
  });

  test("a timeout is a slow engine, not a dead one", () => {
    const timeout = Object.assign(new TypeError("fetch failed"), {
      cause: Object.assign(new Error("The operation timed out."), {
        name: "TimeoutError",
      }),
    });
    expect(isTransportFailure(timeout)).toBe(false);
  });

  test("an ordinary error is not a transport failure", () => {
    expect(isTransportFailure(new Error("unexpected end of JSON input"))).toBe(
      false,
    );
  });
});
