import { Prisma, type PrismaClient } from "@prisma/client";
import { summarize, UNKNOWN_HARDWARE, type RunSummary } from "./summary";

/** SQL twin of hardwareLabel(). Filtering happens in Postgres, not in Node. */
const HARDWARE_SQL = Prisma.sql`coalesce(nullif(concat_ws(' · ',
  data->'machine'->>'cpu',
  (data->'machine'->>'memGB') || 'GB',
  (data->'machine'->>'platform') || '/' || (data->'machine'->>'arch')
), ''), ${UNKNOWN_HARDWARE})`;

const MODEL_SQL = Prisma.sql`data->'target'->>'model'`;

export interface RunFilter {
  model?: string;
  hardware?: string;
}

const where = (f: RunFilter) => Prisma.sql`
  WHERE (${f.model ?? null}::text IS NULL OR ${MODEL_SQL} = ${f.model ?? null})
    AND (${f.hardware ?? null}::text IS NULL OR ${HARDWARE_SQL} = ${f.hardware ?? null})`;

export async function listRuns(
  db: PrismaClient,
  filter: RunFilter,
): Promise<RunSummary[]> {
  const rows = await db.$queryRaw<Array<{ key: string; data: unknown }>>(
    Prisma.sql`SELECT key, data FROM "Run" ${where(filter)}
      ORDER BY coalesce(data->'run'->>'startedAt', "createdAt"::text) DESC`,
  );
  return rows.map((r) => summarize(r.key, r.data));
}

export async function facets(
  db: PrismaClient,
): Promise<{ models: string[]; hardware: string[] }> {
  const rows = await db.$queryRaw<Array<{ model: string; hardware: string }>>(
    Prisma.sql`SELECT DISTINCT ${MODEL_SQL} AS model, ${HARDWARE_SQL} AS hardware FROM "Run"`,
  );
  const sorted = (xs: string[]) => [...new Set(xs.filter(Boolean))].sort();
  return {
    models: sorted(rows.map((r) => r.model)),
    hardware: sorted(rows.map((r) => r.hardware)),
  };
}
