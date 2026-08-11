// Interactive model selection for when no --model is given. The CLI only
// invokes this on a TTY; piped/quiet runs keep the old first-model fallback
// so CI never blocks on a prompt.

export interface PickerIO {
  ask: (question: string) => Promise<string>;
  print: (line: string) => void;
}

/**
 * Resolve one line of user input against the model list. Accepts a 1-based
 * index, an exact model id, or an empty line for the default (first) model.
 * Returns null when the input matches nothing, so the caller can re-prompt.
 */
export function matchModelChoice(
  input: string,
  models: string[],
): string | null {
  if (models.length === 0) return null;

  const trimmed = input.trim();
  if (trimmed === "") return models[0]!;

  if (/^\d+$/.test(trimmed)) {
    const index = Number(trimmed);
    return index >= 1 && index <= models.length ? models[index - 1]! : null;
  }

  return models.find((id) => id === trimmed) ?? null;
}

/**
 * Same, but for a comma-separated line: "1,3,7" means run each of those, in
 * that order. One unmatched entry rejects the whole line — quietly dropping it
 * would start a long multi-model run that silently skips a model you asked for.
 */
export function matchModelChoices(
  input: string,
  models: string[],
): string[] | null {
  if (models.length === 0) return null;
  if (!input.includes(",")) {
    const one = matchModelChoice(input, models);
    return one ? [one] : null;
  }

  const parts = input
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p !== "");
  if (parts.length === 0) return null;

  const picked: string[] = [];
  for (const part of parts) {
    const match = matchModelChoice(part, models);
    if (!match) return null;
    // Probing the same model twice writes one card and one library row, so the
    // second run would only overwrite the first.
    if (!picked.includes(match)) picked.push(match);
  }
  return picked;
}

/**
 * Prompt until the answer resolves. A comma-separated line ("1,3,5") picks
 * several models and the caller runs each in turn.
 */
export async function pickModels(
  models: string[],
  io: PickerIO,
): Promise<string[]> {
  io.print("Select a model:");
  models.forEach((id, i) => {
    io.print(`  ${String(i + 1).padStart(2)}. ${id}`);
  });
  io.print(
    "  several at once: comma-separated, e.g. 1,3,4 — each runs in turn",
  );

  for (;;) {
    const answer = await io.ask(
      `Model [1-${models.length}, comma-separated, default 1]: `,
    );
    const choice = matchModelChoices(answer, models);
    if (choice) return choice;
    io.print(`  not a valid choice: ${answer.trim()}`);
  }
}
