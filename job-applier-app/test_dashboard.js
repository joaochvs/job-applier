// Teste da interface com API simulada e bloqueio de rede externa.
const {test}=require('node:test');const assert=require('node:assert/strict');
const fs=require('fs'),path=require('path');const {chromium}=require('playwright-core');
test('painel responsivo, log ao vivo, feedback do atualizar e inicio sem duplo clique',async()=>{
 const executable=[process.env.JOB_APPLIER_BROWSER,'C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p=>p&&fs.existsSync(p));
 const browser=await chromium.launch({executablePath:executable,headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  let starts=0,delay=false,mockJobs=[],savedAnswers;
  const live={run:{status:'running',active:true,phase:'searching',applications:[]},session:{mode:'automatic'},search_active:false,
   search:{status:'evaluating',current:7,total:40,accepted:2,title:'Analista de Business Analytics Pleno'},worker:{},
   config:{enabled:true,hour:11,minute:0,search:{hours:24,max_candidates:40}},updated_at:new Date().toISOString(),
   audit:[{id:'123',title:'Analista de Business Analytics Pleno',company:'Empresa exemplo',location:'São Paulo, Brasil',score:80,status:'eligible',reason:'Compatível com a triagem',url:'https://www.linkedin.com/jobs/view/123/',breakdown:[{label:'SQL',points:20},{label:'Power BI',points:20}]}],
   events:[{at:new Date().toISOString(),stage:'search',message:'Pesquisando Analista de Dados · São Paulo e região'},{at:new Date().toISOString(),stage:'evaluate',message:'Lendo Analista de Business Analytics Pleno'},{at:new Date().toISOString(),stage:'eligible',message:'Vaga compatível, nota 80'}]};
  await page.route('**/*',async route=>{
   const url=new URL(route.request().url());assert.equal(url.hostname,'app.test');
   if(url.pathname.startsWith('/api/')){
    if(delay&&url.pathname==='/api/live')await new Promise(r=>setTimeout(r,650));
    let body={};
    if(url.pathname==='/api/live')body=live;
    if(url.pathname==='/api/jobs')body={jobs:mockJobs};
    if(url.pathname==='/api/profile')body={profile:{full_name:'Pessoa de teste'},skills:{},learned_answers:[{question:'Quantos anos de ferramenta de teste?',answer:'2',job_id:null}]};
    if(url.pathname==='/api/jobs/456/answers'){savedAnswers=route.request().postDataJSON();mockJobs[0].resume_queued=true;body={ok:true,status:'queued'};}
    if(url.pathname==='/api/summary')body={total:12,easy_apply:8,ready:2,sent:3};
    if(url.pathname==='/api/runs')body={runs:[{date:'2026-10-19',status:'completed',evaluated:40,applications:[{title:'Analista de BI',company:'Empresa A',status:'submitted',url:'https://www.linkedin.com/jobs/view/123/'}]}]};
    if(url.pathname==='/api/automatic/start'){starts++;live.run.active=true;live.run.status='running';live.search.status='searching';}
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(body)});
   }
   const file=path.join(__dirname,'static',url.pathname==='/'?'index.html':url.pathname.slice(1));
   return route.fulfill({status:200,contentType:file.endsWith('.css')?'text/css':file.endsWith('.js')?'text/javascript':'text/html',body:fs.readFileSync(file)});
  });
  await page.goto('http://app.test/');await page.getByText('Analisando as oportunidades',{exact:true}).waitFor();
  assert.equal(await page.locator('#run-automatic').isDisabled(),true);
  const output=path.resolve(__dirname,'../output');fs.mkdirSync(output,{recursive:true});
  await page.screenshot({path:path.join(output,'painel-desktop.png'),fullPage:true});
  delay=true;await page.locator('#refresh').click();assert.equal(await page.locator('#refresh').isDisabled(),true);
  await page.getByText('Atualizando…',{exact:true}).waitFor();await page.getByText('Painel atualizado. Se nada mudou, não houve novos registros.',{exact:true}).waitFor();delay=false;
  live.events.push({at:new Date().toISOString(),stage:'submitted',message:'Envio confirmado no teste de interface'});
  await page.getByText('Envio confirmado no teste de interface',{exact:true}).waitFor({timeout:6000});
  await page.setViewportSize({width:390,height:844});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),'sem rolagem horizontal no celular');
  await page.screenshot({path:path.join(output,'painel-mobile.png'),fullPage:true});
  live.run.active=false;live.run.status='completed';await page.getByText('Execução concluída',{exact:true}).waitFor({timeout:6000});
  await page.locator('#run-automatic').click();await page.getByText('Execução iniciada. Acompanhe o progresso abaixo.',{exact:true}).waitFor();
  assert.equal(starts,1);assert.equal(await page.locator('#run-automatic').isDisabled(),true);
  await page.getByRole('button',{name:'Histórico de execuções',exact:true}).click();await page.getByRole('button',{name:'Ver execução',exact:true}).click();
  await page.getByText('Resultados do lote',{exact:true}).waitFor();await page.locator('#modal .close').click();
  await page.getByRole('button',{name:'Visão geral',exact:true}).click();
  mockJobs=[{id:'456',cargo:'Analista de teste',empresa:'Empresa exemplo',nota:85,status:'Aguardando aprovação',retryable:true,pending_fields:[{question:'Quantos anos de ferramenta de teste?',type:'number'},{question:'Você aceita trabalhar presencialmente?',type:'choice',options:['Yes','No']}]}];
  await page.locator('#pending-answers input[name=answer]').waitFor({timeout:6000});
  assert.equal(await page.locator('#answers-modal').evaluate(el=>el.open),true);
  await page.locator('#pending-answers input[name=answer]').fill('2');
  await page.locator('#pending-answers input[name=remember]').check();
  await page.locator('#pending-answers select').selectOption('Yes');
  // Um poll não pode apagar a resposta ainda sendo digitada.
  await page.locator('#close-answers').click();
  await page.locator('#refresh').click();
  assert.equal(await page.locator('#answers-modal').evaluate(el=>el.open),false,'poll não reabre modal dispensado');
  await page.locator('#open-answers').click();
  assert.equal(await page.locator('#pending-answers input[name=answer]').inputValue(),'2');
  await page.getByRole('button',{name:'Salvar e continuar',exact:true}).click();
  await page.getByRole('button',{name:'Na fila para continuar',exact:true}).waitFor();
  assert.deepEqual(savedAnswers.answers,[{question:'Quantos anos de ferramenta de teste?',answer:'2',remember:true},{question:'Você aceita trabalhar presencialmente?',answer:'Yes',remember:false}]);
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));
  await page.locator('#close-answers').click();
  // Uma rejeição nova abre novamente o modal e pede outra resposta.
  mockJobs[0].resume_queued=false;mockJobs[0].pending_revision='new-rejection';mockJobs[0].pending_fields[0].error='Valor inválido';mockJobs[0].pending_fields[0].previous_answer='2';
  await page.getByText('Corrija esta resposta',{exact:true}).waitFor({timeout:6000});
  assert.equal(await page.locator('#pending-answers input[name=answer]').inputValue(),'');
  await page.locator('#answers-modal').screenshot({path:path.join(output,'respostas-pendentes-mobile.png')});
  await page.locator('#close-answers').click();
  await page.getByRole('button',{name:'Perfil e respostas',exact:true}).click();
  await page.getByText('Respostas informadas no painel',{exact:true}).waitFor();
  await page.locator('#profile').getByText('Quantos anos de ferramenta de teste?',{exact:true}).waitFor();
  assert.deepEqual(errors,[]);
 }finally{await browser.close()}
});
