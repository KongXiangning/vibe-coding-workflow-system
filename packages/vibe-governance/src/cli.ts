#!/usr/bin/env node

import { fileURLToPath } from 'url';
import { existsSync, realpathSync } from 'fs';
import { runDistributionCli } from '../../../scripts/vibe-governance-distribution';

export { runDistributionCli } from '../../../scripts/vibe-governance-distribution';

const invokedFile = process.argv[1];
if (invokedFile && existsSync(invokedFile)
  && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(invokedFile)) {
  process.exitCode = runDistributionCli();
}
