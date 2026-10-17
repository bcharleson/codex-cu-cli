import test from 'node:test';
import assert from 'node:assert/strict';
import { imageSize, shrinkFactor } from '../lib/scale-fix.mjs';
test('image parsing ignores malformed images and reads PNG dimensions', () => {
  for (const b of [Buffer.alloc(0), Buffer.from([137]), Buffer.from([255,216,255,192,0,0])]) assert.equal(imageSize(b), null);
  const png = Buffer.alloc(24); Buffer.from([137,80,78,71,13,10,26,10]).copy(png);
  png.writeUInt32BE(460,16); png.writeUInt32BE(816,20);
  assert.deepEqual(imageSize(png), [460,816]);
});
test('mixed-display correction matches the window and declines ambiguous windows', () => {
  const screens = [{ x:0,y:0,w:1000,h:1000,scale:1 },{ x:1000,y:0,w:1000,h:1000,scale:2 }];
  const window = { name:'Calculator',bundle:'com.apple.calculator',x:0,y:0,w:230,h:408 };
  assert.equal(shrinkFactor([460,816], { screens,windows:[window] }, new Set(['Calculator'])), 2);
  assert.equal(shrinkFactor([460,816], { screens,windows:[window] }, new Set(['Other'])), 1);
  assert.equal(shrinkFactor([460,816], { screens,windows:[window,{ ...window,x:1100 }] }, new Set(['Calculator'])), 1);
});
