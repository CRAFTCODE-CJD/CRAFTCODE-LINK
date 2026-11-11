import test from 'node:test';
import assert from 'node:assert/strict';
import {singleEmoji} from '../src/renderer/chat-glyphs.mjs';
import groups from '../src/renderer/l10n/emoji.json' with {type:'json'};
import {sampleEnvelope} from '../src/renderer/chat-waveform.mjs';
import {transferText} from '../src/renderer/transfer-progress.mjs';

test('every picker sequence renders as a single emoji message',()=>{
  for(const list of Object.values(groups))for(const [glyph,name] of list)assert(singleEmoji(glyph),name);
  for(const text of ['123','друг 👋','🤝🤝','🇰🇿 🇰🇿'])assert(!singleEmoji(text));
});

test('the voice waveform follows the local samples including silence and both channels',()=>{
  const channels=[Float32Array.of(0,0,-.25,0,0,0,0,0),Float32Array.of(0,0,0,0,1,0,0,0)];
  const model=sampleEnvelope({numberOfChannels:2,length:8,duration:1,getChannelData:i=>channels[i]},4);
  assert.equal(model.duration,1);assert.deepEqual(model.levels,[0,.5,1,0]);
});

test('chat transfers display byte progress and measured rates down to a byte per second',()=>{
  assert.equal(transferText(1024,4096,32),'25% · 1 КиБ / 4 КиБ · 32 Б/с');
  assert.equal(transferText(0,0,0),'0% · 0 Б / 0 Б');
});
