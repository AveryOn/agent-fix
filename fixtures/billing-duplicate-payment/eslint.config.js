import eslint from '@eslint/js'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'eslint.config.js']
  },

  eslint.configs.recommended,

  ...tseslint.configs.recommendedTypeChecked,

  {
    files: ['**/*.ts'],

    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname
      }
    },

    rules: {
      '@typescript-eslint/consistent-type-imports': [
        'error',
        {
          prefer: 'type-imports',
          fixStyle: 'separate-type-imports'
        }
      ],

      '@typescript-eslint/no-floating-promises': 'error',

      '@typescript-eslint/no-misused-promises': 'error',

      '@typescript-eslint/no-explicit-any': 'error'
    }
  }
)
