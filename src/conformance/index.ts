import type { SurfaceAdapter } from "../core/adapter";
import type { ConformanceTest } from "../core/context";
import { chatAdapter } from "../surfaces/chat/adapter";
import { messagesAdapter } from "../surfaces/messages/adapter";
import { responsesAdapter } from "../surfaces/responses/adapter";
import { sharedTests } from "./shared";
import {
  audioTests,
  chatOnlyTests,
  completionsTests,
  embeddingsTests,
  imagesTests,
  messagesOnlyTests,
  modelsTests,
  responsesOnlyTests,
} from "./surfaces";

export const ADAPTERS: SurfaceAdapter[] = [
  chatAdapter,
  responsesAdapter,
  messagesAdapter,
];

/**
 * The chat-shaped surface the cross-cutting features are credited through, and
 * the one the model evals run against.
 *
 * Features like "tool calling" are properties of the *engine*, not of any one
 * surface, so they must be creditable through whichever door the engine happens
 * to open. Preferring chat/completions keeps scores comparable across engines;
 * an engine that ships only Responses still gets full credit for tools.
 */
export function primarySurface(present: Set<string>): string | null {
  for (const id of ["chat", "responses", "messages"]) {
    if (present.has(id)) return id;
  }
  return null;
}

export function buildConformanceTests(present: Set<string>): ConformanceTest[] {
  const primary = primarySurface(present);

  return [
    ...modelsTests,
    // Shared tests run against every chat-shaped surface the engine implements,
    // but only the primary one claims the cross-cutting features — otherwise a
    // three-surface engine would be scored for "tools" three times.
    ...ADAPTERS.flatMap((adapter) =>
      sharedTests(adapter, adapter.id === primary),
    ),
    ...chatOnlyTests,
    ...responsesOnlyTests,
    ...messagesOnlyTests,
    ...embeddingsTests,
    ...completionsTests,
    ...imagesTests,
    ...audioTests,
  ];
}
