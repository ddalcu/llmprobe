import { createServer } from "node:http";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { LANGUAGE_CASES } from "./cases";
import { runLanguage } from "./index";

it("contains 96 language cases and four cross-language cases with unique IDs", () => {
  expect(LANGUAGE_CASES).toHaveLength(100);
  expect(new Set(LANGUAGE_CASES.map((c) => c.id)).size).toBe(100);
  const languages = new Set(
    LANGUAGE_CASES.map((c) => c.language).filter((l) => l !== "MIX"),
  );
  expect(languages.size).toBe(12);
  for (const language of languages)
    expect(LANGUAGE_CASES.filter((c) => c.language === language)).toHaveLength(
      8,
    );
});

it("caps concurrency, preserves complete answers and errors, and never overwrites logs", async () => {
  let active = 0,
    peak = 0;
  const bodies: any[] = [];
  const server = createServer(async (req, res) => {
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    bodies.push(body);
    peak = Math.max(peak, ++active);
    await new Promise((resolve) => setTimeout(resolve, 20));
    active--;
    if (body.messages[0].content === "bad") {
      res.writeHead(500);
      res.end("fixture failure");
      return;
    }
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        choices: [
          {
            message: { content: "ภาษาไทย — العربية — 日本語" },
            finish_reason: "stop",
          },
        ],
        usage: { completion_tokens: 12 },
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const dir = mkdtempSync(join(tmpdir(), "llmprobe-language-"));
  const address = server.address() as { port: number };
  const save = join(dir, "run.jsonl");
  try {
    const summary = await runLanguage({
      root: `http://127.0.0.1:${address.port}`,
      model: "test",
      save,
      concurrency: 4,
      cases: LANGUAGE_CASES.slice(0, 9).map((c, i) => ({
        ...c,
        prompt: i === 3 ? "bad" : c.prompt,
      })),
    });
    expect(peak).toBe(4);
    expect(summary.errors).toBe(1);
    expect(summary.completed).toBe(9);
    expect(
      bodies.every(
        (b) =>
          b.max_tokens === 500 &&
          b.enable_thinking === false &&
          b.enable_mtp === false,
      ),
    ).toBe(true);
    const text = readFileSync(save, "utf8");
    const rows = text
      .trim()
      .split("\n")
      .map((x) => JSON.parse(x));
    expect(rows.filter((x) => x.type === "response")).toHaveLength(9);
    expect(
      rows.some(
        (x) =>
          x.response?.choices[0].message.content ===
          "ภาษาไทย — العربية — 日本語",
      ),
    ).toBe(true);
    await expect(
      runLanguage({ root: "unused", model: "test", save }),
    ).rejects.toThrow();
    expect(readFileSync(save, "utf8")).toBe(text);
  } finally {
    server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
