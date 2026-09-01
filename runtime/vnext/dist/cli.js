// runtime/vnext/src/kernel.ts
import * as crypto from "crypto";
import * as fs2 from "fs";
import * as path3 from "path";
import { parseDocument, stringify } from "yaml";

// runtime/vnext/src/runtime-io.ts
import * as fs from "fs";
import * as path from "path";
import { parse } from "yaml";
var WORKFLOW_PROFILE_RELATIVE_PATH = ".workflow-system/PROJECT_PROFILE.yaml";
function readText(filePath) {
  if (!fs.existsSync(filePath))
    throw new Error("Required file not found: " + filePath);
  return fs.readFileSync(filePath, "utf8");
}
function getWorkflowProfilePath(root) {
  return path.join(path.resolve(root), ...WORKFLOW_PROFILE_RELATIVE_PATH.split("/"));
}
function loadProfile(profilePath) {
  const profile = parse(readText(profilePath));
  if (!profile || typeof profile !== "object" || Array.isArray(profile)) {
    throw new Error(WORKFLOW_PROFILE_RELATIVE_PATH + " must parse to a mapping");
  }
  return profile;
}
function normalizeWorkflowHome(value) {
  if (value == null)
    return "";
  if (typeof value !== "string")
    throw new Error("PROJECT_PROFILE.yaml.paths.workflow_home must be a string");
  const normalized = value.trim().replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\.\//, "").replace(/\/$/, "");
  if (normalized === ".")
    return "";
  if (!normalized || normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized) || normalized.includes("..") || normalized.includes("*") || /[\0-\x1F\x7F]/.test(normalized)) {
    throw new Error("PROJECT_PROFILE.yaml.paths.workflow_home is not a safe repository-relative path");
  }
  return normalized;
}
function getWorkflowDocPath(root, profile, file) {
  const paths = profile.paths;
  const workflowHome = paths && typeof paths === "object" && !Array.isArray(paths) ? normalizeWorkflowHome(paths.workflow_home) : "";
  return path.join(path.resolve(root), ...[workflowHome, file].filter(Boolean).join("/").split("/"));
}
function executeWrites(operations, dryRun, _summary, _prepare, fileSystem = fs) {
  if (dryRun || operations.length === 0)
    return;
  const stagingRoot = fs.mkdtempSync(path.join(path.dirname(path.resolve(operations[0].path)), ".vnext-runtime-"));
  const stagedWrites = [];
  const rollbackEntries = [];
  try {
    for (const [index, operation] of operations.entries()) {
      const tempPath = path.join(stagingRoot, "staged", index + ".tmp");
      fileSystem.mkdirSync(path.dirname(tempPath), { recursive: true });
      fileSystem.writeFileSync(tempPath, operation.content, "utf8");
      stagedWrites.push({ tempPath, targetPath: operation.path });
    }
    for (const [index, staged] of stagedWrites.entries()) {
      let backupPath;
      if (fileSystem.existsSync(staged.targetPath)) {
        backupPath = path.join(stagingRoot, "backup", index + ".bak");
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
      if (fileSystem.existsSync(staged.tempPath))
        fileSystem.rmSync(staged.tempPath, { force: true });
    }
    for (const entry of rollbackEntries.reverse()) {
      if (fileSystem.existsSync(entry.targetPath))
        fileSystem.rmSync(entry.targetPath, { force: true });
      if (entry.backupPath && fileSystem.existsSync(entry.backupPath)) {
        fileSystem.mkdirSync(path.dirname(entry.targetPath), { recursive: true });
        fileSystem.renameSync(entry.backupPath, entry.targetPath);
      }
    }
    fileSystem.rmSync(stagingRoot, { recursive: true, force: true });
    throw error;
  }
}

// runtime/vnext/src/task-identity.ts
import * as path2 from "path";
var CURRENT_TASK_WORKFLOW_STATUSES = [
  "draft",
  "active",
  "suspended",
  "archived",
  "superseded",
  "replaced",
  "blocked_by_replan"
];
var TASK_LIFECYCLE_STATES = [
  "active",
  "paused_pending_closure",
  "paused_blocked",
  "interrupted",
  "archived"
];
var RESUME_REVIEW_REASON_ORDER = [
  "base_drift",
  "checkpoint_drift",
  "diff_review_target_changed",
  "environment_recovery_pending",
  "assumption_changed",
  "validation_pending",
  "manual_review_pending",
  "remaining_acceptance_pending",
  "blocker_recheck_required",
  "dirty_attribution_pending",
  "recovery_strategy_review_required"
];
var CURRENT_TASK_WORKFLOW_STATUS_SET = new Set(CURRENT_TASK_WORKFLOW_STATUSES);
var TASK_LIFECYCLE_STATE_SET = new Set(TASK_LIFECYCLE_STATES);
var TASK_ARTIFACT_KIND_SET = new Set(["archive", "paused", "interrupted"]);
var RESUME_REVIEW_REASON_SET = new Set(RESUME_REVIEW_REASON_ORDER);
var PAUSED_PENDING_CLOSURE_REASONS = [
  "validation_pending",
  "manual_review_pending",
  "remaining_acceptance_pending"
];
var INTERRUPTED_REQUIRED_REASONS = [
  "checkpoint_drift",
  "diff_review_target_changed",
  "dirty_attribution_pending",
  "environment_recovery_pending",
  "recovery_strategy_review_required"
];
var CURRENT_TASK_STATUS_TUPLES = new Map([
  ["draft|active", "active_owner"],
  ["active|active", "active_owner"],
  ["suspended|paused_pending_closure", "non_active_owner"],
  ["suspended|paused_blocked", "non_active_owner"],
  ["suspended|interrupted", "non_active_owner"],
  ["archived|archived", "non_active_owner"],
  ["superseded|active", "non_active_owner"],
  ["replaced|active", "non_active_owner"],
  ["blocked_by_replan|active", "non_active_owner"]
]);
var TASK_ID_PATTERN = /^[0-9]{3,}$/;
var TASK_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
function normalizeValue(value) {
  const normalized = String(value ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}
function escapeRegExp(value) {
  return value.replace(/[.*+?^()|[\]\\]/g, "\\$&").replace(/\$/g, "\\$&");
}
function extractTaskInfoSection(currentTaskContent) {
  const headingMatch = /^## 任务信息\s*$/m.exec(currentTaskContent);
  if (!headingMatch || headingMatch.index === undefined)
    return "";
  const afterHeading = currentTaskContent.slice(headingMatch.index + headingMatch[0].length);
  const nextHeadingMatch = /\r?\n##\s/.exec(afterHeading);
  const sectionEnd = nextHeadingMatch?.index ?? afterHeading.length;
  return afterHeading.slice(0, sectionEnd).trim();
}
function extractTaskInfoField(section, label) {
  const match = new RegExp("^-\\s*" + escapeRegExp(label) + "：\\s*(.+?)\\s*$", "m").exec(section);
  return normalizeValue(match?.[1]);
}
function normalizeDelimitedValues(values) {
  const sourceValues = Array.isArray(values) ? values : [values];
  return sourceValues.flatMap((value) => String(value ?? "").split(",").map((item) => item.trim()).filter(Boolean));
}
function extractTaskIdentityFromCurrentTask(currentTaskContent) {
  const section = extractTaskInfoSection(currentTaskContent);
  return {
    id: extractTaskInfoField(section, "任务 ID"),
    title: extractTaskInfoField(section, "任务标题"),
    slug: extractTaskInfoField(section, "任务 slug")
  };
}
function extractCurrentTaskStateFromCurrentTask(currentTaskContent) {
  const section = extractTaskInfoSection(currentTaskContent);
  const rawResume = extractTaskInfoField(section, "恢复需审查");
  let resumeRequiresReview = null;
  if (rawResume !== null) {
    if (rawResume === "true")
      resumeRequiresReview = true;
    else if (rawResume === "false")
      resumeRequiresReview = false;
    else
      throw new Error('恢复需审查 must be "true" or "false".');
  }
  return {
    workflowStatus: extractTaskInfoField(section, "当前状态"),
    lifecycleState: extractTaskInfoField(section, "生命周期状态"),
    resumeRequiresReview,
    resumeReviewReasons: extractTaskInfoField(section, "恢复审查原因")
  };
}
function parseBooleanField(value, label) {
  const normalized = normalizeValue(value);
  if (normalized === "true")
    return true;
  if (normalized === "false")
    return false;
  throw new Error(`${label} must be "true" or "false".`);
}
function parseCurrentTaskWorkflowStatus(value) {
  const normalized = normalizeValue(value);
  if (!normalized || !CURRENT_TASK_WORKFLOW_STATUS_SET.has(normalized)) {
    throw new Error(`当前状态 must use one of: ${CURRENT_TASK_WORKFLOW_STATUSES.join(", ")}.`);
  }
  return normalized;
}
function parseTaskLifecycleState(value) {
  const normalized = normalizeValue(value);
  if (!normalized || !TASK_LIFECYCLE_STATE_SET.has(normalized)) {
    throw new Error(`生命周期状态 must use one of: ${TASK_LIFECYCLE_STATES.join(", ")}.`);
  }
  return normalized;
}
function classifyCurrentTaskOwnershipStatus(workflowStatus, lifecycleState) {
  const normalizedWorkflowStatus = normalizeValue(workflowStatus);
  const normalizedLifecycleState = normalizeValue(lifecycleState);
  if (!normalizedWorkflowStatus || !normalizedLifecycleState)
    return "invalid_unknown";
  return CURRENT_TASK_STATUS_TUPLES.get(`${normalizedWorkflowStatus}|${normalizedLifecycleState}`) ?? "invalid_unknown";
}
function validateCurrentTaskStatusTuple(workflowStatus, lifecycleState) {
  const parsedWorkflowStatus = parseCurrentTaskWorkflowStatus(workflowStatus);
  const parsedLifecycleState = parseTaskLifecycleState(lifecycleState);
  const ownershipStatus = classifyCurrentTaskOwnershipStatus(parsedWorkflowStatus, parsedLifecycleState);
  if (ownershipStatus === "invalid_unknown") {
    throw new Error(`当前状态 × 生命周期状态 tuple "${parsedWorkflowStatus} + ${parsedLifecycleState}" is not allowed by the v1 lifecycle matrix.`);
  }
  return { workflowStatus: parsedWorkflowStatus, lifecycleState: parsedLifecycleState, ownershipStatus };
}
function normalizeResumeReviewReasons(resumeReviewReasons) {
  const providedReasons = normalizeDelimitedValues(resumeReviewReasons);
  const invalidReasons = [...new Set(providedReasons)].filter((reason) => !RESUME_REVIEW_REASON_SET.has(reason));
  if (invalidReasons.length > 0) {
    throw new Error(`resume_review_reasons must use the closed v1 set. Invalid values: ${invalidReasons.join(", ")}.`);
  }
  const provided = new Set(providedReasons);
  return RESUME_REVIEW_REASON_ORDER.filter((reason) => provided.has(reason));
}
function validateCurrentTaskResumeGate(lifecycleState, resumeRequiresReview, resumeReviewReasons) {
  const normalizedReasons = normalizeResumeReviewReasons(resumeReviewReasons);
  if (!resumeRequiresReview) {
    if (normalizedReasons.length > 0)
      throw new Error("恢复需审查 = false 时，恢复审查原因必须为空。");
    return { resumeRequiresReview: false, resumeReviewReasons: [] };
  }
  if (normalizedReasons.length === 0)
    throw new Error("恢复需审查 = true 时，恢复审查原因必须为非空闭合集合。");
  if (lifecycleState === "paused_pending_closure" && !PAUSED_PENDING_CLOSURE_REASONS.some((reason) => normalizedReasons.includes(reason))) {
    throw new Error("paused_pending_closure requires validation_pending, manual_review_pending, or remaining_acceptance_pending.");
  }
  if (lifecycleState === "paused_blocked" && !normalizedReasons.includes("blocker_recheck_required")) {
    throw new Error("paused_blocked requires blocker_recheck_required in resume_review_reasons.");
  }
  if (lifecycleState === "interrupted" && !INTERRUPTED_REQUIRED_REASONS.some((reason) => normalizedReasons.includes(reason))) {
    throw new Error("interrupted requires an interrupt recovery reason in resume_review_reasons.");
  }
  return { resumeRequiresReview: true, resumeReviewReasons: normalizedReasons };
}
function getTaskArtifactPath(taskId, taskSlug, kind) {
  validateTaskId(taskId);
  validateTaskSlug(taskSlug);
  if (!TASK_ARTIFACT_KIND_SET.has(kind))
    throw new Error(`Invalid TaskArtifactKind "${kind}".`);
  const fileName = `TASK-${taskId}-${taskSlug}.md`;
  if (kind === "archive")
    return path2.posix.join("TASKS", fileName);
  return path2.posix.join("TASKS", kind, fileName);
}
function validateTaskId(taskId) {
  const normalized = normalizeValue(taskId);
  if (!normalized || !TASK_ID_PATTERN.test(normalized)) {
    throw new Error('Invalid TASK_ID "' + taskId + '". Expected a zero-padded decimal string with at least 3 digits.');
  }
}
function validateTaskSlug(taskSlug) {
  const normalized = normalizeValue(taskSlug);
  if (!normalized || !TASK_SLUG_PATTERN.test(normalized)) {
    throw new Error('Invalid TASK_SLUG "' + taskSlug + '". Expected lowercase ASCII kebab-case.');
  }
}

// runtime/vnext/src/kernel.ts
var VNEXT_RUNTIME_SCHEMA_VERSION = 1;
var VNEXT_RUNTIME_PROPOSAL_KIND = "vnext-runtime-proposal";
var VNEXT_CURRENT_TASK_KIND = "vnext-current-task";
var VNEXT_RUNTIME_STATE_KIND = "vnext-current-task-runtime-state";
var VNEXT_RUNTIME_CONTRACT_RELATIVE_PATH = ".workflow-system/vnext/RUNTIME_CONTRACT.yaml";
var VNEXT_RUNTIME_PACKAGE_RELATIVE_PATH = ".workflow-system/runtime";
var VNEXT_RUNTIME_ENTRYPOINT_RELATIVE_PATH = ".workflow-system/runtime/dist/cli.js";
var VNEXT_RUNTIME_PACKAGE_MANIFEST_RELATIVE_PATH = ".workflow-system/runtime/package.json";
var VNEXT_RUNTIME_LOCKFILE_RELATIVE_PATH = ".workflow-system/runtime/package-lock.json";
var VNEXT_RUNTIME_PACKAGE_NAME = "vibe-coding-vnext-runtime";
var VNEXT_RUNTIME_NODE_MIN_VERSION = ">=20.0.0";
var VNEXT_RUNTIME_PACKAGE_VERSION = "0.14.5";
var RUNTIME_OPERATION_KINDS = [
  "task-state-transaction",
  "finding-queue-transaction",
  "lifecycle-transaction"
];
var RUNTIME_SOURCE_TUPLE_FIELDS = [
  "path",
  "revision",
  "document_id",
  "task_id",
  "task_slug",
  "workflow_status",
  "lifecycle_state",
  "active_step_id",
  "active_step_status",
  "finding_queue_revision",
  "resume_requires_review",
  "resume_review_reasons"
];
var RUNTIME_REQUIRED_ENVELOPE_FIELDS = [
  "authority_evidence",
  "semantic_delta",
  "preconditions",
  "evidence_refs",
  "idempotency_key",
  "requested_write_targets"
];
var RUNTIME_STATE_FIELDS = [
  "task_id",
  "task_slug",
  "workflow_status",
  "lifecycle_state",
  "resume_requires_review",
  "resume_review_reasons",
  "active_step_id",
  "active_step_status",
  "finding_queue_revision",
  "review_cycle",
  "findings",
  "execution_log",
  "applied_proposals"
];
var REVIEW_CYCLE_FIELDS = [
  "id",
  "cycle_phase",
  "repair_round",
  "counted_repair_wave_ids",
  "active_repair_wave_id",
  "verification_new_finding_wave_used",
  "verification_new_finding_wave_id"
];
var RUNTIME_RESULT_STATES = ["success", "no-op", "conflict", "blocked"];
var VNEXT_EXECUTE_STEP_MODES = ["default", "repair"];
var PREPARE_TASK_MODES = ["default", "replan"];
var LIFECYCLE_MODES = ["pause", "interrupt", "resume-paused", "resume-interrupted", "supersede"];
var REVIEW_CYCLE_PHASES = ["discovery", "verification"];
var STEP_STATUSES = ["ready", "in-progress", "completed", "blocked"];
var FINDING_STATUSES = ["admitted", "in-progress", "resolved", "deferred", "rejected"];
var DOCUMENT_ID_PATTERN = /^doc-[a-f0-9]{24}$/;
var SAFE_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/;
var FINGERPRINT_PATTERN = /^[a-z0-9][a-z0-9._:-]{2,127}$/;
var STEP_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
var MAX_TEXT_LENGTH = 4000;
var MAX_EVIDENCE_REFS = 32;
var MAX_FINDINGS = 256;
var MAX_APPLIED_PROPOSALS = 256;
var MAX_EXECUTION_LOG = 256;
var MAX_REPAIR_ROUNDS = 3;
var MAX_REPAIR_ATTEMPTS = 2;
var CURRENT_TASK_RELATIVE_FALLBACK = "docs/workflow/CURRENT_TASK.md";

class VNextRuntimeError extends Error {
  code;
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.name = "VNextRuntimeError";
    this.code = code;
  }
}
function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function fail(code, message) {
  throw new VNextRuntimeError(code, message);
}
function expectRecord(value, location) {
  if (!isRecord(value))
    fail("RUNTIME_SCHEMA_INVALID", `${location} must be a mapping.`);
  return value;
}
function expectExactKeys(value, expected, location) {
  const expectedSet = new Set(expected);
  const missing = expected.filter((key) => !(key in value));
  const extra = Object.keys(value).filter((key) => !expectedSet.has(key));
  if (missing.length > 0 || extra.length > 0) {
    fail("RUNTIME_SCHEMA_INVALID", `${location} keys mismatch; missing=[${missing.join(", ")}], unexpected=[${extra.join(", ")}].`);
  }
}
function expectString(value, location, pattern) {
  if (typeof value !== "string" || value.trim().length === 0) {
    fail("RUNTIME_SCHEMA_INVALID", `${location} must be a non-empty string.`);
  }
  const normalized = value.trim();
  if (pattern && !pattern.test(normalized)) {
    fail("RUNTIME_SCHEMA_INVALID", `${location} has an invalid value.`);
  }
  return normalized;
}
function expectNullableString(value, location, pattern) {
  if (value === null)
    return null;
  return expectString(value, location, pattern);
}
function expectText(value, location, maxLength = MAX_TEXT_LENGTH) {
  const text = expectString(value, location);
  if (text.length > maxLength)
    fail("RUNTIME_SCHEMA_INVALID", `${location} exceeds ${maxLength} characters.`);
  return text;
}
function expectEnum(value, allowed, location) {
  const normalized = expectString(value, location);
  if (!allowed.includes(normalized)) {
    fail("RUNTIME_SCHEMA_INVALID", `${location} must be one of [${allowed.join(", ")}].`);
  }
  return normalized;
}
function expectBoolean(value, location) {
  if (typeof value !== "boolean")
    fail("RUNTIME_SCHEMA_INVALID", `${location} must be a boolean.`);
  return value;
}
function expectInteger(value, location, min = 0, max = Number.MAX_SAFE_INTEGER) {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    fail("RUNTIME_SCHEMA_INVALID", `${location} must be an integer in [${min}, ${max}].`);
  }
  return value;
}
function expectStringArray(value, location, allowEmpty = false, maxLength = 128) {
  if (!Array.isArray(value) || !allowEmpty && value.length === 0) {
    fail("RUNTIME_SCHEMA_INVALID", `${location} must be ${allowEmpty ? "an array" : "a non-empty array"}.`);
  }
  if (value.length > maxLength)
    fail("RUNTIME_SCHEMA_INVALID", `${location} has too many entries.`);
  const items = value.map((item, index) => expectText(item, `${location}[${index}]`, 512));
  if (new Set(items).size !== items.length)
    fail("RUNTIME_SCHEMA_INVALID", `${location} contains duplicates.`);
  return items;
}
function expectSetEqual(actual, expected, location) {
  const actualSet = new Set(actual);
  const expectedSet = new Set(expected);
  const missing = expected.filter((item) => !actualSet.has(item));
  const extra = actual.filter((item) => !expectedSet.has(item));
  if (missing.length > 0 || extra.length > 0 || actualSet.size !== actual.length) {
    fail("RUNTIME_CONTRACT_INVALID", `${location} differs from the closed set; missing=[${missing.join(", ")}], extra=[${extra.join(", ")}].`);
  }
}
function normalizeRepoPath(value, location) {
  const normalized = value.replace(/\\/g, "/").replace(/^\.\//, "");
  if (!normalized || normalized.startsWith("/") || normalized.split("/").includes("..")) {
    fail("RUNTIME_PATH_INVALID", `${location} must be a repository-relative path.`);
  }
  return normalized;
}
function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}
function stableValue(value) {
  if (Array.isArray(value))
    return value.map(stableValue);
  if (isRecord(value)) {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  }
  return value;
}
function digest(value) {
  return sha256(JSON.stringify(stableValue(value)));
}
function parseYamlFrontmatter(content, location) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(content);
  if (!match) {
    fail("MIGRATION_REQUIRED", `${location} is not a vNext CURRENT_TASK document; run the Migration Pack.`);
  }
  const document = parseDocument(match[1], { uniqueKeys: true });
  const diagnostics = [...document.errors, ...document.warnings];
  if (diagnostics.length > 0) {
    fail("RUNTIME_SCHEMA_INVALID", `${location} has invalid frontmatter YAML: ${diagnostics.map((item) => item.message).join("; ")}`);
  }
  const frontmatter = document.toJS();
  if (!isRecord(frontmatter)) {
    fail("MIGRATION_REQUIRED", `${location} does not declare a supported vNext CURRENT_TASK schema; run the Migration Pack.`);
  }
  return { frontmatter, body: match[2] };
}
function parseYamlMappingFile(filePath) {
  if (!fs2.existsSync(filePath))
    fail("RUNTIME_CONTRACT_MISSING", `Runtime contract is missing: ${filePath}`);
  const document = parseDocument(fs2.readFileSync(filePath, "utf8"), { uniqueKeys: true });
  const diagnostics = [...document.errors, ...document.warnings];
  if (diagnostics.length > 0)
    fail("RUNTIME_CONTRACT_INVALID", `${filePath} has invalid YAML: ${diagnostics.map((item) => item.message).join("; ")}`);
  return expectRecord(document.toJS(), filePath);
}
function validateNodeMinimum(nodeMinVersion) {
  const match = /^>=([0-9]+)\.([0-9]+)\.([0-9]+)$/.exec(nodeMinVersion);
  if (!match)
    fail("RUNTIME_CONTRACT_INVALID", "runtime_distribution.node_min_version must use >=MAJOR.MINOR.PATCH.");
  const major = Number(match[1]);
  if (!Number.isSafeInteger(major) || major < 20)
    fail("RUNTIME_CONTRACT_INVALID", "runtime_distribution.node_min_version must require Node 20 or newer.");
}
function validateRuntimeEnvironment(nodeVersion = process.versions.node, nodeMinVersion = VNEXT_RUNTIME_NODE_MIN_VERSION) {
  const minimumMatch = /^>=([0-9]+)\.([0-9]+)\.([0-9]+)$/.exec(nodeMinVersion);
  const currentMatch = /^([0-9]+)\.([0-9]+)\.([0-9]+)/.exec(nodeVersion ?? "");
  if (!minimumMatch || !currentMatch)
    throw new VNextRuntimeError("RUNTIME_ENV_UNSUPPORTED", "Unable to determine a supported Node.js version.");
  const minimum = minimumMatch.slice(1).map(Number);
  const current = currentMatch.slice(1).map(Number);
  const belowMinimum = current[0] < minimum[0] || current[0] === minimum[0] && current[1] < minimum[1] || current[0] === minimum[0] && current[1] === minimum[1] && current[2] < minimum[2];
  if (belowMinimum) {
    throw new VNextRuntimeError("RUNTIME_ENV_UNSUPPORTED", "Node.js " + nodeVersion + " is below the required minimum " + nodeMinVersion + ".");
  }
}
function readJsonObject(filePath, code) {
  if (!fs2.existsSync(filePath))
    fail(code, "Required Runtime distribution file is missing: " + filePath);
  let parsed;
  try {
    parsed = JSON.parse(fs2.readFileSync(filePath, "utf8"));
  } catch (error) {
    fail(code, filePath + " is not valid JSON: " + (error instanceof Error ? error.message : String(error)));
  }
  return expectRecord(parsed, filePath);
}
function resolveRuntimeDistributionDirectory(root) {
  const resolvedRoot = path3.resolve(root);
  const installedDirectory = path3.join(resolvedRoot, ...VNEXT_RUNTIME_PACKAGE_RELATIVE_PATH.split("/"));
  if (fs2.existsSync(path3.join(installedDirectory, "package.json"))) {
    return { directory: installedDirectory, installed: true };
  }
  return { directory: path3.join(resolvedRoot, "runtime", "vnext"), installed: false };
}
function validateVNextRuntimeDistribution(root, contract, requireDependencies = false) {
  const { directory } = resolveRuntimeDistributionDirectory(root);
  const packagePath = path3.join(directory, "package.json");
  const lockfilePath = path3.join(directory, "package-lock.json");
  const entrypointPath = path3.join(directory, "dist", "cli.js");
  const packageManifest = readJsonObject(packagePath, "RUNTIME_PACKAGE_INVALID");
  if (packageManifest.name !== contract.package_name || packageManifest.version !== contract.package_version || packageManifest.private !== true || packageManifest.type !== "module") {
    fail("RUNTIME_PACKAGE_INVALID", "Runtime package.json must declare the contract name, version, private=true, and type=module.");
  }
  const engines = expectRecord(packageManifest.engines, "Runtime package.json.engines");
  if (engines.node !== contract.node_min_version)
    fail("RUNTIME_PACKAGE_INVALID", "Runtime package.json.engines.node does not match runtime_distribution.node_min_version.");
  const dependencies = expectRecord(packageManifest.dependencies, "Runtime package.json.dependencies");
  if (dependencies.yaml !== "2.8.3")
    fail("RUNTIME_PACKAGE_INVALID", "Runtime package.json must pin yaml to 2.8.3.");
  const lockfile = readJsonObject(lockfilePath, "RUNTIME_PACKAGE_INVALID");
  if (lockfile.name !== contract.package_name || lockfile.version !== contract.package_version || lockfile.lockfileVersion !== 3) {
    fail("RUNTIME_PACKAGE_INVALID", "Runtime package-lock.json identity or lockfileVersion is invalid.");
  }
  const lockPackages = expectRecord(lockfile.packages, "Runtime package-lock.json.packages");
  const rootLock = expectRecord(lockPackages[""], 'Runtime package-lock.json.packages[""]');
  if (rootLock.version !== contract.package_version)
    fail("RUNTIME_PACKAGE_INVALID", "Runtime package-lock.json root version does not match the Runtime contract.");
  const yamlLock = expectRecord(lockPackages["node_modules/yaml"], "Runtime package-lock.json.packages[node_modules/yaml]");
  if (yamlLock.version !== "2.8.3")
    fail("RUNTIME_PACKAGE_INVALID", "Runtime package-lock.json must lock yaml to 2.8.3.");
  if (!fs2.existsSync(entrypointPath) || !fs2.statSync(entrypointPath).isFile())
    fail("RUNTIME_PACKAGE_INVALID", "Runtime entrypoint is missing: " + entrypointPath);
  const entrypoint = fs2.readFileSync(entrypointPath, "utf8");
  if (!entrypoint.includes("vnext-runtime-proposal") || !entrypoint.includes("runCli"))
    fail("RUNTIME_PACKAGE_INVALID", "Runtime dist/cli.js is not the generated vNext Runtime entrypoint.");
  if (requireDependencies) {
    const localYaml = path3.join(directory, "node_modules", "yaml", "package.json");
    const localYamlManifest = readJsonObject(localYaml, "RUNTIME_DEPENDENCY_MISSING");
    if (localYamlManifest.version !== "2.8.3")
      fail("RUNTIME_DEPENDENCY_INVALID", "Runtime-local yaml dependency does not match package-lock.json.");
  }
  return {
    kind: contract.kind,
    package_path: contract.package_path,
    entrypoint: contract.entrypoint,
    package_version: contract.package_version,
    node_min_version: contract.node_min_version,
    package_lock_sha256: sha256(fs2.readFileSync(lockfilePath)),
    entrypoint_sha256: sha256(fs2.readFileSync(entrypointPath))
  };
}
function validateRuntimeDistributionContract(value) {
  const distribution = expectRecord(value, "Runtime contract.runtime_distribution");
  expectExactKeys(distribution, ["kind", "package_path", "entrypoint", "package_manifest", "lockfile", "package_name", "package_version", "node_min_version"], "Runtime contract.runtime_distribution");
  const result = {
    kind: expectEnum(distribution.kind, ["project-local-node"], "Runtime contract.runtime_distribution.kind"),
    package_path: normalizeRepoPath(expectString(distribution.package_path, "Runtime contract.runtime_distribution.package_path"), "Runtime contract.runtime_distribution.package_path"),
    entrypoint: normalizeRepoPath(expectString(distribution.entrypoint, "Runtime contract.runtime_distribution.entrypoint"), "Runtime contract.runtime_distribution.entrypoint"),
    package_manifest: normalizeRepoPath(expectString(distribution.package_manifest, "Runtime contract.runtime_distribution.package_manifest"), "Runtime contract.runtime_distribution.package_manifest"),
    lockfile: normalizeRepoPath(expectString(distribution.lockfile, "Runtime contract.runtime_distribution.lockfile"), "Runtime contract.runtime_distribution.lockfile"),
    package_name: expectString(distribution.package_name, "Runtime contract.runtime_distribution.package_name"),
    package_version: expectString(distribution.package_version, "Runtime contract.runtime_distribution.package_version"),
    node_min_version: expectString(distribution.node_min_version, "Runtime contract.runtime_distribution.node_min_version")
  };
  if (result.package_path !== VNEXT_RUNTIME_PACKAGE_RELATIVE_PATH || result.entrypoint !== VNEXT_RUNTIME_ENTRYPOINT_RELATIVE_PATH || result.package_manifest !== VNEXT_RUNTIME_PACKAGE_MANIFEST_RELATIVE_PATH || result.lockfile !== VNEXT_RUNTIME_LOCKFILE_RELATIVE_PATH || result.package_name !== VNEXT_RUNTIME_PACKAGE_NAME || result.package_version !== VNEXT_RUNTIME_PACKAGE_VERSION || result.node_min_version !== VNEXT_RUNTIME_NODE_MIN_VERSION) {
    fail("RUNTIME_CONTRACT_INVALID", "Runtime distribution must use the canonical project-local Node package identity.");
  }
  validateNodeMinimum(result.node_min_version);
  return result;
}
function validateVNextRuntimeContract(root, requireDependencies = false) {
  const filePath = path3.join(path3.resolve(root), ...VNEXT_RUNTIME_CONTRACT_RELATIVE_PATH.split("/"));
  const contract = parseYamlMappingFile(filePath);
  expectExactKeys(contract, ["schema_version", "kind", "phase", "runtime_distribution", "proposal", "canonical_current_task", "concurrency", "operations", "unbound_operations"], "vNext Runtime contract");
  if (contract.schema_version !== 1 || contract.kind !== "vnext-runtime-contract" || contract.phase !== "Phase 2") {
    fail("RUNTIME_CONTRACT_INVALID", "Runtime contract must declare schema_version=1, kind=vnext-runtime-contract, phase=Phase 2.");
  }
  const runtimeDistribution = validateRuntimeDistributionContract(contract.runtime_distribution);
  const distributionIdentity = validateVNextRuntimeDistribution(root, runtimeDistribution, requireDependencies);
  const proposal = expectRecord(contract.proposal, "Runtime contract.proposal");
  expectExactKeys(proposal, ["schema_version", "kind", "caller", "operation_kinds", "source_tuple", "required_envelope", "finding_queue_admission", "finding_queue_repair", "prepare_task", "lifecycle"], "Runtime contract.proposal");
  if (proposal.schema_version !== 1 || proposal.kind !== VNEXT_RUNTIME_PROPOSAL_KIND)
    fail("RUNTIME_CONTRACT_INVALID", "Runtime proposal contract has an invalid envelope marker.");
  expectSetEqual(expectStringArray(proposal.caller, "Runtime contract.proposal.caller"), ["execute-step", "prepare-task", "task-lifecycle"], "Runtime contract proposal callers");
  expectSetEqual(expectStringArray(proposal.operation_kinds, "Runtime contract.proposal.operation_kinds"), [...RUNTIME_OPERATION_KINDS], "Runtime contract operation kinds");
  expectSetEqual(expectStringArray(proposal.source_tuple, "Runtime contract.proposal.source_tuple"), [...RUNTIME_SOURCE_TUPLE_FIELDS], "Runtime contract source tuple");
  expectSetEqual(expectStringArray(proposal.required_envelope, "Runtime contract.proposal.required_envelope"), [...RUNTIME_REQUIRED_ENVELOPE_FIELDS], "Runtime contract proposal envelope");
  const findingQueueRepair = expectRecord(proposal.finding_queue_repair, "Runtime contract.proposal.finding_queue_repair");
  expectExactKeys(findingQueueRepair, ["required"], "Runtime contract.proposal.finding_queue_repair");
  expectSetEqual(expectStringArray(findingQueueRepair.required, "Runtime contract.proposal.finding_queue_repair.required"), ["review_cycle_id", "repair_wave_id"], "Runtime contract finding-queue repair fields");
  const findingQueueAdmission = expectRecord(proposal.finding_queue_admission, "Runtime contract.proposal.finding_queue_admission");
  expectExactKeys(findingQueueAdmission, ["required"], "Runtime contract.proposal.finding_queue_admission");
  expectSetEqual(expectStringArray(findingQueueAdmission.required, "Runtime contract.proposal.finding_queue_admission.required"), ["cycle_phase", "finding_admission_wave_id"], "Runtime contract finding-queue admission fields");
  const prepareTaskContract = expectRecord(proposal.prepare_task, "Runtime contract.proposal.prepare_task");
  expectExactKeys(prepareTaskContract, ["bound_actions"], "Runtime contract.proposal.prepare_task");
  expectSetEqual(expectStringArray(prepareTaskContract.bound_actions, "Runtime contract.proposal.prepare_task.bound_actions"), ["clear-resume-review-gate"], "Runtime contract prepare-task bound actions");
  const lifecycleContract = expectRecord(proposal.lifecycle, "Runtime contract.proposal.lifecycle");
  expectExactKeys(lifecycleContract, ["modes", "bound_modes", "proposal_only_modes", "pause_required", "interrupt_required", "resume_required", "supersede_required"], "Runtime contract.proposal.lifecycle");
  expectSetEqual(expectStringArray(lifecycleContract.modes, "Runtime contract.proposal.lifecycle.modes"), [...LIFECYCLE_MODES], "Runtime contract lifecycle modes");
  expectSetEqual(expectStringArray(lifecycleContract.bound_modes, "Runtime contract.proposal.lifecycle.bound_modes"), ["pause", "interrupt", "resume-paused", "resume-interrupted"], "Runtime contract bound lifecycle modes");
  expectSetEqual(expectStringArray(lifecycleContract.proposal_only_modes, "Runtime contract.proposal.lifecycle.proposal_only_modes"), ["supersede"], "Runtime contract proposal-only lifecycle modes");
  const lifecycleRequiredFields = {
    pause_required: ["lifecycle_state", "suspension_reason", "task_start_base", "last_reviewed_checkpoint", "current_diff_review_target", "rollback_conditions", "resume_review_reasons", "evidence_refs"],
    interrupt_required: ["lifecycle_state", "suspension_reason", "task_start_base", "last_reviewed_checkpoint", "current_diff_review_target", "rollback_conditions", "resume_review_reasons", "checkpoint_evidence", "dirty_attribution", "environment_state", "recovery_strategy", "evidence_refs"],
    resume_required: ["artifact_kind", "recovery_package_path", "recovery_package_revision", "resume_review_reasons", "evidence_refs"],
    supersede_required: ["invalidation_reason", "evidence_refs"]
  };
  for (const [field, expected] of Object.entries(lifecycleRequiredFields)) {
    const required = expectRecord(lifecycleContract[field], `Runtime contract.proposal.lifecycle.${field}`);
    expectExactKeys(required, ["required"], `Runtime contract.proposal.lifecycle.${field}`);
    expectSetEqual(expectStringArray(required.required, `Runtime contract.proposal.lifecycle.${field}.required`), expected, `Runtime contract lifecycle ${field}`);
  }
  const canonical = expectRecord(contract.canonical_current_task, "Runtime contract.canonical_current_task");
  expectExactKeys(canonical, ["frontmatter", "runtime_state", "source_of_truth", "legacy_schema_behavior"], "Runtime contract.canonical_current_task");
  const frontmatter = expectRecord(canonical.frontmatter, "Runtime contract.canonical_current_task.frontmatter");
  expectExactKeys(frontmatter, ["schema_version", "kind", "required"], "Runtime contract.canonical_current_task.frontmatter");
  if (frontmatter.schema_version !== 1 || frontmatter.kind !== VNEXT_CURRENT_TASK_KIND)
    fail("RUNTIME_CONTRACT_INVALID", "Runtime contract current-task frontmatter marker is invalid.");
  expectSetEqual(expectStringArray(frontmatter.required, "Runtime contract.canonical_current_task.frontmatter.required"), ["document_id", "runtime_state"], "Runtime contract current-task frontmatter");
  const runtimeState = expectRecord(canonical.runtime_state, "Runtime contract.canonical_current_task.runtime_state");
  expectExactKeys(runtimeState, ["schema_version", "kind", "fields", "review_cycle"], "Runtime contract.canonical_current_task.runtime_state");
  if (runtimeState.schema_version !== 1 || runtimeState.kind !== VNEXT_RUNTIME_STATE_KIND)
    fail("RUNTIME_CONTRACT_INVALID", "Runtime contract runtime-state marker is invalid.");
  expectSetEqual(expectStringArray(runtimeState.fields, "Runtime contract.canonical_current_task.runtime_state.fields"), [...RUNTIME_STATE_FIELDS], "Runtime contract runtime-state fields");
  const reviewCycleContract = expectRecord(runtimeState.review_cycle, "Runtime contract.canonical_current_task.runtime_state.review_cycle");
  expectExactKeys(reviewCycleContract, ["fields", "repair_round_max", "same_repair_wave_counts_once", "verification_new_finding_wave_max"], "Runtime contract.canonical_current_task.runtime_state.review_cycle");
  expectSetEqual(expectStringArray(reviewCycleContract.fields, "Runtime contract.canonical_current_task.runtime_state.review_cycle.fields"), [...REVIEW_CYCLE_FIELDS], "Runtime contract review-cycle fields");
  if (expectInteger(reviewCycleContract.repair_round_max, "Runtime contract review-cycle repair_round_max", 0, MAX_REPAIR_ROUNDS) !== MAX_REPAIR_ROUNDS) {
    fail("RUNTIME_CONTRACT_INVALID", "Runtime contract review-cycle repair_round_max must be 3.");
  }
  if (expectBoolean(reviewCycleContract.same_repair_wave_counts_once, "Runtime contract review-cycle same_repair_wave_counts_once") !== true) {
    fail("RUNTIME_CONTRACT_INVALID", "Runtime contract must count each repair wave once per review cycle.");
  }
  if (expectInteger(reviewCycleContract.verification_new_finding_wave_max, "Runtime contract review-cycle verification_new_finding_wave_max", 0, 1) !== 1) {
    fail("RUNTIME_CONTRACT_INVALID", "Runtime contract must allow at most one verification new-finding admission wave per review cycle.");
  }
  if (canonical.source_of_truth !== "same-canonical-CURRENT_TASK-document" || canonical.legacy_schema_behavior !== "migration-required")
    fail("RUNTIME_CONTRACT_INVALID", "Runtime contract must keep CURRENT_TASK as the only state source and stop on legacy schema.");
  const concurrency = expectRecord(contract.concurrency, "Runtime contract.concurrency");
  expectExactKeys(concurrency, ["model", "concurrent_state_changing_writers", "stale_detection"], "Runtime contract.concurrency");
  if (concurrency.model !== "single-authorized-writer" || concurrency.concurrent_state_changing_writers !== "forbidden" || concurrency.stale_detection !== "source-revision-and-explicit-recovery-package-revision") {
    fail("RUNTIME_CONTRACT_INVALID", "Runtime contract must require a single authorized state-changing writer plus explicit recovery package revision stale detection.");
  }
  const operations = contract.operations;
  if (!Array.isArray(operations) || operations.length !== RUNTIME_OPERATION_KINDS.length)
    fail("RUNTIME_CONTRACT_INVALID", "Runtime contract must declare exactly the three Phase 2 bound operations.");
  const bound = [];
  for (const [index, rawOperation] of operations.entries()) {
    const operation = expectRecord(rawOperation, `Runtime contract.operations[${index}]`);
    expectExactKeys(operation, ["id", "status", "binding", "operation", "source_targets", "write_targets", "allowed_callers", "result_states", "atomic", "idempotence", "conflict_policy"], `Runtime contract.operations[${index}]`);
    const id = expectEnum(operation.id, RUNTIME_OPERATION_KINDS, `Runtime contract.operations[${index}].id`);
    if (bound.includes(id))
      fail("RUNTIME_CONTRACT_INVALID", `Runtime contract operation ${id} is duplicated.`);
    bound.push(id);
    if (operation.status !== "bound" || operation.binding !== "vnext-runtime")
      fail("RUNTIME_CONTRACT_INVALID", `Runtime contract operation ${id} must be bound to vnext-runtime.`);
    if (operation.operation !== id)
      fail("RUNTIME_CONTRACT_INVALID", `Runtime contract operation ${id} must identify its logical operation.`);
    const expectedTargets = id === "lifecycle-transaction" ? ["CURRENT_TASK.md", "TASKS/paused/**", "TASKS/interrupted/**"] : ["CURRENT_TASK.md"];
    const expectedCallers = id === "task-state-transaction" ? ["execute-step", "prepare-task"] : id === "finding-queue-transaction" ? ["execute-step"] : ["task-lifecycle"];
    expectSetEqual(expectStringArray(operation.source_targets, `Runtime contract.operations[${index}].source_targets`), expectedTargets, `Runtime contract operation ${id}.source_targets`);
    expectSetEqual(expectStringArray(operation.write_targets, `Runtime contract.operations[${index}].write_targets`), expectedTargets, `Runtime contract operation ${id}.write_targets`);
    expectSetEqual(expectStringArray(operation.allowed_callers, `Runtime contract.operations[${index}].allowed_callers`), expectedCallers, `Runtime contract operation ${id}.allowed_callers`);
    expectSetEqual(expectStringArray(operation.result_states, `Runtime contract.operations[${index}].result_states`), [...RUNTIME_RESULT_STATES], `Runtime contract operation ${id}.result_states`);
    if (operation.atomic !== true || operation.idempotence !== "fail-closed" || operation.conflict_policy !== "fail-closed")
      fail("RUNTIME_CONTRACT_INVALID", `Runtime contract operation ${id} must be atomic, fail-closed, and conflict-safe.`);
  }
  expectSetEqual(bound, [...RUNTIME_OPERATION_KINDS], "Runtime contract bound operations");
  const unbound = expectStringArray(contract.unbound_operations, "Runtime contract.unbound_operations");
  expectSetEqual(unbound, ["inbox-record-transaction", "project-status-transaction", "archive-transaction", "lesson-record-transaction"], "Runtime contract unbound operations");
  return { phase: "Phase 2", runtime_distribution: distributionIdentity, bound_operations: bound, unbound_operations: unbound };
}
function validateAuthorityEvidence(value) {
  if (!Array.isArray(value) || value.length === 0)
    fail("RUNTIME_AUTHORITY_MISSING", "authority_evidence must be non-empty.");
  const result = [];
  for (const [index, raw] of value.entries()) {
    const record = expectRecord(raw, `authority_evidence[${index}]`);
    expectExactKeys(record, ["kind", "source", "subject"], `authority_evidence[${index}]`);
    result.push({
      kind: expectEnum(record.kind, ["active-task-owner", "scope-admission", "finding-admission", "evidence-admission", "dangerous-operation", "resume-review"], `authority_evidence[${index}].kind`),
      source: normalizeRepoPath(expectString(record.source, `authority_evidence[${index}].source`), `authority_evidence[${index}].source`),
      subject: expectText(record.subject, `authority_evidence[${index}].subject`, 256)
    });
  }
  return result;
}
function validateSourceTuple(value) {
  const record = expectRecord(value, "source_tuple");
  expectExactKeys(record, ["path", "revision", "document_id", "task_id", "task_slug", "workflow_status", "lifecycle_state", "active_step_id", "active_step_status", "finding_queue_revision", "resume_requires_review", "resume_review_reasons"], "source_tuple");
  const taskId = expectString(record.task_id, "source_tuple.task_id");
  const taskSlug = expectString(record.task_slug, "source_tuple.task_slug");
  try {
    validateTaskId(taskId);
    validateTaskSlug(taskSlug);
  } catch (error) {
    fail("RUNTIME_SCHEMA_INVALID", error instanceof Error ? error.message : String(error));
  }
  const documentId = expectString(record.document_id, "source_tuple.document_id");
  if (!DOCUMENT_ID_PATTERN.test(documentId))
    fail("RUNTIME_SCHEMA_INVALID", "source_tuple.document_id is invalid.");
  const revision = expectString(record.revision, "source_tuple.revision");
  if (!/^[a-f0-9]{64}$/.test(revision))
    fail("RUNTIME_SCHEMA_INVALID", "source_tuple.revision must be SHA-256.");
  const workflowStatus = expectEnum(record.workflow_status, CURRENT_TASK_WORKFLOW_STATUSES, "source_tuple.workflow_status");
  const lifecycleState = expectEnum(record.lifecycle_state, TASK_LIFECYCLE_STATES, "source_tuple.lifecycle_state");
  try {
    validateCurrentTaskStatusTuple(workflowStatus, lifecycleState);
  } catch (error) {
    fail("RUNTIME_STATE_CONFLICT", error instanceof Error ? error.message : String(error));
  }
  const resumeRequiresReview = expectBoolean(record.resume_requires_review, "source_tuple.resume_requires_review");
  const rawResumeReasons = expectStringArray(record.resume_review_reasons, "source_tuple.resume_review_reasons", true, RESUME_REVIEW_REASON_ORDER.length);
  const resumeReviewReasons = normalizeResumeReviewReasons(rawResumeReasons);
  if (rawResumeReasons.join("|") !== resumeReviewReasons.join("|")) {
    fail("RUNTIME_SCHEMA_INVALID", "source_tuple.resume_review_reasons must use the canonical closed-set order.");
  }
  try {
    validateCurrentTaskResumeGate(lifecycleState, resumeRequiresReview, resumeReviewReasons);
  } catch (error) {
    fail("RUNTIME_STATE_CONFLICT", error instanceof Error ? error.message : String(error));
  }
  if (workflowStatus === "suspended" && !resumeRequiresReview) {
    fail("RUNTIME_STATE_CONFLICT", "suspended CURRENT_TASK state must remain behind a non-empty resume review gate.");
  }
  return {
    path: normalizeRepoPath(expectString(record.path, "source_tuple.path"), "source_tuple.path"),
    revision,
    document_id: documentId,
    task_id: taskId,
    task_slug: taskSlug,
    workflow_status: workflowStatus,
    lifecycle_state: lifecycleState,
    active_step_id: expectString(record.active_step_id, "source_tuple.active_step_id", STEP_ID_PATTERN),
    active_step_status: expectEnum(record.active_step_status, STEP_STATUSES, "source_tuple.active_step_status"),
    finding_queue_revision: expectInteger(record.finding_queue_revision, "source_tuple.finding_queue_revision"),
    resume_requires_review: resumeRequiresReview,
    resume_review_reasons: resumeReviewReasons
  };
}
function validateEvidenceRefs(value, location) {
  return expectStringArray(value, location, false, MAX_EVIDENCE_REFS);
}
function validateTaskStateDelta(value) {
  const record = expectRecord(value, "semantic_delta");
  const kind = expectEnum(record.kind, ["task-state"], "semantic_delta.kind");
  const action = expectEnum(record.action, ["step-progress", "clear-resume-review-gate"], "semantic_delta.action");
  if (action === "clear-resume-review-gate") {
    expectExactKeys(record, ["kind", "action", "evidence_refs"], "semantic_delta");
    return {
      kind,
      action: "clear-resume-review-gate",
      evidence_refs: validateEvidenceRefs(record.evidence_refs, "semantic_delta.evidence_refs")
    };
  }
  const keys = Object.keys(record);
  if (keys.some((key) => !["kind", "action", "step_id", "status", "evidence_refs", "note", "repair_fingerprint"].includes(key))) {
    fail("RUNTIME_SCHEMA_INVALID", "task-state semantic_delta contains unsupported fields.");
  }
  const result = {
    kind,
    action: "step-progress",
    step_id: expectString(record.step_id, "semantic_delta.step_id", STEP_ID_PATTERN),
    status: expectEnum(record.status, STEP_STATUSES, "semantic_delta.status"),
    evidence_refs: validateEvidenceRefs(record.evidence_refs, "semantic_delta.evidence_refs")
  };
  if (record.note !== undefined)
    result.note = expectText(record.note, "semantic_delta.note");
  if (record.repair_fingerprint !== undefined)
    result.repair_fingerprint = expectString(record.repair_fingerprint, "semantic_delta.repair_fingerprint", FINGERPRINT_PATTERN);
  return result;
}
function validateLifecycleReasons(value, location) {
  const raw = expectStringArray(value, location, false, RESUME_REVIEW_REASON_ORDER.length);
  const normalized = normalizeResumeReviewReasons(raw);
  if (normalized.length !== raw.length || !normalized.every((reason, index) => reason === raw[index])) {
    fail("RUNTIME_SCHEMA_INVALID", `${location} must use the canonical closed-set order without duplicates.`);
  }
  return normalized;
}
function validateLifecycleDelta(value) {
  const record = expectRecord(value, "semantic_delta");
  const kind = expectEnum(record.kind, ["lifecycle"], "semantic_delta.kind");
  const action = expectEnum(record.action, LIFECYCLE_MODES, "semantic_delta.action");
  if (action === "pause") {
    const allowedKeys = [
      "kind",
      "action",
      "lifecycle_state",
      "suspension_reason",
      "task_start_base",
      "last_reviewed_checkpoint",
      "current_diff_review_target",
      "rollback_conditions",
      "resume_review_reasons",
      "evidence_refs",
      "blocker_status",
      "blocking_evidence",
      "remaining_acceptance",
      "failed_checks"
    ];
    if (Object.keys(record).some((key) => !allowedKeys.includes(key)))
      fail("RUNTIME_SCHEMA_INVALID", "pause lifecycle semantic_delta contains unsupported fields.");
    const lifecycleState = expectEnum(record.lifecycle_state, ["paused_pending_closure", "paused_blocked"], "semantic_delta.lifecycle_state");
    const common = {
      kind,
      action,
      lifecycle_state: lifecycleState,
      suspension_reason: expectText(record.suspension_reason, "semantic_delta.suspension_reason"),
      task_start_base: expectText(record.task_start_base, "semantic_delta.task_start_base"),
      last_reviewed_checkpoint: expectText(record.last_reviewed_checkpoint, "semantic_delta.last_reviewed_checkpoint"),
      current_diff_review_target: expectText(record.current_diff_review_target, "semantic_delta.current_diff_review_target"),
      rollback_conditions: expectText(record.rollback_conditions, "semantic_delta.rollback_conditions"),
      resume_review_reasons: validateLifecycleReasons(record.resume_review_reasons, "semantic_delta.resume_review_reasons"),
      evidence_refs: validateEvidenceRefs(record.evidence_refs, "semantic_delta.evidence_refs")
    };
    try {
      validateCurrentTaskResumeGate(lifecycleState, true, common.resume_review_reasons);
    } catch (error) {
      fail("RUNTIME_LIFECYCLE_EVIDENCE_INVALID", error instanceof Error ? error.message : String(error));
    }
    if (lifecycleState === "paused_blocked") {
      return {
        ...common,
        lifecycle_state: lifecycleState,
        blocker_status: expectText(record.blocker_status, "semantic_delta.blocker_status"),
        blocking_evidence: expectText(record.blocking_evidence, "semantic_delta.blocking_evidence"),
        remaining_acceptance: expectText(record.remaining_acceptance, "semantic_delta.remaining_acceptance"),
        ...record.failed_checks === undefined ? {} : { failed_checks: expectStringArray(record.failed_checks, "semantic_delta.failed_checks", false, 32) }
      };
    }
    const forbiddenFields = ["blocker_status", "blocking_evidence", "remaining_acceptance", "failed_checks"];
    if (forbiddenFields.some((field) => record[field] !== undefined))
      fail("RUNTIME_SCHEMA_INVALID", "paused_pending_closure must not carry paused_blocked-only evidence.");
    return common;
  }
  if (action === "interrupt") {
    const allowedKeys = [
      "kind",
      "action",
      "lifecycle_state",
      "suspension_reason",
      "task_start_base",
      "last_reviewed_checkpoint",
      "current_diff_review_target",
      "rollback_conditions",
      "resume_review_reasons",
      "evidence_refs",
      "checkpoint_evidence",
      "dirty_attribution",
      "environment_state",
      "recovery_strategy"
    ];
    if (Object.keys(record).some((key) => !allowedKeys.includes(key)))
      fail("RUNTIME_SCHEMA_INVALID", "interrupt lifecycle semantic_delta contains unsupported fields.");
    const lifecycleState = expectEnum(record.lifecycle_state, ["interrupted"], "semantic_delta.lifecycle_state");
    const resumeReviewReasons = validateLifecycleReasons(record.resume_review_reasons, "semantic_delta.resume_review_reasons");
    try {
      validateCurrentTaskResumeGate(lifecycleState, true, resumeReviewReasons);
    } catch (error) {
      fail("RUNTIME_LIFECYCLE_EVIDENCE_INVALID", error instanceof Error ? error.message : String(error));
    }
    return {
      kind,
      action,
      lifecycle_state: lifecycleState,
      suspension_reason: expectText(record.suspension_reason, "semantic_delta.suspension_reason"),
      task_start_base: expectText(record.task_start_base, "semantic_delta.task_start_base"),
      last_reviewed_checkpoint: expectText(record.last_reviewed_checkpoint, "semantic_delta.last_reviewed_checkpoint"),
      current_diff_review_target: expectText(record.current_diff_review_target, "semantic_delta.current_diff_review_target"),
      rollback_conditions: expectText(record.rollback_conditions, "semantic_delta.rollback_conditions"),
      resume_review_reasons: resumeReviewReasons,
      evidence_refs: validateEvidenceRefs(record.evidence_refs, "semantic_delta.evidence_refs"),
      checkpoint_evidence: expectText(record.checkpoint_evidence, "semantic_delta.checkpoint_evidence"),
      dirty_attribution: expectText(record.dirty_attribution, "semantic_delta.dirty_attribution"),
      environment_state: expectText(record.environment_state, "semantic_delta.environment_state"),
      recovery_strategy: expectText(record.recovery_strategy, "semantic_delta.recovery_strategy")
    };
  }
  if (action === "resume-paused" || action === "resume-interrupted") {
    expectExactKeys(record, ["kind", "action", "artifact_kind", "recovery_package_path", "recovery_package_revision", "resume_review_reasons", "evidence_refs"], "semantic_delta");
    const artifactKind = expectEnum(record.artifact_kind, ["paused", "interrupted"], "semantic_delta.artifact_kind");
    if (action === "resume-paused" && artifactKind !== "paused" || action === "resume-interrupted" && artifactKind !== "interrupted") {
      fail("RUNTIME_LIFECYCLE_EVIDENCE_INVALID", `${action} must target the matching ${action === "resume-paused" ? "paused" : "interrupted"} artifact kind.`);
    }
    const recoveryPackageRevision = expectString(record.recovery_package_revision, "semantic_delta.recovery_package_revision");
    if (!/^[a-f0-9]{64}$/.test(recoveryPackageRevision))
      fail("RUNTIME_SCHEMA_INVALID", "semantic_delta.recovery_package_revision must be SHA-256.");
    return {
      kind,
      action,
      artifact_kind: artifactKind,
      recovery_package_path: normalizeRepoPath(expectString(record.recovery_package_path, "semantic_delta.recovery_package_path"), "semantic_delta.recovery_package_path"),
      recovery_package_revision: recoveryPackageRevision,
      resume_review_reasons: validateLifecycleReasons(record.resume_review_reasons, "semantic_delta.resume_review_reasons"),
      evidence_refs: validateEvidenceRefs(record.evidence_refs, "semantic_delta.evidence_refs")
    };
  }
  expectExactKeys(record, ["kind", "action", "invalidation_reason", "evidence_refs"], "semantic_delta");
  return {
    kind,
    action: "supersede",
    invalidation_reason: expectText(record.invalidation_reason, "semantic_delta.invalidation_reason"),
    evidence_refs: validateEvidenceRefs(record.evidence_refs, "semantic_delta.evidence_refs")
  };
}
function validateFindingRecord(value, location) {
  const record = expectRecord(value, location);
  expectExactKeys(record, ["kind", "action", "cycle_phase", "finding_admission_wave_id", "finding"], location);
  expectEnum(record.kind, ["finding-queue"], `${location}.kind`);
  expectEnum(record.action, ["admit"], `${location}.action`);
  const finding = expectRecord(record.finding, `${location}.finding`);
  const findingKeys = [
    "fingerprint",
    "category",
    "owner_task_id",
    "scope",
    "decision",
    "file",
    "failure_condition",
    "violated_invariant",
    "root_cause_status",
    "status",
    "repair_attempts",
    "max_repair_attempts",
    "evidence_refs",
    "review_cycle_id"
  ];
  const findingExtra = Object.keys(finding).filter((key) => !findingKeys.includes(key));
  if (findingExtra.length > 0)
    fail("RUNTIME_SCHEMA_INVALID", `${location}.finding contains unsupported fields.`);
  const result = {
    kind: "finding-queue",
    action: "admit",
    cycle_phase: expectEnum(record.cycle_phase, REVIEW_CYCLE_PHASES, `${location}.cycle_phase`),
    finding_admission_wave_id: expectString(record.finding_admission_wave_id, `${location}.finding_admission_wave_id`, SAFE_KEY_PATTERN),
    finding: {
      fingerprint: expectString(finding.fingerprint, `${location}.finding.fingerprint`, FINGERPRINT_PATTERN),
      category: expectText(finding.category, `${location}.finding.category`, 256),
      owner_task_id: expectString(finding.owner_task_id, `${location}.finding.owner_task_id`),
      scope: expectEnum(finding.scope, ["admitted"], `${location}.finding.scope`),
      decision: expectEnum(finding.decision, ["mechanical"], `${location}.finding.decision`),
      file: normalizeRepoPath(expectString(finding.file, `${location}.finding.file`), `${location}.finding.file`),
      failure_condition: expectText(finding.failure_condition, `${location}.finding.failure_condition`),
      violated_invariant: expectText(finding.violated_invariant, `${location}.finding.violated_invariant`, 512),
      root_cause_status: expectEnum(finding.root_cause_status, ["confirmed", "bounded"], `${location}.finding.root_cause_status`),
      max_repair_attempts: expectInteger(finding.max_repair_attempts, `${location}.finding.max_repair_attempts`, 1, MAX_REPAIR_ATTEMPTS),
      evidence_refs: validateEvidenceRefs(finding.evidence_refs, `${location}.finding.evidence_refs`),
      review_cycle_id: expectString(finding.review_cycle_id, `${location}.finding.review_cycle_id`, SAFE_KEY_PATTERN)
    }
  };
  if (finding.status !== undefined && finding.status !== "admitted")
    fail("RUNTIME_SCHEMA_INVALID", `${location}.finding.status must be admitted.`);
  if (finding.repair_attempts !== undefined && finding.repair_attempts !== 0)
    fail("RUNTIME_SCHEMA_INVALID", `${location}.finding.repair_attempts must be 0.`);
  return result;
}
function validateFindingAction(value) {
  const record = expectRecord(value, "semantic_delta");
  const action = expectEnum(record.action, ["record-repair-attempt", "resolve", "defer", "reject"], "semantic_delta.action");
  const allowedKeys = action === "record-repair-attempt" ? ["kind", "action", "fingerprint", "review_cycle_id", "repair_wave_id", "evidence_refs", "note"] : ["kind", "action", "fingerprint", "evidence_refs", "note"];
  if (Object.keys(record).some((key) => !allowedKeys.includes(key)))
    fail("RUNTIME_SCHEMA_INVALID", "finding-queue semantic_delta contains unsupported fields.");
  const result = action === "record-repair-attempt" ? {
    kind: "finding-queue",
    action,
    fingerprint: expectString(record.fingerprint, "semantic_delta.fingerprint", FINGERPRINT_PATTERN),
    review_cycle_id: expectString(record.review_cycle_id, "semantic_delta.review_cycle_id", SAFE_KEY_PATTERN),
    repair_wave_id: expectString(record.repair_wave_id, "semantic_delta.repair_wave_id", SAFE_KEY_PATTERN),
    evidence_refs: validateEvidenceRefs(record.evidence_refs, "semantic_delta.evidence_refs")
  } : {
    kind: "finding-queue",
    action,
    fingerprint: expectString(record.fingerprint, "semantic_delta.fingerprint", FINGERPRINT_PATTERN),
    evidence_refs: validateEvidenceRefs(record.evidence_refs, "semantic_delta.evidence_refs")
  };
  if (record.note !== undefined)
    result.note = expectText(record.note, "semantic_delta.note");
  return result;
}
function validateSemanticDelta(value, operationKind) {
  const record = expectRecord(value, "semantic_delta");
  const kind = expectString(record.kind, "semantic_delta.kind");
  if (operationKind === "task-state-transaction") {
    if (kind !== "task-state")
      fail("RUNTIME_SCHEMA_INVALID", "task-state-transaction requires task-state semantic_delta.");
    return validateTaskStateDelta(value);
  }
  if (operationKind === "lifecycle-transaction") {
    if (kind !== "lifecycle")
      fail("RUNTIME_SCHEMA_INVALID", "lifecycle-transaction requires lifecycle semantic_delta.");
    return validateLifecycleDelta(value);
  }
  if (kind !== "finding-queue")
    fail("RUNTIME_SCHEMA_INVALID", "finding-queue-transaction requires finding-queue semantic_delta.");
  return record.action === "admit" ? validateFindingRecord(value, "semantic_delta") : validateFindingAction(value);
}
function validateRuntimeProposal(value) {
  const proposal = expectRecord(value, "proposal");
  expectExactKeys(proposal, ["schema_version", "kind", "operation_kind", "caller", "mode", "source_tuple", "authority_evidence", "semantic_delta", "preconditions", "evidence_refs", "idempotency_key", "requested_write_targets"], "proposal");
  if (proposal.schema_version !== VNEXT_RUNTIME_SCHEMA_VERSION)
    fail("RUNTIME_SCHEMA_INVALID", "proposal.schema_version must be 1.");
  if (proposal.kind !== VNEXT_RUNTIME_PROPOSAL_KIND)
    fail("RUNTIME_SCHEMA_INVALID", `proposal.kind must be ${VNEXT_RUNTIME_PROPOSAL_KIND}.`);
  const operationKind = expectEnum(proposal.operation_kind, RUNTIME_OPERATION_KINDS, "proposal.operation_kind");
  const caller = expectEnum(proposal.caller, ["execute-step", "prepare-task", "task-lifecycle"], "proposal.caller");
  const mode = expectEnum(proposal.mode, [...VNEXT_EXECUTE_STEP_MODES, ...PREPARE_TASK_MODES, ...LIFECYCLE_MODES], "proposal.mode");
  const sourceTuple = validateSourceTuple(proposal.source_tuple);
  const authorityEvidence = validateAuthorityEvidence(proposal.authority_evidence);
  const preconditions = expectStringArray(proposal.preconditions, "proposal.preconditions", false, 32);
  const evidenceRefs = validateEvidenceRefs(proposal.evidence_refs, "proposal.evidence_refs");
  const idempotencyKey = expectString(proposal.idempotency_key, "proposal.idempotency_key", SAFE_KEY_PATTERN);
  const requestedTargets = expectStringArray(proposal.requested_write_targets, "proposal.requested_write_targets", false, 4).map((target, index) => normalizeRepoPath(target, `proposal.requested_write_targets[${index}]`));
  const targetCount = operationKind === "lifecycle-transaction" && mode !== "supersede" ? 2 : 1;
  if (requestedTargets.length !== targetCount)
    fail("RUNTIME_PATH_INVALID", `This Runtime proposal must name exactly ${targetCount} exact write target${targetCount === 1 ? "" : "s"}.`);
  const semanticDelta = validateSemanticDelta(proposal.semantic_delta, operationKind);
  if (operationKind === "task-state-transaction") {
    if (caller === "prepare-task") {
      if (mode !== "default" && mode !== "replan")
        fail("RUNTIME_MODE_INVALID", "prepare-task task-state proposals must use default or replan mode.");
      if (semanticDelta.kind !== "task-state" || semanticDelta.action !== "clear-resume-review-gate")
        fail("RUNTIME_CALLER_NOT_BOUND", "prepare-task is bound only to clear-resume-review-gate.");
    } else if (caller === "execute-step") {
      if (!VNEXT_EXECUTE_STEP_MODES.includes(mode))
        fail("RUNTIME_MODE_INVALID", "execute-step task-state proposals must use default or repair mode.");
      if (semanticDelta.kind !== "task-state" || semanticDelta.action !== "step-progress")
        fail("RUNTIME_MODE_INVALID", "execute-step is bound only to step-progress task-state deltas.");
    } else {
      fail("RUNTIME_CALLER_NOT_BOUND", "task-state-transaction is not bound to task-lifecycle.");
    }
  } else if (operationKind === "finding-queue-transaction") {
    if (caller !== "execute-step" || mode !== "repair")
      fail("RUNTIME_CALLER_NOT_BOUND", "finding-queue-transaction is bound only to execute-step:repair.");
    if (semanticDelta.kind !== "finding-queue")
      fail("RUNTIME_MODE_INVALID", "repair mode requires a finding-queue proposal.");
  } else {
    if (caller !== "task-lifecycle" || !LIFECYCLE_MODES.includes(mode))
      fail("RUNTIME_CALLER_NOT_BOUND", "lifecycle-transaction is bound only to task-lifecycle lifecycle modes.");
    if (semanticDelta.kind !== "lifecycle" || semanticDelta.action !== mode)
      fail("RUNTIME_MODE_INVALID", "lifecycle mode and semantic transition must match.");
  }
  const result = {
    schema_version: 1,
    kind: VNEXT_RUNTIME_PROPOSAL_KIND,
    operation_kind: operationKind,
    caller,
    mode,
    source_tuple: sourceTuple,
    authority_evidence: authorityEvidence,
    semantic_delta: semanticDelta,
    preconditions,
    evidence_refs: evidenceRefs,
    idempotency_key: idempotencyKey,
    requested_write_targets: requestedTargets
  };
  const deltaRefs = semanticDelta.kind === "task-state" ? semanticDelta.evidence_refs : semanticDelta.action === "admit" ? semanticDelta.finding.evidence_refs : semanticDelta.evidence_refs;
  if (!deltaRefs.every((ref) => evidenceRefs.includes(ref))) {
    fail("RUNTIME_EVIDENCE_INVALID", "proposal.evidence_refs must cover semantic_delta evidence_refs.");
  }
  return result;
}
function validateFinding(value, location) {
  const finding = expectRecord(value, location);
  expectExactKeys(finding, ["fingerprint", "category", "owner_task_id", "scope", "decision", "file", "failure_condition", "violated_invariant", "root_cause_status", "status", "repair_attempts", "max_repair_attempts", "evidence_refs", "review_cycle_id", "last_repair_wave_id", "admitted_at", "updated_at"], location);
  return {
    fingerprint: expectString(finding.fingerprint, `${location}.fingerprint`, FINGERPRINT_PATTERN),
    category: expectText(finding.category, `${location}.category`, 256),
    owner_task_id: expectString(finding.owner_task_id, `${location}.owner_task_id`),
    scope: expectEnum(finding.scope, ["admitted"], `${location}.scope`),
    decision: expectEnum(finding.decision, ["mechanical"], `${location}.decision`),
    file: normalizeRepoPath(expectString(finding.file, `${location}.file`), `${location}.file`),
    failure_condition: expectText(finding.failure_condition, `${location}.failure_condition`),
    violated_invariant: expectText(finding.violated_invariant, `${location}.violated_invariant`, 512),
    root_cause_status: expectEnum(finding.root_cause_status, ["confirmed", "bounded"], `${location}.root_cause_status`),
    status: expectEnum(finding.status, FINDING_STATUSES, `${location}.status`),
    repair_attempts: expectInteger(finding.repair_attempts, `${location}.repair_attempts`, 0, MAX_REPAIR_ATTEMPTS),
    max_repair_attempts: expectInteger(finding.max_repair_attempts, `${location}.max_repair_attempts`, 1, MAX_REPAIR_ATTEMPTS),
    evidence_refs: validateEvidenceRefs(finding.evidence_refs, `${location}.evidence_refs`),
    review_cycle_id: expectString(finding.review_cycle_id, `${location}.review_cycle_id`, SAFE_KEY_PATTERN),
    last_repair_wave_id: expectNullableString(finding.last_repair_wave_id, `${location}.last_repair_wave_id`, SAFE_KEY_PATTERN),
    admitted_at: expectString(finding.admitted_at, `${location}.admitted_at`),
    updated_at: expectString(finding.updated_at, `${location}.updated_at`)
  };
}
function validateReviewCycle(value, location = "runtime_state.review_cycle") {
  const reviewCycle = expectRecord(value, location);
  expectExactKeys(reviewCycle, [...REVIEW_CYCLE_FIELDS], location);
  const id = expectString(reviewCycle.id, `${location}.id`, SAFE_KEY_PATTERN);
  const cyclePhase = expectEnum(reviewCycle.cycle_phase, REVIEW_CYCLE_PHASES, `${location}.cycle_phase`);
  const repairRound = expectInteger(reviewCycle.repair_round, `${location}.repair_round`, 0, MAX_REPAIR_ROUNDS);
  const countedRepairWaveIds = expectStringArray(reviewCycle.counted_repair_wave_ids, `${location}.counted_repair_wave_ids`, true, MAX_REPAIR_ROUNDS);
  if (new Set(countedRepairWaveIds).size !== countedRepairWaveIds.length) {
    fail("RUNTIME_SCHEMA_INVALID", `${location}.counted_repair_wave_ids must be unique.`);
  }
  if (repairRound !== countedRepairWaveIds.length) {
    fail("RUNTIME_STATE_CONFLICT", `${location}.repair_round must equal the number of counted repair waves.`);
  }
  const activeRepairWaveId = expectNullableString(reviewCycle.active_repair_wave_id, `${location}.active_repair_wave_id`, SAFE_KEY_PATTERN);
  if (activeRepairWaveId !== null && !countedRepairWaveIds.includes(activeRepairWaveId)) {
    fail("RUNTIME_STATE_CONFLICT", `${location}.active_repair_wave_id must be one of counted_repair_wave_ids.`);
  }
  if (activeRepairWaveId !== null && countedRepairWaveIds[countedRepairWaveIds.length - 1] !== activeRepairWaveId) {
    fail("RUNTIME_STATE_CONFLICT", `${location}.active_repair_wave_id must be the latest counted repair wave.`);
  }
  const verificationNewFindingWaveUsed = expectBoolean(reviewCycle.verification_new_finding_wave_used, `${location}.verification_new_finding_wave_used`);
  const verificationNewFindingWaveId = expectNullableString(reviewCycle.verification_new_finding_wave_id, `${location}.verification_new_finding_wave_id`, SAFE_KEY_PATTERN);
  if (!verificationNewFindingWaveUsed && verificationNewFindingWaveId !== null) {
    fail("RUNTIME_STATE_CONFLICT", `${location}.verification_new_finding_wave_id must be null before the verification admission wave is used.`);
  }
  if (verificationNewFindingWaveId !== null && activeRepairWaveId !== null) {
    fail("RUNTIME_STATE_CONFLICT", `${location}.verification_new_finding_wave_id cannot remain open while a repair wave is active.`);
  }
  if (verificationNewFindingWaveUsed && cyclePhase !== "verification") {
    fail("RUNTIME_STATE_CONFLICT", `${location}.cycle_phase must be verification after the verification admission wave is used.`);
  }
  return {
    id,
    cycle_phase: cyclePhase,
    repair_round: repairRound,
    counted_repair_wave_ids: countedRepairWaveIds,
    active_repair_wave_id: activeRepairWaveId,
    verification_new_finding_wave_used: verificationNewFindingWaveUsed,
    verification_new_finding_wave_id: verificationNewFindingWaveId
  };
}
function validateVNextRuntimeState(value) {
  const runtime = expectRecord(value, "runtime_state");
  expectExactKeys(runtime, ["schema_version", "kind", "task_id", "task_slug", "workflow_status", "lifecycle_state", "resume_requires_review", "resume_review_reasons", "active_step_id", "active_step_status", "finding_queue_revision", "review_cycle", "findings", "execution_log", "applied_proposals"], "runtime_state");
  if (runtime.schema_version !== VNEXT_RUNTIME_SCHEMA_VERSION)
    fail("RUNTIME_SCHEMA_INVALID", "runtime_state.schema_version must be 1.");
  if (runtime.kind !== VNEXT_RUNTIME_STATE_KIND)
    fail("RUNTIME_SCHEMA_INVALID", `runtime_state.kind must be ${VNEXT_RUNTIME_STATE_KIND}.`);
  const taskId = expectString(runtime.task_id, "runtime_state.task_id");
  const taskSlug = expectString(runtime.task_slug, "runtime_state.task_slug");
  try {
    validateTaskId(taskId);
    validateTaskSlug(taskSlug);
  } catch (error) {
    fail("RUNTIME_SCHEMA_INVALID", error instanceof Error ? error.message : String(error));
  }
  const workflowStatus = expectEnum(runtime.workflow_status, CURRENT_TASK_WORKFLOW_STATUSES, "runtime_state.workflow_status");
  const lifecycleState = expectEnum(runtime.lifecycle_state, TASK_LIFECYCLE_STATES, "runtime_state.lifecycle_state");
  try {
    validateCurrentTaskStatusTuple(workflowStatus, lifecycleState);
  } catch (error) {
    fail("RUNTIME_STATE_CONFLICT", error instanceof Error ? error.message : String(error));
  }
  const resumeRequiresReview = expectBoolean(runtime.resume_requires_review, "runtime_state.resume_requires_review");
  const rawResumeReasons = expectStringArray(runtime.resume_review_reasons, "runtime_state.resume_review_reasons", true, RESUME_REVIEW_REASON_ORDER.length);
  const resumeReviewReasons = normalizeResumeReviewReasons(rawResumeReasons);
  if (rawResumeReasons.join("|") !== resumeReviewReasons.join("|")) {
    fail("RUNTIME_SCHEMA_INVALID", "runtime_state.resume_review_reasons must use the canonical closed-set order.");
  }
  try {
    validateCurrentTaskResumeGate(lifecycleState, resumeRequiresReview, resumeReviewReasons);
  } catch (error) {
    fail("RUNTIME_STATE_CONFLICT", error instanceof Error ? error.message : String(error));
  }
  const activeStepId = expectString(runtime.active_step_id, "runtime_state.active_step_id", STEP_ID_PATTERN);
  const activeStepStatus = expectEnum(runtime.active_step_status, STEP_STATUSES, "runtime_state.active_step_status");
  const findingsValue = runtime.findings;
  if (!Array.isArray(findingsValue) || findingsValue.length > MAX_FINDINGS)
    fail("RUNTIME_SCHEMA_INVALID", "runtime_state.findings must be an array within the bounded size.");
  const findings = findingsValue.map((finding, index) => validateFinding(finding, `runtime_state.findings[${index}]`));
  if (new Set(findings.map((finding) => finding.fingerprint)).size !== findings.length)
    fail("RUNTIME_SCHEMA_INVALID", "runtime_state.findings fingerprints must be unique.");
  for (const finding of findings) {
    if (finding.owner_task_id !== taskId)
      fail("RUNTIME_STATE_CONFLICT", `finding ${finding.fingerprint} is owned by a different task.`);
    if (finding.repair_attempts > finding.max_repair_attempts)
      fail("RUNTIME_SCHEMA_INVALID", `finding ${finding.fingerprint} exceeds its declared repair budget.`);
  }
  const executionLogValue = runtime.execution_log;
  if (!Array.isArray(executionLogValue) || executionLogValue.length > MAX_EXECUTION_LOG)
    fail("RUNTIME_SCHEMA_INVALID", "runtime_state.execution_log must be a bounded array.");
  const executionLog = executionLogValue.map((entry, index) => {
    const record = expectRecord(entry, `runtime_state.execution_log[${index}]`);
    const executionLogKeys = ["idempotency_key", "mode", "step_id", "status", "evidence_refs", "note", "recorded_at"];
    const missingExecutionLogKeys = executionLogKeys.filter((key) => key !== "note" && !(key in record));
    const extraExecutionLogKeys = Object.keys(record).filter((key) => !executionLogKeys.includes(key));
    if (missingExecutionLogKeys.length > 0 || extraExecutionLogKeys.length > 0)
      fail("RUNTIME_SCHEMA_INVALID", `runtime_state.execution_log[${index}] keys mismatch; missing=[${missingExecutionLogKeys.join(", ")}], unexpected=[${extraExecutionLogKeys.join(", ")}].`);
    const result = {
      idempotency_key: expectString(record.idempotency_key, `runtime_state.execution_log[${index}].idempotency_key`, SAFE_KEY_PATTERN),
      mode: expectEnum(record.mode, VNEXT_EXECUTE_STEP_MODES, `runtime_state.execution_log[${index}].mode`),
      step_id: expectString(record.step_id, `runtime_state.execution_log[${index}].step_id`, STEP_ID_PATTERN),
      status: expectEnum(record.status, STEP_STATUSES, `runtime_state.execution_log[${index}].status`),
      evidence_refs: validateEvidenceRefs(record.evidence_refs, `runtime_state.execution_log[${index}].evidence_refs`),
      recorded_at: expectString(record.recorded_at, `runtime_state.execution_log[${index}].recorded_at`)
    };
    if (record.note !== undefined && record.note !== null)
      result.note = expectText(record.note, `runtime_state.execution_log[${index}].note`);
    return result;
  });
  const appliedValue = runtime.applied_proposals;
  if (!Array.isArray(appliedValue) || appliedValue.length > MAX_APPLIED_PROPOSALS)
    fail("RUNTIME_SCHEMA_INVALID", "runtime_state.applied_proposals must be a bounded array.");
  const appliedProposals = appliedValue.map((entry, index) => {
    const record = expectRecord(entry, `runtime_state.applied_proposals[${index}]`);
    expectExactKeys(record, ["idempotency_key", "operation_kind", "proposal_digest", "source_revision"], `runtime_state.applied_proposals[${index}]`);
    const proposalDigest = expectString(record.proposal_digest, `runtime_state.applied_proposals[${index}].proposal_digest`);
    if (!/^[a-f0-9]{64}$/.test(proposalDigest))
      fail("RUNTIME_SCHEMA_INVALID", `runtime_state.applied_proposals[${index}].proposal_digest must be SHA-256.`);
    const sourceRevision = expectString(record.source_revision, `runtime_state.applied_proposals[${index}].source_revision`);
    if (!/^[a-f0-9]{64}$/.test(sourceRevision))
      fail("RUNTIME_SCHEMA_INVALID", `runtime_state.applied_proposals[${index}].source_revision must be SHA-256.`);
    return {
      idempotency_key: expectString(record.idempotency_key, `runtime_state.applied_proposals[${index}].idempotency_key`, SAFE_KEY_PATTERN),
      operation_kind: expectEnum(record.operation_kind, RUNTIME_OPERATION_KINDS, `runtime_state.applied_proposals[${index}].operation_kind`),
      proposal_digest: proposalDigest,
      source_revision: sourceRevision
    };
  });
  if (new Set(appliedProposals.map((item) => item.idempotency_key)).size !== appliedProposals.length)
    fail("RUNTIME_SCHEMA_INVALID", "runtime_state.applied_proposals keys must be unique.");
  const reviewCycle = validateReviewCycle(runtime.review_cycle);
  return {
    schema_version: 1,
    kind: VNEXT_RUNTIME_STATE_KIND,
    task_id: taskId,
    task_slug: taskSlug,
    workflow_status: workflowStatus,
    lifecycle_state: lifecycleState,
    resume_requires_review: resumeRequiresReview,
    resume_review_reasons: resumeReviewReasons,
    active_step_id: activeStepId,
    active_step_status: activeStepStatus,
    finding_queue_revision: expectInteger(runtime.finding_queue_revision, "runtime_state.finding_queue_revision"),
    review_cycle: reviewCycle,
    findings,
    execution_log: executionLog,
    applied_proposals: appliedProposals
  };
}
function renderCanonicalCurrentTask(frontmatter, body, runtimeState) {
  const nextFrontmatter = { ...frontmatter, runtime_state: runtimeState };
  const nextBody = renderCurrentTaskLifecycleFields(body, runtimeState);
  return `---
${stringify(nextFrontmatter).trimEnd()}
---
${nextBody}`;
}
function replaceTaskInfoField(body, label, value) {
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`^-\\s*${escapedLabel}：[^\\r\\n]*$`, "gm");
  const matches = body.match(pattern) ?? [];
  if (matches.length !== 1)
    fail("RUNTIME_SCHEMA_INVALID", `CURRENT_TASK must contain exactly one task-info field "${label}".`);
  return body.replace(pattern, `- ${label}：${value}`);
}
function renderCurrentTaskLifecycleFields(body, runtimeState) {
  const headingMatch = /^## 任务信息\s*$/m.exec(body);
  if (!headingMatch || headingMatch.index === undefined)
    fail("RUNTIME_SCHEMA_INVALID", "CURRENT_TASK is missing ## 任务信息.");
  const sectionStart = headingMatch.index + headingMatch[0].length;
  const sectionRemainder = body.slice(sectionStart);
  const nextHeading = /\r?\n##\s/.exec(sectionRemainder);
  const sectionEnd = nextHeading?.index ?? sectionRemainder.length;
  const section = sectionRemainder.slice(0, sectionEnd);
  const nextSection = [
    ["当前状态", runtimeState.workflow_status],
    ["生命周期状态", runtimeState.lifecycle_state],
    ["恢复需审查", runtimeState.resume_requires_review ? "true" : "false"],
    ["恢复审查原因", runtimeState.resume_review_reasons.join(", ")]
  ];
  const renderedSection = nextSection.reduce((current, [label, value]) => replaceTaskInfoField(current, label, value), section);
  return body.slice(0, sectionStart) + renderedSection + body.slice(sectionStart + sectionEnd);
}
function currentTaskPathForRoot(root) {
  const resolvedRoot = path3.resolve(root);
  const profilePath = getWorkflowProfilePath(resolvedRoot);
  if (!fs2.existsSync(profilePath))
    fail("RUNTIME_SOURCE_MISSING", `PROJECT_PROFILE.yaml is missing: ${profilePath}`);
  const profile = loadProfile(profilePath);
  const filePath = getWorkflowDocPath(resolvedRoot, profile, "CURRENT_TASK.md");
  const relativePath = path3.relative(resolvedRoot, filePath).replace(/\\/g, "/");
  if (!relativePath || relativePath.startsWith("../") || path3.isAbsolute(relativePath))
    fail("RUNTIME_PATH_INVALID", "CURRENT_TASK path escapes the target root.");
  return { filePath, relativePath: relativePath || CURRENT_TASK_RELATIVE_FALLBACK };
}
function parseCanonicalCurrentTaskContent(raw, filePath, relativePath) {
  const { frontmatter, body } = parseYamlFrontmatter(raw, relativePath);
  if (frontmatter.kind !== VNEXT_CURRENT_TASK_KIND) {
    fail("MIGRATION_REQUIRED", `${relativePath} is not a pure vNext CURRENT_TASK document; run the Migration Pack.`);
  }
  expectExactKeys(frontmatter, ["schema_version", "kind", "document_id", "runtime_state"], `${relativePath} frontmatter`);
  if (frontmatter.schema_version !== 1)
    fail("RUNTIME_SCHEMA_INVALID", `${relativePath}.schema_version must be 1 for a vNext CURRENT_TASK document.`);
  const documentId = expectString(frontmatter.document_id, `${relativePath}.document_id`);
  if (!DOCUMENT_ID_PATTERN.test(documentId))
    fail("RUNTIME_SCHEMA_INVALID", `${relativePath}.document_id is invalid.`);
  const runtimeState = validateVNextRuntimeState(frontmatter.runtime_state);
  const identity = extractTaskIdentityFromCurrentTask(body);
  const bodyState = extractCurrentTaskStateFromCurrentTask(body);
  if (identity.id !== runtimeState.task_id || identity.slug !== runtimeState.task_slug) {
    fail("RUNTIME_SOURCE_CONFLICT", "CURRENT_TASK body identity conflicts with runtime_state.");
  }
  if (bodyState.workflowStatus !== runtimeState.workflow_status || bodyState.lifecycleState !== runtimeState.lifecycle_state) {
    fail("RUNTIME_SOURCE_CONFLICT", "CURRENT_TASK body lifecycle tuple conflicts with runtime_state.");
  }
  if (bodyState.resumeRequiresReview !== runtimeState.resume_requires_review) {
    fail("RUNTIME_SOURCE_CONFLICT", "CURRENT_TASK body resume gate conflicts with runtime_state.");
  }
  let bodyResumeReasons;
  try {
    bodyResumeReasons = normalizeResumeReviewReasons(bodyState.resumeReviewReasons);
  } catch (error) {
    fail("RUNTIME_SOURCE_CONFLICT", error instanceof Error ? error.message : String(error));
  }
  if (bodyResumeReasons.join("|") !== runtimeState.resume_review_reasons.join("|")) {
    fail("RUNTIME_SOURCE_CONFLICT", "CURRENT_TASK body resume review reasons conflict with runtime_state.");
  }
  const sourceTuple = {
    path: relativePath,
    revision: sha256(raw),
    document_id: documentId,
    task_id: runtimeState.task_id,
    task_slug: runtimeState.task_slug,
    workflow_status: runtimeState.workflow_status,
    lifecycle_state: runtimeState.lifecycle_state,
    active_step_id: runtimeState.active_step_id,
    active_step_status: runtimeState.active_step_status,
    finding_queue_revision: runtimeState.finding_queue_revision,
    resume_requires_review: runtimeState.resume_requires_review,
    resume_review_reasons: [...runtimeState.resume_review_reasons]
  };
  return { filePath, relativePath, raw, frontmatter, body, runtimeState, sourceTuple };
}
function readCanonicalCurrentTask(root) {
  const { filePath, relativePath } = currentTaskPathForRoot(root);
  if (!fs2.existsSync(filePath))
    fail("RUNTIME_SOURCE_MISSING", `CURRENT_TASK.md is missing: ${relativePath}`);
  return parseCanonicalCurrentTaskContent(fs2.readFileSync(filePath, "utf8"), filePath, relativePath);
}
function ensureAuthorityKinds(proposal, required) {
  const kinds = new Set(proposal.authority_evidence.map((item) => item.kind));
  const missing = required.filter((kind) => !kinds.has(kind));
  if (missing.length > 0)
    fail("RUNTIME_AUTHORITY_MISSING", `proposal is missing authority evidence: ${missing.join(", ")}`);
}
function compareSourceTuple(expected, actual) {
  const fields = [
    "path",
    "revision",
    "document_id",
    "task_id",
    "task_slug",
    "workflow_status",
    "lifecycle_state",
    "active_step_id",
    "active_step_status",
    "finding_queue_revision",
    "resume_requires_review",
    "resume_review_reasons"
  ];
  for (const field of fields) {
    if (field === "resume_review_reasons") {
      if (expected[field].join("|") !== actual[field].join("|"))
        return field;
    } else if (expected[field] !== actual[field]) {
      return field;
    }
  }
  return null;
}
function appendAppliedProposal(current, proposal, sourceRevision) {
  return [
    ...current.applied_proposals,
    {
      idempotency_key: proposal.idempotency_key,
      operation_kind: proposal.operation_kind,
      proposal_digest: digest(proposal),
      source_revision: sourceRevision
    }
  ].slice(-MAX_APPLIED_PROPOSALS);
}
function applyTaskStateDelta(current, proposal, now) {
  if (proposal.semantic_delta.kind !== "task-state")
    fail("RUNTIME_SCHEMA_INVALID", "Expected task-state delta.");
  const delta = proposal.semantic_delta;
  if (delta.action === "clear-resume-review-gate") {
    ensureAuthorityKinds(proposal, ["active-task-owner", "resume-review", "evidence-admission"]);
    if (current.runtimeState.workflow_status !== "active" || current.runtimeState.lifecycle_state !== "active") {
      fail("TASK_STATE_NOT_ACTIVE", "resume review can be cleared only after the task has resumed to active + active.");
    }
    if (!current.runtimeState.resume_requires_review)
      return { next: current.runtimeState };
    return {
      next: {
        ...current.runtimeState,
        resume_requires_review: false,
        resume_review_reasons: [],
        applied_proposals: appendAppliedProposal(current.runtimeState, proposal, current.sourceTuple.revision)
      }
    };
  }
  ensureAuthorityKinds(proposal, ["active-task-owner", "scope-admission", "evidence-admission"]);
  if (current.runtimeState.resume_requires_review) {
    fail("RESUME_REVIEW_REQUIRED", "execute-step cannot proceed until prepare-task clears the resume review gate.");
  }
  if (delta.step_id !== current.runtimeState.active_step_id)
    fail("ACTIVE_STEP_CONFLICT", "Proposal step_id does not match the admitted current step.");
  const executionMode = proposal.mode;
  if (executionMode === "repair") {
    if (!delta.repair_fingerprint)
      fail("FINDING_ADMISSION_REQUIRED", "repair mode requires repair_fingerprint.");
    const finding = current.runtimeState.findings.find((item) => item.fingerprint === delta.repair_fingerprint);
    if (!finding || !["admitted", "in-progress"].includes(finding.status))
      fail("FINDING_ADMISSION_REQUIRED", "repair fingerprint is not an admitted current-task finding.");
  }
  const oldStatus = current.runtimeState.active_step_status;
  const newStatus = delta.status;
  const legal = oldStatus === newStatus || oldStatus === "ready" && ["in-progress", "completed", "blocked"].includes(newStatus) || oldStatus === "in-progress" && ["completed", "blocked"].includes(newStatus) || oldStatus === "blocked" && executionMode === "repair" && ["in-progress", "completed"].includes(newStatus);
  if (!legal)
    fail("TASK_STATE_TRANSITION_INVALID", `Cannot transition active step from ${oldStatus} to ${newStatus}.`);
  const executionLog = [
    ...current.runtimeState.execution_log,
    {
      idempotency_key: proposal.idempotency_key,
      mode: executionMode,
      step_id: delta.step_id,
      status: newStatus,
      evidence_refs: [...delta.evidence_refs],
      ...delta.note ? { note: delta.note } : {},
      recorded_at: now
    }
  ].slice(-MAX_EXECUTION_LOG);
  const next = {
    ...current.runtimeState,
    active_step_status: newStatus,
    execution_log: executionLog,
    applied_proposals: appendAppliedProposal(current.runtimeState, proposal, current.sourceTuple.revision)
  };
  return { next, findingStatus: delta.repair_fingerprint ? current.runtimeState.findings.find((item) => item.fingerprint === delta.repair_fingerprint)?.status : undefined };
}
function applyFindingQueueDelta(current, proposal, now) {
  if (proposal.semantic_delta.kind !== "finding-queue")
    fail("RUNTIME_SCHEMA_INVALID", "Expected finding-queue delta.");
  ensureAuthorityKinds(proposal, ["active-task-owner", "scope-admission", "finding-admission", "evidence-admission"]);
  if (current.runtimeState.resume_requires_review) {
    fail("RESUME_REVIEW_REQUIRED", "finding queue changes are blocked until prepare-task clears the resume review gate.");
  }
  const delta = proposal.semantic_delta;
  let findings = current.runtimeState.findings.map((item) => ({ ...item, evidence_refs: [...item.evidence_refs] }));
  let findingStatus;
  let reviewCycle = {
    ...current.runtimeState.review_cycle,
    counted_repair_wave_ids: [...current.runtimeState.review_cycle.counted_repair_wave_ids]
  };
  if (delta.action === "admit") {
    const candidate = delta.finding;
    if (candidate.owner_task_id !== current.runtimeState.task_id)
      fail("FINDING_OWNER_CONFLICT", "finding owner_task_id must match the active task.");
    if (findings.some((item) => item.fingerprint === candidate.fingerprint)) {
      const existing = findings.find((item) => item.fingerprint === candidate.fingerprint);
      const equivalent = existing.owner_task_id === candidate.owner_task_id && existing.file === candidate.file && existing.failure_condition === candidate.failure_condition && existing.violated_invariant === candidate.violated_invariant;
      if (equivalent)
        return { next: current.runtimeState, findingStatus: existing.status };
      fail("FINDING_DUPLICATE_CONFLICT", `finding fingerprint ${candidate.fingerprint} already exists with different semantics.`);
    }
    if (reviewCycle.id !== candidate.review_cycle_id) {
      const hasOpenFindings = findings.some((item) => item.status === "admitted" || item.status === "in-progress");
      if (hasOpenFindings) {
        fail("REVIEW_CYCLE_NOT_CONVERGED", "A new review cycle may start only after all admitted and in-progress findings in the current cycle are terminal.");
      }
      reviewCycle = {
        id: candidate.review_cycle_id,
        cycle_phase: "discovery",
        repair_round: 0,
        counted_repair_wave_ids: [],
        active_repair_wave_id: null,
        verification_new_finding_wave_used: false,
        verification_new_finding_wave_id: null
      };
    }
    if (delta.cycle_phase === "discovery") {
      if (reviewCycle.cycle_phase !== "discovery" || reviewCycle.repair_round > 0) {
        fail("REVIEW_CYCLE_PHASE_CONFLICT", "Discovery admission is closed after repair or verification; use the bounded verification admission wave.");
      }
    } else {
      if (reviewCycle.repair_round === 0) {
        fail("REVIEW_CYCLE_PHASE_CONFLICT", "Verification admission requires at least one completed repair round.");
      }
      if (reviewCycle.verification_new_finding_wave_used) {
        if (reviewCycle.verification_new_finding_wave_id !== delta.finding_admission_wave_id) {
          fail("NEW_FINDING_WAVE_BUDGET_EXHAUSTED", "This review cycle has already used its one verification new-finding admission wave.");
        }
      } else {
        reviewCycle = {
          ...reviewCycle,
          cycle_phase: "verification",
          active_repair_wave_id: null,
          verification_new_finding_wave_used: true,
          verification_new_finding_wave_id: delta.finding_admission_wave_id
        };
      }
    }
    const finding = {
      ...candidate,
      status: "admitted",
      repair_attempts: 0,
      last_repair_wave_id: null,
      admitted_at: now,
      updated_at: now,
      evidence_refs: [...candidate.evidence_refs]
    };
    findings.push(finding);
    findingStatus = finding.status;
  } else {
    const index = findings.findIndex((item) => item.fingerprint === delta.fingerprint);
    if (index < 0)
      fail("FINDING_NOT_FOUND", `finding ${delta.fingerprint} is not present in the current queue.`);
    const finding = findings[index];
    if (delta.action === "record-repair-attempt") {
      if (proposal.mode !== "repair")
        fail("RUNTIME_MODE_INVALID", "record-repair-attempt requires execute-step:repair.");
      if (!["admitted", "in-progress"].includes(finding.status))
        fail("FINDING_STATE_INVALID", `finding ${finding.fingerprint} is not repairable from ${finding.status}.`);
      if (finding.repair_attempts >= finding.max_repair_attempts)
        fail("REPAIR_BUDGET_EXHAUSTED", `finding ${finding.fingerprint} has exhausted its repair budget.`);
      if (delta.review_cycle_id !== reviewCycle.id) {
        fail("REVIEW_CYCLE_CONFLICT", "record-repair-attempt must target the current review cycle; only finding admission may start a new cycle.");
      }
      if (finding.review_cycle_id !== reviewCycle.id) {
        fail("REVIEW_CYCLE_CONFLICT", `finding ${finding.fingerprint} does not belong to the current review cycle.`);
      }
      if (reviewCycle.counted_repair_wave_ids.includes(delta.repair_wave_id) && reviewCycle.active_repair_wave_id !== delta.repair_wave_id) {
        fail("REPAIR_WAVE_CLOSED", `repair wave ${delta.repair_wave_id} has already ended and cannot be reused.`);
      }
      if (finding.last_repair_wave_id === delta.repair_wave_id) {
        fail("REPAIR_WAVE_FINDING_DUPLICATE", `finding ${finding.fingerprint} already has an attempt in repair wave ${delta.repair_wave_id}.`);
      }
      if (reviewCycle.active_repair_wave_id !== delta.repair_wave_id) {
        if (reviewCycle.repair_round >= MAX_REPAIR_ROUNDS)
          fail("REPAIR_BUDGET_EXHAUSTED", "review-cycle repair round budget is exhausted.");
        reviewCycle = {
          ...reviewCycle,
          repair_round: reviewCycle.repair_round + 1,
          counted_repair_wave_ids: [...reviewCycle.counted_repair_wave_ids, delta.repair_wave_id],
          active_repair_wave_id: delta.repair_wave_id
        };
      }
      if (reviewCycle.verification_new_finding_wave_id !== null) {
        reviewCycle = { ...reviewCycle, verification_new_finding_wave_id: null };
      }
      finding.repair_attempts += 1;
      finding.last_repair_wave_id = delta.repair_wave_id;
      finding.status = "in-progress";
      finding.updated_at = now;
      finding.evidence_refs = [...new Set([...finding.evidence_refs, ...delta.evidence_refs])];
    } else if (delta.action === "resolve") {
      if (proposal.mode !== "repair")
        fail("RUNTIME_MODE_INVALID", "resolve requires execute-step:repair.");
      if (!["admitted", "in-progress"].includes(finding.status))
        fail("FINDING_STATE_INVALID", `finding ${finding.fingerprint} is not resolvable from ${finding.status}.`);
      finding.status = "resolved";
      finding.updated_at = now;
      finding.evidence_refs = [...new Set([...finding.evidence_refs, ...delta.evidence_refs])];
    } else {
      if (proposal.mode !== "repair")
        fail("RUNTIME_MODE_INVALID", `${delta.action} requires execute-step:repair.`);
      if (!["admitted", "in-progress"].includes(finding.status))
        fail("FINDING_STATE_INVALID", `finding ${finding.fingerprint} cannot be ${delta.action} from ${finding.status}.`);
      finding.status = delta.action === "defer" ? "deferred" : "rejected";
      finding.updated_at = now;
      finding.evidence_refs = [...new Set([...finding.evidence_refs, ...delta.evidence_refs])];
    }
    findingStatus = finding.status;
  }
  const next = {
    ...current.runtimeState,
    finding_queue_revision: current.runtimeState.finding_queue_revision + 1,
    review_cycle: reviewCycle,
    findings,
    applied_proposals: appendAppliedProposal(current.runtimeState, proposal, current.sourceTuple.revision)
  };
  return { next, findingStatus };
}
var SUSPENDED_PACKAGE_BEGIN = "<!-- BEGIN vNext CURRENT_TASK snapshot -->";
var SUSPENDED_PACKAGE_END = "<!-- END vNext CURRENT_TASK snapshot -->";
function packageText(value, location) {
  const result = expectText(value, location);
  if (/[\r\n]/.test(result))
    fail("RUNTIME_SCHEMA_INVALID", `${location} must be a single-line value in a suspended package.`);
  return result;
}
function extractSuspendedPackageFields(header, location) {
  const fields = {};
  for (const line of header.split(/\r?\n/)) {
    const match = /^\s*-\s*([a-z][a-z0-9_]*)\s*:\s*(.*?)\s*$/.exec(line);
    if (!match)
      continue;
    if (match[1] in fields)
      fail("RUNTIME_SCHEMA_INVALID", `${location} contains duplicate field ${match[1]}.`);
    fields[match[1]] = match[2].trim();
  }
  return fields;
}
function requiredPackageField(fields, field, location) {
  const value = fields[field];
  if (value === undefined || value.trim().length === 0)
    fail("RUNTIME_SCHEMA_INVALID", `${location} is missing required field ${field}.`);
  return value.trim();
}
function packagePathForTask(root, taskId, taskSlug, artifactKind) {
  let relativePath;
  try {
    relativePath = getTaskArtifactPath(taskId, taskSlug, artifactKind);
  } catch (error) {
    fail("RUNTIME_PATH_INVALID", error instanceof Error ? error.message : String(error));
  }
  const filePath = path3.resolve(path3.resolve(root), ...relativePath.split("/"));
  const resolvedRoot = path3.resolve(root);
  const relativeCheck = path3.relative(resolvedRoot, filePath).replace(/\\/g, "/");
  if (relativeCheck !== relativePath || relativeCheck.startsWith("../") || path3.isAbsolute(relativeCheck)) {
    fail("RUNTIME_PATH_INVALID", `suspended package path escapes the target root: ${relativePath}`);
  }
  return { filePath, relativePath };
}
function replacePackageField(content, field, value) {
  const pattern = new RegExp(`^-\\s*${field.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}\\s*:\\s*[^\\r\\n]*$`, "gm");
  const matches = content.match(pattern) ?? [];
  if (matches.length !== 1)
    fail("RUNTIME_SCHEMA_INVALID", `suspended package must contain exactly one ${field} field.`);
  return content.replace(pattern, `- ${field}: ${value}`);
}
function parseSuspendedPackage(root, current, relativePath, expectedKind) {
  const normalizedPath = normalizeRepoPath(relativePath, "suspended package path");
  const pathMatch = /^TASKS\/(paused|interrupted)\/TASK-([0-9]{3,})-([a-z0-9]+(?:-[a-z0-9]+)*)\.md$/.exec(normalizedPath);
  if (!pathMatch)
    fail("RUNTIME_PATH_INVALID", `suspended package path is outside the paused/interrupted contract: ${normalizedPath}`);
  const pathKind = pathMatch[1];
  const pathTaskId = pathMatch[2];
  const pathTaskSlug = pathMatch[3];
  if (expectedKind && pathKind !== expectedKind)
    fail("RUNTIME_PATH_INVALID", `suspended package path kind ${pathKind} does not match ${expectedKind}.`);
  if (pathTaskId !== current.runtimeState.task_id || pathTaskSlug !== current.runtimeState.task_slug) {
    fail("RUNTIME_IDENTITY_CONFLICT", "suspended package path identity does not match the canonical current task.");
  }
  const canonicalExpectedPath = packagePathForTask(root, pathTaskId, pathTaskSlug, pathKind);
  if (normalizedPath !== canonicalExpectedPath.relativePath)
    fail("RUNTIME_PATH_INVALID", "suspended package path is not the canonical identity-derived path.");
  const filePath = canonicalExpectedPath.filePath;
  if (!fs2.existsSync(filePath))
    fail("SUSPENDED_PACKAGE_MISSING", `suspended package is missing: ${normalizedPath}`);
  const raw = fs2.readFileSync(filePath, "utf8");
  if (raw.split(SUSPENDED_PACKAGE_BEGIN).length !== 2 || raw.split(SUSPENDED_PACKAGE_END).length !== 2) {
    fail("SUSPENDED_PACKAGE_INVALID", `${normalizedPath} must contain exactly one complete CURRENT_TASK snapshot.`);
  }
  const beginIndex = raw.indexOf(SUSPENDED_PACKAGE_BEGIN);
  const endIndex = raw.indexOf(SUSPENDED_PACKAGE_END);
  if (beginIndex < 0 || endIndex <= beginIndex)
    fail("SUSPENDED_PACKAGE_INVALID", `${normalizedPath} has an invalid snapshot marker order.`);
  const header = raw.slice(0, beginIndex);
  const fields = extractSuspendedPackageFields(header, normalizedPath);
  const taskId = requiredPackageField(fields, "task_id", normalizedPath);
  const taskTitle = packageText(requiredPackageField(fields, "task_title", normalizedPath), `${normalizedPath}.task_title`);
  const taskSlug = requiredPackageField(fields, "task_slug", normalizedPath);
  try {
    validateTaskId(taskId);
    validateTaskSlug(taskSlug);
  } catch (error) {
    fail("RUNTIME_SCHEMA_INVALID", error instanceof Error ? error.message : String(error));
  }
  if (taskId !== pathTaskId || taskSlug !== pathTaskSlug)
    fail("RUNTIME_IDENTITY_CONFLICT", "suspended package fields do not match its canonical path.");
  const artifactKind = expectEnum(requiredPackageField(fields, "artifact_kind", normalizedPath), ["paused", "interrupted"], `${normalizedPath}.artifact_kind`);
  if (artifactKind !== pathKind)
    fail("SUSPENDED_PACKAGE_INVALID", "suspended package artifact_kind does not match its path.");
  const lifecycleState = expectEnum(requiredPackageField(fields, "lifecycle_state", normalizedPath), ["paused_pending_closure", "paused_blocked", "interrupted"], `${normalizedPath}.lifecycle_state`);
  if (artifactKind === "paused" && !["paused_pending_closure", "paused_blocked"].includes(lifecycleState) || artifactKind === "interrupted" && lifecycleState !== "interrupted") {
    fail("SUSPENDED_PACKAGE_INVALID", "suspended package lifecycle_state does not match artifact_kind.");
  }
  const resumeRequiresReview = parseBooleanField(requiredPackageField(fields, "resume_requires_review", normalizedPath), `${normalizedPath}.resume_requires_review`);
  const rawResumeReviewReasons = requiredPackageField(fields, "resume_review_reasons", normalizedPath).split(",").map((reason) => reason.trim()).filter(Boolean);
  const resumeReviewReasons = normalizeResumeReviewReasons(rawResumeReviewReasons);
  if (rawResumeReviewReasons.join("|") !== resumeReviewReasons.join("|")) {
    fail("SUSPENDED_PACKAGE_INVALID", `${normalizedPath}.resume_review_reasons must use the canonical closed-set order without duplicates.`);
  }
  try {
    validateCurrentTaskResumeGate(lifecycleState, resumeRequiresReview, resumeReviewReasons);
  } catch (error) {
    fail("SUSPENDED_PACKAGE_INVALID", error instanceof Error ? error.message : String(error));
  }
  const rehydrationStatus = expectEnum(requiredPackageField(fields, "rehydration_status", normalizedPath), ["write_incomplete", "ready_for_resume", "rehydrated"], `${normalizedPath}.rehydration_status`);
  const ownershipState = expectEnum(requiredPackageField(fields, "ownership_state", normalizedPath), ["recovery_only", "rehydrated"], `${normalizedPath}.ownership_state`);
  if (rehydrationStatus === "write_incomplete" && ownershipState !== "recovery_only")
    fail("SUSPENDED_PACKAGE_INVALID", "write_incomplete package must remain recovery_only.");
  if (rehydrationStatus === "ready_for_resume" && (ownershipState !== "recovery_only" || !resumeRequiresReview))
    fail("SUSPENDED_PACKAGE_INVALID", "ready_for_resume package must be recovery_only and review-gated.");
  if (rehydrationStatus === "rehydrated" && ownershipState !== "rehydrated")
    fail("SUSPENDED_PACKAGE_INVALID", "rehydrated package must use ownership_state=rehydrated.");
  const documentId = requiredPackageField(fields, "document_id", normalizedPath);
  if (!DOCUMENT_ID_PATTERN.test(documentId))
    fail("RUNTIME_SCHEMA_INVALID", `${normalizedPath}.document_id is invalid.`);
  const snapshotSha256 = requiredPackageField(fields, "snapshot_sha256", normalizedPath);
  if (!/^[a-f0-9]{64}$/.test(snapshotSha256))
    fail("RUNTIME_SCHEMA_INVALID", `${normalizedPath}.snapshot_sha256 must be SHA-256.`);
  let snapshotStart = beginIndex + SUSPENDED_PACKAGE_BEGIN.length;
  if (raw.startsWith(`\r
`, snapshotStart))
    snapshotStart += 2;
  else if (raw.startsWith(`
`, snapshotStart))
    snapshotStart += 1;
  const snapshotRegion = raw.slice(snapshotStart, endIndex);
  const snapshotCandidates = [snapshotRegion, snapshotRegion.endsWith(`
`) ? snapshotRegion.slice(0, -1) : snapshotRegion];
  const snapshotRaw = snapshotCandidates.find((candidate) => sha256(candidate) === snapshotSha256);
  if (snapshotRaw === undefined)
    fail("SUSPENDED_PACKAGE_INVALID", `${normalizedPath} snapshot_sha256 does not match the embedded CURRENT_TASK snapshot.`);
  const snapshot = parseCanonicalCurrentTaskContent(snapshotRaw, current.filePath, current.relativePath);
  if (snapshot.frontmatter.document_id !== documentId || snapshot.frontmatter.document_id !== current.frontmatter.document_id) {
    fail("RUNTIME_SOURCE_CONFLICT", "suspended package document_id conflicts with CURRENT_TASK or its snapshot.");
  }
  if (snapshot.runtimeState.task_id !== taskId || snapshot.runtimeState.task_slug !== taskSlug || snapshot.runtimeState.workflow_status !== "active" || snapshot.runtimeState.lifecycle_state !== "active") {
    fail("SUSPENDED_PACKAGE_INVALID", "suspended package snapshot must preserve the same active task before suspension.");
  }
  const snapshotIdentity = extractTaskIdentityFromCurrentTask(snapshot.body);
  if (snapshotIdentity.title !== taskTitle)
    fail("RUNTIME_SOURCE_CONFLICT", "suspended package task_title conflicts with its snapshot.");
  const taskStartBase = packageText(requiredPackageField(fields, "task_start_base", normalizedPath), `${normalizedPath}.task_start_base`);
  const lastReviewedCheckpoint = packageText(requiredPackageField(fields, "last_reviewed_checkpoint", normalizedPath), `${normalizedPath}.last_reviewed_checkpoint`);
  const currentDiffReviewTarget = packageText(requiredPackageField(fields, "current_diff_review_target", normalizedPath), `${normalizedPath}.current_diff_review_target`);
  const rollbackConditions = packageText(requiredPackageField(fields, "rollback_conditions", normalizedPath), `${normalizedPath}.rollback_conditions`);
  const suspensionReason = packageText(requiredPackageField(fields, "suspension_reason", normalizedPath), `${normalizedPath}.suspension_reason`);
  if (lifecycleState === "paused_blocked") {
    packageText(requiredPackageField(fields, "blocker_status", normalizedPath), `${normalizedPath}.blocker_status`);
    packageText(requiredPackageField(fields, "blocking_evidence", normalizedPath), `${normalizedPath}.blocking_evidence`);
    packageText(requiredPackageField(fields, "remaining_acceptance", normalizedPath), `${normalizedPath}.remaining_acceptance`);
  }
  if (artifactKind === "interrupted") {
    packageText(requiredPackageField(fields, "checkpoint_evidence", normalizedPath), `${normalizedPath}.checkpoint_evidence`);
    packageText(requiredPackageField(fields, "dirty_attribution", normalizedPath), `${normalizedPath}.dirty_attribution`);
    packageText(requiredPackageField(fields, "environment_state", normalizedPath), `${normalizedPath}.environment_state`);
    packageText(requiredPackageField(fields, "recovery_strategy", normalizedPath), `${normalizedPath}.recovery_strategy`);
  }
  return {
    filePath,
    relativePath: normalizedPath,
    raw,
    revision: sha256(raw),
    taskId,
    taskTitle,
    taskSlug,
    artifactKind,
    lifecycleState,
    suspensionReason,
    taskStartBase,
    lastReviewedCheckpoint,
    currentDiffReviewTarget,
    rollbackConditions,
    resumeRequiresReview,
    resumeReviewReasons,
    rehydrationStatus,
    ownershipState,
    documentId,
    snapshotSha256,
    snapshot
  };
}
function renderSuspendedPackage(current, delta, artifactKind) {
  const identity = extractTaskIdentityFromCurrentTask(current.body);
  const taskTitle = packageText(identity.title, "CURRENT_TASK task title");
  const fields = [
    "# vNext suspended task package",
    "",
    `- task_id: ${current.runtimeState.task_id}`,
    `- task_title: ${taskTitle}`,
    `- task_slug: ${current.runtimeState.task_slug}`,
    `- artifact_kind: ${artifactKind}`,
    `- lifecycle_state: ${delta.lifecycle_state}`,
    `- suspension_reason: ${packageText(delta.suspension_reason, "semantic_delta.suspension_reason")}`,
    `- task_start_base: ${packageText(delta.task_start_base, "semantic_delta.task_start_base")}`,
    `- last_reviewed_checkpoint: ${packageText(delta.last_reviewed_checkpoint, "semantic_delta.last_reviewed_checkpoint")}`,
    `- current_diff_review_target: ${packageText(delta.current_diff_review_target, "semantic_delta.current_diff_review_target")}`,
    `- rollback_conditions: ${packageText(delta.rollback_conditions, "semantic_delta.rollback_conditions")}`,
    "- resume_requires_review: true",
    `- resume_review_reasons: ${delta.resume_review_reasons.join(", ")}`,
    "- rehydration_status: ready_for_resume",
    "- ownership_state: recovery_only",
    `- document_id: ${String(current.frontmatter.document_id)}`,
    `- snapshot_sha256: ${sha256(current.raw)}`
  ];
  if (delta.action === "pause" && delta.lifecycle_state === "paused_blocked") {
    fields.push(`- blocker_status: ${packageText(delta.blocker_status, "semantic_delta.blocker_status")}`);
    fields.push(`- blocking_evidence: ${packageText(delta.blocking_evidence, "semantic_delta.blocking_evidence")}`);
    fields.push(`- remaining_acceptance: ${packageText(delta.remaining_acceptance, "semantic_delta.remaining_acceptance")}`);
    if (delta.failed_checks && delta.failed_checks.length > 0)
      fields.push(`- failed_checks: ${delta.failed_checks.join(", ")}`);
  }
  if (delta.action === "interrupt") {
    fields.push(`- checkpoint_evidence: ${packageText(delta.checkpoint_evidence, "semantic_delta.checkpoint_evidence")}`);
    fields.push(`- dirty_attribution: ${packageText(delta.dirty_attribution, "semantic_delta.dirty_attribution")}`);
    fields.push(`- environment_state: ${packageText(delta.environment_state, "semantic_delta.environment_state")}`);
    fields.push(`- recovery_strategy: ${packageText(delta.recovery_strategy, "semantic_delta.recovery_strategy")}`);
  }
  const snapshot = current.raw;
  return `${fields.join(`
`)}

${SUSPENDED_PACKAGE_BEGIN}
${snapshot}${snapshot.endsWith(`
`) ? "" : `
`}${SUSPENDED_PACKAGE_END}
`;
}
function renderRehydratedPackage(packageArtifact) {
  let content = packageArtifact.raw;
  content = replacePackageField(content, "rehydration_status", "rehydrated");
  content = replacePackageField(content, "ownership_state", "rehydrated");
  return content;
}
function assertSuspendedSourceMatchesSnapshot(current, snapshot) {
  const currentRuntimeState = {
    ...current.runtimeState,
    workflow_status: snapshot.runtimeState.workflow_status,
    lifecycle_state: snapshot.runtimeState.lifecycle_state,
    resume_requires_review: snapshot.runtimeState.resume_requires_review,
    resume_review_reasons: [...snapshot.runtimeState.resume_review_reasons],
    applied_proposals: [...snapshot.runtimeState.applied_proposals]
  };
  if (digest(currentRuntimeState) !== digest(snapshot.runtimeState)) {
    fail("LIFECYCLE_SOURCE_CONFLICT", "suspended CURRENT_TASK runtime_state differs from the recovery snapshot.");
  }
  const currentFrontmatter = { ...current.frontmatter };
  const snapshotFrontmatter = { ...snapshot.frontmatter };
  delete currentFrontmatter.runtime_state;
  delete snapshotFrontmatter.runtime_state;
  if (digest(currentFrontmatter) !== digest(snapshotFrontmatter)) {
    fail("LIFECYCLE_SOURCE_CONFLICT", "suspended CURRENT_TASK frontmatter differs from the recovery snapshot.");
  }
  const normalizedCurrentBody = renderCurrentTaskLifecycleFields(current.body, snapshot.runtimeState);
  const normalizedSnapshotBody = renderCurrentTaskLifecycleFields(snapshot.body, snapshot.runtimeState);
  if (normalizedCurrentBody !== normalizedSnapshotBody) {
    fail("LIFECYCLE_SOURCE_CONFLICT", "suspended CURRENT_TASK body differs from the recovery snapshot.");
  }
}
function assertSuspendedGateMatchesPackage(current, packageArtifact) {
  if (current.runtimeState.resume_requires_review !== packageArtifact.resumeRequiresReview || current.runtimeState.resume_review_reasons.join("|") !== packageArtifact.resumeReviewReasons.join("|")) {
    fail("RESUME_GATE_DRIFT", "CURRENT_TASK resume gate differs from the suspended package gate.");
  }
}
function lifecycleArtifactKind(delta) {
  if (delta.action === "pause")
    return "paused";
  if (delta.action === "interrupt")
    return "interrupted";
  if (delta.action === "resume-paused" || delta.action === "resume-interrupted")
    return delta.artifact_kind;
  return null;
}
function assertLifecycleReplayArtifacts(root, current, proposal) {
  const delta = proposal.semantic_delta;
  const artifactKind = lifecycleArtifactKind(delta);
  if (artifactKind === null)
    return;
  const expected = packagePathForTask(root, current.runtimeState.task_id, current.runtimeState.task_slug, artifactKind);
  const packageArtifact = parseSuspendedPackage(root, current, expected.relativePath, artifactKind);
  if (delta.action === "pause" || delta.action === "interrupt") {
    if (packageArtifact.rehydrationStatus !== "ready_for_resume" || packageArtifact.ownershipState !== "recovery_only") {
      fail("LIFECYCLE_REPLAY_INCOMPLETE", "lifecycle replay requires the original suspended package to remain ready_for_resume + recovery_only.");
    }
    if (current.runtimeState.workflow_status !== "suspended" || current.runtimeState.lifecycle_state !== delta.lifecycle_state) {
      fail("LIFECYCLE_REPLAY_INCOMPLETE", "lifecycle replay no longer has the original suspended CURRENT_TASK tuple.");
    }
    if (packageArtifact.lifecycleState !== delta.lifecycle_state) {
      fail("LIFECYCLE_REPLAY_INCOMPLETE", "lifecycle replay package marker does not match the original transition.");
    }
    assertSuspendedGateMatchesPackage(current, packageArtifact);
    return;
  }
  if (packageArtifact.rehydrationStatus !== "rehydrated" || packageArtifact.ownershipState !== "rehydrated") {
    fail("LIFECYCLE_REPLAY_INCOMPLETE", "resume replay requires the suspended package to remain rehydrated + rehydrated.");
  }
  if (current.runtimeState.workflow_status !== "active" || current.runtimeState.lifecycle_state !== "active") {
    fail("LIFECYCLE_REPLAY_INCOMPLETE", "resume replay no longer has an active + active CURRENT_TASK tuple.");
  }
}
function assertSiblingRecoveryIsReconciled(root, current, artifactKind) {
  const siblingKind = artifactKind === "paused" ? "interrupted" : "paused";
  const sibling = packagePathForTask(root, current.runtimeState.task_id, current.runtimeState.task_slug, siblingKind);
  if (!fs2.existsSync(sibling.filePath))
    return;
  const siblingArtifact = parseSuspendedPackage(root, current, sibling.relativePath, siblingKind);
  if (siblingArtifact.rehydrationStatus === "rehydrated" && siblingArtifact.ownershipState === "rehydrated")
    return;
  fail("SUSPENDED_PACKAGE_AMBIGUOUS", "another ready or incomplete suspended package for the same task is present; reconcile the sibling before continuing.");
}
function prepareExistingPackageForReplacement(root, current, packageRelativePath, artifactKind) {
  const expected = packagePathForTask(root, current.runtimeState.task_id, current.runtimeState.task_slug, artifactKind);
  if (!fs2.existsSync(expected.filePath))
    return;
  const existing = parseSuspendedPackage(root, current, packageRelativePath, artifactKind);
  if (existing.rehydrationStatus === "rehydrated" && existing.ownershipState === "rehydrated")
    return existing.raw;
  if (existing.rehydrationStatus === "write_incomplete") {
    fail("SUSPENDED_PACKAGE_RECOVERY_REQUIRED", "the existing suspended package is write_incomplete and requires explicit recovery before replacement.");
  }
  fail("SUSPENDED_PACKAGE_CONFLICT", `suspended package is already ready_for_resume: ${packageRelativePath}`);
}
function assertRequestedLifecycleTargets(root, current, proposal) {
  if (proposal.requested_write_targets[0] !== current.relativePath)
    fail("RUNTIME_PATH_INVALID", "lifecycle proposal must target the exact canonical CURRENT_TASK path first.");
  const delta = proposal.semantic_delta;
  if (delta.action === "supersede") {
    if (proposal.requested_write_targets.length !== 1)
      fail("RUNTIME_PATH_INVALID", "supersede remains a proposal-only current-task route in Slice A.");
    return {};
  }
  const artifactKind = delta.action === "pause" ? "paused" : delta.action === "interrupt" ? "interrupted" : delta.artifact_kind;
  const expected = packagePathForTask(root, current.runtimeState.task_id, current.runtimeState.task_slug, artifactKind);
  if (delta.action === "resume-paused" || delta.action === "resume-interrupted") {
    if (delta.recovery_package_path !== expected.relativePath)
      fail("RUNTIME_PATH_INVALID", "resume must use the exact identity-derived suspended package path.");
  }
  if (proposal.requested_write_targets.length !== 2 || proposal.requested_write_targets[1] !== expected.relativePath) {
    fail("RUNTIME_PATH_INVALID", "lifecycle proposal must name exactly CURRENT_TASK.md and its identity-derived suspended package path.");
  }
  return { packageFilePath: expected.filePath, packageRelativePath: expected.relativePath };
}
function prepareLifecycleTransaction(root, current, proposal) {
  const delta = proposal.semantic_delta;
  if (delta.action === "supersede") {
    ensureAuthorityKinds(proposal, ["active-task-owner", "evidence-admission"]);
    fail("LIFECYCLE_MODE_UNBOUND", "supersede remains contract-only until Slice B with prepare-task:replan.");
  }
  const target = assertRequestedLifecycleTargets(root, current, proposal);
  const packageFilePath = target.packageFilePath;
  const packageRelativePath = target.packageRelativePath;
  const activeTuple = current.runtimeState.workflow_status === "active" && current.runtimeState.lifecycle_state === "active";
  if (delta.action === "pause" || delta.action === "interrupt") {
    ensureAuthorityKinds(proposal, ["active-task-owner", "scope-admission", "evidence-admission"]);
    if (!activeTuple)
      fail("LIFECYCLE_TRANSITION_INVALID", `${delta.action} requires the current task to be active + active.`);
    assertSiblingRecoveryIsReconciled(root, current, delta.action === "pause" ? "paused" : "interrupted");
    const originalPackageContent = prepareExistingPackageForReplacement(root, current, packageRelativePath, delta.action === "pause" ? "paused" : "interrupted");
    const next2 = {
      ...current.runtimeState,
      workflow_status: "suspended",
      lifecycle_state: delta.lifecycle_state,
      resume_requires_review: true,
      resume_review_reasons: [...delta.resume_review_reasons],
      applied_proposals: appendAppliedProposal(current.runtimeState, proposal, current.sourceTuple.revision)
    };
    const nextContent2 = renderCanonicalCurrentTask(current.frontmatter, current.body, next2);
    const nextPackageContent2 = renderSuspendedPackage(current, delta, delta.action === "pause" ? "paused" : "interrupted");
    return { next: next2, nextContent: nextContent2, packageFilePath, packageRelativePath, nextPackageContent: nextPackageContent2, ...originalPackageContent === undefined ? {} : { originalPackageContent } };
  }
  ensureAuthorityKinds(proposal, ["resume-review", "evidence-admission"]);
  if (current.runtimeState.workflow_status !== "suspended")
    fail("LIFECYCLE_TRANSITION_INVALID", "resume requires a suspended CURRENT_TASK source.");
  const expectedLifecycle = delta.action === "resume-paused" ? ["paused_pending_closure", "paused_blocked"] : ["interrupted"];
  if (!expectedLifecycle.includes(current.runtimeState.lifecycle_state))
    fail("LIFECYCLE_TRANSITION_INVALID", "resume mode does not match the current suspended lifecycle state.");
  if (!fs2.existsSync(packageFilePath))
    fail("SUSPENDED_PACKAGE_MISSING", `suspended package is missing: ${packageRelativePath}`);
  const packageArtifact = parseSuspendedPackage(root, current, packageRelativePath, delta.artifact_kind);
  if (packageArtifact.rehydrationStatus !== "ready_for_resume" || packageArtifact.ownershipState !== "recovery_only") {
    fail("SUSPENDED_PACKAGE_NOT_READY", "resume accepts only ready_for_resume + recovery_only packages.");
  }
  if (packageArtifact.revision !== delta.recovery_package_revision) {
    fail("RECOVERY_PACKAGE_STALE", "the suspended package changed after the resume proposal was created.");
  }
  assertSuspendedGateMatchesPackage(current, packageArtifact);
  assertSuspendedSourceMatchesSnapshot(current, packageArtifact.snapshot);
  if (packageArtifact.lifecycleState !== current.runtimeState.lifecycle_state)
    fail("LIFECYCLE_SOURCE_CONFLICT", "package lifecycle state conflicts with CURRENT_TASK.");
  if (packageArtifact.resumeReviewReasons.join("|") !== delta.resume_review_reasons.join("|"))
    fail("RESUME_GATE_DRIFT", "resume review reasons drifted between proposal and suspended package.");
  assertSiblingRecoveryIsReconciled(root, current, delta.artifact_kind);
  if (packageArtifact.documentId !== String(current.frontmatter.document_id))
    fail("RUNTIME_SOURCE_CONFLICT", "resume package document_id conflicts with CURRENT_TASK.");
  const next = {
    ...packageArtifact.snapshot.runtimeState,
    workflow_status: "active",
    lifecycle_state: "active",
    resume_requires_review: true,
    resume_review_reasons: [...packageArtifact.resumeReviewReasons],
    applied_proposals: appendAppliedProposal(current.runtimeState, proposal, current.sourceTuple.revision)
  };
  const nextContent = renderCanonicalCurrentTask(packageArtifact.snapshot.frontmatter, packageArtifact.snapshot.body, next);
  const nextPackageContent = renderRehydratedPackage(packageArtifact);
  return {
    next,
    nextContent,
    packageFilePath,
    packageRelativePath,
    nextPackageContent,
    originalPackageContent: packageArtifact.raw
  };
}
function buildResult(status, proposal, current, options, message, extras = {}) {
  return {
    status,
    operation_kind: proposal.operation_kind,
    idempotency_key: proposal.idempotency_key,
    target_path: current.relativePath,
    dry_run: options.dryRun === true,
    committed: false,
    message,
    planned_writes: [...proposal.requested_write_targets],
    governed_mutation_count: 0,
    read_back_verified: false,
    ...extras
  };
}
function resultState(state, findingStatus, recoveryPackagePath) {
  return {
    task_id: state.task_id,
    workflow_status: state.workflow_status,
    lifecycle_state: state.lifecycle_state,
    resume_requires_review: state.resume_requires_review,
    resume_review_reasons: [...state.resume_review_reasons],
    active_step_id: state.active_step_id,
    active_step_status: state.active_step_status,
    finding_queue_revision: state.finding_queue_revision,
    review_cycle_id: state.review_cycle.id,
    repair_round: state.review_cycle.repair_round,
    ...findingStatus === undefined ? {} : { finding_status: findingStatus },
    ...recoveryPackagePath === undefined ? {} : { recovery_package_path: recoveryPackagePath }
  };
}
function rollbackCurrentTaskAndVerify(root, current, readCurrentTask) {
  try {
    executeWrites([{ path: current.filePath, content: current.raw }], false, "vNext Runtime rollback after read-back failure");
  } catch (error) {
    return {
      verified: false,
      detail: `rollback failed: ${error instanceof Error ? error.message : String(error)}`
    };
  }
  try {
    const rollbackReadBack = readCurrentTask(root);
    if (rollbackReadBack.raw !== current.raw || rollbackReadBack.sourceTuple.revision !== current.sourceTuple.revision) {
      return {
        verified: false,
        detail: "rollback read-back did not restore the original canonical document."
      };
    }
    return { verified: true, detail: "rollback read-back verified." };
  } catch (error) {
    return {
      verified: false,
      detail: `rollback read-back failed: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}
function rollbackLifecycleTransactionAndVerify(root, current, plan, readCurrentTask) {
  try {
    const rollbackOperations = [{ path: current.filePath, content: current.raw }];
    if (plan.originalPackageContent !== undefined) {
      rollbackOperations.push({ path: plan.packageFilePath, content: plan.originalPackageContent });
    }
    executeWrites(rollbackOperations, false, "vNext Runtime lifecycle rollback after read-back failure");
    if (plan.originalPackageContent === undefined && fs2.existsSync(plan.packageFilePath)) {
      fs2.rmSync(plan.packageFilePath, { force: true });
    }
  } catch (error) {
    return {
      verified: false,
      detail: `rollback failed: ${error instanceof Error ? error.message : String(error)}`
    };
  }
  try {
    const rollbackReadBack = readCurrentTask(root);
    if (rollbackReadBack.raw !== current.raw || rollbackReadBack.sourceTuple.revision !== current.sourceTuple.revision) {
      return { verified: false, detail: "rollback read-back did not restore the original canonical CURRENT_TASK document." };
    }
    const packageExists = fs2.existsSync(plan.packageFilePath);
    if (plan.originalPackageContent === undefined) {
      if (packageExists)
        return { verified: false, detail: "rollback read-back left a newly-created suspended package behind." };
    } else if (!packageExists || fs2.readFileSync(plan.packageFilePath, "utf8") !== plan.originalPackageContent) {
      return { verified: false, detail: "rollback read-back did not restore the original suspended package." };
    }
    return { verified: true, detail: "rollback read-back verified." };
  } catch (error) {
    return { verified: false, detail: `rollback read-back failed: ${error instanceof Error ? error.message : String(error)}` };
  }
}

class GovernanceTransactionKernel {
  root;
  readCurrentTask;
  constructor(root, readCurrentTask = readCanonicalCurrentTask) {
    this.root = path3.resolve(root);
    this.readCurrentTask = readCurrentTask;
  }
  commitLifecycleTransaction(current, proposal, plan, options) {
    const nextRevision = sha256(plan.nextContent);
    if (options.dryRun) {
      return buildResult("success", proposal, current, options, "typed lifecycle proposal validated; atomic CURRENT_TASK + suspended package write planned (dry-run).", {
        previous_revision: current.sourceTuple.revision,
        resulting_revision: nextRevision,
        state: resultState(plan.next, undefined, plan.packageRelativePath)
      });
    }
    try {
      executeWrites([
        { path: current.filePath, content: plan.nextContent },
        { path: plan.packageFilePath, content: plan.nextPackageContent }
      ], false, `vNext Runtime ${proposal.mode} lifecycle transaction committed`);
    } catch (error) {
      return buildResult("blocked", proposal, current, options, error instanceof Error ? error.message : String(error), { code: "ATOMIC_COMMIT_FAILED" });
    }
    try {
      const readBack = this.readCurrentTask(this.root);
      if (readBack.raw !== plan.nextContent || readBack.sourceTuple.revision !== nextRevision) {
        throw new Error("canonical CURRENT_TASK read-back did not match the staged lifecycle document.");
      }
      if (!fs2.existsSync(plan.packageFilePath) || fs2.readFileSync(plan.packageFilePath, "utf8") !== plan.nextPackageContent) {
        throw new Error("suspended package read-back did not match the staged lifecycle artifact.");
      }
      const lifecycleDelta = proposal.semantic_delta;
      const artifactKind = lifecycleDelta.action === "pause" ? "paused" : lifecycleDelta.action === "interrupt" ? "interrupted" : lifecycleDelta.action === "resume-paused" || lifecycleDelta.action === "resume-interrupted" ? lifecycleDelta.artifact_kind : "paused";
      const parsedPackage = parseSuspendedPackage(this.root, readBack, plan.packageRelativePath, artifactKind);
      const expectedStatus = proposal.mode === "resume-paused" || proposal.mode === "resume-interrupted" ? "rehydrated" : "ready_for_resume";
      if (parsedPackage.rehydrationStatus !== expectedStatus || parsedPackage.ownershipState !== (expectedStatus === "rehydrated" ? "rehydrated" : "recovery_only")) {
        throw new Error("suspended package marker read-back did not match the lifecycle transaction.");
      }
      return buildResult("success", proposal, current, options, "typed lifecycle proposal committed; CURRENT_TASK and suspended package read-back verified.", {
        committed: true,
        governed_mutation_count: 2,
        previous_revision: current.sourceTuple.revision,
        resulting_revision: nextRevision,
        read_back_verified: true,
        state: resultState(readBack.runtimeState, undefined, plan.packageRelativePath)
      });
    } catch (error) {
      const rollback = rollbackLifecycleTransactionAndVerify(this.root, current, plan, this.readCurrentTask);
      return buildResult("blocked", proposal, current, options, rollback.verified ? `Runtime lifecycle read-back failed: ${error instanceof Error ? error.message : String(error)}; rollback read-back verified.` : `Runtime lifecycle read-back failed: ${error instanceof Error ? error.message : String(error)}; ${rollback.detail}`, { code: rollback.verified ? "READ_BACK_FAILED" : "ROLLBACK_FAILED" });
    }
  }
  apply(rawProposal, options = {}) {
    let proposal;
    try {
      proposal = validateRuntimeProposal(rawProposal);
    } catch (error) {
      const code = error instanceof VNextRuntimeError ? error.code : "RUNTIME_SCHEMA_INVALID";
      const fallbackOperation = isRecord(rawProposal) && typeof rawProposal.operation_kind === "string" && RUNTIME_OPERATION_KINDS.includes(rawProposal.operation_kind) ? rawProposal.operation_kind : "task-state-transaction";
      const fallbackKey = isRecord(rawProposal) && typeof rawProposal.idempotency_key === "string" ? rawProposal.idempotency_key : "invalid-proposal";
      return {
        status: "blocked",
        operation_kind: fallbackOperation,
        idempotency_key: fallbackKey,
        target_path: CURRENT_TASK_RELATIVE_FALLBACK,
        dry_run: options.dryRun === true,
        committed: false,
        message: error instanceof Error ? error.message : String(error),
        code,
        planned_writes: [],
        governed_mutation_count: 0,
        read_back_verified: false
      };
    }
    let current;
    try {
      current = this.readCurrentTask(this.root);
    } catch (error) {
      return {
        status: "blocked",
        operation_kind: proposal.operation_kind,
        idempotency_key: proposal.idempotency_key,
        target_path: proposal.source_tuple.path,
        dry_run: options.dryRun === true,
        committed: false,
        message: error instanceof Error ? error.message : String(error),
        code: error instanceof VNextRuntimeError ? error.code : "RUNTIME_SOURCE_INVALID",
        planned_writes: [],
        governed_mutation_count: 0,
        read_back_verified: false
      };
    }
    try {
      if (proposal.source_tuple.path !== current.relativePath)
        fail("RUNTIME_PATH_INVALID", "proposal source path is not the exact canonical CURRENT_TASK path.");
      if (proposal.operation_kind === "lifecycle-transaction") {
        assertRequestedLifecycleTargets(this.root, current, proposal);
      } else if (proposal.requested_write_targets.length !== 1 || proposal.requested_write_targets[0] !== current.relativePath) {
        fail("RUNTIME_PATH_INVALID", "proposal write target is not the exact canonical CURRENT_TASK path.");
      }
    } catch (error) {
      return buildResult("blocked", proposal, current, options, error instanceof Error ? error.message : String(error), { code: error instanceof VNextRuntimeError ? error.code : "RUNTIME_PATH_INVALID" });
    }
    const proposalDigest = digest(proposal);
    const prior = current.runtimeState.applied_proposals.find((item) => item.idempotency_key === proposal.idempotency_key);
    if (prior) {
      if (prior.proposal_digest !== proposalDigest) {
        return buildResult("conflict", proposal, current, options, "idempotency key was already used by a different proposal.", { code: "IDEMPOTENCY_CONFLICT", previous_revision: current.sourceTuple.revision });
      }
      if (proposal.operation_kind === "lifecycle-transaction") {
        try {
          assertLifecycleReplayArtifacts(this.root, current, proposal);
        } catch (error) {
          return buildResult("blocked", proposal, current, options, error instanceof Error ? error.message : String(error), {
            code: error instanceof VNextRuntimeError ? error.code : "LIFECYCLE_REPLAY_INCOMPLETE"
          });
        }
      }
      return buildResult("no-op", proposal, current, options, "proposal replay is an idempotent no-op.", {
        previous_revision: current.sourceTuple.revision,
        resulting_revision: current.sourceTuple.revision,
        read_back_verified: true,
        state: resultState(current.runtimeState)
      });
    }
    const conflictField = compareSourceTuple(proposal.source_tuple, current.sourceTuple);
    if (conflictField) {
      return buildResult("conflict", proposal, current, options, `canonical source tuple is stale at ${conflictField}.`, { code: "SOURCE_TUPLE_MISMATCH", previous_revision: current.sourceTuple.revision });
    }
    const now = options.now?.() ?? new Date().toISOString();
    if (Number.isNaN(Date.parse(now))) {
      return buildResult("blocked", proposal, current, options, "Runtime clock returned an invalid timestamp.", { code: "RUNTIME_CLOCK_INVALID" });
    }
    if (proposal.operation_kind === "lifecycle-transaction") {
      try {
        const plan = prepareLifecycleTransaction(this.root, current, proposal);
        return this.commitLifecycleTransaction(current, proposal, plan, options);
      } catch (error) {
        return buildResult("blocked", proposal, current, options, error instanceof Error ? error.message : String(error), { code: error instanceof VNextRuntimeError ? error.code : "RUNTIME_HANDLER_BLOCKED" });
      }
    }
    let transition;
    try {
      transition = proposal.operation_kind === "task-state-transaction" ? applyTaskStateDelta(current, proposal, now) : applyFindingQueueDelta(current, proposal, now);
    } catch (error) {
      return buildResult("blocked", proposal, current, options, error instanceof Error ? error.message : String(error), { code: error instanceof VNextRuntimeError ? error.code : "RUNTIME_HANDLER_BLOCKED" });
    }
    const nextContent = renderCanonicalCurrentTask(current.frontmatter, current.body, transition.next);
    const nextRevision = sha256(nextContent);
    if (nextContent === current.raw) {
      return buildResult("no-op", proposal, current, options, "proposal produced no canonical state change.", {
        previous_revision: current.sourceTuple.revision,
        resulting_revision: current.sourceTuple.revision,
        read_back_verified: true
      });
    }
    if (options.dryRun) {
      return buildResult("success", proposal, current, options, "typed proposal validated; atomic write planned (dry-run).", {
        previous_revision: current.sourceTuple.revision,
        resulting_revision: nextRevision,
        state: resultState(transition.next, transition.findingStatus)
      });
    }
    try {
      executeWrites([{ path: current.filePath, content: nextContent }], false, `vNext Runtime ${proposal.operation_kind} committed`);
    } catch (error) {
      return buildResult("blocked", proposal, current, options, error instanceof Error ? error.message : String(error), { code: "ATOMIC_COMMIT_FAILED" });
    }
    try {
      const readBack = this.readCurrentTask(this.root);
      if (readBack.raw !== nextContent || readBack.sourceTuple.revision !== nextRevision) {
        const rollback = rollbackCurrentTaskAndVerify(this.root, current, this.readCurrentTask);
        return buildResult("blocked", proposal, current, options, rollback.verified ? "Runtime read-back did not match the staged canonical document; rollback read-back verified." : `Runtime read-back did not match the staged canonical document; ${rollback.detail}`, { code: rollback.verified ? "READ_BACK_MISMATCH" : "ROLLBACK_FAILED" });
      }
      return buildResult("success", proposal, current, options, "typed proposal committed and canonical source read-back verified.", {
        committed: true,
        governed_mutation_count: 1,
        previous_revision: current.sourceTuple.revision,
        resulting_revision: nextRevision,
        read_back_verified: true,
        state: resultState(readBack.runtimeState, transition.findingStatus)
      });
    } catch (error) {
      const rollback = rollbackCurrentTaskAndVerify(this.root, current, this.readCurrentTask);
      return buildResult("blocked", proposal, current, options, rollback.verified ? `Runtime read-back failed: ${error instanceof Error ? error.message : String(error)}; rollback read-back verified.` : `Runtime read-back failed: ${error instanceof Error ? error.message : String(error)}; ${rollback.detail}`, { code: rollback.verified ? "READ_BACK_FAILED" : "ROLLBACK_FAILED" });
    }
  }
}
function applyVNextRuntimeProposal(root, proposal, options = {}) {
  return new GovernanceTransactionKernel(root).apply(proposal, options);
}
function parseCli(argv) {
  const [command = "validate", ...rest] = argv;
  if (command !== "validate" && command !== "validate-contract" && command !== "apply")
    throw new Error("Usage: vnext-runtime <validate-contract|validate|apply> --root <path> [--proposal-file <json>] [--dry-run]");
  let root = process.cwd();
  let proposalFile;
  let dryRun = false;
  for (let index = 0;index < rest.length; index += 1) {
    const arg = rest[index];
    if (arg === "--root")
      root = rest[++index] ?? "";
    else if (arg === "--proposal" || arg === "--proposal-file")
      proposalFile = rest[++index];
    else if (arg === "--dry-run")
      dryRun = true;
    else
      throw new Error(`Unknown argument: ${arg}`);
  }
  return { command, root, proposalFile, dryRun };
}
function validateInstalledRuntimeForCli(root) {
  const runtimePackagePath = path3.join(path3.resolve(root), ...VNEXT_RUNTIME_PACKAGE_RELATIVE_PATH.split("/"), "package.json");
  if (fs2.existsSync(runtimePackagePath)) {
    validateVNextRuntimeContract(root, true);
  }
}
async function runCli(argv = process.argv.slice(2)) {
  try {
    validateRuntimeEnvironment();
    const args = parseCli(argv);
    if (args.command === "validate-contract") {
      validateInstalledRuntimeForCli(args.root);
      console.log(JSON.stringify(validateVNextRuntimeContract(args.root), null, 2));
    } else if (args.command === "validate") {
      validateInstalledRuntimeForCli(args.root);
      const current = readCanonicalCurrentTask(args.root);
      console.log(JSON.stringify({ status: "success", source_tuple: current.sourceTuple, runtime_state: current.runtimeState }, null, 2));
    } else {
      validateInstalledRuntimeForCli(args.root);
      const proposalText = args.proposalFile ? fs2.readFileSync(path3.resolve(args.proposalFile), "utf8") : !process.stdin.isTTY ? fs2.readFileSync(0, "utf8") : "";
      if (!proposalText.trim())
        throw new Error("apply requires a JSON proposal on stdin or via --proposal-file <json-file>.");
      const proposal = JSON.parse(proposalText);
      const result = applyVNextRuntimeProposal(args.root, proposal, { dryRun: args.dryRun });
      console.log(JSON.stringify(result, null, 2));
      if (result.status === "blocked" || result.status === "conflict")
        return 2;
    }
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

// runtime/vnext/src/cli.ts
runCli().then((exitCode) => {
  process.exitCode = exitCode;
});
export {
  runCli
};
