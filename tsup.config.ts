import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/main.ts'],

  outDir: 'dist',

  format: ['esm'],
  platform: 'node',
  target: 'node24',

  bundle: true,
  splitting: false,
  treeshake: true,

  clean: true,
  sourcemap: true,
  minify: false,
  keepNames: true,

  tsconfig: 'tsconfig.json',

  outExtension() {
    return {
      js: '.js'
    }
  }
})
