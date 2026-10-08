import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { record, snapshot, task, taskStatus, read, archive } from '../runtime/vnext/support/assistance.mjs';
import { storeReadFile, storeList } from '../runtime/vnext/support/record-storage.mjs';
const STORE = '.workflow-system/records';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
function fixture(t) { const root=fs.mkdtempSync(path.join(os.tmpdir(),'vnext-fixed-evidence-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));fs.mkdirSync(path.join(root,'docs/workflow'),{recursive:true});return root; }
const write=(root,ref,bytes)=>fs.writeFileSync(path.join(root,ref),bytes);
const rows=(root)=>storeList(root,`${STORE}/evidence-objects`);
const manifest=(root,result)=>JSON.parse(storeReadFile(root,result.attachments_ref));
function compact(root) {for(const action of ['create','quarantine','reclaim'])archive(root,{action});}

test('fixed archived material is associated with each new run without reading its changing live source or recreating its blob', t => {
 const root=fixture(t), old=Buffer.from('retained baseline\r\n'.repeat(10000));write(root,'cumulative.txt',old);
 const first=snapshot(root,{path:'cumulative.txt'});compact(root);const before=rows(root);
 write(root,'cumulative.txt',Buffer.concat([old,Buffer.from('later cumulative output that was not requested\n')]));
 write(root,'run1.txt','run1 failed: distinct output\n');
 const one=record(root,{kind:'test-run',idempotency_key:'run1',body:{run:'1',result:'failed'},evidence_refs:[{ref:first.ref,sha256:first.sha256,size:first.size,role:'baseline'}],files:['run1.txt']});
 const a=manifest(root,one).attachments;
 assert.equal(a[0].status,'saved');assert.equal(a[1].status,'referenced');assert.equal(a[1].live_source_read,false);assert.equal(a[1].ref,first.ref);
 assert.equal(rows(root).length,before.length+1);assert.equal(fs.existsSync(path.join(root,first.ref)),false);
 assert.deepEqual(storeReadFile(root,first.ref),old);
 fs.unlinkSync(path.join(root,'cumulative.txt'));write(root,'run2.txt','run2 failed differently\n');
 const two=record(root,{kind:'test-run',idempotency_key:'run2',body:{run:'2',result:'failed'},evidence_refs:[{sha256:first.sha256,purpose:'same fixed baseline'}],files:['run2.txt']});
 assert.equal(manifest(root,two).attachments[1].status,'referenced');assert.notEqual(one.ref,two.ref);
 assert.equal(rows(root).length,before.length+2);
 assert.equal(record(root,{kind:'test-run',idempotency_key:'run2',body:{run:'2',result:'failed'},evidence_refs:[{sha256:first.sha256,purpose:'same fixed baseline'}],files:['run2.txt']}).status,'already-recorded');
 assert.equal(rows(root).length,before.length+2);
});

test('task operations retain fixed event identity, full report bytes and current-run association', t => {
 const root=fixture(t);
 const old=record(root,{kind:'decision',body:{source:'user',text:'keep this actual decision'}});
 const prepared=task(root,{action:'prepare',idempotency_key:'p',title:'References',steps:[{id:'S1'}]});
 task(root,{action:'adopt',task_ref:prepared.task_id,plan_ref:prepared.ref});
 const actual=read(root,{ref:old.ref});assert.equal(actual.actual_sha256,old.sha256);
 compact(root);
 const done=task(root,{action:'execution',task_ref:prepared.task_id,step_id:'S1',idempotency_key:'exec',result:'failed',report:'new run report'.repeat(100),evidence_refs:[{ref:old.ref,sha256:old.sha256,role:'user-decision'}]});
 const recordRef=`${STORE}/attachments/${path.posix.basename(done.ref)}`;
 const a=JSON.parse(storeReadFile(root,recordRef)).attachments;
 assert.equal(a.length,1);assert.equal(a[0].status,'referenced');assert.equal(a[0].ref,old.ref);
 const logical=read(root,{ref:done.ref,format:'logical-task-event'});
 assert.deepEqual(logical.payload.request.evidence_refs,[{ref:old.ref,sha256:old.sha256,role:'user-decision'}]);
 assert.equal(logical.payload.task_event.data.report,'new run report'.repeat(100));
 assert.equal(taskStatus(root,{task_ref:prepared.task_id}).selected_task.executions.at(-1).result,'failed');
});

test('explicit cumulative files, distinct failures and database before/after captures are never inferred redundant', t => {
 const root=fixture(t), before=Buffer.from('db-before\n'+'same row\n'.repeat(1000)), after=Buffer.from('db-after!\n'+'same row\n'.repeat(1000));
 write(root,'cumulative.txt','round one\n');
 const one=record(root,{kind:'test-run',body:{run:1,result:'failed'},files:['cumulative.txt']});const b1=manifest(root,one).attachments[0];
 write(root,'cumulative.txt','round one\nround two failed\n');write(root,'before.db',before);write(root,'after.db',after);
 const two=record(root,{kind:'test-run',body:{run:2,result:'failed'},files:['cumulative.txt','before.db','after.db']});const a=manifest(root,two).attachments;
 assert.notEqual(b1.sha256,a[0].sha256);assert.equal(storeReadFile(root,b1.ref).toString(),'round one\n');
 assert.equal(storeReadFile(root,a[0].ref).toString(),'round one\nround two failed\n');
 assert.deepEqual(storeReadFile(root,a[1].ref),before);assert.deepEqual(storeReadFile(root,a[2].ref),after);
 const three=record(root,{kind:'test-run',body:{run:3,result:'failed'},files:['cumulative.txt']});
 assert.notEqual(two.ref,three.ref);assert.equal(manifest(root,three).attachments[0].sha256,a[0].sha256);
 assert.equal(JSON.parse(storeReadFile(root,three.ref)).payload.body.run,3);
});

test('invalid, missing, mutable or corrupt fixed references preserve the request and explicit attachment failure', t => {
 const root=fixture(t);write(root,'live.txt','current mutable text');const object=snapshot(root,{path:'live.txt'});
 for(const spec of [{ref:'live.txt',sha256:object.sha256},{ref:object.ref,sha256:object.sha256,size:999},{sha256:'0'.repeat(64)},{path:'live.txt',sha256:object.sha256},{ref:'../escape',sha256:object.sha256}]){
  const saved=record(root,{kind:'observation',evidence_refs:[spec],body:'retain unavailable request'});
  assert.equal(saved.recorded,true);assert.equal(manifest(root,saved).attachments[0].status,'unavailable');
  assert.deepEqual(JSON.parse(storeReadFile(root,saved.ref)).payload.evidence_refs,[spec]);
 }
 const invalid=record(root,{body:'bad array shape retained',evidence_refs:{sha256:object.sha256}});
 assert.equal(manifest(root,invalid).attachments[0].code,'INVALID_EVIDENCE_REFERENCES');
 write(root,object.ref,'corrupted');
 const damaged=record(root,{body:'original observation still saved',evidence_refs:[{ref:object.ref,sha256:object.sha256}]});
 assert.equal(manifest(root,damaged).attachments[0].code,'OBJECT_CORRUPT');
 assert.equal(rows(root).length,1,'no automatic replacement capture');
});
