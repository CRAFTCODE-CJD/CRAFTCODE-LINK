'use strict';
const sections={internetBtn:'lobbyFallback',startLogin:'entryFallback',startCreate:'entryFallback',joinBtn:'lobbyFallback',createBtn:'lobbyFallback',bookNearby:'lobbyFallback',startNearby:'entryFallback'};
async function clickPath(page,selector,options){
  const id=selector.slice(1),section=sections[id];
  if(section && !await page.locator('#'+section).evaluate(d=>d.open)){
    await page.locator('#'+section+' > summary').click(options);
  }
  await page.click(selector,options);
  if(id==='networkHelpBtn'){
    await page.click('#helpConnectivity',options);
    await page.click('#technicalReport > summary',options);
  }
}
module.exports={clickPath};
