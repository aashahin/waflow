import { defineConfig } from 'tsup'

export default defineConfig({
  entry: [
    'src/index.ts',
    'src/providers/cloud-api/index.ts',
    'src/providers/360dialog/index.ts',
    'src/providers/wati/index.ts',
  ],
  format: ['esm', 'cjs'],
  // tsup 8.5.1 bundles rollup-plugin-dts, which needs the TS 6 compiler API.
  // TypeScript 7 does not ship that API (`ts.sys` is undefined).
  dts: false,
  onSuccess: 'bunx tsc -p tsconfig.build.json',
  splitting: true,
  clean: true,
  treeshake: true,
  outDir: 'dist',
  target: 'es2022',
  minify: false,
  sourcemap: true,
})
