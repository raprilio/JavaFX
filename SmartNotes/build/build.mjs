// Production build: bundles & minifies the SPA into public_html/assets/dist (ES modules with code splitting).
import * as esbuild from 'esbuild';
import { rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '../public_html/assets');
const watch = process.argv.includes('--watch');
if (!watch) rmSync(join(root, 'dist'), { recursive: true, force: true });

const ctx = await esbuild.context({
  entryPoints: { main: join(root, 'js/main.js'), app: join(root, 'css/app.css') },
  outdir: join(root, 'dist'),
  bundle: true,
  splitting: true,
  format: 'esm',
  minify: true,
  sourcemap: false,
  target: ['es2020', 'chrome100', 'firefox100', 'safari15'],
  chunkNames: 'chunks/[name]-[hash]',
  external: ['../fonts/*'],
  legalComments: 'none',
  logLevel: 'info',
});
if (watch) await ctx.watch();
else { await ctx.rebuild(); await ctx.dispose(); }
