import { configDefaults, defineConfig } from "vitest/config";

// server/ is a standalone package with its own suite and its own deps.
export default defineConfig({
  test: { exclude: [...configDefaults.exclude, "server/**"] },
});
