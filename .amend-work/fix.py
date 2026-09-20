from pathlib import Path

def replace(p,a,b):
    f=Path(p); s=f.read_text(); assert s.count(a)==1, (p,a[:90],s.count(a)); f.write_text(s.replace(a,b))
k='runtime/vnext/src/kernel.ts'
replace(k, "    if (!options.dryRun && !exists) executeWrites([{ path: location.filePath, content }], false, 'Prepare evidence-plan amendment candidate only');", "    if (!options.dryRun && !exists) {\n      fs.mkdirSync(path.dirname(location.filePath), { recursive: true });\n      executeWrites([{ path: location.filePath, content }], false, 'Prepare evidence-plan amendment candidate only');\n    }")
replace(k, "    const prefix = `evidence-amend-${receipt.candidate_digest}-`;", "    if (receipt.document_id !== current.sourceTuple.document_id || receipt.task_id !== current.runtimeState.task_id) fail('EVIDENCE_AMENDMENT_IDENTITY_CONFLICT', 'The candidate belongs to another task.');\n    const prefix = `evidence-amend-${receipt.candidate_digest}-`;")
t='test/vnext-runtime.test.ts'
replace(t, "      const fingerprint = 'evidence-amendment-retained-finding';", "      // Fingerprint is owned by the public review adapter, not caller input.")
replace(t, "findings: [{ fingerprint, category: 'correctness', file: 'README.md', failure_condition: 'The admitted observation remains unsatisfied.',", "findings: [{ category: 'correctness', file: 'README.md', failure_condition: 'The admitted observation remains unsatisfied.',")
replace(t, "      expect(submitAmendmentExecution(root, beginRepair(root, { candidate_paths: ['README.md'] })).status).toBe('success');", "      const fingerprint = readCanonicalCurrentTask(root).runtimeState.pending_review_result!.findings[0]!.fingerprint;\n      expect(submitAmendmentExecution(root, beginRepair(root, { candidate_paths: ['README.md'] })).status).toBe('success');")
f=Path('docs/designs/workflow-vnext-target-architecture.md')
s=f.read_text(); marker='Public Skills return recommendations rather than invoking the next public Skill automatically.'
assert s.count(marker)==1
s=s.replace(marker, 'An explicitly authorized evidence-selection amendment under unchanged Goal, Acceptance, observation boundary and total authority has its own same-task prepare/confirm path. It does not require a previous report or challenge, a new business requirement, or supersede. Pending findings and recorded repair history remain owned by the current task; changed checks require new results, and an affected clean review remains historical rather than proving the replacement selection. '+marker)
f.write_text(s)
