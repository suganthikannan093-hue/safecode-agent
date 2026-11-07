import test from 'node:test';
import assert from 'node:assert/strict';
import { provider, generate, fix, explain, chat, parse } from '../server/llm.js';
import { HEAL_DEMO } from '../server/demos.js';
const answer = { language: 'python', code: 'print(197)', explanation: 'A generated answer' };
test('mock flags and real completion provenance are consistent for generation, healing and explanations', async () => {
 const old = { ...process.env }; const fetch = globalThis.fetch;
 try {
  process.env.VULTR_INFERENCE_API_KEY = 'unit-test-only';process.env.SAFECODE_MODEL_OUTPUT_SHARING = '1';let calls=0;
  globalThis.fetch = async (_url, options) => {
   calls++;const body=JSON.parse(options.body);assert.equal(body.reasoning.enabled,false);assert.equal(body.max_completion_tokens,4096);
   if(body.response_format)assert.equal(body.response_format.type,'json_object');
   return {ok:true,json:async()=>({id:'completion-test',choices:[{finish_reason:'stop',message:{content:body.response_format?JSON.stringify(answer):'Explanation'}}],usage:{completion_tokens:12}})};
  };
  for(const flag of ['0','']){
   process.env.SAFECODE_FORCE_MOCK=flag;assert.equal(provider().name,'vultr');
   const g=await generate('custom live task');assert.equal(g.code,answer.code);assert.equal(g.inference.source,'live-inference');assert.equal(g.inference.responseId,'completion-test');
   const f=await fix({task:'fix',code:HEAL_DEMO.code,language:'python',stdout:'',stderr:'KeyError',exitCode:1});assert.equal(f.inference.finishReason,'stop');
   assert.equal(await explain('task','code',{limits:[],exitCode:0,stdout:'',stderr:''}),'Explanation');
  }
  assert.equal(calls,6);process.env.SAFECODE_FORCE_MOCK='1';assert.equal(provider().name,'mock');
  const g=await generate('custom live task');assert.match(g.code,/offline mock/);assert.equal(g.inference,undefined);
  const f=await fix({code:HEAL_DEMO.code});assert.match(f.explanation,/Offline mock/);assert.equal(f.provider.name,'mock');assert.equal(calls,6);
 }finally{globalThis.fetch=fetch;for(const k of Object.keys(process.env))if(!(k in old))delete process.env[k];Object.assign(process.env,old);}
});
test('malformed, empty, partial and invalid program JSON fail closed',()=>{
 for(const txt of ['', '{"language":"python"', 'prefix '+JSON.stringify(answer), JSON.stringify({...answer,code:''}),JSON.stringify({...answer,language:'js'})])assert.throws(()=>parse(txt));
 assert.deepEqual(parse('```json\n'+JSON.stringify(answer)+'\n```'),answer);
});
test('truncated, refused, HTTP and missing-content responses never produce executable code or expose body',async()=>{
 const old=globalThis.fetch;try{
  for(const finish of ['length','content_filter',null]){
   globalThis.fetch=async()=>({ok:true,json:async()=>({choices:[{finish_reason:finish,message:{content:JSON.stringify(answer)}}]})});
   await assert.rejects(chat({name:'vultr',base:'https://test',key:'secret',model:'test'},[],true),/incomplete or refused/);
  }
  globalThis.fetch=async()=>({ok:false,status:503,text:async()=> 'sensitive body'});
  await assert.rejects(chat({label:'Vultr',name:'vultr',base:'https://test',key:'secret'},[]),/^Error: Vultr HTTP 503$/);
  globalThis.fetch=async()=>({ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:null}}]})});
  await assert.rejects(chat({name:'vultr',base:'https://test',key:'secret'},[]),/no usable answer/);
 }finally{globalThis.fetch=old;}
});
test('program JSON repair is bounded and failed repair never falls back to mock',async()=>{
 const old={...process.env},fetch=globalThis.fetch;try{
  process.env.VULTR_INFERENCE_API_KEY='unit-test-only';process.env.SAFECODE_FORCE_MOCK='0';let calls=0;
  globalThis.fetch=async()=>{calls++;return {ok:true,json:async()=>({id:'test',choices:[{finish_reason:'stop',message:{content:'{bad'}}]})};};
  await assert.rejects(generate('custom code'),/malformed code JSON/);assert.equal(calls,2);
 }finally{globalThis.fetch=fetch;for(const k of Object.keys(process.env))if(!(k in old))delete process.env[k];Object.assign(process.env,old);}
});
