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

export async function pickModel(
  models: string[],
  io: PickerIO,
): Promise<string> {
  io.print("Select a model:");
  models.forEach((id, i) => {
    io.print(`  ${String(i + 1).padStart(2)}. ${id}`);
  });

  for (;;) {
    const answer = await io.ask(`Model [1-${models.length}, default 1]: `);
    const choice = matchModelChoice(answer, models);
    if (choice) return choice;
    io.print(`  not a valid choice: ${answer.trim()}`);
  }
}
