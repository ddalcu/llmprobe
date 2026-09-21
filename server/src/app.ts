import express from "express";
import type { PrismaClient } from "@prisma/client";
import { cardPage, comparePage, libraryPage, libraryRuns } from "./pages";
import { facets, listRuns } from "./queries";

const str = (v: unknown): string | undefined =>
  typeof v === "string" && v !== "" ? v : undefined;

export function createApp(db: PrismaClient, token?: string) {
  const app = express();
  app.use(express.json({ limit: "16mb" }));

  const authed = (req: express.Request) =>
    !token || req.get("authorization") === `Bearer ${token}`;

  app.post("/api/runs", async (req, res) => {
    if (!authed(req)) return res.status(401).json({ error: "unauthorized" });
    const { key, data } = req.body ?? {};
    if (typeof key !== "string" || !key || typeof data !== "object" || !data) {
      return res.status(400).json({ error: "key and data are required" });
    }
    await db.run.upsert({
      where: { key },
      create: { key, data },
      update: { data },
    });
    res.status(201).json({ key });
  });

  app.get("/api/runs", async (req, res) => {
    res.json(
      await listRuns(db, {
        model: str(req.query.model),
        hardware: str(req.query.hardware),
      }),
    );
  });

  app.get("/api/facets", async (_req, res) => res.json(await facets(db)));

  app.get("/api/runs/:key", async (req, res) => {
    const row = await db.run.findUnique({ where: { key: req.params.key } });
    if (!row) return res.status(404).json({ error: "not found" });
    res.json(row.data);
  });

  const allRuns = async () =>
    libraryRuns(
      await db.run.findMany({
        select: { key: true, data: true, createdAt: true },
      }),
    );

  app.get(["/", "/index.html"], async (_req, res) => {
    res.type("html").send(libraryPage(await allRuns()));
  });

  app.get("/compare.html", async (_req, res) => {
    res.type("html").send(comparePage(await allRuns()));
  });

  app.get("/card.html", async (req, res) => {
    const key = str(req.query.key);
    const row = key && (await db.run.findUnique({ where: { key } }));
    if (!row) return res.status(404).type("text").send("No run for that key.");
    res.type("html").send(cardPage(row.data as any));
  });

  return app;
}
