'use strict';
const fs=require('node:fs'),path=require('node:path');

// Packaged Electron opens its embedded application and ignores a test bootstrap.
// Reject it before a test can start a window or open a real Windows profile.
function testRuntime(executable=process.env.LINK_QA_ELECTRON||require('electron')){
  const resources=process.platform==='darwin'
    ?path.resolve(path.dirname(executable),'../Resources'):path.join(path.dirname(executable),'resources');
  if(['app','app.asar'].some(name=>fs.existsSync(path.join(resources,name)))){
    throw Error('LINK_QA_ELECTRON must point to an unbundled Electron runtime. Use LINK_QA_APP_ROOT for packaged sources in the private chat suite.');
  }
  return executable;
}
module.exports={testRuntime};
