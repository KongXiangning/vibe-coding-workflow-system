import { readCatalog } from './catalog';
import { planTasks, reverseRelations } from './plans';

// Independent read-only example for consumers. It never loads assistance, its
// journal, CURRENT_TASK or a model. Markdown is returned as source, never executed.
const root = process.argv[2];
if (!root) { console.error('Usage: node offline-reader.js <explicit-project-root>'); process.exitCode = 1; }
else {
  const catalog = readCatalog(root);
  console.log(JSON.stringify({ contract: 'vnext-product-doc/v2', project_id: catalog.manifest?.project_id ?? null, root: catalog.root, status: catalog.status, items: catalog.items.filter(i => i.usable).map(i => ({ id: i.id, type: i.type, title: i.title, metadata: i.metadata, body: i.body, path: i.path, line: i.line, definition_sha256: i.definition_sha256 ?? null })), reverse_relations: reverseRelations(catalog), plan_tasks: planTasks(catalog), diagnostics: catalog.diagnostics, coverage: catalog.coverage, task_states: 'not-computed; document reports only' }, null, 2));
}
