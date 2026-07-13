import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: ['lib/**', 'coverage/**', 'example/**', '.tsbuild/**', 'node_modules/**', 'scripts/**'],
  },
  ...tseslint.configs.recommended,
  {
    rules: {
      'dot-notation': 'warn',
      'require-yield': 'off',

      '@typescript-eslint/no-var-requires': 'off',
      '@typescript-eslint/no-this-alias': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      '@typescript-eslint/no-empty-interface': 'off',
      '@typescript-eslint/no-unused-vars': ['off', { argsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['test/**'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
)
