import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,symlink,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import ts from 'typescript';
const root=fileURLToPath(new URL('../',import.meta.url));
const guide=await readFile(path.join(root,'docs/agent-start.md'),'utf8');
const examples=[...guide.matchAll(/```tsx? file=(\S+)\n([\s\S]*?)\n```/g)];
assert.equal(examples.length,2,'Standalone context must contain its server and page examples');
assert.ok(Buffer.byteLength(guide)<12000,'Keep the startup context bounded; review growth explicitly');
const directory=await mkdtemp(path.join(tmpdir(),'helium-start-'));
try {
 for(const [,file,source]of examples){assert.ok(['src/server/greeting.ts','src/pages/index.tsx'].includes(file));const target=path.join(directory,file);await mkdir(path.dirname(target),{recursive:true});await writeFile(target,source+'\n');}
 const session=`import type { IncomingHttpHeaders } from 'node:http';\nexport function getSession(headers: IncomingHttpHeaders): {userId:string}|null {return headers.cookie === 'test-session' ? {userId:'alice'} : null;}\n`;
 await writeFile(path.join(directory,'src/server/session.ts'),session);
 await symlink(path.join(root,'node_modules'),path.join(directory,'node_modules'),'dir');
 await writeFile(path.join(directory,'package.json'),JSON.stringify({type:'module'}));
 await writeFile(path.join(directory,'tsconfig.json'),JSON.stringify({compilerOptions:{strict:true,noEmit:true,module:'ESNext',moduleResolution:'Bundler',target:'ES2022',jsx:'react-jsx',skipLibCheck:true,paths:{'heliumts/*':[path.join(root,'dist/*')]}},include:['src']}));
 const result=spawnSync(process.execPath,[path.join(root,'dist/bin/helium.js'),'check'],{cwd:directory,encoding:'utf8'});
 assert.equal(result.status,0,result.stdout+'\n'+result.stderr);
 const server=examples.find(([,file])=>file==='src/server/greeting.ts')[2];
 const emitted=ts.transpileModule(server,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replace('from "heliumts/server"',`from ${JSON.stringify(pathToFileURL(path.join(root,'dist/server/index.js')).href)}`).replace('from "./session"','from "./session.mjs"');
 await writeFile(path.join(directory,'session.mjs'),ts.transpileModule(session,{compilerOptions:{module:ts.ModuleKind.ESNext}}).outputText);
 await writeFile(path.join(directory,'greeting.mjs'),emitted);const {greet}=await import(pathToFileURL(path.join(directory,'greeting.mjs')).href);
 const context=(cookie)=>({req:{headers:cookie?{cookie}:{}},signal:new AbortController().signal});
 for(const name of ['Helium','  Helium  ','😀'.repeat(80)])assert.deepEqual(await greet.handler({name,ownerId:'bob'},context('test-session')),{message:`Hello ${name.trim()}`,userId:'alice'});
 for(const value of [null,[],42,{}, {name:42},{name:' '},{name:'😀'.repeat(81)}])await assert.rejects(greet.handler(value,context('test-session')),{name:'MethodInputError'});
 await assert.rejects(greet.handler({name:'Helium'},context()),/Authentication required/);
 await assert.rejects(greet.handler({name:'Helium'},context('forged-session')),/Authentication required/);
 console.log('Startup context: generated references + both strict TypeScript examples; 3 valid, 7 malformed, 2 denied-session runtime cases passed.');
}finally{await rm(directory,{recursive:true,force:true});}
