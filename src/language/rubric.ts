/** Review protocol is fixed before collecting model answers. */
export const LANGUAGE_RUBRIC = {
  version: 1,
  judge:
    "Offline reviewer; record judge identity and review date with scores. No automatic grade.",
  dimensions: {
    accuracy:
      "Grammar, vocabulary, semantic fidelity and correctness of linguistic explanations.",
    naturalness:
      "Idiomatic wording, cohesion and fluency in the requested variety; avoid translationese.",
    register_style:
      "Requested formality, relationship, speaker identity, voice and genre.",
    nuance_culture:
      "Pragmatic meaning, ambiguity, politeness and contextual cultural fit; avoid unwarranted generalizations.",
    task_fulfillment:
      "All requested outputs, target language(s), constraints and meaning preserved; no invented facts.",
  },
  anchors: {
    4: "Strong: accurate and natural; fully appropriate with no material weakness.",
    3: "Good: minor localized issue; intended meaning and use remain sound.",
    2: "Mixed: noticeable errors or omissions; partly useful but needs revision.",
    1: "Weak: major errors, unnatural language or poor fit; substantial revision needed.",
    0: "Fails the dimension: absent, unintelligible, wrong-language or fundamentally misleading.",
  },
  category_focus: {
    register:
      "Meaning stays constant while interpersonal distance and address change appropriately.",
    idiom:
      "Explain pragmatic function, supply a natural example and avoid a literal-only interpretation.",
    pragmatics:
      "Offer plausible alternatives and context needed to distinguish them; no mind-reading.",
    grammar:
      "Correct the actual errors, preserve meaning, explain accurately and respect legitimate variation.",
    localization:
      "Adapt copy to local genre and tone; preserve mild urgency without fabricated offer details.",
    culture:
      "Practical context-sensitive advice, with variation acknowledged and no rigid national stereotypes.",
    creative:
      "Coherent scene, affection shown indirectly, gentle teasing and requested length/style.",
    ambiguity:
      "Distinguish meanings precisely; do not manufacture a standard reading for malformed text.",
    translation:
      "Preserve uncertainty, scope, obligation and politeness in every requested target language.",
    code_switching:
      "Interpret all languages faithfully, retain uncertainty and avoid invented context.",
  },
  protocol: [
    "Read every prompt and complete answer. Record all five integer scores and a case-specific explanation citing the answer.",
    "Hide model labels and alternate answer order during review when practicable. Identify this as one model-based reviewer, not a native-speaker panel, if applicable.",
    "Use the same anchors for both models. Do not prefer verbosity, Markdown or a particular dialect unless the prompt calls for it.",
    "Use a holistic assessment within each dimension; identify primary defects rather than repeatedly deducting for the same superficial issue.",
    "A short deviation from a word count is a minor task issue; Thai/CJK segmentation is not a reliable cross-language metric.",
    "Log finish_reason=length separately. Score only visible content; never treat HTTP errors or missing answers as evidence of language quality.",
    "Case total is sum of five dimensions / 20 * 100. Average eight cases within each language, then average the twelve language means equally (96 cases).",
    "Report the four cross-language cases separately. Do not silently reweight the overall score with those cases.",
    "Compare paired cases and report wins/ties/losses, dimension means, per-language means, truncations and failures.",
    "A run is incomplete if any required answer is missing. Do not declare an overall winner on incomplete runs.",
    "This is an original, small diagnostic suite with one generation per prompt. It does not isolate quantization effects or establish a universal model ranking.",
  ],
};
