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

export function detectEngine(serverHeader: string | null): string | undefined {
  if (!serverHeader) return undefined;
  const s = serverHeader.toLowerCase();

  for (const [re, name] of KNOWN) if (re.test(s)) return name;

  // A named-but-unrecognized server is still worth showing, but a bare web
  // framework banner is noise.
  if (GENERIC.test(s)) return undefined;

  return serverHeader.split(/[/\s]/)[0] || undefined;
}
