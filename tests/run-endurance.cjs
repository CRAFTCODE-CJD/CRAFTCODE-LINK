'use strict';
// Developer-only runner. Save the evidence in the chosen directory across process restarts.
const fs=require('node:fs'),path=require('node:path'),readline=require('node:readline');
const {spawn}=require('node:child_process'),{once}=require('node:events');
const {maxCheckpointGapMs}=require('./evening-session.cjs');

function passed(targetMs,end,marker,code,signal){
  return code===0 && !signal && marker && Number.isSafeInteger(end?.elapsedMs) && end.elapsedMs>=targetMs
    && Number.isSafeInteger(end.maxCheckpointGapMs) && end.maxCheckpointGapMs>0 && end.maxCheckpointGapMs<=maxCheckpointGapMs
    && Number.isSafeInteger(end.checkpoints) && end.checkpoints*end.maxCheckpointGapMs>=end.elapsedMs
    && end.movieFrames>0 && end.voiceBytes>0 && end.systemBytes>0 && end.movieBytes>0
    && Array.isArray(end.closed) && end.closed.length===3
    && end.closed.every(c=>c.endpoints===0 && c.mixerSources===0 && c.generatedLive===0);
}
async function run(){
  const minutes=Number(process.argv[2]||300);
  if(!Number.isInteger(minutes)||minutes<2||minutes>540)throw Error('Expected minutes between 2 and 540.');
  const parent=path.resolve(process.argv[3]||'out/qa/endurance');fs.mkdirSync(parent,{recursive:true});
  const dir=fs.mkdtempSync(path.join(parent,'run-')),log=fs.openSync(path.join(dir,'final.log'),'wx',0o600);
  const state={version:require('../package.json').version,targetSeconds:minutes*60,status:'RUNNING',last:null,end:null,exitCode:null};
  const save=()=>{const tmp=path.join(dir,'status.new');fs.writeFileSync(tmp,JSON.stringify(state,null,2)+'\n',{flush:true,mode:0o600});fs.renameSync(tmp,path.join(dir,'status.json'));};
  console.log('QA directory',dir);
  save();let passMarker=false;
  const child=spawn(process.execPath,[path.join(__dirname,'watch-buffer-desktop.cjs'),'--evening'],{
    env:{...process.env,LINK_QA_MINUTES:String(minutes)},stdio:['ignore','pipe','pipe']});
  function line(text,err){
    fs.writeSync(log,(err?'stderr ':'')+text+'\n');(err?process.stderr:process.stdout).write(text+'\n');
    if(err)return;
    if(text.startsWith('EVENING ')||text.startsWith('ENDURANCE ')){
      const idx=text.indexOf(' ');state[text.startsWith('EVENING ')?'last':'end']=JSON.parse(text.slice(idx+1));fs.fsyncSync(log);save();
    }else if(text.startsWith('PASS endurance session,'))passMarker=true;
  }
  for(const [stream,err] of [[child.stdout,false],[child.stderr,true]])readline.createInterface({input:stream,crlfDelay:Infinity}).on('line',s=>line(s,err));
  const terminate=()=>child.kill('SIGTERM');process.once('SIGINT',terminate);process.once('SIGTERM',terminate);
  try{
    const [code,signal]=await once(child,'close');state.exitCode=code;state.signal=signal;
    state.status=passed(minutes*60000,state.end,passMarker,code,signal)?'PASS':'FAILED';
    if(code!==null)fs.writeFileSync(path.join(dir,'exit-code'),String(code)+'\n',{flag:'wx'});
    save();if(state.status!=='PASS')process.exitCode=1;
  }finally{fs.closeSync(log);process.off('SIGINT',terminate);process.off('SIGTERM',terminate);}
}
if(require.main===module)run().catch(e=>{console.error(e);process.exitCode=1;});
module.exports={passed};
