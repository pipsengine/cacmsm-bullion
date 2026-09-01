import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTypeScript,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": ["warn", { "argsIgnorePattern": "^_", "varsIgnorePattern": "^_" }],
      "react-hooks/refs": "off",
      "react-hooks/set-state-in-effect": "off",
      "@next/next/no-html-link-for-pages": "off",
    },
  },
  globalIgnores([".next/**", "next-env.d.ts"]),
]);
