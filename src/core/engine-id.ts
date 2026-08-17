/**
 * Best-effort engine identity for the report header. Purely cosmetic — it never
 * affects any score.
 *
 * The only trustworthy signal is the `Server` HTTP header, and even that is used
 * only when it names a recognizable engine: a generic `uvicorn`/`Werkzeug`
 * banner tells us nothing, so we say nothing rather than guess.
 *
 * We deliberately do NOT infer identity from which endpoints exist. Serving the
 * Ollama-compatible `/api/chat` shim is common — mlx-serve, LM Studio and
 * llama.cpp all do it — and does not make an engine Ollama. An earlier version
 * guessed exactly that and mislabelled mlx-serve as "Ollama".
 */

const KNOWN: Array<[RegExp, string]> = [
  [/llama\.?cpp/, "llama.cpp"],
  [/mlx[-_ ]?serve/, "mlx-serve"],
  [/lm[-_ ]?studio/, "LM Studio"],
  [/\bollama\b/, "Ollama"],
  [/vllm/, "vLLM"],
  [/text-generation-inference|\btgi\b/, "TGI"],
  [/openrouter/, "OpenRouter"],
];

/** Generic web-framework banners that identify the stack, not the engine. */
const GENERIC = /uvicorn|werkzeug|gunicorn|nginx|caddy|cloudflare|express/;

/**
 * Engines that stamp their own name into `/v1/models` `owned_by`. Second tier:
 * MTPLX and oMLX both front with uvicorn and default to port 8000, so the
 * header alone can't tell them apart. Only exact known names count — the field
 * is usually filler ("library", "organization", "openai") and filler must not
 * become an engine name.
 */
const OWNED_BY: Record<string, string> = {
  mtplx: "MTPLX",
  omlx: "oMLX",
  "mlx-serve": "mlx-serve",
  vllm: "vLLM",
};

export function detectEngine(
  serverHeader: string | null,
  ownedBy?: string | null,
): string | undefined {
  if (serverHeader) {
    const s = serverHeader.toLowerCase();

    for (const [re, name] of KNOWN) if (re.test(s)) return name;

    // A named-but-unrecognized server is still worth showing, but a bare web
    // framework banner is noise — fall through to owned_by instead.
    if (!GENERIC.test(s)) {
      const named = serverHeader.split(/[/\s]/)[0];
      if (named) return named;
    }
  }

  if (ownedBy) return OWNED_BY[ownedBy.toLowerCase().trim()];
  return undefined;
}
