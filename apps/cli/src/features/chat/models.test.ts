import { describe, expect, test } from "bun:test";

import { resolveActiveModel } from "./models";
import type { ModelOption } from "./types";

function model(id: string, configured: boolean): ModelOption {
  return {
    id,
    name: id,
    provider: id.split("/")[0] ?? id,
    providerLabel: id.split("/")[0] ?? id,
    description: "",
    capabilities: [],
    tier: "balanced",
    recommended: false,
    free: false,
    local: false,
    supportsTools: true,
    supportsReasoning: false,
    configured,
  };
}

const catalog = [
  model("google/gemini-3.1-flash-lite", true),
  model("anthropic/claude-sonnet-5-5", false),
  model("openai/gpt-5", true),
];

describe("resolveActiveModel", () => {
  test("keeps a saved model the server can run", () => {
    expect(
      resolveActiveModel(
        "google/gemini-3.1-flash-lite",
        catalog,
        "anthropic/claude-sonnet-5-5",
      ),
    ).toBe("google/gemini-3.1-flash-lite");
  });

  test("falls back when the saved model's provider key is gone", () => {
    expect(
      resolveActiveModel(
        "anthropic/claude-sonnet-5-5",
        catalog,
        "anthropic/claude-sonnet-5-5",
      ),
    ).toBe("google/gemini-3.1-flash-lite");
  });

  test("falls back when the saved model is unknown", () => {
    expect(
      resolveActiveModel(
        "google/gemini-9-ultra",
        catalog,
        "anthropic/claude-sonnet-5-5",
      ),
    ).toBe("google/gemini-3.1-flash-lite");
  });

  test("uses the server default when nothing is saved", () => {
    expect(resolveActiveModel(undefined, catalog, "openai/gpt-5")).toBe(
      "openai/gpt-5",
    );
  });

  test("skips a default that is not configured", () => {
    expect(
      resolveActiveModel(undefined, catalog, "anthropic/claude-sonnet-5-5"),
    ).toBe("google/gemini-3.1-flash-lite");
  });

  test("keeps the default id when no model is configured", () => {
    const unconfigured = [model("anthropic/claude-sonnet-5-5", false)];
    expect(
      resolveActiveModel(
        "anthropic/claude-sonnet-5-5",
        unconfigured,
        "anthropic/claude-sonnet-5-5",
      ),
    ).toBe("anthropic/claude-sonnet-5-5");
  });

  test("keeps the saved value while the catalog is unknown", () => {
    expect(
      resolveActiveModel("google/gemini-3.1-flash-lite", [], "openai/gpt-5"),
    ).toBe("google/gemini-3.1-flash-lite");
  });
});
