import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'yaml';

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };
export type WriteOperation = { path: string; content: string };

const WORKFLOW_PROFILE_RELATIVE_PATH = '.workflow-system/PROJECT_PROFILE.yaml';

function readText(filePath: string): string {
  if (!fs.existsSync(filePath)) throw new Error('Required file not found: ' + filePath);
  return fs.readFileSync(filePath, 'utf8');
}

export function getWorkflowProfilePath(root: string): string {
  return path.join(path.resolve(root), ...WORKFLOW_PROFILE_RELATIVE_PATH.split('/'));
}

export function loadProfile(profilePath: string): JsonObject {
  const profile = parse(readText(profilePath)) as JsonObject;
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) {
    throw new Error(WORKFLOW_PROFILE_RELATIVE_PATH + ' must parse to a mapping');
  }
  return profile;
}

function normalizeWorkflowHome(value: unknown): string {
  if (value == null) return '';
  if (typeof value !== 'string') throw new Error('PROJECT_PROFILE.yaml.paths.workflow_home must be a string');
  const normalized = value.trim().replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\.\//, '').replace(/\/$/, '');
  if (normalized === '.') return '';
  if (!normalized || normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized) || normalized.includes('..') || normalized.includes('*') || /[\0-\x1F\x7F]/.test(normalized)) {
    throw new Error('PROJECT_PROFILE.yaml.paths.workflow_home is not a safe repository-relative path');
  }
  return normalized;
}

export function getWorkflowDocPath(root: string, profile: JsonObject, file: string): string {
  const paths = profile.paths;
  const workflowHome = paths && typeof paths === 'object' && !Array.isArray(paths)
    ? normalizeWorkflowHome((paths as JsonObject).workflow_home)
    : '';
  return path.join(path.resolve(root), ...[workflowHome, file].filter(Boolean).join('/').split('/'));
}

type WriteFs = Pick<typeof fs, 'existsSync' | 'mkdirSync' | 'rmSync' | 'renameSync' | 'writeFileSync'>;

export function executeWrites(
  operations: WriteOperation[],
  dryRun: boolean,
  _summary: string,
  _prepare?: () => void,
  fileSystem: WriteFs = fs,
): void {
  if (dryRun || operations.length === 0) return;
  const stagingRoot = fs.mkdtempSync(path.join(path.dirname(path.resolve(operations[0]!.path)), '.vnext-runtime-'));
  const stagedWrites: Array<{ tempPath: string; targetPath: string }> = [];
  const rollbackEntries: Array<{ targetPath: string; backupPath?: string }> = [];
  try {
    for (const [index, operation] of operations.entries()) {
      const tempPath = path.join(stagingRoot, 'staged', index + '.tmp');
      fileSystem.mkdirSync(path.dirname(tempPath), { recursive: true });
      fileSystem.writeFileSync(tempPath, operation.content, 'utf8');
      stagedWrites.push({ tempPath, targetPath: operation.path });
    }
    for (const [index, staged] of stagedWrites.entries()) {
      let backupPath: string | undefined;
      if (fileSystem.existsSync(staged.targetPath)) {
        backupPath = path.join(stagingRoot, 'backup', index + '.bak');
        fileSystem.mkdirSync(path.dirname(backupPath), { recursive: true });
        fileSystem.renameSync(staged.targetPath, backupPath);
      }
      rollbackEntries.push({ targetPath: staged.targetPath, backupPath });
      fileSystem.mkdirSync(path.dirname(staged.targetPath), { recursive: true });
      fileSystem.renameSync(staged.tempPath, staged.targetPath);
    }
    fileSystem.rmSync(stagingRoot, { recursive: true, force: true });
  } catch (error) {
    for (const staged of stagedWrites) {
      if (fileSystem.existsSync(staged.tempPath)) fileSystem.rmSync(staged.tempPath, { force: true });
    }
    for (const entry of rollbackEntries.reverse()) {
      if (fileSystem.existsSync(entry.targetPath)) fileSystem.rmSync(entry.targetPath, { force: true });
      if (entry.backupPath && fileSystem.existsSync(entry.backupPath)) {
        fileSystem.mkdirSync(path.dirname(entry.targetPath), { recursive: true });
        fileSystem.renameSync(entry.backupPath, entry.targetPath);
      }
    }
    fileSystem.rmSync(stagingRoot, { recursive: true, force: true });
    throw error;
  }
}
