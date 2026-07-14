import type { ToolDef } from "../core/adapter";

/** A 1x1 PNG. Vision *conformance* asks "did you accept image parts and answer",
 * not "did you see the picture" — that would be a model question, and this
 * suite keeps those axes apart. */
export const TINY_PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

export const WEATHER_TOOL: ToolDef = {
  name: "get_weather",
  description: "Get the current weather for a city.",
  parameters: {
    type: "object",
    properties: {
      city: { type: "string", description: "City name, e.g. Paris" },
      unit: { type: "string", enum: ["celsius", "fahrenheit"] },
    },
    required: ["city"],
    additionalProperties: false,
  },
};

export const TIME_TOOL: ToolDef = {
  name: "get_time",
  description: "Get the current local time in a city.",
  parameters: {
    type: "object",
    properties: { city: { type: "string" } },
    required: ["city"],
    additionalProperties: false,
  },
};

/** Typed args, so we can check the engine round-trips numbers and booleans. */
export const BOOKING_TOOL: ToolDef = {
  name: "book_table",
  description: "Book a restaurant table.",
  parameters: {
    type: "object",
    properties: {
      restaurant: { type: "string" },
      party_size: { type: "integer" },
      outdoor: { type: "boolean" },
    },
    required: ["restaurant", "party_size", "outdoor"],
    additionalProperties: false,
  },
};

export const PERSON_SCHEMA = {
  type: "object",
  properties: {
    name: { type: "string" },
    age: { type: "integer" },
  },
  required: ["name", "age"],
  additionalProperties: false,
} as const;
