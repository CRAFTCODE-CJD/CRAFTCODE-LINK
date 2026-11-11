import test from 'node:test';
import assert from 'node:assert/strict';
import {personalThemeKey,bindPersonalTheme,viewGroupTheme} from '../src/renderer/theme.mjs';

test('the legacy theme migrates once, and viewing a group never changes either profile preference',()=>{
  const entries=new Map([['craftlink.appearance.theme','dusk']]);
  globalThis.localStorage={getItem:k=>entries.get(k)??null,setItem:(k,v)=>entries.set(k,v)};
  const dataset={};globalThis.document={documentElement:{dataset}};
  try{
    const select={},sync=bindPersonalTheme(select);
    sync('one');assert.equal(dataset.theme,'dusk');assert.equal(entries.get(personalThemeKey('one')),'dusk');
    viewGroupTheme('light');assert.equal(dataset.theme,'light');assert.equal(select.value,'dusk');
    select.value='forest';select.onchange();assert.equal(dataset.theme,'light');
    viewGroupTheme(null);assert.equal(dataset.theme,'forest');
    sync('two');assert.equal(dataset.theme,'default');assert(!entries.has(personalThemeKey('two')));
    select.value='light';select.onchange();
    sync('one');assert.equal(dataset.theme,'forest');
    viewGroupTheme('url(file:///untrusted)');assert.equal(dataset.theme,'forest');
  }finally{delete globalThis.localStorage;delete globalThis.document;}
});
