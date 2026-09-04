import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import jupyterPlugin from '@jupyter/eslint-plugin';
import globals from 'globals';

export default defineConfig([
  {
    ignores: [
      'node_modules/**',
      '**/node_modules/**',
      'lib/**',
      'dist/**',
      'coverage/**',
      'docs/**',
      'jupyterlab_pyflyby/**',
      '.yarn/**',
      '**/*.d.ts',
      '**/*.js'
    ]
  },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    plugins: { jupyter: jupyterPlugin }
  },
  jupyterPlugin.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.es2020
      },
      parserOptions: {
        project: 'tsconfig.json',
        sourceType: 'module'
      }
    },
    rules: {
      '@typescript-eslint/naming-convention': [
        'error',
        {
          selector: 'interface',
          format: ['PascalCase'],
          custom: {
            regex: '^I[A-Z]',
            match: true
          }
        }
      ],
      // This extension does not ship translations
      'jupyter/no-untranslated-string': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { args: 'none' }],
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-namespace': 'off',
      '@typescript-eslint/no-use-before-define': 'off',
      curly: ['error', 'all'],
      eqeqeq: 'error',
      'prefer-arrow-callback': 'error'
    }
  },
  eslintPluginPrettierRecommended
]);
