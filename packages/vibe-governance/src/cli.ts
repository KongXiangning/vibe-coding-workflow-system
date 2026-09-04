#!/usr/bin/env node

import { fileURLToPath } from 'url';
import * as path from 'path';
import { runDistributionCli } from '../../../scripts/vibe-governance-distribution';

export { runDistributionCli } from '../../../scripts/vibe-governance-distribution';

const invokedFile = process.argv[1] ? path.resolve(fileURLToPath(import.meta.url)) : '';
if (invokedFile && process.argv[1] && invokedFile === path.resolve(process.argv[1])) {
  process.exitCode = runDistributionCli();
}
