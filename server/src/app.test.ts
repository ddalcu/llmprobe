import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { PrismaClient } from "@prisma/client";
import { createApp } from "./app";

// Its own database: these tests truncate between cases and must never be
// able to point at the one holding real uploads.
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("api (needs TEST_DATABASE_URL)", () => {
  // Built in beforeAll: skipIf still evaluates the suite body.
  let db: PrismaClient;
  let app: ReturnType<typeof createApp>;
  beforeAll(() => {
    db = new PrismaClient({ datasources: { db: { url } } });
    app = createApp(db, "s3cret");
  });

  const report = (model: string, cpu: string, startedAt: string) => ({
    target: { model, engine: "llama.cpp", baseUrl: "http://h:8080" },
    machine: { platform: "darwin", arch: "arm64", cpu, memGB: 36 },
    run: { startedAt },
    bench: { decodeTokPerSec: { median: 42 } },
  });

  const post = (key: string, data: unknown) =>
    request(app)
      .post("/api/runs")
      .set("authorization", "Bearer s3cret")
      .send({ key, data });

  beforeEach(() => db.run.deleteMany());
  afterAll(() => db.$disconnect());

  it("rejects an upload with a bad token", async () => {
    await request(app)
      .post("/api/runs")
      .send({ key: "a", data: {} })
      .expect(401);
    await request(app)
      .post("/api/runs")
      .set("authorization", "Bearer wrong")
      .send({ key: "a", data: {} })
      .expect(401);
  });

  it("rejects a payload with no key", async () => {
    await post("", {}).expect(400);
  });

  it("upserts on key instead of duplicating", async () => {
    await post("k1", report("qwen3", "M3", "2026-01-01T00:00:00.000Z")).expect(
      201,
    );
    await post(
      "k1",
      report("qwen3-renamed", "M3", "2026-01-01T00:00:00.000Z"),
    ).expect(201);
    const { body } = await request(app).get("/api/runs").expect(200);
    expect(body).toHaveLength(1);
    expect(body[0].model).toBe("qwen3-renamed");
  });

  it("filters by model and hardware in the database", async () => {
    await post("a", report("qwen3", "Apple M3", "2026-01-01T00:00:00.000Z"));
    await post("b", report("qwen3", "AMD 7950X", "2026-01-02T00:00:00.000Z"));
    await post("c", report("gemma4", "Apple M3", "2026-01-03T00:00:00.000Z"));

    const keys = async (q: string) =>
      (await request(app).get(`/api/runs${q}`).expect(200)).body.map(
        (r: any) => r.key,
      );

    expect(await keys("")).toEqual(["c", "b", "a"]); // newest first
    expect(await keys("?model=qwen3")).toEqual(["b", "a"]);
    expect(
      await keys("?hardware=Apple+M3+%C2%B7+36GB+%C2%B7+darwin%2Farm64"),
    ).toEqual(["c", "a"]);
    expect(
      await keys(
        "?model=qwen3&hardware=AMD+7950X+%C2%B7+36GB+%C2%B7+darwin%2Farm64",
      ),
    ).toEqual(["b"]);
  });

  it("labels a report with no machine as unknown and offers it as a facet", async () => {
    await post("a", { target: { model: "qwen3" } });
    const { body } = await request(app).get("/api/facets").expect(200);
    expect(body).toEqual({ models: ["qwen3"], hardware: ["unknown"] });
    const runs = await request(app)
      .get("/api/runs?hardware=unknown")
      .expect(200);
    expect(runs.body).toHaveLength(1);
  });

  it("serves the full json back by key", async () => {
    await post("k1", report("qwen3", "M3", "2026-01-01T00:00:00.000Z"));
    const { body } = await request(app).get("/api/runs/k1").expect(200);
    expect(body.bench.decodeTokPerSec.median).toBe(42);
    await request(app).get("/api/runs/nope").expect(404);
  });
});
