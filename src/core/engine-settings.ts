/** Serving settings as the engine reports them (mlx-serve `/props` `settings`). Opaque beyond the summary. */
export type EngineSettings = Record<string, unknown>;

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Best-effort: an older build, another engine or a catch-all reply all mean
 * "no settings", never an error.
 */
export async function fetchEngineSettings(
  root: string,
  model: string,
  headers: Record<string, string>,
): Promise<EngineSettings | undefined> {
  try {
    const res = await fetch(
      `${root}/props?model=${encodeURIComponent(model)}`,
      { headers, signal: AbortSignal.timeout(2000) },
    );
    if (!res.ok) return undefined;
    const props: unknown = await res.json();
    if (!isObject(props) || !isObject(props.settings)) return undefined;
    const ctx = isObject(props.default_generation_settings)
      ? props.default_generation_settings.n_ctx
      : undefined;
    const maxCtx = isObject(props.model_info)
      ? props.model_info.max_position_embeddings
      : undefined;
    const ane = isObject(props.ane) ? props.ane.mode : undefined;
    return {
      ...props.settings,
      ...(typeof ctx === "number" ? { ctx } : {}),
      ...(typeof maxCtx === "number" ? { model_max_ctx: maxCtx } : {}),
      ...(typeof ane === "string" ? { ane } : {}),
    };
  } catch {
    return undefined;
  }
}

const fmtCtx = (n: number): string =>
  n >= 1024 ? `${Math.round(n / 1024)}k` : String(n);

/**
 * `--label` when none was given: only what differs from mlx-serve's defaults,
 * so two runs of one model read apart. Hard-coded defaults go stale if the
 * server changes one.
 */
export function autoLabel(s: EngineSettings | undefined): string | undefined {
  if (!s) return undefined;
  const mtp = isObject(s.mtp) ? s.mtp : {};
  const pld = isObject(s.pld) ? s.pld : {};
  const kv = s.kv_quant;
  const ctx = typeof s.ctx === "number" ? s.ctx : 0;
  const maxCtx = typeof s.model_max_ctx === "number" ? s.model_max_ctx : 0;
  const parts = [
    kv && kv !== "off" ? (s.engine === "llama" ? `kv-${kv}` : `kv${kv}`) : null,
    s.kv_attn_mode && s.kv_attn_mode !== "auto" ? `kv-${s.kv_attn_mode}` : null,
    ctx > 0 && maxCtx > 0 && ctx < maxCtx ? `ctx${fmtCtx(ctx)}` : null,
    !mtp.loaded
      ? null
      : !mtp.default_on
        ? "mtp-off"
        : mtp.acceptance && mtp.acceptance !== "exact"
          ? ["mtp", mtp.acceptance, mtp.acceptance_param]
              .filter((v) => v != null)
              .join("-")
          : null,
    s.drafter && s.drafter !== "none" ? String(s.drafter) : null,
    pld.default_on === false ? "no-pld" : null,
    s.decode_attn_quant === false ? "no-attn-quant" : null,
    typeof s.prefill_chunk === "number" && s.prefill_chunk !== 8192
      ? `chunk${s.prefill_chunk}`
      : null,
    s.ane ? `ane-${s.ane}` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" ") : "default";
}

/** `kv8 · ctx 32k · MTP tokenv3 0.95 · ANE channel`: what separates two runs of one model. */
export function engineSettingsSummary(s: EngineSettings | undefined): string {
  if (!s) return "";
  const mtp = isObject(s.mtp) ? s.mtp : {};
  const pld = isObject(s.pld) ? s.pld : {};
  const ctx = typeof s.ctx === "number" && s.ctx > 0 ? s.ctx : 0;
  return [
    s.kv_quant === "off" ? "kv bf16" : s.kv_quant ? `kv${s.kv_quant}` : null,
    ctx ? `ctx ${fmtCtx(ctx)}` : null,
    mtp.loaded
      ? mtp.default_on
        ? ["MTP", mtp.acceptance, mtp.acceptance_param]
            .filter((v) => v != null)
            .join(" ")
        : "MTP off"
      : null,
    s.drafter && s.drafter !== "none" ? `drafter ${s.drafter}` : null,
    pld.default_on ? "PLD" : null,
    s.decode_attn_quant ? "attn-quant" : null,
    s.ane ? `ANE ${s.ane}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}
