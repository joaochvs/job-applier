const { getBrowser } = require('./browser');
const fs = require('fs');
const path = require('path');
const crypto=require('crypto');
const {submitOnce} = require('./submission');
const {resolveAnswer, matchOption,durationUnit} = require('./answers');
const {emit}=require('./events');
const {readJobPage}=require('./job-page');
const {applicationDialog,waitFormReady,waitFormAction,formSignature,waitStepChange}=require('./form-flow');

const root = path.resolve(__dirname, '..');
const jobId = process.argv[2];
const jobUrl = process.argv[3];
const autoSubmit = process.argv.includes('--auto-submit');
if(require.main===module && (!/^\d+$/.test(jobId||'') || !/^https:\/\/(www\.)?linkedin\.com\/jobs\/view\/\d+\/?$/.test(jobUrl||'') || !jobUrl.includes(`/jobs/view/${jobId}`))) {
  throw new Error('Identificador ou URL de vaga LinkedIn inválidos.');
}
const stateDir = path.join(__dirname, 'runtime');
const stateFile = path.join(stateDir, `${jobId}.json`);
const commandFile = path.join(stateDir, `${jobId}.command.json`);
const journalFile = path.join(stateDir, `${jobId}.submission.json`);
const {dataDir}=require('./config');
const profilePath=path.join(dataDir,'profile.json');
if(!fs.existsSync(profilePath))throw new Error('Perfil não configurado. Execute python setup.py e revise data/profile.json.');
const answers=JSON.parse(fs.readFileSync(profilePath,'utf8'));
const resume=path.join(dataDir,'resume.pdf');
if(!fs.existsSync(resume))throw new Error('Currículo não encontrado. Adicione seu PDF como data/resume.pdf (ou na pasta JOB_APPLIER_DATA_DIR).');
const resumeBuffer=fs.readFileSync(resume);
const resumeName=path.basename(resume,'.pdf')+'_'+crypto.createHash('sha256').update(resumeBuffer).digest('hex').slice(0,10)+'.pdf';
const resumeUpload={name:resumeName,mimeType:'application/pdf',buffer:resumeBuffer};
if(require.main===module) fs.mkdirSync(stateDir, { recursive: true });
// Uma confirmação de execução anterior nunca vale para uma nova candidatura.
if(require.main===module && fs.existsSync(commandFile)) fs.unlinkSync(commandFile);

