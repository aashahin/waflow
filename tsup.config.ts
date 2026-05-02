import { defineConfig } from 'tsup'

export default defineConfig({
  entry: [
    'src/index.ts',
    'src/providers/cloud-api/index.ts',
    'src/providers/360dialog/index.ts',
    'src/providers/wati/index.ts',
  ],
  format: ['esm', 'cjs'],
  dts: true,
  splitting: true,
  clean: true,
  treeshake: true,
  outDir: 'dist',
  target: 'es2022',
  minify: false,
  sourcemap: true,
})
