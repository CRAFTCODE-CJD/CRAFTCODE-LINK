'use strict';
const path=require('node:path'),fs=require('node:fs');
const {execFileSync}=require('node:child_process');
function buildAudio(directory, arch) {
  if(!['x64','arm64'].includes(arch))throw new Error('The Windows audio companion requires a 64-bit architecture.');
  fs.mkdirSync(directory,{recursive:true});
  execFileSync('go',['build','-trimpath','-buildvcs=false','-ldflags=-s -w','-o',path.join(directory,'link-audio.exe'),'.'],{
    cwd:path.resolve(__dirname,'../native/loopback'),stdio:'inherit',
    env:{...process.env,GOOS:'windows',GOARCH:arch==='x64'?'amd64':'arm64',CGO_ENABLED:'0',GOTOOLCHAIN:'local',GOPROXY:'off'},
  });
}
module.exports={buildAudio};
if(require.main===module)buildAudio(path.resolve(__dirname,'../bin'),process.arch);
