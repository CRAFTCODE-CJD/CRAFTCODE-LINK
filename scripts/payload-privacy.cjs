'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');
const rules=require('./payload-privacy.json');
const message='Refusing to package runtime user data or redirected files. Preserve the existing data and rebuild in a new clean output directory.';
const sourceMessage='Refusing to package private, generated or redirected source inputs. Preserve the files and use a clean source directory.';
const sourceDirectories=new Set(['.git','.svn','.hg','.cache','.gradle','node_modules','out','build','dist','coverage','logs']);
const sourceFiles=new Set(['.npmrc','.netrc','credentials','credentials.json','id_rsa','id_dsa','id_ecdsa','id_ed25519']);

// Keep this known build-cache exclusion shared by validation and copying.
function sourceIncluded(file){return path.basename(file)!=='__pycache__';}

async function verifySourcePrivacy(inputs){
  async function walk(current){
    const stat=await fs.lstat(current);
    if(stat.isSymbolicLink()||!stat.isFile()&&!stat.isDirectory())throw Error(sourceMessage);
    if(!sourceIncluded(current))return;
    const name=path.basename(current).toLowerCase();
    if(forbidden(name,stat.isDirectory()) || (stat.isDirectory()?sourceDirectories.has(name):
      sourceFiles.has(name)||(/^\.env(?:\.|$)/.test(name)&&name!=='.env.example')||/\.(?:log|sqlite(?:3)?(?:-wal|-shm)?|db|bak|tmp|part|dmp|pyc)$/.test(name)))throw Error(sourceMessage);
    if(stat.isDirectory())for(const name of await fs.readdir(current))await walk(path.join(current,name));
    else {
      const text=(await fs.readFile(current)).toString('utf8');
      // Certificates and code containing a PEM marker remain legitimate inputs.
      if(/-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----\s*[A-Za-z0-9+/=\r\n]{32,}-----END (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/.test(text)||
        /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{50,}|AKIA[A-Z0-9]{16})\b/.test(text))throw Error(sourceMessage);
    }
  }
  for(const input of inputs)await walk(input);
}

function forbidden(name,directory){
  name=name.toLowerCase();
  return directory
    ?rules.directoryNames.includes(name)||rules.directoryPrefixes.some(prefix=>name.startsWith(prefix))
    :rules.fileNames.includes(name)||rules.filePrefixes.some(prefix=>name.startsWith(prefix))||rules.fileSuffixes.some(suffix=>name.endsWith(suffix));
}

// A launched portable build may now contain a real profile beside its EXE.
// Refuse the entire build rather than silently excluding data or repackaging it.
async function verifyPayloadPrivacy(directory){
  async function walk(current){
    const stat=await fs.lstat(current);
    if(stat.isSymbolicLink()||!stat.isFile()&&!stat.isDirectory()||forbidden(path.basename(current),stat.isDirectory()))throw Error(message);
    if(stat.isDirectory())for(const name of await fs.readdir(current))await walk(path.join(current,name));
  }
  const stat=await fs.lstat(directory);
  if(!stat.isDirectory()||stat.isSymbolicLink())throw Error(message);
  await walk(directory);
}
module.exports={verifyPayloadPrivacy,verifySourcePrivacy,sourceIncluded};
