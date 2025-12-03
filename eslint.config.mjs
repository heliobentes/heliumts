import tsPlugin from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import importPlugin from 'eslint-plugin-import';
import prettierPlugin from 'eslint-plugin-prettier';
import simpleImportSort from 'eslint-plugin-simple-import-sort';
import unusedImports from 'eslint-plugin-unused-imports';
import path from 'path';
import { fileURLToPath } from 'url';

export default [
    {
        ignores: ["node_modules/**", "dist/**", "build/**", "*.log"],
    },
    {
        files: ["src/**/*.{ts,tsx,js}"],
        languageOptions: {
            parser: tsParser,
            parserOptions: {
                project: "./tsconfig.json",
                tsconfigRootDir: path.dirname(fileURLToPath(import.meta.url)),
                ecmaVersion: 2020,
                sourceType: "module",
            },
            globals: { window: "readonly", process: "readonly" },
        },
        plugins: {
            "@typescript-eslint": tsPlugin,
            prettier: prettierPlugin,
            import: importPlugin,
            "unused-imports": unusedImports,
            "simple-import-sort": simpleImportSort,
        },
        rules: {
            "prettier/prettier": "error",
            "no-unused-vars": "off",
            "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
            "@typescript-eslint/no-explicit-any": "off",
            "@typescript-eslint/explicit-module-boundary-types": "off",
            "simple-import-sort/imports": "error",
            "simple-import-sort/exports": "error",
            "import/first": "error",
            "import/no-duplicates": "error",
            "import/newline-after-import": "error",
            "import/no-duplicates": "error",
            "unused-imports/no-unused-imports": "error",
            "max-len": [
                "error",
                {
                    code: 180,
                    tabWidth: 4,
                    ignoreUrls: true,
                    ignoreStrings: true,
                    ignoreTemplateLiterals: true,
                    ignoreRegExpLiterals: true,
                    ignoreComments: false,
                },
            ],
            curly: ["error", "all"],
        },
    },
    {
        files: ["tests/**/*.{ts,tsx,js}"],
        languageOptions: {
            parser: tsParser,
            parserOptions: {
                project: "./tsconfig.test.json",
                tsconfigRootDir: path.dirname(fileURLToPath(import.meta.url)),
                ecmaVersion: 2020,
                sourceType: "module",
            },
            globals: { window: "readonly", process: "readonly" },
        },
        plugins: {
            "@typescript-eslint": tsPlugin,
            prettier: prettierPlugin,
            import: importPlugin,
            "unused-imports": unusedImports,
            "simple-import-sort": simpleImportSort,
        },
        rules: {
            "prettier/prettier": "error",
            "no-unused-vars": "off",
            "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
            "@typescript-eslint/no-explicit-any": "off",
            "@typescript-eslint/explicit-module-boundary-types": "off",
            "simple-import-sort/imports": "error",
            "simple-import-sort/exports": "error",
            "import/first": "error",
            "import/no-duplicates": "error",
            "import/newline-after-import": "error",
            "import/no-duplicates": "error",
            "unused-imports/no-unused-imports": "error",
            "max-len": [
                "error",
                {
                    code: 180,
                    tabWidth: 4,
                    ignoreUrls: true,
                    ignoreStrings: true,
                    ignoreTemplateLiterals: true,
                    ignoreRegExpLiterals: true,
                    ignoreComments: false,
                },
            ],
            curly: ["error", "all"],
        },
    },
];
