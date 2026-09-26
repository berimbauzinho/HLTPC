// Deploy-scoped secrets apply only to Functions, even on the Netlify free plan.
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
const keys=['HLTPC_STORAGE','SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','HLTPC_OWNER_USERNAME','HLTPC_OWNER_PASSWORD','HLTPC_OWNER_ONLY','HLTPC_SESSION_SECRET'];
const cli=process.env.NETLIFY_CLI_PATH||'artifacts/netlify-cli/node_modules/netlify-cli/bin/run.js';
if(!fs.existsSync(cli))throw Error('Install Netlify CLI in artifacts/netlify-cli or set NETLIFY_CLI_PATH.');
const args=[cli,'deploy','--site',process.env.NETLIFY_SITE_ID||'1912102e-8afd-434c-ac74-1aafa618f80b','--no-build','--dir','dist','--functions','netlify/functions','--json'];
for(const key of keys){
 if(!process.env[key])throw Error('Missing '+key);
 args.push(['SUPABASE_SERVICE_ROLE_KEY','HLTPC_OWNER_PASSWORD','HLTPC_SESSION_SECRET'].includes(key)?'--secret-env':'--env',`${key}=${process.env[key]}`);
}
const result=spawnSync(process.execPath,args,{encoding:'utf8',timeout:600000,maxBuffer:10000000});
let output=result.stdout+'\n'+result.stderr;
for(const key of ['SUPABASE_SERVICE_ROLE_KEY','HLTPC_OWNER_PASSWORD','HLTPC_SESSION_SECRET'])output=output.replaceAll(process.env[key],'[REDACTED]');
if(result.status!==0){console.error(output);process.exit(result.status||1);}
let deployed;try{deployed=JSON.parse(result.stdout);}catch{console.error(output);process.exit(1);}
if(!deployed.deploy_id||!deployed.deploy_url)throw Error('Netlify did not confirm the deploy.');
console.log(JSON.stringify({deployId:deployed.deploy_id,url:deployed.deploy_url}));
