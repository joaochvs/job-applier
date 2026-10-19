const { getBrowser } = require('./browser');
const fs = require('fs');
const path = require('path');
const {readJobPage}=require('./job-page');
const runtime = path.join(__dirname,'runtime');
const stateFile = path.join(runtime,'search.json');
const resultsFile = path.join(runtime,'search-results.json');
const auditFile = path.join(runtime,'search-audit.json');
fs.mkdirSync(runtime,{recursive:true});
const save=(status,extra={})=>fs.writeFileSync(stateFile,JSON.stringify({status,updatedAt:new Date().toISOString(),...extra},null,2));
const {evaluateJob,compatibleLocation,searchTasks,selectCandidates}=require('./matching');
const {emit}=require('./events');
const configuration=JSON.parse(fs.readFileSync(path.join(__dirname,'automation.json'),'utf8'));
const tasks=searchTasks(configuration.search);
if(require.main===module) (async()=>{let browser,context;const audit=[];try{
  save('starting');
  fs.writeFileSync(auditFile,'[]');
  ({browser,context}=await getBrowser());
  const page=context.pages()[0]||await context.newPage(); const found=new Map();
  page.setDefaultNavigationTimeout(5000);page.setDefaultTimeout(4000);
  for(let i=0;i<tasks.length;i++){
    if(fs.existsSync(path.join(runtime,'automatic.stop'))){emit('stopped','Busca interrompida pelo usuário.');save('stopped',{message:'Busca interrompida.'});await browser.close();return;}
    const task=tasks[i];save('searching',{query:task.query,scope:task.scope,current:i+1,total:tasks.length,found:found.size});
    emit('search',`Pesquisando ${task.query} · ${task.scope}`,{current:i+1,total:tasks.length});
    const url=task.url;
    try{await page.goto(url,{waitUntil:'domcontentloaded',timeout:15000});}catch{continue}
    const loggedOut=async()=>page.url().includes('/login')||page.url().includes('/authwall')||await page.locator('a[href*="/login"],a[href*="/uas/login"]').count()>0;
    if(await loggedOut()){save('needs_login',{message:'Faça login no LinkedIn na janela de candidaturas e execute novamente.'});await browser.close();return;}
    await page.locator('main a[href*="/jobs/view/"]').first().waitFor({state:'visible',timeout:10000}).catch(()=>{});
    const links=await page.locator('main a[href*="/jobs/view/"]').evaluateAll(as=>as.map(a=>({url:a.href,title:(a.textContent||a.getAttribute('aria-label')||'').trim()})));
    for(const item of links){const m=item.url.match(/\/jobs\/view\/(\d+)/);if(!m||!item.title)continue;const id=m[1];if(!found.has(id))found.set(id,{id,url:`https://www.linkedin.com/jobs/view/${id}/`,title:item.title.replace(/\s+/g,' ').trim(),bucket:task.query+' · '+task.scope});}
  }
  const candidates=selectCandidates([...found.values()],configuration.search?.max_candidates||40);const results=[];
  let readFailures=0;
  for(let i=0;i<candidates.length;i++){
    if(fs.existsSync(path.join(runtime,'automatic.stop'))){emit('stopped','Busca interrompida pelo usuário.');save('stopped',{message:'Busca interrompida.'});await browser.close();return;}
    const item=candidates[i];save('evaluating',{current:i+1,total:candidates.length,found:found.size,accepted:results.length,title:item.title});
    emit('evaluate',`Lendo ${item.title}`,{current:i+1,total:candidates.length,url:item.url});
    const record={id:item.id,title:item.title,url:item.url};
    const rejected=reason=>{audit.push({...record,status:'rejected',reason});fs.writeFileSync(auditFile,JSON.stringify(audit,null,2));emit('rejected',`${record.title}: ${reason}`,{jobId:record.id});};
    let data;
    try{
      try{await page.goto(item.url,{waitUntil:'domcontentloaded',timeout:30000});}catch(error){if(error.name!=='TimeoutError')throw error;}
      data=await readJobPage(page,{stopped:()=>fs.existsSync(path.join(runtime,'automatic.stop'))});
      readFailures=0;
    }catch(error){
      if(error.pageData)Object.assign(record,{title:error.pageData.title||item.title,company:error.pageData.company,location:error.pageData.location});
      rejected(error.message);
      if(++readFailures>=3)throw new Error('Falha de leitura em três vagas consecutivas. A busca foi interrompida; isso não significa ausência de vagas compatíveis.');
      continue;
    }
    if(data.blocked){save('needs_login',{message:'O LinkedIn exige login ou verificação manual.'});await browser.close();return;}
    if(data.expired){rejected('A vaga não aceita mais candidaturas.');continue;}
    const title=(data.title||item.title).replace(/\s+/g,' ').trim();
    const company=(data.company||'Empresa não identificada').replace(/\s+/g,' ').trim();
    const location=(data.location||'Localização não identificada').replace(/\s+/g,' ').trim().slice(0,160);
    const description=(data.description||'').slice(0,18000);
    Object.assign(record,{title,company,location});
    if(description.trim().length<100){rejected('Descrição ausente ou curta demais para avaliar.');continue;}
    const easy=page.getByRole('button',{name:/Candidatura simplificada|Easy Apply/i}).first();
    if(!await easy.count()||!await easy.isVisible()){rejected('Botão de Candidatura Simplificada não identificado.');continue;}
    if(!compatibleLocation(location,data.model)){rejected('Localização fora de São Paulo e região ou remoto no Brasil não confirmado.');continue;}
    const rating=evaluateJob(title,description);
    Object.assign(record,{score:rating.score,breakdown:rating.breakdown,matches:rating.matches,family:rating.family});
    if(rating.score<configuration.min_score||rating.gaps.length){rejected(rating.gaps.length?rating.gaps.join('; '):`Nota ${rating.score}, abaixo do mínimo ${configuration.min_score}.`);continue;}
    emit('eligible',`${title}: compatível, nota ${rating.score}`,{jobId:item.id});
    audit.push({...record,status:'eligible',reason:'Compatível com a triagem automática.'});fs.writeFileSync(auditFile,JSON.stringify(audit,null,2));
    results.push({fonte:'LinkedIn',source_id:item.id,linkedin_id:item.id,url:item.url,cargo:title,empresa:company,localizacao:location,modelo:data.model,tipo_candidatura:'LinkedIn Simplificada',publicada_em:'Filtro últimas 24 horas',nota:String(rating.score),classificacao:'Prioridade',competencias_correspondentes:rating.matches.join('; '),lacunas:rating.gaps.join('; '),status:'Nova',candidatura_em:'',observacoes:`Triagem por regras; descrição lida por ${data.source}. Botão de candidatura simplificada confirmado em ${new Date().toISOString()}`});
  }
  fs.writeFileSync(resultsFile,JSON.stringify(results,null,2));emit('search_done',`Busca concluída: ${audit.length} analisadas, ${results.length} compatíveis.`);save('completed',{found:found.size,evaluated:audit.length,eligible:results.length,rejected:audit.filter(x=>x.status==='rejected').length});await browser.close();
}catch(e){const message=/Target page, context or browser has been closed|launchPersistentContext/i.test(e.message)?'O navegador de candidaturas foi fechado durante a busca. Clique em Buscar novas vagas para tentar novamente.':e.message;emit('error',message);save('error',{message});if(browser)await browser.close();}})();
module.exports={evaluateJob};
