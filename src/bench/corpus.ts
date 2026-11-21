/**
 * A synthetic TypeScript codebase, used as the context the ladder measures over.
 *
 * The ladder used to fill its prompts with one sentence repeated to size, and
 * that quietly broke the measurement: summarising a few thousand copies of
 * "The quick brown fox" is *highly* predictable output, so the rung baseline
 * was already collecting a speculation boost. Runs came back with more context
 * decoding faster than none — 53.8 tok/s at the 512 rung against 44.1 with no
 * context at all — which is not a thing that happens to a real engine.
 *
 * So the filler is source code: varied identifiers, imports, types, comments,
 * the attention pattern of an actual agent's context window rather than of one
 * sentence stamped out N times. Deterministic, so a rung is reproducible and
 * the byte-to-token fit stays stable across runs.
 */

const DOMAINS = [
  "order",
  "invoice",
  "shipment",
  "ledger",
  "session",
  "device",
  "channel",
  "tariff",
  "manifest",
  "quota",
];

const VERBS = [
  "resolve",
  "normalise",
  "validate",
  "reconcile",
  "expand",
  "prune",
  "merge",
  "index",
];

const capitalise = (s: string): string => s[0]!.toUpperCase() + s.slice(1);

const article = (word: string): string => (/^[aeiou]/i.test(word) ? "an" : "a");

/**
 * Four shapes in rotation. One template repeated would drift back towards the
 * degenerate filler this replaced — what matters is that the model cannot
 * predict the next module from the last one.
 */
function module(i: number): string {
  const domain = DOMAINS[i % DOMAINS.length]!;
  const verb = VERBS[Math.floor(i / DOMAINS.length) % VERBS.length]!;
  const Name = capitalise(domain);
  const fn = `${verb}${Name}`;

  switch (i % 4) {
    case 0:
      return `// src/${domain}/${verb}.ts
import { Clock } from "../runtime/clock";
import type { ${Name}Record } from "./types";

/** ${capitalise(verb)} ${article(domain)} ${domain} against the ledger, dropping expired entries. */
export function ${fn}(input: ${Name}Record, clock: Clock): ${Name}Record | null {
  const cutoff = clock.now() - input.windowMs;
  if (input.updatedAt < cutoff) return null;
  return { ...input, ${verb}dAt: clock.now(), revision: input.revision + 1 };
}

`;
    case 1:
      return `// src/${domain}/types.ts
export interface ${Name}Record {
  id: string;
  revision: number;
  updatedAt: number;
  windowMs: number;
  tags: readonly string[];
}

export const EMPTY_${domain.toUpperCase()}: ${Name}Record = {
  id: "",
  revision: 0,
  updatedAt: 0,
  windowMs: ${1000 + i * 7},
  tags: [],
};

`;
    case 2:
      return `// src/${domain}/${verb}-batch.ts
import { ${fn} } from "./${verb}";
import type { ${Name}Record } from "./types";

/**
 * Batch form of \`${fn}\`. Returns only the records that survived, so callers
 * can compare lengths rather than scanning for nulls.
 */
export async function ${fn}Batch(
  records: readonly ${Name}Record[],
  concurrency = ${2 + (i % 6)},
): Promise<${Name}Record[]> {
  const out: ${Name}Record[] = [];
  for (let i = 0; i < records.length; i += concurrency) {
    const slice = records.slice(i, i + concurrency);
    out.push(...slice.filter((r) => r.revision >= 0));
  }
  return out;
}

`;
    default:
      return `// src/${domain}/${verb}.test.ts
import { describe, expect, test } from "vitest";
import { ${fn} } from "./${verb}";

describe("${fn}", () => {
  test("drops a record older than its window", () => {
    const clock = { now: () => ${10_000 + i * 13} };
    const stale = { id: "${domain}-${i}", revision: 1, updatedAt: 0, windowMs: 5, tags: [] };
    expect(${fn}(stale, clock)).toBeNull();
  });
});

`;
  }
}

/** Deterministic TypeScript source of approximately `bytes` bytes. */
export function buildCodeContext(bytes: number): string {
  if (bytes <= 0) return "";
  const out: string[] = [];
  let length = 0;
  for (let i = 0; length < bytes; i += 1) {
    const piece = module(i);
    out.push(piece);
    length += piece.length;
  }
  return out.join("").slice(0, bytes);
}

