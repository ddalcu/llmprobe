import { createServer, type ServerResponse } from "node:http";
import { AddressInfo, createServer as createTcpServer } from "node:net";

import { describe, expect, test } from "vitest";
import { Agent, fetch as undiciFetch } from "undici";

import {
  BudgetExceededError,
  EngineClient,
  isTransportFailure,
  type RunConfig,
  TargetUnreachableError,
} from "./client";
import { normalizeRoot } from "./probe";
import { startMockEngine } from "../fixtures/mock-engine";

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

describe("TargetUnreachableError", () => {
  test("names the errno from the cause chain, undici nests included", () => {
    // The shape undici actually throws: TypeError("fetch failed") wrapping an
    // AggregateError whose members carry the codes.
    const err = new TargetUnreachableError("/chat/completions", {
      name: "TypeError",
      message: "fetch failed",
      cause: {
        name: "AggregateError",
        errors: [
          { name: "Error", code: "ECONNRESET", message: "read ECONNRESET" },
        ],
      },
    });

    expect(err.message).toContain("ECONNRESET");
  });
});

describe("the budget reservation", () => {
  test("an in-flight reservation projects the budget until released", async () => {
    const engine = await startMockEngine();
    try {
      const config: RunConfig = {
        baseUrl: `${normalizeRoot(engine.url)}/v1`,
        apiKey: "",
        model: "mock-model-12b",
        timeoutMs: 5_000,
        depth: "default",
        reasoningHeadroom: 0,
        budgetTokens: 10_000,
      };
      const client = new EngineClient(config);

      // Three questions in flight, each holding its 4k generation cap: the
      // projected spend crosses the budget, so the next send is refused
      // before any socket opens — a parallel burst cannot spend past the
      // budget on the strength of checks made before the others landed.
      client.reserveOutput(4_000);
      client.reserveOutput(4_000);
      client.reserveOutput(4_000);
      await expect(client.request("GET", "/models")).rejects.toBeInstanceOf(
        BudgetExceededError,
      );

      // Their real usage landed; the reservations are gone and the same
      // send goes through.
      client.releaseOutput(4_000);
      client.releaseOutput(4_000);
      client.releaseOutput(4_000);
      const ok = await client.request("GET", "/models");
      expect(ok.status).toBe(200);
    } finally {
      engine.stop();
    }
  });
});

describe("the no-deadline dispatcher", () => {
  test("headersTimeout 0 outlives undici's built-in ceiling", async () => {
    // A non-streaming request to a thinking model gets no headers until
    // generation ends; undici's default headersTimeout kills it. The knob our
    // dispatcher sets to 0 is the only lever. No artificial sleeps here: the
    // impatient fetch dies on undici's own 100ms clock, and the patient one —
    // pending on the same silent server the whole time — must outlive it.
    const held: ServerResponse[] = [];
    const server = createServer((req, res) => {
      held.push(res);
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/x`;

    try {
      const impatient = undiciFetch(url, {
        dispatcher: new Agent({ headersTimeout: 100 }),
      });
      const patient = undiciFetch(url, {
        dispatcher: new Agent({ headersTimeout: 0, bodyTimeout: 0 }),
      });

      await expect(impatient).rejects.toThrow();

      for (const res of held) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end("{}");
      }
      const response = await patient;
      expect(response.status).toBe(200);
    } finally {
      server.close();
    }
  });
});

describe("a large Connection: close body", () => {
  test("read late is still read whole instead of crashing the process", async () => {
    // undici 7's parser asserted `!paused` when the server's FIN landed on a
    // body bigger than the stream buffer that nobody had drained yet — an
    // uncatchable throw from a socket handler that killed the CLI on a 70 KB
    // /v1/models. A raw socket server because node:http would never send the
    // unframed close this needs; the pause before reading is the slow consumer.
    const body = JSON.stringify({ data: "x".repeat(70_000) });
    const server = createTcpServer((socket) => {
      socket.once("data", () =>
        socket.end(
          `HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: ${body.length}\r\nConnection: close\r\n\r\n${body}`,
        ),
      );
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1/models`;

    try {
      for (let i = 0; i < 5; i++) {
        const response = await undiciFetch(url, {
          dispatcher: new Agent({ headersTimeout: 0, bodyTimeout: 0 }),
        });
        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(await response.text()).toBe(body);
      }
    } finally {
      server.close();
    }
  });
});
