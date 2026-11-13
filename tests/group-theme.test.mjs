import test from 'node:test';
import assert from 'node:assert/strict';
import {personalThemeKey,bindPersonalTheme,viewGroupTheme} from '../src/renderer/theme.mjs';

test('the legacy theme migrates once, and viewing a group never changes either profile preference',()=>{
  const entries=new Map([['craftlink.appearance.theme','dusk'],['craftlink.appearance.wallpaper','dots']]);
  globalThis.localStorage={getItem:k=>entries.get(k)??null,setItem:(k,v)=>entries.set(k,v)};
  const dataset={};globalThis.document={documentElement:{dataset}};
  try{
    const select={},wall={},preview={dataset:{}},sync=bindPersonalTheme(select,wall,preview);
    sync('one');assert.equal(dataset.theme,'dusk');assert.equal(entries.get(personalThemeKey('one')),'dusk');
    assert.equal(wall.value,'dots');wall.value='aurora';wall.onchange();
    viewGroupTheme('paper');assert.equal(dataset.theme,'paper');assert.equal(select.value,'dusk');
    select.value='terracotta';select.onchange();assert.equal(dataset.theme,'paper');assert.equal(preview.dataset.theme,'terracotta');
    viewGroupTheme(null);assert.equal(dataset.theme,'terracotta');
    sync('two');assert.equal(dataset.theme,'default');assert(!entries.has(personalThemeKey('two')));
    assert.equal(wall.value,'plain');select.value='light';select.onchange();wall.value='contours';wall.onchange();
    sync('one');assert.equal(dataset.theme,'terracotta');assert.equal(dataset.wallpaper,'aurora');
    viewGroupTheme('url(file:///untrusted)');assert.equal(dataset.theme,'terracotta');
  }finally{delete globalThis.localStorage;delete globalThis.document;}
});