/**
 * The constant the rung's task has to go and find. Planted as a real-looking
 * config module rather than as a prose notice, so reaching it is the same work
 * an agent does: locate a value in the codebase and use it in what it writes.
 */
export const PLANTED_CONSTANT = "RETRY_BUDGET_MS";
export const PLANTED_VALUE = 7413;

const PLANTED_MODULE = `// src/config/retry-budget.ts
/** Total wall clock a retry loop may spend before giving up. */
export const ${PLANTED_CONSTANT} = ${PLANTED_VALUE};

`;

/** `bytes` of source with the config module buried in the middle of it. */
export function buildCodeContextWithConstant(bytes: number): string {
  const filler = buildCodeContext(bytes);
  const half = Math.floor(filler.length / 2);
  // Split on a *module* boundary — the blank line between files. A bare
  // newline lands inside a JSDoc block often enough that the constant ends up
  // commented out, which is not something the model can then use.
  const gap = filler.indexOf("\n\n", half);
  const cut = gap === -1 ? filler.length : gap + 2;
  return `${filler.slice(0, cut)}${PLANTED_MODULE}${filler.slice(cut)}`;
}

/** Did the answer actually use the value it had to go and find? */
export function usedPlantedConstant(text: string): boolean {
  return (
    text.includes(PLANTED_CONSTANT) || text.includes(String(PLANTED_VALUE))
  );
}

/** A coherent passage the model can echo verbatim — high draft acceptance. */
export const PREDICTABLE_PASSAGE =
  "The old lighthouse stood at the edge of the rocky cliff, its white paint " +
  "weathered by decades of salt and wind. Every evening the keeper climbed the " +
  "spiral stairs, lit the great lamp, and watched its beam sweep slowly across " +
  "the dark water, guiding the fishing boats safely home through the fog. " +
  "In winter the storms came in from the north, and the waves broke against " +
  "the rocks below with a sound like distant thunder. The keeper kept a log " +
  "of every ship that passed, noting the date, the hour, and the weather, and " +
  "on quiet nights he read the old entries by the light of a single candle. " +
  "His father had kept the lighthouse before him, and his grandfather before " +
  "that, and the same brass key had opened the same iron door for nearly a " +
  "hundred years. When the supply boat came each month it brought oil for the " +
  "lamp, flour and salt for the kitchen, and letters from the mainland that " +
  "he answered slowly over the following weeks. He knew the tides the way " +
  "other men knew the streets of their town, and he could tell from the " +
  "colour of the morning sky whether the boats would go out that day. The " +
  "village below trusted the light, and the light had never once failed.";

/**
 * Did the model echo, or refuse? A refusal is novel text, so timing it reads
 * as "no speculation" — it has to be dropped, and visibly.
 */
