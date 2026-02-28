import { review as codexReview } from "./codex.mjs";
import { review as geminiReview } from "./gemini.mjs";

const adapters = {
  codex: { review: codexReview },
  gemini: { review: geminiReview },
};

export function getAdapter(name) {
  const adapter = adapters[name];
  if (!adapter) {
    throw new Error(`Unknown adapter: ${name}`);
  }
  return adapter;
}