function save(status, extra={}) {
  fs.writeFileSync(stateFile, JSON.stringify({jobId,status,updatedAt:new Date().toISOString(),...extra},null,2));
  const messages={starting:'Conectando ao navegador',opening_application:'Abrindo formulário de candidatura',filling:'Preenchendo formulário',needs_input:'Pergunta sem resposta cadastrada; candidatura pendente',needs_login:'Login ou verificação manual necessário',submitting:'Enviando candidatura',submitted:'Envio confirmado pelo LinkedIn',already_applied:'Candidatura já enviada anteriormente',submit_uncertain:'Resultado de envio incerto; repetição bloqueada',cancelled:'Preenchimento interrompido',error:'Falha no preenchimento'};
  emit(status,extra.message||messages[status]||status,{jobId,step:extra.step});
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const attachedPages=new WeakSet();
let applicationContext={};
function known(label) {
  return resolveAnswer(label, answers,{...applicationContext,jobId});
}

async function pendingFields(page, unknown) {
  const dialog=await applicationDialog(page), fields=new Map();
  for(const input of await dialog.locator('input:not([type=hidden]):not([type=file]),textarea,select').all()) {
    if(!await input.isVisible())continue;
    const label=await fieldLabel(input);if(!unknown.includes(label))continue;
    const tag=await input.evaluate(el=>el.tagName.toLowerCase()),type=await input.getAttribute('type');
    if(['checkbox','radio','submit','button'].includes(type))continue;
    const field={question:label,type:tag==='select'?'choice':type==='number'||durationUnit(label)?'number':'text'};
    if(tag==='select')field.options=await input.locator('option').evaluateAll(os=>os.filter(o=>!o.disabled&&o.value!=='').map(o=>o.textContent.trim()));
    const max=await input.getAttribute('maxlength');if(max&&Number(max)>0)field.max_length=Number(max);
    fields.set(label,field);
  }
  for(const group of await dialog.locator('fieldset:has(input[type=radio]),[role=radiogroup]:not(fieldset)').all()) {
    if(!await group.isVisible())continue;
    const legend=group.locator('legend').first();
    const label=await legend.count()?await legend.innerText():await questionLabel(group);
    if(!unknown.includes(label))continue;
    const options=[];
    for(const radio of await group.locator('input[type=radio],[role=radio]:not(:has(input[type=radio]))').all())options.push(await fieldLabel(radio));
    if(options.length&&options.every(Boolean))fields.set(label,{question:label,type:'choice',options:[...new Set(options)]});
  }
  return unknown.map(question=>fields.get(question)||{question,type:'manual_review'});
}

async function validationFields(page,includeNative=true){
  const root=await applicationDialog(page),errors=[];
  for(const input of await root.locator('input:not([type=hidden]):not([type=file]),textarea,select').all()){
    if(!await input.isVisible())continue;
    const error=await input.evaluate((el,includeNative)=>{
      const visible=e=>!!e&&e.getClientRects().length>0;
      const ids=[el.getAttribute('aria-errormessage'),el.getAttribute('aria-describedby')].filter(Boolean).join(' ').split(/\s+/);
      const badText=t=>/inv[aá]lid|insira|informe|obrigat[oó]ri|enter a valid|required|must be|deve ser/i.test(t||'');
      let message=ids.map(id=>document.getElementById(id)).filter(visible).map(e=>e.textContent.trim()).find(badText);
      if(!message){let parent=el.parentElement;for(let i=0;parent&&i<3;i++,parent=parent.parentElement){
        if(parent.querySelectorAll('input:not([type=hidden]),textarea,select').length>1)break;
        message=[...parent.querySelectorAll('[role=alert],[id*="error"],[class*="error"]')].filter(visible).map(e=>e.textContent.trim()).find(badText);
        if(message)break;
      }}
      if(el.getAttribute('aria-invalid')==='true'||(includeNative&&el.validity&&!el.validity.valid)||message)return {error:message||el.validationMessage||'O LinkedIn não aceitou esta resposta.',previous_answer:el.value||''};
      return null;
    },includeNative);
    if(error){const question=await fieldLabel(input);if(question)errors.push({question,...error});}
  }
  const fields=await pendingFields(page,errors.map(e=>e.question));
  return fields.map(f=>({...f,...errors.find(e=>e.question===f.question)}));
}

async function pauseOnValidation(page,includeNative=true){
  const fields=await validationFields(page,includeNative);if(!fields.length)return false;
  save('needs_input',{unknown:fields.map(f=>f.question),fields,message:'O LinkedIn rejeitou uma resposta. Corrija o valor no painel para continuar.'});
  return true;
}

async function fillStep(page, automatic=autoSubmit) {
  const unknown=[];
  const dialog=await applicationDialog(page);
  for(const input of await dialog.locator('input:not([type=hidden]):not([type=file])').all()) {
    if(!(await input.isVisible())) continue;
    const type=await input.getAttribute('type');
    if(['radio','checkbox','submit','button'].includes(type)) continue;
    const label=await fieldLabel(input);
    const value=known(label);
    if(value!=null) await input.fill(value);
    else if(await input.getAttribute('required')!==null||await input.getAttribute('aria-required')==='true') unknown.push(label||'Campo obrigatório sem rótulo');
    else if((await input.inputValue()).trim() && automatic) unknown.push(label||'Resposta pré-preenchida não validada');
  }
  for(const select of await dialog.locator('select').all()) {
    if(!(await select.isVisible())) continue;
    const label=await fieldLabel(select); const value=known(label);
    if(value!=null) {
      const options=await select.locator('option').evaluateAll(os=>os.map(o=>({label:o.textContent.trim(),value:o.value})));
      const option=matchOption(value,options);
      if(option) await select.selectOption({value:option.value});
      else unknown.push(label||'Opção não encontrada');
    }
    else unknown.push(label||'Seleção sem resposta cadastrada');
  }
  for(const input of await dialog.locator('textarea').all()) {
    if(!await input.isVisible()) continue;
    const label=await fieldLabel(input); const value=known(label);
    if(value!=null) await input.fill(value);
    else if(await input.getAttribute('required')!==null||await input.getAttribute('aria-required')==='true') unknown.push(label||'Resposta aberta obrigatória');
    else if(automatic && (await input.inputValue()).trim()) unknown.push(label||'Resposta aberta pré-preenchida não validada');
  }
  for(const input of await dialog.locator('input[type=checkbox]').all()) {
    if(!await input.isVisible()) continue;
    const label=await fieldLabel(input);
    if(await input.getAttribute('required')!==null||await input.getAttribute('aria-required')==='true') unknown.push(label||'Declaração obrigatória');
    else if(await input.isChecked()) await input.uncheck();
  }
  const files=dialog.locator('input[type=file]');
  const existingResume=dialog.getByText(resumeName,{exact:false}).filter({visible:true});
  if(await existingResume.count())attachedPages.add(page);
  if(await files.count()>1) unknown.push('Mais de um anexo solicitado; revisar tipo de documento');
  else if(await files.count()) {
    const label=await fieldLabel(files.first());
    if(/carta|cover letter|portf[oó]lio/i.test(label)) unknown.push('Anexo solicitado não é currículo');
    else if(!attachedPages.has(page)) {
      await files.first().setInputFiles(resumeUpload);
      try{await dialog.getByText(resumeName,{exact:false}).filter({visible:true}).first().waitFor({state:'visible',timeout:25000});}
      catch{unknown.push('O currículo foi anexado, mas o nome do arquivo ainda não foi confirmado na tela.');}
      attachedPages.add(page);
    }
  }
  if(!await files.count()&&!attachedPages.has(page)){
    const upload=dialog.getByRole('button',{name:/^(Carregar currículo|Upload resume|Upload CV)$/i}).first();
    if(await upload.count()){
      const chooser=page.waitForEvent('filechooser',{timeout:10000});
      await upload.click();await (await chooser).setFiles(resumeUpload);
      try{await dialog.getByText(resumeName,{exact:false}).filter({visible:true}).first().waitFor({state:'visible',timeout:25000});attachedPages.add(page);}
      catch{unknown.push('O upload do currículo ainda não foi confirmado na página.');}
    }
  }
  const groups=await dialog.locator('fieldset:has(input[type=radio]),[role=radiogroup]:not(fieldset)').all();
  const handled=new Set();
  for(const group of groups) {
    if(!await group.isVisible()) continue;
    const legend=group.locator('legend').first();
    const label=await legend.count()?await legend.innerText():await questionLabel(group);
    let value=known(label);
    const radios=await group.locator('input[type=radio],[role=radio]:not(:has(input[type=radio]))').all();
    const options=[];
    for(let i=0;i<radios.length;i++) {
      const radio=radios[i]; const name=await radio.getAttribute('name');
      if(name) handled.add(name);
      options.push({label:await fieldLabel(radio),value:String(i)});
    }
    const resumeOptions=options.filter(o=>o.label.includes(resumeName));
    const option=resumeOptions.length?resumeOptions[0]:value!=null?matchOption(value,options):null;
    if(option) {
      const radio=radios[Number(option.value)];
      if(await radio.getAttribute('role')==='radio') await radio.click();
      else if(!await radio.isChecked()){
        if(await radio.isVisible())await radio.check();
        else {
          const wrapper=radio.locator('xpath=ancestor::*[@role="radio"][1]');
          if(await wrapper.count())await wrapper.click();
          else {unknown.push(label||'Opção de múltipla escolha não acessível');continue;}
        }
        if(!await radio.isChecked())unknown.push(label||'Não foi possível confirmar a opção selecionada');
      }
    }
    else unknown.push(label||'Pergunta de múltipla escolha sem resposta cadastrada');
  }
  for(const radio of await dialog.locator('input[type=radio]').all()) {
    if(await radio.evaluate(el=>!!el.closest('fieldset,[role=radiogroup]')))continue;
    if(!handled.has(await radio.getAttribute('name')) && await radio.isVisible()) unknown.push('Pergunta de múltipla escolha sem grupo reconhecido');
  }
  return [...new Set(unknown.filter(Boolean))];
}

async function fieldLabel(input) {
  return input.evaluate(el => {
    const labelled=(el.getAttribute('aria-labelledby')||'').split(/\s+/).map(id=>document.getElementById(id)?.textContent||'').join(' ').trim();
    const direct=el.getAttribute('aria-label') || labelled || [...(el.labels||[])].map(x=>x.textContent).join(' ').trim() || el.getAttribute('placeholder');
    if(direct)return direct;
    if(el.type==='radio'||el.getAttribute('role')==='radio'){
      let parent=el;
      for(let i=0;parent&&i<4;i++,parent=parent.parentElement){
        const text=(parent.innerText||'').trim();
        if(text&&parent.querySelectorAll('input[type=radio]').length<=1)return text;
      }
    }
    return '';
  });
}
async function questionLabel(group){
  const label=await fieldLabel(group);if(label)return label;
  return group.evaluate(el=>{
    const valid=t=>t&&t.trim().length>8&&!/^(sim|nao|não|yes|no)$/i.test(t.trim());
    const previous=el.previousElementSibling?.innerText;
    if(valid(previous))return previous.trim().slice(0,800);
    let node=el;
    for(let i=0;node&&i<4;i++,node=node.parentElement){
      const candidates=[...node.querySelectorAll('legend,h3,h4,p,label')].filter(e=>!e.querySelector('input[type=radio]'));
      const question=candidates.find(e=>valid(e.innerText)&&!/^\s*(sim|nao|não|yes|no)\s*$/i.test(e.innerText));
      if(question)return question.innerText.trim().slice(0,800);
    }
    return (el.innerText||'').trim().slice(0,800);
  });
}

async function waitCommand() {
  for(let i=0;i<360;i++) { if(fs.existsSync(commandFile)){const c=JSON.parse(fs.readFileSync(commandFile,'utf8'));fs.unlinkSync(commandFile);return c;} await sleep(5000); }
  return {action:'timeout'};
}

if(require.main===module) (async()=>{
  let browser,context;
  try {
    if(fs.existsSync(journalFile)) { save('submit_uncertain',{message:'Existe tentativa anterior de envio. Não será repetida automaticamente.'}); return; }
    save('starting');
    ({browser,context}=await getBrowser());
    const page=context.pages()[0]||await context.newPage(); await page.goto(jobUrl,{waitUntil:'domcontentloaded'});
    if(/\/(login|authwall|checkpoint)/.test(page.url())){save('needs_login',{message:'Sessão expirada ou verificação do LinkedIn. Faça login manualmente.'});await browser.close();return;}
    if(await page.locator('iframe[src*="captcha"],iframe[src*="challenge"]').count()){save('needs_input',{unknown:['Verificação de segurança da plataforma']});await browser.close();return;}
    const details=await readJobPage(page);
    if(details.blocked){save('needs_login');await browser.close();return;}
    if(details.expired)throw new Error('A vaga não aceita mais candidaturas.');
    applicationContext=details;
    if(await page.getByText(/Candidatura enviada|Application submitted|You applied to this job/i).count()){save('already_applied');await browser.close();return;}
    save('opening_application');
    const easy=page.getByRole('button',{name:/Candidatura simplificada|Easy Apply/i}).first();
    if(!await easy.count()) throw new Error('Esta vaga não apresenta Candidatura Simplificada.');
    await easy.click();
    await waitFormReady(page);
    for(let step=0;step<10;step++){
      if(fs.existsSync(path.join(stateDir,'automatic.stop'))){save('cancelled',{message:'Interrupção solicitada.'});await browser.close();return;}
      if(/\/(checkpoint|authwall|login)/.test(page.url())||await page.locator('iframe[src*="captcha"],iframe[src*="challenge"]').count()){save('needs_login',{message:'A plataforma exige verificação manual.'});await browser.close();return;}
      save('filling',{step:step+1});
      const unknown=await fillStep(page);
      if(unknown.length){save('needs_input',{unknown,fields:await pendingFields(page,unknown)});await browser.close();return;}
      if(await pauseOnValidation(page)){await browser.close();return;}
      const action=await waitFormAction(page);
      if(action.kind==='submit'){
        if(!autoSubmit){
          save('awaiting_confirmation',{message:'Formulário preenchido e pronto para envio.'});
          const cmd=await waitCommand(); if(cmd.action!=='submit'){save('cancelled');await browser.close();return;}
        }
        if(fs.existsSync(path.join(stateDir,'automatic.stop'))){save('cancelled');await browser.close();return;}
        save('submitting',{automatic:autoSubmit});
        const result=await submitOnce(action.button,page.getByText(/candidatura.*enviada|application.*submitted/i).first(),journalFile);
        save(result,{automatic:autoSubmit,message:result==='submitted'?'Candidatura enviada.':'Resultado incerto; envio não será repetido.'});
        await browser.close();return;
      }
      const previous=await formSignature(page);
      await action.button.click();
      try{await waitStepChange(page,previous);}catch(error){if(await pauseOnValidation(page)){await browser.close();return;}throw error;}
      // Erros explícitos mudam o texto sem avançar; campos vazios de uma nova
      // etapa só recebem a validação nativa depois da tentativa de preenchimento.
      if(await pauseOnValidation(page,false)){await browser.close();return;}
    }
    throw new Error('O formulário excedeu dez etapas.');
  } catch(e) { const message=/Target page, context or browser has been closed/i.test(e.message)?'O navegador de candidaturas foi fechado durante o preenchimento. Tente novamente.':e.message; save('error',{message}); if(browser) await browser.close(); }
})();
module.exports={fillStep,pendingFields,validationFields,setApplicationContext:context=>{applicationContext=context;}};