export function echoedPassage(text: string): boolean {
  const opening = PREDICTABLE_PASSAGE.split(" ").slice(0, 6).join(" ");
  return text
    .trimStart()
    .replace(/^["'“”*_]+/, "")
    .startsWith(opening);
}

/**
 * Everyday words for `buildUnseenText`. Real words, so the tokens are the ones
 * ordinary prompts are made of; drawn at random, so their order is new.
 */
const WORDS = `
time year people way day man thing woman life child world school state family
student group country problem hand part place case week company system program
question work government number night point home water room mother area money
story fact month lot right study book eye job word business issue side kind
head house service friend father power hour game line end member law car city
community name president team minute idea kid body information back parent
face others level office door health person art war history party result
change morning reason research girl guy moment air teacher force education
foot boy age policy music market sense nation plan college interest death
experience effect class control field development role effort rate heart drug
show leader light voice wife police mind price report decision son view
relationship town road arm difference value building action season society tax
director position player record paper space ground form event official matter
center couple site project activity star table need court oil situation cost
industry figure street image phone data picture practice piece land product
doctor wall patient worker news test movie north love step window film
republic tree source organization hair look century evidence culture billion
chance brother energy period course summer plant opportunity term letter
condition choice rule daughter south husband floor campaign material
population economy hospital church risk fire future defense security bank west
sport board subject officer rest behavior performance top goal second bed
order author blood agency nature color store sound movement page race concern
series language response dog animal factor decade article east artist scene
stock career treatment approach size truth sea fund thought list individual
quality pressure answer resource meeting disease success cup amount ability
staff character growth loss degree attack region television box training trade
deal election feeling standard bill message analysis benefit sex forest bridge
river mountain valley island garden kitchen engine signal copper silver marble
velvet ribbon lantern harbor anchor compass ledger orchard meadow canyon
glacier thunder shadow whisper candle feather pocket basket button cabin
castle carpet ceiling chimney closet corner cottage curtain drawer fence gate
hallway ladder mirror pillow shelf stair tunnel attic barn cellar porch roof
tower village bakery library museum station theater temple be have do say get
make go know take see come think want give use find tell ask seem feel try
leave call keep let begin help talk turn start hear play run move like live
believe hold bring happen write provide sit stand lose pay meet include
continue set learn lead understand watch follow stop create speak read allow
add spend grow open walk win offer remember consider appear buy wait serve die
send expect build stay fall cut reach kill remain suggest raise pass sell
require decide pull return explain hope develop carry break receive agree
support hit produce eat cover catch draw choose cause listen realize close
involve increase arrive borrow carve deliver gather measure polish repair
scatter stretch travel wander weave whistle bounce climb drift fold glide
hover juggle kneel launch mend nudge paddle quiver rinse shiver tumble unfold
vanish wobble yawn good new first last long great little own other old big
high different small large next early young important few public bad same able
free sure real full special easy clear recent certain personal red difficult
available likely short single medical current wrong private past foreign fine
common poor natural significant similar hot dead central happy serious ready
simple left physical general environmental financial blue democratic dark
various entire legal religious cold final main green nice huge popular
traditional cultural quiet bright gentle hollow narrow proud rough silent
steady tender uneven vivid warm weary amber crimson golden ivory scarlet
violet ancient brittle curious distant eager fragile humble jagged keen lively
modest nimble opaque placid rapid sturdy timid urgent vast wooden yellow
zealous brisk clumsy dusty earnest faint grim hasty idle up so out just now
how then more also here well only very even there down still in as too when
never really most why about over again always sometimes often together already
almost enough perhaps quite rather soon today yesterday tomorrow slowly
quickly quietly loudly gently barely nearly suddenly finally clearly simply
exactly the of and a to is you that it he was for on are with his they at this
from or one had by but not what all were we can your an each which she their
if will many them these some her would him into has two could no than been its
who my made did after words called where apple bread butter cheese coffee
honey lemon noodle olive pepper potato salad sugar tomato walnut biscuit
cabbage carrot cherry garlic ginger mango melon onion peach pumpkin raisin
spinach turnip vanilla almond barley celery eagle falcon heron sparrow turtle
beetle cricket dolphin ferret gopher hornet jaguar lizard magpie otter panda
rabbit salmon spider walrus badger camel donkey gecko hamster iguana koala
lobster mantis newt osprey parrot hammer chisel wrench pliers shovel bucket
needle thread scissor ruler pencil crayon marker stapler folder binder violin
trumpet guitar piano flute cello drum banjo harp organ clarinet oboe tuba
cymbal fiddle chorus melody January Monday Tuesday April Friday August Sunday
October Paris Cairo Lima Oslo Tokyo Delhi Lagos Quito Dublin Vienna seven
twelve thirty ninety hundred thousand dozen double triple quarter half zero
eleven fifteen forty sixty eighty
`
  .trim()
  .split(/\s+/);

/**
 * Text no earlier request carried: `seed` names one word sequence, and two
 * seeds share nothing longer than a stray pair of words. The other fillers are
 * the same bytes every run, which is what an engine that looks rows up by
 * content, pages weights in on demand or keys a cache on the prompt has warm.
 */
export function buildUnseenText(seed: string, bytes: number): string {
  // FNV-1a of the seed, stepped by mulberry32.
  let state = 2166136261;
  for (let i = 0; i < seed.length; i += 1)
    state = Math.imul(state ^ seed.charCodeAt(i), 16777619);
  const next = (): number => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const out: string[] = [];
  for (let len = 0; len <= bytes; ) {
    const word = WORDS[Math.floor(next() * WORDS.length)]!;
    out.push(word);
    len += word.length + 1;
  }
  return out.join(" ").slice(0, bytes);
}
