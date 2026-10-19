// Somente HTML local: não navega no LinkedIn nem envia candidaturas.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs');
const {chromium}=require('playwright-core');
process.env.JOB_APPLIER_DATA_DIR=require('path').join(__dirname,'fixtures');
const {fillStep,pendingFields,validationFields}=require('./worker');
const {waitFormReady,waitFormAction,formSignature,waitStepChange}=require('./form-flow');
test('pagina inteira aguarda campos, anexa curriculo, seleciona radio sem rotulo e chega a revisao',async()=>{
  const executable=[process.env.JOB_APPLIER_BROWSER,'C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p=>p&&fs.existsSync(p));
  const browser=await chromium.launch({executablePath:executable,headless:true});
  try{
    const page=await browser.newPage();
    await page.setContent(`<main><h2>Candidate-se à empresa de teste</h2><section id="step"></section></main>`);
    await page.evaluate(()=>{
      window.sent=0;
      setTimeout(()=>{document.querySelector('#step').innerHTML='<label for="email">E-mail*</label><input id="email" required><button aria-label="Continuar para a próxima etapa" id="next">Avançar</button>';
      document.querySelector('#next').onclick=()=>{
        document.querySelector('#step').innerHTML='<fieldset role="radiogroup" id="resumes"></fieldset><button id="upload">Carregar currículo</button><button id="next">Avançar</button>';
        document.querySelector('#upload').onclick=()=>{
          const input=document.createElement('input');input.type='file';input.hidden=true;document.body.append(input);
          input.onchange=()=>{document.querySelector('#resumes').innerHTML='<div><div role="radio"><div><input type="radio" name="cv"></div></div><p>PDF</p><p>'+input.files[0].name+'</p></div>';};input.click();
        };
        document.querySelector('#next').onclick=()=>{document.querySelector('#step').innerHTML='<h3>Revise sua candidatura</h3><button id="submit">Enviar candidatura</button>';document.querySelector('#submit').onclick=()=>window.sent++;};
      };},500);
    });
    await waitFormReady(page);
    assert.deepEqual(await fillStep(page,true),[]);
    assert.match(await page.locator('#email').inputValue(),/@/);
    let signature=await formSignature(page),action=await waitFormAction(page);
    assert.equal(action.kind,'next');await action.button.click();await waitStepChange(page,signature);
    assert.deepEqual(await fillStep(page,true),[]);
    assert.equal(await page.locator('input[type=radio]').isChecked(),true);
    signature=await formSignature(page);action=await waitFormAction(page);await action.button.click();await waitStepChange(page,signature);
    assert.equal((await waitFormAction(page)).kind,'submit');assert.equal(await page.evaluate(()=>window.sent),0);
    await page.setContent(`<main><h2>Candidate-se à empresa de teste</h2><p>Possui conhecimento em SQL?</p><div role="radiogroup"><div role="radio" onclick="this.querySelector('input').checked=true"><input type="radio" hidden name="sql"><span>Sim</span></div><div role="radio"><input type="radio" hidden name="sql"><span>Não</span></div></div><button>Avançar</button></main>`);
    assert.deepEqual(await fillStep(page,true),[]);assert.equal(await page.locator('input').first().isChecked(),true);
  }finally{await browser.close()}
});
test('preenche selecao e radios aprovados; bloqueia pergunta desconhecida preselecionada',async()=>{
  const executable=[process.env.JOB_APPLIER_BROWSER,'C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p=>p&&fs.existsSync(p));
  assert.ok(executable,'Chrome ou Edge necessário para o teste local de formulários');
  const browser=await chromium.launch({executablePath:executable,headless:true});
  try{
    const page=await browser.newPage();
    await page.setContent(`<div role="dialog">
      <label for="sql">Possui conhecimento em SQL?</label><select id="sql"><option value="">Selecione</option><option value="y">Yes</option><option value="n">No</option></select>
      <fieldset><legend>Possui conhecimento avançado em Power BI e Excel?</legend><label><input type="radio" name="bi" value="yes">Sim</label><label><input type="radio" name="bi" value="no" checked>Não</label></fieldset>
    </div>`);
    assert.deepEqual(await fillStep(page,true),[]);
    assert.equal(await page.locator('#sql').inputValue(),'y');
    assert.equal(await page.locator('input[value=yes]').isChecked(),true);
    await page.setContent(`<div role="dialog"><fieldset><legend>Possui certificação SAP?</legend><label><input type="radio" name="sap" checked>Sim</label><label><input type="radio" name="sap">Não</label></fieldset></div>`);
    assert.deepEqual(await fillStep(page,true),['Possui certificação SAP?']);
    assert.deepEqual(await pendingFields(page,['Possui certificação SAP?']),[{question:'Possui certificação SAP?',type:'choice',options:['Sim','Não']}]);
    await page.setContent(`<div role="dialog"><label for="years">Quantos anos de ferramenta desconhecida?</label><input id="years" type="number" required><label for="text">Descreva sua experiência específica</label><textarea id="text" required maxlength="250"></textarea><label for="select">Disponibilidade especial?</label><select id="select"><option value="">Selecione</option><option value="a">Manhã</option><option value="b">Noite</option></select></div>`);
    const missing=await fillStep(page,true),fields=await pendingFields(page,missing);
    assert.equal(fields.find(f=>f.question.startsWith('Quantos')).type,'number');
    assert.equal(fields.find(f=>f.question.startsWith('Descreva')).max_length,250);
    assert.deepEqual(fields.find(f=>f.type==='choice').options,['Manhã','Noite']);
    assert.deepEqual(await pendingFields(page,['Verificação de segurança da plataforma']),[{question:'Verificação de segurança da plataforma',type:'manual_review'}]);
    await page.setContent(`<div role="dialog"><div><label for="months">Você trabalha com Power BI a média de quantos meses?*</label><input id="months" value="Sim" aria-invalid="true" aria-describedby="months-error"><span id="months-error">Valor inválido</span></div></div>`);
    assert.deepEqual(await validationFields(page),[{question:'Você trabalha com Power BI a média de quantos meses?*',type:'number',error:'Valor inválido',previous_answer:'Sim'}]);
    await page.setContent(`<div role="dialog"><label for="empty">Campo da próxima etapa</label><input id="empty" required></div>`);
    assert.deepEqual(await validationFields(page,false),[],'não trata campo novo vazio como resposta rejeitada');
    assert.equal((await validationFields(page)).length,1,'validação nativa é capturada depois de preencher');
  }finally{await browser.close()}
});
