/**
 * Bundles the Electron main process, preload script and embedded server into dist-electron/.
 * npm dependencies stay external (shipped in node_modules; sharp is native).
 *
 *   tsx electron/scripts/build.ts          one-off build
 *   import { createBuildContext }          watch mode, used by dev.ts
 */
import { build, context, type BuildOptions, type Plugin } from 'esbuild';
import { rm } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const outDir = path.join(rootDir, 'dist-electron');

/** main.ts loads the server lazily; keep that import pointing at the separate bundle */
const externalEmbeddedServer: Plugin = {
  name: 'external-embedded-server',
  setup(b) {
    b.onResolve({ filter: /^\.\/embedded-server\.js$/ }, (args) =>
      args.importer.replace(/\\/g, '/').endsWith('electron/main.ts') ? { path: args.path, external: true } : undefined,
    );
  },
};

const common: BuildOptions = {
  absWorkingDir: rootDir,
  outdir: outDir,
  bundle: true,
  platform: 'node',
  target: 'node22',
  packages: 'external',
  sourcemap: true,
  logLevel: 'info',
};

function buildOptions(): BuildOptions[] {
  return [
    {
      ...common,
      entryPoints: ['electron/main.ts', 'electron/embedded-server.ts'],
      format: 'esm',
      plugins: [externalEmbeddedServer],
    },
    {
      // Sandboxed preloads must be CommonJS
      ...common,
      entryPoints: ['electron/preload.ts'],
      format: 'cjs',
      outExtension: { '.js': '.cjs' },
    },
  ];
}

export async function createBuildContexts(plugins: Plugin[] = []) {
  await rm(outDir, { recursive: true, force: true });
  return Promise.all(buildOptions().map((o) => context({ ...o, plugins: [...(o.plugins ?? []), ...plugins] })));
}

export async function buildOnce() {
  await rm(outDir, { recursive: true, force: true });
  await Promise.all(buildOptions().map((o) => build(o)));
}
