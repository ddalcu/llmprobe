import type { CreditDef, SurfaceDef } from "./registry";

/**
 * Surface discovery — the basis of the entire Coverage number.
 *
 * Generalized from the old per-suite probe. The load-bearing idea, kept intact:
 * an empty-body POST costs zero tokens (the server fails validation long before
 * inference), and the *status* separates "you don't implement this" from "you
 * implement it and it's broken":
 *
 *   404 / 405        → the path isn't there. Costs Coverage.
 *   anything else    → the path exists. Costs Conformance if it misbehaves.
 *
 * Conflating those two is the mistake that would make the whole report useless:
 * llama.cpp not having `/v1/audio` is a completeness story, and llama.cpp
 * returning garbage from `/v1/audio` is a correctness story.
 */

export interface EndpointProbe {
  present: boolean;
  status: number | "network-error";
  reason?: string;
  /** The base that actually worked — `/v1` or bare, whichever answered. */
  effectiveBaseUrl?: string;
  effectivePath?: string;
  triedUrls: string[];
}

export type StatusVerdict = "present" | "absent";

/** 404/405 mean the path isn't there; every other status means it is. */
export function classifyStatus(status: number): StatusVerdict {
  // 405 (method not allowed) on a JSON API means the path doesn't take POST,
  // which in practice means the path isn't really there either.
  return status === 404 || status === 405 ? "absent" : "present";
}

/**
 * A path no engine could plausibly implement. Used to learn what "not here"
 * looks like on this particular server.
 */
export const CANARY_PATH = "/__llmprobe_no_such_endpoint__";

export interface CatchAll {
  /** Statuses the server uses for paths that don't exist (LM Studio: 200). */
  statuses: number[];
  /**
   * One fingerprint per candidate mounting.
   *
   * A server's "unknown endpoint" reply usually echoes the path it was given,
   * so the `/v1`-mounted reply and the bare-root reply fingerprint differently.
   * We probe both, or the bare-root fallback slips through the net and the
   * endpoint gets scored as present after all.
   */
  signatures: string[];
}

/**
 * Reduce a not-found body to a path-independent fingerprint.
 *
 * LM Studio answers *every* unknown path with
 * `{"error":"Unexpected endpoint or method. (POST /v1/images/generations)"}` —
 * and an HTTP 200. Stripping the echoed path lets us recognise that same "no
 * such endpoint" reply wherever it turns up.
 */
