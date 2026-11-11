'use strict';
const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process');
function buildGame(directory,arch){
  const root=path.resolve(__dirname,'../native/game-lan'),cpu={x64:'amd64',arm64:'arm64'}[arch];
  if(!cpu)throw Error('Unsupported game network architecture');
  fs.mkdirSync(directory,{recursive:true});
  execFileSync('go',['build','-trimpath','-buildvcs=false','-ldflags=-s -w -H=windowsgui','-o',path.join(directory,'link-game.exe'),'.'],{
    cwd:root,stdio:'inherit',env:{...process.env,GOOS:'windows',GOARCH:cpu,CGO_ENABLED:'0',GOTOOLCHAIN:'local',GOPROXY:'off'}});
  fs.copyFileSync(path.join(root,'vendor',cpu,'wintun.dll'),path.join(directory,'wintun.dll'));
  fs.copyFileSync(path.join(root,'vendor','LICENSE.txt'),path.join(directory,'Wintun-LICENSE.txt'));
}
module.exports={buildGame};
