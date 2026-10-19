const {normalize}=require('./answers');
function buttonKind(name){
  const text=normalize(name);
  if(/^(enviar candidatura|submit application)(?:$|\s)/.test(text))return 'submit';
  if(/^(avancar|proxim[oa]|continuar|next|continue|review|revisar|revise|avaliar)(?:$|\s)/.test(text))return 'next';
  return null;
}
async function applicationDialog(page){
  const deadline=Date.now()+20000;
  do{
    const dialog=page.locator('[role=dialog]:visible,dialog[open]:visible').last();
    if(await dialog.count())return dialog;
    const main=page.locator('main').first();
    if(await main.count()&&await main.getByRole('heading',{name:/^(Candidate-se à empresa|Candidatar-se|Apply to)/i}).count())return main;
    await page.waitForTimeout(250);
  }while(Date.now()<deadline);
  throw new Error('Não encontrei a janela ou página de candidatura do LinkedIn.');
}
async function waitFormReady(page,{timeout=20000}={}){
  const deadline=Date.now()+timeout;let last='',stable=0;
  do{
    const root=await applicationDialog(page);
    const signature=await root.evaluate(el=>{
      const visible=e=>e.getClientRects().length>0;
      const fields=[...el.querySelectorAll('input,select,textarea')].filter(e=>visible(e)&&e.type!=='hidden');
      const buttons=[...el.querySelectorAll('button')].filter(visible).map(e=>(e.getAttribute('aria-label')||e.innerText).trim());
      if(!fields.length&&!buttons.some(t=>/continu|avan[cç]|pr[oó]xim|next|review|revis|enviar candidatura|submit application/i.test(t)))return '';
      return (el.innerText||'').trim()+'|'+fields.map(f=>f.id+':'+f.type).join(',');
    });
    if(signature&&signature===last)stable++;else stable=0;
    if(stable>=2)return root;
    last=signature;await page.waitForTimeout(300);
  }while(Date.now()<deadline);
  throw new Error('O formulário abriu, mas os campos e controles não ficaram prontos.');
}
async function waitFormAction(page,{timeout=20000}={}){
  const deadline=Date.now()+timeout;let names=[];
  do{
    const root=await applicationDialog(page);names=[];
    for(const button of await root.getByRole('button').all()){
      if(!await button.isVisible())continue;
      const aria=await button.getAttribute('aria-label'),text=(await button.innerText()).trim();
      names.push(aria||text);
      const kind=buttonKind(aria||text)||buttonKind(text);
      if(kind&&await button.isEnabled())return {button,kind};
    }
    await page.waitForTimeout(300);
  }while(Date.now()<deadline);
  throw new Error('Não encontrei um botão habilitado para continuar. Controles visíveis: '+names.filter(Boolean).join('; '));
}
async function formSignature(page){return (await applicationDialog(page)).evaluate(el=>(el.innerText||'').trim()+'|'+[...el.querySelectorAll('input,select,textarea')].map(e=>e.id+':'+e.name+':'+e.type).join(','));}
async function waitStepChange(page,previous,{timeout=20000}={}){
  const deadline=Date.now()+timeout;
  do{
    if(await formSignature(page)!==previous){await waitFormReady(page);return;}
    await page.waitForTimeout(300);
  }while(Date.now()<deadline);
  throw new Error('O LinkedIn não avançou de etapa; confira os campos e as mensagens de validação.');
}
module.exports={buttonKind,applicationDialog,waitFormReady,waitFormAction,formSignature,waitStepChange};
