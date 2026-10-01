#!/usr/bin/env node
// Read-only comparison of taskStatus on synthetic journals. Never use a live project as fixture.
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
const stable = x => Array.isArray(x) ? x.map(stable) : x && typeof x === 'object'
  ? Object.fromEntries(Object.keys(x).sort().map(k => [k, stable(x[k])])) : x;
const sha = x => createHash('sha256').update(x).digest('hex');
if (process.argv[2] === '--worker') {
  const {taskStatus} = await import(pathToFileURL(path.resolve(process.argv[3])));
  const start = performance.now();
  const view = taskStatus(path.resolve(process.argv[4]));
  const elapsed_ms = performance.now() - start;
  console.log(JSON.stringify({elapsed_ms, max_rss_kib:process.resourceUsage().maxRSS,
    events:view.records_scanned, view_revision:view.view_revision, issues:view.issues.length,
    current_task_id:view.current_task_id}));
} else {
  try {
    const [baseline, candidate, countText='4000', repeatText='3'] = process.argv.slice(2);
    if (!baseline || !candidate) throw new Error('Usage: node vnext-causal-benchmark.mjs <baseline assistance.mjs> <candidate assistance.mjs> [event-count=4000] [repeats=3]');
    const count=Number(countText), repeats=Number(repeatText);
    if (!Number.isSafeInteger(count)||count<3||!Number.isSafeInteger(repeats)||repeats<1) throw new Error('Positive integer counts required (events >= 3).');
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'vnext-causal-benchmark-'));
    try {
      const directory=path.join(root,'.workflow-system/records/events');fs.mkdirSync(directory,{recursive:true});
      const ref = n => `.workflow-system/records/events/${String(n).padStart(8,'0')}.json`;
      for(let i=0;i<count;i++) {
        const action=i===0?'prepare':i===1?'adopt':i%2?'resume':'pause';
        const data=i===0?{create:true,display_id:'TASK-001',plan:{title:'Synthetic chain',steps:[{id:'S1',title:'Preserve state'}]}}
          :i===1?{plan_ref:ref(0),activate:true,focus:true}:{decision_text:`synthetic decision ${i}`};
        const payload={kind:'task-event',task_event:{version:1,action,task_id:'task-chain',parents:i?[ref(i-1)]:[],data}};
        fs.writeFileSync(path.join(root,ref(i)),JSON.stringify({schema_version:1,kind:'workflow-observation',recorded_at:'2000-01-01T00:00:00.000Z',
          payload_sha256:sha(JSON.stringify(stable(payload))),assurance:'caller-reported',payload,issues:[]})+'\n');
      }
      const runs=[];
      for(let repeat=0;repeat<repeats;repeat++) for(const variant of repeat%2?['candidate','baseline']:['baseline','candidate']) {
        const file=path.resolve(variant==='baseline'?baseline:candidate);
        const child=spawnSync(process.execPath,['--max-old-space-size=2048',fileURLToPath(import.meta.url),'--worker',file,root],
          {encoding:'utf8',timeout:120000,maxBuffer:1024*1024});
        if(child.error || child.status!==0) throw new Error(`${variant} run failed: ${child.error?.message??child.stderr??child.stdout}`);
        runs.push({variant,repeat,...JSON.parse(child.stdout)});
      }
      assert.ok(runs.every(r=>r.events===count && r.view_revision===runs[0].view_revision && r.issues===runs[0].issues));
      const median=xs=>{const a=xs.slice().sort((a,b)=>a-b);return a.length%2?a[(a.length-1)/2]:(a[a.length/2-1]+a[a.length/2])/2;};
      const summary=Object.fromEntries(['baseline','candidate'].map(v=>[v,{median_max_rss_mib:median(runs.filter(r=>r.variant===v).map(r=>r.max_rss_kib/1024)),
        median_elapsed_ms:median(runs.filter(r=>r.variant===v).map(r=>r.elapsed_ms))}]));
      console.log(JSON.stringify({node:process.version,platform:process.platform,arch:process.arch,count,repeats,
        metric:'process.resourceUsage().maxRSS: process-lifetime high-water RSS, including startup; KiB',
        fixture:'one task; prepare, adopt, then a direct-parent chain of pause/resume; fixture generation outside measured children',
        identical_view_revision:true,summary,runs},null,2));
    } finally {fs.rmSync(root,{recursive:true,force:true});}
  } catch(e) {console.error(e.stack??String(e));process.exitCode=1;}
}
