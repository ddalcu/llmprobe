import { fetch as undiciFetch } from "undici";
import type { JsonReport } from "./report/json";

const DEFAULT_URL = "https://llmprobe.deploy.dalcu.com";

export interface UploadPayload {
  key: string;
  data: JsonReport;
}

export function resolveUploadUrl(
  flag: string | undefined,
  env: string | undefined,
): string {
  return (flag || env || DEFAULT_URL).replace(/\/+$/, "");
}

/**
 * Timings are the point of the archive, so a run with no benchmark is not
 * uploadable — it would sit next to real numbers with holes where they go.
 */
export function uploadPayload(json: JsonReport): UploadPayload {
  if (!json.bench) {
    throw new Error(
      "nothing to upload: this run has no benchmark (--no-bench, --eval-only or an interrupted run)",
    );
  }
  const key = [
    json.target.engine ?? "unknown",
    json.target.model,
    json.target.baseUrl,
    json.run?.startedAt ?? "",
  ].join("|");
  return { key, data: json };
}

export async function uploadReport(
  json: JsonReport,
  opts: { url: string; token?: string },
): Promise<string> {
  const payload = uploadPayload(json);
  const res = await undiciFetch(`${opts.url}/api/runs`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(`upload failed: ${res.status} ${await res.text()}`);
  }
  return payload.key;
}
