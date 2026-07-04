import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";
import { dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const eslintConfig = [...nextCoreWebVitals, ...nextTypescript, {
  rules: {
    // TypeScript rules
    // no-explicit-any is a real gate. Production code is currently any-free
    // (generated Prisma client under src/generated is ignored below); any
    // future `any` for a genuine external/dynamic seam must carry an inline
    // disable directive with a documented reason.
    "@typescript-eslint/no-explicit-any": "error",
    // Base no-unused-vars is off in favour of the TS-aware version below.
    "@typescript-eslint/no-unused-vars": ["error", {
      argsIgnorePattern: "^_",
      varsIgnorePattern: "^_",
      caughtErrorsIgnorePattern: "^_",
      ignoreRestSiblings: true,
    }],
    "@typescript-eslint/no-non-null-assertion": "off",
    "@typescript-eslint/ban-ts-comment": "off",
    "@typescript-eslint/prefer-as-const": "off",
    "@typescript-eslint/no-unused-disable-directive": "off",

    // React rules
    // exhaustive-deps kept as WARN, not error: turning it to error would demand
    // editing effect dependency arrays, which can change runtime behavior. Left
    // as warn so violations are visible without gating on risky changes.
    "react-hooks/exhaustive-deps": "warn",
    "react-hooks/purity": "off",
    "react/no-unescaped-entities": "off",
    "react/display-name": "off",
    "react/prop-types": "off",
    "react-compiler/react-compiler": "off",

    // Next.js rules
    "@next/next/no-img-element": "off",
    "@next/next/no-html-link-for-pages": "off",

    // General JavaScript rules — high-value correctness rules re-enabled.
    "prefer-const": "error",
    // Base no-unused-vars off (TS-aware @typescript-eslint version handles it).
    "no-unused-vars": "off",
    "no-console": "off",
    "no-debugger": "off",
    "no-empty": ["error", { allowEmptyCatch: true }],
    "no-irregular-whitespace": "off",
    "no-case-declarations": "off",
    "no-fallthrough": "error",
    "no-mixed-spaces-and-tabs": "off",
    "no-redeclare": "off",
    // no-undef is disabled for TS: TypeScript's own checker handles undefined
    // identifiers, and the base rule produces false positives on type-only and
    // ambient/global references it cannot see. See typescript-eslint guidance.
    "no-undef": "off",
    "no-unreachable": "error",
    "no-useless-escape": "off",
  },
}, {
  // Test files legitimately use `any` for mock signatures / dynamic fixtures.
  // The no-explicit-any gate targets production code; enforcing it across the
  // test suite would balloon this story's scope without runtime benefit.
  files: ["**/__tests__/**", "**/*.test.ts", "**/*.test.tsx"],
  rules: {
    "@typescript-eslint/no-explicit-any": "off",
  },
}, {
  ignores: ["node_modules/**", ".next/**", "out/**", "build/**", "next-env.d.ts", "examples/**", "skills", "src/generated/**"]
}];

export default eslintConfig;
