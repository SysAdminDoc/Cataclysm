import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";

export default tseslint.config(
  { ignores: ["dist/", "src-tauri/", "public/"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["scripts/**/*.{js,mjs,cjs}"],
    languageOptions: {
      // Browser automation scripts execute page callbacks in a DOM realm but
      // remain Node entry points outside those callbacks.
      globals: { ...globals.node, ...globals.browser },
    },
  },
  {
    files: ["*.config.{js,mjs,cjs,ts}"],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    files: ["tests/**/*.ts"],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "no-console": "off",
    },
  },
  {
    files: ["tests/**/*.ts", "scripts/**/*.{js,mjs,cjs}", "*.config.{js,mjs,cjs,ts}"],
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "no-console": "off",
    },
  },
);
