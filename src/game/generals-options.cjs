'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const dns=require('node:dns/promises');
const {isIPv4}=require('node:net');
const {randomUUID}=require('node:crypto');
const {execFile}=require('node:child_process');
const {promisify}=require('node:util');
const {ipv4Number}=require('./subnet.cjs');
const {tr}=require('../native-language.cjs');
const run=promisify(execFile);

// EA's 32-bit game reads this single value (machine, then current user) and
// combines it with the Windows Documents known folder. Never read CD keys.
async function windowsGame(edition) {
  const registry=edition==='Zero Hour'?'Command and Conquer Generals Zero Hour':'Generals';
  const script=[
    "$ErrorActionPreference='Stop'",
    '[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)',
    "$leaf=$null; foreach($hive in 'LocalMachine','CurrentUser'){",
    '$base=[Microsoft.Win32.RegistryKey]::OpenBaseKey($hive,[Microsoft.Win32.RegistryView]::Registry32)',
    `$key=$base.OpenSubKey('SOFTWARE\\Electronic Arts\\EA Games\\${registry}')`,
    "if($key){$leaf=$key.GetValue('UserDataLeafName');$key.Close()};$base.Close();if($leaf){break}}",
    "$busy=@(Get-Process -Name 'generals','generalsv','generalszh','game.dat','game' -ErrorAction SilentlyContinue|Where-Object {$_.ProcessName -ne 'game' -or !$_.Path -or $_.Path -like '*\\game.dat'}).Count -gt 0",
    '[pscustomobject]@{leaf=$leaf;busy=$busy}|ConvertTo-Json -Compress'
  ].join('\n');
  const executable=path.join(process.env.SystemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe');
  const {stdout}=await run(executable,['-NoProfile','-NonInteractive','-Command',script],
    {timeout:6000,maxBuffer:4096,windowsHide:true,encoding:'utf8'});
  const {leaf,busy}=JSON.parse(stdout);
  if(typeof busy!=='boolean')throw Error('status');
  return {leaf:leaf??(edition==='Zero Hour'?'Command and Conquer Generals Zero Hour Data':'Command and Conquer Generals Data'),busy};
}
const localHost={
  documents:()=>require('electron').app.getPath('documents'),inspect:windowsGame,
  addresses:async()=>(await dns.lookup(os.hostname(),{family:4,all:true})).map(entry=>entry.address)
};

async function regularFile(file){return (await fs.lstat(file).catch(()=>null))?.isFile()===true;}
async function editionOf(file){
  const name=path.basename(file).toLowerCase();
  if(!['generals.exe','generalsv.exe','generalszh.exe'].includes(name))return;
  const folder=path.dirname(file);
  if(!await regularFile(path.join(folder,'game.dat')))return;
  if(name!=='generalsv.exe'&&await regularFile(path.join(folder,'INIZH.big')))return 'Zero Hour';
  if(name!=='generalszh.exe'&&await regularFile(path.join(folder,'INI.big')))return 'Generals';
}
const changed=()=>Error(tr('Настройки игры изменились. Откройте запуск снова.'));
async function readOptions(documents,leaf){
  if(typeof leaf!=='string'||!leaf.trim()||leaf.length>150||/[<>:"/\\|?*\x00-\x1f]/.test(leaf)||/[. ]$/.test(leaf))throw changed();
  const folder=path.join(await fs.realpath(documents),leaf);
  if(!(await fs.lstat(folder)).isDirectory())throw changed();
  const file=path.join(folder,'Options.ini'),stat=await fs.lstat(file,{bigint:true});
  if(!stat.isFile()||stat.nlink!==1n||stat.size>262144n)throw changed();
  const handle=await fs.open(file,'r');
  try{
    const opened=await handle.stat({bigint:true});
    if(stat.dev!==opened.dev||stat.ino!==opened.ino||stat.size!==opened.size)throw changed();
    const bytes=Buffer.alloc(Number(stat.size));
    const {bytesRead}=await handle.read(bytes,0,bytes.length,0);
    // Retail Options.ini is byte-oriented. Preserve unknown ANSI bytes and CRLF.
    if(bytesRead!==bytes.length||bytes.includes(0))throw changed();
    return {file,bytes,stat};
  }finally{await handle.close();}
}
const line=/^([ \t]*IPAddress[ \t]*=[ \t]*)([^\r\n]*)/gm;
function configured(text){
  const matches=Array.from(text.matchAll(line));
  return matches.length?matches.at(-1)[2].trim():'';
}

async function generalsPlan(gameFile,address,host=localHost){
  const edition=await editionOf(gameFile);
  if(!edition)return null;
  try{
    const {leaf,busy}=await host.inspect(edition);
    if(busy)return {hint:tr('Игра уже запущена. Выберите адрес LINK в сетевых настройках игры.')+' '+address};
    const documents=host.documents(),before=await readOptions(documents,leaf);
    const text=before.bytes.toString('latin1'),saved=configured(text);
    const addresses=(await host.addresses()).filter(isIPv4);
    if(!addresses.includes(address))throw changed();
    // LanLobbyMenu uses the saved address only if Windows still enumerates it,
    // otherwise it takes the numerically smallest advertised IPv4 address.
    const fallback=addresses.sort((a,b)=>ipv4Number(a)-ipv4Number(b))[0];
    if((addresses.includes(saved)?saved:fallback)===address)return null;
    const next=text.search(line)>=0?text.replace(line,(_line,prefix)=>prefix+address)
      :text+(text.endsWith('\n')?'':'\r\n')+'IPAddress = '+address+'\r\n';
    return {
      hint:tr('Игра выбрала другой сетевой адаптер. Сохранить адрес этой LAN в настройках игры?')+
        '\n'+before.file+'\nIPAddress = '+address,
      async apply(check){
        const status=await host.inspect(edition);
        if(status.busy||status.leaf!==leaf)throw changed();
        const snapshot=await readOptions(documents,leaf);
        const same=sample=>sample.file===before.file&&sample.stat.dev===before.stat.dev&&
          sample.stat.ino===before.stat.ino&&sample.bytes.equals(before.bytes);
        if(!same(snapshot))throw changed();
        const tmp=path.join(path.dirname(before.file),'.link-'+randomUUID()+'.tmp');
        const output=await fs.open(tmp,'wx',0o600);
        try{
          try{await output.writeFile(Buffer.from(next,'latin1'));await output.sync();}finally{await output.close();}
          if(!same(await readOptions(documents,leaf)))throw changed();
          check();
          await fs.rename(tmp,before.file);
        }finally{await fs.rm(tmp,{force:true});}
      }
    };
  }catch{
    return {hint:tr('В сетевых настройках игры выберите LAN IP этого компьютера.')+' '+address};
  }
}
module.exports={generalsPlan};
