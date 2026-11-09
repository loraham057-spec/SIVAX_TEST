import { FlatCompat } from "@eslint/eslintrc";

const compat = new FlatCompat({
  baseDirectory: import.meta.dirname,
});

const config = [
  {
    ignores: [
      ".next/**",
      "node_modules/**",
      "backend/**",
      // Scripts CommonJS qui génèrent les livrables .docx — pas du code
      // applicatif, et `require()` y est légitime.
      "livrables/**",
      "next-env.d.ts",
      "supabase/*.js",
      "livrables/**",
    ],
  },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    rules: {
      "react/no-unescaped-entities": "off",
    },
  },
  {
    files: ["tailwind.config.ts"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
];

export default config;
