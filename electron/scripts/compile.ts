/** npm run electron:compile — one-off bundle of the Electron code into dist-electron/ */
import { buildOnce } from './build.ts';

buildOnce().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
