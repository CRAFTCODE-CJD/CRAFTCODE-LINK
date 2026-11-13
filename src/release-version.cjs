'use strict';

function stableVersion(value){
  return typeof value==='string' && /^(?:0|[1-9]\d{0,3})(?:\.(?:0|[1-9]\d{0,3})){2}$/.test(value);
}
function newerVersion(candidate,current){
  if(!stableVersion(candidate)||!stableVersion(current))return false;
  const left=candidate.split('.').map(Number),right=current.split('.').map(Number);
  const diff=left.map((n,i)=>n-right[i]).find(n=>n!==0);
  return diff>0;
}
const installerName=version=>'CRAFTCODE-LINK-'+version+'-Setup-x64.exe';
module.exports={stableVersion,newerVersion,installerName};
