import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'hltpc-transfer-'));
const backupPath=path.join(directory,'backup.json');
const dataPath=path.join(directory,'data');
const backup={format:'hltpc-storage-backup-v1',objects:[
  {store:'hltpc-content',key:'current',kind:'json',value:{_revision:3,players:[],teams:[],matches:[],tournaments:[],news:[]},metadata:{}},
  {store:'hltpc-media-v2',key:'image',kind:'binary',value:Buffer.from('verified image bytes').toString('base64'),metadata:{contentType:'image/png'}}
]};
fs.writeFileSync(backupPath,JSON.stringify(backup));
function run(...flags){return spawnSync(process.execPath,['tools/transfer-storage.mjs','import',backupPath,...flags],{encoding:'utf8',env:{...process.env,HLTPC_STORAGE:'local',HLTPC_LOCAL_DATA_DIR:dataPath}})}
test('an interrupted transfer can resume without rewriting verified objects',()=>{
  assert.equal(run().status,0);
  const before=fs.readFileSync(path.join(dataPath,'storage.json'),'utf8');
  assert.equal(run('--resume').status,0);
  assert.equal(fs.readFileSync(path.join(dataPath,'storage.json'),'utf8'),before);
  assert.notEqual(run().status,0);
});
test('resuming a different backup stops before any write',()=>{
  const before=fs.readFileSync(path.join(dataPath,'storage.json'),'utf8');
  backup.objects[0].value._revision=99;
  fs.writeFileSync(backupPath,JSON.stringify(backup));
  assert.notEqual(run('--resume').status,0);
  assert.equal(fs.readFileSync(path.join(dataPath,'storage.json'),'utf8'),before);
});
test.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
