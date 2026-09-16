import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

import { expect, test } from "vitest";

import { autoLabel, fetchEngineSettings } from "./engine-settings";

test("engine settings come from /props when present, and are omitted otherwise", async () => {
  const replies: Array<[number, string]> = [
    [404, "not found"],
    [200, "<html>catch-all</html>"],
    [200, JSON.stringify({ error: "unknown path" })],
    [200, JSON.stringify({ default_generation_settings: { n_ctx: 4096 } })],
    [
      200,
      JSON.stringify({
        default_generation_settings: { n_ctx: 32768 },
        model_info: { max_position_embeddings: 262144 },
        ane: { mode: "channel" },
        settings: { kv_quant: "8", mtp: { acceptance: "tokenv3" } },
      }),
    ],
  ];
  const paths: string[] = [];
  const server = createServer((req, res) => {
    paths.push(req.url ?? "");
    const [status, body] = replies.shift()!;
    res.writeHead(status).end(body);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const root = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  try {
    for (let i = 0; i < 4; i += 1) {
      expect(await fetchEngineSettings(root, "m", {})).toBeUndefined();
    }
    expect(await fetchEngineSettings(root, "org/m", {})).toEqual({
      kv_quant: "8",
      mtp: { acceptance: "tokenv3" },
      ctx: 32768,
      model_max_ctx: 262144,
      ane: "channel",
    });
    expect(paths.at(-1)).toBe("/props?model=org%2Fm");
    server.close();
    expect(await fetchEngineSettings(root, "m", {})).toBeUndefined();
  } finally {
    server.close();
  }
});

test("auto label names only what differs from mlx-serve's defaults", () => {
  const defaults = {
    engine: "mlx",
    kv_quant: "off",
    kv_attn_mode: "auto",
    decode_attn_quant: true,
    prefill_chunk: 8192,
    mtp: { loaded: true, default_on: true, acceptance: "exact" },
    drafter: "none",
    pld: { default_on: true },
    ctx: 262144,
    model_max_ctx: 262144,
  };
  expect(autoLabel(defaults)).toBe("default");
  expect(autoLabel({ ...defaults, ctx: 131072 })).toBe("ctx128k");
  expect(
    autoLabel({
      ...defaults,
      kv_quant: "8",
      mtp: {
        loaded: true,
        default_on: true,
        acceptance: "tokenv3",
        acceptance_param: 0.95,
      },
      pld: { default_on: false },
      decode_attn_quant: false,
      ane: "channel",
    }),
  ).toBe("kv8 mtp-tokenv3-0.95 no-pld no-attn-quant ane-channel");
  expect(
    autoLabel({
      ...defaults,
      engine: "llama",
      kv_quant: "q4",
      mtp: { loaded: true, default_on: false },
    }),
  ).toBe("kv-q4 mtp-off");
  expect(autoLabel(undefined)).toBeUndefined();
});
