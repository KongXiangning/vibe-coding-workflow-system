import { PRODUCT_DOCUMENT_VERSIONS } from './model';
import { readCatalog } from './catalog';
import { planTasks, reverseRelations } from './plans';
import { productView } from './scoped';
import { reconcileRoadmap } from './roadmaps';

// Independent read-only example for consumers. It never loads assistance, its
// journal, CURRENT_TASK or a model. Markdown is returned as source, never executed.
const root = process.argv[2];
if (!root) { console.error('Usage: node offline-reader.js <explicit-project-root>'); process.exitCode = 1; }
else {
  const catalog = readCatalog(root);
  const planId = process.argv[3]; // Explicit selection only; never choose by filename or timestamp.
  console.log(JSON.stringify({ contract: 'vnext-product-doc/v5', supported_formats: PRODUCT_DOCUMENT_VERSIONS.map(version => `vnext-product-doc/v${version}`), project_id: catalog.manifest?.project_id ?? null, root: catalog.root, status: catalog.status, items: catalog.items.filter(i => i.usable).map(i => ({ id: i.id, type: i.type, title: i.title, metadata: i.metadata, body: i.body, path: i.path, line: i.line, definition_sha256: i.definition_sha256 ?? null, definition_algorithm: i.definition_algorithm ?? null })), product_view: productView(catalog), reverse_relations: reverseRelations(catalog), plan_tasks: planTasks(catalog), roadmap_reconciliation: planId ? reconcileRoadmap(catalog, { plan_id: planId }) : null, diagnostics: catalog.diagnostics, coverage: catalog.coverage, task_states: 'not-computed; document reports only' }, null, 2));
  if (catalog.status === 'available' && catalog.coverage.complete === false || catalog.status === 'unavailable' || catalog.status === 'unsupported') process.exitCode = 1;
}
