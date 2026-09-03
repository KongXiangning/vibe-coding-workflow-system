// runtime/vnext/src/kernel.ts
import * as crypto3 from "crypto";
import * as fs3 from "fs";
import * as path4 from "path";
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

// runtime/vnext/src/mutation-scope.ts
import * as crypto from "crypto";

class MutationScopeError extends Error {
  code;
  constructor(code, message) {
    super(message);
    this.name = "MutationScopeError";
    this.code = code;
  }
}
var ALLOWED_SCOPE_HEADINGS = new Set(["允许修改范围", "mutation scope", "scope"]);
var ALLOWED_BUCKET_HEADINGS = new Set(["allowed files", "allowed targets", "允许文件", "允许目标"]);
var CONDITIONAL_BUCKET_HEADINGS = new Set(["条件修改范围", "条件允许修改范围", "conditional files", "conditional targets"]);
var FORBIDDEN_SCOPE_HEADINGS = new Set(["禁止修改范围", "forbidden files", "forbidden targets"]);
var READ_DISCOVERY_HEADINGS = new Set([
  "read / discovery context",
  "read/discovery context",
  "read context",
  "discovery context",
  "读取 / 发现上下文",
  "读取/发现上下文",
  "发现上下文"
]);
var EMPTY_SCOPE_MARKER = /^(?:none|n\/a|na|nil|empty|no\s+(?:files?|targets?|scope)|无|暂无|不适用)[.!。]?$/iu;
var CONDITIONAL_LANGUAGE = /(?:when|if|after|once|upon|provided|only|condition|evidence|authority|approval|authorized|confirmed|满足|条件|证据|依据|授权|审批|确认|批准)/iu;
var PATH_PREFIX = /^(?:file|files|path|paths|target|targets|文件|路径|目标)\s*[:：]\s*/iu;
var UNSUPPORTED_GLOB_SYNTAX = /[\[\]{}!]/u;
function failInvalid(message) {
  throw new MutationScopeError("MUTATION_SCOPE_INVALID", message);
}
function normalizeHeading(title) {
  return title.trim().replace(/[：:]/gu, "").replace(/\s+/gu, " ").toLocaleLowerCase();
}
function scanMarkdownSections(body) {
  const headings = [];
  const headingPattern = /^(#{2,6})[ \t]+(.+?)[ \t]*$/gmu;
  for (const match of body.matchAll(headingPattern)) {
    const start = match.index ?? 0;
    headings.push({
      title: match[2].trim(),
      level: match[1].length,
      start,
      end: start + match[0].length
    });
  }
  return headings.map((heading, index) => {
    const contentStart = body.startsWith(`\r
`, heading.end) ? heading.end + 2 : getLineContentStart(body, heading.end);
    const next = headings.slice(index + 1).find((candidate) => candidate.level <= heading.level);
    return {
      title: heading.title,
      level: heading.level,
      heading_start: heading.start,
      content_start: contentStart,
      content_end: next?.start ?? body.length
    };
  });
}
function getLineContentStart(body, headingEnd) {
  return body.startsWith(`
`, headingEnd) ? headingEnd + 1 : headingEnd;
}
function findOneSection(sections, aliases, level, range) {
  const matches = sections.filter((section) => {
    if (section.level !== level || !aliases.has(normalizeHeading(section.title)))
      return false;
    if (!range)
      return true;
    return section.heading_start >= range.start && section.heading_start < range.end;
  });
  if (matches.length > 1)
    failInvalid(`CURRENT_TASK contains duplicate ${[...aliases].join(" / ")} scope sections.`);
  return matches[0] ?? null;
}
function sectionRange(section) {
  return { start: section.content_start, end: section.content_end };
}
function resolveBucketSection(sections, bucket) {
  const bucketAliases = aliasesForBucket(bucket);
  const containerAliases = containerAliasesForBucket(bucket);
  const container = containerAliases ? findOneSection(sections, containerAliases, 2) : null;
  const direct = findOneSection(sections, bucketAliases, 2);
  if (container && direct && direct.heading_start !== container.heading_start) {
    failInvalid(`CURRENT_TASK declares both a scope container and a direct ${bucket} section.`);
  }
  if (container) {
    const range = sectionRange(container);
    const nested = findOneSection(sections, bucketAliases, 3, range);
    if (bucket === "allowed") {
      const nestedConditional = findOneSection(sections, CONDITIONAL_BUCKET_HEADINGS, 3, range);
      const nestedRead = findOneSection(sections, READ_DISCOVERY_HEADINGS, 3, range);
      if ((nestedConditional || nestedRead) && !nested) {
        failInvalid("Nested Conditional Files or Read / discovery context requires a distinct nested Allowed Files section.");
      }
    }
    const nestedHeadings = sections.filter((section) => section.level === 3 && section.heading_start >= range.start && section.heading_start < range.end);
    if (nestedHeadings.length > 0 && !nested) {
      failInvalid(`${bucket} scope container has nested headings but no matching ${[...bucketAliases].join(" / ")} bucket.`);
    }
    if (nested)
      return nested;
    return container;
  }
  if (bucket === "conditional" || bucket === "read_discovery") {
    const allowedContainer = findOneSection(sections, ALLOWED_SCOPE_HEADINGS, 2);
    const nested = allowedContainer ? findOneSection(sections, bucketAliases, 3, sectionRange(allowedContainer)) : null;
    if (nested && direct)
      failInvalid(`CURRENT_TASK declares both nested and direct ${bucket} scope sections.`);
    if (nested)
      return nested;
  }
  if (direct)
    return direct;
  if (bucket === "read_discovery")
    return null;
  return null;
}
function aliasesForBucket(bucket) {
  if (bucket === "allowed")
    return ALLOWED_BUCKET_HEADINGS;
  if (bucket === "conditional")
    return CONDITIONAL_BUCKET_HEADINGS;
  if (bucket === "forbidden")
    return FORBIDDEN_SCOPE_HEADINGS;
  return READ_DISCOVERY_HEADINGS;
}
function containerAliasesForBucket(bucket) {
  if (bucket === "allowed")
    return ALLOWED_SCOPE_HEADINGS;
  if (bucket === "forbidden")
    return FORBIDDEN_SCOPE_HEADINGS;
  return null;
}
function extractDeclarationPath(text) {
  const code = /`([^`\r\n]+)`/u.exec(text);
  if (code) {
    return {
      pattern: code[1].trim(),
      remainder: `${text.slice(0, code.index)} ${text.slice(code.index + code[0].length)}`.trim()
    };
  }
  const prefixed = text.replace(PATH_PREFIX, "");
  const token = /^([^\s,;，；()]+)([\s\S]*)$/u.exec(prefixed.trim());
  if (!token)
    failInvalid(`Scope declaration does not identify a repository-relative path: ${text}`);
  return { pattern: token[1], remainder: token[2].trim() };
}
function normalizeScopePattern(value, location) {
  const normalized = value.trim().replace(/\\/gu, "/").replace(/^\.\//u, "").replace(/\/+/gu, "/");
  if (!normalized || normalized === ".")
    failInvalid(`${location} must identify a non-empty repository-relative path pattern.`);
  if (/^[A-Za-z]:\//u.test(normalized) || normalized.startsWith("/"))
    failInvalid(`${location} must not be absolute.`);
  if (/[\0-\x1F\x7F]/u.test(normalized))
    failInvalid(`${location} contains a control character.`);
  if (UNSUPPORTED_GLOB_SYNTAX.test(normalized))
    failInvalid(`${location} uses unsupported glob syntax; only * and ** are supported.`);
  if (normalized.split("/").some((segment) => segment === ".." || segment.length === 0))
    failInvalid(`${location} must not contain parent traversal or empty path segments.`);
  if (normalized.includes("://") || normalized.includes("$"))
    failInvalid(`${location} is not a repository-relative path pattern.`);
  if (/\s/u.test(normalized))
    failInvalid(`${location} must not contain unquoted whitespace.`);
  return normalized;
}
function isEmptyMarker(text) {
  return EMPTY_SCOPE_MARKER.test(text.trim());
}
function parseScopeBucket(body, section, bucket) {
  const content = body.slice(section.content_start, section.content_end);
  const entries = [];
  let sawMarker = false;
  let bulletCount = 0;
  for (const rawLine of content.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || /^<!--.*-->$/u.test(line))
      continue;
    const bullet = /^(?:[-*+]\s+|\d+[.)]\s+)(.*)$/u.exec(line);
    if (!bullet)
      failInvalid(`${section.title} contains a non-list scope declaration: ${line}`);
    bulletCount += 1;
    const declaration = bullet[1].replace(/^\[[ xX]\]\s*/u, "").trim();
    if (isEmptyMarker(declaration)) {
      if (entries.length > 0 || sawMarker)
        failInvalid(`${section.title} mixes an empty marker with path declarations.`);
      sawMarker = true;
      continue;
    }
    if (sawMarker)
      failInvalid(`${section.title} mixes an empty marker with path declarations.`);
    const extracted = extractDeclarationPath(declaration);
    const pattern = normalizeScopePattern(extracted.pattern, `${section.title} declaration`);
    if (bucket === "conditional" && !CONDITIONAL_LANGUAGE.test(extracted.remainder)) {
      failInvalid(`Conditional Files declaration ${pattern} must state its condition, evidence, or authority.`);
    }
    entries.push({ pattern, broad: pattern.includes("*"), declaration });
  }
  if (bulletCount === 0)
    failInvalid(`${section.title} must explicitly list paths or declare none.`);
  if (new Set(entries.map((entry) => entry.pattern)).size !== entries.length)
    failInvalid(`${section.title} contains duplicate path patterns.`);
  return entries;
}
function hash(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}
function scopeSummary(scope) {
  return {
    allowed: scope.allowed.map((entry) => entry.pattern),
    conditional: scope.conditional.map((entry) => entry.pattern),
    forbidden: scope.forbidden.map((entry) => entry.pattern),
    read_discovery: scope.read_discovery.map((entry) => entry.pattern)
  };
}
function parseMutationScope(body, sourceRevision = hash(body)) {
  if (typeof body !== "string" || body.length === 0)
    failInvalid("CURRENT_TASK body is empty; mutation scope cannot be established.");
  const sections = scanMarkdownSections(body);
  const allowedSection = resolveBucketSection(sections, "allowed");
  const conditionalSection = resolveBucketSection(sections, "conditional");
  const forbiddenSection = resolveBucketSection(sections, "forbidden");
  const readSection = resolveBucketSection(sections, "read_discovery");
  if (!allowedSection)
    failInvalid("CURRENT_TASK is missing the required Allowed Files scope bucket.");
  if (!conditionalSection)
    failInvalid("CURRENT_TASK is missing the required Conditional Files scope bucket.");
  if (!forbiddenSection)
    failInvalid("CURRENT_TASK is missing the required Forbidden Files scope bucket.");
  if (!/^[a-f0-9]{64}$/u.test(sourceRevision))
    failInvalid("Mutation scope source_revision must be a SHA-256 digest.");
  return {
    source_revision: sourceRevision,
    allowed: parseScopeBucket(body, allowedSection, "allowed"),
    conditional: parseScopeBucket(body, conditionalSection, "conditional"),
    forbidden: parseScopeBucket(body, forbiddenSection, "forbidden"),
    read_discovery: readSection ? parseScopeBucket(body, readSection, "read_discovery") : []
  };
}
function escapeRegex(text) {
  return text.replace(/[|\\{}()[\]^$+?.]/gu, "\\$&");
}
function mutationScopePatternMatchesPath(file, pattern) {
  const normalizedFile = normalizeScopePattern(file, "changed path");
  const normalizedPattern = normalizeScopePattern(pattern, "scope pattern");
  const regex = escapeRegex(normalizedPattern).replace(/\*\*\//gu, "(?:.*/)?").replace(/\*\*/gu, ".*").replace(/\*/gu, "[^/]*");
  return new RegExp(`^${regex}$`, "u").test(normalizedFile);
}
function normalizeChangedPath(value, index) {
  if (typeof value !== "string" || value.trim().length === 0)
    return null;
  try {
    const normalized = normalizeScopePattern(value, `changed_paths[${index}]`);
    if (normalized.includes("*"))
      return null;
    return normalized;
  } catch {
    return null;
  }
}
function validateConditionalAuthorizations(value) {
  if (value === undefined)
    return { authorizations: [], blockers: [] };
  if (!Array.isArray(value))
    return { authorizations: [], blockers: ["conditional_authorizations must be an array."] };
  const authorizations = [];
  const blockers = [];
  for (const [index, raw] of value.entries()) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      blockers.push(`conditional_authorizations[${index}] must be a mapping.`);
      continue;
    }
    const record = raw;
    const keys = Object.keys(record).sort();
    if (keys.join("|") !== ["authority", "evidence_refs", "pattern"].join("|")) {
      blockers.push(`conditional_authorizations[${index}] must contain exactly pattern, evidence_refs, and authority.`);
      continue;
    }
    let pattern;
    try {
      pattern = normalizeScopePattern(String(record.pattern ?? ""), `conditional_authorizations[${index}].pattern`);
    } catch (error) {
      blockers.push(error instanceof Error ? error.message : String(error));
      continue;
    }
    if (pattern.includes("*")) {
      blockers.push(`conditional_authorizations[${index}].pattern must narrow to an exact target.`);
      continue;
    }
    const evidenceRefs = record.evidence_refs;
    if (!Array.isArray(evidenceRefs) || evidenceRefs.length === 0 || evidenceRefs.some((item) => typeof item !== "string" || item.trim().length === 0)) {
      blockers.push(`conditional_authorizations[${index}].evidence_refs must be a non-empty list of references.`);
      continue;
    }
    const authority = record.authority;
    if (typeof authority !== "string" || authority.trim().length === 0) {
      blockers.push(`conditional_authorizations[${index}].authority must be non-empty.`);
      continue;
    }
    authorizations.push({
      pattern,
      evidence_refs: [...new Set(evidenceRefs.map((item) => item.trim()))],
      authority: authority.trim()
    });
  }
  return { authorizations, blockers };
}
function blockedResult(scope, inputPaths, transformationKind, blockers) {
  const normalizedPaths = inputPaths.filter((path3) => typeof path3 === "string").map((path3) => path3.trim()).filter(Boolean);
  return {
    status: "blocked",
    source_revision: scope.source_revision,
    transformation_kind: transformationKind,
    scope: scopeSummary(scope),
    changed_paths: normalizedPaths,
    decisions: normalizedPaths.map((path3) => ({
      path: path3,
      classification: "invalid",
      mutation_admitted: false,
      matched_scope: [],
      read_discovery_matches: [],
      reason: "mutation scope input is invalid or incomplete"
    })),
    admitted_paths: [],
    blocked_paths: normalizedPaths,
    blockers: [...new Set(blockers)]
  };
}
function evaluateMutationScope(scope, input) {
  const transformationKind = input.transformation_kind ?? "localized";
  if (transformationKind !== "localized" && transformationKind !== "inherently-broad") {
    return blockedResult(scope, Array.isArray(input.changed_paths) ? input.changed_paths : [], "localized", ["transformation_kind must be localized or inherently-broad."]);
  }
  if (!Array.isArray(input.changed_paths) || input.changed_paths.length === 0) {
    return blockedResult(scope, [], transformationKind, ["an explicit non-empty changed_paths diff target is required; an empty diff cannot be admitted."]);
  }
  const authorizationResult = validateConditionalAuthorizations(input.conditional_authorizations);
  if (authorizationResult.blockers.length > 0) {
    return blockedResult(scope, input.changed_paths, transformationKind, authorizationResult.blockers);
  }
  const decisions = [];
  const seen = new Set;
  const inputBlockers = [];
  for (const [index, rawPath] of input.changed_paths.entries()) {
    const pathValue = normalizeChangedPath(rawPath, index);
    if (!pathValue) {
      decisions.push({
        path: typeof rawPath === "string" ? rawPath.trim() : String(rawPath),
        classification: "invalid",
        mutation_admitted: false,
        matched_scope: [],
        read_discovery_matches: [],
        reason: "changed path must be a unique repository-relative file path without glob syntax or traversal."
      });
      inputBlockers.push(`changed_paths[${index}] is invalid.`);
      continue;
    }
    if (seen.has(pathValue)) {
      decisions.push({
        path: pathValue,
        classification: "invalid",
        mutation_admitted: false,
        matched_scope: [],
        read_discovery_matches: [],
        reason: "changed path is duplicated; the diff target must be explicit and unambiguous."
      });
      inputBlockers.push(`changed path ${pathValue} is duplicated.`);
      continue;
    }
    seen.add(pathValue);
    const forbidden = scope.forbidden.filter((entry) => mutationScopePatternMatchesPath(pathValue, entry.pattern));
    const allowed = scope.allowed.filter((entry) => mutationScopePatternMatchesPath(pathValue, entry.pattern));
    const conditional = scope.conditional.filter((entry) => mutationScopePatternMatchesPath(pathValue, entry.pattern));
    const readMatches = scope.read_discovery.filter((entry) => mutationScopePatternMatchesPath(pathValue, entry.pattern));
    const matchedScope = [
      ...forbidden.map((entry) => `Forbidden:${entry.pattern}`),
      ...allowed.map((entry) => `Allowed:${entry.pattern}`),
      ...conditional.map((entry) => `Conditional:${entry.pattern}`)
    ];
    const readDiscoveryMatches = readMatches.map((entry) => entry.pattern);
    if (forbidden.length > 0) {
      decisions.push({ path: pathValue, classification: "forbidden", mutation_admitted: false, matched_scope: matchedScope, read_discovery_matches: readDiscoveryMatches, reason: "Forbidden Files takes precedence over every other bucket." });
      continue;
    }
    if (allowed.length > 0 && conditional.length > 0) {
      decisions.push({ path: pathValue, classification: "ambiguous-overlap", mutation_admitted: false, matched_scope: matchedScope, read_discovery_matches: readDiscoveryMatches, reason: "the path matches both Allowed Files and Conditional Files; ambiguous authority is denied." });
      continue;
    }
    if (allowed.length > 0) {
      const exactAllowed = allowed.filter((entry) => !entry.broad);
      if (exactAllowed.length > 0) {
        decisions.push({ path: pathValue, classification: "allowed-exact", mutation_admitted: true, matched_scope: matchedScope, read_discovery_matches: readDiscoveryMatches, reason: "exact Allowed Files entry admits this localized mutation." });
        continue;
      }
      if (transformationKind === "inherently-broad") {
        decisions.push({ path: pathValue, classification: "allowed-broad", mutation_admitted: true, matched_scope: matchedScope, read_discovery_matches: readDiscoveryMatches, reason: "the declared broad Allowed Files pattern is admitted for an explicitly inherently-broad transformation." });
      } else {
        decisions.push({ path: pathValue, classification: "broad-scope-unqualified", mutation_admitted: false, matched_scope: matchedScope, read_discovery_matches: readDiscoveryMatches, reason: "a broad Allowed Files pattern requires transformation_kind: inherently-broad." });
      }
      continue;
    }
    if (conditional.length > 0) {
      const authorization = authorizationResult.authorizations.find((candidate) => candidate.pattern === pathValue && conditional.some((entry) => mutationScopePatternMatchesPath(pathValue, entry.pattern)));
      if (authorization) {
        decisions.push({ path: pathValue, classification: "conditional-admitted", mutation_admitted: true, matched_scope: matchedScope, read_discovery_matches: readDiscoveryMatches, reason: `Conditional Files admitted by exact target authorization with ${authorization.evidence_refs.length} evidence reference(s) and explicit authority.` });
      } else {
        decisions.push({ path: pathValue, classification: "conditional-unapproved", mutation_admitted: false, matched_scope: matchedScope, read_discovery_matches: readDiscoveryMatches, reason: "Conditional Files is not pre-authorized; an exact target authorization with evidence_refs and authority is required." });
      }
      continue;
    }
    if (readMatches.length > 0) {
      decisions.push({ path: pathValue, classification: "read-context-only", mutation_admitted: false, matched_scope: [], read_discovery_matches: readDiscoveryMatches, reason: "Read / discovery context is intentionally broader but never grants write authority." });
      continue;
    }
    decisions.push({ path: pathValue, classification: "unowned", mutation_admitted: false, matched_scope: [], read_discovery_matches: [], reason: "the path is not listed in Allowed Files or an authorized Conditional Files entry." });
  }
  const admittedPaths = decisions.filter((decision) => decision.mutation_admitted).map((decision) => decision.path);
  const blockedPaths = decisions.filter((decision) => !decision.mutation_admitted).map((decision) => decision.path);
  const decisionBlockers = decisions.filter((decision) => !decision.mutation_admitted).map((decision) => `${decision.path}: ${decision.reason}`);
  const blockers = [...new Set([...inputBlockers, ...decisionBlockers])];
  return {
    status: blockers.length === 0 && admittedPaths.length === decisions.length ? "pass" : "blocked",
    source_revision: scope.source_revision,
    transformation_kind: transformationKind,
    scope: scopeSummary(scope),
    changed_paths: decisions.map((decision) => decision.path),
    decisions,
    admitted_paths: admittedPaths,
    blocked_paths: blockedPaths,
    blockers
  };
}

// runtime/vnext/src/task-steps.ts
var STEP_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

class TaskStepDefinitionError extends Error {
  code;
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.name = "TaskStepDefinitionError";
    this.code = code;
  }
}
var HEADING_ALIASES = new Set(["实施步骤", "implementation steps", "implementation_steps", "steps"]);
var METADATA_ALIASES = new Map([
  ["purpose", "purpose"],
  ["目标", "purpose"],
  ["目的", "purpose"],
  ["mutation scope", "mutation_scope"],
  ["mutation_scope", "mutation_scope"],
  ["mutation boundary", "mutation_scope"],
  ["变更范围", "mutation_scope"],
  ["修改范围", "mutation_scope"],
  ["required evidence", "required_evidence"],
  ["required_evidence", "required_evidence"],
  ["必要证据", "required_evidence"],
  ["必需证据", "required_evidence"],
  ["review checkpoint", "review_checkpoint"],
  ["review_checkpoint", "review_checkpoint"],
  ["审查检查点", "review_checkpoint"],
  ["评审检查点", "review_checkpoint"]
]);
function normalizeLabel(value) {
  return value.replace(/`/gu, "").trim().toLocaleLowerCase().replace(/[\u00a0]/gu, " ").replace(/\s+/gu, " ");
}
function headingInfo(line) {
  const match = /^(#{1,6})\s+(.+?)\s*$/u.exec(line);
  if (!match)
    return null;
  return { level: match[1].length, title: normalizeLabel(match[2]) };
}
function stepSectionLines(body) {
  const lines = body.replace(/\r\n?/gu, `
`).split(`
`);
  const start = lines.findIndex((line) => {
    const heading = headingInfo(line);
    return heading?.level === 2 && HEADING_ALIASES.has(heading.title);
  });
  if (start < 0)
    throw new TaskStepDefinitionError("TASK_STEPS_INVALID", "CURRENT_TASK is missing the implementation steps section.");
  let end = lines.length;
  for (let index = start + 1;index < lines.length; index += 1) {
    const heading = headingInfo(lines[index]);
    if (heading && heading.level <= 2) {
      end = index;
      break;
    }
  }
  return lines.slice(start + 1, end);
}
function metadataKey(value) {
  const normalized = normalizeLabel(value);
  return METADATA_ALIASES.get(normalized) ?? METADATA_ALIASES.get(normalized.replace(/\s+/gu, "_")) ?? null;
}
function cleanMetadataValue(value) {
  return value.trim().replace(/^\s*[-–—:]\s*/u, "").trim();
}
function parseCheckpoint(value) {
  const normalized = cleanMetadataValue(value);
  if (/^(?:not[-\s]?required|optional|none|无需|不需要|非必需)(?=\s|[:：,，()（）[\]{}\-–—]|$)/iu.test(normalized)) {
    return { policy: "not-required", boundary: null };
  }
  const required = /^(?:required|mandatory|必需|必须|需要)(?=\s|[:：,，()（）[\]{}\-–—]|$)/iu.exec(normalized);
  if (!required)
    return { policy: null, boundary: null };
  const boundary = normalized.slice(required[0].length).replace(/^[\s:：,，()（）[\]{}\-–—]+/u, "").replace(/[\s,，()（）[\]{}\-–—]+$/u, "").trim();
  return { policy: "required", boundary: boundary || null };
}
function stepLine(line) {
  const match = /^(\s*)[-*]\s+(?:\[[ xX]\]\s*)?(?:(?:步骤|step)\s+([0-9]+)|([A-Za-z0-9][A-Za-z0-9._:-]{0,127}))\s*[:：]\s*(.*?)\s*$/iu.exec(line);
  if (!match)
    return null;
  const candidate = match[2] ? `step-${match[2]}` : match[3];
  if (!candidate || !STEP_ID_PATTERN.test(candidate) || metadataKey(candidate) !== null)
    return null;
  return { indent: match[1].length, id: candidate, description: match[4].trim() };
}
function metadataLine(line) {
  const match = /^\s*(?:[-*]\s+)?(?:\[[ xX]\]\s*)?([^:：]+?)\s*[:：]\s*(.*?)\s*$/u.exec(line);
  if (!match)
    return null;
  const key = metadataKey(match[1]);
  return key ? { key, value: cleanMetadataValue(match[2]) } : null;
}
function parseRawSteps(lines) {
  const parsed = [];
  let primaryIndent = null;
  let current = null;
  for (const line of lines) {
    const candidate = stepLine(line);
    if (candidate && (primaryIndent === null || candidate.indent <= primaryIndent)) {
      if (primaryIndent === null)
        primaryIndent = candidate.indent;
      if (candidate.indent === primaryIndent) {
        if (parsed.some((step) => step.id === candidate.id)) {
          throw new TaskStepDefinitionError("TASK_STEPS_INVALID", `implementation steps contain duplicate step ID ${candidate.id}.`);
        }
        current = { id: candidate.id, description: candidate.description, metadata: {} };
        parsed.push(current);
        continue;
      }
    }
    if (!current)
      continue;
    const metadata = metadataLine(line);
    if (!metadata)
      continue;
    if (current.metadata[metadata.key] !== undefined) {
      throw new TaskStepDefinitionError("TASK_STEPS_INVALID", `step ${current.id} declares ${metadata.key} more than once.`);
    }
    current.metadata[metadata.key] = metadata.value;
  }
  if (parsed.length === 0) {
    throw new TaskStepDefinitionError("TASK_STEPS_INVALID", "implementation steps must contain at least one labelled step ID.");
  }
  return parsed;
}
function materializeStep(step) {
  const purpose = step.metadata.purpose || null;
  const mutationScope = step.metadata.mutation_scope || null;
  const requiredEvidence = step.metadata.required_evidence || null;
  const checkpoint = step.metadata.review_checkpoint === undefined ? { policy: null, boundary: null } : parseCheckpoint(step.metadata.review_checkpoint);
  const metadataComplete = Boolean(purpose && mutationScope && requiredEvidence && checkpoint.policy && (checkpoint.policy === "not-required" || checkpoint.boundary));
  return {
    id: step.id,
    description: step.description,
    purpose,
    mutation_scope: mutationScope,
    required_evidence: requiredEvidence,
    review_checkpoint: checkpoint.policy,
    checkpoint_boundary: checkpoint.boundary,
    metadata_complete: metadataComplete
  };
}
function parseImplementationSteps(implementationSteps) {
  const lines = implementationSteps.replace(/\r\n?/gu, `
`).split(`
`);
  return parseRawSteps(lines).map(materializeStep);
}
function parseTaskStepDefinitions(body) {
  return parseRawSteps(stepSectionLines(body)).map(materializeStep);
}
function resolveTaskStep(body, activeStepId) {
  const steps = parseTaskStepDefinitions(body);
  const index = steps.findIndex((step) => step.id === activeStepId);
  if (index < 0) {
    throw new TaskStepDefinitionError("TASK_STEP_NOT_FOUND", `active_step_id ${activeStepId} is not declared in implementation steps.`);
  }
  return {
    steps,
    current: steps[index],
    index,
    next: steps[index + 1] ?? null
  };
}

// runtime/vnext/src/bootstrap.ts
import * as crypto2 from "crypto";
import * as fs2 from "fs";
import * as path3 from "path";
var VNEXT_BOOTSTRAP_PROPOSAL_SCHEMA_VERSION = 1;
var VNEXT_BOOTSTRAP_PROPOSAL_KIND = "vnext-bootstrap-proposal";
var BOOTSTRAP_MODES = ["design", "greenfield", "inventory", "adopt", "realign"];
var BOOTSTRAP_OPERATION_KINDS = [
  "contract-candidate-commit",
  "decision-record-transaction",
  "project-status-transaction",
  "paired-host-guidance-transaction"
];
var BOOTSTRAP_ASSET_CATEGORIES = ["protocol", "schema", "skill", "runtime", "config", "generated", "governance"];
var SAFE_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/u;
var TARGET_IDENTITY_PATTERN = /^[a-f0-9]{32}$/u;
var SHA256_PATTERN = /^[a-f0-9]{64}$/u;
var HOST_GUIDANCE_PATHS = new Set(["AGENTS.md", "CLAUDE.md"]);

class BootstrapRuntimeError extends Error {
  code;
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.name = "BootstrapRuntimeError";
    this.code = code;
  }
}
function fail(code, message) {
  throw new BootstrapRuntimeError(code, message);
}
function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function expectRecord(value, location) {
  if (!isRecord(value))
    fail("BOOTSTRAP_SCHEMA_INVALID", `${location} must be a mapping.`);
  return value;
}
function expectString(value, location) {
  if (typeof value !== "string" || value.trim().length === 0)
    fail("BOOTSTRAP_SCHEMA_INVALID", `${location} must be a non-empty string.`);
  return value.trim();
}
function expectStringArray(value, location, allowEmpty = false) {
  if (!Array.isArray(value) || !allowEmpty && value.length === 0)
    fail("BOOTSTRAP_SCHEMA_INVALID", `${location} must be ${allowEmpty ? "an array" : "a non-empty array"}.`);
  const values = value.map((item, index) => expectString(item, `${location}[${index}]`));
  if (new Set(values).size !== values.length)
    fail("BOOTSTRAP_SCHEMA_INVALID", `${location} must not contain duplicates.`);
  return values;
}
function expectExactKeys(value, expected, location) {
  const expectedSet = new Set(expected);
  const missing = expected.filter((key) => !(key in value));
  const extra = Object.keys(value).filter((key) => !expectedSet.has(key));
  if (missing.length > 0 || extra.length > 0)
    fail("BOOTSTRAP_SCHEMA_INVALID", `${location} keys mismatch; missing=[${missing.join(", ")}], unexpected=[${extra.join(", ")}].`);
}
function normalizeRepoPath(value, location) {
  const normalized = value.trim().replace(/\\/gu, "/").replace(/^\.\//u, "").replace(/\/+/gu, "/");
  if (!normalized || normalized.startsWith("/") || /^[A-Za-z]:\//u.test(normalized) || normalized.split("/").some((segment) => segment === ".." || segment.length === 0) || /[\0-\x1F\x7F]/u.test(normalized) || normalized.includes("*")) {
    fail("BOOTSTRAP_PATH_INVALID", `${location} must be a repository-relative concrete path.`);
  }
  return normalized;
}
function normalizePathArray(value, location, allowEmpty = false) {
  return expectStringArray(value, location, allowEmpty).map((item, index) => normalizeRepoPath(item, `${location}[${index}]`));
}
function sha256(value) {
  return crypto2.createHash("sha256").update(value).digest("hex");
}
function computeBootstrapTargetIdentity(root) {
  const resolved = path3.resolve(root).replace(/\\/gu, "/").replace(/\/+$/u, "").toLocaleLowerCase();
  return sha256(resolved).slice(0, 32);
}
function isHostSkillPath(value) {
  return /^(?:\.claude|\.codex|\.factory)\/skills\/[a-z][a-z0-9-]*\.SKILL\.md$/u.test(value);
}
function isAllowedAssetPath(value) {
  if (value === "AGENTS.md" || value === "CLAUDE.md" || isHostSkillPath(value))
    return true;
  return value === ".workflow-system/PROJECT_PROFILE.yaml" || value === ".workflow-system/WORKFLOW_PROTOCOL.md" || value === ".workflow-system/FILE_SCHEMAS.md" || value.startsWith(".workflow-system/vnext/") || value.startsWith(".workflow-system/runtime/") || value.startsWith("docs/workflow/") || value.startsWith("docs/designs/") || value.startsWith("docs/adoption/");
}
function isForbiddenAssetPath(value) {
  if (value.startsWith(".workflow-system/runtime/"))
    return false;
  const segments = value.split("/");
  if (segments.includes(".git"))
    return true;
  if (segments.includes("node_modules") && !value.startsWith(".workflow-system/runtime/"))
    return true;
  if (["src", "app", "lib", "packages"].some((segment) => segments.includes(segment)))
    return true;
  if (["package.json", "package-lock.json", "bun.lockb", "pnpm-lock.yaml", "yarn.lock"].includes(value))
    return true;
  return false;
}
function validateAuthorityEvidence(value) {
  if (!Array.isArray(value) || value.length === 0)
    fail("BOOTSTRAP_AUTHORITY_MISSING", "authority_evidence must be non-empty.");
  return value.map((item, index) => {
    const record = expectRecord(item, `authority_evidence[${index}]`);
    expectExactKeys(record, ["kind", "source", "subject"], `authority_evidence[${index}]`);
    const kind = expectString(record.kind, `authority_evidence[${index}].kind`);
    if (!["project-owner", "scope-admission", "evidence-admission", "dangerous-operation"].includes(kind))
      fail("BOOTSTRAP_AUTHORITY_INVALID", `authority_evidence[${index}].kind is unsupported.`);
    return { kind, source: expectString(record.source, `authority_evidence[${index}].source`), subject: expectString(record.subject, `authority_evidence[${index}].subject`) };
  });
}
function validateSemanticOperations(value, assets) {
  if (!Array.isArray(value))
    fail("BOOTSTRAP_SCHEMA_INVALID", "semantic_operations must be an array.");
  const assetPaths = new Set(assets.map((asset) => asset.path));
  const operations = [];
  for (const [index, item] of value.entries()) {
    const record = expectRecord(item, `semantic_operations[${index}]`);
    expectExactKeys(record, ["operation_kind", "target_paths", "evidence_refs"], `semantic_operations[${index}]`);
    const operationKind = expectString(record.operation_kind, `semantic_operations[${index}].operation_kind`);
    if (!BOOTSTRAP_OPERATION_KINDS.includes(operationKind))
      fail("BOOTSTRAP_SCHEMA_INVALID", `semantic_operations[${index}].operation_kind is unsupported.`);
    const targetPaths = normalizePathArray(record.target_paths, `semantic_operations[${index}].target_paths`);
    for (const target of targetPaths) {
      if (!assetPaths.has(target))
        fail("BOOTSTRAP_TARGET_CONFLICT", `semantic operation ${operationKind} targets an asset that is not in the generated set: ${target}`);
    }
    const evidenceRefs = expectStringArray(record.evidence_refs, `semantic_operations[${index}].evidence_refs`);
    operations.push({ operation_kind: operationKind, target_paths: targetPaths, evidence_refs: evidenceRefs });
  }
  if (new Set(operations.map((operation) => operation.operation_kind)).size !== operations.length)
    fail("BOOTSTRAP_SCHEMA_INVALID", "semantic_operations must contain at most one record for each operation kind.");
  const expected = new Map([
    ["decision-record-transaction", ["docs/workflow/DECISIONS.md"]],
    ["contract-candidate-commit", ["docs/workflow/CONTRACTS.md"]],
    ["project-status-transaction", ["docs/workflow/STATUS.md"]]
  ]);
  const hasAgents = assetPaths.has("AGENTS.md");
  const hasClaude = assetPaths.has("CLAUDE.md");
  if (hasAgents !== hasClaude)
    fail("BOOTSTRAP_BOUNDARY_VIOLATION", "paired host guidance must include both AGENTS.md and CLAUDE.md.");
  if (hasAgents)
    expected.set("paired-host-guidance-transaction", ["AGENTS.md", "CLAUDE.md"]);
  for (const [operationKind, targetPaths] of expected) {
    if (!targetPaths.every((target) => assetPaths.has(target)))
      continue;
    const operation = operations.find((candidate) => candidate.operation_kind === operationKind);
    if (!operation || operation.target_paths.slice().sort().join("|") !== targetPaths.slice().sort().join("|")) {
      fail("BOOTSTRAP_BOUNDARY_VIOLATION", `${operationKind} must declare the exact generated target set: ${targetPaths.join(", ")}.`);
    }
  }
  return operations;
}
function validateAsset(value, location) {
  const record = expectRecord(value, location);
  expectExactKeys(record, ["path", "category", "content"], location);
  const assetPath = normalizeRepoPath(expectString(record.path, `${location}.path`), `${location}.path`);
  if (!isAllowedAssetPath(assetPath) || isForbiddenAssetPath(assetPath))
    fail("BOOTSTRAP_TARGET_FORBIDDEN", `asset target is outside the bootstrap boundary: ${assetPath}`);
  const category = expectString(record.category, `${location}.category`);
  if (!BOOTSTRAP_ASSET_CATEGORIES.includes(category))
    fail("BOOTSTRAP_SCHEMA_INVALID", `${location}.category is unsupported.`);
  if (typeof record.content !== "string")
    fail("BOOTSTRAP_SCHEMA_INVALID", `${location}.content must be text.`);
  return { path: assetPath, category, content: record.content };
}
function validateTargetSet(proposal, assets) {
  const assetPaths = assets.map((asset) => asset.path);
  const requested = new Set(proposal.requested_write_targets);
  const actual = new Set(assetPaths);
  if (requested.size !== actual.size || [...requested].some((value) => !actual.has(value)))
    fail("BOOTSTRAP_TARGET_CONFLICT", "requested_write_targets must equal the generated asset target set.");
  for (const directory of proposal.requested_directory_targets) {
    if (!directory.endsWith("/node_modules") || !directory.startsWith(".workflow-system/runtime/"))
      fail("BOOTSTRAP_TARGET_FORBIDDEN", `directory target is outside the Runtime dependency boundary: ${directory}`);
  }
  const expectedChanged = new Set([...assetPaths, ...proposal.requested_directory_targets]);
  if (expectedChanged.size !== proposal.changed_paths.length || proposal.changed_paths.some((value) => !expectedChanged.has(value)))
    fail("BOOTSTRAP_SCOPE_INVALID", "changed_paths must enumerate every generated file and staged Runtime directory exactly once.");
  if (proposal.delete_targets.length > 0)
    fail("BOOTSTRAP_SCOPE_INVALID", "bootstrap does not support untyped deletion; use realign with an explicit implementation change.");
}
function validateModeOperationBoundary(proposal) {
  const kinds = new Set(proposal.semantic_operations.map((operation) => operation.operation_kind));
  if (proposal.mode === "design" && kinds.has("contract-candidate-commit"))
    fail("BOOTSTRAP_BOUNDARY_VIOLATION", "design mode must not commit a locked Contract candidate.");
  if (proposal.mode === "inventory" && kinds.has("contract-candidate-commit"))
    fail("BOOTSTRAP_BOUNDARY_VIOLATION", "inventory mode must not commit a locked Contract candidate.");
  if (proposal.mode === "design" && kinds.has("paired-host-guidance-transaction"))
    fail("BOOTSTRAP_BOUNDARY_VIOLATION", "design mode must not install host guidance.");
  if (proposal.mode === "inventory" && kinds.has("paired-host-guidance-transaction"))
    fail("BOOTSTRAP_BOUNDARY_VIOLATION", "inventory mode must not install host guidance.");
}
function validateBootstrapProjectProposal(value) {
  const record = expectRecord(value, "bootstrap proposal");
  expectExactKeys(record, [
    "schema_version",
    "kind",
    "caller",
    "mode",
    "target_identity",
    "source_revision",
    "source_tree_hash",
    "scope_document",
    "changed_paths",
    "conditional_authorizations",
    "transformation_kind",
    "authority_evidence",
    "semantic_operations",
    "preconditions",
    "evidence_refs",
    "idempotency_key",
    "requested_write_targets",
    "requested_directory_targets",
    "delete_targets",
    "assets"
  ], "bootstrap proposal");
  if (record.schema_version !== VNEXT_BOOTSTRAP_PROPOSAL_SCHEMA_VERSION || record.kind !== VNEXT_BOOTSTRAP_PROPOSAL_KIND || record.caller !== "bootstrap-project")
    fail("BOOTSTRAP_SCHEMA_INVALID", "bootstrap proposal envelope marker is invalid.");
  const mode = expectString(record.mode, "bootstrap proposal.mode");
  if (!BOOTSTRAP_MODES.includes(mode))
    fail("BOOTSTRAP_MODE_INVALID", `bootstrap mode must be one of ${BOOTSTRAP_MODES.join(", ")}.`);
  const targetIdentity = expectString(record.target_identity, "bootstrap proposal.target_identity");
  if (!TARGET_IDENTITY_PATTERN.test(targetIdentity))
    fail("BOOTSTRAP_IDENTITY_INVALID", "target_identity must be a 32-character lowercase SHA-256 prefix.");
  const sourceRevision = expectString(record.source_revision, "bootstrap proposal.source_revision");
  const sourceTreeHash = expectString(record.source_tree_hash, "bootstrap proposal.source_tree_hash");
  if (!SHA256_PATTERN.test(sourceTreeHash))
    fail("BOOTSTRAP_SCHEMA_INVALID", "source_tree_hash must be SHA-256.");
  const scopeDocument = expectString(record.scope_document, "bootstrap proposal.scope_document");
  const changedPaths = normalizePathArray(record.changed_paths, "bootstrap proposal.changed_paths");
  const conditionalAuthorizations = record.conditional_authorizations === undefined ? [] : record.conditional_authorizations;
  const transformationKind = expectString(record.transformation_kind, "bootstrap proposal.transformation_kind");
  if (transformationKind !== "localized" && transformationKind !== "inherently-broad")
    fail("BOOTSTRAP_SCOPE_INVALID", "transformation_kind is unsupported.");
  const authorityEvidence = validateAuthorityEvidence(record.authority_evidence);
  const preconditions = expectStringArray(record.preconditions, "bootstrap proposal.preconditions");
  const evidenceRefs = expectStringArray(record.evidence_refs, "bootstrap proposal.evidence_refs");
  const idempotencyKey = expectString(record.idempotency_key, "bootstrap proposal.idempotency_key");
  if (!SAFE_KEY_PATTERN.test(idempotencyKey))
    fail("BOOTSTRAP_SCHEMA_INVALID", "idempotency_key is invalid.");
  const requestedWriteTargets = normalizePathArray(record.requested_write_targets, "bootstrap proposal.requested_write_targets");
  const requestedDirectoryTargets = normalizePathArray(record.requested_directory_targets, "bootstrap proposal.requested_directory_targets", true);
  const deleteTargets = normalizePathArray(record.delete_targets, "bootstrap proposal.delete_targets", true);
  if (!Array.isArray(record.assets) || record.assets.length === 0)
    fail("BOOTSTRAP_SCHEMA_INVALID", "bootstrap proposal.assets must be non-empty.");
  const assets = record.assets.map((item, index) => validateAsset(item, `bootstrap proposal.assets[${index}]`));
  if (new Set(assets.map((asset) => asset.path)).size !== assets.length)
    fail("BOOTSTRAP_TARGET_CONFLICT", "bootstrap proposal.assets must not contain duplicate paths.");
  const proposal = {
    schema_version: 1,
    kind: VNEXT_BOOTSTRAP_PROPOSAL_KIND,
    caller: "bootstrap-project",
    mode,
    target_identity: targetIdentity,
    source_revision: sourceRevision,
    source_tree_hash: sourceTreeHash,
    scope_document: scopeDocument,
    changed_paths: changedPaths,
    conditional_authorizations: conditionalAuthorizations,
    transformation_kind: transformationKind,
    authority_evidence: authorityEvidence,
    semantic_operations: validateSemanticOperations(record.semantic_operations, assets),
    preconditions,
    evidence_refs: evidenceRefs,
    idempotency_key: idempotencyKey,
    requested_write_targets: requestedWriteTargets,
    requested_directory_targets: requestedDirectoryTargets,
    delete_targets: deleteTargets,
    assets
  };
  validateTargetSet(proposal, assets);
  validateModeOperationBoundary(proposal);
  const scope = parseMutationScope(scopeDocument, sha256(scopeDocument));
  const scopeResult = evaluateMutationScope(scope, {
    changed_paths: changedPaths,
    conditional_authorizations: conditionalAuthorizations,
    transformation_kind: transformationKind
  });
  if (scopeResult.status !== "pass")
    fail("BOOTSTRAP_SCOPE_BLOCKED", scopeResult.blockers.join(" "));
  return { proposal, scope: scopeResult };
}
function absoluteTarget(root, relativePath) {
  const resolvedRoot = path3.resolve(root);
  const resolved = path3.resolve(resolvedRoot, ...relativePath.split("/"));
  const prefix = resolvedRoot.endsWith(path3.sep) ? resolvedRoot : `${resolvedRoot}${path3.sep}`;
  if (resolved !== resolvedRoot && !resolved.startsWith(prefix))
    fail("BOOTSTRAP_PATH_INVALID", `target escapes project root: ${relativePath}`);
  return resolved;
}
function contentHash(content) {
  return sha256(Buffer.from(content, "utf8"));
}
function validateDirectorySources(proposal, sources) {
  const requested = new Set(proposal.requested_directory_targets);
  const normalized = sources.map((source, index) => {
    const relative = normalizeRepoPath(source.path, `directory_sources[${index}].path`);
    if (typeof source.sourcePath !== "string" || source.sourcePath.trim().length === 0) {
      fail("BOOTSTRAP_SCHEMA_INVALID", `directory_sources[${index}].sourcePath must be non-empty.`);
    }
    if (!requested.has(relative))
      fail("BOOTSTRAP_TARGET_CONFLICT", `directory source is not requested by the proposal: ${relative}`);
    if (!fs2.existsSync(source.sourcePath) || !fs2.statSync(source.sourcePath).isDirectory())
      fail("BOOTSTRAP_TARGET_CONFLICT", `directory source is missing: ${source.sourcePath}`);
    return { path: relative, sourcePath: path3.resolve(source.sourcePath) };
  });
  if (new Set(normalized.map((source) => source.path)).size !== normalized.length)
    fail("BOOTSTRAP_TARGET_CONFLICT", "directory_sources must not contain duplicate paths.");
  if (requested.size !== normalized.length || [...requested].some((relative) => !normalized.some((source) => source.path === relative))) {
    fail("BOOTSTRAP_TARGET_CONFLICT", "directory_sources must exactly cover requested_directory_targets.");
  }
  return normalized;
}
function applyAtomicBootstrapTransaction(root, proposal, directorySources, verify) {
  const resolvedRoot = path3.resolve(root);
  const stagingRoot = fs2.mkdtempSync(path3.join(path3.dirname(resolvedRoot), ".workflow-vnext-bootstrap-"));
  const backups = [];
  const newlyPromoted = [];
  try {
    const stagedFiles = [];
    for (const [index, asset] of proposal.assets.entries()) {
      const stagedPath = path3.join(stagingRoot, "files", `${index}.tmp`);
      fs2.mkdirSync(path3.dirname(stagedPath), { recursive: true });
      fs2.writeFileSync(stagedPath, asset.content, "utf8");
      stagedFiles.push({ relative: asset.path, path: stagedPath });
    }
    const stagedDirectories = [];
    for (const [index, source] of directorySources.entries()) {
      const stagedPath = path3.join(stagingRoot, "directories", String(index));
      fs2.mkdirSync(path3.dirname(stagedPath), { recursive: true });
      fs2.cpSync(source.sourcePath, stagedPath, { recursive: true });
      stagedDirectories.push({ relative: source.path, path: stagedPath });
    }
    const touched = [...stagedFiles.map((item) => item.relative), ...stagedDirectories.map((item) => item.relative)];
    for (const [index, relative] of touched.entries()) {
      const targetPath = absoluteTarget(resolvedRoot, relative);
      if (!fs2.existsSync(targetPath))
        continue;
      const backupPath = path3.join(stagingRoot, "backups", `${index}.bak`);
      fs2.mkdirSync(path3.dirname(backupPath), { recursive: true });
      fs2.renameSync(targetPath, backupPath);
      backups.push({ targetPath, backupPath });
    }
    for (const staged of stagedFiles) {
      const targetPath = absoluteTarget(resolvedRoot, staged.relative);
      fs2.mkdirSync(path3.dirname(targetPath), { recursive: true });
      fs2.renameSync(staged.path, targetPath);
      newlyPromoted.push(targetPath);
    }
    for (const staged of stagedDirectories) {
      const targetPath = absoluteTarget(resolvedRoot, staged.relative);
      fs2.mkdirSync(path3.dirname(targetPath), { recursive: true });
      fs2.renameSync(staged.path, targetPath);
      newlyPromoted.push(targetPath);
    }
    for (const asset of proposal.assets) {
      const targetPath = absoluteTarget(resolvedRoot, asset.path);
      if (!fs2.existsSync(targetPath) || contentHash(fs2.readFileSync(targetPath, "utf8")) !== contentHash(asset.content)) {
        fail("BOOTSTRAP_READ_BACK_FAILED", `promoted asset did not read back identically: ${asset.path}`);
      }
    }
    for (const source of directorySources) {
      const targetPath = absoluteTarget(resolvedRoot, source.path);
      if (!fs2.existsSync(targetPath) || !fs2.statSync(targetPath).isDirectory())
        fail("BOOTSTRAP_READ_BACK_FAILED", `promoted Runtime directory did not read back: ${source.path}`);
    }
    verify?.();
    fs2.rmSync(stagingRoot, { recursive: true, force: true });
  } catch (error) {
    for (const targetPath of newlyPromoted.reverse()) {
      if (fs2.existsSync(targetPath))
        fs2.rmSync(targetPath, { recursive: true, force: true });
    }
    for (const entry of backups.reverse()) {
      if (fs2.existsSync(entry.targetPath))
        fs2.rmSync(entry.targetPath, { recursive: true, force: true });
      if (fs2.existsSync(entry.backupPath)) {
        fs2.mkdirSync(path3.dirname(entry.targetPath), { recursive: true });
        fs2.renameSync(entry.backupPath, entry.targetPath);
      }
    }
    fs2.rmSync(stagingRoot, { recursive: true, force: true });
    throw error;
  }
}
function applyBootstrapProjectProposal(root, value, options = {}) {
  const validation = validateBootstrapProjectProposal(value);
  const { proposal, scope } = validation;
  if (computeBootstrapTargetIdentity(root) !== proposal.target_identity)
    fail("BOOTSTRAP_IDENTITY_CONFLICT", "proposal target_identity does not match the target root.");
  const suppliedDirectorySources = options.directory_sources ?? [];
  const directorySources = options.dryRun && suppliedDirectorySources.length === 0 && proposal.requested_directory_targets.length > 0 ? [] : validateDirectorySources(proposal, suppliedDirectorySources);
  const plannedWrites = proposal.assets.map((asset) => asset.path);
  const base = {
    operation_kind: "bootstrap-project",
    mode: proposal.mode,
    idempotency_key: proposal.idempotency_key,
    target_identity: proposal.target_identity,
    dry_run: options.dryRun === true,
    planned_writes: plannedWrites,
    planned_directories: [...proposal.requested_directory_targets],
    scope
  };
  if (options.dryRun)
    return { ...base, status: "ready", committed: false, read_back_verified: false, message: "bootstrap proposal validated; no files were written." };
  applyAtomicBootstrapTransaction(root, proposal, directorySources, options.verify);
  return { ...base, status: "success", committed: true, read_back_verified: true, message: "bootstrap proposal committed and read-back verified." };
}
function parseJsonFile(filePath) {
  try {
    return JSON.parse(fs2.readFileSync(path3.resolve(filePath), "utf8"));
  } catch (error) {
    throw new BootstrapRuntimeError("BOOTSTRAP_SCHEMA_INVALID", `proposal file is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}
function readFlag(argv, name) {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}
function readDirectorySources(argv) {
  const sources = [];
  for (let index = 0;index < argv.length; index += 1) {
    if (argv[index] !== "--directory-source")
      continue;
    const value = argv[index + 1] ?? "";
    const separator = value.indexOf("=");
    if (separator <= 0 || separator === value.length - 1)
      throw new BootstrapRuntimeError("BOOTSTRAP_SCHEMA_INVALID", "--directory-source must use <repo-relative-target>=<staged-absolute-directory>.");
    sources.push({ path: value.slice(0, separator), sourcePath: value.slice(separator + 1) });
    index += 1;
  }
  return sources;
}
async function runBootstrapCli(argv = process.argv.slice(1)) {
  try {
    const root = readFlag(argv, "--root") ?? process.cwd();
    const proposalFile = readFlag(argv, "--proposal-file") ?? readFlag(argv, "--proposal");
    if (!proposalFile)
      throw new BootstrapRuntimeError("BOOTSTRAP_SCHEMA_INVALID", "bootstrap-project requires --proposal-file <json>.");
    const dryRun = argv.includes("--dry-run");
    const result = applyBootstrapProjectProposal(root, parseJsonFile(proposalFile), { dryRun, directory_sources: readDirectorySources(argv) });
    console.log(JSON.stringify(result, null, 2));
    return result.status === "ready" || result.status === "success" || result.status === "no-op" ? 0 : 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
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
  "inbox-record-transaction",
  "project-status-transaction",
  "archive-transaction",
  "lesson-record-transaction",
  "contract-candidate-commit",
  "decision-record-transaction"
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
var PREPARE_TASK_MODES = ["default", "confirm", "replan"];
var LIFECYCLE_MODES = ["pause", "interrupt", "resume-paused", "resume-interrupted", "supersede"];
var CLOSE_TASK_MODES = ["default"];
var INBOX_ITEM_TYPES = ["requirement", "idea", "bug", "chore", "question"];
var INBOX_ITEM_SOURCES = ["user", "implementation", "review", "regression", "root_cause", "other"];
var INBOX_SUGGESTED_NEXT_ACTIONS = ["triage_later", "ask_user"];
var REVIEW_CYCLE_PHASES = ["discovery", "verification"];
var STEP_STATUSES = ["ready", "in-progress", "completed", "blocked"];
var FINDING_STATUSES = ["admitted", "in-progress", "resolved", "deferred", "rejected"];
var REPLAN_TASK_STATE_ACTIONS = ["mark-replan-blocked", "clear-replan-block", "commit-replan"];
var DRAFT_TASK_STATE_ACTIONS = ["create-draft", "update-draft", "confirm-draft"];
var DRAFT_AUDIT_ACTIONS = ["create-draft", "update-draft", "confirm-draft"];
var REPLAN_AUDIT_ACTIONS = [
  "supersede",
  "mark-replan-blocked",
  "clear-replan-block",
  "commit-replan"
];
var STEP_ADVANCEMENT_OUTCOMES = [
  "not-applicable",
  "repair-awaiting-verification",
  "advanced",
  "task-complete"
];
var REVIEW_TARGET_VERIFICATION_STATES = ["verified", "harness-supplied"];
var DOCUMENT_ID_PATTERN = /^doc-[a-f0-9]{24}$/;
var SHA256_PATTERN2 = /^[a-f0-9]{64}$/;
var SAFE_KEY_PATTERN2 = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/;
var FINGERPRINT_PATTERN = /^[a-z0-9][a-z0-9._:-]{2,127}$/;
var STEP_ID_PATTERN2 = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
var MAX_TEXT_LENGTH = 4000;
var MAX_EVIDENCE_REFS = 32;
var MAX_FINDINGS = 256;
var MAX_APPLIED_PROPOSALS = 256;
var MAX_EXECUTION_LOG = 256;
var MAX_REPLAN_SECTION_CONTENT_LENGTH = 32768;
var MAX_REPAIR_ROUNDS = 3;
var MAX_REPAIR_ATTEMPTS = 2;
var CURRENT_TASK_RELATIVE_FALLBACK = "docs/workflow/CURRENT_TASK.md";
var INBOX_RECORD_ITEM_ID_PATTERN = /^(\d{8})-([a-z0-9]{4,})$/;
var INBOX_RECORD_PATH_PATTERN = /^TASKS\/inbox\/INBOX-(\d{8})-([a-z0-9]{4,})-([a-z0-9]+(?:-[a-z0-9]+)*)\.md$/;
var INBOX_RECORD_PROVENANCE_MARKER = "<!-- vNext inbox record:";
var MAX_INBOX_TEXT_LENGTH = 32768;
var INBOX_CAPTURE_PRECONDITIONS = [
  "current-task-is-active",
  "relation-proven-unrelated",
  "duplicate-check-clear",
  "owner-route-resolved"
];
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
function isRecord2(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function fail2(code, message) {
  throw new VNextRuntimeError(code, message);
}
function expectRecord2(value, location) {
  if (!isRecord2(value))
    fail2("RUNTIME_SCHEMA_INVALID", `${location} must be a mapping.`);
  return value;
}
function expectExactKeys2(value, expected, location) {
  const expectedSet = new Set(expected);
  const missing = expected.filter((key) => !(key in value));
  const extra = Object.keys(value).filter((key) => !expectedSet.has(key));
  if (missing.length > 0 || extra.length > 0) {
    fail2("RUNTIME_SCHEMA_INVALID", `${location} keys mismatch; missing=[${missing.join(", ")}], unexpected=[${extra.join(", ")}].`);
  }
}
function expectString2(value, location, pattern) {
  if (typeof value !== "string" || value.trim().length === 0) {
    fail2("RUNTIME_SCHEMA_INVALID", `${location} must be a non-empty string.`);
  }
  const normalized = value.trim();
  if (pattern && !pattern.test(normalized)) {
    fail2("RUNTIME_SCHEMA_INVALID", `${location} has an invalid value.`);
  }
  return normalized;
}
function expectNullableString(value, location, pattern) {
  if (value === null)
    return null;
  return expectString2(value, location, pattern);
}
function expectText(value, location, maxLength = MAX_TEXT_LENGTH) {
  const text = expectString2(value, location);
  if (text.length > maxLength)
    fail2("RUNTIME_SCHEMA_INVALID", `${location} exceeds ${maxLength} characters.`);
  return text;
}
function expectEnum(value, allowed, location) {
  const normalized = expectString2(value, location);
  if (!allowed.includes(normalized)) {
    fail2("RUNTIME_SCHEMA_INVALID", `${location} must be one of [${allowed.join(", ")}].`);
  }
  return normalized;
}
function expectBoolean(value, location) {
  if (typeof value !== "boolean")
    fail2("RUNTIME_SCHEMA_INVALID", `${location} must be a boolean.`);
  return value;
}
function expectInteger(value, location, min = 0, max = Number.MAX_SAFE_INTEGER) {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    fail2("RUNTIME_SCHEMA_INVALID", `${location} must be an integer in [${min}, ${max}].`);
  }
  return value;
}
function expectStringArray2(value, location, allowEmpty = false, maxLength = 128) {
  if (!Array.isArray(value) || !allowEmpty && value.length === 0) {
    fail2("RUNTIME_SCHEMA_INVALID", `${location} must be ${allowEmpty ? "an array" : "a non-empty array"}.`);
  }
  if (value.length > maxLength)
    fail2("RUNTIME_SCHEMA_INVALID", `${location} has too many entries.`);
  const items = value.map((item, index) => expectText(item, `${location}[${index}]`, 512));
  if (new Set(items).size !== items.length)
    fail2("RUNTIME_SCHEMA_INVALID", `${location} contains duplicates.`);
  return items;
}
function expectSetEqual(actual, expected, location) {
  const actualSet = new Set(actual);
  const expectedSet = new Set(expected);
  const missing = expected.filter((item) => !actualSet.has(item));
  const extra = actual.filter((item) => !expectedSet.has(item));
  if (missing.length > 0 || extra.length > 0 || actualSet.size !== actual.length) {
    fail2("RUNTIME_CONTRACT_INVALID", `${location} differs from the closed set; missing=[${missing.join(", ")}], extra=[${extra.join(", ")}].`);
  }
}
function normalizeRepoPath2(value, location) {
  const normalized = value.replace(/\\/g, "/").replace(/^\.\//, "");
  if (!normalized || normalized.startsWith("/") || normalized.split("/").includes("..")) {
    fail2("RUNTIME_PATH_INVALID", `${location} must be a repository-relative path.`);
  }
  return normalized;
}
function sha2562(value) {
  return crypto3.createHash("sha256").update(value).digest("hex");
}
function stableValue(value) {
  if (Array.isArray(value))
    return value.map(stableValue);
  if (isRecord2(value)) {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  }
  return value;
}
function digest(value) {
  return sha2562(JSON.stringify(stableValue(value)));
}
function parseYamlFrontmatter(content, location) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(content);
  if (!match) {
    fail2("MIGRATION_REQUIRED", `${location} is not a vNext CURRENT_TASK document; run the Migration Pack.`);
  }
  const document = parseDocument(match[1], { uniqueKeys: true });
  const diagnostics = [...document.errors, ...document.warnings];
  if (diagnostics.length > 0) {
    fail2("RUNTIME_SCHEMA_INVALID", `${location} has invalid frontmatter YAML: ${diagnostics.map((item) => item.message).join("; ")}`);
  }
  const frontmatter = document.toJS();
  if (!isRecord2(frontmatter)) {
    fail2("MIGRATION_REQUIRED", `${location} does not declare a supported vNext CURRENT_TASK schema; run the Migration Pack.`);
  }
  return { frontmatter, body: match[2] };
}
function parseYamlMappingFile(filePath) {
  if (!fs3.existsSync(filePath))
    fail2("RUNTIME_CONTRACT_MISSING", `Runtime contract is missing: ${filePath}`);
  const document = parseDocument(fs3.readFileSync(filePath, "utf8"), { uniqueKeys: true });
  const diagnostics = [...document.errors, ...document.warnings];
  if (diagnostics.length > 0)
    fail2("RUNTIME_CONTRACT_INVALID", `${filePath} has invalid YAML: ${diagnostics.map((item) => item.message).join("; ")}`);
  return expectRecord2(document.toJS(), filePath);
}
function validateNodeMinimum(nodeMinVersion) {
  const match = /^>=([0-9]+)\.([0-9]+)\.([0-9]+)$/.exec(nodeMinVersion);
  if (!match)
    fail2("RUNTIME_CONTRACT_INVALID", "runtime_distribution.node_min_version must use >=MAJOR.MINOR.PATCH.");
  const major = Number(match[1]);
  if (!Number.isSafeInteger(major) || major < 20)
    fail2("RUNTIME_CONTRACT_INVALID", "runtime_distribution.node_min_version must require Node 20 or newer.");
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
  if (!fs3.existsSync(filePath))
    fail2(code, "Required Runtime distribution file is missing: " + filePath);
  let parsed;
  try {
    parsed = JSON.parse(fs3.readFileSync(filePath, "utf8"));
  } catch (error) {
    fail2(code, filePath + " is not valid JSON: " + (error instanceof Error ? error.message : String(error)));
  }
  return expectRecord2(parsed, filePath);
}
function resolveRuntimeDistributionDirectory(root) {
  const resolvedRoot = path4.resolve(root);
  const installedDirectory = path4.join(resolvedRoot, ...VNEXT_RUNTIME_PACKAGE_RELATIVE_PATH.split("/"));
  if (fs3.existsSync(path4.join(installedDirectory, "package.json"))) {
    return { directory: installedDirectory, installed: true };
  }
  return { directory: path4.join(resolvedRoot, "runtime", "vnext"), installed: false };
}
function validateVNextRuntimeDistribution(root, contract, requireDependencies = false) {
  const { directory } = resolveRuntimeDistributionDirectory(root);
  const packagePath = path4.join(directory, "package.json");
  const lockfilePath = path4.join(directory, "package-lock.json");
  const entrypointPath = path4.join(directory, "dist", "cli.js");
  const packageManifest = readJsonObject(packagePath, "RUNTIME_PACKAGE_INVALID");
  if (packageManifest.name !== contract.package_name || packageManifest.version !== contract.package_version || packageManifest.private !== true || packageManifest.type !== "module") {
    fail2("RUNTIME_PACKAGE_INVALID", "Runtime package.json must declare the contract name, version, private=true, and type=module.");
  }
  const engines = expectRecord2(packageManifest.engines, "Runtime package.json.engines");
  if (engines.node !== contract.node_min_version)
    fail2("RUNTIME_PACKAGE_INVALID", "Runtime package.json.engines.node does not match runtime_distribution.node_min_version.");
  const dependencies = expectRecord2(packageManifest.dependencies, "Runtime package.json.dependencies");
  if (dependencies.yaml !== "2.8.3")
    fail2("RUNTIME_PACKAGE_INVALID", "Runtime package.json must pin yaml to 2.8.3.");
  const lockfile = readJsonObject(lockfilePath, "RUNTIME_PACKAGE_INVALID");
  if (lockfile.name !== contract.package_name || lockfile.version !== contract.package_version || lockfile.lockfileVersion !== 3) {
    fail2("RUNTIME_PACKAGE_INVALID", "Runtime package-lock.json identity or lockfileVersion is invalid.");
  }
  const lockPackages = expectRecord2(lockfile.packages, "Runtime package-lock.json.packages");
  const rootLock = expectRecord2(lockPackages[""], 'Runtime package-lock.json.packages[""]');
  if (rootLock.version !== contract.package_version)
    fail2("RUNTIME_PACKAGE_INVALID", "Runtime package-lock.json root version does not match the Runtime contract.");
  const yamlLock = expectRecord2(lockPackages["node_modules/yaml"], "Runtime package-lock.json.packages[node_modules/yaml]");
  if (yamlLock.version !== "2.8.3")
    fail2("RUNTIME_PACKAGE_INVALID", "Runtime package-lock.json must lock yaml to 2.8.3.");
  if (!fs3.existsSync(entrypointPath) || !fs3.statSync(entrypointPath).isFile())
    fail2("RUNTIME_PACKAGE_INVALID", "Runtime entrypoint is missing: " + entrypointPath);
  const entrypoint = fs3.readFileSync(entrypointPath, "utf8");
  if (!entrypoint.includes("vnext-runtime-proposal") || !entrypoint.includes("runCli"))
    fail2("RUNTIME_PACKAGE_INVALID", "Runtime dist/cli.js is not the generated vNext Runtime entrypoint.");
  if (requireDependencies) {
    const localYaml = path4.join(directory, "node_modules", "yaml", "package.json");
    const localYamlManifest = readJsonObject(localYaml, "RUNTIME_DEPENDENCY_MISSING");
    if (localYamlManifest.version !== "2.8.3")
      fail2("RUNTIME_DEPENDENCY_INVALID", "Runtime-local yaml dependency does not match package-lock.json.");
  }
  return {
    kind: contract.kind,
    package_path: contract.package_path,
    entrypoint: contract.entrypoint,
    package_version: contract.package_version,
    node_min_version: contract.node_min_version,
    package_lock_sha256: sha2562(fs3.readFileSync(lockfilePath)),
    entrypoint_sha256: sha2562(fs3.readFileSync(entrypointPath))
  };
}
function validateRuntimeDistributionContract(value) {
  const distribution = expectRecord2(value, "Runtime contract.runtime_distribution");
  expectExactKeys2(distribution, ["kind", "package_path", "entrypoint", "package_manifest", "lockfile", "package_name", "package_version", "node_min_version"], "Runtime contract.runtime_distribution");
  const result = {
    kind: expectEnum(distribution.kind, ["project-local-node"], "Runtime contract.runtime_distribution.kind"),
    package_path: normalizeRepoPath2(expectString2(distribution.package_path, "Runtime contract.runtime_distribution.package_path"), "Runtime contract.runtime_distribution.package_path"),
    entrypoint: normalizeRepoPath2(expectString2(distribution.entrypoint, "Runtime contract.runtime_distribution.entrypoint"), "Runtime contract.runtime_distribution.entrypoint"),
    package_manifest: normalizeRepoPath2(expectString2(distribution.package_manifest, "Runtime contract.runtime_distribution.package_manifest"), "Runtime contract.runtime_distribution.package_manifest"),
    lockfile: normalizeRepoPath2(expectString2(distribution.lockfile, "Runtime contract.runtime_distribution.lockfile"), "Runtime contract.runtime_distribution.lockfile"),
    package_name: expectString2(distribution.package_name, "Runtime contract.runtime_distribution.package_name"),
    package_version: expectString2(distribution.package_version, "Runtime contract.runtime_distribution.package_version"),
    node_min_version: expectString2(distribution.node_min_version, "Runtime contract.runtime_distribution.node_min_version")
  };
  if (result.package_path !== VNEXT_RUNTIME_PACKAGE_RELATIVE_PATH || result.entrypoint !== VNEXT_RUNTIME_ENTRYPOINT_RELATIVE_PATH || result.package_manifest !== VNEXT_RUNTIME_PACKAGE_MANIFEST_RELATIVE_PATH || result.lockfile !== VNEXT_RUNTIME_LOCKFILE_RELATIVE_PATH || result.package_name !== VNEXT_RUNTIME_PACKAGE_NAME || result.package_version !== VNEXT_RUNTIME_PACKAGE_VERSION || result.node_min_version !== VNEXT_RUNTIME_NODE_MIN_VERSION) {
    fail2("RUNTIME_CONTRACT_INVALID", "Runtime distribution must use the canonical project-local Node package identity.");
  }
  validateNodeMinimum(result.node_min_version);
  return result;
}
function validateBootstrapRuntimeContract(value) {
  const bootstrap = expectRecord2(value, "vNext Runtime contract.bootstrap_project");
  expectExactKeys2(bootstrap, ["schema_version", "kind", "caller", "modes", "required_envelope", "mutation_scope", "asset_boundary", "operations", "recovery", "read_back"], "vNext Runtime contract.bootstrap_project");
  if (bootstrap.schema_version !== 1 || bootstrap.kind !== "vnext-bootstrap-runtime-contract") {
    fail2("RUNTIME_CONTRACT_INVALID", "bootstrap_project must declare the vNext bootstrap Runtime contract marker.");
  }
  expectSetEqual(expectStringArray2(bootstrap.caller, "Runtime contract.bootstrap_project.caller"), ["bootstrap-project"], "bootstrap Runtime callers");
  expectSetEqual(expectStringArray2(bootstrap.modes, "Runtime contract.bootstrap_project.modes"), [...BOOTSTRAP_MODES], "bootstrap Runtime modes");
  expectSetEqual(expectStringArray2(bootstrap.required_envelope, "Runtime contract.bootstrap_project.required_envelope"), ["authority_evidence", "semantic_operations", "preconditions", "evidence_refs", "idempotency_key", "requested_write_targets", "requested_directory_targets", "changed_paths", "scope_document", "conditional_authorizations", "transformation_kind", "assets"], "bootstrap Runtime proposal envelope");
  const scope = expectRecord2(bootstrap.mutation_scope, "Runtime contract.bootstrap_project.mutation_scope");
  expectExactKeys2(scope, ["status", "binding", "source", "default_write_policy", "conditional_expansion_requires", "read_discovery_is_not_write_authority", "check_command", "input", "output"], "Runtime contract.bootstrap_project.mutation_scope");
  if (scope.status !== "bound" || scope.binding !== "vnext-runtime-read-only" || scope.source !== "bootstrap proposal.scope_document" || scope.default_write_policy !== "deny" || scope.conditional_expansion_requires !== "evidence-and-authority" || scope.read_discovery_is_not_write_authority !== true || scope.check_command !== "shared-mutation-scope-evaluator") {
    fail2("RUNTIME_CONTRACT_INVALID", "bootstrap mutation scope must keep the shared default-deny evaluator boundary.");
  }
  const scopeInput = expectRecord2(scope.input, "Runtime contract.bootstrap_project.mutation_scope.input");
  expectExactKeys2(scopeInput, ["required"], "Runtime contract.bootstrap_project.mutation_scope.input");
  expectSetEqual(expectStringArray2(scopeInput.required, "Runtime contract.bootstrap_project.mutation_scope.input.required"), ["explicit_changed_paths", "conditional_authorizations_with_evidence_and_authority", "transformation_kind"], "bootstrap mutation scope input");
  const scopeOutput = expectRecord2(scope.output, "Runtime contract.bootstrap_project.mutation_scope.output");
  expectExactKeys2(scopeOutput, ["required"], "Runtime contract.bootstrap_project.mutation_scope.output");
  expectSetEqual(expectStringArray2(scopeOutput.required, "Runtime contract.bootstrap_project.mutation_scope.output.required"), ["per-path-admission-and-blocker", "source-revision"], "bootstrap mutation scope output");
  const assetBoundary = expectRecord2(bootstrap.asset_boundary, "Runtime contract.bootstrap_project.asset_boundary");
  expectExactKeys2(assetBoundary, ["allowed_roots", "forbidden_targets", "generated_categories"], "Runtime contract.bootstrap_project.asset_boundary");
  expectStringArray2(assetBoundary.allowed_roots, "Runtime contract.bootstrap_project.asset_boundary.allowed_roots");
  expectStringArray2(assetBoundary.forbidden_targets, "Runtime contract.bootstrap_project.asset_boundary.forbidden_targets");
  expectStringArray2(assetBoundary.generated_categories, "Runtime contract.bootstrap_project.asset_boundary.generated_categories");
  const operations = bootstrap.operations;
  if (!Array.isArray(operations) || operations.length !== BOOTSTRAP_OPERATION_KINDS.length)
    fail2("RUNTIME_CONTRACT_INVALID", `bootstrap_project must declare exactly ${BOOTSTRAP_OPERATION_KINDS.length} typed operations.`);
  const bound = [];
  const expectedOperations = {
    "contract-candidate-commit": { source: ["source-authority evidence", "existing CONTRACTS.md when present"], writes: ["CONTRACTS.md"] },
    "decision-record-transaction": { source: ["source-authority evidence", "existing DECISIONS.md when present"], writes: ["DECISIONS.md"] },
    "project-status-transaction": { source: ["STATUS.md"], writes: ["STATUS.md"] },
    "paired-host-guidance-transaction": { source: ["target host guidance"], writes: ["paired host guidance"] }
  };
  for (const [index, rawOperation] of operations.entries()) {
    const operation = expectRecord2(rawOperation, `Runtime contract.bootstrap_project.operations[${index}]`);
    expectExactKeys2(operation, ["id", "status", "binding", "operation", "source_targets", "write_targets", "allowed_callers", "result_states", "atomic", "idempotence", "conflict_policy"], `Runtime contract.bootstrap_project.operations[${index}]`);
    const id = expectString2(operation.id, `Runtime contract.bootstrap_project.operations[${index}].id`);
    if (!BOOTSTRAP_OPERATION_KINDS.includes(id) || bound.includes(id))
      fail2("RUNTIME_CONTRACT_INVALID", `bootstrap operation ${id} is not in the closed operation set.`);
    if (operation.status !== "bound" || operation.binding !== "vnext-runtime" || operation.operation !== id)
      fail2("RUNTIME_CONTRACT_INVALID", `bootstrap operation ${id} must be bound to vnext-runtime.`);
    const expected = expectedOperations[id];
    expectSetEqual(expectStringArray2(operation.source_targets, `bootstrap operation ${id}.source_targets`), expected.source, `bootstrap operation ${id}.source_targets`);
    expectSetEqual(expectStringArray2(operation.write_targets, `bootstrap operation ${id}.write_targets`), expected.writes, `bootstrap operation ${id}.write_targets`);
    expectSetEqual(expectStringArray2(operation.allowed_callers, `bootstrap operation ${id}.allowed_callers`), ["bootstrap-project"], `bootstrap operation ${id}.allowed_callers`);
    expectSetEqual(expectStringArray2(operation.result_states, `bootstrap operation ${id}.result_states`), [...RUNTIME_RESULT_STATES], `bootstrap operation ${id}.result_states`);
    if (operation.atomic !== true || operation.idempotence !== "fail-closed" || operation.conflict_policy !== "fail-closed")
      fail2("RUNTIME_CONTRACT_INVALID", `bootstrap operation ${id} must be atomic, fail-closed, and conflict-safe.`);
    bound.push(id);
  }
  expectSetEqual(bound, [...BOOTSTRAP_OPERATION_KINDS], "bootstrap Runtime bound operations");
  const recovery = expectRecord2(bootstrap.recovery, "Runtime contract.bootstrap_project.recovery");
  expectExactKeys2(recovery, ["marker", "interrupted", "rollback"], "Runtime contract.bootstrap_project.recovery");
  if (recovery.marker !== ".workflow-system/vnext/BOOTSTRAP_IN_PROGRESS.json" || recovery.interrupted !== "fail-closed-explicit-recovery" || recovery.rollback !== "verify-pre-bootstrap-snapshot-before-marker-clear")
    fail2("RUNTIME_CONTRACT_INVALID", "bootstrap recovery must use the explicit interruption marker and verified rollback boundary.");
  const readBack = expectRecord2(bootstrap.read_back, "Runtime contract.bootstrap_project.read_back");
  expectExactKeys2(readBack, ["required"], "Runtime contract.bootstrap_project.read_back");
  expectSetEqual(expectStringArray2(readBack.required, "Runtime contract.bootstrap_project.read_back.required"), ["asset-checksums", "project-identity", "runtime-contract", "canonical-CURRENT_TASK", "host-isolation"], "bootstrap read-back evidence");
  return bound;
}
function validateVNextRuntimeContract(root, requireDependencies = false) {
  const filePath = path4.join(path4.resolve(root), ...VNEXT_RUNTIME_CONTRACT_RELATIVE_PATH.split("/"));
  const contract = parseYamlMappingFile(filePath);
  expectExactKeys2(contract, ["schema_version", "kind", "phase", "runtime_distribution", "proposal", "mutation_scope", "canonical_current_task", "concurrency", "operations", "unbound_operations", "bootstrap_project"], "vNext Runtime contract");
  if (contract.schema_version !== 1 || contract.kind !== "vnext-runtime-contract" || contract.phase !== "Phase 2") {
    fail2("RUNTIME_CONTRACT_INVALID", "Runtime contract must declare schema_version=1, kind=vnext-runtime-contract, phase=Phase 2.");
  }
  const runtimeDistribution = validateRuntimeDistributionContract(contract.runtime_distribution);
  const distributionIdentity = validateVNextRuntimeDistribution(root, runtimeDistribution, requireDependencies);
  const proposal = expectRecord2(contract.proposal, "Runtime contract.proposal");
  expectExactKeys2(proposal, ["schema_version", "kind", "caller", "operation_kinds", "source_tuple", "required_envelope", "finding_queue_admission", "finding_queue_repair", "task_state", "prepare_task", "inbox_record", "lifecycle", "close_task", "lesson_marker"], "Runtime contract.proposal");
  if (proposal.schema_version !== 1 || proposal.kind !== VNEXT_RUNTIME_PROPOSAL_KIND)
    fail2("RUNTIME_CONTRACT_INVALID", "Runtime proposal contract has an invalid envelope marker.");
  expectSetEqual(expectStringArray2(proposal.caller, "Runtime contract.proposal.caller"), ["execute-step", "prepare-task", "task-lifecycle", "capture-work-item", "close-task"], "Runtime contract proposal callers");
  expectSetEqual(expectStringArray2(proposal.operation_kinds, "Runtime contract.proposal.operation_kinds"), [...RUNTIME_OPERATION_KINDS], "Runtime contract operation kinds");
  expectSetEqual(expectStringArray2(proposal.source_tuple, "Runtime contract.proposal.source_tuple"), [...RUNTIME_SOURCE_TUPLE_FIELDS], "Runtime contract source tuple");
  expectSetEqual(expectStringArray2(proposal.required_envelope, "Runtime contract.proposal.required_envelope"), [...RUNTIME_REQUIRED_ENVELOPE_FIELDS], "Runtime contract proposal envelope");
  const findingQueueRepair = expectRecord2(proposal.finding_queue_repair, "Runtime contract.proposal.finding_queue_repair");
  expectExactKeys2(findingQueueRepair, ["required"], "Runtime contract.proposal.finding_queue_repair");
  expectSetEqual(expectStringArray2(findingQueueRepair.required, "Runtime contract.proposal.finding_queue_repair.required"), ["review_cycle_id", "repair_wave_id"], "Runtime contract finding-queue repair fields");
  const findingQueueAdmission = expectRecord2(proposal.finding_queue_admission, "Runtime contract.proposal.finding_queue_admission");
  expectExactKeys2(findingQueueAdmission, ["required"], "Runtime contract.proposal.finding_queue_admission");
  expectSetEqual(expectStringArray2(findingQueueAdmission.required, "Runtime contract.proposal.finding_queue_admission.required"), ["cycle_phase", "finding_admission_wave_id"], "Runtime contract finding-queue admission fields");
  const taskStateContract = expectRecord2(proposal.task_state, "Runtime contract.proposal.task_state");
  expectExactKeys2(taskStateContract, ["actions", "step_progress", "advancement_outcomes", "review_receipt", "draft", "confirm"], "Runtime contract.proposal.task_state");
  expectSetEqual(expectStringArray2(taskStateContract.actions, "Runtime contract.proposal.task_state.actions"), ["step-progress", "clear-resume-review-gate", ...DRAFT_TASK_STATE_ACTIONS, ...REPLAN_TASK_STATE_ACTIONS], "Runtime contract task-state actions");
  const stepProgressContract = expectRecord2(taskStateContract.step_progress, "Runtime contract.proposal.task_state.step_progress");
  expectExactKeys2(stepProgressContract, ["required", "optional"], "Runtime contract.proposal.task_state.step_progress");
  expectSetEqual(expectStringArray2(stepProgressContract.required, "Runtime contract.proposal.task_state.step_progress.required"), ["step_id", "status", "evidence_refs"], "Runtime contract task-state required fields");
  expectSetEqual(expectStringArray2(stepProgressContract.optional, "Runtime contract.proposal.task_state.step_progress.optional", true), ["note", "repair_fingerprint", "diff_target", "review_receipt"], "Runtime contract task-state optional fields");
  expectSetEqual(expectStringArray2(taskStateContract.advancement_outcomes, "Runtime contract.proposal.task_state.advancement_outcomes"), [...STEP_ADVANCEMENT_OUTCOMES], "Runtime contract task-state advancement outcomes");
  const reviewReceiptContract = expectRecord2(taskStateContract.review_receipt, "Runtime contract.proposal.task_state.review_receipt");
  expectExactKeys2(reviewReceiptContract, ["required", "verdict", "cycle_phase", "target_verification"], "Runtime contract.proposal.task_state.review_receipt");
  expectSetEqual(expectStringArray2(reviewReceiptContract.required, "Runtime contract.proposal.task_state.review_receipt.required"), ["cycle_id", "cycle_phase", "diff_target", "diff_target_verification", "verdict", "admitted_fingerprints", "evidence_refs"], "Runtime contract review receipt required fields");
  if (reviewReceiptContract.verdict !== "clean")
    fail2("RUNTIME_CONTRACT_INVALID", "Runtime contract review receipt verdict must remain clean.");
  expectSetEqual(expectStringArray2(reviewReceiptContract.cycle_phase, "Runtime contract.proposal.task_state.review_receipt.cycle_phase"), [...REVIEW_CYCLE_PHASES], "Runtime contract review receipt cycle phases");
  expectSetEqual(expectStringArray2(reviewReceiptContract.target_verification, "Runtime contract.proposal.task_state.review_receipt.target_verification"), [...REVIEW_TARGET_VERIFICATION_STATES], "Runtime contract review receipt target verification states");
  const draftContract = expectRecord2(taskStateContract.draft, "Runtime contract.proposal.task_state.draft");
  expectExactKeys2(draftContract, ["mode", "actions", "identity_required", "definition_required", "create_from", "update_from", "target", "previous_close_reconciliation", "step_admission", "preserves"], "Runtime contract.proposal.task_state.draft");
  if (draftContract.mode !== "default")
    fail2("RUNTIME_CONTRACT_INVALID", "Runtime contract task-state draft mode must remain default.");
  expectSetEqual(expectStringArray2(draftContract.actions, "Runtime contract.proposal.task_state.draft.actions"), ["create-draft", "update-draft"], "Runtime contract task-state draft actions");
  expectSetEqual(expectStringArray2(draftContract.identity_required, "Runtime contract.proposal.task_state.draft.identity_required"), ["task_id", "task_slug", "document_id", "task_title"], "Runtime contract task-state draft identity fields");
  expectSetEqual(expectStringArray2(draftContract.definition_required, "Runtime contract.proposal.task_state.draft.definition_required"), [...REPLAN_REPLACEMENT_FIELDS], "Runtime contract task-state draft definition fields");
  for (const [field, expected] of [["create_from", "closed + archived"], ["update_from", "draft + active"], ["target", "draft + active"]]) {
    if (draftContract[field] !== expected)
      fail2("RUNTIME_CONTRACT_INVALID", `Runtime contract task-state draft ${field} must be ${expected}.`);
  }
  const draftReconciliation = expectRecord2(draftContract.previous_close_reconciliation, "Runtime contract.proposal.task_state.draft.previous_close_reconciliation");
  expectExactKeys2(draftReconciliation, ["archive", "status", "admitted_lesson"], "Runtime contract.proposal.task_state.draft.previous_close_reconciliation");
  if (draftReconciliation.archive !== "required" || draftReconciliation.status !== "required" || draftReconciliation.admitted_lesson !== "required-or-durable-reuse-proof") {
    fail2("RUNTIME_CONTRACT_INVALID", "Runtime contract task-state draft previous_close_reconciliation requirements are invalid.");
  }
  const draftStepAdmission = expectRecord2(draftContract.step_admission, "Runtime contract.proposal.task_state.draft.step_admission");
  expectExactKeys2(draftStepAdmission, ["all_steps_metadata_complete", "active_step"], "Runtime contract.proposal.task_state.draft.step_admission");
  if (draftStepAdmission.all_steps_metadata_complete !== true || draftStepAdmission.active_step !== "first-admitted-step") {
    fail2("RUNTIME_CONTRACT_INVALID", "Runtime contract task-state draft step_admission requirements are invalid.");
  }
  expectSetEqual(expectStringArray2(draftContract.preserves, "Runtime contract.proposal.task_state.draft.preserves"), ["TASK_ID", "TASK_SLUG", "document_id on update", "execution_log", "applied_proposals", "canonical provenance"], "Runtime contract task-state draft preserved fields");
  const confirmContract = expectRecord2(taskStateContract.confirm, "Runtime contract.proposal.task_state.confirm");
  expectExactKeys2(confirmContract, ["mode", "action", "required", "authority", "authority_coordinates", "from", "to"], "Runtime contract.proposal.task_state.confirm");
  if (confirmContract.mode !== "confirm" || confirmContract.action !== "confirm-draft")
    fail2("RUNTIME_CONTRACT_INVALID", "Runtime contract task-state confirm must use confirm/confirm-draft.");
  expectSetEqual(expectStringArray2(confirmContract.required, "Runtime contract.proposal.task_state.confirm.required"), ["task_id", "task_slug", "document_id", "draft_revision", "evidence_refs"], "Runtime contract task-state confirm required fields");
  expectSetEqual(expectStringArray2(confirmContract.authority, "Runtime contract.proposal.task_state.confirm.authority"), ["user-confirmation", "authorized-caller"], "Runtime contract task-state confirm authority");
  const confirmCoords = expectRecord2(confirmContract.authority_coordinates, "Runtime contract.proposal.task_state.confirm.authority_coordinates");
  expectExactKeys2(confirmCoords, ["required", "exact_draft_revision"], "Runtime contract.proposal.task_state.confirm.authority_coordinates");
  expectSetEqual(expectStringArray2(confirmCoords.required, "Runtime contract.proposal.task_state.confirm.authority_coordinates.required"), ["task_id", "document_id", "draft_revision"], "Runtime contract task-state confirm authority coordinates");
  if (confirmCoords.exact_draft_revision !== true)
    fail2("RUNTIME_CONTRACT_INVALID", "Runtime contract task-state confirm authority_coordinates exact_draft_revision must be true.");
  if (confirmContract.from !== "draft + active" || confirmContract.to !== "active + active")
    fail2("RUNTIME_CONTRACT_INVALID", "Runtime contract task-state confirm transition is invalid.");
  const prepareTaskContract = expectRecord2(proposal.prepare_task, "Runtime contract.proposal.prepare_task");
  expectExactKeys2(prepareTaskContract, ["bound_actions", "draft_mode", "draft_actions", "confirm_mode", "confirm_actions", "replan_mode", "replan_actions"], "Runtime contract.proposal.prepare_task");
  expectSetEqual(expectStringArray2(prepareTaskContract.bound_actions, "Runtime contract.proposal.prepare_task.bound_actions"), ["clear-resume-review-gate", ...DRAFT_TASK_STATE_ACTIONS, ...REPLAN_TASK_STATE_ACTIONS], "Runtime contract prepare-task bound actions");
  if (prepareTaskContract.draft_mode !== "default" || prepareTaskContract.confirm_mode !== "confirm")
    fail2("RUNTIME_CONTRACT_INVALID", "Runtime contract prepare-task draft/confirm modes are invalid.");
  expectSetEqual(expectStringArray2(prepareTaskContract.draft_actions, "Runtime contract.proposal.prepare_task.draft_actions"), ["create-draft", "update-draft"], "Runtime contract prepare-task draft actions");
  expectSetEqual(expectStringArray2(prepareTaskContract.confirm_actions, "Runtime contract.proposal.prepare_task.confirm_actions"), ["confirm-draft"], "Runtime contract prepare-task confirm actions");
  if (prepareTaskContract.replan_mode !== "replan")
    fail2("RUNTIME_CONTRACT_INVALID", "Runtime contract prepare-task replan_mode must be replan.");
  expectSetEqual(expectStringArray2(prepareTaskContract.replan_actions, "Runtime contract.proposal.prepare_task.replan_actions"), [...REPLAN_TASK_STATE_ACTIONS], "Runtime contract prepare-task replan actions");
  const inboxRecordContract = expectRecord2(proposal.inbox_record, "Runtime contract.proposal.inbox_record");
  expectExactKeys2(inboxRecordContract, ["mode", "action", "required", "record_fields", "relation", "duplicate_check", "proposed_owner", "target_pattern", "provenance_fields"], "Runtime contract.proposal.inbox_record");
  if (inboxRecordContract.mode !== "default" || inboxRecordContract.action !== "record") {
    fail2("RUNTIME_CONTRACT_INVALID", "Runtime contract inbox_record must use mode=default and action=record.");
  }
  expectSetEqual(expectStringArray2(inboxRecordContract.required, "Runtime contract.proposal.inbox_record.required"), ["item_slug", "record", "relation_evidence_refs", "duplicate_check", "proposed_owner", "target_path", "evidence_refs"], "Runtime contract inbox record required fields");
  expectSetEqual(expectStringArray2(inboxRecordContract.record_fields, "Runtime contract.proposal.inbox_record.record_fields"), ["artifact_kind", "item_id", "title", "type", "source", "captured_at", "relation_to_current_task", "current_task_id", "description", "evidence", "suggested_next_action", "status"], "Runtime contract inbox record durable fields");
  if (inboxRecordContract.relation !== "unrelated" || inboxRecordContract.duplicate_check !== "clear") {
    fail2("RUNTIME_CONTRACT_INVALID", "Runtime contract inbox records must be proven unrelated and have duplicate_check=clear.");
  }
  expectSetEqual(expectStringArray2(inboxRecordContract.proposed_owner, "Runtime contract.proposal.inbox_record.proposed_owner"), [...INBOX_SUGGESTED_NEXT_ACTIONS], "Runtime contract inbox record owner routes");
  if (inboxRecordContract.target_pattern !== "TASKS/inbox/INBOX-<YYYYMMDD>-<short-id>-<slug>.md") {
    fail2("RUNTIME_CONTRACT_INVALID", "Runtime contract inbox record target pattern is invalid.");
  }
  expectSetEqual(expectStringArray2(inboxRecordContract.provenance_fields, "Runtime contract.proposal.inbox_record.provenance_fields"), ["idempotency_key", "proposal_digest", "source_revision", "source_task_id", "source_task_slug", "source_document_id", "relation_evidence_refs", "duplicate_check", "proposed_owner"], "Runtime contract inbox record provenance fields");
  const lifecycleContract = expectRecord2(proposal.lifecycle, "Runtime contract.proposal.lifecycle");
  expectExactKeys2(lifecycleContract, ["modes", "bound_modes", "proposal_only_modes", "pause_required", "interrupt_required", "resume_required", "supersede_required"], "Runtime contract.proposal.lifecycle");
  expectSetEqual(expectStringArray2(lifecycleContract.modes, "Runtime contract.proposal.lifecycle.modes"), [...LIFECYCLE_MODES], "Runtime contract lifecycle modes");
  expectSetEqual(expectStringArray2(lifecycleContract.bound_modes, "Runtime contract.proposal.lifecycle.bound_modes"), [...LIFECYCLE_MODES], "Runtime contract bound lifecycle modes");
  expectSetEqual(expectStringArray2(lifecycleContract.proposal_only_modes, "Runtime contract.proposal.lifecycle.proposal_only_modes", true), [], "Runtime contract proposal-only lifecycle modes");
  const lifecycleRequiredFields = {
    pause_required: ["lifecycle_state", "suspension_reason", "task_start_base", "last_reviewed_checkpoint", "current_diff_review_target", "rollback_conditions", "resume_review_reasons", "evidence_refs"],
    interrupt_required: ["lifecycle_state", "suspension_reason", "task_start_base", "last_reviewed_checkpoint", "current_diff_review_target", "rollback_conditions", "resume_review_reasons", "checkpoint_evidence", "dirty_attribution", "environment_state", "recovery_strategy", "evidence_refs"],
    resume_required: ["artifact_kind", "recovery_package_path", "recovery_package_revision", "resume_review_reasons", "evidence_refs"],
    supersede_required: ["invalidation_kind", "invalidation_reason", "evidence_refs", "partial_diff_disposition"]
  };
  for (const [field, expected] of Object.entries(lifecycleRequiredFields)) {
    const required = expectRecord2(lifecycleContract[field], `Runtime contract.proposal.lifecycle.${field}`);
    expectExactKeys2(required, ["required"], `Runtime contract.proposal.lifecycle.${field}`);
    expectSetEqual(expectStringArray2(required.required, `Runtime contract.proposal.lifecycle.${field}.required`), expected, `Runtime contract lifecycle ${field}`);
  }
  const closeTaskContract = expectRecord2(proposal.close_task, "Runtime contract.proposal.close_task");
  expectExactKeys2(closeTaskContract, ["default_mode", "preview_mode", "terminal_from", "terminal_to", "lesson_admission", "knowledge_admission"], "Runtime contract.proposal.close_task");
  if (closeTaskContract.default_mode !== "default" || closeTaskContract.preview_mode !== "preview") {
    fail2("RUNTIME_CONTRACT_INVALID", "Runtime contract close-task must reserve default closure and preview read-only semantics.");
  }
  expectSetEqual(expectStringArray2(closeTaskContract.terminal_from, "Runtime contract close-task terminal_from"), ["active + active"], "Runtime contract close-task terminal_from");
  expectSetEqual(expectStringArray2(closeTaskContract.terminal_to, "Runtime contract close-task terminal_to"), ["closed + archived"], "Runtime contract close-task terminal_to");
  expectSetEqual(expectStringArray2(closeTaskContract.lesson_admission, "Runtime contract close-task lesson_admission"), ["admit", "defer", "no-op"], "Runtime contract close-task lesson admission");
  const knowledgeAdmissionContract = expectRecord2(closeTaskContract.knowledge_admission, "Runtime contract.proposal.close_task.knowledge_admission");
  expectExactKeys2(knowledgeAdmissionContract, ["dispositions", "durable_dispositions", "candidate_fields", "implementation_anchors", "reentry_source"], "Runtime contract close-task knowledge_admission");
  expectSetEqual(expectStringArray2(knowledgeAdmissionContract.dispositions, "Runtime contract close-task knowledge dispositions"), ["admit", "defer", "merge", "no-op", "reject", "supersede"], "Runtime contract close-task knowledge dispositions");
  expectSetEqual(expectStringArray2(knowledgeAdmissionContract.durable_dispositions, "Runtime contract close-task durable knowledge dispositions"), ["admit", "merge", "supersede"], "Runtime contract close-task durable knowledge dispositions");
  expectSetEqual(expectStringArray2(knowledgeAdmissionContract.candidate_fields, "Runtime contract close-task knowledge candidate fields"), [...KNOWLEDGE_CANDIDATE_KEYS], "Runtime contract close-task knowledge candidate fields");
  const anchorContract = expectRecord2(knowledgeAdmissionContract.implementation_anchors, "Runtime contract close-task implementation_anchors");
  expectExactKeys2(anchorContract, ["coverage", "max_anchors", "line_number_locators", "missing_symbol_behavior"], "Runtime contract close-task implementation_anchors");
  expectSetEqual(expectStringArray2(anchorContract.coverage, "Runtime contract close-task implementation_anchors.coverage"), ["observed", "verified-scope"], "Runtime contract implementation anchor coverage");
  if (expectInteger(anchorContract.max_anchors, "Runtime contract close-task implementation_anchors.max_anchors", 0, 5) !== 5 || anchorContract.line_number_locators !== "forbidden" || anchorContract.missing_symbol_behavior !== "live-search-fallback") {
    fail2("RUNTIME_CONTRACT_INVALID", "Runtime implementation anchors must remain bounded hints with live-search fallback.");
  }
  if (knowledgeAdmissionContract.reentry_source !== "canonical-task-archive-admission")
    fail2("RUNTIME_CONTRACT_INVALID", "Runtime knowledge re-entry must use canonical task archive admission provenance.");
  const lessonMarkerContract = expectRecord2(proposal.lesson_marker, "Runtime contract.proposal.lesson_marker");
  expectExactKeys2(lessonMarkerContract, ["contract", "marker_version_field", "noncanonical_behavior", "persisted", "reused"], "Runtime contract.proposal.lesson_marker");
  if (lessonMarkerContract.contract !== "vnext-lesson-marker/canonical-v1" || lessonMarkerContract.marker_version_field !== "absent" || lessonMarkerContract.noncanonical_behavior !== "fail-closed") {
    fail2("RUNTIME_CONTRACT_INVALID", "Runtime contract lesson marker must expose the canonical closed schema.");
  }
  const persistedLessonMarker = expectRecord2(lessonMarkerContract.persisted, "Runtime contract.proposal.lesson_marker.persisted");
  expectExactKeys2(persistedLessonMarker, ["fields", "disposition"], "Runtime contract.proposal.lesson_marker.persisted");
  expectSetEqual(expectStringArray2(persistedLessonMarker.fields, "Runtime contract.proposal.lesson_marker.persisted.fields"), ["task_id", "task_slug", "document_id", "archive_path", "archive_revision", "source_revision", "candidate_ref", "candidate_digest", "evidence_refs"], "Runtime contract persisted Lesson marker fields");
  if (persistedLessonMarker.disposition !== "omitted")
    fail2("RUNTIME_CONTRACT_INVALID", "Runtime contract persisted Lesson markers must omit disposition.");
  const reusedLessonMarker = expectRecord2(lessonMarkerContract.reused, "Runtime contract.proposal.lesson_marker.reused");
  expectExactKeys2(reusedLessonMarker, ["fields", "disposition", "reused_candidate_fields"], "Runtime contract.proposal.lesson_marker.reused");
  expectSetEqual(expectStringArray2(reusedLessonMarker.fields, "Runtime contract.proposal.lesson_marker.reused.fields"), ["task_id", "task_slug", "document_id", "archive_path", "archive_revision", "source_revision", "candidate_ref", "candidate_digest", "evidence_refs", "disposition", "reused_candidate"], "Runtime contract reused Lesson marker fields");
  if (reusedLessonMarker.disposition !== "reused")
    fail2("RUNTIME_CONTRACT_INVALID", "Runtime contract reused Lesson markers must use disposition=reused.");
  expectSetEqual(expectStringArray2(reusedLessonMarker.reused_candidate_fields, "Runtime contract.proposal.lesson_marker.reused.reused_candidate_fields"), ["task_id", "document_id", "archive_revision", "candidate_ref"], "Runtime contract reused Lesson candidate identity fields");
  const mutationScopeContract = expectRecord2(contract.mutation_scope, "Runtime contract.mutation_scope");
  expectExactKeys2(mutationScopeContract, ["status", "binding", "source", "buckets", "default_write_policy", "read_discovery_is_not_write_authority", "ordinary_write_scope", "broad_glob_requires", "conditional_expansion_requires", "changed_goal_scope_acceptance", "check_command", "input", "output"], "Runtime contract.mutation_scope");
  if (mutationScopeContract.status !== "bound" || mutationScopeContract.binding !== "vnext-runtime-read-only" || mutationScopeContract.source !== "CURRENT_TASK.md" || mutationScopeContract.default_write_policy !== "deny" || mutationScopeContract.read_discovery_is_not_write_authority !== true || mutationScopeContract.ordinary_write_scope !== "exact-file-or-file-plus-symbol" || mutationScopeContract.broad_glob_requires !== "inherently-broad-transformation" || mutationScopeContract.conditional_expansion_requires !== "evidence-and-authority" || mutationScopeContract.changed_goal_scope_acceptance !== "supersede-or-replan" || mutationScopeContract.check_command !== "scope-check") {
    fail2("RUNTIME_CONTRACT_INVALID", "Runtime mutation scope contract must keep the frozen default-deny and read/write separation semantics.");
  }
  expectSetEqual(expectStringArray2(mutationScopeContract.buckets, "Runtime contract.mutation_scope.buckets"), ["Allowed Files", "Conditional Files", "Forbidden Files"], "Runtime mutation scope buckets");
  const mutationScopeInput = expectRecord2(mutationScopeContract.input, "Runtime contract.mutation_scope.input");
  expectExactKeys2(mutationScopeInput, ["required"], "Runtime contract.mutation_scope.input");
  expectSetEqual(expectStringArray2(mutationScopeInput.required, "Runtime contract.mutation_scope.input.required"), ["explicit_changed_paths", "conditional_authorizations_with_evidence_and_authority", "transformation_kind"], "Runtime mutation scope input");
  const mutationScopeOutput = expectRecord2(mutationScopeContract.output, "Runtime contract.mutation_scope.output");
  expectExactKeys2(mutationScopeOutput, ["required"], "Runtime contract.mutation_scope.output");
  expectSetEqual(expectStringArray2(mutationScopeOutput.required, "Runtime contract.mutation_scope.output.required"), ["per-path-admission-and-blocker", "separate-read-discovery-match", "source-revision"], "Runtime mutation scope output");
  const canonical = expectRecord2(contract.canonical_current_task, "Runtime contract.canonical_current_task");
  expectExactKeys2(canonical, ["frontmatter", "runtime_state", "source_of_truth", "legacy_schema_behavior"], "Runtime contract.canonical_current_task");
  const frontmatter = expectRecord2(canonical.frontmatter, "Runtime contract.canonical_current_task.frontmatter");
  expectExactKeys2(frontmatter, ["schema_version", "kind", "required"], "Runtime contract.canonical_current_task.frontmatter");
  if (frontmatter.schema_version !== 1 || frontmatter.kind !== VNEXT_CURRENT_TASK_KIND)
    fail2("RUNTIME_CONTRACT_INVALID", "Runtime contract current-task frontmatter marker is invalid.");
  expectSetEqual(expectStringArray2(frontmatter.required, "Runtime contract.canonical_current_task.frontmatter.required"), ["document_id", "runtime_state"], "Runtime contract current-task frontmatter");
  const runtimeState = expectRecord2(canonical.runtime_state, "Runtime contract.canonical_current_task.runtime_state");
  expectExactKeys2(runtimeState, ["schema_version", "kind", "fields", "review_cycle"], "Runtime contract.canonical_current_task.runtime_state");
  if (runtimeState.schema_version !== 1 || runtimeState.kind !== VNEXT_RUNTIME_STATE_KIND)
    fail2("RUNTIME_CONTRACT_INVALID", "Runtime contract runtime-state marker is invalid.");
  expectSetEqual(expectStringArray2(runtimeState.fields, "Runtime contract.canonical_current_task.runtime_state.fields"), [...RUNTIME_STATE_FIELDS], "Runtime contract runtime-state fields");
  const reviewCycleContract = expectRecord2(runtimeState.review_cycle, "Runtime contract.canonical_current_task.runtime_state.review_cycle");
  expectExactKeys2(reviewCycleContract, ["fields", "repair_round_max", "same_repair_wave_counts_once", "verification_new_finding_wave_max"], "Runtime contract.canonical_current_task.runtime_state.review_cycle");
  expectSetEqual(expectStringArray2(reviewCycleContract.fields, "Runtime contract.canonical_current_task.runtime_state.review_cycle.fields"), [...REVIEW_CYCLE_FIELDS], "Runtime contract review-cycle fields");
  if (expectInteger(reviewCycleContract.repair_round_max, "Runtime contract review-cycle repair_round_max", 0, MAX_REPAIR_ROUNDS) !== MAX_REPAIR_ROUNDS) {
    fail2("RUNTIME_CONTRACT_INVALID", "Runtime contract review-cycle repair_round_max must be 3.");
  }
  if (expectBoolean(reviewCycleContract.same_repair_wave_counts_once, "Runtime contract review-cycle same_repair_wave_counts_once") !== true) {
    fail2("RUNTIME_CONTRACT_INVALID", "Runtime contract must count each repair wave once per review cycle.");
  }
  if (expectInteger(reviewCycleContract.verification_new_finding_wave_max, "Runtime contract review-cycle verification_new_finding_wave_max", 0, 1) !== 1) {
    fail2("RUNTIME_CONTRACT_INVALID", "Runtime contract must allow at most one verification new-finding admission wave per review cycle.");
  }
  if (canonical.source_of_truth !== "same-canonical-CURRENT_TASK-document" || canonical.legacy_schema_behavior !== "migration-required")
    fail2("RUNTIME_CONTRACT_INVALID", "Runtime contract must keep CURRENT_TASK as the only state source and stop on legacy schema.");
  const concurrency = expectRecord2(contract.concurrency, "Runtime contract.concurrency");
  expectExactKeys2(concurrency, ["model", "concurrent_state_changing_writers", "stale_detection"], "Runtime contract.concurrency");
  if (concurrency.model !== "single-authorized-writer" || concurrency.concurrent_state_changing_writers !== "forbidden" || concurrency.stale_detection !== "source-revision-and-explicit-recovery-package-revision") {
    fail2("RUNTIME_CONTRACT_INVALID", "Runtime contract must require a single authorized state-changing writer plus explicit recovery package revision stale detection.");
  }
  const operations = contract.operations;
  if (!Array.isArray(operations) || operations.length !== RUNTIME_OPERATION_KINDS.length)
    fail2("RUNTIME_CONTRACT_INVALID", `Runtime contract must declare exactly the ${RUNTIME_OPERATION_KINDS.length} Phase 2 bound operations.`);
  const bound = [];
  for (const [index, rawOperation] of operations.entries()) {
    const operation = expectRecord2(rawOperation, `Runtime contract.operations[${index}]`);
    expectExactKeys2(operation, ["id", "status", "binding", "operation", "source_targets", "write_targets", "allowed_callers", "result_states", "atomic", "idempotence", "conflict_policy"], `Runtime contract.operations[${index}]`);
    const id = expectEnum(operation.id, RUNTIME_OPERATION_KINDS, `Runtime contract.operations[${index}].id`);
    if (bound.includes(id))
      fail2("RUNTIME_CONTRACT_INVALID", `Runtime contract operation ${id} is duplicated.`);
    bound.push(id);
    if (operation.status !== "bound" || operation.binding !== "vnext-runtime")
      fail2("RUNTIME_CONTRACT_INVALID", `Runtime contract operation ${id} must be bound to vnext-runtime.`);
    if (operation.operation !== id)
      fail2("RUNTIME_CONTRACT_INVALID", `Runtime contract operation ${id} must identify its logical operation.`);
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
      "inbox-record-transaction": {
        source: ["CURRENT_TASK.md", "TASKS/inbox/**"],
        writes: ["TASKS/inbox/**"],
        callers: ["capture-work-item"]
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
      },
      "contract-candidate-commit": {
        source: ["CURRENT_TASK.md", "TASKS/TASK-<TASK_ID>-<TASK_SLUG>.md", "CONTRACTS.md"],
        writes: ["CONTRACTS.md"],
        callers: ["close-task"]
      },
      "decision-record-transaction": {
        source: ["CURRENT_TASK.md", "TASKS/TASK-<TASK_ID>-<TASK_SLUG>.md", "DECISIONS.md"],
        writes: ["DECISIONS.md"],
        callers: ["close-task"]
      }
    };
    const expectedTargets = operationContract[id];
    expectSetEqual(expectStringArray2(operation.source_targets, `Runtime contract.operations[${index}].source_targets`), expectedTargets.source, `Runtime contract operation ${id}.source_targets`);
    expectSetEqual(expectStringArray2(operation.write_targets, `Runtime contract.operations[${index}].write_targets`), expectedTargets.writes, `Runtime contract operation ${id}.write_targets`);
    expectSetEqual(expectStringArray2(operation.allowed_callers, `Runtime contract.operations[${index}].allowed_callers`), expectedTargets.callers, `Runtime contract operation ${id}.allowed_callers`);
    expectSetEqual(expectStringArray2(operation.result_states, `Runtime contract.operations[${index}].result_states`), [...RUNTIME_RESULT_STATES], `Runtime contract operation ${id}.result_states`);
    if (operation.atomic !== true || operation.idempotence !== "fail-closed" || operation.conflict_policy !== "fail-closed")
      fail2("RUNTIME_CONTRACT_INVALID", `Runtime contract operation ${id} must be atomic, fail-closed, and conflict-safe.`);
  }
  expectSetEqual(bound, [...RUNTIME_OPERATION_KINDS], "Runtime contract bound operations");
  const unbound = expectStringArray2(contract.unbound_operations, "Runtime contract.unbound_operations", true);
  expectSetEqual(unbound, [], "Runtime contract unbound operations");
  const bootstrapOperations = validateBootstrapRuntimeContract(contract.bootstrap_project);
  return {
    phase: "Phase 2",
    runtime_distribution: distributionIdentity,
    mutation_scope: { status: "bound", binding: "vnext-runtime-read-only", check_command: "scope-check" },
    bound_operations: bound,
    unbound_operations: unbound,
    bootstrap_operations: bootstrapOperations
  };
}
function validateAuthorityEvidence2(value) {
  if (!Array.isArray(value) || value.length === 0)
    fail2("RUNTIME_AUTHORITY_MISSING", "authority_evidence must be non-empty.");
  const result = [];
  for (const [index, raw] of value.entries()) {
    const record = expectRecord2(raw, `authority_evidence[${index}]`);
    const kind = expectEnum(record.kind, ["active-task-owner", "scope-admission", "finding-admission", "evidence-admission", "dangerous-operation", "resume-review", "user-confirmation", "authorized-caller"], `authority_evidence[${index}].kind`);
    const source = normalizeRepoPath2(expectString2(record.source, `authority_evidence[${index}].source`), `authority_evidence[${index}].source`);
    const hasConfirmationBinding = "task_id" in record || "document_id" in record || "draft_revision" in record;
    if (hasConfirmationBinding) {
      const expectedKeys = "subject" in record ? ["kind", "source", "subject", "task_id", "document_id", "draft_revision"] : ["kind", "source", "task_id", "document_id", "draft_revision"];
      expectExactKeys2(record, expectedKeys, `authority_evidence[${index}]`);
      const taskId = expectString2(record.task_id, `authority_evidence[${index}].task_id`);
      try {
        validateTaskId(taskId);
      } catch (error) {
        fail2("RUNTIME_SCHEMA_INVALID", error instanceof Error ? error.message : String(error));
      }
      const documentId = expectString2(record.document_id, `authority_evidence[${index}].document_id`);
      if (!DOCUMENT_ID_PATTERN.test(documentId))
        fail2("RUNTIME_SCHEMA_INVALID", `authority_evidence[${index}].document_id is invalid.`);
      const draftRevision = expectString2(record.draft_revision, `authority_evidence[${index}].draft_revision`);
      if (!/^[a-f0-9]{64}$/.test(draftRevision))
        fail2("RUNTIME_SCHEMA_INVALID", `authority_evidence[${index}].draft_revision must be SHA-256.`);
      result.push({
        kind,
        source,
        subject: "subject" in record ? expectText(record.subject, `authority_evidence[${index}].subject`, 256) : taskId,
        task_id: taskId,
        document_id: documentId,
        draft_revision: draftRevision
      });
    } else {
      expectExactKeys2(record, ["kind", "source", "subject"], `authority_evidence[${index}]`);
      result.push({
        kind,
        source,
        subject: expectText(record.subject, `authority_evidence[${index}].subject`, 256)
      });
    }
  }
  return result;
}
function validateSourceTuple(value) {
  const record = expectRecord2(value, "source_tuple");
  expectExactKeys2(record, ["path", "revision", "document_id", "task_id", "task_slug", "workflow_status", "lifecycle_state", "active_step_id", "active_step_status", "finding_queue_revision", "resume_requires_review", "resume_review_reasons"], "source_tuple");
  const taskId = expectString2(record.task_id, "source_tuple.task_id");
  const taskSlug = expectString2(record.task_slug, "source_tuple.task_slug");
  try {
    validateTaskId(taskId);
    validateTaskSlug(taskSlug);
  } catch (error) {
    fail2("RUNTIME_SCHEMA_INVALID", error instanceof Error ? error.message : String(error));
  }
  const documentId = expectString2(record.document_id, "source_tuple.document_id");
  if (!DOCUMENT_ID_PATTERN.test(documentId))
    fail2("RUNTIME_SCHEMA_INVALID", "source_tuple.document_id is invalid.");
  const revision = expectString2(record.revision, "source_tuple.revision");
  if (!/^[a-f0-9]{64}$/.test(revision))
    fail2("RUNTIME_SCHEMA_INVALID", "source_tuple.revision must be SHA-256.");
  const workflowStatus = expectEnum(record.workflow_status, CURRENT_TASK_WORKFLOW_STATUSES, "source_tuple.workflow_status");
  const lifecycleState = expectEnum(record.lifecycle_state, TASK_LIFECYCLE_STATES, "source_tuple.lifecycle_state");
  try {
    validateCurrentTaskStatusTuple(workflowStatus, lifecycleState);
  } catch (error) {
    fail2("RUNTIME_STATE_CONFLICT", error instanceof Error ? error.message : String(error));
  }
  const resumeRequiresReview = expectBoolean(record.resume_requires_review, "source_tuple.resume_requires_review");
  const rawResumeReasons = expectStringArray2(record.resume_review_reasons, "source_tuple.resume_review_reasons", true, RESUME_REVIEW_REASON_ORDER.length);
  const resumeReviewReasons = normalizeResumeReviewReasons(rawResumeReasons);
  if (rawResumeReasons.join("|") !== resumeReviewReasons.join("|")) {
    fail2("RUNTIME_SCHEMA_INVALID", "source_tuple.resume_review_reasons must use the canonical closed-set order.");
  }
  try {
    validateCurrentTaskResumeGate(lifecycleState, resumeRequiresReview, resumeReviewReasons);
  } catch (error) {
    fail2("RUNTIME_STATE_CONFLICT", error instanceof Error ? error.message : String(error));
  }
  if (workflowStatus === "suspended" && !resumeRequiresReview) {
    fail2("RUNTIME_STATE_CONFLICT", "suspended CURRENT_TASK state must remain behind a non-empty resume review gate.");
  }
  return {
    path: normalizeRepoPath2(expectString2(record.path, "source_tuple.path"), "source_tuple.path"),
    revision,
    document_id: documentId,
    task_id: taskId,
    task_slug: taskSlug,
    workflow_status: workflowStatus,
    lifecycle_state: lifecycleState,
    active_step_id: expectString2(record.active_step_id, "source_tuple.active_step_id", STEP_ID_PATTERN2),
    active_step_status: expectEnum(record.active_step_status, STEP_STATUSES, "source_tuple.active_step_status"),
    finding_queue_revision: expectInteger(record.finding_queue_revision, "source_tuple.finding_queue_revision"),
    resume_requires_review: resumeRequiresReview,
    resume_review_reasons: resumeReviewReasons
  };
}
function validateEvidenceRefs(value, location) {
  return expectStringArray2(value, location, false, MAX_EVIDENCE_REFS);
}
function validateStepReviewReceipt(value, location) {
  const record = expectRecord2(value, location);
  expectExactKeys2(record, [
    "cycle_id",
    "cycle_phase",
    "diff_target",
    "diff_target_verification",
    "verdict",
    "admitted_fingerprints",
    "evidence_refs"
  ], location);
  const cyclePhase = expectEnum(record.cycle_phase, REVIEW_CYCLE_PHASES, `${location}.cycle_phase`);
  const admittedFingerprints = expectStringArray2(record.admitted_fingerprints, `${location}.admitted_fingerprints`, true, MAX_FINDINGS).map((fingerprint, index) => {
    if (!FINGERPRINT_PATTERN.test(fingerprint))
      fail2("RUNTIME_SCHEMA_INVALID", `${location}.admitted_fingerprints[${index}] has an invalid fingerprint.`);
    return fingerprint;
  });
  if (cyclePhase === "discovery" && admittedFingerprints.length > 0) {
    fail2("RUNTIME_SCHEMA_INVALID", `${location}.discovery receipts must not carry admitted fingerprints.`);
  }
  return {
    cycle_id: expectString2(record.cycle_id, `${location}.cycle_id`, SAFE_KEY_PATTERN2),
    cycle_phase: cyclePhase,
    diff_target: expectText(record.diff_target, `${location}.diff_target`, 512),
    diff_target_verification: expectEnum(record.diff_target_verification, REVIEW_TARGET_VERIFICATION_STATES, `${location}.diff_target_verification`),
    verdict: expectEnum(record.verdict, ["clean"], `${location}.verdict`),
    admitted_fingerprints: admittedFingerprints,
    evidence_refs: validateEvidenceRefs(record.evidence_refs, `${location}.evidence_refs`)
  };
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
    fail2("RUNTIME_SCHEMA_INVALID", `${location} must contain section content, not an arbitrary top-level Markdown heading.`);
  }
  return normalized;
}
function validatePartialDiffDisposition(value, location) {
  const record = expectRecord2(value, location);
  expectExactKeys2(record, ["reusable", "rollback_required", "stop_propagation"], location);
  return {
    reusable: expectStringArray2(record.reusable, `${location}.reusable`, true, MAX_EVIDENCE_REFS),
    rollback_required: expectStringArray2(record.rollback_required, `${location}.rollback_required`, true, MAX_EVIDENCE_REFS),
    stop_propagation: expectStringArray2(record.stop_propagation, `${location}.stop_propagation`, true, MAX_EVIDENCE_REFS)
  };
}
function validateReplanReplacementDefinition(value, location) {
  const record = expectRecord2(value, location);
  expectExactKeys2(record, REPLAN_REPLACEMENT_FIELDS, location);
  const result = {};
  for (const field of REPLAN_REPLACEMENT_FIELDS) {
    const raw = record[field];
    if (raw === null && ["design_constraints", "post_release_validation", "propagation_governance"].includes(field)) {
      result[field] = null;
      continue;
    }
    if (raw === null)
      fail2("RUNTIME_SCHEMA_INVALID", `${location}.${field} may be null only for optional sections.`);
    result[field] = normalizeReplacementSectionContent(expectText(raw, `${location}.${field}`, MAX_REPLAN_SECTION_CONTENT_LENGTH), `${location}.${field}`);
  }
  return result;
}
function validateDraftTaskIdentityFields(record, location, requireTitle = true) {
  const taskId = expectString2(record.task_id, `${location}.task_id`);
  const taskSlug = expectString2(record.task_slug, `${location}.task_slug`);
  try {
    validateTaskId(taskId);
    validateTaskSlug(taskSlug);
  } catch (error) {
    fail2("RUNTIME_SCHEMA_INVALID", error instanceof Error ? error.message : String(error));
  }
  const documentId = expectString2(record.document_id, `${location}.document_id`);
  if (!DOCUMENT_ID_PATTERN.test(documentId))
    fail2("RUNTIME_SCHEMA_INVALID", `${location}.document_id is invalid.`);
  if (!requireTitle)
    return { task_id: taskId, task_slug: taskSlug, document_id: documentId };
  const taskTitle = expectText(record.task_title, `${location}.task_title`, 512);
  if (/[\r\n]/u.test(taskTitle))
    fail2("RUNTIME_IDENTITY_INVALID", `${location}.task_title must be a single line.`);
  if (/^\{\{[^{}]+\}\}$/.test(taskTitle))
    fail2("RUNTIME_IDENTITY_INVALID", `${location}.task_title must be concrete, not a placeholder.`);
  return { task_id: taskId, task_slug: taskSlug, document_id: documentId, task_title: taskTitle };
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
    fail2("RUNTIME_SECTION_INVALID", "replacement implementation_steps must contain at least one labelled step ID.");
  }
  if (new Set(stepIds).size !== stepIds.length) {
    fail2("RUNTIME_SECTION_INVALID", "replacement implementation_steps contains duplicate step IDs.");
  }
  if (!stepIds.includes(activeStepId)) {
    fail2("RUNTIME_SECTION_INVALID", `active_step_id ${activeStepId} does not identify a step in replacement implementation_steps.`);
  }
}
function assertStrictDraftImplementationSteps(activeStepId, implementationSteps) {
  let steps;
  try {
    steps = parseImplementationSteps(implementationSteps);
  } catch (error) {
    if (error instanceof TaskStepDefinitionError)
      fail2(error.code, error.message);
    throw error;
  }
  if (steps.length === 0) {
    fail2("TASK_STEPS_INVALID", "draft implementation_steps must contain at least one step.");
  }
  for (const step of steps) {
    if (!step.metadata_complete) {
      fail2("TASK_STEPS_INVALID", `step ${step.id} has incomplete step metadata; every step in a draft must declare purpose, mutation scope, required evidence, and review checkpoint (with boundary when required).`);
    }
  }
  const firstStep = steps[0];
  if (activeStepId !== firstStep.id) {
    fail2("TASK_STEPS_INVALID", `draft active_step_id must be the first admitted implementation step ${firstStep.id}, got ${activeStepId}.`);
  }
  return steps;
}
function resolveTaskStepForState(body, activeStepId) {
  try {
    const resolution = resolveTaskStep(body, activeStepId);
    if (resolution.steps.length > 1 && resolution.steps.some((step) => !step.metadata_complete)) {
      fail2("TASK_STEPS_INVALID", "every multi-step task step must declare purpose, mutation scope, required evidence, and review checkpoint metadata.");
    }
    return resolution;
  } catch (error) {
    if (error instanceof TaskStepDefinitionError)
      fail2(error.code, error.message);
    throw error;
  }
}
function resolveCanonicalTaskStep(current) {
  return resolveTaskStepForState(current.body, current.runtimeState.active_step_id);
}
function effectiveCheckpointPolicy(resolution) {
  if (resolution.steps.length === 1 && !resolution.current.metadata_complete)
    return "not-required";
  if (!resolution.current.metadata_complete || resolution.current.review_checkpoint === null) {
    fail2("TASK_STEPS_INVALID", `step ${resolution.current.id} has incomplete checkpoint metadata.`);
  }
  return resolution.current.review_checkpoint;
}
function validateTaskStateDelta(value) {
  const record = expectRecord2(value, "semantic_delta");
  const kind = expectEnum(record.kind, ["task-state"], "semantic_delta.kind");
  const action = expectEnum(record.action, ["step-progress", "clear-resume-review-gate", ...DRAFT_TASK_STATE_ACTIONS, ...REPLAN_TASK_STATE_ACTIONS], "semantic_delta.action");
  if (action === "create-draft" || action === "update-draft") {
    expectExactKeys2(record, ["kind", "action", "task_id", "task_slug", "document_id", "task_title", "draft_definition", "active_step_id", "evidence_refs"], "semantic_delta");
    const identity = validateDraftTaskIdentityFields(record, "semantic_delta", true);
    return {
      kind,
      action,
      ...identity,
      draft_definition: validateReplanReplacementDefinition(record.draft_definition, "semantic_delta.draft_definition"),
      active_step_id: expectString2(record.active_step_id, "semantic_delta.active_step_id", STEP_ID_PATTERN2),
      evidence_refs: validateEvidenceRefs(record.evidence_refs, "semantic_delta.evidence_refs")
    };
  }
  if (action === "confirm-draft") {
    expectExactKeys2(record, ["kind", "action", "task_id", "task_slug", "document_id", "draft_revision", "evidence_refs"], "semantic_delta");
    const identity = validateDraftTaskIdentityFields(record, "semantic_delta", false);
    const draftRevision = expectString2(record.draft_revision, "semantic_delta.draft_revision");
    if (!/^[a-f0-9]{64}$/.test(draftRevision))
      fail2("RUNTIME_SCHEMA_INVALID", "semantic_delta.draft_revision must be SHA-256.");
    return {
      kind,
      action,
      ...identity,
      draft_revision: draftRevision,
      evidence_refs: validateEvidenceRefs(record.evidence_refs, "semantic_delta.evidence_refs")
    };
  }
  if (action === "clear-resume-review-gate") {
    expectExactKeys2(record, ["kind", "action", "evidence_refs"], "semantic_delta");
    return {
      kind,
      action: "clear-resume-review-gate",
      evidence_refs: validateEvidenceRefs(record.evidence_refs, "semantic_delta.evidence_refs")
    };
  }
  if (action === "mark-replan-blocked" || action === "clear-replan-block") {
    expectExactKeys2(record, ["kind", "action", "evidence_refs"], "semantic_delta");
    return {
      kind,
      action,
      evidence_refs: validateEvidenceRefs(record.evidence_refs, "semantic_delta.evidence_refs")
    };
  }
  if (action === "commit-replan") {
    expectExactKeys2(record, ["kind", "action", "replacement_definition", "active_step_id", "evidence_refs"], "semantic_delta");
    return {
      kind,
      action,
      replacement_definition: validateReplanReplacementDefinition(record.replacement_definition, "semantic_delta.replacement_definition"),
      active_step_id: expectString2(record.active_step_id, "semantic_delta.active_step_id", STEP_ID_PATTERN2),
      evidence_refs: validateEvidenceRefs(record.evidence_refs, "semantic_delta.evidence_refs")
    };
  }
  const keys = Object.keys(record);
  if (keys.some((key) => !["kind", "action", "step_id", "status", "evidence_refs", "note", "repair_fingerprint", "diff_target", "review_receipt"].includes(key))) {
    fail2("RUNTIME_SCHEMA_INVALID", "task-state semantic_delta contains unsupported fields.");
  }
  const result = {
    kind,
    action: "step-progress",
    step_id: expectString2(record.step_id, "semantic_delta.step_id", STEP_ID_PATTERN2),
    status: expectEnum(record.status, STEP_STATUSES, "semantic_delta.status"),
    evidence_refs: validateEvidenceRefs(record.evidence_refs, "semantic_delta.evidence_refs")
  };
  if (record.note !== undefined)
    result.note = expectText(record.note, "semantic_delta.note");
  if (record.repair_fingerprint !== undefined)
    result.repair_fingerprint = expectString2(record.repair_fingerprint, "semantic_delta.repair_fingerprint", FINGERPRINT_PATTERN);
  if (record.diff_target !== undefined)
    result.diff_target = expectText(record.diff_target, "semantic_delta.diff_target", 512);
  if (record.review_receipt !== undefined)
    result.review_receipt = validateStepReviewReceipt(record.review_receipt, "semantic_delta.review_receipt");
  return result;
}
function validateLifecycleReasons(value, location) {
  const raw = expectStringArray2(value, location, false, RESUME_REVIEW_REASON_ORDER.length);
  const normalized = normalizeResumeReviewReasons(raw);
  if (normalized.length !== raw.length || !normalized.every((reason, index) => reason === raw[index])) {
    fail2("RUNTIME_SCHEMA_INVALID", `${location} must use the canonical closed-set order without duplicates.`);
  }
  return normalized;
}
function validateLifecycleDelta(value) {
  const record = expectRecord2(value, "semantic_delta");
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
      fail2("RUNTIME_SCHEMA_INVALID", "pause lifecycle semantic_delta contains unsupported fields.");
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
      fail2("RUNTIME_LIFECYCLE_EVIDENCE_INVALID", error instanceof Error ? error.message : String(error));
    }
    if (lifecycleState === "paused_blocked") {
      return {
        ...common,
        lifecycle_state: lifecycleState,
        blocker_status: expectText(record.blocker_status, "semantic_delta.blocker_status"),
        blocking_evidence: expectText(record.blocking_evidence, "semantic_delta.blocking_evidence"),
        remaining_acceptance: expectText(record.remaining_acceptance, "semantic_delta.remaining_acceptance"),
        ...record.failed_checks === undefined ? {} : { failed_checks: expectStringArray2(record.failed_checks, "semantic_delta.failed_checks", false, 32) }
      };
    }
    const forbiddenFields = ["blocker_status", "blocking_evidence", "remaining_acceptance", "failed_checks"];
    if (forbiddenFields.some((field) => record[field] !== undefined))
      fail2("RUNTIME_SCHEMA_INVALID", "paused_pending_closure must not carry paused_blocked-only evidence.");
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
      fail2("RUNTIME_SCHEMA_INVALID", "interrupt lifecycle semantic_delta contains unsupported fields.");
    const lifecycleState = expectEnum(record.lifecycle_state, ["interrupted"], "semantic_delta.lifecycle_state");
    const resumeReviewReasons = validateLifecycleReasons(record.resume_review_reasons, "semantic_delta.resume_review_reasons");
    try {
      validateCurrentTaskResumeGate(lifecycleState, true, resumeReviewReasons);
    } catch (error) {
      fail2("RUNTIME_LIFECYCLE_EVIDENCE_INVALID", error instanceof Error ? error.message : String(error));
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
    expectExactKeys2(record, ["kind", "action", "artifact_kind", "recovery_package_path", "recovery_package_revision", "resume_review_reasons", "evidence_refs"], "semantic_delta");
    const artifactKind = expectEnum(record.artifact_kind, ["paused", "interrupted"], "semantic_delta.artifact_kind");
    if (action === "resume-paused" && artifactKind !== "paused" || action === "resume-interrupted" && artifactKind !== "interrupted") {
      fail2("RUNTIME_LIFECYCLE_EVIDENCE_INVALID", `${action} must target the matching ${action === "resume-paused" ? "paused" : "interrupted"} artifact kind.`);
    }
    const recoveryPackageRevision = expectString2(record.recovery_package_revision, "semantic_delta.recovery_package_revision");
    if (!/^[a-f0-9]{64}$/.test(recoveryPackageRevision))
      fail2("RUNTIME_SCHEMA_INVALID", "semantic_delta.recovery_package_revision must be SHA-256.");
    return {
      kind,
      action,
      artifact_kind: artifactKind,
      recovery_package_path: normalizeRepoPath2(expectString2(record.recovery_package_path, "semantic_delta.recovery_package_path"), "semantic_delta.recovery_package_path"),
      recovery_package_revision: recoveryPackageRevision,
      resume_review_reasons: validateLifecycleReasons(record.resume_review_reasons, "semantic_delta.resume_review_reasons"),
      evidence_refs: validateEvidenceRefs(record.evidence_refs, "semantic_delta.evidence_refs")
    };
  }
  expectExactKeys2(record, ["kind", "action", "invalidation_kind", "invalidation_reason", "evidence_refs", "partial_diff_disposition"], "semantic_delta");
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
  const record = expectRecord2(value, location);
  expectExactKeys2(record, ["kind", "action", "cycle_phase", "finding_admission_wave_id", "finding"], location);
  expectEnum(record.kind, ["finding-queue"], `${location}.kind`);
  expectEnum(record.action, ["admit"], `${location}.action`);
  const finding = expectRecord2(record.finding, `${location}.finding`);
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
    fail2("RUNTIME_SCHEMA_INVALID", `${location}.finding contains unsupported fields.`);
  const result = {
    kind: "finding-queue",
    action: "admit",
    cycle_phase: expectEnum(record.cycle_phase, REVIEW_CYCLE_PHASES, `${location}.cycle_phase`),
    finding_admission_wave_id: expectString2(record.finding_admission_wave_id, `${location}.finding_admission_wave_id`, SAFE_KEY_PATTERN2),
    finding: {
      fingerprint: expectString2(finding.fingerprint, `${location}.finding.fingerprint`, FINGERPRINT_PATTERN),
      category: expectText(finding.category, `${location}.finding.category`, 256),
      owner_task_id: expectString2(finding.owner_task_id, `${location}.finding.owner_task_id`),
      scope: expectEnum(finding.scope, ["admitted"], `${location}.finding.scope`),
      decision: expectEnum(finding.decision, ["mechanical"], `${location}.finding.decision`),
      file: normalizeRepoPath2(expectString2(finding.file, `${location}.finding.file`), `${location}.finding.file`),
      failure_condition: expectText(finding.failure_condition, `${location}.finding.failure_condition`),
      violated_invariant: expectText(finding.violated_invariant, `${location}.finding.violated_invariant`, 512),
      root_cause_status: expectEnum(finding.root_cause_status, ["confirmed", "bounded"], `${location}.finding.root_cause_status`),
      max_repair_attempts: expectInteger(finding.max_repair_attempts, `${location}.finding.max_repair_attempts`, 1, MAX_REPAIR_ATTEMPTS),
      evidence_refs: validateEvidenceRefs(finding.evidence_refs, `${location}.finding.evidence_refs`),
      review_cycle_id: expectString2(finding.review_cycle_id, `${location}.finding.review_cycle_id`, SAFE_KEY_PATTERN2)
    }
  };
  if (finding.status !== undefined && finding.status !== "admitted")
    fail2("RUNTIME_SCHEMA_INVALID", `${location}.finding.status must be admitted.`);
  if (finding.repair_attempts !== undefined && finding.repair_attempts !== 0)
    fail2("RUNTIME_SCHEMA_INVALID", `${location}.finding.repair_attempts must be 0.`);
  return result;
}
function validateFindingAction(value) {
  const record = expectRecord2(value, "semantic_delta");
  const action = expectEnum(record.action, ["record-repair-attempt", "resolve", "defer", "reject"], "semantic_delta.action");
  const allowedKeys = action === "record-repair-attempt" ? ["kind", "action", "fingerprint", "review_cycle_id", "repair_wave_id", "evidence_refs", "note"] : ["kind", "action", "fingerprint", "evidence_refs", "note"];
  if (Object.keys(record).some((key) => !allowedKeys.includes(key)))
    fail2("RUNTIME_SCHEMA_INVALID", "finding-queue semantic_delta contains unsupported fields.");
  const result = action === "record-repair-attempt" ? {
    kind: "finding-queue",
    action,
    fingerprint: expectString2(record.fingerprint, "semantic_delta.fingerprint", FINGERPRINT_PATTERN),
    review_cycle_id: expectString2(record.review_cycle_id, "semantic_delta.review_cycle_id", SAFE_KEY_PATTERN2),
    repair_wave_id: expectString2(record.repair_wave_id, "semantic_delta.repair_wave_id", SAFE_KEY_PATTERN2),
    evidence_refs: validateEvidenceRefs(record.evidence_refs, "semantic_delta.evidence_refs")
  } : {
    kind: "finding-queue",
    action,
    fingerprint: expectString2(record.fingerprint, "semantic_delta.fingerprint", FINGERPRINT_PATTERN),
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
  const record = expectRecord2(value, location);
  expectExactKeys2(record, CLOSURE_EVIDENCE_FIELDS, location);
  const validateEvidenceGate = (raw, field) => {
    const gate = expectRecord2(raw, `${location}.${field}`);
    expectExactKeys2(gate, ["triggered", "complete", "evidence_refs"], `${location}.${field}`);
    const triggered = expectBoolean(gate.triggered, `${location}.${field}.triggered`);
    const complete = expectBoolean(gate.complete, `${location}.${field}.complete`);
    const evidenceRefs = expectStringArray2(gate.evidence_refs, `${location}.${field}.evidence_refs`, true, MAX_EVIDENCE_REFS);
    if (triggered && !complete) {
      fail2("CLOSURE_EVIDENCE_INVALID", `${location}.${field} is triggered but incomplete.`);
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
  const record = expectRecord2(value, location);
  expectExactKeys2(record, ["goal", "actual_changes", "verification", "release_evidence", "rollback_evidence", "observation_evidence", "next_action"], location);
  return {
    goal: expectText(record.goal, `${location}.goal`, MAX_TEXT_LENGTH),
    actual_changes: expectStringArray2(record.actual_changes, `${location}.actual_changes`, false, 64),
    verification: expectStringArray2(record.verification, `${location}.verification`, false, 64),
    release_evidence: expectStringArray2(record.release_evidence, `${location}.release_evidence`, true, 64),
    rollback_evidence: expectStringArray2(record.rollback_evidence, `${location}.rollback_evidence`, true, 64),
    observation_evidence: expectStringArray2(record.observation_evidence, `${location}.observation_evidence`, true, 64),
    next_action: expectText(record.next_action, `${location}.next_action`, MAX_TEXT_LENGTH)
  };
}
function validateLessonAdmission(value, location) {
  const record = expectRecord2(value, location);
  expectExactKeys2(record, ["decision", "candidate_refs", "evidence_refs"], location);
  const decision = expectEnum(record.decision, ["admit", "defer", "no-op"], `${location}.decision`);
  const candidateRefs = expectStringArray2(record.candidate_refs, `${location}.candidate_refs`, true, MAX_EVIDENCE_REFS);
  const evidenceRefs = expectStringArray2(record.evidence_refs, `${location}.evidence_refs`, true, MAX_EVIDENCE_REFS);
  if (decision === "admit" && candidateRefs.length === 0)
    fail2("KNOWLEDGE_ADMISSION_INVALID", `${location}.candidate_refs must be non-empty when decision is admit.`);
  if (decision === "admit" && evidenceRefs.length === 0)
    fail2("KNOWLEDGE_ADMISSION_INVALID", `${location}.evidence_refs must be non-empty when decision is admit.`);
  return { decision, candidate_refs: candidateRefs, evidence_refs: evidenceRefs };
}
var KNOWLEDGE_ADMISSION_DISPOSITIONS = [
  "admit",
  "merge",
  "supersede",
  "defer",
  "reject",
  "no-op"
];
var KNOWLEDGE_CANDIDATE_KEYS = [
  "candidateId",
  "kind",
  "fingerprint",
  "statement",
  "sourceRefs",
  "applicability",
  "authoritySource",
  "stability",
  "evidenceRefs",
  "noveltyAgainst",
  "conflictSet",
  "supersedes",
  "reviewOrExpiryTrigger",
  "expectedConsumers",
  "decisionContext",
  "systemicSeverity",
  "implementation_anchors"
];
function validateImplementationAnchors(value, location) {
  const record = expectRecord2(value, location);
  expectExactKeys2(record, ["coverage", "source_revision", "anchors"], location);
  const sourceRevision = expectString2(record.source_revision, `${location}.source_revision`);
  if (sourceRevision.length > 256)
    fail2("IMPLEMENTATION_ANCHOR_INVALID", `${location}.source_revision exceeds 256 characters.`);
  if (!Array.isArray(record.anchors) || record.anchors.length > 5) {
    fail2("IMPLEMENTATION_ANCHOR_INVALID", `${location}.anchors must contain at most five anchors.`);
  }
  const anchors = record.anchors.map((raw, index) => {
    const anchor = expectRecord2(raw, `${location}.anchors[${index}]`);
    const extra = Object.keys(anchor).filter((key) => !["path", "symbol", "role", "evidence_refs"].includes(key));
    const missing = ["path", "role", "evidence_refs"].filter((key) => !(key in anchor));
    if (missing.length > 0 || extra.length > 0) {
      fail2("IMPLEMENTATION_ANCHOR_INVALID", `${location}.anchors[${index}] keys mismatch; missing=[${missing.join(", ")}], unexpected=[${extra.join(", ")}].`);
    }
    const rawAnchorPath = expectString2(anchor.path, `${location}.anchors[${index}].path`);
    const anchorPath = normalizeRepoPath2(rawAnchorPath, `${location}.anchors[${index}].path`);
    if (/^[A-Za-z]:\//u.test(anchorPath) || anchorPath.includes(":") || anchorPath !== path4.posix.normalize(anchorPath)) {
      fail2("IMPLEMENTATION_ANCHOR_INVALID", `${location}.anchors[${index}].path must be a canonical repository-relative path.`);
    }
    if (anchorPath.includes("*") || /:\d+(?:-\d+)?$/u.test(anchorPath)) {
      fail2("IMPLEMENTATION_ANCHOR_INVALID", `${location}.anchors[${index}].path must not be a wildcard or line-number locator.`);
    }
    const symbol = anchor.symbol === undefined || anchor.symbol === null ? null : expectText(anchor.symbol, `${location}.anchors[${index}].symbol`, 256);
    if (symbol !== null && /\r|\n/u.test(symbol))
      fail2("IMPLEMENTATION_ANCHOR_INVALID", `${location}.anchors[${index}].symbol must be single-line.`);
    if (symbol !== null && /^.+:\d+(?:-\d+)?$/u.test(symbol))
      fail2("IMPLEMENTATION_ANCHOR_INVALID", `${location}.anchors[${index}].symbol must not be a line-number locator.`);
    const role = expectText(anchor.role, `${location}.anchors[${index}].role`, 256);
    const evidenceRefs = validateEvidenceRefs(anchor.evidence_refs, `${location}.anchors[${index}].evidence_refs`);
    return { path: anchorPath, symbol, role, evidence_refs: evidenceRefs };
  });
  const anchorKeys = anchors.map((anchor) => `${anchor.path}#${anchor.symbol ?? ""}`);
  if (new Set(anchorKeys).size !== anchorKeys.length)
    fail2("IMPLEMENTATION_ANCHOR_INVALID", `${location}.anchors must not contain duplicate path/symbol locators.`);
  return {
    coverage: expectEnum(record.coverage, ["observed", "verified-scope"], `${location}.coverage`),
    source_revision: sourceRevision,
    anchors
  };
}
function validateKnowledgeCandidate(value, location, expectedKind) {
  const record = expectRecord2(value, location);
  const allowedKeys = new Set(KNOWLEDGE_CANDIDATE_KEYS);
  const requiredKeys = KNOWLEDGE_CANDIDATE_KEYS.filter((key) => !["decisionContext", "systemicSeverity", "implementation_anchors"].includes(key));
  const missing = requiredKeys.filter((key) => !(key in record));
  const extra = Object.keys(record).filter((key) => !allowedKeys.has(key));
  if (missing.length > 0 || extra.length > 0) {
    fail2("KNOWLEDGE_ADMISSION_INVALID", `${location} keys mismatch; missing=[${missing.join(", ")}], unexpected=[${extra.join(", ")}].`);
  }
  const kind = expectEnum(record.kind, ["contract", "decision"], `${location}.kind`);
  if (expectedKind !== undefined && kind !== expectedKind)
    fail2("KNOWLEDGE_ADMISSION_INVALID", `${location}.kind must be ${expectedKind}.`);
  const sourceRefsRaw = record.sourceRefs;
  if (!Array.isArray(sourceRefsRaw) || sourceRefsRaw.length === 0 || sourceRefsRaw.length > 32)
    fail2("KNOWLEDGE_ADMISSION_INVALID", `${location}.sourceRefs must contain between one and 32 entries.`);
  const sourceRefs = sourceRefsRaw.map((raw, index) => {
    const sourceRef = expectRecord2(raw, `${location}.sourceRefs[${index}]`);
    expectExactKeys2(sourceRef, ["locator", "revision"], `${location}.sourceRefs[${index}]`);
    return { locator: expectText(sourceRef.locator, `${location}.sourceRefs[${index}].locator`, 512), revision: expectText(sourceRef.revision, `${location}.sourceRefs[${index}].revision`, 256) };
  });
  const applicabilityRecord = expectRecord2(record.applicability, `${location}.applicability`);
  expectExactKeys2(applicabilityRecord, ["projectTypes", "pathsSymbolsOrSurfaces", "triggerConditions"], `${location}.applicability`);
  const applicability = {
    projectTypes: expectStringArray2(applicabilityRecord.projectTypes, `${location}.applicability.projectTypes`, true, 32),
    pathsSymbolsOrSurfaces: expectStringArray2(applicabilityRecord.pathsSymbolsOrSurfaces, `${location}.applicability.pathsSymbolsOrSurfaces`, true, 32),
    triggerConditions: expectStringArray2(applicabilityRecord.triggerConditions, `${location}.applicability.triggerConditions`, true, 32)
  };
  if (applicability.projectTypes.length === 0 && applicability.pathsSymbolsOrSurfaces.length === 0 && applicability.triggerConditions.length === 0) {
    fail2("KNOWLEDGE_ADMISSION_INVALID", `${location}.applicability must identify at least one project, surface, or trigger.`);
  }
  const decisionContext = record.decisionContext === undefined ? undefined : (() => {
    const context = expectRecord2(record.decisionContext, `${location}.decisionContext`);
    expectExactKeys2(context, ["alternatives", "constraints"], `${location}.decisionContext`);
    return {
      alternatives: expectStringArray2(context.alternatives, `${location}.decisionContext.alternatives`, false, 32),
      constraints: expectStringArray2(context.constraints, `${location}.decisionContext.constraints`, false, 32)
    };
  })();
  if (kind === "decision" && decisionContext === undefined)
    fail2("KNOWLEDGE_ADMISSION_INVALID", `${location}.decisionContext is required for a Decision.`);
  const implementationAnchors = record.implementation_anchors === undefined ? undefined : validateImplementationAnchors(record.implementation_anchors, `${location}.implementation_anchors`);
  const candidate = {
    candidateId: expectString2(record.candidateId, `${location}.candidateId`, SAFE_KEY_PATTERN2),
    kind,
    fingerprint: expectString2(record.fingerprint, `${location}.fingerprint`, FINGERPRINT_PATTERN),
    statement: expectText(record.statement, `${location}.statement`, MAX_TEXT_LENGTH),
    sourceRefs,
    applicability,
    authoritySource: expectEnum(record.authoritySource, ["user", "existing-contract", "accepted-decision", "verified-evidence", "none"], `${location}.authoritySource`),
    stability: expectEnum(record.stability, ["stable", "provisional", "exploratory"], `${location}.stability`),
    evidenceRefs: validateEvidenceRefs(record.evidenceRefs, `${location}.evidenceRefs`),
    noveltyAgainst: expectStringArray2(record.noveltyAgainst, `${location}.noveltyAgainst`, true, 32),
    conflictSet: expectStringArray2(record.conflictSet, `${location}.conflictSet`, true, 32),
    supersedes: expectNullableString(record.supersedes, `${location}.supersedes`, SAFE_KEY_PATTERN2),
    reviewOrExpiryTrigger: expectNullableString(record.reviewOrExpiryTrigger, `${location}.reviewOrExpiryTrigger`),
    expectedConsumers: expectStringArray2(record.expectedConsumers, `${location}.expectedConsumers`, false, 32),
    ...decisionContext ? { decisionContext } : {},
    ...record.systemicSeverity === undefined ? {} : { systemicSeverity: expectEnum(record.systemicSeverity, ["ordinary", "high"], `${location}.systemicSeverity`) },
    ...implementationAnchors ? { implementation_anchors: implementationAnchors } : {}
  };
  return candidate;
}
function validateKnowledgeAdmissionRecord(value, location, expectedKind) {
  const record = expectRecord2(value, location);
  expectExactKeys2(record, ["candidate", "disposition", "matched_knowledge_id", "reasons"], location);
  const candidate = validateKnowledgeCandidate(record.candidate, `${location}.candidate`, expectedKind);
  const disposition = expectEnum(record.disposition, KNOWLEDGE_ADMISSION_DISPOSITIONS, `${location}.disposition`);
  const matchedKnowledgeId = expectNullableString(record.matched_knowledge_id, `${location}.matched_knowledge_id`, SAFE_KEY_PATTERN2);
  const reasons = expectStringArray2(record.reasons, `${location}.reasons`, true, 32);
  const durableDisposition = ["admit", "merge", "supersede"].includes(disposition);
  if (durableDisposition && reasons.length === 0) {
    fail2("KNOWLEDGE_ADMISSION_INVALID", `${location}.reasons must be non-empty for a durable admission.`);
  }
  if (durableDisposition && candidate.authoritySource === "none") {
    fail2("KNOWLEDGE_ADMISSION_INVALID", `${location} cannot admit knowledge without an authority source.`);
  }
  if (durableDisposition && expectedKind === "decision" && !["user", "accepted-decision"].includes(candidate.authoritySource)) {
    fail2("KNOWLEDGE_ADMISSION_INVALID", `${location} Decision admission requires user or accepted-decision authority.`);
  }
  if (disposition === "merge" && matchedKnowledgeId === null)
    fail2("KNOWLEDGE_ADMISSION_INVALID", `${location}.matched_knowledge_id is required for merge.`);
  if (disposition === "supersede" && (matchedKnowledgeId === null || candidate.supersedes !== matchedKnowledgeId))
    fail2("KNOWLEDGE_ADMISSION_INVALID", `${location}.supersede must identify the same predecessor in matched_knowledge_id and candidate.supersedes.`);
  if (durableDisposition) {
    if (candidate.stability !== "stable" || candidate.conflictSet.length > 0 || candidate.evidenceRefs.length === 0) {
      fail2("KNOWLEDGE_ADMISSION_INVALID", `${location} durable admission requires stable, conflict-free candidate evidence.`);
    }
  }
  return { candidate, disposition, matched_knowledge_id: matchedKnowledgeId, reasons };
}
function validateKnowledgeAdmissionBundle(value, location) {
  const record = expectRecord2(value, location);
  expectExactKeys2(record, ["contracts", "decisions"], location);
  if (!Array.isArray(record.contracts) || record.contracts.length > 32)
    fail2("KNOWLEDGE_ADMISSION_INVALID", `${location}.contracts must contain at most 32 records.`);
  if (!Array.isArray(record.decisions) || record.decisions.length > 32)
    fail2("KNOWLEDGE_ADMISSION_INVALID", `${location}.decisions must contain at most 32 records.`);
  const contracts = record.contracts.map((item, index) => validateKnowledgeAdmissionRecord(item, `${location}.contracts[${index}]`, "contract"));
  const decisions = record.decisions.map((item, index) => validateKnowledgeAdmissionRecord(item, `${location}.decisions[${index}]`, "decision"));
  if (new Set(contracts.map((item) => item.candidate.candidateId)).size !== contracts.length)
    fail2("KNOWLEDGE_ADMISSION_INVALID", `${location}.contracts candidate identity must be unique.`);
  if (new Set(decisions.map((item) => item.candidate.candidateId)).size !== decisions.length)
    fail2("KNOWLEDGE_ADMISSION_INVALID", `${location}.decisions candidate identity must be unique.`);
  return { contracts, decisions };
}
function emptyKnowledgeAdmissionBundle() {
  return { contracts: [], decisions: [] };
}
function validateKnowledgeProvenance(value, location) {
  const record = expectRecord2(value, location);
  expectExactKeys2(record, ["task_id", "task_slug", "document_id", "archive_path", "archive_revision", "source_revision", "evidence_refs"], location);
  const taskId = expectString2(record.task_id, `${location}.task_id`);
  const taskSlug = expectString2(record.task_slug, `${location}.task_slug`);
  try {
    validateTaskId(taskId);
    validateTaskSlug(taskSlug);
  } catch (error) {
    fail2("KNOWLEDGE_PROVENANCE_MISMATCH", error instanceof Error ? error.message : String(error));
  }
  const documentId = expectString2(record.document_id, `${location}.document_id`);
  const archiveRevision = expectString2(record.archive_revision, `${location}.archive_revision`);
  const sourceRevision = expectString2(record.source_revision, `${location}.source_revision`);
  if (!DOCUMENT_ID_PATTERN.test(documentId) || !SHA256_PATTERN2.test(archiveRevision) || !SHA256_PATTERN2.test(sourceRevision)) {
    fail2("KNOWLEDGE_PROVENANCE_MISMATCH", `${location} contains an invalid document or revision.`);
  }
  const archivePath = normalizeRepoPath2(expectString2(record.archive_path, `${location}.archive_path`), `${location}.archive_path`);
  if (!/^TASKS\/TASK-[0-9]{3,}-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/u.test(archivePath))
    fail2("KNOWLEDGE_PROVENANCE_MISMATCH", `${location}.archive_path is not a canonical task archive path.`);
  return {
    task_id: taskId,
    task_slug: taskSlug,
    document_id: documentId,
    archive_path: archivePath,
    archive_revision: archiveRevision,
    source_revision: sourceRevision,
    evidence_refs: validateEvidenceRefs(record.evidence_refs, `${location}.evidence_refs`)
  };
}
function validateKnowledgeDelta(value, expectedKind) {
  const record = expectRecord2(value, "semantic_delta");
  expectExactKeys2(record, ["kind", "action", "knowledge_kind", "admission", "provenance", "evidence_refs"], "semantic_delta");
  const knowledgeKind = expectEnum(record.knowledge_kind, ["contract", "decision"], "semantic_delta.knowledge_kind");
  if (expectedKind !== undefined && knowledgeKind !== expectedKind)
    fail2("RUNTIME_SCHEMA_INVALID", `semantic_delta.knowledge_kind must be ${expectedKind}.`);
  const admission = validateKnowledgeAdmissionRecord(record.admission, "semantic_delta.admission", knowledgeKind);
  if (!["admit", "merge", "supersede"].includes(admission.disposition)) {
    fail2("KNOWLEDGE_ADMISSION_INVALID", "Only admitted, merged, or superseded knowledge may be submitted to a Runtime promotion operation.");
  }
  const provenance = validateKnowledgeProvenance(record.provenance, "semantic_delta.provenance");
  const evidenceRefs = validateEvidenceRefs(record.evidence_refs, "semantic_delta.evidence_refs");
  const candidateEvidenceRefs = [
    ...admission.candidate.evidenceRefs,
    ...admission.candidate.implementation_anchors?.anchors.flatMap((anchor) => anchor.evidence_refs) ?? [],
    ...provenance.evidence_refs
  ];
  if (!candidateEvidenceRefs.every((ref) => evidenceRefs.includes(ref)))
    fail2("RUNTIME_EVIDENCE_INVALID", "knowledge proposal evidence_refs must cover candidate, anchor, and provenance evidence_refs.");
  return {
    kind: "knowledge",
    action: "promote",
    knowledge_kind: knowledgeKind,
    admission,
    provenance,
    evidence_refs: evidenceRefs
  };
}
function validateArchiveDelta(value) {
  const record = expectRecord2(value, "semantic_delta");
  const allowedKeys = ["kind", "action", "closure_evidence", "delivery_summary", "remaining_risks", "lesson_admission", "knowledge_admissions", "evidence_refs"];
  const extra = Object.keys(record).filter((key) => !allowedKeys.includes(key));
  const required = allowedKeys.filter((key) => !["knowledge_admissions"].includes(key) && !(key in record));
  if (required.length > 0 || extra.length > 0) {
    fail2("RUNTIME_SCHEMA_INVALID", `semantic_delta keys mismatch; missing=[${required.join(", ")}], unexpected=[${extra.join(", ")}].`);
  }
  const evidenceRefs = validateEvidenceRefs(record.evidence_refs, "semantic_delta.evidence_refs");
  const closureEvidence = validateClosureEvidence(record.closure_evidence, "semantic_delta.closure_evidence");
  const lessonAdmission = validateLessonAdmission(record.lesson_admission, "semantic_delta.lesson_admission");
  const knowledgeAdmissions = record.knowledge_admissions === undefined ? emptyKnowledgeAdmissionBundle() : validateKnowledgeAdmissionBundle(record.knowledge_admissions, "semantic_delta.knowledge_admissions");
  const referencedEvidence = [
    ...closureEvidence.release_evidence.evidence_refs,
    ...closureEvidence.rollback_evidence.evidence_refs,
    ...closureEvidence.observation_evidence.evidence_refs,
    ...lessonAdmission.evidence_refs,
    ...knowledgeAdmissions.contracts.flatMap((item) => [...item.candidate.evidenceRefs, ...item.candidate.implementation_anchors?.anchors.flatMap((anchor) => anchor.evidence_refs) ?? []]),
    ...knowledgeAdmissions.decisions.flatMap((item) => [...item.candidate.evidenceRefs, ...item.candidate.implementation_anchors?.anchors.flatMap((anchor) => anchor.evidence_refs) ?? []])
  ];
  if (!referencedEvidence.every((ref) => evidenceRefs.includes(ref))) {
    fail2("RUNTIME_EVIDENCE_INVALID", "archive proposal evidence_refs must cover closure and lesson-admission evidence_refs.");
  }
  return {
    kind: expectEnum(record.kind, ["archive"], "semantic_delta.kind"),
    action: expectEnum(record.action, ["archive"], "semantic_delta.action"),
    closure_evidence: closureEvidence,
    delivery_summary: validateDeliverySummary(record.delivery_summary, "semantic_delta.delivery_summary"),
    remaining_risks: expectStringArray2(record.remaining_risks, "semantic_delta.remaining_risks", true, 64),
    lesson_admission: lessonAdmission,
    knowledge_admissions: knowledgeAdmissions,
    evidence_refs: evidenceRefs
  };
}
var LESSON_CATEGORIES = ["通用", "数据与存储", "前端与交互", "后端与服务", "测试与回归", "部署与运行时"];
function validateLessonCandidate(value, location) {
  const record = expectRecord2(value, location);
  expectExactKeys2(record, ["candidate_ref", "category", "scene", "conclusion", "trigger", "cause", "action", "consumer", "evidence_refs"], location);
  return {
    candidate_ref: expectString2(record.candidate_ref, `${location}.candidate_ref`, SAFE_KEY_PATTERN2),
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
  const record = expectRecord2(value, "semantic_delta");
  expectExactKeys2(record, ["kind", "action", "status", "summary", "completed_items", "remaining_risks", "next_checkpoint", "evidence_refs"], "semantic_delta");
  return {
    kind: expectEnum(record.kind, ["project-status"], "semantic_delta.kind"),
    action: expectEnum(record.action, ["sync"], "semantic_delta.action"),
    status: expectEnum(record.status, ["completed", "observing"], "semantic_delta.status"),
    summary: expectText(record.summary, "semantic_delta.summary"),
    completed_items: expectStringArray2(record.completed_items, "semantic_delta.completed_items", false, 64),
    remaining_risks: expectStringArray2(record.remaining_risks, "semantic_delta.remaining_risks", true, 64),
    next_checkpoint: expectText(record.next_checkpoint, "semantic_delta.next_checkpoint"),
    evidence_refs: validateEvidenceRefs(record.evidence_refs, "semantic_delta.evidence_refs")
  };
}
function validateLessonRecordDelta(value) {
  const record = expectRecord2(value, "semantic_delta");
  expectExactKeys2(record, ["kind", "action", "candidates", "evidence_refs"], "semantic_delta");
  if (!Array.isArray(record.candidates) || record.candidates.length === 0 || record.candidates.length > 32) {
    fail2("RUNTIME_SCHEMA_INVALID", "semantic_delta.candidates must contain between 1 and 32 candidates.");
  }
  const candidates = record.candidates.map((candidate, index) => validateLessonCandidate(candidate, `semantic_delta.candidates[${index}]`));
  if (new Set(candidates.map((candidate) => candidate.candidate_ref)).size !== candidates.length) {
    fail2("RUNTIME_SCHEMA_INVALID", "semantic_delta.candidates must have unique candidate_ref values.");
  }
  const evidenceRefs = validateEvidenceRefs(record.evidence_refs, "semantic_delta.evidence_refs");
  if (!candidates.every((candidate) => candidate.evidence_refs.every((ref) => evidenceRefs.includes(ref)))) {
    fail2("RUNTIME_EVIDENCE_INVALID", "lesson-record proposal evidence_refs must cover every candidate evidence reference.");
  }
  return {
    kind: expectEnum(record.kind, ["lesson-record"], "semantic_delta.kind"),
    action: expectEnum(record.action, ["record"], "semantic_delta.action"),
    candidates,
    evidence_refs: evidenceRefs
  };
}
function validateInboxItemId(value, location) {
  const itemId = expectString2(value, location);
  const match = INBOX_RECORD_ITEM_ID_PATTERN.exec(itemId);
  if (!match) {
    fail2("RUNTIME_IDENTITY_INVALID", `${location} must use YYYYMMDD-short-id with a lowercase alphanumeric short-id.`);
  }
  const year = Number(match[1].slice(0, 4));
  const month = Number(match[1].slice(4, 6));
  const day = Number(match[1].slice(6, 8));
  const date = new Date(Date.UTC(year, month - 1, day));
  if (year < 1 || date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    fail2("RUNTIME_IDENTITY_INVALID", `${location} must begin with a valid YYYYMMDD date.`);
  }
  return itemId;
}
function validateInboxRecord(value, location) {
  const record = expectRecord2(value, location);
  expectExactKeys2(record, ["artifact_kind", "item_id", "title", "type", "source", "captured_at", "relation_to_current_task", "current_task_id", "description", "evidence", "suggested_next_action", "status"], location);
  const title = expectText(record.title, `${location}.title`, 512);
  if (/[\r\n]/u.test(title) || /^\{\{[^{}]+\}\}$/.test(title)) {
    fail2("RUNTIME_IDENTITY_INVALID", `${location}.title must be a concrete single-line value.`);
  }
  const capturedAt = expectString2(record.captured_at, `${location}.captured_at`);
  if (/[\r\n]/u.test(capturedAt) || Number.isNaN(Date.parse(capturedAt))) {
    fail2("RUNTIME_SCHEMA_INVALID", `${location}.captured_at must be a parseable timestamp.`);
  }
  const currentTaskId = expectString2(record.current_task_id, `${location}.current_task_id`);
  try {
    validateTaskId(currentTaskId);
  } catch (error) {
    fail2("RUNTIME_IDENTITY_INVALID", error instanceof Error ? error.message : String(error));
  }
  return {
    artifact_kind: expectEnum(record.artifact_kind, ["inbox_item"], `${location}.artifact_kind`),
    item_id: validateInboxItemId(record.item_id, `${location}.item_id`),
    title,
    type: expectEnum(record.type, INBOX_ITEM_TYPES, `${location}.type`),
    source: expectEnum(record.source, INBOX_ITEM_SOURCES, `${location}.source`),
    captured_at: capturedAt,
    relation_to_current_task: expectEnum(record.relation_to_current_task, ["unrelated"], `${location}.relation_to_current_task`),
    current_task_id: currentTaskId,
    description: expectText(record.description, `${location}.description`, MAX_INBOX_TEXT_LENGTH),
    evidence: expectText(record.evidence, `${location}.evidence`, MAX_INBOX_TEXT_LENGTH),
    suggested_next_action: expectEnum(record.suggested_next_action, INBOX_SUGGESTED_NEXT_ACTIONS, `${location}.suggested_next_action`),
    status: expectEnum(record.status, ["captured"], `${location}.status`)
  };
}
function validateInboxRecordDelta(value) {
  const record = expectRecord2(value, "semantic_delta");
  expectExactKeys2(record, ["kind", "action", "item_slug", "record", "relation_evidence_refs", "duplicate_check", "proposed_owner", "target_path", "evidence_refs"], "semantic_delta");
  const itemSlug = expectString2(record.item_slug, "semantic_delta.item_slug");
  try {
    validateTaskSlug(itemSlug);
  } catch (error) {
    fail2("RUNTIME_IDENTITY_INVALID", error instanceof Error ? error.message : String(error));
  }
  const inboxRecord = validateInboxRecord(record.record, "semantic_delta.record");
  const relationEvidenceRefs = validateEvidenceRefs(record.relation_evidence_refs, "semantic_delta.relation_evidence_refs");
  const evidenceRefs = validateEvidenceRefs(record.evidence_refs, "semantic_delta.evidence_refs");
  if (!relationEvidenceRefs.every((ref) => evidenceRefs.includes(ref))) {
    fail2("RUNTIME_EVIDENCE_INVALID", "semantic_delta.evidence_refs must cover every relation_evidence_refs entry.");
  }
  const duplicateCheck = expectEnum(record.duplicate_check, ["clear"], "semantic_delta.duplicate_check");
  const proposedOwner = expectEnum(record.proposed_owner, INBOX_SUGGESTED_NEXT_ACTIONS, "semantic_delta.proposed_owner");
  if (inboxRecord.suggested_next_action !== proposedOwner) {
    fail2("RUNTIME_RELATION_INVALID", "semantic_delta.proposed_owner must match record.suggested_next_action.");
  }
  const targetPath = normalizeRepoPath2(expectString2(record.target_path, "semantic_delta.target_path"), "semantic_delta.target_path");
  const targetMatch = INBOX_RECORD_PATH_PATTERN.exec(targetPath);
  if (!targetMatch || `${targetMatch[1]}-${targetMatch[2]}` !== inboxRecord.item_id || targetMatch[3] !== itemSlug) {
    fail2("RUNTIME_PATH_INVALID", "semantic_delta.target_path must be the canonical path derived from item_id and item_slug.");
  }
  return {
    kind: expectEnum(record.kind, ["inbox-record"], "semantic_delta.kind"),
    action: expectEnum(record.action, ["record"], "semantic_delta.action"),
    item_slug: itemSlug,
    record: inboxRecord,
    relation_evidence_refs: relationEvidenceRefs,
    duplicate_check: duplicateCheck,
    proposed_owner: proposedOwner,
    target_path: targetPath,
    evidence_refs: evidenceRefs
  };
}
function validateSemanticDelta(value, operationKind) {
  const record = expectRecord2(value, "semantic_delta");
  const kind = expectString2(record.kind, "semantic_delta.kind");
  if (operationKind === "task-state-transaction") {
    if (kind !== "task-state")
      fail2("RUNTIME_SCHEMA_INVALID", "task-state-transaction requires task-state semantic_delta.");
    return validateTaskStateDelta(value);
  }
  if (operationKind === "lifecycle-transaction") {
    if (kind !== "lifecycle")
      fail2("RUNTIME_SCHEMA_INVALID", "lifecycle-transaction requires lifecycle semantic_delta.");
    return validateLifecycleDelta(value);
  }
  if (operationKind === "archive-transaction") {
    if (kind !== "archive")
      fail2("RUNTIME_SCHEMA_INVALID", "archive-transaction requires archive semantic_delta.");
    return validateArchiveDelta(value);
  }
  if (operationKind === "project-status-transaction") {
    if (kind !== "project-status")
      fail2("RUNTIME_SCHEMA_INVALID", "project-status-transaction requires project-status semantic_delta.");
    return validateProjectStatusDelta(value);
  }
  if (operationKind === "lesson-record-transaction") {
    if (kind !== "lesson-record")
      fail2("RUNTIME_SCHEMA_INVALID", "lesson-record-transaction requires lesson-record semantic_delta.");
    return validateLessonRecordDelta(value);
  }
  if (operationKind === "inbox-record-transaction") {
    if (kind !== "inbox-record")
      fail2("RUNTIME_SCHEMA_INVALID", "inbox-record-transaction requires inbox-record semantic_delta.");
    return validateInboxRecordDelta(value);
  }
  if (operationKind === "contract-candidate-commit") {
    if (kind !== "knowledge")
      fail2("RUNTIME_SCHEMA_INVALID", "contract-candidate-commit requires a knowledge semantic_delta.");
    return validateKnowledgeDelta(value, "contract");
  }
  if (operationKind === "decision-record-transaction") {
    if (kind !== "knowledge")
      fail2("RUNTIME_SCHEMA_INVALID", "decision-record-transaction requires a knowledge semantic_delta.");
    return validateKnowledgeDelta(value, "decision");
  }
  if (kind !== "finding-queue")
    fail2("RUNTIME_SCHEMA_INVALID", "finding-queue-transaction requires finding-queue semantic_delta.");
  return record.action === "admit" ? validateFindingRecord(value, "semantic_delta") : validateFindingAction(value);
}
function validateRuntimeProposal(value) {
  const proposal = expectRecord2(value, "proposal");
  expectExactKeys2(proposal, ["schema_version", "kind", "operation_kind", "caller", "mode", "source_tuple", "authority_evidence", "semantic_delta", "preconditions", "evidence_refs", "idempotency_key", "requested_write_targets"], "proposal");
  if (proposal.schema_version !== VNEXT_RUNTIME_SCHEMA_VERSION)
    fail2("RUNTIME_SCHEMA_INVALID", "proposal.schema_version must be 1.");
  if (proposal.kind !== VNEXT_RUNTIME_PROPOSAL_KIND)
    fail2("RUNTIME_SCHEMA_INVALID", `proposal.kind must be ${VNEXT_RUNTIME_PROPOSAL_KIND}.`);
  const operationKind = expectEnum(proposal.operation_kind, RUNTIME_OPERATION_KINDS, "proposal.operation_kind");
  const caller = expectEnum(proposal.caller, ["execute-step", "prepare-task", "task-lifecycle", "capture-work-item", "close-task"], "proposal.caller");
  const mode = expectEnum(proposal.mode, [...VNEXT_EXECUTE_STEP_MODES, ...PREPARE_TASK_MODES, ...LIFECYCLE_MODES, ...CLOSE_TASK_MODES], "proposal.mode");
  const sourceTuple = validateSourceTuple(proposal.source_tuple);
  const authorityEvidence = validateAuthorityEvidence2(proposal.authority_evidence);
  const preconditions = expectStringArray2(proposal.preconditions, "proposal.preconditions", false, 32);
  const evidenceRefs = validateEvidenceRefs(proposal.evidence_refs, "proposal.evidence_refs");
  const idempotencyKey = expectString2(proposal.idempotency_key, "proposal.idempotency_key", SAFE_KEY_PATTERN2);
  const requestedTargets = expectStringArray2(proposal.requested_write_targets, "proposal.requested_write_targets", false, 4).map((target, index) => normalizeRepoPath2(target, `proposal.requested_write_targets[${index}]`));
  const targetCount = operationKind === "lifecycle-transaction" && mode !== "supersede" || operationKind === "archive-transaction" ? 2 : 1;
  if (requestedTargets.length !== targetCount)
    fail2("RUNTIME_PATH_INVALID", `This Runtime proposal must name exactly ${targetCount} exact write target${targetCount === 1 ? "" : "s"}.`);
  const semanticDelta = validateSemanticDelta(proposal.semantic_delta, operationKind);
  if (operationKind === "task-state-transaction") {
    if (caller === "prepare-task") {
      if (mode === "default") {
        if (semanticDelta.kind !== "task-state" || !["clear-resume-review-gate", "create-draft", "update-draft"].includes(semanticDelta.action)) {
          fail2("RUNTIME_CALLER_NOT_BOUND", "prepare-task default mode is bound only to clear-resume-review-gate, create-draft, or update-draft.");
        }
      } else if (mode === "confirm") {
        if (semanticDelta.kind !== "task-state" || semanticDelta.action !== "confirm-draft") {
          fail2("RUNTIME_CALLER_NOT_BOUND", "prepare-task confirm mode is bound only to confirm-draft.");
        }
      } else if (mode === "replan") {
        if (semanticDelta.kind !== "task-state" || !REPLAN_TASK_STATE_ACTIONS.includes(semanticDelta.action)) {
          fail2("RUNTIME_CALLER_NOT_BOUND", "prepare-task replan mode is bound only to the closed replan task-state action set.");
        }
      } else {
        fail2("RUNTIME_MODE_INVALID", "prepare-task task-state proposals must use default, confirm, or replan mode.");
      }
    } else if (caller === "execute-step") {
      if (!VNEXT_EXECUTE_STEP_MODES.includes(mode))
        fail2("RUNTIME_MODE_INVALID", "execute-step task-state proposals must use default or repair mode.");
      if (semanticDelta.kind !== "task-state" || semanticDelta.action !== "step-progress")
        fail2("RUNTIME_MODE_INVALID", "execute-step is bound only to step-progress task-state deltas.");
    } else {
      fail2("RUNTIME_CALLER_NOT_BOUND", "task-state-transaction is not bound to task-lifecycle.");
    }
  } else if (operationKind === "finding-queue-transaction") {
    if (caller !== "execute-step" || mode !== "repair")
      fail2("RUNTIME_CALLER_NOT_BOUND", "finding-queue-transaction is bound only to execute-step:repair.");
    if (semanticDelta.kind !== "finding-queue")
      fail2("RUNTIME_MODE_INVALID", "repair mode requires a finding-queue proposal.");
  } else if (operationKind === "lifecycle-transaction") {
    if (caller !== "task-lifecycle" || !LIFECYCLE_MODES.includes(mode))
      fail2("RUNTIME_CALLER_NOT_BOUND", "lifecycle-transaction is bound only to task-lifecycle lifecycle modes.");
    if (semanticDelta.kind !== "lifecycle" || semanticDelta.action !== mode)
      fail2("RUNTIME_MODE_INVALID", "lifecycle mode and semantic transition must match.");
  } else if (operationKind === "inbox-record-transaction") {
    if (caller !== "capture-work-item" || mode !== "default")
      fail2("RUNTIME_CALLER_NOT_BOUND", "inbox-record-transaction is bound only to capture-work-item:record with default mode.");
    if (semanticDelta.kind !== "inbox-record" || semanticDelta.action !== "record")
      fail2("RUNTIME_MODE_INVALID", "inbox-record-transaction requires a record inbox semantic_delta.");
    const missingPreconditions = INBOX_CAPTURE_PRECONDITIONS.filter((precondition) => !preconditions.includes(precondition));
    if (missingPreconditions.length > 0)
      fail2("RUNTIME_PRECONDITION_MISSING", `capture-work-item is missing required preconditions: ${missingPreconditions.join(", ")}.`);
  } else if (operationKind === "contract-candidate-commit" || operationKind === "decision-record-transaction") {
    if (caller !== "close-task" || mode !== "default")
      fail2("RUNTIME_CALLER_NOT_BOUND", `${operationKind} is bound only to close-task default closure.`);
    if (semanticDelta.kind !== "knowledge" || semanticDelta.knowledge_kind !== (operationKind === "contract-candidate-commit" ? "contract" : "decision")) {
      fail2("RUNTIME_MODE_INVALID", `${operationKind} requires a matching knowledge semantic_delta.`);
    }
    const requiredPreconditions = ["archive-committed", "knowledge-admission-complete", "canonical-knowledge-target"];
    const missingPreconditions = requiredPreconditions.filter((precondition) => !preconditions.includes(precondition));
    if (missingPreconditions.length > 0)
      fail2("RUNTIME_PRECONDITION_MISSING", `${operationKind} is missing required preconditions: ${missingPreconditions.join(", ")}.`);
  } else {
    if (caller !== "close-task" || !CLOSE_TASK_MODES.includes(mode)) {
      fail2("RUNTIME_CALLER_NOT_BOUND", `${operationKind} is bound only to close-task default closure.`);
    }
    const expectedKind = operationKind === "archive-transaction" ? "archive" : operationKind === "project-status-transaction" ? "project-status" : "lesson-record";
    if (semanticDelta.kind !== expectedKind)
      fail2("RUNTIME_MODE_INVALID", `${operationKind} requires a ${expectedKind} semantic_delta.`);
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
  const reviewReceiptRefs = semanticDelta.kind === "task-state" && semanticDelta.action === "step-progress" && semanticDelta.review_receipt ? semanticDelta.review_receipt.evidence_refs : [];
  if (![...deltaRefs, ...reviewReceiptRefs].every((ref) => evidenceRefs.includes(ref))) {
    fail2("RUNTIME_EVIDENCE_INVALID", "proposal.evidence_refs must cover semantic_delta evidence_refs.");
  }
  return result;
}
function validateFinding(value, location) {
  const finding = expectRecord2(value, location);
  expectExactKeys2(finding, ["fingerprint", "category", "owner_task_id", "scope", "decision", "file", "failure_condition", "violated_invariant", "root_cause_status", "status", "repair_attempts", "max_repair_attempts", "evidence_refs", "review_cycle_id", "last_repair_wave_id", "admitted_at", "updated_at"], location);
  return {
    fingerprint: expectString2(finding.fingerprint, `${location}.fingerprint`, FINGERPRINT_PATTERN),
    category: expectText(finding.category, `${location}.category`, 256),
    owner_task_id: expectString2(finding.owner_task_id, `${location}.owner_task_id`),
    scope: expectEnum(finding.scope, ["admitted"], `${location}.scope`),
    decision: expectEnum(finding.decision, ["mechanical"], `${location}.decision`),
    file: normalizeRepoPath2(expectString2(finding.file, `${location}.file`), `${location}.file`),
    failure_condition: expectText(finding.failure_condition, `${location}.failure_condition`),
    violated_invariant: expectText(finding.violated_invariant, `${location}.violated_invariant`, 512),
    root_cause_status: expectEnum(finding.root_cause_status, ["confirmed", "bounded"], `${location}.root_cause_status`),
    status: expectEnum(finding.status, FINDING_STATUSES, `${location}.status`),
    repair_attempts: expectInteger(finding.repair_attempts, `${location}.repair_attempts`, 0, MAX_REPAIR_ATTEMPTS),
    max_repair_attempts: expectInteger(finding.max_repair_attempts, `${location}.max_repair_attempts`, 1, MAX_REPAIR_ATTEMPTS),
    evidence_refs: validateEvidenceRefs(finding.evidence_refs, `${location}.evidence_refs`),
    review_cycle_id: expectString2(finding.review_cycle_id, `${location}.review_cycle_id`, SAFE_KEY_PATTERN2),
    last_repair_wave_id: expectNullableString(finding.last_repair_wave_id, `${location}.last_repair_wave_id`, SAFE_KEY_PATTERN2),
    admitted_at: expectString2(finding.admitted_at, `${location}.admitted_at`),
    updated_at: expectString2(finding.updated_at, `${location}.updated_at`)
  };
}
function validateReviewCycle(value, location = "runtime_state.review_cycle") {
  const reviewCycle = expectRecord2(value, location);
  expectExactKeys2(reviewCycle, [...REVIEW_CYCLE_FIELDS], location);
  const id = expectString2(reviewCycle.id, `${location}.id`, SAFE_KEY_PATTERN2);
  const cyclePhase = expectEnum(reviewCycle.cycle_phase, REVIEW_CYCLE_PHASES, `${location}.cycle_phase`);
  const repairRound = expectInteger(reviewCycle.repair_round, `${location}.repair_round`, 0, MAX_REPAIR_ROUNDS);
  const countedRepairWaveIds = expectStringArray2(reviewCycle.counted_repair_wave_ids, `${location}.counted_repair_wave_ids`, true, MAX_REPAIR_ROUNDS);
  if (new Set(countedRepairWaveIds).size !== countedRepairWaveIds.length) {
    fail2("RUNTIME_SCHEMA_INVALID", `${location}.counted_repair_wave_ids must be unique.`);
  }
  if (repairRound !== countedRepairWaveIds.length) {
    fail2("RUNTIME_STATE_CONFLICT", `${location}.repair_round must equal the number of counted repair waves.`);
  }
  const activeRepairWaveId = expectNullableString(reviewCycle.active_repair_wave_id, `${location}.active_repair_wave_id`, SAFE_KEY_PATTERN2);
  if (activeRepairWaveId !== null && !countedRepairWaveIds.includes(activeRepairWaveId)) {
    fail2("RUNTIME_STATE_CONFLICT", `${location}.active_repair_wave_id must be one of counted_repair_wave_ids.`);
  }
  if (activeRepairWaveId !== null && countedRepairWaveIds[countedRepairWaveIds.length - 1] !== activeRepairWaveId) {
    fail2("RUNTIME_STATE_CONFLICT", `${location}.active_repair_wave_id must be the latest counted repair wave.`);
  }
  const verificationNewFindingWaveUsed = expectBoolean(reviewCycle.verification_new_finding_wave_used, `${location}.verification_new_finding_wave_used`);
  const verificationNewFindingWaveId = expectNullableString(reviewCycle.verification_new_finding_wave_id, `${location}.verification_new_finding_wave_id`, SAFE_KEY_PATTERN2);
  if (!verificationNewFindingWaveUsed && verificationNewFindingWaveId !== null) {
    fail2("RUNTIME_STATE_CONFLICT", `${location}.verification_new_finding_wave_id must be null before the verification admission wave is used.`);
  }
  if (verificationNewFindingWaveId !== null && activeRepairWaveId !== null) {
    fail2("RUNTIME_STATE_CONFLICT", `${location}.verification_new_finding_wave_id cannot remain open while a repair wave is active.`);
  }
  if (verificationNewFindingWaveUsed && cyclePhase !== "verification") {
    fail2("RUNTIME_STATE_CONFLICT", `${location}.cycle_phase must be verification after the verification admission wave is used.`);
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
  const archiveAuditKeys = [
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
    "knowledge_admissions",
    "recorded_at"
  ];
  const missingArchiveAuditKeys = archiveAuditKeys.filter((key) => key !== "knowledge_admissions" && !(key in value));
  const extraArchiveAuditKeys = Object.keys(value).filter((key) => !archiveAuditKeys.includes(key));
  if (missingArchiveAuditKeys.length > 0 || extraArchiveAuditKeys.length > 0) {
    fail2("RUNTIME_SCHEMA_INVALID", `${location} keys mismatch; missing=[${missingArchiveAuditKeys.join(", ")}], unexpected=[${extraArchiveAuditKeys.join(", ")}].`);
  }
  const entryTaskId = expectString2(value.task_id, `${location}.task_id`);
  const entryTaskSlug = expectString2(value.task_slug, `${location}.task_slug`);
  try {
    validateTaskId(entryTaskId);
    validateTaskSlug(entryTaskSlug);
  } catch (error) {
    fail2("RUNTIME_SCHEMA_INVALID", error instanceof Error ? error.message : String(error));
  }
  if (entryTaskId !== taskId || entryTaskSlug !== taskSlug)
    fail2("RUNTIME_STATE_CONFLICT", `${location} identity does not match runtime_state.`);
  const documentId = expectString2(value.document_id, `${location}.document_id`);
  if (!DOCUMENT_ID_PATTERN.test(documentId))
    fail2("RUNTIME_SCHEMA_INVALID", `${location}.document_id is invalid.`);
  const sourceRevision = expectString2(value.source_revision, `${location}.source_revision`);
  const archiveRevision = expectString2(value.archive_revision, `${location}.archive_revision`);
  const closureDeltaDigest = expectString2(value.closure_delta_digest, `${location}.closure_delta_digest`);
  if (!/^[a-f0-9]{64}$/.test(sourceRevision) || !/^[a-f0-9]{64}$/.test(archiveRevision) || !/^[a-f0-9]{64}$/.test(closureDeltaDigest)) {
    fail2("RUNTIME_SCHEMA_INVALID", `${location} revisions and digest must be SHA-256.`);
  }
  const archivePath = normalizeRepoPath2(expectString2(value.archive_path, `${location}.archive_path`), `${location}.archive_path`);
  if (!/^TASKS\/TASK-[0-9]{3,}-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/.test(archivePath)) {
    fail2("RUNTIME_PATH_INVALID", `${location}.archive_path must be a canonical task archive path.`);
  }
  if (value.action !== "archive" || value.operation_kind !== "archive-transaction" || value.caller !== "close-task" || value.mode !== "default") {
    fail2("RUNTIME_STATE_CONFLICT", `${location} archive audit has an invalid operation binding.`);
  }
  if (value.from_workflow_status !== "active" || value.from_lifecycle_state !== "active" || value.to_workflow_status !== "closed" || value.to_lifecycle_state !== "archived") {
    fail2("RUNTIME_STATE_CONFLICT", `${location} archive audit has an invalid terminal transition.`);
  }
  return {
    action: "archive",
    idempotency_key: expectString2(value.idempotency_key, `${location}.idempotency_key`, SAFE_KEY_PATTERN2),
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
    authority_evidence: validateAuthorityEvidence2(value.authority_evidence),
    evidence_refs: validateEvidenceRefs(value.evidence_refs, `${location}.evidence_refs`),
    lesson_admission: validateLessonAdmission(value.lesson_admission, `${location}.lesson_admission`),
    knowledge_admissions: value.knowledge_admissions === undefined ? emptyKnowledgeAdmissionBundle() : validateKnowledgeAdmissionBundle(value.knowledge_admissions, `${location}.knowledge_admissions`),
    recorded_at: expectString2(value.recorded_at, `${location}.recorded_at`)
  };
}
function validateDraftAuditLogEntry(value, location, taskId, taskSlug) {
  const action = expectEnum(value.action, DRAFT_AUDIT_ACTIONS, `${location}.action`);
  const requiredKeys = [
    "action",
    "idempotency_key",
    "operation_kind",
    "caller",
    "mode",
    "from_task_id",
    "from_task_slug",
    "from_document_id",
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
  const conditionalKeys = action === "confirm-draft" ? ["draft_revision"] : ["definition_digest"];
  const extra = Object.keys(value).filter((key) => !requiredKeys.includes(key) && !conditionalKeys.includes(key));
  const missing = [...requiredKeys, ...conditionalKeys].filter((key) => !(key in value));
  if (missing.length > 0 || extra.length > 0) {
    fail2("RUNTIME_SCHEMA_INVALID", `${location} audit keys mismatch; missing=[${missing.join(", ")}], unexpected=[${extra.join(", ")}].`);
  }
  const fromTaskId = expectString2(value.from_task_id, `${location}.from_task_id`);
  const fromTaskSlug = expectString2(value.from_task_slug, `${location}.from_task_slug`);
  const entryTaskId = expectString2(value.task_id, `${location}.task_id`);
  const entryTaskSlug = expectString2(value.task_slug, `${location}.task_slug`);
  try {
    validateTaskId(fromTaskId);
    validateTaskSlug(fromTaskSlug);
    validateTaskId(entryTaskId);
    validateTaskSlug(entryTaskSlug);
  } catch (error) {
    fail2("RUNTIME_SCHEMA_INVALID", error instanceof Error ? error.message : String(error));
  }
  if (entryTaskId !== taskId || entryTaskSlug !== taskSlug)
    fail2("RUNTIME_STATE_CONFLICT", `${location} target identity does not match runtime_state.`);
  const fromDocumentId = expectString2(value.from_document_id, `${location}.from_document_id`);
  const documentId = expectString2(value.document_id, `${location}.document_id`);
  if (!DOCUMENT_ID_PATTERN.test(fromDocumentId) || !DOCUMENT_ID_PATTERN.test(documentId)) {
    fail2("RUNTIME_SCHEMA_INVALID", `${location}.document_id fields are invalid.`);
  }
  const fromWorkflowStatus = expectEnum(value.from_workflow_status, CURRENT_TASK_WORKFLOW_STATUSES, `${location}.from_workflow_status`);
  const fromLifecycleState = expectEnum(value.from_lifecycle_state, TASK_LIFECYCLE_STATES, `${location}.from_lifecycle_state`);
  const toWorkflowStatus = expectEnum(value.to_workflow_status, CURRENT_TASK_WORKFLOW_STATUSES, `${location}.to_workflow_status`);
  const toLifecycleState = expectEnum(value.to_lifecycle_state, TASK_LIFECYCLE_STATES, `${location}.to_lifecycle_state`);
  try {
    validateCurrentTaskStatusTuple(fromWorkflowStatus, fromLifecycleState);
    validateCurrentTaskStatusTuple(toWorkflowStatus, toLifecycleState);
  } catch (error) {
    fail2("RUNTIME_STATE_CONFLICT", error instanceof Error ? error.message : String(error));
  }
  const sourceRevision = expectString2(value.source_revision, `${location}.source_revision`);
  if (!/^[a-f0-9]{64}$/.test(sourceRevision))
    fail2("RUNTIME_SCHEMA_INVALID", `${location}.source_revision must be SHA-256.`);
  const authorityEvidence = validateAuthorityEvidence2(value.authority_evidence);
  const evidenceRefs = validateEvidenceRefs(value.evidence_refs, `${location}.evidence_refs`);
  const recordedAt = expectString2(value.recorded_at, `${location}.recorded_at`);
  if (action === "create-draft" || action === "update-draft") {
    if (value.operation_kind !== "task-state-transaction" || value.caller !== "prepare-task" || value.mode !== "default") {
      fail2("RUNTIME_STATE_CONFLICT", `${location} ${action} audit has an invalid operation binding.`);
    }
    const expectedFromIdentity = action === "create-draft" ? ["closed", "archived"] : ["draft", "active"];
    if (fromWorkflowStatus !== expectedFromIdentity[0] || fromLifecycleState !== expectedFromIdentity[1] || toWorkflowStatus !== "draft" || toLifecycleState !== "active") {
      fail2("RUNTIME_STATE_CONFLICT", `${location} ${action} audit has an invalid transition.`);
    }
    const definitionDigest = expectString2(value.definition_digest, `${location}.definition_digest`);
    if (!/^[a-f0-9]{64}$/.test(definitionDigest))
      fail2("RUNTIME_SCHEMA_INVALID", `${location}.definition_digest must be SHA-256.`);
    return {
      action,
      idempotency_key: expectString2(value.idempotency_key, `${location}.idempotency_key`, SAFE_KEY_PATTERN2),
      operation_kind: "task-state-transaction",
      caller: "prepare-task",
      mode: "default",
      from_task_id: fromTaskId,
      from_task_slug: fromTaskSlug,
      from_document_id: fromDocumentId,
      task_id: entryTaskId,
      task_slug: entryTaskSlug,
      document_id: documentId,
      from_workflow_status: fromWorkflowStatus,
      from_lifecycle_state: fromLifecycleState,
      to_workflow_status: "draft",
      to_lifecycle_state: "active",
      source_revision: sourceRevision,
      authority_evidence: authorityEvidence,
      evidence_refs: evidenceRefs,
      definition_digest: definitionDigest,
      recorded_at: recordedAt
    };
  }
  if (value.operation_kind !== "task-state-transaction" || value.caller !== "prepare-task" || value.mode !== "confirm") {
    fail2("RUNTIME_STATE_CONFLICT", `${location} confirm-draft audit has an invalid operation binding.`);
  }
  if (fromWorkflowStatus !== "draft" || fromLifecycleState !== "active" || toWorkflowStatus !== "active" || toLifecycleState !== "active") {
    fail2("RUNTIME_STATE_CONFLICT", `${location} confirm-draft audit has an invalid transition.`);
  }
  const draftRevision = expectString2(value.draft_revision, `${location}.draft_revision`);
  if (!/^[a-f0-9]{64}$/.test(draftRevision))
    fail2("RUNTIME_SCHEMA_INVALID", `${location}.draft_revision must be SHA-256.`);
  return {
    action: "confirm-draft",
    idempotency_key: expectString2(value.idempotency_key, `${location}.idempotency_key`, SAFE_KEY_PATTERN2),
    operation_kind: "task-state-transaction",
    caller: "prepare-task",
    mode: "confirm",
    from_task_id: fromTaskId,
    from_task_slug: fromTaskSlug,
    from_document_id: fromDocumentId,
    task_id: entryTaskId,
    task_slug: entryTaskSlug,
    document_id: documentId,
    from_workflow_status: "draft",
    from_lifecycle_state: "active",
    to_workflow_status: "active",
    to_lifecycle_state: "active",
    source_revision: sourceRevision,
    authority_evidence: authorityEvidence,
    evidence_refs: evidenceRefs,
    draft_revision: draftRevision,
    recorded_at: recordedAt
  };
}
function validateExecutionLogEntry(value, location, taskId, taskSlug) {
  const record = expectRecord2(value, location);
  if (DRAFT_AUDIT_ACTIONS.includes(record.action))
    return validateDraftAuditLogEntry(record, location, taskId, taskSlug);
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
      fail2("RUNTIME_SCHEMA_INVALID", `${location} audit keys mismatch; missing=[${missing.join(", ")}], unexpected=[${extra.join(", ")}].`);
    }
    const action = expectEnum(record.action, REPLAN_AUDIT_ACTIONS, `${location}.action`);
    const operationKind = expectEnum(record.operation_kind, ["task-state-transaction", "lifecycle-transaction"], `${location}.operation_kind`);
    const caller = expectEnum(record.caller, ["prepare-task", "task-lifecycle"], `${location}.caller`);
    const mode = expectString2(record.mode, `${location}.mode`);
    const entryTaskId = expectString2(record.task_id, `${location}.task_id`);
    const entryTaskSlug = expectString2(record.task_slug, `${location}.task_slug`);
    const documentId = expectString2(record.document_id, `${location}.document_id`);
    if (!DOCUMENT_ID_PATTERN.test(documentId))
      fail2("RUNTIME_SCHEMA_INVALID", `${location}.document_id is invalid.`);
    try {
      validateTaskId(entryTaskId);
      validateTaskSlug(entryTaskSlug);
    } catch (error) {
      fail2("RUNTIME_SCHEMA_INVALID", error instanceof Error ? error.message : String(error));
    }
    if (entryTaskId !== taskId || entryTaskSlug !== taskSlug)
      fail2("RUNTIME_STATE_CONFLICT", `${location} identity does not match runtime_state.`);
    const fromWorkflowStatus = expectEnum(record.from_workflow_status, CURRENT_TASK_WORKFLOW_STATUSES, `${location}.from_workflow_status`);
    const fromLifecycleState = expectEnum(record.from_lifecycle_state, TASK_LIFECYCLE_STATES, `${location}.from_lifecycle_state`);
    const toWorkflowStatus = expectEnum(record.to_workflow_status, CURRENT_TASK_WORKFLOW_STATUSES, `${location}.to_workflow_status`);
    const toLifecycleState = expectEnum(record.to_lifecycle_state, TASK_LIFECYCLE_STATES, `${location}.to_lifecycle_state`);
    try {
      validateCurrentTaskStatusTuple(fromWorkflowStatus, fromLifecycleState);
      validateCurrentTaskStatusTuple(toWorkflowStatus, toLifecycleState);
    } catch (error) {
      fail2("RUNTIME_STATE_CONFLICT", error instanceof Error ? error.message : String(error));
    }
    const sourceRevision = expectString2(record.source_revision, `${location}.source_revision`);
    if (!/^[a-f0-9]{64}$/.test(sourceRevision))
      fail2("RUNTIME_SCHEMA_INVALID", `${location}.source_revision must be SHA-256.`);
    const authorityEvidence = validateAuthorityEvidence2(record.authority_evidence);
    const evidenceRefs = validateEvidenceRefs(record.evidence_refs, `${location}.evidence_refs`);
    const recordedAt = expectString2(record.recorded_at, `${location}.recorded_at`);
    if (action === "supersede") {
      if (operationKind !== "lifecycle-transaction" || caller !== "task-lifecycle" || mode !== "supersede") {
        fail2("RUNTIME_STATE_CONFLICT", `${location} supersede audit has an invalid operation binding.`);
      }
      if (!["active", "blocked_by_replan"].includes(fromWorkflowStatus) || fromLifecycleState !== "active" || toWorkflowStatus !== "superseded" || toLifecycleState !== "active") {
        fail2("RUNTIME_STATE_CONFLICT", `${location} supersede audit has an invalid transition.`);
      }
      if (record.partial_diff_disposition === undefined || record.invalidation_kind === undefined || record.invalidation_reason === undefined) {
        fail2("RUNTIME_SCHEMA_INVALID", `${location} supersede audit must preserve invalidation and partial-diff evidence.`);
      }
      const partialDiffDisposition = validatePartialDiffDisposition(record.partial_diff_disposition, `${location}.partial_diff_disposition`);
      const invalidationKind = expectEnum(record.invalidation_kind, ["goal", "scope", "acceptance"], `${location}.invalidation_kind`);
      const invalidationReason = expectText(record.invalidation_reason, `${location}.invalidation_reason`);
      return {
        action,
        idempotency_key: expectString2(record.idempotency_key, `${location}.idempotency_key`, SAFE_KEY_PATTERN2),
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
      fail2("RUNTIME_STATE_CONFLICT", `${location} replan audit has an invalid operation binding.`);
    }
    if (record.partial_diff_disposition !== undefined || record.invalidation_kind !== undefined || record.invalidation_reason !== undefined) {
      fail2("RUNTIME_SCHEMA_INVALID", `${location} non-supersede audit must not carry supersede-only evidence.`);
    }
    const expectedTransition = action === "mark-replan-blocked" ? ["active", "active", "blocked_by_replan", "active"] : action === "clear-replan-block" ? ["blocked_by_replan", "active", "active", "active"] : ["superseded", "active", "active", "active"];
    if (fromWorkflowStatus !== expectedTransition[0] || fromLifecycleState !== expectedTransition[1] || toWorkflowStatus !== expectedTransition[2] || toLifecycleState !== expectedTransition[3]) {
      fail2("RUNTIME_STATE_CONFLICT", `${location} replan audit has an invalid transition.`);
    }
    return {
      action,
      idempotency_key: expectString2(record.idempotency_key, `${location}.idempotency_key`, SAFE_KEY_PATTERN2),
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
  const executionLogKeys = [
    "idempotency_key",
    "mode",
    "step_id",
    "status",
    "evidence_refs",
    "note",
    "repair_fingerprint",
    "diff_target",
    "checkpoint",
    "advancement",
    "next_step_id",
    "review_receipt",
    "recorded_at"
  ];
  const optionalExecutionLogKeys = ["note", "repair_fingerprint", "diff_target", "checkpoint", "advancement", "next_step_id", "review_receipt"];
  const missingExecutionLogKeys = executionLogKeys.filter((key) => !optionalExecutionLogKeys.includes(key) && !(key in record));
  const extraExecutionLogKeys = Object.keys(record).filter((key) => !executionLogKeys.includes(key));
  if (missingExecutionLogKeys.length > 0 || extraExecutionLogKeys.length > 0)
    fail2("RUNTIME_SCHEMA_INVALID", `${location} keys mismatch; missing=[${missingExecutionLogKeys.join(", ")}], unexpected=[${extraExecutionLogKeys.join(", ")}].`);
  const result = {
    idempotency_key: expectString2(record.idempotency_key, `${location}.idempotency_key`, SAFE_KEY_PATTERN2),
    mode: expectEnum(record.mode, VNEXT_EXECUTE_STEP_MODES, `${location}.mode`),
    step_id: expectString2(record.step_id, `${location}.step_id`, STEP_ID_PATTERN2),
    status: expectEnum(record.status, STEP_STATUSES, `${location}.status`),
    evidence_refs: validateEvidenceRefs(record.evidence_refs, `${location}.evidence_refs`),
    recorded_at: expectString2(record.recorded_at, `${location}.recorded_at`)
  };
  if (record.note !== undefined && record.note !== null)
    result.note = expectText(record.note, `${location}.note`);
  if (record.repair_fingerprint !== undefined) {
    result.repair_fingerprint = expectString2(record.repair_fingerprint, `${location}.repair_fingerprint`, FINGERPRINT_PATTERN);
    if (result.mode !== "repair")
      fail2("RUNTIME_STATE_CONFLICT", `${location}.repair_fingerprint is only valid for repair execution records.`);
  }
  if (record.diff_target !== undefined)
    result.diff_target = expectText(record.diff_target, `${location}.diff_target`, 512);
  if (record.checkpoint !== undefined)
    result.checkpoint = expectEnum(record.checkpoint, ["required", "not-required"], `${location}.checkpoint`);
  if (record.advancement !== undefined)
    result.advancement = expectEnum(record.advancement, STEP_ADVANCEMENT_OUTCOMES, `${location}.advancement`);
  if (record.next_step_id !== undefined)
    result.next_step_id = expectNullableString(record.next_step_id, `${location}.next_step_id`, STEP_ID_PATTERN2);
  if (record.review_receipt !== undefined)
    result.review_receipt = validateStepReviewReceipt(record.review_receipt, `${location}.review_receipt`);
  if (result.review_receipt && result.status !== "completed")
    fail2("RUNTIME_STATE_CONFLICT", `${location}.review_receipt requires a completed execution record.`);
  if (result.advancement !== undefined) {
    if (result.checkpoint === undefined || result.next_step_id === undefined) {
      fail2("RUNTIME_STATE_CONFLICT", `${location}.advancement requires checkpoint and next_step_id.`);
    }
    if (result.advancement === "advanced" && result.next_step_id === null) {
      fail2("RUNTIME_STATE_CONFLICT", `${location}.advanced execution record must name the next step.`);
    }
    if (result.advancement !== "advanced" && result.next_step_id !== null) {
      fail2("RUNTIME_STATE_CONFLICT", `${location}.${result.advancement} execution record must not name a next step.`);
    }
  }
  return result;
}
function validateVNextRuntimeState(value) {
  const runtime = expectRecord2(value, "runtime_state");
  expectExactKeys2(runtime, ["schema_version", "kind", "task_id", "task_slug", "workflow_status", "lifecycle_state", "resume_requires_review", "resume_review_reasons", "active_step_id", "active_step_status", "finding_queue_revision", "review_cycle", "findings", "execution_log", "applied_proposals"], "runtime_state");
  if (runtime.schema_version !== VNEXT_RUNTIME_SCHEMA_VERSION)
    fail2("RUNTIME_SCHEMA_INVALID", "runtime_state.schema_version must be 1.");
  if (runtime.kind !== VNEXT_RUNTIME_STATE_KIND)
    fail2("RUNTIME_SCHEMA_INVALID", `runtime_state.kind must be ${VNEXT_RUNTIME_STATE_KIND}.`);
  const taskId = expectString2(runtime.task_id, "runtime_state.task_id");
  const taskSlug = expectString2(runtime.task_slug, "runtime_state.task_slug");
  try {
    validateTaskId(taskId);
    validateTaskSlug(taskSlug);
  } catch (error) {
    fail2("RUNTIME_SCHEMA_INVALID", error instanceof Error ? error.message : String(error));
  }
  const workflowStatus = expectEnum(runtime.workflow_status, CURRENT_TASK_WORKFLOW_STATUSES, "runtime_state.workflow_status");
  const lifecycleState = expectEnum(runtime.lifecycle_state, TASK_LIFECYCLE_STATES, "runtime_state.lifecycle_state");
  try {
    validateCurrentTaskStatusTuple(workflowStatus, lifecycleState);
  } catch (error) {
    fail2("RUNTIME_STATE_CONFLICT", error instanceof Error ? error.message : String(error));
  }
  const resumeRequiresReview = expectBoolean(runtime.resume_requires_review, "runtime_state.resume_requires_review");
  const rawResumeReasons = expectStringArray2(runtime.resume_review_reasons, "runtime_state.resume_review_reasons", true, RESUME_REVIEW_REASON_ORDER.length);
  const resumeReviewReasons = normalizeResumeReviewReasons(rawResumeReasons);
  if (rawResumeReasons.join("|") !== resumeReviewReasons.join("|")) {
    fail2("RUNTIME_SCHEMA_INVALID", "runtime_state.resume_review_reasons must use the canonical closed-set order.");
  }
  try {
    validateCurrentTaskResumeGate(lifecycleState, resumeRequiresReview, resumeReviewReasons);
  } catch (error) {
    fail2("RUNTIME_STATE_CONFLICT", error instanceof Error ? error.message : String(error));
  }
  const activeStepId = expectString2(runtime.active_step_id, "runtime_state.active_step_id", STEP_ID_PATTERN2);
  const activeStepStatus = expectEnum(runtime.active_step_status, STEP_STATUSES, "runtime_state.active_step_status");
  const findingsValue = runtime.findings;
  if (!Array.isArray(findingsValue) || findingsValue.length > MAX_FINDINGS)
    fail2("RUNTIME_SCHEMA_INVALID", "runtime_state.findings must be an array within the bounded size.");
  const findings = findingsValue.map((finding, index) => validateFinding(finding, `runtime_state.findings[${index}]`));
  if (new Set(findings.map((finding) => finding.fingerprint)).size !== findings.length)
    fail2("RUNTIME_SCHEMA_INVALID", "runtime_state.findings fingerprints must be unique.");
  for (const finding of findings) {
    if (finding.owner_task_id !== taskId)
      fail2("RUNTIME_STATE_CONFLICT", `finding ${finding.fingerprint} is owned by a different task.`);
    if (finding.repair_attempts > finding.max_repair_attempts)
      fail2("RUNTIME_SCHEMA_INVALID", `finding ${finding.fingerprint} exceeds its declared repair budget.`);
  }
  const executionLogValue = runtime.execution_log;
  if (!Array.isArray(executionLogValue) || executionLogValue.length > MAX_EXECUTION_LOG)
    fail2("RUNTIME_SCHEMA_INVALID", "runtime_state.execution_log must be a bounded array.");
  const executionLog = executionLogValue.map((entry, index) => validateExecutionLogEntry(entry, `runtime_state.execution_log[${index}]`, taskId, taskSlug));
  const appliedValue = runtime.applied_proposals;
  if (!Array.isArray(appliedValue) || appliedValue.length > MAX_APPLIED_PROPOSALS)
    fail2("RUNTIME_SCHEMA_INVALID", "runtime_state.applied_proposals must be a bounded array.");
  const appliedProposals = appliedValue.map((entry, index) => {
    const record = expectRecord2(entry, `runtime_state.applied_proposals[${index}]`);
    expectExactKeys2(record, ["idempotency_key", "operation_kind", "proposal_digest", "source_revision"], `runtime_state.applied_proposals[${index}]`);
    const proposalDigest = expectString2(record.proposal_digest, `runtime_state.applied_proposals[${index}].proposal_digest`);
    if (!/^[a-f0-9]{64}$/.test(proposalDigest))
      fail2("RUNTIME_SCHEMA_INVALID", `runtime_state.applied_proposals[${index}].proposal_digest must be SHA-256.`);
    const sourceRevision = expectString2(record.source_revision, `runtime_state.applied_proposals[${index}].source_revision`);
    if (!/^[a-f0-9]{64}$/.test(sourceRevision))
      fail2("RUNTIME_SCHEMA_INVALID", `runtime_state.applied_proposals[${index}].source_revision must be SHA-256.`);
    return {
      idempotency_key: expectString2(record.idempotency_key, `runtime_state.applied_proposals[${index}].idempotency_key`, SAFE_KEY_PATTERN2),
      operation_kind: expectEnum(record.operation_kind, RUNTIME_OPERATION_KINDS, `runtime_state.applied_proposals[${index}].operation_kind`),
      proposal_digest: proposalDigest,
      source_revision: sourceRevision
    };
  });
  if (new Set(appliedProposals.map((item) => item.idempotency_key)).size !== appliedProposals.length)
    fail2("RUNTIME_SCHEMA_INVALID", "runtime_state.applied_proposals keys must be unique.");
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
    fail2("RUNTIME_SCHEMA_INVALID", `CURRENT_TASK must contain exactly one task-info field "${label}".`);
  return body.replace(pattern, `- ${label}：${value}`);
}
function renderCurrentTaskLifecycleFields(body, runtimeState) {
  const headingMatch = /^## 任务信息\s*$/m.exec(body);
  if (!headingMatch || headingMatch.index === undefined)
    fail2("RUNTIME_SCHEMA_INVALID", "CURRENT_TASK is missing ## 任务信息.");
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
function scanMarkdownSections2(body) {
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
    fail2("RUNTIME_SECTION_INVALID", `CURRENT_TASK contains duplicate replacement sections: ${aliases.join(" / ")}.`);
  return matches[0] ?? null;
}
function resolveReplanSectionRanges(body) {
  const sections = scanMarkdownSections2(body);
  const resolved = {};
  const topAllowed = findUniqueMarkdownSection(sections, REPLAN_SECTION_HEADINGS.allowed_scope, 2);
  const topConditional = findUniqueMarkdownSection(sections, REPLAN_SECTION_HEADINGS.conditional_scope, 2);
  const topForbidden = findUniqueMarkdownSection(sections, REPLAN_SECTION_HEADINGS.forbidden_scope, 2);
  const nestedAllowed = topAllowed ? findUniqueMarkdownSection(sections, REPLAN_SECTION_HEADINGS.allowed_scope, 3, topAllowed.contentStart, topAllowed.contentEnd) : null;
  const nestedConditional = topAllowed ? findUniqueMarkdownSection(sections, REPLAN_SECTION_HEADINGS.conditional_scope, 3, topAllowed.contentStart, topAllowed.contentEnd) : null;
  const nestedConditionalUnderTopSection = topConditional ? findUniqueMarkdownSection(sections, REPLAN_SECTION_HEADINGS.conditional_scope, 3, topConditional.contentStart, topConditional.contentEnd) : null;
  const nestedForbidden = topForbidden ? findUniqueMarkdownSection(sections, REPLAN_SECTION_HEADINGS.forbidden_scope, 3, topForbidden.contentStart, topForbidden.contentEnd) : null;
  if (nestedConditional && !nestedAllowed) {
    fail2("RUNTIME_SECTION_INVALID", "Conditional scope must have a distinct existing Allowed Files section when both are nested under the scope heading.");
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
        fail2("RUNTIME_SECTION_INVALID", `CURRENT_TASK is missing the existing replacement section for ${key}.`);
      continue;
    }
    replacements.push({ range, content: value ?? "" });
  }
  replacements.sort((left, right) => right.range.contentStart - left.range.contentStart);
  for (let index = 1;index < replacements.length; index += 1) {
    const previous = replacements[index - 1].range;
    const current = replacements[index].range;
    if (current.contentEnd > previous.contentStart) {
      fail2("RUNTIME_SECTION_INVALID", "Replan replacement sections overlap and cannot be replaced atomically.");
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
        fail2("RUNTIME_REPLAY_INCOMPLETE", `replan replay is missing the replacement section for ${key}.`);
      continue;
    }
    const actual = normalizeReplacementSectionContent(body.slice(range.contentStart, range.contentEnd), `CURRENT_TASK.${range.title}`);
    const expected = value ?? "";
    if (actual !== expected)
      fail2("RUNTIME_REPLAY_INCOMPLETE", `replan replay section ${key} no longer matches the committed replacement.`);
  }
}
function auditList(values) {
  return `[${values.map((value) => JSON.stringify(value)).join(", ")}]`;
}
function renderExecutionAuditRecord(audit, includeEmptyKnowledge = true) {
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
    if (includeEmptyKnowledge || audit.knowledge_admissions.contracts.length > 0 || audit.knowledge_admissions.decisions.length > 0) {
      lines.push(`  knowledge_admissions: ${JSON.stringify(audit.knowledge_admissions)}`);
    }
  } else if (DRAFT_AUDIT_ACTIONS.includes(audit.action)) {
    const draftAudit = audit;
    lines.push(`  from_task_id: ${draftAudit.from_task_id}`);
    lines.push(`  from_task_slug: ${draftAudit.from_task_slug}`);
    lines.push(`  from_document_id: ${draftAudit.from_document_id}`);
    if (draftAudit.definition_digest !== undefined)
      lines.push(`  definition_digest: ${draftAudit.definition_digest}`);
    if (draftAudit.draft_revision !== undefined)
      lines.push(`  draft_revision: ${draftAudit.draft_revision}`);
  } else {
    const replanAudit = audit;
    if (replanAudit.invalidation_kind !== undefined)
      lines.push(`  invalidation_kind: ${replanAudit.invalidation_kind}`);
    if (replanAudit.invalidation_reason !== undefined)
      lines.push(`  invalidation_reason: ${replanAudit.invalidation_reason}`);
    if (replanAudit.partial_diff_disposition !== undefined) {
      lines.push("  partial_diff_disposition:");
      lines.push(`    reusable: ${auditList(replanAudit.partial_diff_disposition.reusable)}`);
      lines.push(`    rollback_required: ${auditList(replanAudit.partial_diff_disposition.rollback_required)}`);
      lines.push(`    stop_propagation: ${auditList(replanAudit.partial_diff_disposition.stop_propagation)}`);
    }
  }
  lines.push(`  recorded_at: ${audit.recorded_at}`);
  return lines.join(`
`);
}
function appendExecutionAuditToBody(body, audit) {
  const section = findUniqueMarkdownSection(scanMarkdownSections2(body), ["执行记录", "Execution Log"], 2);
  if (!section)
    fail2("RUNTIME_SECTION_INVALID", "CURRENT_TASK is missing the required ## 执行记录 audit section.");
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
  const section = findUniqueMarkdownSection(scanMarkdownSections2(body), ["执行记录", "Execution Log"], 2);
  if (!section)
    fail2("RUNTIME_REPLAY_INCOMPLETE", "replay is missing the required ## 执行记录 audit section.");
  const content = body.slice(section.contentStart, section.contentEnd).replace(/\r\n?/g, `
`);
  const currentAudit = renderExecutionAuditRecord(audit);
  const historicalAudit = audit.action === "archive" && audit.knowledge_admissions.contracts.length === 0 && audit.knowledge_admissions.decisions.length === 0 ? renderExecutionAuditRecord(audit, false) : null;
  if (!content.includes(currentAudit) && (historicalAudit === null || !content.includes(historicalAudit))) {
    fail2("RUNTIME_REPLAY_INCOMPLETE", `replay is missing the durable body audit for ${audit.action}.`);
  }
}
function renderNewDraftBody(identity, definition, runtimeState) {
  const optionalSection = (value) => value ?? "";
  return [
    "# vNext CURRENT_TASK",
    "",
    "## 任务信息",
    "",
    `- 任务 ID：${identity.task_id}`,
    `- 任务标题：${identity.task_title}`,
    `- 任务 slug：${identity.task_slug}`,
    `- 当前状态：${runtimeState.workflow_status}`,
    `- 生命周期状态：${runtimeState.lifecycle_state}`,
    `- 恢复需审查：${runtimeState.resume_requires_review ? "true" : "false"}`,
    `- 恢复审查原因：${runtimeState.resume_review_reasons.join(", ")}`,
    "",
    "## 背景与上下文",
    "",
    definition.background_context,
    "",
    "## 验收标准",
    "",
    definition.acceptance,
    "",
    "## 允许修改范围",
    "",
    "### Read / discovery context",
    "",
    "- none",
    "",
    "### Allowed Files",
    "",
    definition.allowed_scope,
    "",
    "### Conditional Files",
    "",
    definition.conditional_scope,
    "",
    "## 禁止修改范围",
    "",
    "### Forbidden Files",
    "",
    definition.forbidden_scope,
    "",
    "## 受影响的契约",
    "",
    definition.affected_contracts,
    "",
    "## 已确认决策",
    "",
    definition.confirmed_decisions,
    "",
    "## 待确认问题",
    "",
    definition.open_questions,
    "",
    "## 实现方案",
    "",
    definition.implementation_plan,
    "",
    "## 传播治理记录",
    "",
    optionalSection(definition.propagation_governance),
    "",
    "## 实施步骤",
    "",
    definition.implementation_steps,
    "",
    "## 回归检查项",
    "",
    definition.regression_checks,
    "",
    "## 回滚点",
    "",
    definition.rollback_points,
    "",
    "## 设计约束",
    "",
    optionalSection(definition.design_constraints),
    "",
    "## 发布后验证",
    "",
    optionalSection(definition.post_release_validation),
    "",
    "## 执行记录",
    "",
    "- Draft created by prepare-task; execution is blocked until explicit confirm-draft.",
    ""
  ].join(`
`);
}
function renderCanonicalCurrentTask(frontmatter, body, runtimeState, options = {}) {
  const nextFrontmatter = {
    ...frontmatter,
    ...options.draftDocumentId === undefined ? {} : { document_id: options.draftDocumentId },
    runtime_state: runtimeState
  };
  let nextBody = options.draftDefinition && options.draftIdentity ? renderNewDraftBody(options.draftIdentity, options.draftDefinition, runtimeState) : options.replacementDefinition ? replaceReplanDefinitionSections(body, options.replacementDefinition) : body;
  if (options.draftIdentity && !(options.draftDefinition && options.draftIdentity)) {
    nextBody = replaceTaskInfoField(nextBody, "任务 ID", options.draftIdentity.task_id);
    nextBody = replaceTaskInfoField(nextBody, "任务标题", options.draftIdentity.task_title);
    nextBody = replaceTaskInfoField(nextBody, "任务 slug", options.draftIdentity.task_slug);
  }
  nextBody = renderCurrentTaskLifecycleFields(nextBody, runtimeState);
  if (options.audit)
    nextBody = appendExecutionAuditToBody(nextBody, options.audit);
  return `---
${stringify(nextFrontmatter).trimEnd()}
---
${nextBody}`;
}
function currentTaskPathForRoot(root) {
  const resolvedRoot = path4.resolve(root);
  const profilePath = getWorkflowProfilePath(resolvedRoot);
  if (!fs3.existsSync(profilePath))
    fail2("RUNTIME_SOURCE_MISSING", `PROJECT_PROFILE.yaml is missing: ${profilePath}`);
  const profile = loadProfile(profilePath);
  const filePath = getWorkflowDocPath(resolvedRoot, profile, "CURRENT_TASK.md");
  const relativePath = path4.relative(resolvedRoot, filePath).replace(/\\/g, "/");
  if (!relativePath || relativePath.startsWith("../") || path4.isAbsolute(relativePath))
    fail2("RUNTIME_PATH_INVALID", "CURRENT_TASK path escapes the target root.");
  return { filePath, relativePath: relativePath || CURRENT_TASK_RELATIVE_FALLBACK };
}
function walkMarkdownFiles(directory) {
  if (!fs3.existsSync(directory))
    return [];
  const files = [];
  const visit = (currentDirectory) => {
    for (const entry of fs3.readdirSync(currentDirectory, { withFileTypes: true })) {
      const entryPath = path4.join(currentDirectory, entry.name);
      if (entry.isDirectory())
        visit(entryPath);
      else if (entry.isFile() && entry.name.endsWith(".md"))
        files.push(entryPath);
    }
  };
  visit(directory);
  return files;
}
function allocateNextTaskId(root, currentTaskId) {
  try {
    validateTaskId(currentTaskId);
  } catch (error) {
    fail2("RUNTIME_IDENTITY_INVALID", error instanceof Error ? error.message : String(error));
  }
  const current = BigInt(currentTaskId);
  const taskDirectory = path4.join(path4.resolve(root), "TASKS");
  const usedIds = new Set([current]);
  const taskFilePattern = /^TASK-([0-9]{3,})-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/;
  for (const taskFile of walkMarkdownFiles(taskDirectory)) {
    const match = taskFilePattern.exec(path4.basename(taskFile));
    if (match) {
      usedIds.add(BigInt(match[1]));
    }
  }
  let next = current + 1n;
  while (usedIds.has(next)) {
    next += 1n;
  }
  return next.toString().padStart(Math.max(3, currentTaskId.length), "0");
}
function collectTaskDocumentIds(root) {
  const { filePath } = currentTaskPathForRoot(root);
  const documentIds = new Set;
  const allFiles = [filePath, ...walkMarkdownFiles(path4.join(path4.resolve(root), "TASKS"))];
  for (const file of allFiles) {
    if (!fs3.existsSync(file))
      continue;
    const content = fs3.readFileSync(file, "utf8");
    for (const match of content.matchAll(/^\s*(?:-\s*)?document_id:\s*['"]?(doc-[a-f0-9]{24})['"]?\s*$/gim)) {
      documentIds.add(match[1]);
    }
  }
  return documentIds;
}
function parseCanonicalCurrentTaskContent(raw, filePath, relativePath) {
  const { frontmatter, body } = parseYamlFrontmatter(raw, relativePath);
  if (frontmatter.kind !== VNEXT_CURRENT_TASK_KIND) {
    fail2("MIGRATION_REQUIRED", `${relativePath} is not a pure vNext CURRENT_TASK document; run the Migration Pack.`);
  }
  expectExactKeys2(frontmatter, ["schema_version", "kind", "document_id", "runtime_state"], `${relativePath} frontmatter`);
  if (frontmatter.schema_version !== 1)
    fail2("RUNTIME_SCHEMA_INVALID", `${relativePath}.schema_version must be 1 for a vNext CURRENT_TASK document.`);
  const documentId = expectString2(frontmatter.document_id, `${relativePath}.document_id`);
  if (!DOCUMENT_ID_PATTERN.test(documentId))
    fail2("RUNTIME_SCHEMA_INVALID", `${relativePath}.document_id is invalid.`);
  const runtimeState = validateVNextRuntimeState(frontmatter.runtime_state);
  try {
    parseMutationScope(body, sha2562(raw));
  } catch (error) {
    if (error instanceof MutationScopeError)
      fail2(error.code, error.message);
    fail2("MUTATION_SCOPE_INVALID", error instanceof Error ? error.message : String(error));
  }
  const identity = extractTaskIdentityFromCurrentTask(body);
  const bodyState = extractCurrentTaskStateFromCurrentTask(body);
  if (identity.id !== runtimeState.task_id || identity.slug !== runtimeState.task_slug) {
    fail2("RUNTIME_SOURCE_CONFLICT", "CURRENT_TASK body identity conflicts with runtime_state.");
  }
  if (bodyState.workflowStatus !== runtimeState.workflow_status || bodyState.lifecycleState !== runtimeState.lifecycle_state) {
    fail2("RUNTIME_SOURCE_CONFLICT", "CURRENT_TASK body lifecycle tuple conflicts with runtime_state.");
  }
  if (bodyState.resumeRequiresReview !== runtimeState.resume_requires_review) {
    fail2("RUNTIME_SOURCE_CONFLICT", "CURRENT_TASK body resume gate conflicts with runtime_state.");
  }
  let bodyResumeReasons;
  try {
    bodyResumeReasons = normalizeResumeReviewReasons(bodyState.resumeReviewReasons);
  } catch (error) {
    fail2("RUNTIME_SOURCE_CONFLICT", error instanceof Error ? error.message : String(error));
  }
  if (bodyResumeReasons.join("|") !== runtimeState.resume_review_reasons.join("|")) {
    fail2("RUNTIME_SOURCE_CONFLICT", "CURRENT_TASK body resume review reasons conflict with runtime_state.");
  }
  resolveTaskStepForState(body, runtimeState.active_step_id);
  const sourceTuple = {
    path: relativePath,
    revision: sha2562(raw),
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
  if (!fs3.existsSync(filePath))
    fail2("RUNTIME_SOURCE_MISSING", `CURRENT_TASK.md is missing: ${relativePath}`);
  return parseCanonicalCurrentTaskContent(fs3.readFileSync(filePath, "utf8"), filePath, relativePath);
}
function workflowDocPathForRoot(root, file, missingCode = "RUNTIME_SOURCE_MISSING") {
  const resolvedRoot = path4.resolve(root);
  const profilePath = getWorkflowProfilePath(resolvedRoot);
  if (!fs3.existsSync(profilePath))
    fail2(missingCode, `PROJECT_PROFILE.yaml is missing: ${profilePath}`);
  const profile = loadProfile(profilePath);
  const filePath = getWorkflowDocPath(resolvedRoot, profile, file);
  const relativePath = path4.relative(resolvedRoot, filePath).replace(/\\/g, "/");
  if (!relativePath || relativePath.startsWith("../") || path4.isAbsolute(relativePath)) {
    fail2("RUNTIME_PATH_INVALID", `${file} path escapes the target root.`);
  }
  return { filePath, relativePath };
}
function archivePathForTask(root, current) {
  let relativePath;
  try {
    relativePath = getTaskArtifactPath(current.runtimeState.task_id, current.runtimeState.task_slug, "archive");
  } catch (error) {
    fail2("RUNTIME_PATH_INVALID", error instanceof Error ? error.message : String(error));
  }
  const resolvedRoot = path4.resolve(root);
  const filePath = path4.resolve(resolvedRoot, ...relativePath.split("/"));
  const relativeCheck = path4.relative(resolvedRoot, filePath).replace(/\\/g, "/");
  if (relativeCheck !== relativePath || relativeCheck.startsWith("../") || path4.isAbsolute(relativeCheck)) {
    fail2("RUNTIME_PATH_INVALID", `archive path escapes the target root: ${relativePath}`);
  }
  return { filePath, relativePath };
}
function canonicalInboxRecordTarget(root, delta) {
  const itemId = validateInboxItemId(delta.record.item_id, "semantic_delta.record.item_id");
  const itemSlug = expectString2(delta.item_slug, "semantic_delta.item_slug");
  try {
    validateTaskSlug(itemSlug);
  } catch (error) {
    fail2("RUNTIME_IDENTITY_INVALID", error instanceof Error ? error.message : String(error));
  }
  const relativePath = `TASKS/inbox/INBOX-${itemId}-${itemSlug}.md`;
  if (delta.target_path !== relativePath) {
    fail2("RUNTIME_PATH_INVALID", "inbox target_path is not the canonical identity-derived path.");
  }
  const resolvedRoot = path4.resolve(root);
  const filePath = path4.resolve(resolvedRoot, ...relativePath.split("/"));
  const relativeCheck = path4.relative(resolvedRoot, filePath).replace(/\\/g, "/");
  if (relativeCheck !== relativePath || relativeCheck.startsWith("../") || path4.isAbsolute(relativeCheck)) {
    fail2("RUNTIME_PATH_INVALID", `inbox path escapes the target root: ${relativePath}`);
  }
  return { filePath, relativePath };
}
function renderInboxTextBlock(value) {
  return value.replace(/\r\n?/g, `
`).split(`
`).map((line) => `    ${line}`).join(`
`);
}
function inboxRecordProvenance(proposal) {
  const delta = proposal.semantic_delta;
  return {
    idempotency_key: proposal.idempotency_key,
    proposal_digest: digest(proposal),
    source_revision: proposal.source_tuple.revision,
    source_task_id: proposal.source_tuple.task_id,
    source_task_slug: proposal.source_tuple.task_slug,
    source_document_id: proposal.source_tuple.document_id,
    relation_evidence_refs: [...delta.relation_evidence_refs],
    duplicate_check: delta.duplicate_check,
    proposed_owner: delta.proposed_owner
  };
}
function renderInboxRecord(proposal) {
  const delta = proposal.semantic_delta;
  const record = delta.record;
  const marker = `<!-- vNext inbox record: ${JSON.stringify(inboxRecordProvenance(proposal))} -->`;
  return [
    `# INBOX-${record.item_id}-${delta.item_slug}`,
    "",
    marker,
    "",
    `- artifact_kind: ${record.artifact_kind}`,
    `- item_id: ${record.item_id}`,
    `- title: ${record.title}`,
    `- type: ${record.type}`,
    `- source: ${record.source}`,
    `- captured_at: ${record.captured_at}`,
    `- relation_to_current_task: ${record.relation_to_current_task}`,
    `- current_task_id: ${record.current_task_id}`,
    "- description: |",
    renderInboxTextBlock(record.description),
    "- evidence: |",
    renderInboxTextBlock(record.evidence),
    `- suggested_next_action: ${record.suggested_next_action}`,
    `- status: ${record.status}`,
    ""
  ].join(`
`);
}
function validateInboxProvenance(value, location) {
  const record = expectRecord2(value, location);
  expectExactKeys2(record, ["idempotency_key", "proposal_digest", "source_revision", "source_task_id", "source_task_slug", "source_document_id", "relation_evidence_refs", "duplicate_check", "proposed_owner"], location);
  const proposalDigest = expectString2(record.proposal_digest, `${location}.proposal_digest`);
  const sourceRevision = expectString2(record.source_revision, `${location}.source_revision`);
  if (!SHA256_PATTERN2.test(proposalDigest) || !SHA256_PATTERN2.test(sourceRevision)) {
    fail2("INBOX_PROVENANCE_INVALID", `${location} contains an invalid proposal or source revision.`);
  }
  const sourceTaskId = expectString2(record.source_task_id, `${location}.source_task_id`);
  const sourceTaskSlug = expectString2(record.source_task_slug, `${location}.source_task_slug`);
  try {
    validateTaskId(sourceTaskId);
    validateTaskSlug(sourceTaskSlug);
  } catch (error) {
    fail2("INBOX_PROVENANCE_INVALID", error instanceof Error ? error.message : String(error));
  }
  const sourceDocumentId = expectString2(record.source_document_id, `${location}.source_document_id`);
  if (!DOCUMENT_ID_PATTERN.test(sourceDocumentId))
    fail2("INBOX_PROVENANCE_INVALID", `${location}.source_document_id is invalid.`);
  return {
    idempotency_key: expectString2(record.idempotency_key, `${location}.idempotency_key`, SAFE_KEY_PATTERN2),
    proposal_digest: proposalDigest,
    source_revision: sourceRevision,
    source_task_id: sourceTaskId,
    source_task_slug: sourceTaskSlug,
    source_document_id: sourceDocumentId,
    relation_evidence_refs: validateEvidenceRefs(record.relation_evidence_refs, `${location}.relation_evidence_refs`),
    duplicate_check: expectEnum(record.duplicate_check, ["clear"], `${location}.duplicate_check`),
    proposed_owner: expectEnum(record.proposed_owner, INBOX_SUGGESTED_NEXT_ACTIONS, `${location}.proposed_owner`)
  };
}
function readInboxProvenanceMarkers(content, location) {
  if (!content.includes(INBOX_RECORD_PROVENANCE_MARKER))
    return [];
  const pattern = /<!-- vNext inbox record: (\{[^\r\n]+\}) -->/g;
  const markers = [];
  for (const match of content.matchAll(pattern)) {
    let parsed;
    try {
      parsed = JSON.parse(match[1]);
    } catch {
      fail2("INBOX_PROVENANCE_INVALID", `${location} contains an invalid vNext inbox provenance marker.`);
    }
    markers.push(validateInboxProvenance(parsed, `${location}.inbox_marker`));
  }
  if (countExactOccurrences(content, INBOX_RECORD_PROVENANCE_MARKER) !== markers.length) {
    fail2("INBOX_PROVENANCE_INVALID", `${location} contains a malformed vNext inbox provenance marker.`);
  }
  return markers;
}
function scanInboxRecordFiles(root) {
  const resolvedRoot = path4.resolve(root);
  const inboxRoot = path4.join(resolvedRoot, "TASKS", "inbox");
  return walkMarkdownFiles(inboxRoot).map((filePath) => {
    const relativePath = path4.relative(resolvedRoot, filePath).replace(/\\/g, "/");
    const pathMatch = INBOX_RECORD_PATH_PATTERN.exec(relativePath);
    const content = fs3.readFileSync(filePath, "utf8");
    const provenance = readInboxProvenanceMarkers(content, relativePath);
    if (provenance.length > 0 && !pathMatch) {
      fail2("INBOX_PATH_INVALID", `${relativePath} contains vNext inbox provenance but is not a canonical inbox path.`);
    }
    if (!pathMatch) {
      fail2("INBOX_PATH_INVALID", `${relativePath} is not a canonical vNext inbox record path.`);
    }
    return {
      filePath,
      relativePath,
      itemId: pathMatch ? `${pathMatch[1]}-${pathMatch[2]}` : null,
      provenance
    };
  });
}
function assertCanonicalInboxRecordContent(content, proposal, location) {
  const expected = renderInboxRecord(proposal);
  if (content !== expected) {
    fail2("INBOX_PROVENANCE_MISMATCH", `${location} does not match the exact typed inbox record bytes.`);
  }
  const markers = readInboxProvenanceMarkers(content, location);
  if (markers.length !== 1)
    fail2("INBOX_PROVENANCE_INVALID", `${location} must contain exactly one vNext inbox provenance marker.`);
  const expectedMarker = inboxRecordProvenance(proposal);
  if (JSON.stringify(markers[0]) !== JSON.stringify(expectedMarker)) {
    fail2("INBOX_PROVENANCE_MISMATCH", `${location} provenance does not match the typed proposal.`);
  }
  validateInboxRecord(proposal.semantic_delta.record, `${location}.record`);
}
function inspectInboxRecordTransaction(root, proposal) {
  const delta = proposal.semantic_delta;
  const target = canonicalInboxRecordTarget(root, delta);
  if (fs3.existsSync(target.filePath)) {
    if (!fs3.statSync(target.filePath).isFile()) {
      fail2("INBOX_IDENTITY_CONFLICT", `${target.relativePath} exists but is not a regular inbox record file.`);
    }
    const existingContent = fs3.readFileSync(target.filePath, "utf8");
    try {
      assertCanonicalInboxRecordContent(existingContent, proposal, target.relativePath);
    } catch (error) {
      if (error instanceof VNextRuntimeError)
        fail2("INBOX_IDENTITY_CONFLICT", `${target.relativePath} already exists with different semantic or provenance content.`);
      fail2("INBOX_IDENTITY_CONFLICT", `${target.relativePath} could not be validated as the exact replay record.`);
    }
    return { ...target, nextContent: existingContent, existing: true };
  }
  const files = scanInboxRecordFiles(root);
  for (const file of files) {
    if (file.itemId === delta.record.item_id && file.relativePath !== target.relativePath) {
      fail2("INBOX_IDENTITY_CONFLICT", `inbox item identity ${delta.record.item_id} is already claimed by ${file.relativePath}.`);
    }
    if (file.provenance.some((marker) => marker.idempotency_key === proposal.idempotency_key && file.relativePath !== target.relativePath)) {
      fail2("IDEMPOTENCY_CONFLICT", "inbox idempotency key is already durably bound to another target.");
    }
  }
  return { ...target, nextContent: renderInboxRecord(proposal), existing: false };
}
function prepareInboxRecordTransaction(root, current, proposal) {
  ensureAuthorityKinds(proposal, ["evidence-admission"]);
  if (current.runtimeState.workflow_status !== "active" || current.runtimeState.lifecycle_state !== "active") {
    fail2("INBOX_CAPTURE_BLOCKED", "inbox record capture requires an active + active current task.");
  }
  const delta = proposal.semantic_delta;
  if (delta.record.current_task_id !== current.runtimeState.task_id) {
    fail2("INBOX_RELATION_INVALID", "inbox record current_task_id does not match the canonical active task.");
  }
  return inspectInboxRecordTransaction(root, proposal);
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
    fail2("ARCHIVE_INVALID", `${location} is missing ${field}.`);
  const raw = match[1].trim();
  if (raw.startsWith('"') || raw.startsWith("'")) {
    try {
      return JSON.parse(raw);
    } catch {
      fail2("ARCHIVE_INVALID", `${location}.${field} is not a valid scalar.`);
    }
  }
  return expectString2(raw, `${location}.${field}`);
}
function readArchiveArray(raw, location) {
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    fail2("ARCHIVE_INVALID", `${location} must be a JSON/YAML inline string array.`);
  }
  return expectStringArray2(parsed, location, true, MAX_EVIDENCE_REFS);
}
function readArchiveLessonAdmission(section, location) {
  const match = /(?:^|\n)lesson_admission:\s*\n\s+decision:\s*(admit|defer|no-op)\s*\n\s+candidate_refs:\s*(\[[^\r\n]*\])\s*\n\s+evidence_refs:\s*(\[[^\r\n]*\])/m.exec(section);
  if (!match)
    fail2("ARCHIVE_INVALID", `${location} is missing the durable lesson_admission record.`);
  return validateLessonAdmission({
    decision: match[1],
    candidate_refs: readArchiveArray(match[2], `${location}.candidate_refs`),
    evidence_refs: readArchiveArray(match[3], `${location}.evidence_refs`)
  }, location);
}
function readArchiveKnowledgeAdmissions(section, location) {
  const match = /(?:^|\n)knowledge_admissions:\s*\n\s+contracts:\s*(\[[^\r\n]*\])\s*\n\s+decisions:\s*(\[[^\r\n]*\])/m.exec(section);
  if (!match)
    fail2("ARCHIVE_INVALID", `${location} is missing the durable knowledge_admissions record.`);
  let contracts;
  let decisions;
  try {
    contracts = JSON.parse(match[1]);
    decisions = JSON.parse(match[2]);
  } catch {
    fail2("ARCHIVE_INVALID", `${location}.knowledge_admissions must contain valid JSON arrays.`);
  }
  return validateKnowledgeAdmissionBundle({ contracts, decisions }, location);
}
function requiredArchiveSections(raw) {
  const sections = scanMarkdownSections2(raw);
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
      fail2("ARCHIVE_INVALID", `canonical task archive is missing ## ${heading}.`);
    result[heading] = section;
  }
  return result;
}
function readCanonicalArchive(root, current, expectedPath) {
  const expected = archivePathForTask(root, current);
  if (expectedPath !== undefined && expectedPath !== expected.relativePath) {
    fail2("RUNTIME_PATH_INVALID", "archive path is not the exact identity-derived path.");
  }
  if (!fs3.existsSync(expected.filePath))
    fail2("ARCHIVE_MISSING", `canonical task archive is missing: ${expected.relativePath}`);
  const raw = fs3.readFileSync(expected.filePath, "utf8");
  const sections = requiredArchiveSections(raw);
  const metadata = raw.slice(sections["任务元数据"].contentStart, sections["任务元数据"].contentEnd);
  const lessonSection = raw.slice(sections["Lessons 回写"].contentStart, sections["Lessons 回写"].contentEnd);
  const knowledgeSection = findUniqueMarkdownSection(scanMarkdownSections2(raw), ["知识晋升", "Knowledge Promotion"], 2);
  const workflowStatus = readArchiveScalar(metadata, "workflow_status", "archive.任务元数据");
  const lifecycleState = readArchiveScalar(metadata, "lifecycle_state", "archive.任务元数据");
  const archiveOperation = readArchiveScalar(metadata, "archive_operation", "archive.任务元数据");
  const archiveCaller = readArchiveScalar(metadata, "archive_caller", "archive.任务元数据");
  const receipt = {
    filePath: expected.filePath,
    relativePath: expected.relativePath,
    raw,
    revision: sha2562(raw),
    taskId: readArchiveScalar(metadata, "task_id", "archive.任务元数据"),
    taskSlug: readArchiveScalar(metadata, "task_slug", "archive.任务元数据"),
    taskTitle: readArchiveScalar(metadata, "task_title", "archive.任务元数据"),
    documentId: readArchiveScalar(metadata, "document_id", "archive.任务元数据"),
    sourceRevision: readArchiveScalar(metadata, "source_revision", "archive.任务元数据"),
    archivePath: readArchiveScalar(metadata, "archive_path", "archive.任务元数据"),
    idempotencyKey: readArchiveScalar(metadata, "proposal_idempotency_key", "archive.任务元数据"),
    closureDeltaDigest: readArchiveScalar(metadata, "closure_delta_digest", "archive.任务元数据"),
    lessonAdmission: readArchiveLessonAdmission(lessonSection, "archive.Lessons 回写.lesson_admission"),
    knowledgeAdmissions: knowledgeSection ? readArchiveKnowledgeAdmissions(raw.slice(knowledgeSection.contentStart, knowledgeSection.contentEnd), "archive.知识晋升.knowledge_admissions") : emptyKnowledgeAdmissionBundle()
  };
  if (!/^[a-f0-9]{64}$/.test(receipt.revision) || !/^[a-f0-9]{64}$/.test(receipt.sourceRevision) || !/^[a-f0-9]{64}$/.test(receipt.closureDeltaDigest)) {
    fail2("ARCHIVE_INVALID", "canonical task archive contains an invalid revision or digest.");
  }
  if (!SAFE_KEY_PATTERN2.test(receipt.idempotencyKey) || !DOCUMENT_ID_PATTERN.test(receipt.documentId)) {
    fail2("ARCHIVE_INVALID", "canonical task archive contains an invalid idempotency key or document_id.");
  }
  if (workflowStatus !== "closed" || lifecycleState !== "archived" || archiveOperation !== "archive-transaction" || archiveCaller !== "close-task") {
    fail2("ARCHIVE_PROVENANCE_MISMATCH", "archive metadata does not declare the frozen close-task terminal provenance.");
  }
  if (receipt.taskId !== current.runtimeState.task_id || receipt.taskSlug !== current.runtimeState.task_slug) {
    fail2("ARCHIVE_PROVENANCE_MISMATCH", "archive identity does not match CURRENT_TASK.");
  }
  const identity = extractTaskIdentityFromCurrentTask(current.body);
  if (identity.title === null || receipt.taskTitle !== identity.title)
    fail2("ARCHIVE_PROVENANCE_MISMATCH", "archive task_title does not match CURRENT_TASK.");
  if (receipt.documentId !== String(current.frontmatter.document_id))
    fail2("ARCHIVE_PROVENANCE_MISMATCH", "archive document_id does not match CURRENT_TASK.");
  if (receipt.archivePath !== expected.relativePath)
    fail2("ARCHIVE_PROVENANCE_MISMATCH", "archive metadata path does not match its canonical path.");
  return receipt;
}
function archiveAudits(current) {
  return current.runtimeState.execution_log.filter((item) => ("action" in item) && item.action === "archive");
}
function assertArchiveReceiptMatches(current, receipt, audit) {
  if (current.runtimeState.workflow_status !== "closed" || current.runtimeState.lifecycle_state !== "archived") {
    fail2("LIFECYCLE_REPLAY_INCOMPLETE", "archive receipt requires the closed + archived CURRENT_TASK tuple.");
  }
  if (audit.task_id !== current.runtimeState.task_id || audit.task_slug !== current.runtimeState.task_slug || audit.document_id !== String(current.frontmatter.document_id)) {
    fail2("ARCHIVE_PROVENANCE_MISMATCH", "archive audit identity does not match CURRENT_TASK.");
  }
  if (audit.archive_path !== receipt.relativePath || audit.archive_revision !== receipt.revision || audit.source_revision !== receipt.sourceRevision || audit.idempotency_key !== receipt.idempotencyKey || audit.closure_delta_digest !== receipt.closureDeltaDigest) {
    fail2("ARCHIVE_PROVENANCE_MISMATCH", "archive receipt does not match the durable CURRENT_TASK archive audit.");
  }
  if (audit.lesson_admission.decision !== receipt.lessonAdmission.decision || audit.lesson_admission.candidate_refs.join("|") !== receipt.lessonAdmission.candidate_refs.join("|") || audit.lesson_admission.evidence_refs.join("|") !== receipt.lessonAdmission.evidence_refs.join("|")) {
    fail2("ARCHIVE_PROVENANCE_MISMATCH", "archive lesson admission does not match the durable CURRENT_TASK archive audit.");
  }
  if (digest(audit.knowledge_admissions) !== digest(receipt.knowledgeAdmissions)) {
    fail2("ARCHIVE_PROVENANCE_MISMATCH", "archive knowledge admission does not match the durable CURRENT_TASK archive audit.");
  }
}
function matchingArchiveReceipt(root, current) {
  const audits = archiveAudits(current);
  if (audits.length !== 1)
    fail2("LIFECYCLE_REPLAY_INCOMPLETE", "CURRENT_TASK must contain exactly one durable archive audit for reconciliation.");
  const audit = audits[0];
  assertExecutionAuditInBody(current.body, audit);
  if (audit.from_workflow_status !== "active" || audit.from_lifecycle_state !== "active" || audit.to_workflow_status !== "closed" || audit.to_lifecycle_state !== "archived") {
    fail2("LIFECYCLE_REPLAY_INCOMPLETE", "archive audit does not describe the frozen active + active to closed + archived transition.");
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
    const stepResolution = resolveCanonicalTaskStep(current);
    const checkpoint = effectiveCheckpointPolicy(stepResolution);
    if (stepResolution.next !== null) {
      blockers.push("remaining implementation steps have not been durably advanced to completion.");
    }
    if (stepResolution.steps.length > 1) {
      const completedRecord = current.runtimeState.execution_log.find((item) => !("action" in item) && item.step_id === stepResolution.current.id && item.status === "completed" && item.advancement === "task-complete");
      if (!completedRecord)
        blockers.push("the final multi-step completion lacks a durable task-complete advancement record.");
      if (checkpoint === "required" && !completedRecord?.review_receipt) {
        blockers.push("the final required review checkpoint has no durable clean receipt.");
      }
    }
    const repairRecords = current.runtimeState.execution_log.filter((item) => !("action" in item) && item.step_id === stepResolution.current.id && item.mode === "repair");
    if (repairRecords.length > 0) {
      const repairFingerprints = [...new Set(repairRecords.map((item) => item.repair_fingerprint).filter((value) => Boolean(value)))];
      const repairTargets = [...new Set(repairRecords.map((item) => item.diff_target).filter((value) => Boolean(value)))];
      const verified = current.runtimeState.execution_log.some((item) => {
        if ("action" in item || item.step_id !== stepResolution.current.id || item.review_receipt?.cycle_phase !== "verification")
          return false;
        const receipt = item.review_receipt;
        return receipt !== undefined && receipt.admitted_fingerprints.length === repairFingerprints.length && repairFingerprints.every((fingerprint) => receipt.admitted_fingerprints.includes(fingerprint)) && (repairTargets.length === 0 || receipt.diff_target === repairTargets[0]);
      });
      if (!verified)
        blockers.push("every repair route must have a durable same-diff verification receipt before closure.");
      if (repairRecords.some((item) => !item.repair_fingerprint || !item.diff_target))
        blockers.push("a repair execution record is missing its finding fingerprint or logical diff target.");
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
  if (audit.idempotency_key !== proposal.idempotency_key || audit.source_revision !== proposal.source_tuple.revision || audit.task_id !== proposal.source_tuple.task_id || audit.task_slug !== proposal.source_tuple.task_slug || audit.document_id !== proposal.source_tuple.document_id || audit.closure_delta_digest !== digest(proposal.semantic_delta) || audit.evidence_refs.join("|") !== proposal.semantic_delta.evidence_refs.join("|") || digest(audit.authority_evidence) !== digest(proposal.authority_evidence) || digest(audit.knowledge_admissions) !== digest(proposal.semantic_delta.knowledge_admissions ?? emptyKnowledgeAdmissionBundle()) || receipt.revision !== audit.archive_revision) {
    fail2("LIFECYCLE_REPLAY_INCOMPLETE", "archive replay identity, source revision, closure evidence, or archive revision does not match the committed receipt.");
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
    fail2("RUNTIME_IDENTITY_INVALID", "CURRENT_TASK task identity is incomplete for archive rendering.");
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
    "- affected_contracts: preserved in the CURRENT_TASK snapshot; admitted Contract candidates are reconciled after archive through the typed Runtime operation.",
    "- confirmed_decisions: preserved in the CURRENT_TASK snapshot; admitted Decision candidates are reconciled after archive through the typed Runtime operation.",
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
    "## 知识晋升",
    "",
    "knowledge_admissions:",
    `  contracts: ${JSON.stringify(delta.knowledge_admissions?.contracts ?? [])}`,
    `  decisions: ${JSON.stringify(delta.knowledge_admissions?.decisions ?? [])}`,
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
    knowledge_admissions: {
      contracts: (delta.knowledge_admissions?.contracts ?? []).map((item) => ({
        candidate: item.candidate,
        disposition: item.disposition,
        matched_knowledge_id: item.matched_knowledge_id,
        reasons: [...item.reasons]
      })),
      decisions: (delta.knowledge_admissions?.decisions ?? []).map((item) => ({
        candidate: item.candidate,
        disposition: item.disposition,
        matched_knowledge_id: item.matched_knowledge_id,
        reasons: [...item.reasons]
      }))
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
      fail2("ARCHIVE_PROVENANCE_MISMATCH", "reconciliation closure evidence does not match the committed archive receipt.");
    }
    if (delta.lesson_admission.decision !== audit2.lesson_admission.decision || delta.lesson_admission.candidate_refs.join("|") !== audit2.lesson_admission.candidate_refs.join("|") || delta.lesson_admission.evidence_refs.join("|") !== audit2.lesson_admission.evidence_refs.join("|")) {
      fail2("ARCHIVE_PROVENANCE_MISMATCH", "reconciliation lesson admission does not match the committed archive receipt.");
    }
    if (digest(delta.knowledge_admissions ?? emptyKnowledgeAdmissionBundle()) !== digest(audit2.knowledge_admissions)) {
      fail2("ARCHIVE_PROVENANCE_MISMATCH", "reconciliation knowledge admission does not match the committed archive receipt.");
    }
    if (receipt.sourceRevision !== audit2.source_revision)
      fail2("ARCHIVE_PROVENANCE_MISMATCH", "archive source revision does not match the committed archive audit.");
    return null;
  }
  if (current.runtimeState.workflow_status !== "active" || current.runtimeState.lifecycle_state !== "active") {
    fail2("CLOSURE_TUPLE_INVALID", "first successful close requires active + active.");
  }
  const archiveTarget = archivePathForTask(root, current);
  const blockers = closureEligibilityBlockers(current, delta, fs3.existsSync(archiveTarget.filePath));
  if (blockers.length > 0)
    fail2("CLOSURE_NOT_ELIGIBLE", blockers.join(" "));
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
  const archiveRevision = sha2562(nextArchiveContent);
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
    fail2("STATUS_INVALID", `${location} reconciliation receipt is missing ${field}.`);
  const raw = match[1].trim();
  if (raw.startsWith('"') || raw.startsWith("'")) {
    try {
      return JSON.parse(raw);
    } catch {
      fail2("STATUS_INVALID", `${location}.${field} is not a valid scalar.`);
    }
  }
  return expectString2(raw, `${location}.${field}`);
}
function readStatusArray(body, field, location) {
  const raw = readStatusScalar(body, field, location);
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    fail2("STATUS_INVALID", `${location}.${field} must be a JSON/YAML inline string array.`);
  }
  return expectStringArray2(parsed, `${location}.${field}`, true, 64);
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
      fail2("STATUS_INVALID", `${location} reconciliation receipt has an invalid revision or digest.`);
    }
    const receipt = {
      taskId: readStatusScalar(body, "task_id", location),
      taskSlug: readStatusScalar(body, "task_slug", location),
      documentId: readStatusScalar(body, "document_id", location),
      archivePath: normalizeRepoPath2(readStatusScalar(body, "archive_path", location), `${location}.archive_path`),
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
    if (!SAFE_KEY_PATTERN2.test(receipt.idempotencyKey))
      fail2("STATUS_INVALID", `${location}.proposal_idempotency_key is invalid.`);
    if (!DOCUMENT_ID_PATTERN.test(receipt.documentId))
      fail2("STATUS_INVALID", `${location}.document_id is invalid.`);
    try {
      validateTaskId(receipt.taskId);
      validateTaskSlug(receipt.taskSlug);
    } catch (error) {
      fail2("STATUS_INVALID", error instanceof Error ? error.message : String(error));
    }
    if (digest(statusDeltaFromReceipt(receipt)) !== receipt.deltaDigest) {
      fail2("STATUS_INVALID", `${location} reconciliation receipt delta digest does not match its typed fields.`);
    }
    if (receipts.some((existing) => existing.archivePath === receipt.archivePath)) {
      fail2("STATUS_INVALID", `${location} contains duplicate reconciliation receipts for ${receipt.archivePath}.`);
    }
    receipts.push(receipt);
  }
  return receipts;
}
function matchingStatusReceipt(content, location, archive) {
  const receipts = readStatusReceipts(content, location);
  const matches = receipts.filter((receipt) => receipt.archivePath === archive.relativePath || receipt.taskId === archive.taskId && receipt.taskSlug === archive.taskSlug && receipt.documentId === archive.documentId);
  if (matches.length > 1)
    fail2("STATUS_INVALID", `${location} contains multiple receipts for the same archived task.`);
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
    fail2("STATUS_RECONCILIATION_CONFLICT", `${location} cannot contain a line break.`);
  }
  return value.trim();
}
function readStatusSectionLines(content, title, location) {
  const section = findUniqueMarkdownSection(scanMarkdownSections2(content), [title], 2);
  if (!section)
    fail2("STATUS_INVALID", `${location} is missing the required ## ${title} section.`);
  const body = content.slice(section.contentStart, section.contentEnd).replace(/\r\n?/g, `
`).trim();
  return body.length > 0 ? body.split(`
`) : [];
}
function replaceStatusSectionBody(content, title, lines, location) {
  const section = findUniqueMarkdownSection(scanMarkdownSections2(content), [title], 2);
  if (!section)
    fail2("STATUS_INVALID", `${location} is missing the required ## ${title} section.`);
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
    fail2("STATUS_RECONCILIATION_CONFLICT", `${location} contains multiple project status fields.`);
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
    fail2("STATUS_RECONCILIATION_CONFLICT", `${location} contains unsupported content in the in-progress section; the old record cannot be identified deterministically.`);
  }
  const meaningfulDevelopment = developmentLines.map(statusItemText).filter((item) => item !== null);
  const removeDevelopmentIndexes = new Set;
  const appendCompleted = [];
  for (const rawItem of delta.completed_items) {
    const item = validateStatusProjectionText(rawItem, `${location}.completed_items`);
    const completedMatches = statusItemMatchCount(completedLines, item);
    if (completedMatches > 1)
      fail2("STATUS_RECONCILIATION_CONFLICT", `${location} contains duplicate completed item "${item}".`);
    const developmentMatches = developmentLines.map((line, index) => ({ line, index })).filter((entry) => statusItemText(entry.line) === item);
    if (developmentMatches.length > 1) {
      fail2("STATUS_RECONCILIATION_CONFLICT", `${location} cannot determine which in-progress record to remove for "${item}".`);
    }
    if (developmentMatches.length === 0 && completedMatches === 0 && meaningfulDevelopment.length > 0) {
      fail2("STATUS_RECONCILIATION_CONFLICT", `${location} cannot deterministically map completed item "${item}" to the existing in-progress records.`);
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
      fail2("STATUS_RECONCILIATION_CONFLICT", `${location} contains duplicate remaining risk "${item}".`);
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
    fail2("STATUS_RECONCILIATION_CONFLICT", `${location} next checkpoint section contains unsupported non-list content.`);
  }
  if (nonEmpty.filter((line) => statusItemText(line) !== null).length > 1) {
    fail2("STATUS_RECONCILIATION_CONFLICT", `${location} contains multiple next checkpoint records.`);
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
    fail2("STATUS_PROVENANCE_MISMATCH", `${location} project status projection no longer matches the typed status delta.`);
  }
  const completedLines = readStatusSectionLines(content, "✅ 已完成且稳定", location);
  const developmentLines = readStatusSectionLines(content, "\uD83D\uDD28 正在开发", location);
  for (const rawItem of delta.completed_items) {
    const item = validateStatusProjectionText(rawItem, `${location}.completed_items`);
    if (statusItemMatchCount(completedLines, item) !== 1 || statusItemMatchCount(developmentLines, item) !== 0) {
      fail2("STATUS_PROVENANCE_MISMATCH", `${location} completed item projection no longer matches "${item}".`);
    }
  }
  const riskLines = readStatusSectionLines(content, "⚠️ 已知风险 / 观察点", location);
  for (const rawItem of delta.remaining_risks) {
    const item = validateStatusProjectionText(rawItem, `${location}.remaining_risks`);
    if (statusItemMatchCount(riskLines, item) !== 1) {
      fail2("STATUS_PROVENANCE_MISMATCH", `${location} remaining risk projection no longer matches "${item}".`);
    }
  }
  const checkpointLines = readStatusSectionLines(content, "\uD83D\uDD1C 下一检查点", location);
  if (checkpointLines.filter((line) => statusItemText(line) !== null).length !== 1 || statusItemText(checkpointLines.find((line) => statusItemText(line) !== null) ?? "") !== delta.next_checkpoint) {
    fail2("STATUS_PROVENANCE_MISMATCH", `${location} next checkpoint projection no longer matches the typed status delta.`);
  }
}
function appendStatusReconciliation(content, marker, location) {
  const section = findUniqueMarkdownSection(scanMarkdownSections2(content), ["最近更新记录", "Recent Updates"], 2);
  if (!section)
    fail2("STATUS_INVALID", `${location} is missing the required ## 最近更新记录 section.`);
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
  if (!fs3.existsSync(target.filePath))
    fail2("RUNTIME_SOURCE_MISSING", `STATUS.md is missing: ${target.relativePath}`);
  const originalStatusContent = fs3.readFileSync(target.filePath, "utf8");
  const sections = scanMarkdownSections2(originalStatusContent);
  for (const heading of ["项目概览", "✅ 已完成且稳定", "\uD83D\uDD28 正在开发", "\uD83D\uDCCB 待开发", "⚠️ 已知风险 / 观察点", "❌ 已移除 / 推迟", "\uD83D\uDD1C 下一检查点", "最近更新记录"]) {
    if (!findUniqueMarkdownSection(sections, [heading], 2))
      fail2("STATUS_INVALID", `STATUS.md is missing required ## ${heading} section.`);
  }
  const existingReceipt = matchingStatusReceipt(originalStatusContent, target.relativePath, receipt);
  const deltaDigest = digest(proposal.semantic_delta);
  if (existingReceipt) {
    if (existingReceipt.taskId !== receipt.taskId || existingReceipt.taskSlug !== receipt.taskSlug || existingReceipt.documentId !== receipt.documentId || existingReceipt.archivePath !== receipt.relativePath || existingReceipt.archiveRevision !== receipt.revision || existingReceipt.sourceRevision !== receipt.sourceRevision) {
      fail2("STATUS_PROVENANCE_MISMATCH", "STATUS reconciliation receipt does not match the canonical archive.");
    }
    if (existingReceipt.deltaDigest !== deltaDigest || existingReceipt.status !== proposal.semantic_delta.status) {
      fail2("STATUS_RECONCILIATION_CONFLICT", "STATUS already contains a different reconciliation for this archived task.");
    }
    if (digest(statusDeltaFromReceipt(existingReceipt)) !== deltaDigest) {
      fail2("STATUS_RECONCILIATION_CONFLICT", "STATUS reconciliation receipt no longer matches its typed status delta.");
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
    statusRevision: sha2562(nextStatusContent),
    archive: receipt
  };
}
function lessonCandidateDigest(candidate) {
  return digest({
    category: candidate.category,
    scene: candidate.scene,
    conclusion: candidate.conclusion,
    trigger: candidate.trigger,
    cause: candidate.cause,
    action: candidate.action,
    consumer: candidate.consumer
  });
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
    candidate_digest: lessonCandidateDigest(candidate),
    evidence_refs: candidate.evidence_refs
  })} -->`;
}
function expectLessonRecord(value, location) {
  if (!isRecord2(value))
    fail2("LESSON_INVALID", `${location} is not a canonical Lesson marker mapping.`);
  return value;
}
function expectLessonExactKeys(value, expected, location) {
  const expectedSet = new Set(expected);
  const missing = expected.filter((key) => !(key in value));
  const extra = Object.keys(value).filter((key) => !expectedSet.has(key));
  if (missing.length === 0 && extra.length === 0)
    return;
  const details = [];
  if (missing.length > 0)
    details.push(`missing=[${missing.join(", ")}]`);
  if (extra.length > 0)
    details.push(`unsupported Lesson marker field(s)=[${extra.join(", ")}]`);
  fail2("LESSON_INVALID", `${location} is a non-canonical Lesson marker (${details.join("; ")}).`);
}
function expectLessonString(value, location, pattern) {
  if (typeof value !== "string" || value.trim().length === 0) {
    fail2("LESSON_INVALID", `${location} must be a non-empty string.`);
  }
  const normalized = value.trim();
  if (pattern && !pattern.test(normalized)) {
    fail2("LESSON_INVALID", `${location} has an invalid value.`);
  }
  return normalized;
}
function validateLessonTaskSlug(value, location) {
  const taskSlug = expectLessonString(value, location);
  try {
    validateTaskSlug(taskSlug);
  } catch (error) {
    fail2("LESSON_INVALID", error instanceof Error ? error.message : String(error));
  }
  return taskSlug;
}
function validateLessonCandidateKey(value, location) {
  if (!isRecord2(value))
    fail2("LESSON_INVALID", `${location} must be a mapping.`);
  const taskId = expectLessonString(value.task_id, `${location}.task_id`);
  try {
    validateTaskId(taskId);
  } catch (error) {
    fail2("LESSON_INVALID", error instanceof Error ? error.message : String(error));
  }
  const documentId = expectLessonString(value.document_id, `${location}.document_id`);
  if (!DOCUMENT_ID_PATTERN.test(documentId)) {
    fail2("LESSON_INVALID", `${location}.document_id is invalid.`);
  }
  const archiveRevision = expectLessonString(value.archive_revision, `${location}.archive_revision`);
  if (!SHA256_PATTERN2.test(archiveRevision)) {
    fail2("LESSON_INVALID", `${location}.archive_revision must be an exact SHA-256.`);
  }
  const candidateRef = expectLessonString(value.candidate_ref, `${location}.candidate_ref`, SAFE_KEY_PATTERN2);
  return {
    task_id: taskId,
    document_id: documentId,
    archive_revision: archiveRevision,
    candidate_ref: candidateRef
  };
}
function readLessonMarkers(content, location) {
  const pattern = /<!-- vNext lesson record: (\{[^\r\n]+\}) -->/g;
  const result = [];
  for (const match of content.matchAll(pattern)) {
    let parsed;
    try {
      parsed = JSON.parse(match[1]);
    } catch {
      fail2("LESSON_INVALID", `${location} contains an invalid vNext lesson provenance marker.`);
    }
    const record = expectLessonRecord(parsed, `${location}.lesson_marker`);
    const hasDisposition = "disposition" in record;
    if (hasDisposition) {
      if (record.disposition !== "reused") {
        fail2("LESSON_INVALID", `${location}.lesson_marker has an invalid Lesson marker disposition: ${String(record.disposition)}.`);
      }
      expectLessonExactKeys(record, ["task_id", "task_slug", "document_id", "archive_path", "archive_revision", "source_revision", "candidate_ref", "candidate_digest", "evidence_refs", "disposition", "reused_candidate"], `${location}.lesson_marker`);
    } else {
      expectLessonExactKeys(record, ["task_id", "task_slug", "document_id", "archive_path", "archive_revision", "source_revision", "candidate_ref", "candidate_digest", "evidence_refs"], `${location}.lesson_marker`);
    }
    const archiveRevision = expectLessonString(record.archive_revision, `${location}.lesson_marker.archive_revision`);
    const sourceRevision = expectLessonString(record.source_revision, `${location}.lesson_marker.source_revision`);
    const candidateDigest = expectLessonString(record.candidate_digest, `${location}.lesson_marker.candidate_digest`);
    if (!SHA256_PATTERN2.test(archiveRevision) || !SHA256_PATTERN2.test(sourceRevision) || !SHA256_PATTERN2.test(candidateDigest)) {
      fail2("LESSON_INVALID", `${location} contains a non-canonical Lesson marker revision or digest.`);
    }
    const candidateIdentity = validateLessonCandidateKey(record, `${location}.lesson_marker`);
    const taskSlug = validateLessonTaskSlug(record.task_slug, `${location}.lesson_marker.task_slug`);
    const marker = {
      task_id: candidateIdentity.task_id,
      task_slug: taskSlug,
      document_id: candidateIdentity.document_id,
      archive_path: normalizeRepoPath2(expectLessonString(record.archive_path, `${location}.lesson_marker.archive_path`), `${location}.lesson_marker.archive_path`),
      archive_revision: candidateIdentity.archive_revision,
      source_revision: sourceRevision,
      candidate_ref: candidateIdentity.candidate_ref,
      candidate_digest: candidateDigest,
      evidence_refs: validateEvidenceRefs(record.evidence_refs, `${location}.lesson_marker.evidence_refs`)
    };
    if (hasDisposition) {
      if (!isRecord2(record.reused_candidate)) {
        fail2("LESSON_INVALID", `${location}.lesson_marker.reused_candidate must be a mapping.`);
      }
      const reusedRecord = record.reused_candidate;
      expectLessonExactKeys(reusedRecord, ["task_id", "document_id", "archive_revision", "candidate_ref"], `${location}.lesson_marker.reused_candidate`);
      marker.disposition = "reused";
      marker.reused_candidate = validateLessonCandidateKey(reusedRecord, `${location}.lesson_marker.reused_candidate`);
    }
    result.push(marker);
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
  const data = {
    task_id: marker.task_id,
    task_slug: marker.task_slug,
    document_id: marker.document_id,
    archive_path: marker.archive_path,
    archive_revision: marker.archive_revision,
    source_revision: marker.source_revision,
    candidate_ref: marker.candidate_ref,
    candidate_digest: marker.candidate_digest,
    evidence_refs: marker.evidence_refs
  };
  if (marker.disposition === "reused" && marker.reused_candidate) {
    data.disposition = "reused";
    data.reused_candidate = {
      task_id: marker.reused_candidate.task_id,
      document_id: marker.reused_candidate.document_id,
      archive_revision: marker.reused_candidate.archive_revision,
      candidate_ref: marker.reused_candidate.candidate_ref
    };
  }
  return `<!-- vNext lesson record: ${JSON.stringify(data)} -->`;
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
    lessonAdmission: { decision: "defer", candidate_refs: [], evidence_refs: [] },
    knowledgeAdmissions: emptyKnowledgeAdmissionBundle()
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
      fail2("LESSON_INVALID", `${location} is not a valid rendered scalar.`);
    }
  }
  return expectText(value, location);
}
function readLessonRenderedField(block, label, indent, location) {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`^${indent}-\\s*${escaped}：(.+?)\\s*$`, "m").exec(block);
  if (!match)
    fail2("LESSON_INVALID", `${location} is missing the visible ${label} field.`);
  return parseLessonRenderedScalar(match[1], `${location}.${label}`);
}
function readLessonRenderedEvidenceRefs(block, location) {
  const match = /^\s{2}-\s*证据引用：(.+?)\s*$/m.exec(block);
  if (!match)
    fail2("LESSON_INVALID", `${location} is missing the visible 证据引用 field.`);
  let parsed;
  try {
    parsed = JSON.parse(match[1].trim());
  } catch {
    fail2("LESSON_INVALID", `${location}.evidence_refs is not a JSON array.`);
  }
  return validateEvidenceRefs(parsed, `${location}.evidence_refs`);
}
function readDurableLessonRecord(content, marker, location) {
  const markerText = renderLessonMarkerFromData(marker);
  if (countExactOccurrences(content, markerText) !== 1) {
    fail2("LESSON_INVALID", `${location} contains a non-canonical or duplicate lesson provenance marker.`);
  }
  const markerStart = content.indexOf(markerText);
  const sections = scanMarkdownSections2(content);
  const categorySection = sections.find((section) => section.level === 2 && LESSON_CATEGORIES.includes(section.title) && markerStart >= section.contentStart && markerStart < section.contentEnd);
  if (!categorySection)
    fail2("LESSON_INVALID", `${location} lesson marker is not inside a canonical lesson category section.`);
  const nextMarker = content.indexOf("<!-- vNext lesson record:", markerStart + markerText.length);
  const nextSection = sections.filter((section) => section.level <= 2 && section.headingStart > markerStart).map((section) => section.headingStart).sort((left, right) => left - right)[0];
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
    fail2("LESSON_PROVENANCE_MISMATCH", `${location}.${marker.candidate_ref} marker evidence_refs do not match the visible Lesson record.`);
  }
  if (lessonCandidateDigest(candidate) !== marker.candidate_digest) {
    fail2("LESSON_PROVENANCE_MISMATCH", `${location}.${marker.candidate_ref} marker digest does not match the visible Lesson record.`);
  }
  const archive = archiveReceiptFromLessonMarker(marker);
  if (countExactOccurrences(content, renderLessonCandidate(candidate, archive)) !== 1) {
    fail2("LESSON_PROVENANCE_MISMATCH", `${location}.${marker.candidate_ref} visible Lesson record drifted from its deterministic rendering.`);
  }
  return { marker, candidate };
}
function readDurableLessonRecords(content, location) {
  const markers = readLessonMarkers(content, location);
  const persistedRecords = [];
  const reusedMarkers = [];
  for (const [index, marker] of markers.entries()) {
    if (marker.disposition === "reused") {
      reusedMarkers.push({ marker, index });
    } else {
      persistedRecords.push(readDurableLessonRecord(content, marker, `${location}.lesson[${index}]`));
    }
  }
  const allRecords = [...persistedRecords];
  for (const { marker, index } of reusedMarkers) {
    const markerText = renderLessonMarkerFromData(marker);
    if (countExactOccurrences(content, markerText) !== 1) {
      fail2("LESSON_INVALID", `${location}.lesson[${index}] contains a non-canonical or duplicate lesson reuse marker.`);
    }
    if (!marker.reused_candidate) {
      fail2("LESSON_INVALID", `${location}.lesson[${index}] reuse marker is missing reused_candidate target.`);
    }
    const matchingTargets = persistedRecords.filter((record) => record.marker.task_id === marker.reused_candidate.task_id && record.marker.document_id === marker.reused_candidate.document_id && record.marker.archive_revision === marker.reused_candidate.archive_revision && record.marker.candidate_ref === marker.reused_candidate.candidate_ref);
    if (matchingTargets.length !== 1) {
      fail2("LESSON_PROVENANCE_MISMATCH", `${location}.lesson[${index}] references ${matchingTargets.length === 0 ? "missing" : "ambiguous"} persisted candidate target ${marker.reused_candidate.task_id}/${marker.reused_candidate.candidate_ref}.`);
    }
    const target = matchingTargets[0];
    if (target.marker.candidate_digest !== marker.candidate_digest) {
      fail2("LESSON_PROVENANCE_MISMATCH", `${location}.lesson[${index}] digest does not match referenced candidate target ${marker.reused_candidate.task_id}/${marker.reused_candidate.candidate_ref}.`);
    }
    allRecords.push({
      marker,
      candidate: {
        ...target.candidate,
        candidate_ref: marker.candidate_ref,
        evidence_refs: [...marker.evidence_refs]
      }
    });
  }
  return allRecords;
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
    const sections = scanMarkdownSections2(nextContent);
    const section = findUniqueMarkdownSection(sections, [category], 2);
    if (!section)
      fail2("LESSON_INVALID", `${location} is missing the required ## ${category} section.`);
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
function appendLessonReuseMarkers(content, reuseMarkers, availableRecords, location) {
  let nextContent = content;
  for (const reuseMarker of reuseMarkers) {
    if (!reuseMarker.reused_candidate) {
      fail2("LESSON_INVALID", `${location} reuse marker missing reused_candidate coordinates.`);
    }
    const matchingTargets = availableRecords.filter((record) => record.marker.task_id === reuseMarker.reused_candidate.task_id && record.marker.document_id === reuseMarker.reused_candidate.document_id && record.marker.archive_revision === reuseMarker.reused_candidate.archive_revision && record.marker.candidate_ref === reuseMarker.reused_candidate.candidate_ref);
    if (matchingTargets.length !== 1) {
      fail2("LESSON_INVALID", `${location} target candidate for reuse ${reuseMarker.reused_candidate.task_id}/${reuseMarker.reused_candidate.candidate_ref} was not uniquely resolved (matches=${matchingTargets.length}).`);
    }
    const targetRecord = matchingTargets[0];
    if (targetRecord.marker.candidate_digest !== reuseMarker.candidate_digest) {
      fail2("LESSON_INVALID", `${location} target candidate for reuse ${reuseMarker.reused_candidate.task_id}/${reuseMarker.reused_candidate.candidate_ref} digest mismatched.`);
    }
    const targetArchive = archiveReceiptFromLessonMarker(targetRecord.marker);
    const targetRendered = renderLessonCandidate(targetRecord.candidate, targetArchive);
    const targetIndex = nextContent.indexOf(targetRendered);
    if (targetIndex < 0) {
      fail2("LESSON_INVALID", `${location} could not locate rendered block for candidate ${reuseMarker.reused_candidate.task_id}/${reuseMarker.reused_candidate.candidate_ref}.`);
    }
    let insertionIndex = targetIndex + targetRendered.length;
    while (true) {
      const rest = nextContent.slice(insertionIndex);
      const match = /^\r?\n<!-- vNext lesson record: (\{[^\r\n]+\}) -->/.exec(rest);
      if (!match)
        break;
      insertionIndex += match[0].length;
    }
    const markerText = renderLessonMarkerFromData(reuseMarker);
    nextContent = nextContent.slice(0, insertionIndex) + `
${markerText}` + nextContent.slice(insertionIndex);
  }
  return nextContent;
}
function prepareLessonRecordTransaction(root, current, proposal) {
  ensureAuthorityKinds(proposal, ["evidence-admission"]);
  const { receipt } = matchingArchiveReceipt(root, current);
  if (receipt.lessonAdmission.decision !== "admit") {
    fail2("KNOWLEDGE_ADMISSION_INVALID", "lesson-record-transaction is allowed only when the durable archive lesson admission is admit.");
  }
  const delta = proposal.semantic_delta;
  const admissionRefs = new Set(receipt.lessonAdmission.candidate_refs);
  const candidateRefs = new Set(delta.candidates.map((candidate) => candidate.candidate_ref));
  if (admissionRefs.size !== candidateRefs.size || [...admissionRefs].some((ref) => !candidateRefs.has(ref))) {
    fail2("KNOWLEDGE_ADMISSION_INVALID", "lesson-record candidates must exactly match the durable archive lesson admission candidate_refs.");
  }
  if (delta.candidates.length !== candidateRefs.size) {
    fail2("KNOWLEDGE_ADMISSION_INVALID", "lesson-record candidates must not contain duplicate candidate_refs.");
  }
  if (!receipt.lessonAdmission.evidence_refs.every((ref) => delta.evidence_refs.includes(ref))) {
    fail2("KNOWLEDGE_ADMISSION_INVALID", "lesson-record evidence_refs must cover the durable archive lesson admission evidence_refs.");
  }
  const target = workflowDocPathForRoot(root, "LESSONS.md");
  if (!fs3.existsSync(target.filePath))
    fail2("RUNTIME_SOURCE_MISSING", `LESSONS.md is missing: ${target.relativePath}`);
  const originalLessonsContent = fs3.readFileSync(target.filePath, "utf8");
  const sections = scanMarkdownSections2(originalLessonsContent);
  for (const heading of ["使用规则", "通用", "数据与存储", "前端与交互", "后端与服务", "测试与回归", "部署与运行时"]) {
    if (!findUniqueMarkdownSection(sections, [heading], 2))
      fail2("LESSON_INVALID", `LESSONS.md is missing the required ## ${heading} section.`);
  }
  const existingRecords = readDurableLessonRecords(originalLessonsContent, target.relativePath);
  const stagedSemanticTargets = new Map;
  for (const record of existingRecords) {
    if (record.marker.disposition !== "reused") {
      if (!stagedSemanticTargets.has(record.marker.candidate_digest)) {
        stagedSemanticTargets.set(record.marker.candidate_digest, {
          task_id: record.marker.task_id,
          document_id: record.marker.document_id,
          archive_revision: record.marker.archive_revision,
          candidate_ref: record.marker.candidate_ref
        });
      }
    }
  }
  const newCandidates = [];
  const newReuseMarkers = [];
  for (const candidate of delta.candidates) {
    const matchingRefs = existingRecords.filter((record) => record.marker.candidate_ref === candidate.candidate_ref && record.marker.task_id === receipt.taskId);
    if (matchingRefs.length > 1) {
      fail2("LESSON_INVALID", `LESSONS contains duplicate durable records for candidate ${candidate.candidate_ref}.`);
    }
    if (matchingRefs.length > 0) {
      for (const existing of matchingRefs) {
        const marker = existing.marker;
        if (marker.task_id !== receipt.taskId || marker.task_slug !== receipt.taskSlug || marker.document_id !== receipt.documentId || marker.archive_path !== receipt.relativePath || marker.archive_revision !== receipt.revision || marker.source_revision !== receipt.sourceRevision || marker.candidate_digest !== lessonCandidateDigest(candidate) || marker.evidence_refs.join("|") !== candidate.evidence_refs.join("|") || lessonCandidateDigest(existing.candidate) !== lessonCandidateDigest(candidate)) {
          fail2("LESSON_PROVENANCE_MISMATCH", `lesson candidate ${candidate.candidate_ref} has conflicting durable provenance.`);
        }
      }
      continue;
    }
    const candidateDigest = lessonCandidateDigest(candidate);
    const existingTarget = stagedSemanticTargets.get(candidateDigest);
    if (existingTarget) {
      const reuseMarker = {
        task_id: receipt.taskId,
        task_slug: receipt.taskSlug,
        document_id: receipt.documentId,
        archive_path: receipt.relativePath,
        archive_revision: receipt.revision,
        source_revision: receipt.sourceRevision,
        candidate_ref: candidate.candidate_ref,
        candidate_digest: candidateDigest,
        evidence_refs: [...candidate.evidence_refs],
        disposition: "reused",
        reused_candidate: {
          task_id: existingTarget.task_id,
          document_id: existingTarget.document_id,
          archive_revision: existingTarget.archive_revision,
          candidate_ref: existingTarget.candidate_ref
        }
      };
      newReuseMarkers.push(reuseMarker);
      continue;
    }
    newCandidates.push(candidate);
    stagedSemanticTargets.set(candidateDigest, {
      task_id: receipt.taskId,
      document_id: receipt.documentId,
      archive_revision: receipt.revision,
      candidate_ref: candidate.candidate_ref
    });
  }
  if (newCandidates.length === 0 && newReuseMarkers.length === 0)
    return null;
  let nextLessonsContent = originalLessonsContent;
  let candidateCount = 0;
  if (newCandidates.length > 0) {
    const appended = appendLessonCandidates(nextLessonsContent, newCandidates, receipt, target.relativePath);
    nextLessonsContent = appended.content;
    candidateCount += appended.candidateCount;
  }
  if (newReuseMarkers.length > 0) {
    const availableRecords = [...existingRecords];
    for (const candidate of newCandidates) {
      availableRecords.push({
        marker: {
          task_id: receipt.taskId,
          task_slug: receipt.taskSlug,
          document_id: receipt.documentId,
          archive_path: receipt.relativePath,
          archive_revision: receipt.revision,
          source_revision: receipt.sourceRevision,
          candidate_ref: candidate.candidate_ref,
          candidate_digest: lessonCandidateDigest(candidate),
          evidence_refs: [...candidate.evidence_refs]
        },
        candidate
      });
    }
    nextLessonsContent = appendLessonReuseMarkers(nextLessonsContent, newReuseMarkers, availableRecords, target.relativePath);
    candidateCount += newReuseMarkers.length;
  }
  return {
    lessonsFilePath: target.filePath,
    lessonsRelativePath: target.relativePath,
    nextLessonsContent,
    originalLessonsContent,
    lessonsRevision: sha2562(nextLessonsContent),
    archive: receipt,
    candidateCount
  };
}
function knowledgeTarget(root, knowledgeKind) {
  return workflowDocPathForRoot(root, knowledgeKind === "contract" ? "CONTRACTS.md" : "DECISIONS.md");
}
function knowledgeSectionTitle(knowledgeKind) {
  return knowledgeKind === "contract" ? "vNext Contract Records" : "vNext Decision Records";
}
function knowledgeMarkerPrefix(knowledgeKind) {
  return `<!-- vNext ${knowledgeKind} record:`;
}
function knowledgeCandidateSemanticDigest(candidate) {
  return digest({
    kind: candidate.kind,
    fingerprint: candidate.fingerprint,
    statement: candidate.statement,
    applicability: candidate.applicability,
    authoritySource: candidate.authoritySource,
    stability: candidate.stability,
    supersedes: candidate.supersedes,
    decisionContext: candidate.decisionContext ?? null
  });
}
function validateDurableKnowledgeRecord(value, location, expectedKind) {
  const record = expectRecord2(value, location);
  expectExactKeys2(record, ["schema_version", "knowledge_kind", "candidate_id", "candidate_fingerprint", "disposition", "matched_knowledge_id", "candidate", "provenance", "proposal_idempotency_key", "proposal_digest", "semantic_digest"], location);
  if (record.schema_version !== 1)
    fail2("KNOWLEDGE_RECORD_INVALID", `${location}.schema_version must be 1.`);
  const knowledgeKind = expectEnum(record.knowledge_kind, ["contract", "decision"], `${location}.knowledge_kind`);
  if (knowledgeKind !== expectedKind)
    fail2("KNOWLEDGE_RECORD_INVALID", `${location}.knowledge_kind must be ${expectedKind}.`);
  const candidate = validateKnowledgeCandidate(record.candidate, `${location}.candidate`, expectedKind);
  const candidateId = expectString2(record.candidate_id, `${location}.candidate_id`, SAFE_KEY_PATTERN2);
  const candidateFingerprint = expectString2(record.candidate_fingerprint, `${location}.candidate_fingerprint`, FINGERPRINT_PATTERN);
  if (candidateId !== candidate.candidateId || candidateFingerprint !== candidate.fingerprint)
    fail2("KNOWLEDGE_PROVENANCE_MISMATCH", `${location} candidate identity does not match the embedded candidate.`);
  const disposition = expectEnum(record.disposition, ["admit", "merge", "supersede"], `${location}.disposition`);
  const matchedKnowledgeId = expectNullableString(record.matched_knowledge_id, `${location}.matched_knowledge_id`, SAFE_KEY_PATTERN2);
  if (disposition === "merge" && matchedKnowledgeId === null)
    fail2("KNOWLEDGE_RECORD_INVALID", `${location}.matched_knowledge_id is required for merge.`);
  if (disposition === "supersede" && (matchedKnowledgeId === null || candidate.supersedes !== matchedKnowledgeId))
    fail2("KNOWLEDGE_RECORD_INVALID", `${location}.supersede predecessor identity is inconsistent.`);
  if (candidate.authoritySource === "none")
    fail2("KNOWLEDGE_RECORD_INVALID", `${location} cannot be a durable record without an authority source.`);
  if (knowledgeKind === "decision" && !["user", "accepted-decision"].includes(candidate.authoritySource)) {
    fail2("KNOWLEDGE_RECORD_INVALID", `${location} Decision record requires user or accepted-decision authority.`);
  }
  if (candidate.stability !== "stable" || candidate.conflictSet.length > 0 || candidate.evidenceRefs.length === 0) {
    fail2("KNOWLEDGE_RECORD_INVALID", `${location} durable record must contain stable, conflict-free candidate evidence.`);
  }
  const provenance = validateKnowledgeProvenance(record.provenance, `${location}.provenance`);
  const proposalIdempotencyKey = expectString2(record.proposal_idempotency_key, `${location}.proposal_idempotency_key`, SAFE_KEY_PATTERN2);
  const proposalDigest = expectString2(record.proposal_digest, `${location}.proposal_digest`);
  const semanticDigest = expectString2(record.semantic_digest, `${location}.semantic_digest`);
  if (!SHA256_PATTERN2.test(proposalDigest) || !SHA256_PATTERN2.test(semanticDigest))
    fail2("KNOWLEDGE_RECORD_INVALID", `${location} proposal and semantic digests must be SHA-256.`);
  if (semanticDigest !== knowledgeCandidateSemanticDigest(candidate))
    fail2("KNOWLEDGE_PROVENANCE_MISMATCH", `${location}.semantic_digest does not match the canonical candidate.`);
  return {
    schema_version: 1,
    knowledge_kind: knowledgeKind,
    candidate_id: candidateId,
    candidate_fingerprint: candidateFingerprint,
    disposition,
    matched_knowledge_id: matchedKnowledgeId,
    candidate,
    provenance,
    proposal_idempotency_key: proposalIdempotencyKey,
    proposal_digest: proposalDigest,
    semantic_digest: semanticDigest
  };
}
function renderDurableKnowledgeRecord(record) {
  const label = record.knowledge_kind === "contract" ? "Contract" : "Decision";
  const candidate = record.candidate;
  const anchors = candidate.implementation_anchors;
  return [
    `### ${label}: ${candidate.candidateId}`,
    "",
    `<!-- vNext ${record.knowledge_kind} record: ${JSON.stringify(record)} -->`,
    "",
    `- candidate_id: ${yamlScalar(candidate.candidateId)}`,
    `- fingerprint: ${yamlScalar(candidate.fingerprint)}`,
    `- disposition: ${record.disposition}`,
    `- statement: ${yamlScalar(candidate.statement)}`,
    `- authority_source: ${yamlScalar(candidate.authoritySource)}`,
    `- applicability: ${JSON.stringify(candidate.applicability)}`,
    `- evidence_refs: ${JSON.stringify(candidate.evidenceRefs)}`,
    `- implementation_anchors: ${anchors ? JSON.stringify(anchors) : "none"}`,
    `- provenance: ${JSON.stringify(record.provenance)}`,
    `- proposal_idempotency_key: ${yamlScalar(record.proposal_idempotency_key)}`,
    ""
  ].join(`
`);
}
function readDurableKnowledgeRecords(content, location, expectedKind) {
  const markers = [];
  const markerPattern = /<!-- vNext (contract|decision) record: (\{[^\r\n]+\}) -->/g;
  for (const match of content.matchAll(markerPattern)) {
    const markerKind = match[1];
    if (markerKind !== expectedKind)
      fail2("KNOWLEDGE_RECORD_INVALID", `${location} contains a ${markerKind} record in the ${expectedKind} document.`);
    let parsed;
    try {
      parsed = JSON.parse(match[2]);
    } catch {
      fail2("KNOWLEDGE_RECORD_INVALID", `${location} contains an invalid vNext knowledge marker.`);
    }
    const record = validateDurableKnowledgeRecord(parsed, `${location}.${expectedKind}[${markers.length}]`, expectedKind);
    const markerText = `<!-- vNext ${expectedKind} record: ${JSON.stringify(record)} -->`;
    if (countExactOccurrences(content, markerText) !== 1 || countExactOccurrences(content, renderDurableKnowledgeRecord(record)) !== 1) {
      fail2("KNOWLEDGE_PROVENANCE_MISMATCH", `${location}.${expectedKind}[${markers.length}] visible bytes do not match the canonical durable record.`);
    }
    const markerStart = content.indexOf(markerText);
    const section = findUniqueMarkdownSection(scanMarkdownSections2(content), [knowledgeSectionTitle(expectedKind)], 2);
    if (!section || markerStart < section.contentStart || markerStart >= section.contentEnd) {
      fail2("KNOWLEDGE_RECORD_INVALID", `${location}.${expectedKind}[${markers.length}] is outside the canonical knowledge section.`);
    }
    markers.push(record);
  }
  for (const markerKind of ["contract", "decision"]) {
    const prefix = knowledgeMarkerPrefix(markerKind);
    const markerCount = countExactOccurrences(content, prefix);
    const parsedCount = markers.filter((record) => record.knowledge_kind === markerKind).length;
    if (markerCount !== parsedCount) {
      fail2("KNOWLEDGE_RECORD_INVALID", `${location} contains a malformed or partially unreadable ${markerKind} record marker.`);
    }
  }
  if (content.includes("<!-- vNext contract record:") && expectedKind !== "contract")
    fail2("KNOWLEDGE_RECORD_INVALID", `${location} contains a Contract record in the wrong target.`);
  if (content.includes("<!-- vNext decision record:") && expectedKind !== "decision")
    fail2("KNOWLEDGE_RECORD_INVALID", `${location} contains a Decision record in the wrong target.`);
  return markers;
}
function appendKnowledgeSectionIfMissing(content, knowledgeKind) {
  const title = knowledgeSectionTitle(knowledgeKind);
  const sections = scanMarkdownSections2(content);
  const existing = findUniqueMarkdownSection(sections, [title], 2);
  if (existing)
    return content;
  return `${content.trimEnd()}

## ${title}

`;
}
function replaceDurableKnowledgeRecord(content, knowledgeKind, previous, next) {
  const previousText = renderDurableKnowledgeRecord(previous);
  if (countExactOccurrences(content, previousText) !== 1) {
    fail2("KNOWLEDGE_PROVENANCE_MISMATCH", `canonical ${knowledgeKind} document does not contain exactly one predecessor record for merge.`);
  }
  const start = content.indexOf(previousText);
  if (start < 0)
    fail2("KNOWLEDGE_PROVENANCE_MISMATCH", `canonical ${knowledgeKind} predecessor record cannot be located for merge.`);
  return `${content.slice(0, start)}${renderDurableKnowledgeRecord(next)}${content.slice(start + previousText.length)}`;
}
function knowledgeAdmissionMatches(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}
function knowledgeProvenanceMatchesArchive(provenance, archive, proposal) {
  const admission = knowledgeAdmissionFromArchive(archive, proposal.semantic_delta.knowledge_kind, proposal.semantic_delta.admission.candidate.candidateId);
  const admissionEvidenceRefs = [
    ...admission.candidate.evidenceRefs,
    ...admission.candidate.implementation_anchors?.anchors.flatMap((anchor) => anchor.evidence_refs) ?? []
  ];
  if (provenance.task_id !== archive.taskId || provenance.task_slug !== archive.taskSlug || provenance.document_id !== archive.documentId || provenance.archive_path !== archive.relativePath || provenance.archive_revision !== archive.revision || provenance.source_revision !== archive.sourceRevision || !admissionEvidenceRefs.every((ref) => provenance.evidence_refs.includes(ref)) || !provenance.evidence_refs.every((ref) => archiveEvidenceRefsForKnowledge(archive).includes(ref))) {
    fail2("KNOWLEDGE_PROVENANCE_MISMATCH", "knowledge proposal provenance does not match the canonical archive receipt.");
  }
  if (!provenance.evidence_refs.every((ref) => proposal.evidence_refs.includes(ref))) {
    fail2("RUNTIME_EVIDENCE_INVALID", "knowledge proposal evidence_refs must cover provenance evidence_refs.");
  }
}
function archiveEvidenceRefsForKnowledge(archive) {
  return [...new Set([
    ...archive.lessonAdmission.evidence_refs,
    ...archive.knowledgeAdmissions.contracts.flatMap((item) => [...item.candidate.evidenceRefs, ...item.candidate.implementation_anchors?.anchors.flatMap((anchor) => anchor.evidence_refs) ?? []]),
    ...archive.knowledgeAdmissions.decisions.flatMap((item) => [...item.candidate.evidenceRefs, ...item.candidate.implementation_anchors?.anchors.flatMap((anchor) => anchor.evidence_refs) ?? []])
  ])];
}
function durableKnowledgeRecordFromProposal(proposal, archive) {
  const delta = proposal.semantic_delta;
  knowledgeProvenanceMatchesArchive(delta.provenance, archive, proposal);
  const admission = delta.admission;
  return {
    schema_version: 1,
    knowledge_kind: delta.knowledge_kind,
    candidate_id: admission.candidate.candidateId,
    candidate_fingerprint: admission.candidate.fingerprint,
    disposition: admission.disposition,
    matched_knowledge_id: admission.matched_knowledge_id,
    candidate: admission.candidate,
    provenance: delta.provenance,
    proposal_idempotency_key: proposal.idempotency_key,
    proposal_digest: digest(proposal),
    semantic_digest: knowledgeCandidateSemanticDigest(admission.candidate)
  };
}
function knowledgeAdmissionFromArchive(archive, knowledgeKind, candidateId) {
  const admissions = knowledgeKind === "contract" ? archive.knowledgeAdmissions.contracts : archive.knowledgeAdmissions.decisions;
  const matches = admissions.filter((item) => item.candidate.candidateId === candidateId);
  if (matches.length !== 1)
    fail2("KNOWLEDGE_PROVENANCE_MISMATCH", `archive does not contain exactly one ${knowledgeKind} admission for ${candidateId}.`);
  return matches[0];
}
function scanKnowledgeRecords(root) {
  const result = [];
  for (const knowledgeKind of ["contract", "decision"]) {
    const target = knowledgeTarget(root, knowledgeKind);
    if (!fs3.existsSync(target.filePath))
      continue;
    if (!fs3.statSync(target.filePath).isFile())
      fail2("KNOWLEDGE_RECORD_INVALID", `${target.relativePath} is not a regular file.`);
    result.push(...readDurableKnowledgeRecords(fs3.readFileSync(target.filePath, "utf8"), target.relativePath, knowledgeKind));
  }
  return result;
}
function inspectKnowledgeRecordTransaction(root, current, proposal) {
  const { receipt } = matchingArchiveReceipt(root, current);
  const delta = proposal.semantic_delta;
  const archiveAdmission = knowledgeAdmissionFromArchive(receipt, delta.knowledge_kind, delta.admission.candidate.candidateId);
  if (!knowledgeAdmissionMatches(archiveAdmission, delta.admission))
    fail2("KNOWLEDGE_PROVENANCE_MISMATCH", "knowledge proposal admission does not match the archived close-task admission decision.");
  const expectedRecord = durableKnowledgeRecordFromProposal(proposal, receipt);
  const target = knowledgeTarget(root, delta.knowledge_kind);
  if (!fs3.existsSync(target.filePath))
    fail2("RUNTIME_SOURCE_MISSING", `knowledge target is missing: ${target.relativePath}`);
  const originalContent = fs3.readFileSync(target.filePath, "utf8");
  const records = readDurableKnowledgeRecords(originalContent, target.relativePath, delta.knowledge_kind);
  const allRecords = scanKnowledgeRecords(root);
  const sameIdempotency = allRecords.filter((record) => record.proposal_idempotency_key === proposal.idempotency_key);
  if (sameIdempotency.some((record) => JSON.stringify(record) !== JSON.stringify(expectedRecord))) {
    fail2("IDEMPOTENCY_CONFLICT", "knowledge idempotency key is already durably bound to a different candidate or target.");
  }
  const sameIdentity = records.filter((record) => record.candidate_id === expectedRecord.candidate_id);
  if (sameIdentity.length > 1)
    fail2("KNOWLEDGE_RECORD_INVALID", `knowledge target contains duplicate candidate identity ${expectedRecord.candidate_id}.`);
  if (sameIdentity.length === 1) {
    const existingRecord = sameIdentity[0];
    if (JSON.stringify(existingRecord) === JSON.stringify(expectedRecord)) {
      return { filePath: target.filePath, relativePath: target.relativePath, nextContent: originalContent, originalContent, record: expectedRecord, existing: true };
    }
    if (expectedRecord.disposition === "merge" && expectedRecord.matched_knowledge_id === existingRecord.candidate_id) {
      return {
        filePath: target.filePath,
        relativePath: target.relativePath,
        nextContent: replaceDurableKnowledgeRecord(originalContent, delta.knowledge_kind, existingRecord, expectedRecord),
        originalContent,
        record: expectedRecord,
        existing: false
      };
    }
    fail2("KNOWLEDGE_IDENTITY_CONFLICT", `${target.relativePath} contains different semantic or provenance content for ${expectedRecord.candidate_id}.`);
  }
  if (expectedRecord.disposition === "merge") {
    const predecessor = records.find((record) => record.candidate_id === expectedRecord.matched_knowledge_id);
    if (!predecessor)
      fail2("KNOWLEDGE_ADMISSION_INVALID", `knowledge merge target ${expectedRecord.matched_knowledge_id} is not durably present.`);
    const semanticMatches2 = records.filter((record) => record.semantic_digest === expectedRecord.semantic_digest);
    if (semanticMatches2.some((record) => record.candidate_id !== predecessor.candidate_id)) {
      fail2("KNOWLEDGE_IDENTITY_CONFLICT", "knowledge merge semantic content already belongs to a different durable item.");
    }
    return {
      filePath: target.filePath,
      relativePath: target.relativePath,
      nextContent: replaceDurableKnowledgeRecord(originalContent, delta.knowledge_kind, predecessor, expectedRecord),
      originalContent,
      record: expectedRecord,
      existing: false
    };
  }
  const semanticMatches = records.filter((record) => record.semantic_digest === expectedRecord.semantic_digest);
  if (semanticMatches.length > 0) {
    return { filePath: target.filePath, relativePath: target.relativePath, nextContent: originalContent, originalContent, record: expectedRecord, existing: true };
  }
  if (expectedRecord.disposition === "supersede") {
    const predecessor = records.find((record) => record.candidate_id === expectedRecord.matched_knowledge_id);
    if (!predecessor)
      fail2("KNOWLEDGE_ADMISSION_INVALID", `knowledge supersede target ${expectedRecord.matched_knowledge_id} is not durably present.`);
  }
  const withSection = appendKnowledgeSectionIfMissing(originalContent, delta.knowledge_kind);
  return {
    filePath: target.filePath,
    relativePath: target.relativePath,
    nextContent: `${withSection}${renderDurableKnowledgeRecord(expectedRecord)}`,
    originalContent,
    record: expectedRecord,
    existing: false
  };
}
function prepareKnowledgeRecordTransaction(root, current, proposal) {
  ensureAuthorityKinds(proposal, ["evidence-admission"]);
  if (current.runtimeState.workflow_status !== "closed" || current.runtimeState.lifecycle_state !== "archived") {
    fail2("KNOWLEDGE_ADMISSION_INVALID", "knowledge promotion requires a closed + archived task.");
  }
  return inspectKnowledgeRecordTransaction(root, current, proposal);
}
function assertRequestedInboxTargets(root, current, proposal) {
  if (proposal.source_tuple.path !== current.relativePath)
    fail2("RUNTIME_PATH_INVALID", "capture proposal source path is not the exact canonical CURRENT_TASK path.");
  const target = canonicalInboxRecordTarget(root, proposal.semantic_delta);
  if (proposal.requested_write_targets.length !== 1 || proposal.requested_write_targets[0] !== target.relativePath) {
    fail2("RUNTIME_PATH_INVALID", "capture proposal must name only its exact identity-derived inbox path.");
  }
}
function assertRequestedCloseTargets(root, current, proposal) {
  if (proposal.source_tuple.path !== current.relativePath)
    fail2("RUNTIME_PATH_INVALID", "close-task proposal source path is not the exact canonical CURRENT_TASK path.");
  if (proposal.operation_kind === "archive-transaction") {
    const archive = archivePathForTask(root, current);
    if (proposal.requested_write_targets.length !== 2 || proposal.requested_write_targets[0] !== current.relativePath || proposal.requested_write_targets[1] !== archive.relativePath) {
      fail2("RUNTIME_PATH_INVALID", "archive proposal must name CURRENT_TASK and its exact identity-derived archive path.");
    }
    return;
  }
  const file = proposal.operation_kind === "project-status-transaction" ? "STATUS.md" : proposal.operation_kind === "lesson-record-transaction" ? "LESSONS.md" : proposal.operation_kind === "contract-candidate-commit" ? "CONTRACTS.md" : proposal.operation_kind === "decision-record-transaction" ? "DECISIONS.md" : null;
  if (file === null)
    fail2("RUNTIME_PATH_INVALID", `${proposal.operation_kind} is not a close-task document operation.`);
  const target = workflowDocPathForRoot(root, file);
  if (proposal.requested_write_targets.length !== 1 || proposal.requested_write_targets[0] !== target.relativePath) {
    fail2("RUNTIME_PATH_INVALID", `${file} proposal must name only its exact canonical path.`);
  }
}
function assertPreviousTaskReconciliationComplete(root, current, receipt) {
  const knowledgeAdmissions = [
    ...receipt.knowledgeAdmissions.contracts,
    ...receipt.knowledgeAdmissions.decisions
  ].filter((admission) => ["admit", "merge", "supersede"].includes(admission.disposition));
  if (knowledgeAdmissions.length > 0) {
    for (const admission of knowledgeAdmissions) {
      const knowledgeKind = admission.candidate.kind;
      const target = knowledgeTarget(root, knowledgeKind);
      if (!fs3.existsSync(target.filePath)) {
        fail2("PREVIOUS_TASK_RECONCILIATION_INCOMPLETE", `previous task ${current.runtimeState.task_id} ${knowledgeKind} reconciliation is incomplete: ${target.relativePath} does not exist.`);
      }
      const records = readDurableKnowledgeRecords(fs3.readFileSync(target.filePath, "utf8"), target.relativePath, knowledgeKind);
      const exactIdentity = records.find((record) => record.candidate_id === admission.candidate.candidateId);
      const equivalent = records.some((record) => record.semantic_digest === knowledgeCandidateSemanticDigest(admission.candidate));
      if (exactIdentity) {
        if (JSON.stringify(exactIdentity.candidate) !== JSON.stringify(admission.candidate) || exactIdentity.candidate_fingerprint !== admission.candidate.fingerprint || exactIdentity.semantic_digest !== knowledgeCandidateSemanticDigest(admission.candidate) || exactIdentity.disposition !== admission.disposition || exactIdentity.matched_knowledge_id !== admission.matched_knowledge_id || exactIdentity.provenance.task_id !== receipt.taskId || exactIdentity.provenance.task_slug !== receipt.taskSlug || exactIdentity.provenance.document_id !== receipt.documentId || exactIdentity.provenance.archive_path !== receipt.relativePath || exactIdentity.provenance.archive_revision !== receipt.revision || exactIdentity.provenance.source_revision !== receipt.sourceRevision || !exactIdentity.provenance.evidence_refs.every((ref) => archiveEvidenceRefsForKnowledge(receipt).includes(ref))) {
          fail2("PREVIOUS_TASK_RECONCILIATION_INCOMPLETE", `previous task ${current.runtimeState.task_id} ${knowledgeKind} reconciliation provenance conflicts with the canonical archive.`);
        }
      } else if (!equivalent) {
        fail2("PREVIOUS_TASK_RECONCILIATION_INCOMPLETE", `previous task ${current.runtimeState.task_id} ${knowledgeKind} candidate ${admission.candidate.candidateId} has not been reconciled.`);
      }
    }
  }
  const statusTarget = workflowDocPathForRoot(root, "STATUS.md");
  if (!fs3.existsSync(statusTarget.filePath)) {
    fail2("PREVIOUS_TASK_RECONCILIATION_INCOMPLETE", `previous task ${current.runtimeState.task_id} STATUS reconciliation is incomplete: STATUS.md does not exist.`);
  }
  const statusContent = fs3.readFileSync(statusTarget.filePath, "utf8");
  const statusReceipt = matchingStatusReceipt(statusContent, statusTarget.relativePath, receipt);
  if (!statusReceipt) {
    fail2("PREVIOUS_TASK_RECONCILIATION_INCOMPLETE", `previous task ${current.runtimeState.task_id} STATUS reconciliation is incomplete.`);
  }
  if (statusReceipt.taskId !== receipt.taskId || statusReceipt.taskSlug !== receipt.taskSlug || statusReceipt.documentId !== receipt.documentId || statusReceipt.archivePath !== receipt.relativePath || statusReceipt.archiveRevision !== receipt.revision || statusReceipt.sourceRevision !== receipt.sourceRevision) {
    fail2("PREVIOUS_TASK_RECONCILIATION_INCOMPLETE", `previous task ${current.runtimeState.task_id} STATUS reconciliation provenance does not match the canonical archive.`);
  }
  assertStatusProjection(statusContent, statusDeltaFromReceipt(statusReceipt), statusTarget.relativePath);
  if (receipt.lessonAdmission.decision === "admit") {
    const lessonsTarget = workflowDocPathForRoot(root, "LESSONS.md");
    if (!fs3.existsSync(lessonsTarget.filePath)) {
      fail2("PREVIOUS_TASK_RECONCILIATION_INCOMPLETE", `previous task ${current.runtimeState.task_id} lesson reconciliation is incomplete: LESSONS.md does not exist.`);
    }
    const lessonsContent = fs3.readFileSync(lessonsTarget.filePath, "utf8");
    const existingRecords = readDurableLessonRecords(lessonsContent, lessonsTarget.relativePath);
    for (const candidateRef of receipt.lessonAdmission.candidate_refs) {
      const matching = existingRecords.find((record) => record.marker.candidate_ref === candidateRef && record.marker.task_id === receipt.taskId && record.marker.task_slug === receipt.taskSlug && record.marker.document_id === receipt.documentId && record.marker.archive_path === receipt.relativePath && record.marker.archive_revision === receipt.revision && record.marker.source_revision === receipt.sourceRevision);
      if (!matching) {
        fail2("PREVIOUS_TASK_RECONCILIATION_INCOMPLETE", `previous task ${current.runtimeState.task_id} lesson candidate ${candidateRef} has not been reconciled.`);
      }
    }
  }
}
function ensureAuthorityKinds(proposal, required) {
  const kinds = new Set(proposal.authority_evidence.map((item) => item.kind));
  const missing = required.filter((kind) => !kinds.has(kind));
  if (missing.length > 0)
    fail2("RUNTIME_AUTHORITY_MISSING", `proposal is missing authority evidence: ${missing.join(", ")}`);
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
    fail2("RUNTIME_SCHEMA_INVALID", "Only Slice B transitions may create a replan audit record.");
  if (delta.kind !== "task-state" && delta.kind !== "lifecycle") {
    fail2("RUNTIME_SCHEMA_INVALID", "Only task-state and lifecycle deltas may create a replan audit record.");
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
function ensureAnyAuthorityKind(proposal, allowed) {
  if (!proposal.authority_evidence.some((item) => allowed.includes(item.kind))) {
    fail2("RUNTIME_AUTHORITY_MISSING", `proposal is missing one of the required authority evidence kinds: ${allowed.join(", ")}`);
  }
}
function makeDraftAudit(current, proposal, next, now) {
  if (proposal.semantic_delta.kind !== "task-state" || !DRAFT_TASK_STATE_ACTIONS.includes(proposal.semantic_delta.action)) {
    fail2("RUNTIME_SCHEMA_INVALID", "Only draft task-state transitions may create a draft audit record.");
  }
  const delta = proposal.semantic_delta;
  const targetIdentity = { task_id: delta.task_id, task_slug: delta.task_slug, document_id: delta.document_id };
  const base = {
    action: delta.action,
    idempotency_key: proposal.idempotency_key,
    operation_kind: "task-state-transaction",
    caller: "prepare-task",
    mode: proposal.mode,
    from_task_id: current.runtimeState.task_id,
    from_task_slug: current.runtimeState.task_slug,
    from_document_id: current.sourceTuple.document_id,
    task_id: targetIdentity.task_id,
    task_slug: targetIdentity.task_slug,
    document_id: targetIdentity.document_id,
    from_workflow_status: current.runtimeState.workflow_status,
    from_lifecycle_state: current.runtimeState.lifecycle_state,
    to_workflow_status: next.workflow_status,
    to_lifecycle_state: next.lifecycle_state,
    source_revision: current.sourceTuple.revision,
    authority_evidence: proposal.authority_evidence.map((item) => ({ ...item })),
    evidence_refs: [...delta.evidence_refs],
    recorded_at: now
  };
  if (delta.action === "create-draft" || delta.action === "update-draft") {
    const draftDelta = delta;
    return { ...base, definition_digest: digest(draftDelta.draft_definition) };
  }
  const confirmDelta = delta;
  return { ...base, draft_revision: confirmDelta.draft_revision };
}
function readDraftDefinitionFromBody(body) {
  const ranges = resolveReplanSectionRanges(body);
  const values = {};
  for (const key of REPLAN_REPLACEMENT_FIELDS) {
    const range = ranges[key];
    const optional = key === "design_constraints" || key === "post_release_validation" || key === "propagation_governance";
    if (!range) {
      if (!optional)
        fail2("DRAFT_DEFINITION_INVALID", `CURRENT_TASK is missing the draft definition section for ${key}.`);
      values[key] = null;
      continue;
    }
    const content = normalizeReplacementSectionContent(body.slice(range.contentStart, range.contentEnd), `CURRENT_TASK.${range.title}`);
    if (!content && optional)
      values[key] = null;
    else if (!content)
      fail2("DRAFT_DEFINITION_INVALID", `CURRENT_TASK draft definition section ${key} is empty.`);
    else
      values[key] = content;
  }
  return validateReplanReplacementDefinition(values, "CURRENT_TASK.draft_definition");
}
function assertNoUnresolvedDraftQuestions(body) {
  const range = resolveReplanSectionRanges(body).open_questions;
  if (!range)
    fail2("DRAFT_DEFINITION_INVALID", "CURRENT_TASK is missing the draft confirmation open-questions section.");
  const content = body.slice(range.contentStart, range.contentEnd).replace(/\r\n?/g, `
`).trim();
  if (!content)
    return;
  const emptyMarkers = /^(?:none|n\/a|na|nil|empty|no\s+open\s+questions|no\s+questions|无|暂无|不适用)[.!。]?$/iu;
  const meaningfulLines = content.split(`
`).map((line) => line.trim()).filter((line) => line.length > 0 && !/^<!--.*-->$/u.test(line)).map((line) => line.replace(/^(?:[-*+]\s+|\d+[.)]\s+|\[[ xX]\]\s*)/u, "").trim()).filter((line) => line.length > 0);
  if (meaningfulLines.length === 0 || meaningfulLines.every((line) => emptyMarkers.test(line)))
    return;
  fail2("DRAFT_DECISION_UNRESOLVED", "draft confirmation is blocked by unresolved user-owned questions.");
}
function assertDraftDefinitionReady(body, activeStepId) {
  const definition = readDraftDefinitionFromBody(body);
  assertStrictDraftImplementationSteps(activeStepId, definition.implementation_steps);
  assertNoUnresolvedDraftQuestions(body);
  return definition;
}
function expectedDraftReplayAudit(current, proposal) {
  const entry = current.runtimeState.execution_log.find((item) => ("action" in item) && DRAFT_AUDIT_ACTIONS.includes(item.action) && item.idempotency_key === proposal.idempotency_key);
  if (!entry)
    fail2("RUNTIME_REPLAY_INCOMPLETE", "draft replay is missing its durable execution audit record.");
  return entry;
}
function assertDraftTaskReplay(current, proposal) {
  if (proposal.semantic_delta.kind !== "task-state" || !DRAFT_TASK_STATE_ACTIONS.includes(proposal.semantic_delta.action))
    return;
  const delta = proposal.semantic_delta;
  const audit = expectedDraftReplayAudit(current, proposal);
  assertExecutionAuditInBody(current.body, audit);
  const targetIdentity = extractTaskIdentityFromCurrentTask(current.body);
  if (targetIdentity.id !== delta.task_id || targetIdentity.slug !== delta.task_slug) {
    fail2("RUNTIME_REPLAY_INCOMPLETE", "draft replay no longer has the proposal identity in the canonical task document.");
  }
  if (current.runtimeState.task_id !== delta.task_id || current.runtimeState.task_slug !== delta.task_slug || current.sourceTuple.document_id !== delta.document_id) {
    fail2("RUNTIME_REPLAY_INCOMPLETE", "draft replay no longer has the proposal identity tuple.");
  }
  if (audit.idempotency_key !== proposal.idempotency_key || audit.action !== delta.action || audit.source_revision !== proposal.source_tuple.revision || audit.evidence_refs.join("|") !== delta.evidence_refs.join("|") || audit.task_id !== delta.task_id || audit.task_slug !== delta.task_slug || audit.document_id !== delta.document_id) {
    fail2("RUNTIME_REPLAY_INCOMPLETE", "draft replay audit does not match the proposal identity or evidence.");
  }
  if (delta.action === "create-draft" || delta.action === "update-draft") {
    const draftDelta = delta;
    if (targetIdentity.title !== draftDelta.task_title)
      fail2("RUNTIME_REPLAY_INCOMPLETE", "draft replay no longer has the proposal task title in the canonical task document.");
    if (current.runtimeState.workflow_status !== "draft" || current.runtimeState.lifecycle_state !== "active") {
      fail2("RUNTIME_REPLAY_INCOMPLETE", `${delta.action} replay no longer has the draft + active tuple.`);
    }
    const definitionDigest = digest(draftDelta.draft_definition);
    if (audit.definition_digest !== definitionDigest)
      fail2("RUNTIME_REPLAY_INCOMPLETE", `${delta.action} replay definition digest does not match the proposal.`);
    assertReplanDefinitionSections(current.body, draftDelta.draft_definition);
    if (current.runtimeState.active_step_id !== draftDelta.active_step_id || current.runtimeState.active_step_status !== "ready") {
      fail2("RUNTIME_REPLAY_INCOMPLETE", `${delta.action} replay no longer has the admitted draft step ready.`);
    }
  } else {
    const confirmDelta = delta;
    if (current.runtimeState.workflow_status !== "active" || current.runtimeState.lifecycle_state !== "active") {
      fail2("RUNTIME_REPLAY_INCOMPLETE", "confirm-draft replay no longer has the active + active tuple.");
    }
    if (confirmDelta.draft_revision !== proposal.source_tuple.revision || audit.draft_revision !== confirmDelta.draft_revision) {
      fail2("RUNTIME_REPLAY_INCOMPLETE", "confirm-draft replay no longer matches the exact draft revision.");
    }
  }
}
function expectedReplanReplayAudit(current, proposal) {
  const entry = current.runtimeState.execution_log.find((item) => ("action" in item) && REPLAN_AUDIT_ACTIONS.includes(item.action) && item.idempotency_key === proposal.idempotency_key);
  if (!entry)
    fail2("RUNTIME_REPLAY_INCOMPLETE", "replan replay is missing its durable execution audit record.");
  return entry;
}
function assertNoLaterReplanAudit(current, audit, failureCode = "RUNTIME_REPLAY_INCOMPLETE") {
  const index = current.runtimeState.execution_log.findIndex((item) => item === audit);
  if (index < 0)
    fail2(failureCode, "replay audit record is not part of the current execution log.");
  if (current.runtimeState.execution_log.slice(index + 1).some((item) => ("action" in item) && REPLAN_AUDIT_ACTIONS.includes(item.action))) {
    fail2(failureCode, "a later same-task lifecycle or replan transition has changed the replay boundary.");
  }
}
function expectedStepExecutionLog(current, proposal) {
  const entry = current.runtimeState.execution_log.find((item) => !("action" in item) && item.idempotency_key === proposal.idempotency_key);
  if (!entry)
    fail2("RUNTIME_REPLAY_INCOMPLETE", "step-progress replay is missing its durable execution log record.");
  return entry;
}
function assertStepProgressReplay(current, proposal) {
  if (proposal.semantic_delta.kind !== "task-state" || proposal.semantic_delta.action !== "step-progress")
    return;
  const delta = proposal.semantic_delta;
  const entry = expectedStepExecutionLog(current, proposal);
  const sameOptionalValue = (left, right) => digest(left ?? null) === digest(right ?? null);
  if (entry.mode !== proposal.mode || entry.step_id !== delta.step_id || entry.status !== delta.status || entry.evidence_refs.join("|") !== delta.evidence_refs.join("|") || !sameOptionalValue(entry.note, delta.note) || !sameOptionalValue(entry.repair_fingerprint, delta.repair_fingerprint) || !sameOptionalValue(entry.diff_target, delta.diff_target ?? delta.review_receipt?.diff_target) || !sameOptionalValue(entry.review_receipt, delta.review_receipt)) {
    fail2("RUNTIME_REPLAY_INCOMPLETE", "step-progress replay does not match the durable execution record.");
  }
  if (entry.mode === "repair" && entry.repair_fingerprint === undefined) {
    fail2("RUNTIME_REPLAY_INCOMPLETE", "repair replay is missing its durable finding fingerprint.");
  }
  if (entry.status === "completed" && entry.mode === "default" && entry.advancement === undefined) {
    return;
  }
  if (entry.advancement === undefined || entry.checkpoint === undefined || entry.next_step_id === undefined) {
    fail2("RUNTIME_REPLAY_INCOMPLETE", "step-progress replay is missing its durable advancement outcome.");
  }
}
function assertTaskStateReplay(current, proposal) {
  if (proposal.semantic_delta.kind === "task-state" && DRAFT_TASK_STATE_ACTIONS.includes(proposal.semantic_delta.action)) {
    assertDraftTaskReplay(current, proposal);
    return;
  }
  if (proposal.semantic_delta.kind === "task-state" && proposal.semantic_delta.action === "step-progress") {
    assertStepProgressReplay(current, proposal);
    return;
  }
  if (proposal.semantic_delta.kind !== "task-state" || !REPLAN_TASK_STATE_ACTIONS.includes(proposal.semantic_delta.action))
    return;
  const delta = proposal.semantic_delta;
  const audit = expectedReplanReplayAudit(current, proposal);
  assertExecutionAuditInBody(current.body, audit);
  assertNoLaterReplanAudit(current, audit);
  if (delta.action === "mark-replan-blocked") {
    if (current.runtimeState.workflow_status !== "blocked_by_replan" || current.runtimeState.lifecycle_state !== "active")
      fail2("RUNTIME_REPLAY_INCOMPLETE", "mark-replan-blocked replay no longer has the blocked_by_replan + active tuple.");
  } else if (delta.action === "clear-replan-block") {
    if (current.runtimeState.workflow_status !== "active" || current.runtimeState.lifecycle_state !== "active")
      fail2("RUNTIME_REPLAY_INCOMPLETE", "clear-replan-block replay no longer has the active + active tuple.");
  } else {
    const commitDelta = delta;
    if (current.runtimeState.workflow_status !== "active" || current.runtimeState.lifecycle_state !== "active")
      fail2("RUNTIME_REPLAY_INCOMPLETE", "commit-replan replay no longer has the active + active tuple.");
    assertReplacementActiveStep(commitDelta.active_step_id, commitDelta.replacement_definition.implementation_steps);
    if (current.runtimeState.active_step_id !== commitDelta.active_step_id || current.runtimeState.active_step_status !== "ready")
      fail2("RUNTIME_REPLAY_INCOMPLETE", "commit-replan replay no longer has the replacement active step ready.");
    if (current.runtimeState.resume_requires_review || current.runtimeState.resume_review_reasons.length > 0)
      fail2("RUNTIME_REPLAY_INCOMPLETE", "commit-replan replay no longer has a cleared resume gate.");
    assertReplanDefinitionSections(current.body, commitDelta.replacement_definition);
  }
  const expectedEvidenceRefs = delta.evidence_refs;
  if (audit.idempotency_key !== proposal.idempotency_key || audit.action !== delta.action || audit.source_revision !== proposal.source_tuple.revision || audit.evidence_refs.join("|") !== expectedEvidenceRefs.join("|") || audit.task_id !== current.runtimeState.task_id || audit.task_slug !== current.runtimeState.task_slug || audit.document_id !== current.sourceTuple.document_id) {
    fail2("RUNTIME_REPLAY_INCOMPLETE", "replan replay audit does not match the proposal identity or evidence.");
  }
}
function applyTaskStateDelta(root, current, proposal, now) {
  if (proposal.semantic_delta.kind !== "task-state")
    fail2("RUNTIME_SCHEMA_INVALID", "Expected task-state delta.");
  const delta = proposal.semantic_delta;
  if (delta.action === "create-draft") {
    ensureAuthorityKinds(proposal, ["scope-admission", "evidence-admission"]);
    ensureAnyAuthorityKind(proposal, ["user-confirmation", "authorized-caller"]);
    if (current.runtimeState.workflow_status !== "closed" || current.runtimeState.lifecycle_state !== "archived") {
      fail2("DRAFT_CREATION_BLOCKED", "create-draft requires the current task to be closed + archived.");
    }
    const expectedTaskId = allocateNextTaskId(root, current.runtimeState.task_id);
    if (delta.task_id !== expectedTaskId) {
      fail2("TASK_ID_ALLOCATION_CONFLICT", `create-draft must allocate the next unused task identity ${expectedTaskId}.`);
    }
    if (delta.document_id === current.sourceTuple.document_id || collectTaskDocumentIds(root).has(delta.document_id)) {
      fail2("DOCUMENT_ID_COLLISION", "create-draft document_id must be fresh across canonical task artifacts.");
    }
    if (current.runtimeState.task_id === "000") {
      const bootstrapArchive = archivePathForTask(root, current);
      if (fs3.existsSync(bootstrapArchive.filePath))
        fail2("TASK_ARCHIVE_CONFLICT", "bootstrap TASK-000 must not already have a canonical archive before the first ordinary draft.");
    } else {
      const { receipt } = matchingArchiveReceipt(root, current);
      assertPreviousTaskReconciliationComplete(root, current, receipt);
    }
    assertStrictDraftImplementationSteps(delta.active_step_id, delta.draft_definition.implementation_steps);
    const draftIdentity = {
      task_id: delta.task_id,
      task_slug: delta.task_slug,
      document_id: delta.document_id,
      task_title: delta.task_title
    };
    const emptyDraftState = {
      schema_version: 1,
      kind: VNEXT_RUNTIME_STATE_KIND,
      task_id: delta.task_id,
      task_slug: delta.task_slug,
      workflow_status: "draft",
      lifecycle_state: "active",
      resume_requires_review: false,
      resume_review_reasons: [],
      active_step_id: delta.active_step_id,
      active_step_status: "ready",
      finding_queue_revision: 0,
      review_cycle: createReviewCycleZero(),
      findings: [],
      execution_log: [],
      applied_proposals: []
    };
    const draftStateWithProposal = {
      ...emptyDraftState,
      applied_proposals: appendAppliedProposal(emptyDraftState, proposal, current.sourceTuple.revision)
    };
    const audit = makeDraftAudit(current, proposal, draftStateWithProposal, now);
    const next2 = { ...draftStateWithProposal, execution_log: appendExecutionLogEntry(draftStateWithProposal, audit) };
    return {
      next: next2,
      draftDefinition: delta.draft_definition,
      draftIdentity,
      draftDocumentId: delta.document_id,
      audit
    };
  }
  if (delta.action === "update-draft") {
    ensureAuthorityKinds(proposal, ["scope-admission", "evidence-admission"]);
    ensureAnyAuthorityKind(proposal, ["active-task-owner", "user-confirmation", "authorized-caller"]);
    if (current.runtimeState.workflow_status !== "draft" || current.runtimeState.lifecycle_state !== "active") {
      fail2("DRAFT_REFINEMENT_BLOCKED", "update-draft requires the current task to be draft + active.");
    }
    if (delta.task_id !== current.runtimeState.task_id || delta.task_slug !== current.runtimeState.task_slug || delta.document_id !== current.sourceTuple.document_id) {
      fail2("DRAFT_IDENTITY_IMMUTABLE", "update-draft must preserve TASK_ID, TASK_SLUG, and document_id.");
    }
    const currentIdentity = extractTaskIdentityFromCurrentTask(current.body);
    if (currentIdentity.title !== delta.task_title)
      fail2("DRAFT_IDENTITY_IMMUTABLE", "update-draft must preserve the task title identity.");
    assertStrictDraftImplementationSteps(delta.active_step_id, delta.draft_definition.implementation_steps);
    const nextWithoutAudit = {
      ...current.runtimeState,
      workflow_status: "draft",
      lifecycle_state: "active",
      active_step_id: delta.active_step_id,
      active_step_status: "ready",
      applied_proposals: appendAppliedProposal(current.runtimeState, proposal, current.sourceTuple.revision)
    };
    const audit = makeDraftAudit(current, proposal, nextWithoutAudit, now);
    const next2 = { ...nextWithoutAudit, execution_log: appendExecutionLogEntry(current.runtimeState, audit) };
    return {
      next: next2,
      replacementDefinition: delta.draft_definition,
      draftIdentity: {
        task_id: current.runtimeState.task_id,
        task_slug: current.runtimeState.task_slug,
        document_id: current.sourceTuple.document_id,
        task_title: currentIdentity.title
      },
      draftDocumentId: current.sourceTuple.document_id,
      audit
    };
  }
  if (delta.action === "confirm-draft") {
    ensureAnyAuthorityKind(proposal, ["user-confirmation", "authorized-caller"]);
    ensureAuthorityKinds(proposal, ["evidence-admission"]);
    const confirmationAuthorities = proposal.authority_evidence.filter((item) => item.kind === "user-confirmation" || item.kind === "authorized-caller");
    for (const auth of confirmationAuthorities) {
      if (!auth.task_id || !auth.document_id || !auth.draft_revision) {
        fail2("RUNTIME_AUTHORITY_INVALID", "confirm-draft authority evidence must bind task_id, document_id, and draft_revision.");
      }
      if (auth.task_id !== current.runtimeState.task_id) {
        fail2("DRAFT_IDENTITY_CONFLICT", `confirm-draft authority task_id ${auth.task_id} does not match current task ${current.runtimeState.task_id}.`);
      }
      if (auth.document_id !== current.sourceTuple.document_id) {
        fail2("DRAFT_IDENTITY_CONFLICT", `confirm-draft authority document_id ${auth.document_id} does not match current document ${current.sourceTuple.document_id}.`);
      }
      if (auth.draft_revision !== current.sourceTuple.revision) {
        fail2("DRAFT_REVISION_CONFLICT", `confirm-draft authority draft_revision ${auth.draft_revision} does not match current draft revision ${current.sourceTuple.revision}.`);
      }
    }
    if (current.runtimeState.workflow_status !== "draft" || current.runtimeState.lifecycle_state !== "active") {
      fail2("DRAFT_CONFIRMATION_BLOCKED", "confirm-draft requires the current task to be draft + active.");
    }
    if (delta.task_id !== current.runtimeState.task_id || delta.task_slug !== current.runtimeState.task_slug || delta.document_id !== current.sourceTuple.document_id) {
      fail2("DRAFT_IDENTITY_CONFLICT", "confirm-draft identity does not match the current draft.");
    }
    if (delta.draft_revision !== current.sourceTuple.revision) {
      fail2("DRAFT_REVISION_CONFLICT", "confirm-draft must bind the exact current draft source revision.");
    }
    if (current.runtimeState.active_step_status !== "ready") {
      fail2("DRAFT_CONFIRMATION_BLOCKED", "confirm-draft requires the admitted draft step to remain ready.");
    }
    assertDraftDefinitionReady(current.body, current.runtimeState.active_step_id);
    const nextWithoutAudit = {
      ...current.runtimeState,
      workflow_status: "active",
      lifecycle_state: "active",
      applied_proposals: appendAppliedProposal(current.runtimeState, proposal, current.sourceTuple.revision)
    };
    const audit = makeDraftAudit(current, proposal, nextWithoutAudit, now);
    const next2 = { ...nextWithoutAudit, execution_log: appendExecutionLogEntry(current.runtimeState, audit) };
    return { next: next2, audit };
  }
  if (delta.action === "clear-resume-review-gate") {
    ensureAuthorityKinds(proposal, ["active-task-owner", "resume-review", "evidence-admission"]);
    if (current.runtimeState.workflow_status !== "active" || current.runtimeState.lifecycle_state !== "active") {
      fail2("TASK_STATE_NOT_ACTIVE", "resume review can be cleared only after the task has resumed to active + active.");
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
      fail2("REPLAN_TRANSITION_INVALID", "mark-replan-blocked requires active + active.");
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
      fail2("REPLAN_TRANSITION_INVALID", "clear-replan-block requires blocked_by_replan + active.");
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
      fail2("REPLAN_TRANSITION_INVALID", "commit-replan requires superseded + active.");
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
  if (delta.action !== "step-progress")
    fail2("RUNTIME_SCHEMA_INVALID", "Only step-progress reaches the execute-step state handler.");
  ensureAuthorityKinds(proposal, ["active-task-owner", "scope-admission", "evidence-admission"]);
  if (current.runtimeState.workflow_status === "draft" && current.runtimeState.lifecycle_state === "active") {
    fail2("DRAFT_NOT_EXECUTABLE", "execute-step is blocked for draft + active until prepare-task:confirm commits confirm-draft.");
  }
  if (current.runtimeState.workflow_status !== "active" || current.runtimeState.lifecycle_state !== "active") {
    fail2("TASK_STATE_NOT_ACTIVE", "execute-step requires the current task to be active + active.");
  }
  if (current.runtimeState.resume_requires_review) {
    fail2("RESUME_REVIEW_REQUIRED", "execute-step cannot proceed until prepare-task clears the resume review gate.");
  }
  if (delta.step_id !== current.runtimeState.active_step_id)
    fail2("ACTIVE_STEP_CONFLICT", "Proposal step_id does not match the admitted current step.");
  const executionMode = proposal.mode;
  const stepResolution = resolveCanonicalTaskStep(current);
  const checkpoint = effectiveCheckpointPolicy(stepResolution);
  const currentStepRepairLogs = current.runtimeState.execution_log.filter((item) => !("action" in item) && item.step_id === delta.step_id && item.mode === "repair");
  const openFindings = current.runtimeState.findings.filter((item) => item.status === "admitted" || item.status === "in-progress");
  if (executionMode === "repair") {
    if (!delta.repair_fingerprint)
      fail2("FINDING_ADMISSION_REQUIRED", "repair mode requires repair_fingerprint.");
    const finding = current.runtimeState.findings.find((item) => item.fingerprint === delta.repair_fingerprint);
    if (!finding || !["admitted", "in-progress"].includes(finding.status))
      fail2("FINDING_ADMISSION_REQUIRED", "repair fingerprint is not an admitted current-task finding.");
    if (!delta.diff_target)
      fail2("REPAIR_DIFF_TARGET_REQUIRED", "repair mode requires one explicit logical diff_target.");
    if (delta.review_receipt !== undefined)
      fail2("REVIEW_READ_ONLY_VIOLATION", "repair execution cannot attach a review receipt; verification remains a separate review result.");
  } else {
    if (delta.repair_fingerprint !== undefined)
      fail2("RUNTIME_MODE_INVALID", "default execution cannot carry a repair fingerprint.");
    if (delta.diff_target !== undefined && delta.review_receipt === undefined)
      fail2("REVIEW_RECEIPT_REQUIRED", "diff_target on default execution must be carried by a review receipt.");
    if (delta.review_receipt !== undefined && delta.status !== "completed")
      fail2("REVIEW_RECEIPT_REQUIRED", "review receipt is only valid when completing the current step.");
    if (delta.diff_target !== undefined && delta.review_receipt !== undefined && delta.diff_target !== delta.review_receipt.diff_target) {
      fail2("REVIEW_TARGET_CONFLICT", "step-progress diff_target must match the review receipt diff_target.");
    }
  }
  const executionDiffTarget = delta.diff_target ?? delta.review_receipt?.diff_target;
  const oldStatus = current.runtimeState.active_step_status;
  const newStatus = delta.status;
  const legal = oldStatus === newStatus || oldStatus === "ready" && ["in-progress", "completed", "blocked"].includes(newStatus) || oldStatus === "in-progress" && ["completed", "blocked"].includes(newStatus) || oldStatus === "blocked" && executionMode === "repair" && ["in-progress", "completed"].includes(newStatus);
  if (!legal)
    fail2("TASK_STATE_TRANSITION_INVALID", `Cannot transition active step from ${oldStatus} to ${newStatus}.`);
  let advancement = {
    outcome: "not-applicable",
    from_step_id: delta.step_id,
    to_step_id: null,
    checkpoint
  };
  if (executionMode === "repair" && newStatus === "completed") {
    advancement = {
      outcome: "repair-awaiting-verification",
      from_step_id: delta.step_id,
      to_step_id: null,
      checkpoint
    };
  } else if (executionMode === "default" && newStatus === "completed") {
    if (openFindings.length > 0) {
      fail2("REVIEW_CONVERGENCE_REQUIRED", "step advancement is blocked while an admitted or in-progress finding remains open.");
    }
    if (checkpoint === "required" && delta.review_receipt === undefined) {
      fail2("REVIEW_CHECKPOINT_REQUIRED", `step ${delta.step_id} requires a clean review checkpoint before advancement.`);
    }
    if (delta.review_receipt !== undefined) {
      if (delta.review_receipt.cycle_id !== current.runtimeState.review_cycle.id) {
        fail2("REVIEW_CYCLE_CONFLICT", "review receipt cycle_id does not match the current Runtime review cycle.");
      }
      if (currentStepRepairLogs.length > 0 && delta.review_receipt.cycle_phase !== "verification") {
        fail2("REVIEW_VERIFICATION_REQUIRED", "an admitted repair must re-enter review through verification on the same logical diff.");
      }
      if (currentStepRepairLogs.length === 0 && delta.review_receipt.cycle_phase !== "discovery") {
        fail2("REVIEW_PHASE_INVALID", "a checkpoint without an admitted repair must use discovery review.");
      }
    }
    if (currentStepRepairLogs.length > 0) {
      const repairFingerprints = [...new Set(currentStepRepairLogs.map((item) => {
        if (!item.repair_fingerprint)
          fail2("REPAIR_VERIFICATION_REQUIRED", "a repair execution record is missing its finding fingerprint.");
        if (!item.diff_target)
          fail2("REPAIR_DIFF_TARGET_REQUIRED", "a repair execution record is missing its logical diff target.");
        return item.repair_fingerprint;
      }))];
      const repairTargets = [...new Set(currentStepRepairLogs.map((item) => item.diff_target))];
      if (repairTargets.length !== 1)
        fail2("REPAIR_DIFF_TARGET_CONFLICT", "all repair attempts for one step must use the same logical diff target.");
      const receipt = delta.review_receipt;
      if (!receipt)
        fail2("REVIEW_VERIFICATION_REQUIRED", "repair completion requires a clean verification receipt before advancement.");
      if (receipt.diff_target !== repairTargets[0])
        fail2("REPAIR_DIFF_TARGET_CONFLICT", "verification must cover the exact logical diff target repaired by the current step.");
      if (receipt.admitted_fingerprints.length !== repairFingerprints.length || receipt.admitted_fingerprints.some((fingerprint) => !repairFingerprints.includes(fingerprint))) {
        fail2("REVIEW_VERIFICATION_REQUIRED", "verification must cover exactly the admitted repair fingerprints for the current step.");
      }
      for (const fingerprint of repairFingerprints) {
        const finding = current.runtimeState.findings.find((item) => item.fingerprint === fingerprint);
        if (!finding || finding.status !== "resolved") {
          fail2("REVIEW_CONVERGENCE_REQUIRED", `repair finding ${fingerprint} must be resolved only after verification before step advancement.`);
        }
      }
      advancement.review_phase = receipt.cycle_phase;
    } else if (delta.review_receipt) {
      advancement.review_phase = delta.review_receipt.cycle_phase;
    }
    if (stepResolution.next) {
      advancement = {
        ...advancement,
        outcome: "advanced",
        to_step_id: stepResolution.next.id
      };
    } else {
      advancement = {
        ...advancement,
        outcome: "task-complete",
        to_step_id: null
      };
    }
  }
  const executionLog = [
    ...current.runtimeState.execution_log,
    {
      idempotency_key: proposal.idempotency_key,
      mode: executionMode,
      step_id: delta.step_id,
      status: newStatus,
      evidence_refs: [...delta.evidence_refs],
      ...delta.note ? { note: delta.note } : {},
      ...delta.repair_fingerprint ? { repair_fingerprint: delta.repair_fingerprint } : {},
      ...executionDiffTarget ? { diff_target: executionDiffTarget } : {},
      checkpoint,
      advancement: advancement.outcome,
      next_step_id: advancement.to_step_id,
      ...delta.review_receipt ? { review_receipt: delta.review_receipt } : {},
      recorded_at: now
    }
  ].slice(-MAX_EXECUTION_LOG);
  const next = {
    ...current.runtimeState,
    active_step_id: advancement.outcome === "advanced" ? advancement.to_step_id : current.runtimeState.active_step_id,
    active_step_status: advancement.outcome === "advanced" ? "ready" : newStatus,
    execution_log: executionLog,
    applied_proposals: appendAppliedProposal(current.runtimeState, proposal, current.sourceTuple.revision)
  };
  return {
    next,
    findingStatus: delta.repair_fingerprint ? current.runtimeState.findings.find((item) => item.fingerprint === delta.repair_fingerprint)?.status : undefined,
    advancement
  };
}
function applyFindingQueueDelta(current, proposal, now) {
  if (proposal.semantic_delta.kind !== "finding-queue")
    fail2("RUNTIME_SCHEMA_INVALID", "Expected finding-queue delta.");
  ensureAuthorityKinds(proposal, ["active-task-owner", "scope-admission", "finding-admission", "evidence-admission"]);
  if (current.runtimeState.workflow_status === "draft" && current.runtimeState.lifecycle_state === "active") {
    fail2("DRAFT_NOT_EXECUTABLE", "finding queue changes are blocked for draft + active until prepare-task:confirm commits confirm-draft.");
  }
  if (current.runtimeState.workflow_status !== "active" || current.runtimeState.lifecycle_state !== "active") {
    fail2("TASK_STATE_NOT_ACTIVE", "finding queue changes require the current task to be active + active.");
  }
  if (current.runtimeState.resume_requires_review) {
    fail2("RESUME_REVIEW_REQUIRED", "finding queue changes are blocked until prepare-task clears the resume review gate.");
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
      fail2("FINDING_OWNER_CONFLICT", "finding owner_task_id must match the active task.");
    if (findings.some((item) => item.fingerprint === candidate.fingerprint)) {
      const reAdmitCandidate = findings.find((item) => item.fingerprint === candidate.fingerprint);
      const equivalent = reAdmitCandidate.owner_task_id === candidate.owner_task_id && reAdmitCandidate.file === candidate.file && reAdmitCandidate.failure_condition === candidate.failure_condition && reAdmitCandidate.violated_invariant === candidate.violated_invariant;
      if (equivalent && ["admitted", "in-progress"].includes(reAdmitCandidate.status))
        return { next: current.runtimeState, findingStatus: reAdmitCandidate.status };
      if (!equivalent)
        fail2("FINDING_DUPLICATE_CONFLICT", `finding fingerprint ${candidate.fingerprint} already exists with different semantics.`);
      reAdmitIndex = findings.findIndex((item) => item.fingerprint === candidate.fingerprint);
    }
    if (reviewCycle.id !== candidate.review_cycle_id) {
      const hasOpenFindings = findings.some((item) => item.status === "admitted" || item.status === "in-progress");
      if (hasOpenFindings) {
        fail2("REVIEW_CYCLE_NOT_CONVERGED", "A new review cycle may start only after all admitted and in-progress findings in the current cycle are terminal.");
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
        fail2("REVIEW_CYCLE_PHASE_CONFLICT", "Discovery admission is closed after repair or verification; use the bounded verification admission wave.");
      }
    } else {
      if (reviewCycle.repair_round === 0) {
        fail2("REVIEW_CYCLE_PHASE_CONFLICT", "Verification admission requires at least one completed repair round.");
      }
      if (reviewCycle.verification_new_finding_wave_used) {
        if (reviewCycle.verification_new_finding_wave_id !== delta.finding_admission_wave_id) {
          fail2("NEW_FINDING_WAVE_BUDGET_EXHAUSTED", "This review cycle has already used its one verification new-finding admission wave.");
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
      fail2("FINDING_NOT_FOUND", `finding ${delta.fingerprint} is not present in the current queue.`);
    const finding = findings[index];
    if (delta.action === "record-repair-attempt") {
      if (proposal.mode !== "repair")
        fail2("RUNTIME_MODE_INVALID", "record-repair-attempt requires execute-step:repair.");
      if (!["admitted", "in-progress"].includes(finding.status))
        fail2("FINDING_STATE_INVALID", `finding ${finding.fingerprint} is not repairable from ${finding.status}.`);
      if (finding.repair_attempts >= finding.max_repair_attempts)
        fail2("REPAIR_BUDGET_EXHAUSTED", `finding ${finding.fingerprint} has exhausted its repair budget.`);
      if (delta.review_cycle_id !== reviewCycle.id) {
        fail2("REVIEW_CYCLE_CONFLICT", "record-repair-attempt must target the current review cycle; only finding admission may start a new cycle.");
      }
      if (finding.review_cycle_id !== reviewCycle.id) {
        fail2("REVIEW_CYCLE_CONFLICT", `finding ${finding.fingerprint} does not belong to the current review cycle.`);
      }
      if (reviewCycle.counted_repair_wave_ids.includes(delta.repair_wave_id) && reviewCycle.active_repair_wave_id !== delta.repair_wave_id) {
        fail2("REPAIR_WAVE_CLOSED", `repair wave ${delta.repair_wave_id} has already ended and cannot be reused.`);
      }
      if (finding.last_repair_wave_id === delta.repair_wave_id) {
        fail2("REPAIR_WAVE_FINDING_DUPLICATE", `finding ${finding.fingerprint} already has an attempt in repair wave ${delta.repair_wave_id}.`);
      }
      if (reviewCycle.active_repair_wave_id !== delta.repair_wave_id) {
        if (reviewCycle.repair_round >= MAX_REPAIR_ROUNDS)
          fail2("REPAIR_BUDGET_EXHAUSTED", "review-cycle repair round budget is exhausted.");
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
        fail2("RUNTIME_MODE_INVALID", "resolve requires execute-step:repair.");
      if (!["admitted", "in-progress"].includes(finding.status))
        fail2("FINDING_STATE_INVALID", `finding ${finding.fingerprint} is not resolvable from ${finding.status}.`);
      finding.status = "resolved";
      finding.updated_at = now;
      finding.evidence_refs = [...new Set([...finding.evidence_refs, ...delta.evidence_refs])];
    } else {
      if (proposal.mode !== "repair")
        fail2("RUNTIME_MODE_INVALID", `${delta.action} requires execute-step:repair.`);
      if (!["admitted", "in-progress"].includes(finding.status))
        fail2("FINDING_STATE_INVALID", `finding ${finding.fingerprint} cannot be ${delta.action} from ${finding.status}.`);
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
    fail2("RUNTIME_SCHEMA_INVALID", `${location} must be a single-line value in a suspended package.`);
  return result;
}
function extractSuspendedPackageFields(header, location) {
  const fields = {};
  for (const line of header.split(/\r?\n/)) {
    const match = /^\s*-\s*([a-z][a-z0-9_]*)\s*:\s*(.*?)\s*$/.exec(line);
    if (!match)
      continue;
    if (match[1] in fields)
      fail2("RUNTIME_SCHEMA_INVALID", `${location} contains duplicate field ${match[1]}.`);
    fields[match[1]] = match[2].trim();
  }
  return fields;
}
function requiredPackageField(fields, field, location) {
  const value = fields[field];
  if (value === undefined || value.trim().length === 0)
    fail2("RUNTIME_SCHEMA_INVALID", `${location} is missing required field ${field}.`);
  return value.trim();
}
function packagePathForTask(root, taskId, taskSlug, artifactKind) {
  let relativePath;
  try {
    relativePath = getTaskArtifactPath(taskId, taskSlug, artifactKind);
  } catch (error) {
    fail2("RUNTIME_PATH_INVALID", error instanceof Error ? error.message : String(error));
  }
  const filePath = path4.resolve(path4.resolve(root), ...relativePath.split("/"));
  const resolvedRoot = path4.resolve(root);
  const relativeCheck = path4.relative(resolvedRoot, filePath).replace(/\\/g, "/");
  if (relativeCheck !== relativePath || relativeCheck.startsWith("../") || path4.isAbsolute(relativeCheck)) {
    fail2("RUNTIME_PATH_INVALID", `suspended package path escapes the target root: ${relativePath}`);
  }
  return { filePath, relativePath };
}
function replacePackageField(content, field, value) {
  const pattern = new RegExp(`^-\\s*${field.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}\\s*:\\s*[^\\r\\n]*$`, "gm");
  const matches = content.match(pattern) ?? [];
  if (matches.length !== 1)
    fail2("RUNTIME_SCHEMA_INVALID", `suspended package must contain exactly one ${field} field.`);
  return content.replace(pattern, `- ${field}: ${value}`);
}
function parseSuspendedPackage(root, current, relativePath, expectedKind) {
  const normalizedPath = normalizeRepoPath2(relativePath, "suspended package path");
  const pathMatch = /^TASKS\/(paused|interrupted)\/TASK-([0-9]{3,})-([a-z0-9]+(?:-[a-z0-9]+)*)\.md$/.exec(normalizedPath);
  if (!pathMatch)
    fail2("RUNTIME_PATH_INVALID", `suspended package path is outside the paused/interrupted contract: ${normalizedPath}`);
  const pathKind = pathMatch[1];
  const pathTaskId = pathMatch[2];
  const pathTaskSlug = pathMatch[3];
  if (expectedKind && pathKind !== expectedKind)
    fail2("RUNTIME_PATH_INVALID", `suspended package path kind ${pathKind} does not match ${expectedKind}.`);
  if (pathTaskId !== current.runtimeState.task_id || pathTaskSlug !== current.runtimeState.task_slug) {
    fail2("RUNTIME_IDENTITY_CONFLICT", "suspended package path identity does not match the canonical current task.");
  }
  const canonicalExpectedPath = packagePathForTask(root, pathTaskId, pathTaskSlug, pathKind);
  if (normalizedPath !== canonicalExpectedPath.relativePath)
    fail2("RUNTIME_PATH_INVALID", "suspended package path is not the canonical identity-derived path.");
  const filePath = canonicalExpectedPath.filePath;
  if (!fs3.existsSync(filePath))
    fail2("SUSPENDED_PACKAGE_MISSING", `suspended package is missing: ${normalizedPath}`);
  const raw = fs3.readFileSync(filePath, "utf8");
  if (raw.split(SUSPENDED_PACKAGE_BEGIN).length !== 2 || raw.split(SUSPENDED_PACKAGE_END).length !== 2) {
    fail2("SUSPENDED_PACKAGE_INVALID", `${normalizedPath} must contain exactly one complete CURRENT_TASK snapshot.`);
  }
  const beginIndex = raw.indexOf(SUSPENDED_PACKAGE_BEGIN);
  const endIndex = raw.indexOf(SUSPENDED_PACKAGE_END);
  if (beginIndex < 0 || endIndex <= beginIndex)
    fail2("SUSPENDED_PACKAGE_INVALID", `${normalizedPath} has an invalid snapshot marker order.`);
  const header = raw.slice(0, beginIndex);
  const fields = extractSuspendedPackageFields(header, normalizedPath);
  const taskId = requiredPackageField(fields, "task_id", normalizedPath);
  const taskTitle = packageText(requiredPackageField(fields, "task_title", normalizedPath), `${normalizedPath}.task_title`);
  const taskSlug = requiredPackageField(fields, "task_slug", normalizedPath);
  try {
    validateTaskId(taskId);
    validateTaskSlug(taskSlug);
  } catch (error) {
    fail2("RUNTIME_SCHEMA_INVALID", error instanceof Error ? error.message : String(error));
  }
  if (taskId !== pathTaskId || taskSlug !== pathTaskSlug)
    fail2("RUNTIME_IDENTITY_CONFLICT", "suspended package fields do not match its canonical path.");
  const artifactKind = expectEnum(requiredPackageField(fields, "artifact_kind", normalizedPath), ["paused", "interrupted"], `${normalizedPath}.artifact_kind`);
  if (artifactKind !== pathKind)
    fail2("SUSPENDED_PACKAGE_INVALID", "suspended package artifact_kind does not match its path.");
  const lifecycleState = expectEnum(requiredPackageField(fields, "lifecycle_state", normalizedPath), ["paused_pending_closure", "paused_blocked", "interrupted"], `${normalizedPath}.lifecycle_state`);
  if (artifactKind === "paused" && !["paused_pending_closure", "paused_blocked"].includes(lifecycleState) || artifactKind === "interrupted" && lifecycleState !== "interrupted") {
    fail2("SUSPENDED_PACKAGE_INVALID", "suspended package lifecycle_state does not match artifact_kind.");
  }
  const resumeRequiresReview = parseBooleanField(requiredPackageField(fields, "resume_requires_review", normalizedPath), `${normalizedPath}.resume_requires_review`);
  const rawResumeReviewReasons = requiredPackageField(fields, "resume_review_reasons", normalizedPath).split(",").map((reason) => reason.trim()).filter(Boolean);
  const resumeReviewReasons = normalizeResumeReviewReasons(rawResumeReviewReasons);
  if (rawResumeReviewReasons.join("|") !== resumeReviewReasons.join("|")) {
    fail2("SUSPENDED_PACKAGE_INVALID", `${normalizedPath}.resume_review_reasons must use the canonical closed-set order without duplicates.`);
  }
  try {
    validateCurrentTaskResumeGate(lifecycleState, resumeRequiresReview, resumeReviewReasons);
  } catch (error) {
    fail2("SUSPENDED_PACKAGE_INVALID", error instanceof Error ? error.message : String(error));
  }
  const rehydrationStatus = expectEnum(requiredPackageField(fields, "rehydration_status", normalizedPath), ["write_incomplete", "ready_for_resume", "rehydrated"], `${normalizedPath}.rehydration_status`);
  const ownershipState = expectEnum(requiredPackageField(fields, "ownership_state", normalizedPath), ["recovery_only", "rehydrated"], `${normalizedPath}.ownership_state`);
  if (rehydrationStatus === "write_incomplete" && ownershipState !== "recovery_only")
    fail2("SUSPENDED_PACKAGE_INVALID", "write_incomplete package must remain recovery_only.");
  if (rehydrationStatus === "ready_for_resume" && (ownershipState !== "recovery_only" || !resumeRequiresReview))
    fail2("SUSPENDED_PACKAGE_INVALID", "ready_for_resume package must be recovery_only and review-gated.");
  if (rehydrationStatus === "rehydrated" && ownershipState !== "rehydrated")
    fail2("SUSPENDED_PACKAGE_INVALID", "rehydrated package must use ownership_state=rehydrated.");
  const documentId = requiredPackageField(fields, "document_id", normalizedPath);
  if (!DOCUMENT_ID_PATTERN.test(documentId))
    fail2("RUNTIME_SCHEMA_INVALID", `${normalizedPath}.document_id is invalid.`);
  const snapshotSha256 = requiredPackageField(fields, "snapshot_sha256", normalizedPath);
  if (!/^[a-f0-9]{64}$/.test(snapshotSha256))
    fail2("RUNTIME_SCHEMA_INVALID", `${normalizedPath}.snapshot_sha256 must be SHA-256.`);
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
  const snapshotRaw = snapshotCandidates.find((candidate) => sha2562(candidate) === snapshotSha256);
  if (snapshotRaw === undefined)
    fail2("SUSPENDED_PACKAGE_INVALID", `${normalizedPath} snapshot_sha256 does not match the embedded CURRENT_TASK snapshot.`);
  const snapshot = parseCanonicalCurrentTaskContent(snapshotRaw, current.filePath, current.relativePath);
  if (snapshot.frontmatter.document_id !== documentId || snapshot.frontmatter.document_id !== current.frontmatter.document_id) {
    fail2("RUNTIME_SOURCE_CONFLICT", "suspended package document_id conflicts with CURRENT_TASK or its snapshot.");
  }
  if (snapshot.runtimeState.task_id !== taskId || snapshot.runtimeState.task_slug !== taskSlug || snapshot.runtimeState.workflow_status !== "active" || snapshot.runtimeState.lifecycle_state !== "active") {
    fail2("SUSPENDED_PACKAGE_INVALID", "suspended package snapshot must preserve the same active task before suspension.");
  }
  const snapshotIdentity = extractTaskIdentityFromCurrentTask(snapshot.body);
  if (snapshotIdentity.title !== taskTitle)
    fail2("RUNTIME_SOURCE_CONFLICT", "suspended package task_title conflicts with its snapshot.");
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
    revision: sha2562(raw),
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
    `- snapshot_sha256: ${sha2562(current.raw)}`
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
    fail2("LIFECYCLE_SOURCE_CONFLICT", "suspended CURRENT_TASK runtime_state differs from the recovery snapshot.");
  }
  const currentFrontmatter = { ...current.frontmatter };
  const snapshotFrontmatter = { ...snapshot.frontmatter };
  delete currentFrontmatter.runtime_state;
  delete snapshotFrontmatter.runtime_state;
  if (digest(currentFrontmatter) !== digest(snapshotFrontmatter)) {
    fail2("LIFECYCLE_SOURCE_CONFLICT", "suspended CURRENT_TASK frontmatter differs from the recovery snapshot.");
  }
  const normalizedCurrentBody = renderCurrentTaskLifecycleFields(current.body, snapshot.runtimeState);
  const normalizedSnapshotBody = renderCurrentTaskLifecycleFields(snapshot.body, snapshot.runtimeState);
  if (normalizedCurrentBody !== normalizedSnapshotBody) {
    fail2("LIFECYCLE_SOURCE_CONFLICT", "suspended CURRENT_TASK body differs from the recovery snapshot.");
  }
}
function assertSuspendedGateMatchesPackage(current, packageArtifact) {
  if (current.runtimeState.resume_requires_review !== packageArtifact.resumeRequiresReview || current.runtimeState.resume_review_reasons.join("|") !== packageArtifact.resumeReviewReasons.join("|")) {
    fail2("RESUME_GATE_DRIFT", "CURRENT_TASK resume gate differs from the suspended package gate.");
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
        fail2("LIFECYCLE_REPLAY_INCOMPLETE", "supersede replay no longer has the original superseded + active CURRENT_TASK tuple.");
      }
      const audit = current.runtimeState.execution_log.find((item) => ("action" in item) && item.action === "supersede" && item.idempotency_key === proposal.idempotency_key);
      if (!audit || audit.invalidation_kind !== delta.invalidation_kind || audit.invalidation_reason !== delta.invalidation_reason || audit.source_revision !== proposal.source_tuple.revision || audit.evidence_refs.join("|") !== delta.evidence_refs.join("|") || digest(audit.partial_diff_disposition) !== digest(delta.partial_diff_disposition)) {
        fail2("LIFECYCLE_REPLAY_INCOMPLETE", "supersede replay is missing its durable invalidation audit record.");
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
      fail2("LIFECYCLE_REPLAY_INCOMPLETE", "lifecycle replay requires the original suspended package to remain ready_for_resume + recovery_only.");
    }
    if (current.runtimeState.workflow_status !== "suspended" || current.runtimeState.lifecycle_state !== delta.lifecycle_state) {
      fail2("LIFECYCLE_REPLAY_INCOMPLETE", "lifecycle replay no longer has the original suspended CURRENT_TASK tuple.");
    }
    if (packageArtifact.lifecycleState !== delta.lifecycle_state) {
      fail2("LIFECYCLE_REPLAY_INCOMPLETE", "lifecycle replay package marker does not match the original transition.");
    }
    assertSuspendedGateMatchesPackage(current, packageArtifact);
    return;
  }
  if (packageArtifact.rehydrationStatus !== "rehydrated" || packageArtifact.ownershipState !== "rehydrated") {
    fail2("LIFECYCLE_REPLAY_INCOMPLETE", "resume replay requires the suspended package to remain rehydrated + rehydrated.");
  }
  if (current.runtimeState.workflow_status !== "active" || current.runtimeState.lifecycle_state !== "active") {
    fail2("LIFECYCLE_REPLAY_INCOMPLETE", "resume replay no longer has an active + active CURRENT_TASK tuple.");
  }
}
function assertSiblingRecoveryIsReconciled(root, current, artifactKind) {
  const siblingKind = artifactKind === "paused" ? "interrupted" : "paused";
  const sibling = packagePathForTask(root, current.runtimeState.task_id, current.runtimeState.task_slug, siblingKind);
  if (!fs3.existsSync(sibling.filePath))
    return;
  const siblingArtifact = parseSuspendedPackage(root, current, sibling.relativePath, siblingKind);
  if (siblingArtifact.rehydrationStatus === "rehydrated" && siblingArtifact.ownershipState === "rehydrated")
    return;
  fail2("SUSPENDED_PACKAGE_AMBIGUOUS", "another ready or incomplete suspended package for the same task is present; reconcile the sibling before continuing.");
}
function prepareExistingPackageForReplacement(root, current, packageRelativePath, artifactKind) {
  const expected = packagePathForTask(root, current.runtimeState.task_id, current.runtimeState.task_slug, artifactKind);
  if (!fs3.existsSync(expected.filePath))
    return;
  const existing = parseSuspendedPackage(root, current, packageRelativePath, artifactKind);
  if (existing.rehydrationStatus === "rehydrated" && existing.ownershipState === "rehydrated")
    return existing.raw;
  if (existing.rehydrationStatus === "write_incomplete") {
    fail2("SUSPENDED_PACKAGE_RECOVERY_REQUIRED", "the existing suspended package is write_incomplete and requires explicit recovery before replacement.");
  }
  fail2("SUSPENDED_PACKAGE_CONFLICT", `suspended package is already ready_for_resume: ${packageRelativePath}`);
}
function assertRequestedLifecycleTargets(root, current, proposal) {
  if (proposal.requested_write_targets[0] !== current.relativePath)
    fail2("RUNTIME_PATH_INVALID", "lifecycle proposal must target the exact canonical CURRENT_TASK path first.");
  const delta = proposal.semantic_delta;
  if (delta.action === "supersede") {
    if (proposal.requested_write_targets.length !== 1)
      fail2("RUNTIME_PATH_INVALID", "supersede may write only the exact canonical CURRENT_TASK path.");
    return {};
  }
  const artifactKind = delta.action === "pause" ? "paused" : delta.action === "interrupt" ? "interrupted" : delta.artifact_kind;
  const expected = packagePathForTask(root, current.runtimeState.task_id, current.runtimeState.task_slug, artifactKind);
  if (delta.action === "resume-paused" || delta.action === "resume-interrupted") {
    if (delta.recovery_package_path !== expected.relativePath)
      fail2("RUNTIME_PATH_INVALID", "resume must use the exact identity-derived suspended package path.");
  }
  if (proposal.requested_write_targets.length !== 2 || proposal.requested_write_targets[1] !== expected.relativePath) {
    fail2("RUNTIME_PATH_INVALID", "lifecycle proposal must name exactly CURRENT_TASK.md and its identity-derived suspended package path.");
  }
  return { packageFilePath: expected.filePath, packageRelativePath: expected.relativePath };
}
function prepareLifecycleTransaction(root, current, proposal, now) {
  const delta = proposal.semantic_delta;
  if (delta.action === "supersede") {
    ensureAuthorityKinds(proposal, ["active-task-owner", "evidence-admission"]);
    if (!["active", "blocked_by_replan"].includes(current.runtimeState.workflow_status) || current.runtimeState.lifecycle_state !== "active") {
      fail2("LIFECYCLE_TRANSITION_INVALID", "supersede requires active + active or blocked_by_replan + active.");
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
      fail2("LIFECYCLE_TRANSITION_INVALID", `${delta.action} requires the current task to be active + active.`);
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
    fail2("LIFECYCLE_TRANSITION_INVALID", "resume requires a suspended CURRENT_TASK source.");
  const expectedLifecycle = delta.action === "resume-paused" ? ["paused_pending_closure", "paused_blocked"] : ["interrupted"];
  if (!expectedLifecycle.includes(current.runtimeState.lifecycle_state))
    fail2("LIFECYCLE_TRANSITION_INVALID", "resume mode does not match the current suspended lifecycle state.");
  if (!fs3.existsSync(packageFilePath))
    fail2("SUSPENDED_PACKAGE_MISSING", `suspended package is missing: ${packageRelativePath}`);
  const packageArtifact = parseSuspendedPackage(root, current, packageRelativePath, delta.artifact_kind);
  if (packageArtifact.rehydrationStatus !== "ready_for_resume" || packageArtifact.ownershipState !== "recovery_only") {
    fail2("SUSPENDED_PACKAGE_NOT_READY", "resume accepts only ready_for_resume + recovery_only packages.");
  }
  if (packageArtifact.revision !== delta.recovery_package_revision) {
    fail2("RECOVERY_PACKAGE_STALE", "the suspended package changed after the resume proposal was created.");
  }
  assertSuspendedGateMatchesPackage(current, packageArtifact);
  assertSuspendedSourceMatchesSnapshot(current, packageArtifact.snapshot);
  if (packageArtifact.lifecycleState !== current.runtimeState.lifecycle_state)
    fail2("LIFECYCLE_SOURCE_CONFLICT", "package lifecycle state conflicts with CURRENT_TASK.");
  if (packageArtifact.resumeReviewReasons.join("|") !== delta.resume_review_reasons.join("|"))
    fail2("RESUME_GATE_DRIFT", "resume review reasons drifted between proposal and suspended package.");
  assertSiblingRecoveryIsReconciled(root, current, delta.artifact_kind);
  if (packageArtifact.documentId !== String(current.frontmatter.document_id))
    fail2("RUNTIME_SOURCE_CONFLICT", "resume package document_id conflicts with CURRENT_TASK.");
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
  if (!fs3.existsSync(filePath))
    fail2("RUNTIME_SOURCE_MISSING", `Required file is missing: ${filePath}`);
  return sha2562(fs3.readFileSync(filePath, "utf8"));
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
    if (plan.originalPackageContent === undefined && fs3.existsSync(plan.packageFilePath)) {
      fs3.rmSync(plan.packageFilePath, { force: true });
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
    const packageExists = fs3.existsSync(plan.packageFilePath);
    if (plan.originalPackageContent === undefined) {
      if (packageExists)
        return { verified: false, detail: "rollback read-back left a newly-created suspended package behind." };
    } else if (!packageExists || fs3.readFileSync(plan.packageFilePath, "utf8") !== plan.originalPackageContent) {
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
      if (fs3.existsSync(plan.archiveFilePath))
        fs3.rmSync(plan.archiveFilePath, { force: true });
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
      if (fs3.existsSync(plan.archiveFilePath))
        return { verified: false, detail: "archive rollback left a newly-created archive behind." };
    } else if (!fs3.existsSync(plan.archiveFilePath) || fs3.readFileSync(plan.archiveFilePath, "utf8") !== plan.originalArchiveContent) {
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
    if (fs3.readFileSync(filePath, "utf8") !== originalContent)
      return { verified: false, detail: `${label} rollback read-back did not restore the original document.` };
    return { verified: true, detail: `${label} rollback read-back verified.` };
  } catch (error) {
    return { verified: false, detail: `${label} rollback failed: ${error instanceof Error ? error.message : String(error)}` };
  }
}
function rollbackCreatedInboxRecordAndVerify(filePath) {
  try {
    if (fs3.existsSync(filePath)) {
      if (!fs3.lstatSync(filePath).isFile()) {
        return { verified: false, detail: "inbox rollback refused to remove a non-file target." };
      }
      fs3.rmSync(filePath, { force: true });
    }
    if (fs3.existsSync(filePath))
      return { verified: false, detail: "inbox rollback left the newly-created record behind." };
    return { verified: true, detail: "inbox rollback read-back verified." };
  } catch (error) {
    return { verified: false, detail: `inbox rollback failed: ${error instanceof Error ? error.message : String(error)}` };
  }
}

class GovernanceTransactionKernel {
  root;
  readCurrentTask;
  readFile;
  writeFiles;
  constructor(root, readCurrentTask = readCanonicalCurrentTask, readFile = (filePath) => fs3.readFileSync(filePath, "utf8"), writeFiles = (operations, dryRun, summary) => executeWrites(operations, dryRun, summary)) {
    this.root = path4.resolve(root);
    this.readCurrentTask = readCurrentTask;
    this.readFile = readFile;
    this.writeFiles = writeFiles;
  }
  commitInboxRecordTransaction(current, proposal, plan, options) {
    const targetPath = plan.relativePath;
    const recordRevision = sha2562(plan.nextContent);
    if (plan.existing) {
      return buildResult("no-op", proposal, current, options, "matching canonical inbox record already exists; exact replay is a deterministic no-op.", {
        target_path: targetPath,
        planned_writes: [],
        previous_revision: recordRevision,
        resulting_revision: recordRevision,
        read_back_verified: true,
        state: resultState(current.runtimeState)
      });
    }
    if (options.dryRun) {
      return buildResult("success", proposal, current, options, "typed inbox record proposal validated; one canonical inbox write planned (dry-run).", {
        target_path: targetPath,
        planned_writes: [targetPath],
        resulting_revision: recordRevision,
        state: resultState(current.runtimeState)
      });
    }
    try {
      this.writeFiles([{ path: plan.filePath, content: plan.nextContent }], false, "vNext Runtime inbox record transaction committed");
    } catch (error) {
      const rollback = rollbackCreatedInboxRecordAndVerify(plan.filePath);
      return buildResult("blocked", proposal, current, options, `inbox atomic commit failed: ${error instanceof Error ? error.message : String(error)}; ${rollback.detail}`, {
        target_path: targetPath,
        code: rollback.verified ? "ATOMIC_COMMIT_FAILED" : "ROLLBACK_FAILED"
      });
    }
    try {
      const readBack = this.readFile(plan.filePath);
      if (readBack !== plan.nextContent)
        throw new Error("canonical inbox record read-back did not match the staged record.");
      assertCanonicalInboxRecordContent(readBack, proposal, targetPath);
      return buildResult("success", proposal, current, options, "inbox record transaction committed; canonical record read-back verified.", {
        target_path: targetPath,
        planned_writes: [targetPath],
        committed: true,
        governed_mutation_count: 1,
        resulting_revision: recordRevision,
        read_back_verified: true,
        state: resultState(current.runtimeState)
      });
    } catch (error) {
      const rollback = rollbackCreatedInboxRecordAndVerify(plan.filePath);
      return buildResult("blocked", proposal, current, options, rollback.verified ? `inbox record read-back failed: ${error instanceof Error ? error.message : String(error)}; rollback read-back verified.` : `inbox record read-back failed: ${error instanceof Error ? error.message : String(error)}; ${rollback.detail}`, {
        target_path: targetPath,
        code: rollback.verified ? "READ_BACK_FAILED" : "ROLLBACK_FAILED"
      });
    }
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
    const nextRevision = sha2562(plan.nextContent);
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
      if (!fs3.existsSync(plan.archiveFilePath) || fs3.readFileSync(plan.archiveFilePath, "utf8") !== plan.nextArchiveContent) {
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
        previous_revision: sha2562(plan.originalStatusContent),
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
      const readBack = fs3.readFileSync(plan.statusFilePath, "utf8");
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
        previous_revision: sha2562(plan.originalStatusContent),
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
        previous_revision: sha2562(plan.originalLessonsContent),
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
      const readBack = fs3.readFileSync(plan.lessonsFilePath, "utf8");
      if (readBack !== plan.nextLessonsContent)
        throw new Error("LESSONS read-back did not match the staged typed lesson record.");
      readDurableLessonRecords(readBack, plan.lessonsRelativePath);
      return buildResult("success", proposal, current, options, "lesson-record transaction committed; LESSONS-only read-back verified.", {
        target_path: plan.lessonsRelativePath,
        committed: true,
        governed_mutation_count: 1,
        previous_revision: sha2562(plan.originalLessonsContent),
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
  commitKnowledgeRecordTransaction(current, proposal, plan, options) {
    const targetPath = plan.relativePath;
    if (plan.existing) {
      return buildResult("no-op", proposal, current, options, "matching durable Contract/Decision record already exists; knowledge promotion is a deterministic no-op.", {
        target_path: targetPath,
        planned_writes: [],
        previous_revision: sha2562(plan.originalContent),
        resulting_revision: sha2562(plan.originalContent),
        read_back_verified: true,
        state: resultState(current.runtimeState)
      });
    }
    if (options.dryRun) {
      return buildResult("success", proposal, current, options, "typed knowledge admission validated; one canonical knowledge document write planned (dry-run).", {
        target_path: targetPath,
        previous_revision: sha2562(plan.originalContent),
        resulting_revision: sha2562(plan.nextContent),
        state: resultState(current.runtimeState)
      });
    }
    try {
      this.writeFiles([{ path: plan.filePath, content: plan.nextContent }], false, `vNext Runtime ${proposal.operation_kind} committed`);
    } catch (error) {
      const rollback = rollbackSingleFileAndVerify(plan.filePath, plan.originalContent, "knowledge");
      return buildResult("blocked", proposal, current, options, rollback.verified ? `knowledge write failed: ${error instanceof Error ? error.message : String(error)}; knowledge rollback verified.` : `knowledge write failed: ${error instanceof Error ? error.message : String(error)}; ${rollback.detail}`, {
        target_path: targetPath,
        code: rollback.verified ? "ATOMIC_COMMIT_FAILED" : "ROLLBACK_FAILED"
      });
    }
    try {
      const readBack = this.readFile(plan.filePath);
      if (readBack !== plan.nextContent)
        throw new Error("canonical knowledge document read-back did not match the staged record.");
      const records = readDurableKnowledgeRecords(readBack, targetPath, proposal.semantic_delta.knowledge_kind);
      if (!records.some((record) => JSON.stringify(record) === JSON.stringify(plan.record))) {
        throw new Error("canonical knowledge read-back did not contain the admitted record.");
      }
      return buildResult("success", proposal, current, options, "knowledge promotion committed; canonical Contract/Decision read-back verified.", {
        target_path: targetPath,
        committed: true,
        governed_mutation_count: 1,
        previous_revision: sha2562(plan.originalContent),
        resulting_revision: sha2562(plan.nextContent),
        read_back_verified: true,
        state: resultState(current.runtimeState)
      });
    } catch (error) {
      const rollback = rollbackSingleFileAndVerify(plan.filePath, plan.originalContent, "knowledge");
      return buildResult("blocked", proposal, current, options, rollback.verified ? `knowledge read-back failed: ${error instanceof Error ? error.message : String(error)}; rollback read-back verified.` : `knowledge read-back failed: ${error instanceof Error ? error.message : String(error)}; ${rollback.detail}`, {
        target_path: targetPath,
        code: rollback.verified ? "READ_BACK_FAILED" : "ROLLBACK_FAILED"
      });
    }
  }
  commitLifecycleTransaction(current, proposal, plan, options) {
    const nextRevision = sha2562(plan.nextContent);
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
      if (!fs3.existsSync(plan.packageFilePath) || fs3.readFileSync(plan.packageFilePath, "utf8") !== plan.nextPackageContent) {
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
      const fallbackOperation = isRecord2(rawProposal) && typeof rawProposal.operation_kind === "string" && RUNTIME_OPERATION_KINDS.includes(rawProposal.operation_kind) ? rawProposal.operation_kind : "task-state-transaction";
      const fallbackKey = isRecord2(rawProposal) && typeof rawProposal.idempotency_key === "string" ? rawProposal.idempotency_key : "invalid-proposal";
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
        fail2("RUNTIME_PATH_INVALID", "proposal source path is not the exact canonical CURRENT_TASK path.");
      if (proposal.operation_kind === "lifecycle-transaction") {
        assertRequestedLifecycleTargets(this.root, current, proposal);
      } else if (proposal.operation_kind === "inbox-record-transaction") {
        assertRequestedInboxTargets(this.root, current, proposal);
      } else if (proposal.operation_kind === "archive-transaction" || proposal.operation_kind === "project-status-transaction" || proposal.operation_kind === "lesson-record-transaction" || proposal.operation_kind === "contract-candidate-commit" || proposal.operation_kind === "decision-record-transaction") {
        assertRequestedCloseTargets(this.root, current, proposal);
      } else if (proposal.requested_write_targets.length !== 1 || proposal.requested_write_targets[0] !== current.relativePath) {
        fail2("RUNTIME_PATH_INVALID", "proposal write target is not the exact canonical CURRENT_TASK path.");
      }
    } catch (error) {
      return buildResult("blocked", proposal, current, options, error instanceof Error ? error.message : String(error), { code: error instanceof VNextRuntimeError ? error.code : "RUNTIME_PATH_INVALID" });
    }
    if (proposal.operation_kind === "inbox-record-transaction") {
      const inboxProposal = proposal;
      let inspectedPlan;
      try {
        ensureAuthorityKinds(inboxProposal, ["evidence-admission"]);
        inspectedPlan = inspectInboxRecordTransaction(this.root, inboxProposal);
      } catch (error) {
        const code = error instanceof VNextRuntimeError ? error.code : "RUNTIME_HANDLER_BLOCKED";
        return buildResult(code === "IDEMPOTENCY_CONFLICT" ? "conflict" : "blocked", proposal, current, options, error instanceof Error ? error.message : String(error), {
          target_path: inboxProposal.semantic_delta.target_path,
          code
        });
      }
      if (inspectedPlan.existing) {
        return this.commitInboxRecordTransaction(current, inboxProposal, inspectedPlan, options);
      }
      const conflictField2 = compareSourceTuple(proposal.source_tuple, current.sourceTuple);
      if (conflictField2) {
        return buildResult("conflict", proposal, current, options, `canonical source tuple is stale at ${conflictField2}.`, {
          target_path: inboxProposal.semantic_delta.target_path,
          code: "SOURCE_TUPLE_MISMATCH",
          previous_revision: current.sourceTuple.revision
        });
      }
      try {
        const plan = prepareInboxRecordTransaction(this.root, current, inboxProposal);
        return this.commitInboxRecordTransaction(current, inboxProposal, plan, options);
      } catch (error) {
        return buildResult("blocked", proposal, current, options, error instanceof Error ? error.message : String(error), {
          target_path: inboxProposal.semantic_delta.target_path,
          code: error instanceof VNextRuntimeError ? error.code : "RUNTIME_HANDLER_BLOCKED"
        });
      }
    }
    if (proposal.operation_kind === "contract-candidate-commit" || proposal.operation_kind === "decision-record-transaction") {
      const knowledgeProposal = proposal;
      let inspectedPlan;
      try {
        inspectedPlan = inspectKnowledgeRecordTransaction(this.root, current, knowledgeProposal);
      } catch (error) {
        const code = error instanceof VNextRuntimeError ? error.code : "RUNTIME_HANDLER_BLOCKED";
        const conflictCodes = new Set(["IDEMPOTENCY_CONFLICT", "KNOWLEDGE_IDENTITY_CONFLICT"]);
        return buildResult(conflictCodes.has(code) ? "conflict" : "blocked", proposal, current, options, error instanceof Error ? error.message : String(error), {
          target_path: proposal.operation_kind === "contract-candidate-commit" ? workflowDocPathForRoot(this.root, "CONTRACTS.md").relativePath : workflowDocPathForRoot(this.root, "DECISIONS.md").relativePath,
          code
        });
      }
      if (inspectedPlan.existing) {
        return this.commitKnowledgeRecordTransaction(current, knowledgeProposal, inspectedPlan, options);
      }
      const conflictField2 = compareSourceTuple(proposal.source_tuple, current.sourceTuple);
      if (conflictField2) {
        return buildResult("conflict", proposal, current, options, `canonical source tuple is stale at ${conflictField2}.`, {
          target_path: inspectedPlan.relativePath,
          code: "SOURCE_TUPLE_MISMATCH",
          previous_revision: current.sourceTuple.revision
        });
      }
      try {
        const plan = prepareKnowledgeRecordTransaction(this.root, current, knowledgeProposal);
        return this.commitKnowledgeRecordTransaction(current, knowledgeProposal, plan, options);
      } catch (error) {
        const code = error instanceof VNextRuntimeError ? error.code : "RUNTIME_HANDLER_BLOCKED";
        const conflictCodes = new Set(["IDEMPOTENCY_CONFLICT", "KNOWLEDGE_IDENTITY_CONFLICT"]);
        return buildResult(conflictCodes.has(code) ? "conflict" : "blocked", proposal, current, options, error instanceof Error ? error.message : String(error), {
          target_path: proposal.operation_kind === "contract-candidate-commit" ? workflowDocPathForRoot(this.root, "CONTRACTS.md").relativePath : workflowDocPathForRoot(this.root, "DECISIONS.md").relativePath,
          code
        });
      }
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
      transition = proposal.operation_kind === "task-state-transaction" ? applyTaskStateDelta(this.root, current, proposal, now) : applyFindingQueueDelta(current, proposal, now);
    } catch (error) {
      return buildResult("blocked", proposal, current, options, error instanceof Error ? error.message : String(error), { code: error instanceof VNextRuntimeError ? error.code : "RUNTIME_HANDLER_BLOCKED" });
    }
    let nextContent;
    try {
      nextContent = renderCanonicalCurrentTask(current.frontmatter, current.body, transition.next, {
        ...transition.replacementDefinition ? { replacementDefinition: transition.replacementDefinition } : {},
        ...transition.draftDefinition ? { draftDefinition: transition.draftDefinition } : {},
        ...transition.draftIdentity ? { draftIdentity: transition.draftIdentity } : {},
        ...transition.draftDocumentId ? { draftDocumentId: transition.draftDocumentId } : {},
        ...transition.audit ? { audit: transition.audit } : {}
      });
    } catch (error) {
      return buildResult("blocked", proposal, current, options, error instanceof Error ? error.message : String(error), {
        code: error instanceof VNextRuntimeError ? error.code : "RUNTIME_RENDER_BLOCKED"
      });
    }
    const nextRevision = sha2562(nextContent);
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
        state: resultState(transition.next, transition.findingStatus),
        ...transition.advancement ? { advancement: transition.advancement } : {}
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
        state: resultState(readBack.runtimeState, transition.findingStatus),
        ...transition.advancement ? { advancement: transition.advancement } : {}
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
  if (command !== "validate" && command !== "validate-contract" && command !== "apply" && command !== "scope-check")
    throw new Error("Usage: vnext-runtime <validate-contract|validate|apply|scope-check> --root <path> [--proposal-file <json>] [--path <repo-relative>] [--paths-file <path>] [--paths-stdin] [--conditional-authorizations-file <json>] [--transformation-kind <localized|inherently-broad>] [--dry-run]");
  let root = process.cwd();
  let proposalFile;
  let dryRun = false;
  const changedPaths = [];
  let pathsFile;
  let pathsStdin = false;
  let conditionalAuthorizationsFile;
  let transformationKind = "localized";
  for (let index = 0;index < rest.length; index += 1) {
    const arg = rest[index];
    if (arg === "--root")
      root = rest[++index] ?? "";
    else if (arg === "--proposal" || arg === "--proposal-file")
      proposalFile = rest[++index];
    else if (arg === "--path")
      changedPaths.push(rest[++index] ?? "");
    else if (arg === "--paths-file")
      pathsFile = rest[++index];
    else if (arg === "--paths-stdin")
      pathsStdin = true;
    else if (arg === "--conditional-authorizations-file")
      conditionalAuthorizationsFile = rest[++index];
    else if (arg === "--transformation-kind") {
      const value = rest[++index];
      if (value !== "localized" && value !== "inherently-broad")
        throw new Error("--transformation-kind must be localized or inherently-broad.");
      transformationKind = value;
    } else if (arg === "--dry-run")
      dryRun = true;
    else
      throw new Error(`Unknown argument: ${arg}`);
  }
  return { command, root, proposalFile, dryRun, changedPaths, pathsFile, pathsStdin, conditionalAuthorizationsFile, transformationKind };
}
function readCliStringList(filePath, label) {
  const content = fs3.readFileSync(path4.resolve(filePath), "utf8");
  if (content.trimStart().startsWith("[")) {
    let parsed;
    try {
      parsed = JSON.parse(content);
    } catch (error) {
      throw new Error(`${label} must be valid JSON or newline-delimited text: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string"))
      throw new Error(`${label} JSON form must be an array of strings.`);
    return parsed;
  }
  return content.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
}
function readCliConditionalAuthorizations(filePath) {
  let parsed;
  try {
    parsed = JSON.parse(fs3.readFileSync(path4.resolve(filePath), "utf8"));
  } catch (error) {
    throw new Error(`conditional authorizations file must be valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  return parsed;
}
function readScopeCheckInput(args) {
  const changedPaths = [...args.changedPaths];
  if (args.pathsFile)
    changedPaths.push(...readCliStringList(args.pathsFile, "--paths-file"));
  if (args.pathsStdin) {
    if (process.stdin.isTTY)
      throw new Error("--paths-stdin requires newline-delimited paths on stdin.");
    const stdinContent = process.stdin.read();
    if (typeof stdinContent !== "string" && !Buffer.isBuffer(stdinContent))
      throw new Error("--paths-stdin did not receive newline-delimited paths on stdin.");
    const text = typeof stdinContent === "string" ? stdinContent : stdinContent.toString("utf8");
    changedPaths.push(...text.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean));
  }
  return {
    changed_paths: changedPaths,
    ...args.conditionalAuthorizationsFile ? { conditional_authorizations: readCliConditionalAuthorizations(args.conditionalAuthorizationsFile) } : {},
    transformation_kind: args.transformationKind
  };
}
function validateInstalledRuntimeForCli(root) {
  const runtimePackagePath = path4.join(path4.resolve(root), ...VNEXT_RUNTIME_PACKAGE_RELATIVE_PATH.split("/"), "package.json");
  if (fs3.existsSync(runtimePackagePath)) {
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
    } else if (args.command === "scope-check") {
      validateInstalledRuntimeForCli(args.root);
      const current = readCanonicalCurrentTask(args.root);
      const scope = parseMutationScope(current.body, current.sourceTuple.revision);
      const result = evaluateMutationScope(scope, readScopeCheckInput(args));
      console.log(JSON.stringify(result, null, 2));
      if (result.status === "blocked")
        return 2;
    } else {
      validateInstalledRuntimeForCli(args.root);
      const proposalText = args.proposalFile ? fs3.readFileSync(path4.resolve(args.proposalFile), "utf8") : !process.stdin.isTTY ? fs3.readFileSync(0, "utf8") : "";
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
    if (error instanceof MutationScopeError) {
      console.error(`${error.code}: ${error.message}`);
      return error.code === "MUTATION_SCOPE_BLOCKED" ? 2 : 1;
    }
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

// runtime/vnext/src/cli.ts
var args = process.argv.slice(2);
var runner = args[0] === "bootstrap-project" ? runBootstrapCli(args.slice(1)) : runCli(args);
runner.then((exitCode) => {
  process.exitCode = exitCode;
});
export {
  runCli,
  runBootstrapCli
};
