const normalize=s=>String(s||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim();
const outsideTitle=/\bsenior\b|\bsr\b|especialista|specialist|coordinator|director|diretor|\bhead\b|\bstaff\b|coordenad|gerente|manager|\blead\b|\bprincipal\b|data scientist|cientista de dados|architect|arquiteto|assistente de cadastro|prospeccao|executivo de vendas|telemarketing/;
const relatedTitle=/analista.*dados|data analyst|analista.*\bbi\b|business (intelligence|analytics)|analytics analyst|reporting analyst|analista.*(indicadores|performance|insights|analytics|inteligencia|planejamento)|\bmis analyst\b/;
function familyOf(title){
  const t=normalize(title);
  if(/engenheir[oa].*dados|data engineer|analytics engineer|desenvolvedor.*etl|etl developer|analista.*(etl|integracao|qualidade.*dados)|data (quality|operations)|dataops/.test(t))return 'engineering';
  if(/automacao|automation|\brpa\b|automatizacao/.test(t))return 'automation';
  return 'analysis';
}
function excludedTitle(title){
  const t=normalize(title);
  return outsideTitle.test(t)||/automacao industrial|industrial automation|engenheir[oa].*eletric|\bclp\b/.test(t)||(/engenheir|engineer/.test(t)&&familyOf(t)==='engineering'&&/\bpleno\b|\bmid[ -]?level\b/.test(t));
}
function titlePriority(title){const t=normalize(title);return excludedTitle(t)?-1:(familyOf(t)!=='analysis'||relatedTitle.test(t))?2:/analista|analyst/.test(t)?1:0;}
function evaluateJob(title,description){
  const t=normalize(title),d=normalize(description),text=`${t} ${d}`;
  const matches=[],gaps=[],breakdown=[];
  const family=familyOf(t);
  if(excludedTitle(t))return {score:0,matches,gaps:['Cargo ou senioridade fora do foco de Dados e Automação'],breakdown};
  const add=(points,label,pattern)=>{if(pattern.test(text)){breakdown.push({label,points});matches.push(label);}};
  if(family==='engineering'){
    breakdown.push({label:'Engenharia, integração ou qualidade de dados',points:25});matches.push('Engenharia, integração ou qualidade de dados');
    add(20,'SQL e bancos relacionais',/\bsql\b|postgres|mysql|bancos? de dados relacionais/);
    add(20,'Python e preparação de dados',/python|pandas/);
    add(15,'ETL e pipelines',/\betl\b|\belt\b|pipelines?|ingestao|integracao de dados/);
    add(10,'Modelagem, qualidade e armazenamento',/modelagem|qualidade de dados|data quality|data warehouse|data lake|data modeling/);
    add(5,'APIs e integrações',/\bapis?\b|rest|integracoes/);
    add(5,'Git e versionamento',/\bgit\b|github|versionamento/);
    if(/engenheir|engineer/.test(t)&&!/\bjunior\b|\bjr\b|entry.level|iniciante|early career/.test(t+' '+d))gaps.push('Senioridade júnior de Engenharia de Dados não confirmada');
  }else if(family==='automation'){
    breakdown.push({label:'Automação de processos e integrações',points:25});matches.push('Automação de processos e integrações');
    add(25,'Python e scripts',/python|pandas|scripts? em python/);
    add(20,'APIs e integração de sistemas',/\bapis?\b|rest|integracao de sistemas|integracoes/);
    add(10,'Automação de rotinas',/automacao de processos|automatizacao|rotinas|\brpa\b|workflows?|fluxos/);
    add(10,'Tratamento e fluxo de dados',/dados|\betl\b|pipelines?|csv|planilhas|excel/);
    add(5,'SQL e bancos',/\bsql\b|postgres|mysql|bancos? de dados/);
    add(5,'Git e versionamento',/\bgit\b|github|versionamento/);
    if(!/python|\bapis?\b|integracao de sistemas|tratamento de dados/.test(d))gaps.push('Automação sem aderência técnica a Python, APIs ou dados identificada');
  }else{
  if(relatedTitle.test(t)){breakdown.push({label:'Cargo relacionado a Dados/BI',points:25});matches.push('Cargo relacionado a Dados/BI');}
  add(20,'SQL',/\bsql\b|consultas sql|\bqueries\b/);
  add(20,'Business Intelligence',/power bi|looker studio|business intelligence/);
  add(15,'Dashboards e indicadores',/dashboards?|indicadores|\bkpis?\b|reporting|relatorios gerenciais/);
  add(10,'Análise para o negócio',/insights?|tomada de decisao|analise.*(performance|negocio|dados)|data analysis|business analysis/);
  add(5,'Python, APIs ou automação',/python|pandas|automacao|automatizacao|\betl\b|\bapis?\b|pipeline/);
  add(3,'Excel e Power Query',/excel|power query/);
  add(2,'Modelagem e qualidade',/modelagem de dados|qualidade de dados|data quality|data modeling|bancos? de dados|data warehouse/);
  }
  // Somente exigências explícitas de experiência; não a idade da empresa.
  const requirements=[...d.matchAll(/(?:pelo menos|no minimo|minimo de|minimum of|at least)\s*(\d+)\s*(?:\+\s*)?(?:anos|years)(?:\s+de)?\s+(?:experiencia|experience)/g),
    ...d.matchAll(/(?:experiencia|experience)\s+(?:(?:minima|minimum)\s+)?(?:de|of)?\s*(\d+)\s*\+?\s*(?:anos|years)/g),
    ...d.matchAll(/(\d+)\s*\+\s*(?:anos|years)(?:\s+de)?\s+(?:experiencia|experience)/g)];
  if(requirements.some(m=>Number(m[1])>3))gaps.push('Exige explicitamente mais de três anos de experiência');
  for(const sentence of String(description||'').split(/[.!?\n;]+/).map(normalize)){
    if(/obrigatori|required|indispensavel|essencial/.test(sentence)&&!/nao obrigatori|not required/.test(sentence)){
      const platform=sentence.match(/uipath|blue prism|automation anywhere|marketo/);
      if(platform)gaps.push(`Exigência de ${platform[0]} sem conhecimento cadastrado`);
    }
  }
  const score=breakdown.reduce((sum,x)=>sum+x.points,0);
  if(family==='analysis'&&!/\bsql\b|power bi|looker studio|dashboards?|business intelligence/.test(d))gaps.push('Descrição sem atividades centrais de Dados/BI identificadas');
  return {score,matches,gaps,breakdown,family};
}
function compatibleLocation(location,model){
  const l=normalize(location),city=l.split(',')[0].replace(/\s*\([^)]*\)/g,'').trim();
  if(normalize(model)==='remoto')return /brasil|brazil/.test(l)||/sao paulo|\bsp\b/.test(l);
  return ['sao paulo','osasco','barueri','guarulhos','santo andre','sao bernardo do campo','sao caetano do sul','diadema','carapicuiba','taboao da serra','cotia','santana de parnaiba','alphaville','maua','embu das artes','itapevi','jandira','mogi das cruzes','suzano','itaquaquecetuba'].includes(city);
}
function searchTasks(config={}){
  const queries=config.queries||['Analista de Dados','Analista de Dados Pleno','Analista de BI','Data Analyst','Business Analytics','Analista de Inteligência Comercial','Analista de Indicadores','Analista de Performance','Analista de Marketing BI','Reporting Analyst','Engenheiro de Dados Júnior','Junior Data Engineer','Analytics Engineer Junior','Desenvolvedor ETL','Analista de Integração de Dados','Analista de Qualidade de Dados','Analista de Automação','Automação Python','Analista RPA'];
  return queries.flatMap(query=>['São Paulo e região','Remoto no Brasil'].flatMap(scope=>Array.from({length:Math.max(1,Math.min(3,config.pages_per_query||1))},(_,page)=>{
    const params=new URLSearchParams({keywords:query,f_AL:'true',f_TPR:`r${(config.hours||24)*3600}`,sortBy:'DD',start:String(page*25)});
    if(scope==='Remoto no Brasil'){params.set('location','Brasil');params.set('f_WT','2');}
    else {params.set('location','São Paulo, São Paulo, Brasil');params.set('distance','25');}
    return {query,scope,page:page+1,url:'https://www.linkedin.com/jobs/search/?'+params};
  })));
}
function selectCandidates(items,maximum=40){
  // Rodízio entre consultas, preservando vagas de cargos relacionados primeiro.
  const groups=new Map();
  for(const item of items){if(titlePriority(item.title)<0)continue;const key=item.bucket||'default';if(!groups.has(key))groups.set(key,[]);groups.get(key).push(item);}
  for(const bucket of groups.values())bucket.sort((a,b)=>titlePriority(b.title)-titlePriority(a.title));
  const chosen=[];
  while(chosen.length<maximum&&[...groups.values()].some(g=>g.length))for(const bucket of groups.values()){if(bucket.length&&chosen.length<maximum)chosen.push(bucket.shift());}
  return chosen;
}
module.exports={familyOf,evaluateJob,titlePriority,compatibleLocation,searchTasks,selectCandidates};
