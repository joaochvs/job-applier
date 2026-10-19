const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {submitOnce} = require('./submission');

async function withJournal(fn) {
  const dir=fs.mkdtempSync(path.join(__dirname,'.test-submit-'));
  try { await fn(path.join(dir,'attempt.json')); }
  finally { const resolved=path.resolve(dir); assert.equal(path.dirname(resolved),__dirname); fs.rmSync(resolved,{recursive:true}); }
}
test('confirma envio e impede um segundo clique',()=>withJournal(async journal=>{
  let clicks=0;
  const button={click:async()=>{clicks++}};
  const confirmation={waitFor:async()=>{}};
  assert.equal(await submitOnce(button,confirmation,journal),'submitted');
  assert.equal(await submitOnce(button,confirmation,journal),'submit_uncertain');
  assert.equal(clicks,1);
}));
test('timeout de confirmação bloqueia reenvio',()=>withJournal(async journal=>{
  let clicks=0;
  const button={click:async()=>{clicks++}};
  const confirmation={waitFor:async()=>{throw Error('timeout')}};
  assert.equal(await submitOnce(button,confirmation,journal),'submit_uncertain');
  await submitOnce(button,confirmation,journal);
  assert.equal(clicks,1);
}));
test('clique que falha mantém registro antes da ação',()=>withJournal(async journal=>{
  const button={click:async()=>{assert.ok(fs.existsSync(journal));throw Error('connection lost')}};
  assert.equal(await submitOnce(button,{waitFor:async()=>{}},journal),'submit_uncertain');
}));
