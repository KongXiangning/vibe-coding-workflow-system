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
  "closed",
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
  ["superseded|active", "non_active_owner"],
  ["replaced|active", "non_active_owner"],
  ["blocked_by_replan|active", "non_active_owner"],
  ["closed|archived", "non_active_owner"]
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
  "lifecycle-transaction",
  "project-status-transaction",
  "archive-transaction",
  "lesson-record-transaction"
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
var CLOSE_TASK_MODES = ["default"];
var REVIEW_CYCLE_PHASES = ["discovery", "verification"];
var STEP_STATUSES = ["ready", "in-progress", "completed", "blocked"];
var FINDING_STATUSES = ["admitted", "in-progress", "resolved", "deferred", "rejected"];
var REPLAN_TASK_STATE_ACTIONS = ["mark-replan-blocked", "clear-replan-block", "commit-replan"];
var REPLAN_AUDIT_ACTIONS = [
  "supersede",
  "mark-replan-blocked",
  "clear-replan-block",
  "commit-replan"
];
var DOCUMENT_ID_PATTERN = /^doc-[a-f0-9]{24}$/;
var SAFE_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/;
var FINGERPRINT_PATTERN = /^[a-z0-9][a-z0-9._:-]{2,127}$/;
var STEP_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
var MAX_TEXT_LENGTH = 4000;
var MAX_EVIDENCE_REFS = 32;
var MAX_FINDINGS = 256;
var MAX_APPLIED_PROPOSALS = 256;
var MAX_EXECUTION_LOG = 256;
var MAX_REPLAN_SECTION_CONTENT_LENGTH = 32768;
var MAX_REPAIR_ROUNDS = 3;
var MAX_REPAIR_ATTEMPTS = 2;
var CURRENT_TASK_RELATIVE_FALLBACK = "docs/workflow/CURRENT_TASK.md";
function createReviewCycleZero() {
  return {
    id: "review-cycle-0",
    cycle_phase: "discovery",
    repair_round: 0,
    counted_repair_wave_ids: [],
    active_repair_wave_id: null,
    verification_new_finding_wave_used: false,
    verification_new_finding_wave_id: null
  };
}

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
  expectExactKeys(proposal, ["schema_version", "kind", "caller", "operation_kinds", "source_tuple", "required_envelope", "finding_queue_admission", "finding_queue_repair", "prepare_task", "lifecycle", "close_task"], "Runtime contract.proposal");
  if (proposal.schema_version !== 1 || proposal.kind !== VNEXT_RUNTIME_PROPOSAL_KIND)
    fail("RUNTIME_CONTRACT_INVALID", "Runtime proposal contract has an invalid envelope marker.");
  expectSetEqual(expectStringArray(proposal.caller, "Runtime contract.proposal.caller"), ["execute-step", "prepare-task", "task-lifecycle", "close-task"], "Runtime contract proposal callers");
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
  expectExactKeys(prepareTaskContract, ["bound_actions", "replan_mode", "replan_actions"], "Runtime contract.proposal.prepare_task");
  expectSetEqual(expectStringArray(prepareTaskContract.bound_actions, "Runtime contract.proposal.prepare_task.bound_actions"), ["clear-resume-review-gate", ...REPLAN_TASK_STATE_ACTIONS], "Runtime contract prepare-task bound actions");
  if (prepareTaskContract.replan_mode !== "replan")
    fail("RUNTIME_CONTRACT_INVALID", "Runtime contract prepare-task replan_mode must be replan.");
  expectSetEqual(expectStringArray(prepareTaskContract.replan_actions, "Runtime contract.proposal.prepare_task.replan_actions"), [...REPLAN_TASK_STATE_ACTIONS], "Runtime contract prepare-task replan actions");
  const lifecycleContract = expectRecord(proposal.lifecycle, "Runtime contract.proposal.lifecycle");
  expectExactKeys(lifecycleContract, ["modes", "bound_modes", "proposal_only_modes", "pause_required", "interrupt_required", "resume_required", "supersede_required"], "Runtime contract.proposal.lifecycle");
  expectSetEqual(expectStringArray(lifecycleContract.modes, "Runtime contract.proposal.lifecycle.modes"), [...LIFECYCLE_MODES], "Runtime contract lifecycle modes");
  expectSetEqual(expectStringArray(lifecycleContract.bound_modes, "Runtime contract.proposal.lifecycle.bound_modes"), [...LIFECYCLE_MODES], "Runtime contract bound lifecycle modes");
  expectSetEqual(expectStringArray(lifecycleContract.proposal_only_modes, "Runtime contract.proposal.lifecycle.proposal_only_modes", true), [], "Runtime contract proposal-only lifecycle modes");
  const lifecycleRequiredFields = {
    pause_required: ["lifecycle_state", "suspension_reason", "task_start_base", "last_reviewed_checkpoint", "current_diff_review_target", "rollback_conditions", "resume_review_reasons", "evidence_refs"],
    interrupt_required: ["lifecycle_state", "suspension_reason", "task_start_base", "last_reviewed_checkpoint", "current_diff_review_target", "rollback_conditions", "resume_review_reasons", "checkpoint_evidence", "dirty_attribution", "environment_state", "recovery_strategy", "evidence_refs"],
    resume_required: ["artifact_kind", "recovery_package_path", "recovery_package_revision", "resume_review_reasons", "evidence_refs"],
    supersede_required: ["invalidation_kind", "invalidation_reason", "evidence_refs", "partial_diff_disposition"]
  };
  for (const [field, expected] of Object.entries(lifecycleRequiredFields)) {
    const required = expectRecord(lifecycleContract[field], `Runtime contract.proposal.lifecycle.${field}`);
    expectExactKeys(required, ["required"], `Runtime contract.proposal.lifecycle.${field}`);
    expectSetEqual(expectStringArray(required.required, `Runtime contract.proposal.lifecycle.${field}.required`), expected, `Runtime contract lifecycle ${field}`);
  }
  const closeTaskContract = expectRecord(proposal.close_task, "Runtime contract.proposal.close_task");
  expectExactKeys(closeTaskContract, ["default_mode", "preview_mode", "terminal_from", "terminal_to", "lesson_admission"], "Runtime contract.proposal.close_task");
  if (closeTaskContract.default_mode !== "default" || closeTaskContract.preview_mode !== "preview") {
    fail("RUNTIME_CONTRACT_INVALID", "Runtime contract close-task must reserve default closure and preview read-only semantics.");
  }
  expectSetEqual(expectStringArray(closeTaskContract.terminal_from, "Runtime contract close-task terminal_from"), ["active + active"], "Runtime contract close-task terminal_from");
  expectSetEqual(expectStringArray(closeTaskContract.terminal_to, "Runtime contract close-task terminal_to"), ["closed + archived"], "Runtime contract close-task terminal_to");
  expectSetEqual(expectStringArray(closeTaskContract.lesson_admission, "Runtime contract close-task lesson_admission"), ["admit", "defer", "no-op"], "Runtime contract close-task lesson admission");
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
    fail("RUNTIME_CONTRACT_INVALID", `Runtime contract must declare exactly the ${RUNTIME_OPERATION_KINDS.length} Phase 2 bound operations.`);
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
    const operationContract = {
      "task-state-transaction": {
        source: ["CURRENT_TASK.md"],
        writes: ["CURRENT_TASK.md"],
        callers: ["execute-step", "prepare-task"]
      },
      "finding-queue-transaction": {
        source: ["CURRENT_TASK.md"],
        writes: ["CURRENT_TASK.md"],
        callers: ["execute-step"]
      },
      "lifecycle-transaction": {
        source: ["CURRENT_TASK.md", "TASKS/paused/**", "TASKS/interrupted/**"],
        writes: ["CURRENT_TASK.md", "TASKS/paused/**", "TASKS/interrupted/**"],
        callers: ["task-lifecycle"]
      },
      "project-status-transaction": {
        source: ["CURRENT_TASK.md", "STATUS.md", "TASKS/TASK-<TASK_ID>-<TASK_SLUG>.md"],
        writes: ["STATUS.md"],
        callers: ["close-task"]
      },
      "archive-transaction": {
        source: ["CURRENT_TASK.md", "TASKS/TASK-<TASK_ID>-<TASK_SLUG>.md"],
        writes: ["CURRENT_TASK.md", "TASKS/TASK-<TASK_ID>-<TASK_SLUG>.md"],
        callers: ["close-task"]
      },
      "lesson-record-transaction": {
        source: ["CURRENT_TASK.md", "TASKS/TASK-<TASK_ID>-<TASK_SLUG>.md", "LESSONS.md"],
        writes: ["LESSONS.md"],
        callers: ["close-task"]
      }
    };
    const expectedTargets = operationContract[id];
    expectSetEqual(expectStringArray(operation.source_targets, `Runtime contract.operations[${index}].source_targets`), expectedTargets.source, `Runtime contract operation ${id}.source_targets`);
    expectSetEqual(expectStringArray(operation.write_targets, `Runtime contract.operations[${index}].write_targets`), expectedTargets.writes, `Runtime contract operation ${id}.write_targets`);
    expectSetEqual(expectStringArray(operation.allowed_callers, `Runtime contract.operations[${index}].allowed_callers`), expectedTargets.callers, `Runtime contract operation ${id}.allowed_callers`);
    expectSetEqual(expectStringArray(operation.result_states, `Runtime contract.operations[${index}].result_states`), [...RUNTIME_RESULT_STATES], `Runtime contract operation ${id}.result_states`);
    if (operation.atomic !== true || operation.idempotence !== "fail-closed" || operation.conflict_policy !== "fail-closed")
      fail("RUNTIME_CONTRACT_INVALID", `Runtime contract operation ${id} must be atomic, fail-closed, and conflict-safe.`);
  }
  expectSetEqual(bound, [...RUNTIME_OPERATION_KINDS], "Runtime contract bound operations");
  const unbound = expectStringArray(contract.unbound_operations, "Runtime contract.unbound_operations");
  expectSetEqual(unbound, ["inbox-record-transaction"], "Runtime contract unbound operations");
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
var REPLAN_REPLACEMENT_FIELDS = [
  "background_context",
  "acceptance",
  "allowed_scope",
  "conditional_scope",
  "forbidden_scope",
  "affected_contracts",
  "confirmed_decisions",
  "open_questions",
  "implementation_plan",
  "implementation_steps",
  "regression_checks",
  "rollback_points",
  "design_constraints",
  "post_release_validation",
  "propagation_governance"
];
function normalizeReplacementSectionContent(value, location) {
  const normalized = value.replace(/\r\n?/g, `
`).trim();
  if (/^#{1,2}\s+\S/m.test(normalized)) {
    fail("RUNTIME_SCHEMA_INVALID", `${location} must contain section content, not an arbitrary top-level Markdown heading.`);
  }
  return normalized;
}
function validatePartialDiffDisposition(value, location) {
  const record = expectRecord(value, location);
  expectExactKeys(record, ["reusable", "rollback_required", "stop_propagation"], location);
  return {
    reusable: expectStringArray(record.reusable, `${location}.reusable`, true, MAX_EVIDENCE_REFS),
    rollback_required: expectStringArray(record.rollback_required, `${location}.rollback_required`, true, MAX_EVIDENCE_REFS),
    stop_propagation: expectStringArray(record.stop_propagation, `${location}.stop_propagation`, true, MAX_EVIDENCE_REFS)
  };
}
function validateReplanReplacementDefinition(value, location) {
  const record = expectRecord(value, location);
  expectExactKeys(record, REPLAN_REPLACEMENT_FIELDS, location);
  const result = {};
  for (const field of REPLAN_REPLACEMENT_FIELDS) {
    const raw = record[field];
    if (raw === null && ["design_constraints", "post_release_validation", "propagation_governance"].includes(field)) {
      result[field] = null;
      continue;
    }
    if (raw === null)
      fail("RUNTIME_SCHEMA_INVALID", `${location}.${field} may be null only for optional sections.`);
    result[field] = normalizeReplacementSectionContent(expectText(raw, `${location}.${field}`, MAX_REPLAN_SECTION_CONTENT_LENGTH), `${location}.${field}`);
  }
  return result;
}
function replacementStepIds(implementationSteps) {
  const ids = [];
  for (const line of implementationSteps.split(`
`)) {
    const labelledStep = /^\s*[-*]\s+(?:\[[ xX]\]\s*)?([A-Za-z0-9][A-Za-z0-9._:-]{0,127})\s*[:：]/.exec(line);
    if (labelledStep) {
      ids.push(labelledStep[1]);
      continue;
    }
    const numberedStep = /^\s*[-*]\s+(?:\[[ xX]\]\s*)?步骤\s+([0-9]+)\s*[:：]/.exec(line);
    if (numberedStep)
      ids.push(`step-${numberedStep[1]}`);
  }
  return ids;
}
function assertReplacementActiveStep(activeStepId, implementationSteps) {
  const stepIds = replacementStepIds(implementationSteps);
  if (stepIds.length === 0) {
    fail("RUNTIME_SECTION_INVALID", "replacement implementation_steps must contain at least one labelled step ID.");
  }
  if (new Set(stepIds).size !== stepIds.length) {
    fail("RUNTIME_SECTION_INVALID", "replacement implementation_steps contains duplicate step IDs.");
  }
  if (!stepIds.includes(activeStepId)) {
    fail("RUNTIME_SECTION_INVALID", `active_step_id ${activeStepId} does not identify a step in replacement implementation_steps.`);
  }
}
function validateTaskStateDelta(value) {
  const record = expectRecord(value, "semantic_delta");
  const kind = expectEnum(record.kind, ["task-state"], "semantic_delta.kind");
  const action = expectEnum(record.action, ["step-progress", "clear-resume-review-gate", ...REPLAN_TASK_STATE_ACTIONS], "semantic_delta.action");
  if (action === "clear-resume-review-gate") {
    expectExactKeys(record, ["kind", "action", "evidence_refs"], "semantic_delta");
    return {
      kind,
      action: "clear-resume-review-gate",
      evidence_refs: validateEvidenceRefs(record.evidence_refs, "semantic_delta.evidence_refs")
    };
  }
  if (action === "mark-replan-blocked" || action === "clear-replan-block") {
    expectExactKeys(record, ["kind", "action", "evidence_refs"], "semantic_delta");
    return {
      kind,
      action,
      evidence_refs: validateEvidenceRefs(record.evidence_refs, "semantic_delta.evidence_refs")
    };
  }
  if (action === "commit-replan") {
    expectExactKeys(record, ["kind", "action", "replacement_definition", "active_step_id", "evidence_refs"], "semantic_delta");
    return {
      kind,
      action,
      replacement_definition: validateReplanReplacementDefinition(record.replacement_definition, "semantic_delta.replacement_definition"),
      active_step_id: expectString(record.active_step_id, "semantic_delta.active_step_id", STEP_ID_PATTERN),
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
  expectExactKeys(record, ["kind", "action", "invalidation_kind", "invalidation_reason", "evidence_refs", "partial_diff_disposition"], "semantic_delta");
  return {
    kind,
    action: "supersede",
    invalidation_kind: expectEnum(record.invalidation_kind, ["goal", "scope", "acceptance"], "semantic_delta.invalidation_kind"),
    invalidation_reason: expectText(record.invalidation_reason, "semantic_delta.invalidation_reason"),
    evidence_refs: validateEvidenceRefs(record.evidence_refs, "semantic_delta.evidence_refs"),
    partial_diff_disposition: validatePartialDiffDisposition(record.partial_diff_disposition, "semantic_delta.partial_diff_disposition")
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
var CLOSURE_EVIDENCE_FIELDS = [
  "acceptance_satisfied",
  "validation_complete",
  "no_admitted_or_in_progress_findings",
  "no_unresolved_closure_blocker",
  "release_evidence",
  "rollback_evidence",
  "observation_evidence",
  "remaining_risks_non_blocking",
  "archive_path_verified"
];
function validateClosureEvidence(value, location) {
  const record = expectRecord(value, location);
  expectExactKeys(record, CLOSURE_EVIDENCE_FIELDS, location);
  const validateEvidenceGate = (raw, field) => {
    const gate = expectRecord(raw, `${location}.${field}`);
    expectExactKeys(gate, ["triggered", "complete", "evidence_refs"], `${location}.${field}`);
    const triggered = expectBoolean(gate.triggered, `${location}.${field}.triggered`);
    const complete = expectBoolean(gate.complete, `${location}.${field}.complete`);
    const evidenceRefs = expectStringArray(gate.evidence_refs, `${location}.${field}.evidence_refs`, true, MAX_EVIDENCE_REFS);
    if (triggered && !complete) {
      fail("CLOSURE_EVIDENCE_INVALID", `${location}.${field} is triggered but incomplete.`);
    }
    return { triggered, complete, evidence_refs: evidenceRefs };
  };
  return {
    acceptance_satisfied: expectBoolean(record.acceptance_satisfied, `${location}.acceptance_satisfied`),
    validation_complete: expectBoolean(record.validation_complete, `${location}.validation_complete`),
    no_admitted_or_in_progress_findings: expectBoolean(record.no_admitted_or_in_progress_findings, `${location}.no_admitted_or_in_progress_findings`),
    no_unresolved_closure_blocker: expectBoolean(record.no_unresolved_closure_blocker, `${location}.no_unresolved_closure_blocker`),
    release_evidence: validateEvidenceGate(record.release_evidence, "release_evidence"),
    rollback_evidence: validateEvidenceGate(record.rollback_evidence, "rollback_evidence"),
    observation_evidence: validateEvidenceGate(record.observation_evidence, "observation_evidence"),
    remaining_risks_non_blocking: expectBoolean(record.remaining_risks_non_blocking, `${location}.remaining_risks_non_blocking`),
    archive_path_verified: expectBoolean(record.archive_path_verified, `${location}.archive_path_verified`)
  };
}
function validateDeliverySummary(value, location) {
  const record = expectRecord(value, location);
  expectExactKeys(record, ["goal", "actual_changes", "verification", "release_evidence", "rollback_evidence", "observation_evidence", "next_action"], location);
  return {
    goal: expectText(record.goal, `${location}.goal`, MAX_TEXT_LENGTH),
    actual_changes: expectStringArray(record.actual_changes, `${location}.actual_changes`, false, 64),
    verification: expectStringArray(record.verification, `${location}.verification`, false, 64),
    release_evidence: expectStringArray(record.release_evidence, `${location}.release_evidence`, true, 64),
    rollback_evidence: expectStringArray(record.rollback_evidence, `${location}.rollback_evidence`, true, 64),
    observation_evidence: expectStringArray(record.observation_evidence, `${location}.observation_evidence`, true, 64),
    next_action: expectText(record.next_action, `${location}.next_action`, MAX_TEXT_LENGTH)
  };
}
function validateLessonAdmission(value, location) {
  const record = expectRecord(value, location);
  expectExactKeys(record, ["decision", "candidate_refs", "evidence_refs"], location);
  const decision = expectEnum(record.decision, ["admit", "defer", "no-op"], `${location}.decision`);
  const candidateRefs = expectStringArray(record.candidate_refs, `${location}.candidate_refs`, true, MAX_EVIDENCE_REFS);
  const evidenceRefs = expectStringArray(record.evidence_refs, `${location}.evidence_refs`, true, MAX_EVIDENCE_REFS);
  if (decision === "admit" && candidateRefs.length === 0)
    fail("KNOWLEDGE_ADMISSION_INVALID", `${location}.candidate_refs must be non-empty when decision is admit.`);
  if (decision === "admit" && evidenceRefs.length === 0)
    fail("KNOWLEDGE_ADMISSION_INVALID", `${location}.evidence_refs must be non-empty when decision is admit.`);
  return { decision, candidate_refs: candidateRefs, evidence_refs: evidenceRefs };
}
function validateArchiveDelta(value) {
  const record = expectRecord(value, "semantic_delta");
  const allowedKeys = ["kind", "action", "closure_evidence", "delivery_summary", "remaining_risks", "lesson_admission", "evidence_refs"];
  const extra = Object.keys(record).filter((key) => !allowedKeys.includes(key));
  const required = allowedKeys.filter((key) => !(key in record));
  if (required.length > 0 || extra.length > 0) {
    fail("RUNTIME_SCHEMA_INVALID", `semantic_delta keys mismatch; missing=[${required.join(", ")}], unexpected=[${extra.join(", ")}].`);
  }
  const evidenceRefs = validateEvidenceRefs(record.evidence_refs, "semantic_delta.evidence_refs");
  const closureEvidence = validateClosureEvidence(record.closure_evidence, "semantic_delta.closure_evidence");
  const lessonAdmission = validateLessonAdmission(record.lesson_admission, "semantic_delta.lesson_admission");
  const referencedEvidence = [
    ...closureEvidence.release_evidence.evidence_refs,
    ...closureEvidence.rollback_evidence.evidence_refs,
    ...closureEvidence.observation_evidence.evidence_refs,
    ...lessonAdmission.evidence_refs
  ];
  if (!referencedEvidence.every((ref) => evidenceRefs.includes(ref))) {
    fail("RUNTIME_EVIDENCE_INVALID", "archive proposal evidence_refs must cover closure and lesson-admission evidence_refs.");
  }
  return {
    kind: expectEnum(record.kind, ["archive"], "semantic_delta.kind"),
    action: expectEnum(record.action, ["archive"], "semantic_delta.action"),
    closure_evidence: closureEvidence,
    delivery_summary: validateDeliverySummary(record.delivery_summary, "semantic_delta.delivery_summary"),
    remaining_risks: expectStringArray(record.remaining_risks, "semantic_delta.remaining_risks", true, 64),
    lesson_admission: lessonAdmission,
    evidence_refs: evidenceRefs
  };
}
var LESSON_CATEGORIES = ["通用", "数据与存储", "前端与交互", "后端与服务", "测试与回归", "部署与运行时"];
function validateLessonCandidate(value, location) {
  const record = expectRecord(value, location);
  expectExactKeys(record, ["candidate_ref", "category", "scene", "conclusion", "trigger", "cause", "action", "consumer", "evidence_refs"], location);
  return {
    candidate_ref: expectString(record.candidate_ref, `${location}.candidate_ref`, SAFE_KEY_PATTERN),
    category: expectEnum(record.category, LESSON_CATEGORIES, `${location}.category`),
    scene: expectText(record.scene, `${location}.scene`),
    conclusion: expectText(record.conclusion, `${location}.conclusion`),
    trigger: expectText(record.trigger, `${location}.trigger`),
    cause: expectText(record.cause, `${location}.cause`),
    action: expectText(record.action, `${location}.action`),
    consumer: expectText(record.consumer, `${location}.consumer`),
    evidence_refs: validateEvidenceRefs(record.evidence_refs, `${location}.evidence_refs`)
  };
}
function validateProjectStatusDelta(value) {
  const record = expectRecord(value, "semantic_delta");
  expectExactKeys(record, ["kind", "action", "status", "summary", "completed_items", "remaining_risks", "next_checkpoint", "evidence_refs"], "semantic_delta");
  return {
    kind: expectEnum(record.kind, ["project-status"], "semantic_delta.kind"),
    action: expectEnum(record.action, ["sync"], "semantic_delta.action"),
    status: expectEnum(record.status, ["completed", "observing"], "semantic_delta.status"),
    summary: expectText(record.summary, "semantic_delta.summary"),
    completed_items: expectStringArray(record.completed_items, "semantic_delta.completed_items", false, 64),
    remaining_risks: expectStringArray(record.remaining_risks, "semantic_delta.remaining_risks", true, 64),
    next_checkpoint: expectText(record.next_checkpoint, "semantic_delta.next_checkpoint"),
    evidence_refs: validateEvidenceRefs(record.evidence_refs, "semantic_delta.evidence_refs")
  };
}
function validateLessonRecordDelta(value) {
  const record = expectRecord(value, "semantic_delta");
  expectExactKeys(record, ["kind", "action", "candidates", "evidence_refs"], "semantic_delta");
  if (!Array.isArray(record.candidates) || record.candidates.length === 0 || record.candidates.length > 32) {
    fail("RUNTIME_SCHEMA_INVALID", "semantic_delta.candidates must contain between 1 and 32 candidates.");
  }
  const candidates = record.candidates.map((candidate, index) => validateLessonCandidate(candidate, `semantic_delta.candidates[${index}]`));
  if (new Set(candidates.map((candidate) => candidate.candidate_ref)).size !== candidates.length) {
    fail("RUNTIME_SCHEMA_INVALID", "semantic_delta.candidates must have unique candidate_ref values.");
  }
  const evidenceRefs = validateEvidenceRefs(record.evidence_refs, "semantic_delta.evidence_refs");
  if (!candidates.every((candidate) => candidate.evidence_refs.every((ref) => evidenceRefs.includes(ref)))) {
    fail("RUNTIME_EVIDENCE_INVALID", "lesson-record proposal evidence_refs must cover every candidate evidence reference.");
  }
  return {
    kind: expectEnum(record.kind, ["lesson-record"], "semantic_delta.kind"),
    action: expectEnum(record.action, ["record"], "semantic_delta.action"),
    candidates,
    evidence_refs: evidenceRefs
  };
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
  if (operationKind === "archive-transaction") {
    if (kind !== "archive")
      fail("RUNTIME_SCHEMA_INVALID", "archive-transaction requires archive semantic_delta.");
    return validateArchiveDelta(value);
  }
  if (operationKind === "project-status-transaction") {
    if (kind !== "project-status")
      fail("RUNTIME_SCHEMA_INVALID", "project-status-transaction requires project-status semantic_delta.");
    return validateProjectStatusDelta(value);
  }
  if (operationKind === "lesson-record-transaction") {
    if (kind !== "lesson-record")
      fail("RUNTIME_SCHEMA_INVALID", "lesson-record-transaction requires lesson-record semantic_delta.");
    return validateLessonRecordDelta(value);
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
  const caller = expectEnum(proposal.caller, ["execute-step", "prepare-task", "task-lifecycle", "close-task"], "proposal.caller");
  const mode = expectEnum(proposal.mode, [...VNEXT_EXECUTE_STEP_MODES, ...PREPARE_TASK_MODES, ...LIFECYCLE_MODES], "proposal.mode");
  const sourceTuple = validateSourceTuple(proposal.source_tuple);
  const authorityEvidence = validateAuthorityEvidence(proposal.authority_evidence);
  const preconditions = expectStringArray(proposal.preconditions, "proposal.preconditions", false, 32);
  const evidenceRefs = validateEvidenceRefs(proposal.evidence_refs, "proposal.evidence_refs");
  const idempotencyKey = expectString(proposal.idempotency_key, "proposal.idempotency_key", SAFE_KEY_PATTERN);
  const requestedTargets = expectStringArray(proposal.requested_write_targets, "proposal.requested_write_targets", false, 4).map((target, index) => normalizeRepoPath(target, `proposal.requested_write_targets[${index}]`));
  const targetCount = operationKind === "lifecycle-transaction" && mode !== "supersede" || operationKind === "archive-transaction" ? 2 : 1;
  if (requestedTargets.length !== targetCount)
    fail("RUNTIME_PATH_INVALID", `This Runtime proposal must name exactly ${targetCount} exact write target${targetCount === 1 ? "" : "s"}.`);
  const semanticDelta = validateSemanticDelta(proposal.semantic_delta, operationKind);
  if (operationKind === "task-state-transaction") {
    if (caller === "prepare-task") {
      if (mode === "default") {
        if (semanticDelta.kind !== "task-state" || semanticDelta.action !== "clear-resume-review-gate")
          fail("RUNTIME_CALLER_NOT_BOUND", "prepare-task default mode is bound only to clear-resume-review-gate.");
      } else if (mode === "replan") {
        if (semanticDelta.kind !== "task-state" || !REPLAN_TASK_STATE_ACTIONS.includes(semanticDelta.action)) {
          fail("RUNTIME_CALLER_NOT_BOUND", "prepare-task replan mode is bound only to the closed replan task-state action set.");
        }
      } else {
        fail("RUNTIME_MODE_INVALID", "prepare-task task-state proposals must use default or replan mode.");
      }
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
  } else if (operationKind === "lifecycle-transaction") {
    if (caller !== "task-lifecycle" || !LIFECYCLE_MODES.includes(mode))
      fail("RUNTIME_CALLER_NOT_BOUND", "lifecycle-transaction is bound only to task-lifecycle lifecycle modes.");
    if (semanticDelta.kind !== "lifecycle" || semanticDelta.action !== mode)
      fail("RUNTIME_MODE_INVALID", "lifecycle mode and semantic transition must match.");
  } else {
    if (caller !== "close-task" || !CLOSE_TASK_MODES.includes(mode)) {
      fail("RUNTIME_CALLER_NOT_BOUND", `${operationKind} is bound only to close-task default closure.`);
    }
    const expectedKind = operationKind === "archive-transaction" ? "archive" : operationKind === "project-status-transaction" ? "project-status" : "lesson-record";
    if (semanticDelta.kind !== expectedKind)
      fail("RUNTIME_MODE_INVALID", `${operationKind} requires a ${expectedKind} semantic_delta.`);
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
  const deltaRefs = semanticDelta.kind === "task-state" ? semanticDelta.evidence_refs : semanticDelta.kind === "finding-queue" ? semanticDelta.action === "admit" ? semanticDelta.finding.evidence_refs : semanticDelta.evidence_refs : semanticDelta.evidence_refs;
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
function validateArchiveAuditLogEntry(value, location, taskId, taskSlug) {
  expectExactKeys(value, [
    "action",
    "idempotency_key",
    "operation_kind",
    "caller",
    "mode",
    "task_id",
    "task_slug",
    "document_id",
    "from_workflow_status",
    "from_lifecycle_state",
    "to_workflow_status",
    "to_lifecycle_state",
    "source_revision",
    "archive_path",
    "archive_revision",
    "closure_delta_digest",
    "authority_evidence",
    "evidence_refs",
    "lesson_admission",
    "recorded_at"
  ], location);
  const entryTaskId = expectString(value.task_id, `${location}.task_id`);
  const entryTaskSlug = expectString(value.task_slug, `${location}.task_slug`);
  try {
    validateTaskId(entryTaskId);
    validateTaskSlug(entryTaskSlug);
  } catch (error) {
    fail("RUNTIME_SCHEMA_INVALID", error instanceof Error ? error.message : String(error));
  }
  if (entryTaskId !== taskId || entryTaskSlug !== taskSlug)
    fail("RUNTIME_STATE_CONFLICT", `${location} identity does not match runtime_state.`);
  const documentId = expectString(value.document_id, `${location}.document_id`);
  if (!DOCUMENT_ID_PATTERN.test(documentId))
    fail("RUNTIME_SCHEMA_INVALID", `${location}.document_id is invalid.`);
  const sourceRevision = expectString(value.source_revision, `${location}.source_revision`);
  const archiveRevision = expectString(value.archive_revision, `${location}.archive_revision`);
  const closureDeltaDigest = expectString(value.closure_delta_digest, `${location}.closure_delta_digest`);
  if (!/^[a-f0-9]{64}$/.test(sourceRevision) || !/^[a-f0-9]{64}$/.test(archiveRevision) || !/^[a-f0-9]{64}$/.test(closureDeltaDigest)) {
    fail("RUNTIME_SCHEMA_INVALID", `${location} revisions and digest must be SHA-256.`);
  }
  const archivePath = normalizeRepoPath(expectString(value.archive_path, `${location}.archive_path`), `${location}.archive_path`);
  if (!/^TASKS\/TASK-[0-9]{3,}-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/.test(archivePath)) {
    fail("RUNTIME_PATH_INVALID", `${location}.archive_path must be a canonical task archive path.`);
  }
  if (value.action !== "archive" || value.operation_kind !== "archive-transaction" || value.caller !== "close-task" || value.mode !== "default") {
    fail("RUNTIME_STATE_CONFLICT", `${location} archive audit has an invalid operation binding.`);
  }
  if (value.from_workflow_status !== "active" || value.from_lifecycle_state !== "active" || value.to_workflow_status !== "closed" || value.to_lifecycle_state !== "archived") {
    fail("RUNTIME_STATE_CONFLICT", `${location} archive audit has an invalid terminal transition.`);
  }
  return {
    action: "archive",
    idempotency_key: expectString(value.idempotency_key, `${location}.idempotency_key`, SAFE_KEY_PATTERN),
    operation_kind: "archive-transaction",
    caller: "close-task",
    mode: "default",
    task_id: entryTaskId,
    task_slug: entryTaskSlug,
    document_id: documentId,
    from_workflow_status: "active",
    from_lifecycle_state: "active",
    to_workflow_status: "closed",
    to_lifecycle_state: "archived",
    source_revision: sourceRevision,
    archive_path: archivePath,
    archive_revision: archiveRevision,
    closure_delta_digest: closureDeltaDigest,
    authority_evidence: validateAuthorityEvidence(value.authority_evidence),
    evidence_refs: validateEvidenceRefs(value.evidence_refs, `${location}.evidence_refs`),
    lesson_admission: validateLessonAdmission(value.lesson_admission, `${location}.lesson_admission`),
    recorded_at: expectString(value.recorded_at, `${location}.recorded_at`)
  };
}
function validateExecutionLogEntry(value, location, taskId, taskSlug) {
  const record = expectRecord(value, location);
  if (record.action === "archive")
    return validateArchiveAuditLogEntry(record, location, taskId, taskSlug);
  if ("action" in record) {
    const requiredKeys = [
      "action",
      "idempotency_key",
      "operation_kind",
      "caller",
      "mode",
      "task_id",
      "task_slug",
      "document_id",
      "from_workflow_status",
      "from_lifecycle_state",
      "to_workflow_status",
      "to_lifecycle_state",
      "source_revision",
      "authority_evidence",
      "evidence_refs",
      "recorded_at"
    ];
    const optionalKeys = ["partial_diff_disposition", "invalidation_kind", "invalidation_reason"];
    const missing = requiredKeys.filter((key) => !(key in record));
    const extra = Object.keys(record).filter((key) => !requiredKeys.includes(key) && !optionalKeys.includes(key));
    if (missing.length > 0 || extra.length > 0) {
      fail("RUNTIME_SCHEMA_INVALID", `${location} audit keys mismatch; missing=[${missing.join(", ")}], unexpected=[${extra.join(", ")}].`);
    }
    const action = expectEnum(record.action, REPLAN_AUDIT_ACTIONS, `${location}.action`);
    const operationKind = expectEnum(record.operation_kind, ["task-state-transaction", "lifecycle-transaction"], `${location}.operation_kind`);
    const caller = expectEnum(record.caller, ["prepare-task", "task-lifecycle"], `${location}.caller`);
    const mode = expectString(record.mode, `${location}.mode`);
    const entryTaskId = expectString(record.task_id, `${location}.task_id`);
    const entryTaskSlug = expectString(record.task_slug, `${location}.task_slug`);
    const documentId = expectString(record.document_id, `${location}.document_id`);
    if (!DOCUMENT_ID_PATTERN.test(documentId))
      fail("RUNTIME_SCHEMA_INVALID", `${location}.document_id is invalid.`);
    try {
      validateTaskId(entryTaskId);
      validateTaskSlug(entryTaskSlug);
    } catch (error) {
      fail("RUNTIME_SCHEMA_INVALID", error instanceof Error ? error.message : String(error));
    }
    if (entryTaskId !== taskId || entryTaskSlug !== taskSlug)
      fail("RUNTIME_STATE_CONFLICT", `${location} identity does not match runtime_state.`);
    const fromWorkflowStatus = expectEnum(record.from_workflow_status, CURRENT_TASK_WORKFLOW_STATUSES, `${location}.from_workflow_status`);
    const fromLifecycleState = expectEnum(record.from_lifecycle_state, TASK_LIFECYCLE_STATES, `${location}.from_lifecycle_state`);
    const toWorkflowStatus = expectEnum(record.to_workflow_status, CURRENT_TASK_WORKFLOW_STATUSES, `${location}.to_workflow_status`);
    const toLifecycleState = expectEnum(record.to_lifecycle_state, TASK_LIFECYCLE_STATES, `${location}.to_lifecycle_state`);
    try {
      validateCurrentTaskStatusTuple(fromWorkflowStatus, fromLifecycleState);
      validateCurrentTaskStatusTuple(toWorkflowStatus, toLifecycleState);
    } catch (error) {
      fail("RUNTIME_STATE_CONFLICT", error instanceof Error ? error.message : String(error));
    }
    const sourceRevision = expectString(record.source_revision, `${location}.source_revision`);
    if (!/^[a-f0-9]{64}$/.test(sourceRevision))
      fail("RUNTIME_SCHEMA_INVALID", `${location}.source_revision must be SHA-256.`);
    const authorityEvidence = validateAuthorityEvidence(record.authority_evidence);
    const evidenceRefs = validateEvidenceRefs(record.evidence_refs, `${location}.evidence_refs`);
    const recordedAt = expectString(record.recorded_at, `${location}.recorded_at`);
    if (action === "supersede") {
      if (operationKind !== "lifecycle-transaction" || caller !== "task-lifecycle" || mode !== "supersede") {
        fail("RUNTIME_STATE_CONFLICT", `${location} supersede audit has an invalid operation binding.`);
      }
      if (!["active", "blocked_by_replan"].includes(fromWorkflowStatus) || fromLifecycleState !== "active" || toWorkflowStatus !== "superseded" || toLifecycleState !== "active") {
        fail("RUNTIME_STATE_CONFLICT", `${location} supersede audit has an invalid transition.`);
      }
      if (record.partial_diff_disposition === undefined || record.invalidation_kind === undefined || record.invalidation_reason === undefined) {
        fail("RUNTIME_SCHEMA_INVALID", `${location} supersede audit must preserve invalidation and partial-diff evidence.`);
      }
      const partialDiffDisposition = validatePartialDiffDisposition(record.partial_diff_disposition, `${location}.partial_diff_disposition`);
      const invalidationKind = expectEnum(record.invalidation_kind, ["goal", "scope", "acceptance"], `${location}.invalidation_kind`);
      const invalidationReason = expectText(record.invalidation_reason, `${location}.invalidation_reason`);
      return {
        action,
        idempotency_key: expectString(record.idempotency_key, `${location}.idempotency_key`, SAFE_KEY_PATTERN),
        operation_kind: operationKind,
        caller,
        mode: "supersede",
        task_id: entryTaskId,
        task_slug: entryTaskSlug,
        document_id: documentId,
        from_workflow_status: fromWorkflowStatus,
        from_lifecycle_state: fromLifecycleState,
        to_workflow_status: toWorkflowStatus,
        to_lifecycle_state: toLifecycleState,
        source_revision: sourceRevision,
        authority_evidence: authorityEvidence,
        evidence_refs: evidenceRefs,
        partial_diff_disposition: partialDiffDisposition,
        invalidation_kind: invalidationKind,
        invalidation_reason: invalidationReason,
        recorded_at: recordedAt
      };
    }
    if (operationKind !== "task-state-transaction" || caller !== "prepare-task" || mode !== "replan") {
      fail("RUNTIME_STATE_CONFLICT", `${location} replan audit has an invalid operation binding.`);
    }
    if (record.partial_diff_disposition !== undefined || record.invalidation_kind !== undefined || record.invalidation_reason !== undefined) {
      fail("RUNTIME_SCHEMA_INVALID", `${location} non-supersede audit must not carry supersede-only evidence.`);
    }
    const expectedTransition = action === "mark-replan-blocked" ? ["active", "active", "blocked_by_replan", "active"] : action === "clear-replan-block" ? ["blocked_by_replan", "active", "active", "active"] : ["superseded", "active", "active", "active"];
    if (fromWorkflowStatus !== expectedTransition[0] || fromLifecycleState !== expectedTransition[1] || toWorkflowStatus !== expectedTransition[2] || toLifecycleState !== expectedTransition[3]) {
      fail("RUNTIME_STATE_CONFLICT", `${location} replan audit has an invalid transition.`);
    }
    return {
      action,
      idempotency_key: expectString(record.idempotency_key, `${location}.idempotency_key`, SAFE_KEY_PATTERN),
      operation_kind: operationKind,
      caller,
      mode: "replan",
      task_id: entryTaskId,
      task_slug: entryTaskSlug,
      document_id: documentId,
      from_workflow_status: fromWorkflowStatus,
      from_lifecycle_state: fromLifecycleState,
      to_workflow_status: toWorkflowStatus,
      to_lifecycle_state: toLifecycleState,
      source_revision: sourceRevision,
      authority_evidence: authorityEvidence,
      evidence_refs: evidenceRefs,
      recorded_at: recordedAt
    };
  }
  const executionLogKeys = ["idempotency_key", "mode", "step_id", "status", "evidence_refs", "note", "recorded_at"];
  const missingExecutionLogKeys = executionLogKeys.filter((key) => key !== "note" && !(key in record));
  const extraExecutionLogKeys = Object.keys(record).filter((key) => !executionLogKeys.includes(key));
  if (missingExecutionLogKeys.length > 0 || extraExecutionLogKeys.length > 0)
    fail("RUNTIME_SCHEMA_INVALID", `${location} keys mismatch; missing=[${missingExecutionLogKeys.join(", ")}], unexpected=[${extraExecutionLogKeys.join(", ")}].`);
  const result = {
    idempotency_key: expectString(record.idempotency_key, `${location}.idempotency_key`, SAFE_KEY_PATTERN),
    mode: expectEnum(record.mode, VNEXT_EXECUTE_STEP_MODES, `${location}.mode`),
    step_id: expectString(record.step_id, `${location}.step_id`, STEP_ID_PATTERN),
    status: expectEnum(record.status, STEP_STATUSES, `${location}.status`),
    evidence_refs: validateEvidenceRefs(record.evidence_refs, `${location}.evidence_refs`),
    recorded_at: expectString(record.recorded_at, `${location}.recorded_at`)
  };
  if (record.note !== undefined && record.note !== null)
    result.note = expectText(record.note, `${location}.note`);
  return result;
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
  const executionLog = executionLogValue.map((entry, index) => validateExecutionLogEntry(entry, `runtime_state.execution_log[${index}]`, taskId, taskSlug));
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
var REPLAN_SECTION_HEADINGS = {
  background_context: ["背景与上下文", "Background and Context"],
  acceptance: ["验收标准", "Acceptance Criteria"],
  allowed_scope: ["允许修改范围", "Allowed Files"],
  conditional_scope: ["条件修改范围", "条件允许修改范围", "Conditional Files"],
  forbidden_scope: ["禁止修改范围", "Forbidden Files"],
  affected_contracts: ["受影响的契约", "Affected Contracts"],
  confirmed_decisions: ["已确认决策", "Confirmed Decisions"],
  open_questions: ["待确认问题", "Open Questions"],
  implementation_plan: ["实现方案", "Implementation Plan"],
  implementation_steps: ["实施步骤", "Implementation Steps"],
  regression_checks: ["回归检查项", "Regression Checks", "Validation Checks"],
  rollback_points: ["回滚点", "Rollback Points"],
  design_constraints: ["设计约束", "Design Constraints"],
  post_release_validation: ["发布后验证", "Post-release Validation", "Post-Release Validation"],
  propagation_governance: ["传播治理记录", "Propagation Governance"]
};
function scanMarkdownSections(body) {
  const headings = [];
  const headingPattern = /^(#{2,6})[ \t]+(.+?)[ \t]*$/gm;
  for (const match of body.matchAll(headingPattern)) {
    const headingStart = match.index ?? 0;
    const headingEnd = headingStart + match[0].length;
    headings.push({ title: match[2].trim(), level: match[1].length, headingStart, headingEnd });
  }
  return headings.map((heading, index) => {
    const afterHeading = heading.headingEnd;
    const contentStart = body.startsWith(`\r
`, afterHeading) ? afterHeading + 2 : body.startsWith(`
`, afterHeading) ? afterHeading + 1 : afterHeading;
    const next = headings.slice(index + 1).find((candidate) => candidate.level <= heading.level);
    return {
      title: heading.title,
      level: heading.level,
      headingStart: heading.headingStart,
      contentStart,
      contentEnd: next?.headingStart ?? body.length
    };
  });
}
function findUniqueMarkdownSection(sections, aliases, level, rangeStart = 0, rangeEnd = Number.MAX_SAFE_INTEGER) {
  const matches = sections.filter((section) => section.level === level && aliases.includes(section.title) && section.headingStart >= rangeStart && section.headingStart < rangeEnd);
  if (matches.length > 1)
    fail("RUNTIME_SECTION_INVALID", `CURRENT_TASK contains duplicate replacement sections: ${aliases.join(" / ")}.`);
  return matches[0] ?? null;
}
function resolveReplanSectionRanges(body) {
  const sections = scanMarkdownSections(body);
  const resolved = {};
  const topAllowed = findUniqueMarkdownSection(sections, REPLAN_SECTION_HEADINGS.allowed_scope, 2);
  const topConditional = findUniqueMarkdownSection(sections, REPLAN_SECTION_HEADINGS.conditional_scope, 2);
  const topForbidden = findUniqueMarkdownSection(sections, REPLAN_SECTION_HEADINGS.forbidden_scope, 2);
  const nestedAllowed = topAllowed ? findUniqueMarkdownSection(sections, REPLAN_SECTION_HEADINGS.allowed_scope, 3, topAllowed.contentStart, topAllowed.contentEnd) : null;
  const nestedConditional = topAllowed ? findUniqueMarkdownSection(sections, REPLAN_SECTION_HEADINGS.conditional_scope, 3, topAllowed.contentStart, topAllowed.contentEnd) : null;
  const nestedConditionalUnderTopSection = topConditional ? findUniqueMarkdownSection(sections, REPLAN_SECTION_HEADINGS.conditional_scope, 3, topConditional.contentStart, topConditional.contentEnd) : null;
  const nestedForbidden = topForbidden ? findUniqueMarkdownSection(sections, REPLAN_SECTION_HEADINGS.forbidden_scope, 3, topForbidden.contentStart, topForbidden.contentEnd) : null;
  if (nestedConditional && !nestedAllowed) {
    fail("RUNTIME_SECTION_INVALID", "Conditional scope must have a distinct existing Allowed Files section when both are nested under the scope heading.");
  }
  if (nestedAllowed) {
    resolved.allowed_scope = nestedAllowed;
    if (nestedConditional)
      resolved.conditional_scope = nestedConditional;
    else if (nestedConditionalUnderTopSection)
      resolved.conditional_scope = nestedConditionalUnderTopSection;
    else if (topConditional)
      resolved.conditional_scope = topConditional;
  } else {
    if (topAllowed)
      resolved.allowed_scope = topAllowed;
    if (nestedConditionalUnderTopSection)
      resolved.conditional_scope = nestedConditionalUnderTopSection;
    else if (topConditional)
      resolved.conditional_scope = topConditional;
  }
  if (nestedForbidden)
    resolved.forbidden_scope = nestedForbidden;
  else if (topForbidden)
    resolved.forbidden_scope = topForbidden;
  const nonScopeKeys = [
    "background_context",
    "acceptance",
    "affected_contracts",
    "confirmed_decisions",
    "open_questions",
    "implementation_plan",
    "implementation_steps",
    "regression_checks",
    "rollback_points",
    "design_constraints",
    "post_release_validation",
    "propagation_governance"
  ];
  for (const key of nonScopeKeys) {
    const section = findUniqueMarkdownSection(sections, REPLAN_SECTION_HEADINGS[key], 2);
    if (section)
      resolved[key] = section;
  }
  return resolved;
}
function replacementSectionValue(replacement, key) {
  return replacement[key];
}
function replaceReplanDefinitionSections(body, replacement) {
  const ranges = resolveReplanSectionRanges(body);
  const replacements = [];
  for (const key of REPLAN_REPLACEMENT_FIELDS) {
    const value = replacementSectionValue(replacement, key);
    const range = ranges[key];
    const optional = key === "design_constraints" || key === "post_release_validation" || key === "propagation_governance";
    if (!range) {
      if (!optional || value !== null)
        fail("RUNTIME_SECTION_INVALID", `CURRENT_TASK is missing the existing replacement section for ${key}.`);
      continue;
    }
    replacements.push({ range, content: value ?? "" });
  }
  replacements.sort((left, right) => right.range.contentStart - left.range.contentStart);
  for (let index = 1;index < replacements.length; index += 1) {
    const previous = replacements[index - 1].range;
    const current = replacements[index].range;
    if (current.contentEnd > previous.contentStart) {
      fail("RUNTIME_SECTION_INVALID", "Replan replacement sections overlap and cannot be replaced atomically.");
    }
  }
  let nextBody = body;
  for (const { range, content } of replacements) {
    const normalized = normalizeReplacementSectionContent(content, `CURRENT_TASK.${range.title}`);
    const rendered = normalized.length === 0 ? `

` : `
${normalized}

`;
    nextBody = nextBody.slice(0, range.contentStart) + rendered + nextBody.slice(range.contentEnd);
  }
  return nextBody;
}
function assertReplanDefinitionSections(body, replacement) {
  const ranges = resolveReplanSectionRanges(body);
  for (const key of REPLAN_REPLACEMENT_FIELDS) {
    const value = replacementSectionValue(replacement, key);
    const range = ranges[key];
    const optional = key === "design_constraints" || key === "post_release_validation" || key === "propagation_governance";
    if (!range) {
      if (!optional || value !== null)
        fail("RUNTIME_REPLAY_INCOMPLETE", `replan replay is missing the replacement section for ${key}.`);
      continue;
    }
    const actual = normalizeReplacementSectionContent(body.slice(range.contentStart, range.contentEnd), `CURRENT_TASK.${range.title}`);
    const expected = value ?? "";
    if (actual !== expected)
      fail("RUNTIME_REPLAY_INCOMPLETE", `replan replay section ${key} no longer matches the committed replacement.`);
  }
}
function auditList(values) {
  return `[${values.map((value) => JSON.stringify(value)).join(", ")}]`;
}
function renderExecutionAuditRecord(audit) {
  const authorityRefs = audit.authority_evidence.map((item) => `${item.kind}:${item.source}:${item.subject}`);
  const lines = [
    `- action: ${audit.action}`,
    `  old_status: ${audit.from_workflow_status}+${audit.from_lifecycle_state}`,
    `  new_status: ${audit.to_workflow_status}+${audit.to_lifecycle_state}`,
    `  task_id: ${audit.task_id}`,
    `  task_slug: ${audit.task_slug}`,
    `  document_id: ${audit.document_id}`,
    `  proposal_idempotency_key: ${audit.idempotency_key}`,
    `  source_revision: ${audit.source_revision}`,
    `  authority_refs: ${auditList(authorityRefs)}`,
    `  evidence_refs: ${auditList(audit.evidence_refs)}`
  ];
  if (audit.action === "archive") {
    lines.push(`  archive_path: ${audit.archive_path}`);
    lines.push(`  archive_revision: ${audit.archive_revision}`);
    lines.push(`  closure_delta_digest: ${audit.closure_delta_digest}`);
    lines.push("  lesson_admission:");
    lines.push(`    decision: ${audit.lesson_admission.decision}`);
    lines.push(`    candidate_refs: ${auditList(audit.lesson_admission.candidate_refs)}`);
    lines.push(`    evidence_refs: ${auditList(audit.lesson_admission.evidence_refs)}`);
  } else {
    if (audit.invalidation_kind !== undefined)
      lines.push(`  invalidation_kind: ${audit.invalidation_kind}`);
    if (audit.invalidation_reason !== undefined)
      lines.push(`  invalidation_reason: ${audit.invalidation_reason}`);
    if (audit.partial_diff_disposition !== undefined) {
      lines.push("  partial_diff_disposition:");
      lines.push(`    reusable: ${auditList(audit.partial_diff_disposition.reusable)}`);
      lines.push(`    rollback_required: ${auditList(audit.partial_diff_disposition.rollback_required)}`);
      lines.push(`    stop_propagation: ${auditList(audit.partial_diff_disposition.stop_propagation)}`);
    }
  }
  lines.push(`  recorded_at: ${audit.recorded_at}`);
  return lines.join(`
`);
}
function appendExecutionAuditToBody(body, audit) {
  const section = findUniqueMarkdownSection(scanMarkdownSections(body), ["执行记录", "Execution Log"], 2);
  if (!section)
    fail("RUNTIME_SECTION_INVALID", "CURRENT_TASK is missing the required ## 执行记录 audit section.");
  const existing = body.slice(section.contentStart, section.contentEnd).replace(/\r\n?/g, `
`).trimEnd();
  const auditText = renderExecutionAuditRecord(audit);
  const rendered = `${existing.trim().length > 0 ? `${existing}

` : ""}${auditText}

`;
  return body.slice(0, section.contentStart) + `
${rendered}` + body.slice(section.contentEnd);
}
function assertExecutionAuditInBody(body, audit) {
  const section = findUniqueMarkdownSection(scanMarkdownSections(body), ["执行记录", "Execution Log"], 2);
  if (!section)
    fail("RUNTIME_REPLAY_INCOMPLETE", "replay is missing the required ## 执行记录 audit section.");
  const content = body.slice(section.contentStart, section.contentEnd).replace(/\r\n?/g, `
`);
  if (!content.includes(renderExecutionAuditRecord(audit))) {
    fail("RUNTIME_REPLAY_INCOMPLETE", `replay is missing the durable body audit for ${audit.action}.`);
  }
}
function renderCanonicalCurrentTask(frontmatter, body, runtimeState, options = {}) {
  const nextFrontmatter = { ...frontmatter, runtime_state: runtimeState };
  let nextBody = options.replacementDefinition ? replaceReplanDefinitionSections(body, options.replacementDefinition) : body;
  nextBody = renderCurrentTaskLifecycleFields(nextBody, runtimeState);
  if (options.audit)
    nextBody = appendExecutionAuditToBody(nextBody, options.audit);
  return `---
${stringify(nextFrontmatter).trimEnd()}
---
${nextBody}`;
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
function workflowDocPathForRoot(root, file, missingCode = "RUNTIME_SOURCE_MISSING") {
  const resolvedRoot = path3.resolve(root);
  const profilePath = getWorkflowProfilePath(resolvedRoot);
  if (!fs2.existsSync(profilePath))
    fail(missingCode, `PROJECT_PROFILE.yaml is missing: ${profilePath}`);
  const profile = loadProfile(profilePath);
  const filePath = getWorkflowDocPath(resolvedRoot, profile, file);
  const relativePath = path3.relative(resolvedRoot, filePath).replace(/\\/g, "/");
  if (!relativePath || relativePath.startsWith("../") || path3.isAbsolute(relativePath)) {
    fail("RUNTIME_PATH_INVALID", `${file} path escapes the target root.`);
  }
  return { filePath, relativePath };
}
function archivePathForTask(root, current) {
  let relativePath;
  try {
    relativePath = getTaskArtifactPath(current.runtimeState.task_id, current.runtimeState.task_slug, "archive");
  } catch (error) {
    fail("RUNTIME_PATH_INVALID", error instanceof Error ? error.message : String(error));
  }
  const resolvedRoot = path3.resolve(root);
  const filePath = path3.resolve(resolvedRoot, ...relativePath.split("/"));
  const relativeCheck = path3.relative(resolvedRoot, filePath).replace(/\\/g, "/");
  if (relativeCheck !== relativePath || relativeCheck.startsWith("../") || path3.isAbsolute(relativeCheck)) {
    fail("RUNTIME_PATH_INVALID", `archive path escapes the target root: ${relativePath}`);
  }
  return { filePath, relativePath };
}
function yamlScalar(value) {
  if (/^[A-Za-z0-9][A-Za-z0-9._:/+@ -]*$/.test(value) && !value.endsWith(" ") && !value.includes("  "))
    return value;
  return JSON.stringify(value);
}
function yamlStringArray(values) {
  return JSON.stringify(values);
}
function readArchiveScalar(section, field, location) {
  const escaped = field.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&");
  const match = new RegExp(`^-\\s*${escaped}\\s*:\\s*(.*?)\\s*$`, "m").exec(section);
  if (!match)
    fail("ARCHIVE_INVALID", `${location} is missing ${field}.`);
  const raw = match[1].trim();
  if (raw.startsWith('"') || raw.startsWith("'")) {
    try {
      return JSON.parse(raw);
    } catch {
      fail("ARCHIVE_INVALID", `${location}.${field} is not a valid scalar.`);
    }
  }
  return expectString(raw, `${location}.${field}`);
}
function readArchiveArray(raw, location) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    fail("ARCHIVE_INVALID", `${location} must be a JSON/YAML inline string array.`);
  }
  return expectStringArray(parsed, location, true, MAX_EVIDENCE_REFS);
}
function readArchiveLessonAdmission(section, location) {
  const match = /(?:^|\n)lesson_admission:\s*\n\s+decision:\s*(admit|defer|no-op)\s*\n\s+candidate_refs:\s*(\[[^\r\n]*\])\s*\n\s+evidence_refs:\s*(\[[^\r\n]*\])/m.exec(section);
  if (!match)
    fail("ARCHIVE_INVALID", `${location} is missing the durable lesson_admission record.`);
  return validateLessonAdmission({
    decision: match[1],
    candidate_refs: readArchiveArray(match[2], `${location}.candidate_refs`),
    evidence_refs: readArchiveArray(match[3], `${location}.evidence_refs`)
  }, location);
}
function requiredArchiveSections(raw) {
  const sections = scanMarkdownSections(raw);
  const requiredHeadings = [
    "任务元数据",
    "原始任务包快照",
    "实际改动摘要",
    "契约与决策记录",
    "验证与交付证据",
    "Lessons 回写",
    "后续关联"
  ];
  const result = {};
  for (const heading of requiredHeadings) {
    const section = findUniqueMarkdownSection(sections, [heading], 2);
    if (!section)
      fail("ARCHIVE_INVALID", `canonical task archive is missing ## ${heading}.`);
    result[heading] = section;
  }
  return result;
}
function readCanonicalArchive(root, current, expectedPath) {
  const expected = archivePathForTask(root, current);
  if (expectedPath !== undefined && expectedPath !== expected.relativePath) {
    fail("RUNTIME_PATH_INVALID", "archive path is not the exact identity-derived path.");
  }
  if (!fs2.existsSync(expected.filePath))
    fail("ARCHIVE_MISSING", `canonical task archive is missing: ${expected.relativePath}`);
  const raw = fs2.readFileSync(expected.filePath, "utf8");
  const sections = requiredArchiveSections(raw);
  const metadata = raw.slice(sections["任务元数据"].contentStart, sections["任务元数据"].contentEnd);
  const lessonSection = raw.slice(sections["Lessons 回写"].contentStart, sections["Lessons 回写"].contentEnd);
  const workflowStatus = readArchiveScalar(metadata, "workflow_status", "archive.任务元数据");
  const lifecycleState = readArchiveScalar(metadata, "lifecycle_state", "archive.任务元数据");
  const archiveOperation = readArchiveScalar(metadata, "archive_operation", "archive.任务元数据");
  const archiveCaller = readArchiveScalar(metadata, "archive_caller", "archive.任务元数据");
  const receipt = {
    filePath: expected.filePath,
    relativePath: expected.relativePath,
    raw,
    revision: sha256(raw),
    taskId: readArchiveScalar(metadata, "task_id", "archive.任务元数据"),
    taskSlug: readArchiveScalar(metadata, "task_slug", "archive.任务元数据"),
    taskTitle: readArchiveScalar(metadata, "task_title", "archive.任务元数据"),
    documentId: readArchiveScalar(metadata, "document_id", "archive.任务元数据"),
    sourceRevision: readArchiveScalar(metadata, "source_revision", "archive.任务元数据"),
    archivePath: readArchiveScalar(metadata, "archive_path", "archive.任务元数据"),
    idempotencyKey: readArchiveScalar(metadata, "proposal_idempotency_key", "archive.任务元数据"),
    closureDeltaDigest: readArchiveScalar(metadata, "closure_delta_digest", "archive.任务元数据"),
    lessonAdmission: readArchiveLessonAdmission(lessonSection, "archive.Lessons 回写.lesson_admission")
  };
  if (!/^[a-f0-9]{64}$/.test(receipt.revision) || !/^[a-f0-9]{64}$/.test(receipt.sourceRevision) || !/^[a-f0-9]{64}$/.test(receipt.closureDeltaDigest)) {
    fail("ARCHIVE_INVALID", "canonical task archive contains an invalid revision or digest.");
  }
  if (!SAFE_KEY_PATTERN.test(receipt.idempotencyKey) || !DOCUMENT_ID_PATTERN.test(receipt.documentId)) {
    fail("ARCHIVE_INVALID", "canonical task archive contains an invalid idempotency key or document_id.");
  }
  if (workflowStatus !== "closed" || lifecycleState !== "archived" || archiveOperation !== "archive-transaction" || archiveCaller !== "close-task") {
    fail("ARCHIVE_PROVENANCE_MISMATCH", "archive metadata does not declare the frozen close-task terminal provenance.");
  }
  if (receipt.taskId !== current.runtimeState.task_id || receipt.taskSlug !== current.runtimeState.task_slug) {
    fail("ARCHIVE_PROVENANCE_MISMATCH", "archive identity does not match CURRENT_TASK.");
  }
  const identity = extractTaskIdentityFromCurrentTask(current.body);
  if (identity.title === null || receipt.taskTitle !== identity.title)
    fail("ARCHIVE_PROVENANCE_MISMATCH", "archive task_title does not match CURRENT_TASK.");
  if (receipt.documentId !== String(current.frontmatter.document_id))
    fail("ARCHIVE_PROVENANCE_MISMATCH", "archive document_id does not match CURRENT_TASK.");
  if (receipt.archivePath !== expected.relativePath)
    fail("ARCHIVE_PROVENANCE_MISMATCH", "archive metadata path does not match its canonical path.");
  return receipt;
}
function archiveAudits(current) {
  return current.runtimeState.execution_log.filter((item) => ("action" in item) && item.action === "archive");
}
function assertArchiveReceiptMatches(current, receipt, audit) {
  if (current.runtimeState.workflow_status !== "closed" || current.runtimeState.lifecycle_state !== "archived") {
    fail("LIFECYCLE_REPLAY_INCOMPLETE", "archive receipt requires the closed + archived CURRENT_TASK tuple.");
  }
  if (audit.task_id !== current.runtimeState.task_id || audit.task_slug !== current.runtimeState.task_slug || audit.document_id !== String(current.frontmatter.document_id)) {
    fail("ARCHIVE_PROVENANCE_MISMATCH", "archive audit identity does not match CURRENT_TASK.");
  }
  if (audit.archive_path !== receipt.relativePath || audit.archive_revision !== receipt.revision || audit.source_revision !== receipt.sourceRevision || audit.idempotency_key !== receipt.idempotencyKey || audit.closure_delta_digest !== receipt.closureDeltaDigest) {
    fail("ARCHIVE_PROVENANCE_MISMATCH", "archive receipt does not match the durable CURRENT_TASK archive audit.");
  }
  if (audit.lesson_admission.decision !== receipt.lessonAdmission.decision || audit.lesson_admission.candidate_refs.join("|") !== receipt.lessonAdmission.candidate_refs.join("|") || audit.lesson_admission.evidence_refs.join("|") !== receipt.lessonAdmission.evidence_refs.join("|")) {
    fail("ARCHIVE_PROVENANCE_MISMATCH", "archive lesson admission does not match the durable CURRENT_TASK archive audit.");
  }
}
function matchingArchiveReceipt(root, current) {
  const audits = archiveAudits(current);
  if (audits.length !== 1)
    fail("LIFECYCLE_REPLAY_INCOMPLETE", "CURRENT_TASK must contain exactly one durable archive audit for reconciliation.");
  const audit = audits[0];
  assertExecutionAuditInBody(current.body, audit);
  if (audit.from_workflow_status !== "active" || audit.from_lifecycle_state !== "active" || audit.to_workflow_status !== "closed" || audit.to_lifecycle_state !== "archived") {
    fail("LIFECYCLE_REPLAY_INCOMPLETE", "archive audit does not describe the frozen active + active to closed + archived transition.");
  }
  const receipt = readCanonicalArchive(root, current, audit.archive_path);
  assertArchiveReceiptMatches(current, receipt, audit);
  return { audit, receipt };
}
function closureEligibilityBlockers(current, delta, archiveAlreadyExists) {
  const blockers = [];
  const identity = extractTaskIdentityFromCurrentTask(current.body);
  if (identity.id === null || identity.slug === null || identity.title === null)
    blockers.push("task identity is not fully materialized in CURRENT_TASK.");
  if (current.runtimeState.workflow_status !== "active" || current.runtimeState.lifecycle_state !== "active")
    blockers.push("first successful close requires active + active.");
  if (current.runtimeState.resume_requires_review || current.runtimeState.resume_review_reasons.length > 0)
    blockers.push("resume review gate is not cleared.");
  if (current.runtimeState.active_step_status !== "completed")
    blockers.push("the admitted current step is not completed.");
  try {
    const implementationSection = findUniqueMarkdownSection(scanMarkdownSections(current.body), REPLAN_SECTION_HEADINGS.implementation_steps, 2);
    if (!implementationSection) {
      blockers.push("CURRENT_TASK is missing the implementation steps section.");
    } else {
      assertReplacementActiveStep(current.runtimeState.active_step_id, current.body.slice(implementationSection.contentStart, implementationSection.contentEnd));
    }
  } catch (error) {
    blockers.push(error instanceof Error ? error.message : String(error));
  }
  if (current.runtimeState.findings.some((item) => item.status === "admitted" || item.status === "in-progress"))
    blockers.push("an admitted or in-progress finding remains unresolved.");
  if (!delta.closure_evidence.acceptance_satisfied)
    blockers.push("acceptance evidence is not satisfied.");
  if (!delta.closure_evidence.validation_complete)
    blockers.push("required validation evidence is incomplete.");
  if (!delta.closure_evidence.no_admitted_or_in_progress_findings)
    blockers.push("closure evidence does not prove the finding queue is clear.");
  if (!delta.closure_evidence.no_unresolved_closure_blocker)
    blockers.push("an unresolved closure blocker remains.");
  for (const [label, gate] of [
    ["release", delta.closure_evidence.release_evidence],
    ["rollback", delta.closure_evidence.rollback_evidence],
    ["observation", delta.closure_evidence.observation_evidence]
  ]) {
    if (gate.triggered && !gate.complete)
      blockers.push(`${label} evidence is triggered but incomplete.`);
  }
  if (!delta.closure_evidence.remaining_risks_non_blocking)
    blockers.push("remaining risks are not explicitly non-blocking.");
  if (!delta.closure_evidence.archive_path_verified)
    blockers.push("the archive path has not been uniquely verified.");
  if (archiveAlreadyExists)
    blockers.push("the canonical archive path is already occupied before the first close.");
  return blockers;
}
function assertArchiveReplay(root, current, proposal) {
  const { audit, receipt } = matchingArchiveReceipt(root, current);
  if (audit.idempotency_key !== proposal.idempotency_key || audit.source_revision !== proposal.source_tuple.revision || audit.task_id !== proposal.source_tuple.task_id || audit.task_slug !== proposal.source_tuple.task_slug || audit.document_id !== proposal.source_tuple.document_id || audit.closure_delta_digest !== digest(proposal.semantic_delta) || audit.evidence_refs.join("|") !== proposal.semantic_delta.evidence_refs.join("|") || digest(audit.authority_evidence) !== digest(proposal.authority_evidence) || receipt.revision !== audit.archive_revision) {
    fail("LIFECYCLE_REPLAY_INCOMPLETE", "archive replay identity, source revision, closure evidence, or archive revision does not match the committed receipt.");
  }
}
function quotedSnapshot(raw) {
  return raw.replace(/\r\n?/g, `
`).split(`
`).map((line) => `> ${line}`).join(`
`);
}
function renderArchiveList(label, values) {
  return [
    `- ${label}:`,
    ...values.length === 0 ? ["  - none"] : values.map((value) => `  - ${yamlScalar(value)}`)
  ];
}
function renderArchiveDocument(current, proposal, delta, archiveRelativePath, closureDeltaDigest) {
  const identity = extractTaskIdentityFromCurrentTask(current.body);
  if (identity.id === null || identity.slug === null || identity.title === null) {
    fail("RUNTIME_IDENTITY_INVALID", "CURRENT_TASK task identity is incomplete for archive rendering.");
  }
  const closure = delta.closure_evidence;
  const lines = [
    "# TASK_ARCHIVE.md",
    "",
    "## 任务元数据",
    "",
    `- task_id: ${yamlScalar(identity.id)}`,
    `- task_title: ${yamlScalar(identity.title)}`,
    `- task_slug: ${yamlScalar(identity.slug)}`,
    `- document_id: ${yamlScalar(current.sourceTuple.document_id)}`,
    `- workflow_status: closed`,
    `- lifecycle_state: archived`,
    `- source_revision: ${current.sourceTuple.revision}`,
    `- archive_path: ${archiveRelativePath}`,
    `- archive_operation: archive-transaction`,
    `- archive_caller: close-task`,
    `- proposal_idempotency_key: ${yamlScalar(proposal.idempotency_key)}`,
    `- closure_delta_digest: ${closureDeltaDigest}`,
    "",
    "## 原始任务包快照",
    "",
    `- source_document_revision: ${current.sourceTuple.revision}`,
    "- CURRENT_TASK snapshot:",
    quotedSnapshot(current.raw),
    "",
    "## 实际改动摘要",
    "",
    `- goal: ${yamlScalar(delta.delivery_summary.goal)}`,
    ...renderArchiveList("actual_changes", delta.delivery_summary.actual_changes),
    "",
    "## 契约与决策记录",
    "",
    "- affected_contracts: preserved in the CURRENT_TASK snapshot; close-task does not mutate CONTRACTS.md.",
    "- confirmed_decisions: preserved in the CURRENT_TASK snapshot; close-task does not mutate DECISIONS.md.",
    "",
    "## 验证与交付证据",
    "",
    "- closure_evidence:",
    `  - acceptance_satisfied: ${String(closure.acceptance_satisfied)}`,
    `  - validation_complete: ${String(closure.validation_complete)}`,
    `  - no_admitted_or_in_progress_findings: ${String(closure.no_admitted_or_in_progress_findings)}`,
    `  - no_unresolved_closure_blocker: ${String(closure.no_unresolved_closure_blocker)}`,
    "  - release_evidence:",
    `    - triggered: ${String(closure.release_evidence.triggered)}`,
    `    - complete: ${String(closure.release_evidence.complete)}`,
    `    - evidence_refs: ${yamlStringArray(closure.release_evidence.evidence_refs)}`,
    "  - rollback_evidence:",
    `    - triggered: ${String(closure.rollback_evidence.triggered)}`,
    `    - complete: ${String(closure.rollback_evidence.complete)}`,
    `    - evidence_refs: ${yamlStringArray(closure.rollback_evidence.evidence_refs)}`,
    "  - observation_evidence:",
    `    - triggered: ${String(closure.observation_evidence.triggered)}`,
    `    - complete: ${String(closure.observation_evidence.complete)}`,
    `    - evidence_refs: ${yamlStringArray(closure.observation_evidence.evidence_refs)}`,
    `  - remaining_risks_non_blocking: ${String(closure.remaining_risks_non_blocking)}`,
    `  - archive_path_verified: ${String(closure.archive_path_verified)}`,
    "",
    `- acceptance_satisfied: ${String(closure.acceptance_satisfied)}`,
    `- validation_complete: ${String(closure.validation_complete)}`,
    ...renderArchiveList("verification", delta.delivery_summary.verification),
    ...renderArchiveList("release_evidence", delta.delivery_summary.release_evidence),
    ...renderArchiveList("rollback_evidence", delta.delivery_summary.rollback_evidence),
    ...renderArchiveList("observation_evidence", delta.delivery_summary.observation_evidence),
    `- next_action: ${yamlScalar(delta.delivery_summary.next_action)}`,
    "",
    "## Lessons 回写",
    "",
    "lesson_admission:",
    `  decision: ${delta.lesson_admission.decision}`,
    `  candidate_refs: ${yamlStringArray(delta.lesson_admission.candidate_refs)}`,
    `  evidence_refs: ${yamlStringArray(delta.lesson_admission.evidence_refs)}`,
    "",
    "## 后续关联",
    "",
    ...renderArchiveList("remaining_risks", delta.remaining_risks),
    `- remaining_risks_non_blocking: ${String(closure.remaining_risks_non_blocking)}`,
    "- next_task: none created by close-task.",
    ""
  ];
  return lines.join(`
`);
}
function makeArchiveAudit(current, proposal, delta, archiveRelativePath, archiveRevision, closureDeltaDigest, next, now) {
  return {
    action: "archive",
    idempotency_key: proposal.idempotency_key,
    operation_kind: "archive-transaction",
    caller: "close-task",
    mode: "default",
    task_id: current.runtimeState.task_id,
    task_slug: current.runtimeState.task_slug,
    document_id: current.sourceTuple.document_id,
    from_workflow_status: "active",
    from_lifecycle_state: "active",
    to_workflow_status: next.workflow_status,
    to_lifecycle_state: next.lifecycle_state,
    source_revision: current.sourceTuple.revision,
    archive_path: archiveRelativePath,
    archive_revision: archiveRevision,
    closure_delta_digest: closureDeltaDigest,
    authority_evidence: proposal.authority_evidence.map((item) => ({ ...item })),
    evidence_refs: [...delta.evidence_refs],
    lesson_admission: {
      decision: delta.lesson_admission.decision,
      candidate_refs: [...delta.lesson_admission.candidate_refs],
      evidence_refs: [...delta.lesson_admission.evidence_refs]
    },
    recorded_at: now
  };
}
function prepareArchiveTransaction(root, current, proposal, now) {
  const delta = proposal.semantic_delta;
  ensureAuthorityKinds(proposal, ["active-task-owner", "evidence-admission"]);
  if (current.runtimeState.workflow_status === "closed" && current.runtimeState.lifecycle_state === "archived") {
    const { audit: audit2, receipt } = matchingArchiveReceipt(root, current);
    if (digest(delta) !== audit2.closure_delta_digest) {
      fail("ARCHIVE_PROVENANCE_MISMATCH", "reconciliation closure evidence does not match the committed archive receipt.");
    }
    if (delta.lesson_admission.decision !== audit2.lesson_admission.decision || delta.lesson_admission.candidate_refs.join("|") !== audit2.lesson_admission.candidate_refs.join("|") || delta.lesson_admission.evidence_refs.join("|") !== audit2.lesson_admission.evidence_refs.join("|")) {
      fail("ARCHIVE_PROVENANCE_MISMATCH", "reconciliation lesson admission does not match the committed archive receipt.");
    }
    if (receipt.sourceRevision !== audit2.source_revision)
      fail("ARCHIVE_PROVENANCE_MISMATCH", "archive source revision does not match the committed archive audit.");
    return null;
  }
  if (current.runtimeState.workflow_status !== "active" || current.runtimeState.lifecycle_state !== "active") {
    fail("CLOSURE_TUPLE_INVALID", "first successful close requires active + active.");
  }
  const archiveTarget = archivePathForTask(root, current);
  const blockers = closureEligibilityBlockers(current, delta, fs2.existsSync(archiveTarget.filePath));
  if (blockers.length > 0)
    fail("CLOSURE_NOT_ELIGIBLE", blockers.join(" "));
  const closureDeltaDigest = digest(delta);
  const nextWithoutAudit = {
    ...current.runtimeState,
    workflow_status: "closed",
    lifecycle_state: "archived",
    resume_requires_review: false,
    resume_review_reasons: [],
    applied_proposals: appendAppliedProposal(current.runtimeState, proposal, current.sourceTuple.revision)
  };
  const nextArchiveContent = renderArchiveDocument(current, proposal, delta, archiveTarget.relativePath, closureDeltaDigest);
  const archiveRevision = sha256(nextArchiveContent);
  const audit = makeArchiveAudit(current, proposal, delta, archiveTarget.relativePath, archiveRevision, closureDeltaDigest, nextWithoutAudit, now);
  const next = {
    ...nextWithoutAudit,
    execution_log: appendExecutionLogEntry(current.runtimeState, audit)
  };
  const nextContent = renderCanonicalCurrentTask(current.frontmatter, current.body, next, { audit });
  return {
    next,
    nextContent,
    archiveFilePath: archiveTarget.filePath,
    archiveRelativePath: archiveTarget.relativePath,
    nextArchiveContent,
    audit,
    archiveRevision
  };
}
var STATUS_RECONCILIATION_BEGIN = "<!-- BEGIN vNext close-task STATUS reconciliation -->";
var STATUS_RECONCILIATION_END = "<!-- END vNext close-task STATUS reconciliation -->";
function renderStatusReconciliation(proposal, delta, archive) {
  return [
    STATUS_RECONCILIATION_BEGIN,
    `- task_id: ${yamlScalar(archive.taskId)}`,
    `- task_slug: ${yamlScalar(archive.taskSlug)}`,
    `- document_id: ${yamlScalar(archive.documentId)}`,
    `- archive_path: ${archive.relativePath}`,
    `- archive_revision: ${archive.revision}`,
    `- source_revision: ${archive.sourceRevision}`,
    `- proposal_idempotency_key: ${yamlScalar(proposal.idempotency_key)}`,
    `- delta_digest: ${digest(delta)}`,
    `- status: ${delta.status}`,
    `- summary: ${yamlScalar(delta.summary)}`,
    `- completed_items: ${yamlStringArray(delta.completed_items)}`,
    `- remaining_risks: ${yamlStringArray(delta.remaining_risks)}`,
    `- next_checkpoint: ${yamlScalar(delta.next_checkpoint)}`,
    `- evidence_refs: ${yamlStringArray(delta.evidence_refs)}`,
    STATUS_RECONCILIATION_END
  ].join(`
`);
}
function readStatusScalar(body, field, location) {
  const escaped = field.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&");
  const match = new RegExp(`^-\\s*${escaped}\\s*:\\s*(.*?)\\s*$`, "m").exec(body);
  if (!match)
    fail("STATUS_INVALID", `${location} reconciliation receipt is missing ${field}.`);
  const raw = match[1].trim();
  if (raw.startsWith('"') || raw.startsWith("'")) {
    try {
      return JSON.parse(raw);
    } catch {
      fail("STATUS_INVALID", `${location}.${field} is not a valid scalar.`);
    }
  }
  return expectString(raw, `${location}.${field}`);
}
function readStatusArray(body, field, location) {
  const raw = readStatusScalar(body, field, location);
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    fail("STATUS_INVALID", `${location}.${field} must be a JSON/YAML inline string array.`);
  }
  return expectStringArray(parsed, `${location}.${field}`, true, 64);
}
function statusDeltaFromReceipt(receipt) {
  return {
    kind: "project-status",
    action: "sync",
    status: receipt.status,
    summary: receipt.summary,
    completed_items: [...receipt.completedItems],
    remaining_risks: [...receipt.remainingRisks],
    next_checkpoint: receipt.nextCheckpoint,
    evidence_refs: [...receipt.evidenceRefs]
  };
}
function readStatusReceipts(content, location) {
  const pattern = new RegExp(`${STATUS_RECONCILIATION_BEGIN.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}\\r?\\n([\\s\\S]*?)\\r?\\n${STATUS_RECONCILIATION_END.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}`, "g");
  const receipts = [];
  for (const match of content.matchAll(pattern)) {
    const body = match[1] ?? "";
    const archiveRevision = readStatusScalar(body, "archive_revision", location);
    const sourceRevision = readStatusScalar(body, "source_revision", location);
    const deltaDigest = readStatusScalar(body, "delta_digest", location);
    if (!/^[a-f0-9]{64}$/.test(archiveRevision) || !/^[a-f0-9]{64}$/.test(sourceRevision) || !/^[a-f0-9]{64}$/.test(deltaDigest)) {
      fail("STATUS_INVALID", `${location} reconciliation receipt has an invalid revision or digest.`);
    }
    const receipt = {
      taskId: readStatusScalar(body, "task_id", location),
      taskSlug: readStatusScalar(body, "task_slug", location),
      documentId: readStatusScalar(body, "document_id", location),
      archivePath: normalizeRepoPath(readStatusScalar(body, "archive_path", location), `${location}.archive_path`),
      archiveRevision,
      sourceRevision,
      idempotencyKey: readStatusScalar(body, "proposal_idempotency_key", location),
      deltaDigest,
      status: expectEnum(readStatusScalar(body, "status", location), ["completed", "observing"], `${location}.status`),
      summary: readStatusScalar(body, "summary", location),
      completedItems: readStatusArray(body, "completed_items", location),
      remainingRisks: readStatusArray(body, "remaining_risks", location),
      nextCheckpoint: readStatusScalar(body, "next_checkpoint", location),
      evidenceRefs: readStatusArray(body, "evidence_refs", location)
    };
    if (!SAFE_KEY_PATTERN.test(receipt.idempotencyKey))
      fail("STATUS_INVALID", `${location}.proposal_idempotency_key is invalid.`);
    if (!DOCUMENT_ID_PATTERN.test(receipt.documentId))
      fail("STATUS_INVALID", `${location}.document_id is invalid.`);
    try {
      validateTaskId(receipt.taskId);
      validateTaskSlug(receipt.taskSlug);
    } catch (error) {
      fail("STATUS_INVALID", error instanceof Error ? error.message : String(error));
    }
    if (digest(statusDeltaFromReceipt(receipt)) !== receipt.deltaDigest) {
      fail("STATUS_INVALID", `${location} reconciliation receipt delta digest does not match its typed fields.`);
    }
    if (receipts.some((existing) => existing.archivePath === receipt.archivePath)) {
      fail("STATUS_INVALID", `${location} contains duplicate reconciliation receipts for ${receipt.archivePath}.`);
    }
    receipts.push(receipt);
  }
  return receipts;
}
function matchingStatusReceipt(content, location, archive) {
  const receipts = readStatusReceipts(content, location);
  const matches = receipts.filter((receipt) => receipt.archivePath === archive.relativePath || receipt.taskId === archive.taskId && receipt.taskSlug === archive.taskSlug && receipt.documentId === archive.documentId);
  if (matches.length > 1)
    fail("STATUS_INVALID", `${location} contains multiple receipts for the same archived task.`);
  return matches[0] ?? null;
}
var STATUS_PLACEHOLDER_VALUES = new Set(["none", "n/a", "无", "暂无"]);
function statusItemText(line) {
  const match = /^-\s+(?:\[[ xX]\]\s*)?(.+?)\s*$/.exec(line);
  if (!match)
    return null;
  const value = match[1].trim();
  if (value.length === 0 || STATUS_PLACEHOLDER_VALUES.has(value.toLowerCase()))
    return null;
  return value;
}
function isStatusPlaceholderLine(line) {
  const match = /^-\s+(?:\[[ xX]\]\s*)?(.+?)\s*$/.exec(line);
  return match !== null && STATUS_PLACEHOLDER_VALUES.has(match[1].trim().toLowerCase());
}
function validateStatusProjectionText(value, location) {
  if (value.includes(`
`) || value.includes("\r")) {
    fail("STATUS_RECONCILIATION_CONFLICT", `${location} cannot contain a line break.`);
  }
  return value.trim();
}
function readStatusSectionLines(content, title, location) {
  const section = findUniqueMarkdownSection(scanMarkdownSections(content), [title], 2);
  if (!section)
    fail("STATUS_INVALID", `${location} is missing the required ## ${title} section.`);
  const body = content.slice(section.contentStart, section.contentEnd).replace(/\r\n?/g, `
`).trim();
  return body.length > 0 ? body.split(`
`) : [];
}
function replaceStatusSectionBody(content, title, lines, location) {
  const section = findUniqueMarkdownSection(scanMarkdownSections(content), [title], 2);
  if (!section)
    fail("STATUS_INVALID", `${location} is missing the required ## ${title} section.`);
  const body = lines.join(`
`).trim();
  return content.slice(0, section.contentStart) + `${body.length > 0 ? `
${body}

` : `
`}` + content.slice(section.contentEnd);
}
function statusItemMatchCount(lines, item) {
  return lines.filter((line) => statusItemText(line) === item).length;
}
function projectStatusOverview(content, delta, location) {
  const lines = readStatusSectionLines(content, "项目概览", location);
  const statusFieldPattern = /^-\s*(?:当前状态|status)\s*[:：]\s*.*$/i;
  const matches = lines.map((line, index) => ({ line, index })).filter((item) => statusFieldPattern.test(item.line));
  if (matches.length > 1)
    fail("STATUS_RECONCILIATION_CONFLICT", `${location} contains multiple project status fields.`);
  const statusLine = `- 当前状态：${delta.status}`;
  if (matches.length === 1) {
    const next = [...lines];
    next[matches[0].index] = statusLine;
    return replaceStatusSectionBody(content, "项目概览", next, location);
  }
  return replaceStatusSectionBody(content, "项目概览", [...lines, statusLine], location);
}
function projectStatusCompletedItems(content, delta, location) {
  const completedLines = readStatusSectionLines(content, "✅ 已完成且稳定", location);
  const developmentLines = readStatusSectionLines(content, "\uD83D\uDD28 正在开发", location);
  const unsupportedDevelopmentLines = developmentLines.filter((line) => line.trim().length > 0 && statusItemText(line) === null && !isStatusPlaceholderLine(line));
  if (unsupportedDevelopmentLines.length > 0) {
    fail("STATUS_RECONCILIATION_CONFLICT", `${location} contains unsupported content in the in-progress section; the old record cannot be identified deterministically.`);
  }
  const meaningfulDevelopment = developmentLines.map(statusItemText).filter((item) => item !== null);
  const removeDevelopmentIndexes = new Set;
  const appendCompleted = [];
  for (const rawItem of delta.completed_items) {
    const item = validateStatusProjectionText(rawItem, `${location}.completed_items`);
    const completedMatches = statusItemMatchCount(completedLines, item);
    if (completedMatches > 1)
      fail("STATUS_RECONCILIATION_CONFLICT", `${location} contains duplicate completed item "${item}".`);
    const developmentMatches = developmentLines.map((line, index) => ({ line, index })).filter((entry) => statusItemText(entry.line) === item);
    if (developmentMatches.length > 1) {
      fail("STATUS_RECONCILIATION_CONFLICT", `${location} cannot determine which in-progress record to remove for "${item}".`);
    }
    if (developmentMatches.length === 0 && completedMatches === 0 && meaningfulDevelopment.length > 0) {
      fail("STATUS_RECONCILIATION_CONFLICT", `${location} cannot deterministically map completed item "${item}" to the existing in-progress records.`);
    }
    if (developmentMatches.length === 1)
      removeDevelopmentIndexes.add(developmentMatches[0].index);
    if (completedMatches === 0)
      appendCompleted.push(item);
  }
  const nextDevelopmentLines = developmentLines.filter((_, index) => !removeDevelopmentIndexes.has(index));
  let nextCompletedLines = [...completedLines];
  if (appendCompleted.length > 0) {
    nextCompletedLines = nextCompletedLines.filter((line) => !isStatusPlaceholderLine(line));
    while (nextCompletedLines.length > 0 && nextCompletedLines[nextCompletedLines.length - 1].trim() === "")
      nextCompletedLines.pop();
    nextCompletedLines.push(...appendCompleted.map((item) => `- ${item}`));
  }
  let next = replaceStatusSectionBody(content, "\uD83D\uDD28 正在开发", nextDevelopmentLines, location);
  return replaceStatusSectionBody(next, "✅ 已完成且稳定", nextCompletedLines, location);
}
function projectStatusRemainingRisks(content, delta, location) {
  const riskItems = delta.remaining_risks.map((item) => validateStatusProjectionText(item, `${location}.remaining_risks`));
  if (riskItems.length === 0)
    return content;
  const lines = readStatusSectionLines(content, "⚠️ 已知风险 / 观察点", location);
  const appendItems = riskItems.filter((item) => {
    const matches = statusItemMatchCount(lines, item);
    if (matches > 1)
      fail("STATUS_RECONCILIATION_CONFLICT", `${location} contains duplicate remaining risk "${item}".`);
    return matches === 0;
  });
  if (appendItems.length === 0)
    return content;
  const nextLines = lines.filter((line) => !isStatusPlaceholderLine(line));
  while (nextLines.length > 0 && nextLines[nextLines.length - 1].trim() === "")
    nextLines.pop();
  nextLines.push(...appendItems.map((item) => `- ${item}`));
  return replaceStatusSectionBody(content, "⚠️ 已知风险 / 观察点", nextLines, location);
}
function projectStatusCheckpoint(content, delta, location) {
  const checkpoint = validateStatusProjectionText(delta.next_checkpoint, `${location}.next_checkpoint`);
  const lines = readStatusSectionLines(content, "\uD83D\uDD1C 下一检查点", location);
  const nonEmpty = lines.filter((line) => line.trim().length > 0);
  if (nonEmpty.some((line) => statusItemText(line) === null && !isStatusPlaceholderLine(line))) {
    fail("STATUS_RECONCILIATION_CONFLICT", `${location} next checkpoint section contains unsupported non-list content.`);
  }
  if (nonEmpty.filter((line) => statusItemText(line) !== null).length > 1) {
    fail("STATUS_RECONCILIATION_CONFLICT", `${location} contains multiple next checkpoint records.`);
  }
  return replaceStatusSectionBody(content, "\uD83D\uDD1C 下一检查点", [`- ${checkpoint}`], location);
}
function projectStatusDelta(content, delta, location) {
  let next = projectStatusOverview(content, delta, location);
  next = projectStatusCompletedItems(next, delta, location);
  next = projectStatusRemainingRisks(next, delta, location);
  return projectStatusCheckpoint(next, delta, location);
}
function assertStatusProjection(content, delta, location) {
  const overviewLines = readStatusSectionLines(content, "项目概览", location);
  const statusLines = overviewLines.filter((line) => /^-\s*(?:当前状态|status)\s*[:：]\s*.*$/i.test(line));
  if (statusLines.length !== 1 || statusLines[0] !== `- 当前状态：${delta.status}`) {
    fail("STATUS_PROVENANCE_MISMATCH", `${location} project status projection no longer matches the typed status delta.`);
  }
  const completedLines = readStatusSectionLines(content, "✅ 已完成且稳定", location);
  const developmentLines = readStatusSectionLines(content, "\uD83D\uDD28 正在开发", location);
  for (const rawItem of delta.completed_items) {
    const item = validateStatusProjectionText(rawItem, `${location}.completed_items`);
    if (statusItemMatchCount(completedLines, item) !== 1 || statusItemMatchCount(developmentLines, item) !== 0) {
      fail("STATUS_PROVENANCE_MISMATCH", `${location} completed item projection no longer matches "${item}".`);
    }
  }
  const riskLines = readStatusSectionLines(content, "⚠️ 已知风险 / 观察点", location);
  for (const rawItem of delta.remaining_risks) {
    const item = validateStatusProjectionText(rawItem, `${location}.remaining_risks`);
    if (statusItemMatchCount(riskLines, item) !== 1) {
      fail("STATUS_PROVENANCE_MISMATCH", `${location} remaining risk projection no longer matches "${item}".`);
    }
  }
  const checkpointLines = readStatusSectionLines(content, "\uD83D\uDD1C 下一检查点", location);
  if (checkpointLines.filter((line) => statusItemText(line) !== null).length !== 1 || statusItemText(checkpointLines.find((line) => statusItemText(line) !== null) ?? "") !== delta.next_checkpoint) {
    fail("STATUS_PROVENANCE_MISMATCH", `${location} next checkpoint projection no longer matches the typed status delta.`);
  }
}
function appendStatusReconciliation(content, marker, location) {
  const section = findUniqueMarkdownSection(scanMarkdownSections(content), ["最近更新记录", "Recent Updates"], 2);
  if (!section)
    fail("STATUS_INVALID", `${location} is missing the required ## 最近更新记录 section.`);
  const existing = content.slice(section.contentStart, section.contentEnd).replace(/\r\n?/g, `
`).trimEnd();
  return content.slice(0, section.contentStart) + `
${existing.trim().length > 0 ? `${existing}

` : ""}${marker}
` + content.slice(section.contentEnd);
}
function prepareProjectStatusTransaction(root, current, proposal) {
  ensureAuthorityKinds(proposal, ["evidence-admission"]);
  const { receipt } = matchingArchiveReceipt(root, current);
  const target = workflowDocPathForRoot(root, "STATUS.md");
  if (!fs2.existsSync(target.filePath))
    fail("RUNTIME_SOURCE_MISSING", `STATUS.md is missing: ${target.relativePath}`);
  const originalStatusContent = fs2.readFileSync(target.filePath, "utf8");
  const sections = scanMarkdownSections(originalStatusContent);
  for (const heading of ["项目概览", "✅ 已完成且稳定", "\uD83D\uDD28 正在开发", "\uD83D\uDCCB 待开发", "⚠️ 已知风险 / 观察点", "❌ 已移除 / 推迟", "\uD83D\uDD1C 下一检查点", "最近更新记录"]) {
    if (!findUniqueMarkdownSection(sections, [heading], 2))
      fail("STATUS_INVALID", `STATUS.md is missing required ## ${heading} section.`);
  }
  const existingReceipt = matchingStatusReceipt(originalStatusContent, target.relativePath, receipt);
  const deltaDigest = digest(proposal.semantic_delta);
  if (existingReceipt) {
    if (existingReceipt.taskId !== receipt.taskId || existingReceipt.taskSlug !== receipt.taskSlug || existingReceipt.documentId !== receipt.documentId || existingReceipt.archivePath !== receipt.relativePath || existingReceipt.archiveRevision !== receipt.revision || existingReceipt.sourceRevision !== receipt.sourceRevision) {
      fail("STATUS_PROVENANCE_MISMATCH", "STATUS reconciliation receipt does not match the canonical archive.");
    }
    if (existingReceipt.deltaDigest !== deltaDigest || existingReceipt.status !== proposal.semantic_delta.status) {
      fail("STATUS_RECONCILIATION_CONFLICT", "STATUS already contains a different reconciliation for this archived task.");
    }
    if (digest(statusDeltaFromReceipt(existingReceipt)) !== deltaDigest) {
      fail("STATUS_RECONCILIATION_CONFLICT", "STATUS reconciliation receipt no longer matches its typed status delta.");
    }
    assertStatusProjection(originalStatusContent, proposal.semantic_delta, target.relativePath);
    return null;
  }
  const marker = renderStatusReconciliation(proposal, proposal.semantic_delta, receipt);
  const projectedStatusContent = projectStatusDelta(originalStatusContent, proposal.semantic_delta, target.relativePath);
  const nextStatusContent = appendStatusReconciliation(projectedStatusContent, marker, target.relativePath);
  return {
    statusFilePath: target.filePath,
    statusRelativePath: target.relativePath,
    nextStatusContent,
    originalStatusContent,
    statusRevision: sha256(nextStatusContent),
    archive: receipt
  };
}
function renderLessonMarker(candidate, archive) {
  return `<!-- vNext lesson record: ${JSON.stringify({
    task_id: archive.taskId,
    task_slug: archive.taskSlug,
    document_id: archive.documentId,
    archive_path: archive.relativePath,
    archive_revision: archive.revision,
    source_revision: archive.sourceRevision,
    candidate_ref: candidate.candidate_ref,
    candidate_digest: digest(candidate),
    evidence_refs: candidate.evidence_refs
  })} -->`;
}
function readLessonMarkers(content, location) {
  const pattern = /<!-- vNext lesson record: (\{[^\r\n]+\}) -->/g;
  const result = [];
  for (const match of content.matchAll(pattern)) {
    let parsed;
    try {
      parsed = JSON.parse(match[1]);
    } catch {
      fail("LESSON_INVALID", `${location} contains an invalid vNext lesson provenance marker.`);
    }
    const record = expectRecord(parsed, `${location}.lesson_marker`);
    expectExactKeys(record, ["task_id", "task_slug", "document_id", "archive_path", "archive_revision", "source_revision", "candidate_ref", "candidate_digest", "evidence_refs"], `${location}.lesson_marker`);
    const archiveRevision = expectString(record.archive_revision, `${location}.lesson_marker.archive_revision`);
    const sourceRevision = expectString(record.source_revision, `${location}.lesson_marker.source_revision`);
    const candidateDigest = expectString(record.candidate_digest, `${location}.lesson_marker.candidate_digest`);
    if (!/^[a-f0-9]{64}$/.test(archiveRevision) || !/^[a-f0-9]{64}$/.test(sourceRevision) || !/^[a-f0-9]{64}$/.test(candidateDigest))
      fail("LESSON_INVALID", `${location} lesson provenance marker has an invalid revision or digest.`);
    result.push({
      task_id: expectString(record.task_id, `${location}.lesson_marker.task_id`),
      task_slug: expectString(record.task_slug, `${location}.lesson_marker.task_slug`),
      document_id: expectString(record.document_id, `${location}.lesson_marker.document_id`),
      archive_path: normalizeRepoPath(expectString(record.archive_path, `${location}.lesson_marker.archive_path`), `${location}.lesson_marker.archive_path`),
      archive_revision: archiveRevision,
      source_revision: sourceRevision,
      candidate_ref: expectString(record.candidate_ref, `${location}.lesson_marker.candidate_ref`, SAFE_KEY_PATTERN),
      candidate_digest: candidateDigest,
      evidence_refs: validateEvidenceRefs(record.evidence_refs, `${location}.lesson_marker.evidence_refs`)
    });
  }
  return result;
}
function renderLessonCandidate(candidate, archive) {
  return [
    renderLessonMarker(candidate, archive),
    `- 场景：${yamlScalar(candidate.scene)}`,
    `  - 结论：${yamlScalar(candidate.conclusion)}`,
    `  - 触发信号：${yamlScalar(candidate.trigger)}`,
    `  - 原因：${yamlScalar(candidate.cause)}`,
    `  - 应对动作：${yamlScalar(candidate.action)}`,
    `  - 消费者：${yamlScalar(candidate.consumer)}`,
    `  - 证据引用：${yamlStringArray(candidate.evidence_refs)}`
  ].join(`
`);
}
function countExactOccurrences(content, value) {
  if (value.length === 0)
    return 0;
  let count = 0;
  let offset = 0;
  while (true) {
    const index = content.indexOf(value, offset);
    if (index < 0)
      return count;
    count += 1;
    offset = index + value.length;
  }
}
function renderLessonMarkerFromData(marker) {
  return `<!-- vNext lesson record: ${JSON.stringify({
    task_id: marker.task_id,
    task_slug: marker.task_slug,
    document_id: marker.document_id,
    archive_path: marker.archive_path,
    archive_revision: marker.archive_revision,
    source_revision: marker.source_revision,
    candidate_ref: marker.candidate_ref,
    candidate_digest: marker.candidate_digest,
    evidence_refs: marker.evidence_refs
  })} -->`;
}
function archiveReceiptFromLessonMarker(marker) {
  return {
    filePath: "",
    relativePath: marker.archive_path,
    raw: "",
    revision: marker.archive_revision,
    taskId: marker.task_id,
    taskSlug: marker.task_slug,
    taskTitle: "",
    documentId: marker.document_id,
    sourceRevision: marker.source_revision,
    archivePath: marker.archive_path,
    idempotencyKey: "lesson-marker-replay",
    closureDeltaDigest: "0".repeat(64),
    lessonAdmission: { decision: "defer", candidate_refs: [], evidence_refs: [] }
  };
}
function parseLessonRenderedScalar(raw, location) {
  const value = raw.trim();
  if (value.startsWith('"')) {
    try {
      return expectText(JSON.parse(value), location);
    } catch (error) {
      if (error instanceof VNextRuntimeError)
        throw error;
      fail("LESSON_INVALID", `${location} is not a valid rendered scalar.`);
    }
  }
  return expectText(value, location);
}
function readLessonRenderedField(block, label, indent, location) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`^${indent}-\\s*${escaped}：(.+?)\\s*$`, "m").exec(block);
  if (!match)
    fail("LESSON_INVALID", `${location} is missing the visible ${label} field.`);
  return parseLessonRenderedScalar(match[1], `${location}.${label}`);
}
function readLessonRenderedEvidenceRefs(block, location) {
  const match = /^\s{2}-\s*证据引用：(.+?)\s*$/m.exec(block);
  if (!match)
    fail("LESSON_INVALID", `${location} is missing the visible 证据引用 field.`);
  let parsed;
  try {
    parsed = JSON.parse(match[1].trim());
  } catch {
    fail("LESSON_INVALID", `${location}.evidence_refs is not a JSON array.`);
  }
  return validateEvidenceRefs(parsed, `${location}.evidence_refs`);
}
function readDurableLessonRecord(content, marker, location) {
  const markerText = renderLessonMarkerFromData(marker);
  if (countExactOccurrences(content, markerText) !== 1) {
    fail("LESSON_INVALID", `${location} contains a non-canonical or duplicate lesson provenance marker.`);
  }
  const markerStart = content.indexOf(markerText);
  const sections = scanMarkdownSections(content);
  const categorySection = sections.find((section) => section.level === 2 && LESSON_CATEGORIES.includes(section.title) && markerStart >= section.contentStart && markerStart < section.contentEnd);
  if (!categorySection)
    fail("LESSON_INVALID", `${location} lesson marker is not inside a canonical lesson category section.`);
  const nextMarker = content.indexOf("<!-- vNext lesson record:", markerStart + markerText.length);
  const nextSection = sections.filter((section) => section.level === 2 && section.headingStart > markerStart).map((section) => section.headingStart).sort((left, right) => left - right)[0];
  const candidateEnd = Math.min(nextMarker < 0 ? content.length : nextMarker, nextSection === undefined ? content.length : nextSection);
  const block = content.slice(markerStart, candidateEnd).replace(/\r\n?/g, `
`);
  const candidate = {
    candidate_ref: marker.candidate_ref,
    category: categorySection.title,
    scene: readLessonRenderedField(block, "场景", "", `${location}.${marker.candidate_ref}`),
    conclusion: readLessonRenderedField(block, "结论", "  ", `${location}.${marker.candidate_ref}`),
    trigger: readLessonRenderedField(block, "触发信号", "  ", `${location}.${marker.candidate_ref}`),
    cause: readLessonRenderedField(block, "原因", "  ", `${location}.${marker.candidate_ref}`),
    action: readLessonRenderedField(block, "应对动作", "  ", `${location}.${marker.candidate_ref}`),
    consumer: readLessonRenderedField(block, "消费者", "  ", `${location}.${marker.candidate_ref}`),
    evidence_refs: readLessonRenderedEvidenceRefs(block, `${location}.${marker.candidate_ref}`)
  };
  if (marker.evidence_refs.join("|") !== candidate.evidence_refs.join("|")) {
    fail("LESSON_PROVENANCE_MISMATCH", `${location}.${marker.candidate_ref} marker evidence_refs do not match the visible Lesson record.`);
  }
  if (digest(candidate) !== marker.candidate_digest) {
    fail("LESSON_PROVENANCE_MISMATCH", `${location}.${marker.candidate_ref} marker digest does not match the visible Lesson record.`);
  }
  const archive = archiveReceiptFromLessonMarker(marker);
  if (countExactOccurrences(content, renderLessonCandidate(candidate, archive)) !== 1) {
    fail("LESSON_PROVENANCE_MISMATCH", `${location}.${marker.candidate_ref} visible Lesson record drifted from its deterministic rendering.`);
  }
  return { marker, candidate };
}
function readDurableLessonRecords(content, location) {
  return readLessonMarkers(content, location).map((marker, index) => readDurableLessonRecord(content, marker, `${location}.lesson[${index}]`));
}
function appendLessonCandidates(content, candidates, archive, location) {
  const additions = new Map;
  for (const candidate of candidates) {
    const list = additions.get(candidate.category) ?? [];
    list.push(candidate);
    additions.set(candidate.category, list);
  }
  let nextContent = content;
  let candidateCount = 0;
  const ordered = [...additions.entries()].sort((left, right) => left[0].localeCompare(right[0]));
  for (const [category, categoryCandidates] of ordered) {
    const sections = scanMarkdownSections(nextContent);
    const section = findUniqueMarkdownSection(sections, [category], 2);
    if (!section)
      fail("LESSON_INVALID", `${location} is missing the required ## ${category} section.`);
    const rendered = categoryCandidates.map((candidate) => renderLessonCandidate(candidate, archive)).join(`

`);
    const existing = nextContent.slice(section.contentStart, section.contentEnd).replace(/\r\n?/g, `
`).trimEnd();
    nextContent = nextContent.slice(0, section.contentStart) + `
${existing.trim().length > 0 ? `${existing}

` : ""}${rendered}
` + nextContent.slice(section.contentEnd);
    candidateCount += categoryCandidates.length;
  }
  return { content: nextContent, candidateCount };
}
function prepareLessonRecordTransaction(root, current, proposal) {
  ensureAuthorityKinds(proposal, ["evidence-admission"]);
  const { receipt } = matchingArchiveReceipt(root, current);
  if (receipt.lessonAdmission.decision !== "admit") {
    fail("KNOWLEDGE_ADMISSION_INVALID", "lesson-record-transaction is allowed only when the durable archive lesson admission is admit.");
  }
  const delta = proposal.semantic_delta;
  const admissionRefs = new Set(receipt.lessonAdmission.candidate_refs);
  const candidateRefs = new Set(delta.candidates.map((candidate) => candidate.candidate_ref));
  if (admissionRefs.size !== candidateRefs.size || [...admissionRefs].some((ref) => !candidateRefs.has(ref))) {
    fail("KNOWLEDGE_ADMISSION_INVALID", "lesson-record candidates must exactly match the durable archive lesson admission candidate_refs.");
  }
  if (!receipt.lessonAdmission.evidence_refs.every((ref) => delta.evidence_refs.includes(ref))) {
    fail("KNOWLEDGE_ADMISSION_INVALID", "lesson-record evidence_refs must cover the durable archive lesson admission evidence_refs.");
  }
  const target = workflowDocPathForRoot(root, "LESSONS.md");
  if (!fs2.existsSync(target.filePath))
    fail("RUNTIME_SOURCE_MISSING", `LESSONS.md is missing: ${target.relativePath}`);
  const originalLessonsContent = fs2.readFileSync(target.filePath, "utf8");
  const sections = scanMarkdownSections(originalLessonsContent);
  for (const heading of ["使用规则", "通用", "数据与存储", "前端与交互", "后端与服务", "测试与回归", "部署与运行时"]) {
    if (!findUniqueMarkdownSection(sections, [heading], 2))
      fail("LESSON_INVALID", `LESSONS.md is missing the required ## ${heading} section.`);
  }
  const existingRecords = readDurableLessonRecords(originalLessonsContent, target.relativePath);
  const newCandidates = [];
  for (const candidate of delta.candidates) {
    const matchingRefs = existingRecords.filter((record) => record.marker.candidate_ref === candidate.candidate_ref);
    if (matchingRefs.length > 1) {
      fail("LESSON_INVALID", `LESSONS contains duplicate durable records for candidate ${candidate.candidate_ref}.`);
    }
    if (matchingRefs.length > 0) {
      for (const existing of matchingRefs) {
        const marker = existing.marker;
        if (marker.task_id !== receipt.taskId || marker.task_slug !== receipt.taskSlug || marker.document_id !== receipt.documentId || marker.archive_path !== receipt.relativePath || marker.archive_revision !== receipt.revision || marker.source_revision !== receipt.sourceRevision || marker.candidate_digest !== digest(candidate) || marker.evidence_refs.join("|") !== candidate.evidence_refs.join("|") || digest(existing.candidate) !== digest(candidate)) {
          fail("LESSON_PROVENANCE_MISMATCH", `lesson candidate ${candidate.candidate_ref} has conflicting durable provenance.`);
        }
      }
      continue;
    }
    const semanticDuplicate = existingRecords.some((record) => record.marker.candidate_digest === digest(candidate));
    if (semanticDuplicate)
      continue;
    newCandidates.push(candidate);
  }
  if (newCandidates.length === 0)
    return null;
  const appended = appendLessonCandidates(originalLessonsContent, newCandidates, receipt, target.relativePath);
  return {
    lessonsFilePath: target.filePath,
    lessonsRelativePath: target.relativePath,
    nextLessonsContent: appended.content,
    originalLessonsContent,
    lessonsRevision: sha256(appended.content),
    archive: receipt,
    candidateCount: appended.candidateCount
  };
}
function assertRequestedCloseTargets(root, current, proposal) {
  if (proposal.source_tuple.path !== current.relativePath)
    fail("RUNTIME_PATH_INVALID", "close-task proposal source path is not the exact canonical CURRENT_TASK path.");
  if (proposal.operation_kind === "archive-transaction") {
    const archive = archivePathForTask(root, current);
    if (proposal.requested_write_targets.length !== 2 || proposal.requested_write_targets[0] !== current.relativePath || proposal.requested_write_targets[1] !== archive.relativePath) {
      fail("RUNTIME_PATH_INVALID", "archive proposal must name CURRENT_TASK and its exact identity-derived archive path.");
    }
    return;
  }
  const file = proposal.operation_kind === "project-status-transaction" ? "STATUS.md" : "LESSONS.md";
  const target = workflowDocPathForRoot(root, file);
  if (proposal.requested_write_targets.length !== 1 || proposal.requested_write_targets[0] !== target.relativePath) {
    fail("RUNTIME_PATH_INVALID", `${file} proposal must name only its exact canonical path.`);
  }
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
function appendExecutionLogEntry(current, entry) {
  return [...current.execution_log, entry].slice(-MAX_EXECUTION_LOG);
}
function makeReplanAudit(current, proposal, next, now) {
  const delta = proposal.semantic_delta;
  let action;
  if (delta.kind === "lifecycle" && delta.action === "supersede")
    action = "supersede";
  else if (delta.kind === "task-state" && REPLAN_TASK_STATE_ACTIONS.includes(delta.action))
    action = delta.action;
  else
    fail("RUNTIME_SCHEMA_INVALID", "Only Slice B transitions may create a replan audit record.");
  if (delta.kind !== "task-state" && delta.kind !== "lifecycle") {
    fail("RUNTIME_SCHEMA_INVALID", "Only task-state and lifecycle deltas may create a replan audit record.");
  }
  const deltaEvidenceRefs = delta.evidence_refs;
  const base = {
    action,
    idempotency_key: proposal.idempotency_key,
    operation_kind: proposal.operation_kind,
    caller: proposal.caller,
    mode: action === "supersede" ? "supersede" : "replan",
    task_id: current.runtimeState.task_id,
    task_slug: current.runtimeState.task_slug,
    document_id: current.sourceTuple.document_id,
    from_workflow_status: current.runtimeState.workflow_status,
    from_lifecycle_state: current.runtimeState.lifecycle_state,
    to_workflow_status: next.workflow_status,
    to_lifecycle_state: next.lifecycle_state,
    source_revision: current.sourceTuple.revision,
    authority_evidence: proposal.authority_evidence.map((item) => ({ ...item })),
    evidence_refs: [...deltaEvidenceRefs],
    recorded_at: now
  };
  if (action === "supersede" && delta.kind === "lifecycle" && delta.action === "supersede") {
    return {
      ...base,
      invalidation_kind: delta.invalidation_kind,
      invalidation_reason: delta.invalidation_reason,
      partial_diff_disposition: {
        reusable: [...delta.partial_diff_disposition.reusable],
        rollback_required: [...delta.partial_diff_disposition.rollback_required],
        stop_propagation: [...delta.partial_diff_disposition.stop_propagation]
      }
    };
  }
  return base;
}
function expectedReplanReplayAudit(current, proposal) {
  const entry = current.runtimeState.execution_log.find((item) => ("action" in item) && item.action !== "archive" && item.idempotency_key === proposal.idempotency_key);
  if (!entry)
    fail("RUNTIME_REPLAY_INCOMPLETE", "replan replay is missing its durable execution audit record.");
  return entry;
}
function assertNoLaterReplanAudit(current, audit, failureCode = "RUNTIME_REPLAY_INCOMPLETE") {
  const index = current.runtimeState.execution_log.findIndex((item) => item === audit);
  if (index < 0)
    fail(failureCode, "replay audit record is not part of the current execution log.");
  if (current.runtimeState.execution_log.slice(index + 1).some((item) => ("action" in item))) {
    fail(failureCode, "a later same-task lifecycle or replan transition has changed the replay boundary.");
  }
}
function assertTaskStateReplay(current, proposal) {
  if (proposal.semantic_delta.kind !== "task-state" || !REPLAN_TASK_STATE_ACTIONS.includes(proposal.semantic_delta.action))
    return;
  const delta = proposal.semantic_delta;
  const audit = expectedReplanReplayAudit(current, proposal);
  assertExecutionAuditInBody(current.body, audit);
  assertNoLaterReplanAudit(current, audit);
  if (delta.action === "mark-replan-blocked") {
    if (current.runtimeState.workflow_status !== "blocked_by_replan" || current.runtimeState.lifecycle_state !== "active")
      fail("RUNTIME_REPLAY_INCOMPLETE", "mark-replan-blocked replay no longer has the blocked_by_replan + active tuple.");
  } else if (delta.action === "clear-replan-block") {
    if (current.runtimeState.workflow_status !== "active" || current.runtimeState.lifecycle_state !== "active")
      fail("RUNTIME_REPLAY_INCOMPLETE", "clear-replan-block replay no longer has the active + active tuple.");
  } else {
    const commitDelta = delta;
    if (current.runtimeState.workflow_status !== "active" || current.runtimeState.lifecycle_state !== "active")
      fail("RUNTIME_REPLAY_INCOMPLETE", "commit-replan replay no longer has the active + active tuple.");
    assertReplacementActiveStep(commitDelta.active_step_id, commitDelta.replacement_definition.implementation_steps);
    if (current.runtimeState.active_step_id !== commitDelta.active_step_id || current.runtimeState.active_step_status !== "ready")
      fail("RUNTIME_REPLAY_INCOMPLETE", "commit-replan replay no longer has the replacement active step ready.");
    if (current.runtimeState.resume_requires_review || current.runtimeState.resume_review_reasons.length > 0)
      fail("RUNTIME_REPLAY_INCOMPLETE", "commit-replan replay no longer has a cleared resume gate.");
    assertReplanDefinitionSections(current.body, commitDelta.replacement_definition);
  }
  const expectedEvidenceRefs = delta.evidence_refs;
  if (audit.idempotency_key !== proposal.idempotency_key || audit.action !== delta.action || audit.source_revision !== proposal.source_tuple.revision || audit.evidence_refs.join("|") !== expectedEvidenceRefs.join("|") || audit.task_id !== current.runtimeState.task_id || audit.task_slug !== current.runtimeState.task_slug || audit.document_id !== current.sourceTuple.document_id) {
    fail("RUNTIME_REPLAY_INCOMPLETE", "replan replay audit does not match the proposal identity or evidence.");
  }
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
  if (delta.action === "mark-replan-blocked") {
    ensureAuthorityKinds(proposal, ["active-task-owner", "scope-admission", "evidence-admission"]);
    if (current.runtimeState.workflow_status !== "active" || current.runtimeState.lifecycle_state !== "active") {
      fail("REPLAN_TRANSITION_INVALID", "mark-replan-blocked requires active + active.");
    }
    const nextWithoutAudit = {
      ...current.runtimeState,
      workflow_status: "blocked_by_replan",
      lifecycle_state: "active",
      applied_proposals: appendAppliedProposal(current.runtimeState, proposal, current.sourceTuple.revision)
    };
    const audit = makeReplanAudit(current, proposal, nextWithoutAudit, now);
    return {
      next: { ...nextWithoutAudit, execution_log: appendExecutionLogEntry(current.runtimeState, audit) },
      audit
    };
  }
  if (delta.action === "clear-replan-block") {
    ensureAuthorityKinds(proposal, ["active-task-owner", "scope-admission", "evidence-admission"]);
    if (current.runtimeState.workflow_status !== "blocked_by_replan" || current.runtimeState.lifecycle_state !== "active") {
      fail("REPLAN_TRANSITION_INVALID", "clear-replan-block requires blocked_by_replan + active.");
    }
    const nextWithoutAudit = {
      ...current.runtimeState,
      workflow_status: "active",
      lifecycle_state: "active",
      applied_proposals: appendAppliedProposal(current.runtimeState, proposal, current.sourceTuple.revision)
    };
    const audit = makeReplanAudit(current, proposal, nextWithoutAudit, now);
    return {
      next: { ...nextWithoutAudit, execution_log: appendExecutionLogEntry(current.runtimeState, audit) },
      audit
    };
  }
  if (delta.action === "commit-replan") {
    ensureAuthorityKinds(proposal, ["active-task-owner", "scope-admission", "evidence-admission"]);
    if (current.runtimeState.workflow_status !== "superseded" || current.runtimeState.lifecycle_state !== "active") {
      fail("REPLAN_TRANSITION_INVALID", "commit-replan requires superseded + active.");
    }
    assertReplacementActiveStep(delta.active_step_id, delta.replacement_definition.implementation_steps);
    const findings = current.runtimeState.findings.map((item) => {
      const preserved = { ...item, evidence_refs: [...item.evidence_refs] };
      if (preserved.status === "admitted" || preserved.status === "in-progress") {
        return { ...preserved, status: "deferred", updated_at: now };
      }
      return preserved;
    });
    const hadOpenFindings = current.runtimeState.findings.some((item) => item.status === "admitted" || item.status === "in-progress");
    const nextWithoutAudit = {
      ...current.runtimeState,
      workflow_status: "active",
      lifecycle_state: "active",
      resume_requires_review: false,
      resume_review_reasons: [],
      active_step_id: delta.active_step_id,
      active_step_status: "ready",
      finding_queue_revision: hadOpenFindings ? current.runtimeState.finding_queue_revision + 1 : current.runtimeState.finding_queue_revision,
      review_cycle: createReviewCycleZero(),
      findings,
      applied_proposals: appendAppliedProposal(current.runtimeState, proposal, current.sourceTuple.revision)
    };
    const audit = makeReplanAudit(current, proposal, nextWithoutAudit, now);
    return {
      next: { ...nextWithoutAudit, execution_log: appendExecutionLogEntry(current.runtimeState, audit) },
      replacementDefinition: delta.replacement_definition,
      audit
    };
  }
  ensureAuthorityKinds(proposal, ["active-task-owner", "scope-admission", "evidence-admission"]);
  if (current.runtimeState.workflow_status !== "active" || current.runtimeState.lifecycle_state !== "active") {
    fail("TASK_STATE_NOT_ACTIVE", "execute-step requires the current task to be active + active.");
  }
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
  if (current.runtimeState.workflow_status !== "active" || current.runtimeState.lifecycle_state !== "active") {
    fail("TASK_STATE_NOT_ACTIVE", "finding queue changes require the current task to be active + active.");
  }
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
    let reAdmitIndex;
    if (candidate.owner_task_id !== current.runtimeState.task_id)
      fail("FINDING_OWNER_CONFLICT", "finding owner_task_id must match the active task.");
    if (findings.some((item) => item.fingerprint === candidate.fingerprint)) {
      const reAdmitCandidate = findings.find((item) => item.fingerprint === candidate.fingerprint);
      const equivalent = reAdmitCandidate.owner_task_id === candidate.owner_task_id && reAdmitCandidate.file === candidate.file && reAdmitCandidate.failure_condition === candidate.failure_condition && reAdmitCandidate.violated_invariant === candidate.violated_invariant;
      if (equivalent && ["admitted", "in-progress"].includes(reAdmitCandidate.status))
        return { next: current.runtimeState, findingStatus: reAdmitCandidate.status };
      if (!equivalent)
        fail("FINDING_DUPLICATE_CONFLICT", `finding fingerprint ${candidate.fingerprint} already exists with different semantics.`);
      reAdmitIndex = findings.findIndex((item) => item.fingerprint === candidate.fingerprint);
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
    if (reAdmitIndex === undefined) {
      findings.push(finding);
    } else {
      const historical = findings[reAdmitIndex];
      findings[reAdmitIndex] = {
        ...historical,
        review_cycle_id: finding.review_cycle_id,
        status: "admitted",
        repair_attempts: 0,
        last_repair_wave_id: null,
        admitted_at: now,
        updated_at: now,
        evidence_refs: [...new Set([...historical.evidence_refs, ...candidate.evidence_refs])]
      };
    }
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
  if (artifactKind === null) {
    if (delta.action === "supersede") {
      if (current.runtimeState.workflow_status !== "superseded" || current.runtimeState.lifecycle_state !== "active") {
        fail("LIFECYCLE_REPLAY_INCOMPLETE", "supersede replay no longer has the original superseded + active CURRENT_TASK tuple.");
      }
      const audit = current.runtimeState.execution_log.find((item) => ("action" in item) && item.action === "supersede" && item.idempotency_key === proposal.idempotency_key);
      if (!audit || audit.invalidation_kind !== delta.invalidation_kind || audit.invalidation_reason !== delta.invalidation_reason || audit.source_revision !== proposal.source_tuple.revision || audit.evidence_refs.join("|") !== delta.evidence_refs.join("|") || digest(audit.partial_diff_disposition) !== digest(delta.partial_diff_disposition)) {
        fail("LIFECYCLE_REPLAY_INCOMPLETE", "supersede replay is missing its durable invalidation audit record.");
      }
      assertExecutionAuditInBody(current.body, audit);
      assertNoLaterReplanAudit(current, audit, "LIFECYCLE_REPLAY_INCOMPLETE");
    }
    return;
  }
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
      fail("RUNTIME_PATH_INVALID", "supersede may write only the exact canonical CURRENT_TASK path.");
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
function prepareLifecycleTransaction(root, current, proposal, now) {
  const delta = proposal.semantic_delta;
  if (delta.action === "supersede") {
    ensureAuthorityKinds(proposal, ["active-task-owner", "evidence-admission"]);
    if (!["active", "blocked_by_replan"].includes(current.runtimeState.workflow_status) || current.runtimeState.lifecycle_state !== "active") {
      fail("LIFECYCLE_TRANSITION_INVALID", "supersede requires active + active or blocked_by_replan + active.");
    }
    const nextWithoutAudit = {
      ...current.runtimeState,
      workflow_status: "superseded",
      lifecycle_state: "active",
      applied_proposals: appendAppliedProposal(current.runtimeState, proposal, current.sourceTuple.revision)
    };
    const audit = makeReplanAudit(current, proposal, nextWithoutAudit, now);
    const next2 = {
      ...nextWithoutAudit,
      execution_log: appendExecutionLogEntry(current.runtimeState, audit)
    };
    const nextContent2 = renderCanonicalCurrentTask(current.frontmatter, current.body, next2, { audit });
    return { next: next2, nextContent: nextContent2, audit };
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
function fileRevisionForPath(filePath) {
  if (!fs2.existsSync(filePath))
    fail("RUNTIME_SOURCE_MISSING", `Required file is missing: ${filePath}`);
  return sha256(fs2.readFileSync(filePath, "utf8"));
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
  if (!plan.packageFilePath) {
    return rollbackCurrentTaskAndVerify(root, current, readCurrentTask);
  }
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
function rollbackArchiveTransactionAndVerify(root, current, plan, readCurrentTask) {
  try {
    executeWrites([{ path: current.filePath, content: current.raw }], false, "vNext Runtime archive rollback CURRENT_TASK");
    if (plan.originalArchiveContent === undefined) {
      if (fs2.existsSync(plan.archiveFilePath))
        fs2.rmSync(plan.archiveFilePath, { force: true });
    } else {
      executeWrites([{ path: plan.archiveFilePath, content: plan.originalArchiveContent }], false, "vNext Runtime archive rollback archive");
    }
  } catch (error) {
    return { verified: false, detail: `rollback failed: ${error instanceof Error ? error.message : String(error)}` };
  }
  try {
    const rollbackReadBack = readCurrentTask(root);
    if (rollbackReadBack.raw !== current.raw || rollbackReadBack.sourceTuple.revision !== current.sourceTuple.revision) {
      return { verified: false, detail: "archive rollback read-back did not restore the original CURRENT_TASK document." };
    }
    if (plan.originalArchiveContent === undefined) {
      if (fs2.existsSync(plan.archiveFilePath))
        return { verified: false, detail: "archive rollback left a newly-created archive behind." };
    } else if (!fs2.existsSync(plan.archiveFilePath) || fs2.readFileSync(plan.archiveFilePath, "utf8") !== plan.originalArchiveContent) {
      return { verified: false, detail: "archive rollback did not restore the original archive." };
    }
    return { verified: true, detail: "archive rollback read-back verified for CURRENT_TASK and archive." };
  } catch (error) {
    return { verified: false, detail: `rollback read-back failed: ${error instanceof Error ? error.message : String(error)}` };
  }
}
function rollbackSingleFileAndVerify(filePath, originalContent, label) {
  try {
    executeWrites([{ path: filePath, content: originalContent }], false, `vNext Runtime ${label} rollback`);
    if (fs2.readFileSync(filePath, "utf8") !== originalContent)
      return { verified: false, detail: `${label} rollback read-back did not restore the original document.` };
    return { verified: true, detail: `${label} rollback read-back verified.` };
  } catch (error) {
    return { verified: false, detail: `${label} rollback failed: ${error instanceof Error ? error.message : String(error)}` };
  }
}

class GovernanceTransactionKernel {
  root;
  readCurrentTask;
  constructor(root, readCurrentTask = readCanonicalCurrentTask) {
    this.root = path3.resolve(root);
    this.readCurrentTask = readCurrentTask;
  }
  commitArchiveTransaction(current, proposal, plan, options) {
    if (plan === null) {
      return buildResult("no-op", proposal, current, options, "matching closed + archived archive receipt already exists; archive was not repeated.", {
        previous_revision: current.sourceTuple.revision,
        resulting_revision: current.sourceTuple.revision,
        read_back_verified: true,
        archive_path: archivePathForTask(this.root, current).relativePath,
        archive_revision: archiveAudits(current)[0]?.archive_revision,
        state: resultState(current.runtimeState)
      });
    }
    const nextRevision = sha256(plan.nextContent);
    if (options.dryRun) {
      return buildResult("success", proposal, current, options, "typed archive proposal validated; atomic CURRENT_TASK + canonical archive write planned (dry-run).", {
        previous_revision: current.sourceTuple.revision,
        resulting_revision: nextRevision,
        archive_path: plan.archiveRelativePath,
        archive_revision: plan.archiveRevision,
        state: resultState(plan.next)
      });
    }
    try {
      executeWrites([
        { path: current.filePath, content: plan.nextContent },
        { path: plan.archiveFilePath, content: plan.nextArchiveContent }
      ], false, "vNext Runtime archive transaction committed");
    } catch (error) {
      const rollback = rollbackArchiveTransactionAndVerify(this.root, current, plan, this.readCurrentTask);
      return buildResult("blocked", proposal, current, options, rollback.verified ? `archive atomic write failed: ${error instanceof Error ? error.message : String(error)}; exact two-file rollback verified.` : `archive atomic write failed: ${error instanceof Error ? error.message : String(error)}; ${rollback.detail}`, {
        code: rollback.verified ? "ATOMIC_COMMIT_FAILED" : "ROLLBACK_FAILED"
      });
    }
    try {
      const readBack = this.readCurrentTask(this.root);
      if (readBack.raw !== plan.nextContent || readBack.sourceTuple.revision !== nextRevision) {
        throw new Error("canonical CURRENT_TASK read-back did not match the staged terminal document.");
      }
      if (!fs2.existsSync(plan.archiveFilePath) || fs2.readFileSync(plan.archiveFilePath, "utf8") !== plan.nextArchiveContent) {
        throw new Error("canonical task archive read-back did not match the staged archive.");
      }
      const receipt = readCanonicalArchive(this.root, readBack, plan.archiveRelativePath);
      if (receipt.revision !== plan.archiveRevision)
        throw new Error("canonical task archive revision changed during read-back.");
      const audits = archiveAudits(readBack);
      if (audits.length !== 1)
        throw new Error("terminal CURRENT_TASK read-back does not contain exactly one archive audit.");
      assertArchiveReceiptMatches(readBack, receipt, audits[0]);
      return buildResult("success", proposal, current, options, "archive transaction committed; CURRENT_TASK and canonical archive read-back verified.", {
        committed: true,
        governed_mutation_count: 2,
        previous_revision: current.sourceTuple.revision,
        resulting_revision: nextRevision,
        archive_path: plan.archiveRelativePath,
        archive_revision: plan.archiveRevision,
        read_back_verified: true,
        state: resultState(readBack.runtimeState)
      });
    } catch (error) {
      const rollback = rollbackArchiveTransactionAndVerify(this.root, current, plan, this.readCurrentTask);
      return buildResult("blocked", proposal, current, options, rollback.verified ? `archive read-back failed: ${error instanceof Error ? error.message : String(error)}; exact two-file rollback verified.` : `archive read-back failed: ${error instanceof Error ? error.message : String(error)}; ${rollback.detail}`, {
        code: rollback.verified ? "READ_BACK_FAILED" : "ROLLBACK_FAILED"
      });
    }
  }
  commitProjectStatusTransaction(current, proposal, plan, options) {
    const targetPath = workflowDocPathForRoot(this.root, "STATUS.md").relativePath;
    if (plan === null) {
      return buildResult("no-op", proposal, current, options, "matching STATUS reconciliation already exists; STATUS was not rewritten.", {
        target_path: targetPath,
        planned_writes: [],
        previous_revision: fileRevisionForPath(workflowDocPathForRoot(this.root, "STATUS.md").filePath),
        resulting_revision: fileRevisionForPath(workflowDocPathForRoot(this.root, "STATUS.md").filePath),
        read_back_verified: true,
        state: resultState(current.runtimeState)
      });
    }
    if (options.dryRun) {
      return buildResult("success", proposal, current, options, "typed project-status proposal validated; STATUS-only write planned (dry-run).", {
        target_path: plan.statusRelativePath,
        previous_revision: sha256(plan.originalStatusContent),
        resulting_revision: plan.statusRevision,
        state: resultState(current.runtimeState)
      });
    }
    try {
      executeWrites([{ path: plan.statusFilePath, content: plan.nextStatusContent }], false, "vNext Runtime project status transaction committed");
    } catch (error) {
      const rollback = rollbackSingleFileAndVerify(plan.statusFilePath, plan.originalStatusContent, "STATUS");
      return buildResult("blocked", proposal, current, options, rollback.verified ? `STATUS write failed: ${error instanceof Error ? error.message : String(error)}; STATUS rollback verified (archive remains committed).` : `STATUS write failed: ${error instanceof Error ? error.message : String(error)}; ${rollback.detail}`, {
        target_path: plan.statusRelativePath,
        code: rollback.verified ? "ATOMIC_COMMIT_FAILED" : "ROLLBACK_FAILED"
      });
    }
    try {
      const readBack = fs2.readFileSync(plan.statusFilePath, "utf8");
      if (readBack !== plan.nextStatusContent)
        throw new Error("STATUS read-back did not match the staged typed reconciliation.");
      const receipt = matchingStatusReceipt(readBack, plan.statusRelativePath, plan.archive);
      if (receipt === null || receipt.archivePath !== plan.archive.relativePath || receipt.archiveRevision !== plan.archive.revision || receipt.sourceRevision !== plan.archive.sourceRevision || receipt.deltaDigest !== digest(proposal.semantic_delta)) {
        throw new Error("STATUS read-back receipt did not match the canonical archive.");
      }
      assertStatusProjection(readBack, proposal.semantic_delta, plan.statusRelativePath);
      return buildResult("success", proposal, current, options, "project-status transaction committed; STATUS-only read-back verified.", {
        target_path: plan.statusRelativePath,
        committed: true,
        governed_mutation_count: 1,
        previous_revision: sha256(plan.originalStatusContent),
        resulting_revision: plan.statusRevision,
        read_back_verified: true,
        state: resultState(current.runtimeState)
      });
    } catch (error) {
      const rollback = rollbackSingleFileAndVerify(plan.statusFilePath, plan.originalStatusContent, "STATUS");
      return buildResult("blocked", proposal, current, options, rollback.verified ? `STATUS read-back failed: ${error instanceof Error ? error.message : String(error)}; STATUS rollback verified (archive remains committed).` : `STATUS read-back failed: ${error instanceof Error ? error.message : String(error)}; ${rollback.detail}`, {
        target_path: plan.statusRelativePath,
        code: rollback.verified ? "READ_BACK_FAILED" : "ROLLBACK_FAILED"
      });
    }
  }
  commitLessonRecordTransaction(current, proposal, plan, options) {
    const targetPath = workflowDocPathForRoot(this.root, "LESSONS.md").relativePath;
    if (plan === null) {
      return buildResult("no-op", proposal, current, options, "lesson admission is defer/no-op or all admitted candidates are already durably recorded; LESSONS was not rewritten.", {
        target_path: targetPath,
        planned_writes: [],
        read_back_verified: true,
        state: resultState(current.runtimeState)
      });
    }
    if (options.dryRun) {
      return buildResult("success", proposal, current, options, "typed lesson-record proposal validated; LESSONS-only write planned (dry-run).", {
        target_path: plan.lessonsRelativePath,
        previous_revision: sha256(plan.originalLessonsContent),
        resulting_revision: plan.lessonsRevision,
        state: resultState(current.runtimeState)
      });
    }
    try {
      executeWrites([{ path: plan.lessonsFilePath, content: plan.nextLessonsContent }], false, "vNext Runtime lesson record transaction committed");
    } catch (error) {
      const rollback = rollbackSingleFileAndVerify(plan.lessonsFilePath, plan.originalLessonsContent, "LESSONS");
      return buildResult("blocked", proposal, current, options, rollback.verified ? `LESSONS write failed: ${error instanceof Error ? error.message : String(error)}; LESSONS rollback verified (archive and STATUS remain committed).` : `LESSONS write failed: ${error instanceof Error ? error.message : String(error)}; ${rollback.detail}`, {
        target_path: plan.lessonsRelativePath,
        code: rollback.verified ? "ATOMIC_COMMIT_FAILED" : "ROLLBACK_FAILED"
      });
    }
    try {
      const readBack = fs2.readFileSync(plan.lessonsFilePath, "utf8");
      if (readBack !== plan.nextLessonsContent)
        throw new Error("LESSONS read-back did not match the staged typed lesson record.");
      readDurableLessonRecords(readBack, plan.lessonsRelativePath);
      return buildResult("success", proposal, current, options, "lesson-record transaction committed; LESSONS-only read-back verified.", {
        target_path: plan.lessonsRelativePath,
        committed: true,
        governed_mutation_count: 1,
        previous_revision: sha256(plan.originalLessonsContent),
        resulting_revision: plan.lessonsRevision,
        read_back_verified: true,
        state: resultState(current.runtimeState)
      });
    } catch (error) {
      const rollback = rollbackSingleFileAndVerify(plan.lessonsFilePath, plan.originalLessonsContent, "LESSONS");
      return buildResult("blocked", proposal, current, options, rollback.verified ? `LESSONS read-back failed: ${error instanceof Error ? error.message : String(error)}; LESSONS rollback verified (archive and STATUS remain committed).` : `LESSONS read-back failed: ${error instanceof Error ? error.message : String(error)}; ${rollback.detail}`, {
        target_path: plan.lessonsRelativePath,
        code: rollback.verified ? "READ_BACK_FAILED" : "ROLLBACK_FAILED"
      });
    }
  }
  commitLifecycleTransaction(current, proposal, plan, options) {
    const nextRevision = sha256(plan.nextContent);
    if (proposal.mode === "supersede") {
      if (options.dryRun) {
        return buildResult("success", proposal, current, options, "typed supersede proposal validated; canonical CURRENT_TASK write planned (dry-run).", {
          previous_revision: current.sourceTuple.revision,
          resulting_revision: nextRevision,
          state: resultState(plan.next)
        });
      }
      try {
        executeWrites([{ path: current.filePath, content: plan.nextContent }], false, "vNext Runtime supersede lifecycle transaction committed");
      } catch (error) {
        return buildResult("blocked", proposal, current, options, error instanceof Error ? error.message : String(error), { code: "ATOMIC_COMMIT_FAILED" });
      }
      try {
        const readBack = this.readCurrentTask(this.root);
        if (readBack.raw !== plan.nextContent || readBack.sourceTuple.revision !== nextRevision) {
          throw new Error("canonical CURRENT_TASK read-back did not match the staged supersede document.");
        }
        if (readBack.runtimeState.workflow_status !== "superseded" || readBack.runtimeState.lifecycle_state !== "active") {
          throw new Error("supersede CURRENT_TASK read-back did not preserve the superseded + active tuple.");
        }
        return buildResult("success", proposal, current, options, "typed supersede proposal committed; canonical CURRENT_TASK read-back verified.", {
          committed: true,
          governed_mutation_count: 1,
          previous_revision: current.sourceTuple.revision,
          resulting_revision: nextRevision,
          read_back_verified: true,
          state: resultState(readBack.runtimeState)
        });
      } catch (error) {
        const rollback = rollbackCurrentTaskAndVerify(this.root, current, this.readCurrentTask);
        return buildResult("blocked", proposal, current, options, rollback.verified ? `Runtime supersede read-back failed: ${error instanceof Error ? error.message : String(error)}; rollback read-back verified.` : `Runtime supersede read-back failed: ${error instanceof Error ? error.message : String(error)}; ${rollback.detail}`, { code: rollback.verified ? "READ_BACK_FAILED" : "ROLLBACK_FAILED" });
      }
    }
    if (!plan.packageFilePath || !plan.packageRelativePath || plan.nextPackageContent === undefined) {
      return buildResult("blocked", proposal, current, options, "lifecycle transaction is missing its suspended package plan.", { code: "RUNTIME_HANDLER_BLOCKED" });
    }
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
      } else if (proposal.operation_kind === "archive-transaction" || proposal.operation_kind === "project-status-transaction" || proposal.operation_kind === "lesson-record-transaction") {
        assertRequestedCloseTargets(this.root, current, proposal);
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
      } else if (proposal.operation_kind === "task-state-transaction") {
        try {
          assertTaskStateReplay(current, proposal);
        } catch (error) {
          return buildResult("blocked", proposal, current, options, error instanceof Error ? error.message : String(error), {
            code: error instanceof VNextRuntimeError ? error.code : "RUNTIME_REPLAY_INCOMPLETE"
          });
        }
      } else if (proposal.operation_kind === "archive-transaction") {
        try {
          assertArchiveReplay(this.root, current, proposal);
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
        const plan = prepareLifecycleTransaction(this.root, current, proposal, now);
        return this.commitLifecycleTransaction(current, proposal, plan, options);
      } catch (error) {
        return buildResult("blocked", proposal, current, options, error instanceof Error ? error.message : String(error), { code: error instanceof VNextRuntimeError ? error.code : "RUNTIME_HANDLER_BLOCKED" });
      }
    }
    if (proposal.operation_kind === "archive-transaction") {
      try {
        const plan = prepareArchiveTransaction(this.root, current, proposal, now);
        return this.commitArchiveTransaction(current, proposal, plan, options);
      } catch (error) {
        return buildResult("blocked", proposal, current, options, error instanceof Error ? error.message : String(error), { code: error instanceof VNextRuntimeError ? error.code : "RUNTIME_HANDLER_BLOCKED" });
      }
    }
    if (proposal.operation_kind === "project-status-transaction") {
      try {
        const plan = prepareProjectStatusTransaction(this.root, current, proposal);
        return this.commitProjectStatusTransaction(current, proposal, plan, options);
      } catch (error) {
        return buildResult("blocked", proposal, current, options, error instanceof Error ? error.message : String(error), {
          target_path: workflowDocPathForRoot(this.root, "STATUS.md").relativePath,
          code: error instanceof VNextRuntimeError ? error.code : "RUNTIME_HANDLER_BLOCKED"
        });
      }
    }
    if (proposal.operation_kind === "lesson-record-transaction") {
      try {
        const plan = prepareLessonRecordTransaction(this.root, current, proposal);
        return this.commitLessonRecordTransaction(current, proposal, plan, options);
      } catch (error) {
        return buildResult("blocked", proposal, current, options, error instanceof Error ? error.message : String(error), {
          target_path: workflowDocPathForRoot(this.root, "LESSONS.md").relativePath,
          code: error instanceof VNextRuntimeError ? error.code : "RUNTIME_HANDLER_BLOCKED"
        });
      }
    }
    let transition;
    try {
      transition = proposal.operation_kind === "task-state-transaction" ? applyTaskStateDelta(current, proposal, now) : applyFindingQueueDelta(current, proposal, now);
    } catch (error) {
      return buildResult("blocked", proposal, current, options, error instanceof Error ? error.message : String(error), { code: error instanceof VNextRuntimeError ? error.code : "RUNTIME_HANDLER_BLOCKED" });
    }
    let nextContent;
    try {
      nextContent = renderCanonicalCurrentTask(current.frontmatter, current.body, transition.next, {
        ...transition.replacementDefinition ? { replacementDefinition: transition.replacementDefinition } : {},
        ...transition.audit ? { audit: transition.audit } : {}
      });
    } catch (error) {
      return buildResult("blocked", proposal, current, options, error instanceof Error ? error.message : String(error), {
        code: error instanceof VNextRuntimeError ? error.code : "RUNTIME_RENDER_BLOCKED"
      });
    }
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