export function bodySignature(body: string, path: string): string {
  return body
    .split(path)
    .join("<PATH>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
}

/**
 * Detect a server that answers unknown paths with anything other than 404.
 *
 * Without this, a catch-all server scores 100% coverage on endpoints it has
 * never heard of — the most damaging failure this tool could have, since
 * Coverage is the number people would quote. So we ask for an endpoint that
 * cannot exist. If the server claims it does, we remember exactly what that lie
 * looks like and measure every later probe against it, instead of trusting the
 * status code alone.
 *
 * Returns null for a well-behaved server (one that 404s), in which case plain
 * status classification is enough.
 */
export async function detectCatchAll(
  root: string,
  headers: Record<string, string>,
  timeoutMs = 5000,
): Promise<CatchAll | null> {
  const signatures: string[] = [];
  const statuses = new Set<number>();

  // Every (method, mounting) pair a real probe might use. Both axes matter:
  // LM Studio echoes the *method* as well as the path into its error body
  // ("Unexpected endpoint or method. (GET /api/tags)"), so a POST-only
  // fingerprint leaves every GET probe — the model list, Ollama's /api/tags —
  // still fooled.
  const mountings = [
    ...candidateUrls(root, CANARY_PATH),
    { baseUrl: root, path: CANARY_PATH },
  ];

  for (const method of ["POST", "GET"] as const) {
    for (const variant of mountings) {
      const url = `${variant.baseUrl}${variant.path}`;
      try {
        const response = await fetch(url, {
          method,
          headers:
            method === "POST"
              ? { "Content-Type": "application/json", ...headers }
              : headers,
          body: method === "POST" ? "{}" : undefined,
          signal: AbortSignal.timeout(timeoutMs),
        });

        // A well-behaved server 404s a path that cannot exist. Nothing to
        // defend against — plain status classification is enough.
        if (classifyStatus(response.status) === "absent") return null;

        statuses.add(response.status);
        const body = await response.text();
        signatures.push(bodySignature(body, variant.path));
      } catch {
        return null;
      }
    }
  }

  if (statuses.size === 0) return null;
  return { statuses: [...statuses], signatures: [...new Set(signatures)] };
}

/**
 * Accept `localhost:1234`, `http://host/v1`, `https://host/v1/` and friends,
 * and reduce them all to a bare host root with no `/v1` and no trailing slash.
 */
export function normalizeRoot(input: string): string {
  const withScheme = /^https?:\/\//i.test(input) ? input : `http://${input}`;
  return withScheme.replace(/\/+$/, "").replace(/\/v1$/i, "");
}

/** Candidate URLs in preference order: `/v1`-mounted first, then bare. */
export function candidateUrls(
  root: string,
  path: string,
): Array<{ baseUrl: string; path: string }> {
  return [
    { baseUrl: `${root}/v1`, path },
    { baseUrl: root, path },
  ];
}

export interface ProbeOptions {
  root: string;
  method: "GET" | "POST";
  path: string;
  headers: Record<string, string>;
  timeoutMs?: number;
  /** Mounted at the host root rather than under `/v1` (Ollama's native API). */
  fromRoot?: boolean;
  /**
   * From `detectCatchAll`. When set, a reply matching the server's known
   * "no such endpoint" response is treated as absent no matter what status it
   * carries — otherwise LM Studio's 200-for-everything would score it a perfect
   * card on endpoints it doesn't have.
   */
  catchAll?: CatchAll | null;
}

export async function probeEndpoint(
  options: ProbeOptions,
): Promise<EndpointProbe> {
  const {
    root,
    method,
    path,
    headers,
    timeoutMs = 5000,
    fromRoot,
    catchAll,
  } = options;

  const variants = fromRoot
    ? [{ baseUrl: root, path }]
    : candidateUrls(root, path);

  const triedUrls: string[] = [];
  let lastAbsent: EndpointProbe | null = null;

  for (const variant of variants) {
    const url = `${variant.baseUrl}${variant.path}`;
    triedUrls.push(url);

    try {
      const response = await fetch(url, {
        method,
        headers:
          method === "POST"
            ? { "Content-Type": "application/json", ...headers }
            : headers,
        // Empty body: the server rejects it on validation, before any inference.
        // Probing the full surface therefore costs nothing in tokens.
        body: method === "POST" ? "{}" : undefined,
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (classifyStatus(response.status) === "absent") {
        lastAbsent = {
          present: false,
          status: response.status,
          reason:
            response.status === 405
              ? "method not allowed"
              : "endpoint not found",
          triedUrls: [...triedUrls],
        };
        continue;
      }

      // The server said something other than 404 — but on a catch-all server
      // that means nothing until we check it isn't just the same "unknown
      // endpoint" boilerplate it gives for a path we invented.
      if (catchAll && catchAll.statuses.includes(response.status)) {
        const body = await response.text();
        if (catchAll.signatures.includes(bodySignature(body, variant.path))) {
          lastAbsent = {
            present: false,
            status: response.status,
            reason: `endpoint not found (server answers unknown paths with HTTP ${response.status})`,
            triedUrls: [...triedUrls],
          };
          continue;
        }
      }

      return {
        present: true,
        status: response.status,
        effectiveBaseUrl: variant.baseUrl,
        effectivePath: variant.path,
        triedUrls: [...triedUrls],
      };
    } catch (err) {
      // Unreachable host — no point trying other paths on a dead server.
      return {
        present: false,
        status: "network-error",
        reason: err instanceof Error ? err.message : String(err),
        triedUrls: [...triedUrls],
      };
    }
  }

  return (
    lastAbsent ?? {
      present: false,
      status: 404,
      reason: "endpoint not found",
      triedUrls,
    }
  );
}

export interface SurfaceProbeResult {
  surface: SurfaceDef;
  probe: EndpointProbe;
}

export async function probeSurfaces(
  root: string,
  surfaces: SurfaceDef[],
  headersFor: (surface: SurfaceDef) => Record<string, string>,
  timeoutMs?: number,
  catchAll?: CatchAll | null,
): Promise<SurfaceProbeResult[]> {
  const out: SurfaceProbeResult[] = [];

  for (const surface of surfaces) {
    out.push({
      surface,
      probe: await probeEndpoint({
        root,
        method: surface.method,
        path: surface.path,
        headers: headersFor(surface),
        timeoutMs,
        catchAll,
      }),
    });
  }

  return out;
}

export interface CreditProbeResult {
  credit: CreditDef;
  present: boolean;
}

export async function probeCredits(
  root: string,
  credits: CreditDef[],
  headers: Record<string, string>,
  timeoutMs?: number,
  catchAll?: CatchAll | null,
): Promise<CreditProbeResult[]> {
  const out: CreditProbeResult[] = [];

  for (const credit of credits) {
    const probe = await probeEndpoint({
      root,
      method: credit.method,
      path: credit.path,
      headers,
      timeoutMs,
      fromRoot: true,
      catchAll,
    });
    out.push({ credit, present: probe.present });
  }

  return out;
}
