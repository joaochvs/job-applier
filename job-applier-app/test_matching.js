const {test}=require('node:test');const assert=require('node:assert/strict');
const {familyOf,evaluateJob,compatibleLocation,selectCandidates,searchTasks}=require('./matching');
test('engenharia junior e automacao usam criterios proprios sem Power BI',()=>{
  const engineer=evaluateJob('Engenheiro de Dados Júnior','Python, SQL, ETL, pipelines, data warehouse, APIs REST e Git.');
  assert.equal(engineer.family,'engineering');assert.equal(engineer.score,100);assert.deepEqual(engineer.gaps,[]);
  const automation=evaluateJob('Analista de Automação Pleno','Python, APIs REST, automação de processos e rotinas, tratamento de dados e SQL.');
  assert.equal(automation.family,'automation');assert.ok(automation.score>=75);assert.deepEqual(automation.gaps,[]);
});
test('busca inclui engenharia e automacao com limites de senioridade e foco tecnico',()=>{
  assert.ok(searchTasks().some(x=>x.query==='Junior Data Engineer'));
  assert.ok(searchTasks().some(x=>x.query==='Analista RPA'));
  for(const title of ['Engenheiro de Dados Pleno','Data Engineer Senior','Engenheiro de Automação Industrial'])assert.equal(titlePriorityForTest(title),-1);
  assert.ok(evaluateJob('Data Engineer','SQL Python ETL pipelines data warehouse').gaps.length);
  assert.ok(evaluateJob('Analista RPA','UiPath e certificação obrigatória em UiPath.').gaps.length);
  assert.ok(evaluateJob('Analista de Automação','Python APIs REST SQL, rotinas e tratamento de dados. UiPath obrigatório.').gaps.some(x=>x.includes('uipath')));
  assert.equal(familyOf('Analista de Qualidade de Dados'),'engineering');
});
function titlePriorityForTest(title){return require('./matching').titlePriority(title)}
test('analista pleno com SQL BI dashboards nao depende de Python para passar',()=>{
  const r=evaluateJob('Analista de Business Analytics Pleno','SQL, Power BI, dashboards para a tomada de decisão.');
  assert.ok(r.score>=75);assert.deepEqual(r.gaps,[]);
  assert.equal(r.breakdown.reduce((s,x)=>s+x.points,0),r.score);
});
test('menções à idade da empresa, equipe senior e area comercial nao viram exigencias',()=>{
  const r=evaluateJob('Analista de Dados','Empresa com 50 anos. Apoiar equipe sênior de vendas com SQL, Power BI e dashboards.');
  assert.ok(r.score>=75);assert.deepEqual(r.gaps,[]);
  assert.ok(evaluateJob('Analista de Dados','SQL, Power BI, dashboards. Experiência mínima de 5 anos.').gaps.length);
});
test('exclui cargos fora do foco pelo titulo',()=>{
  for(const t of ['Analista de Dados Sênior','Solution Architect for SAP Data Analytics','Data Scientist','Analista de Prospecção e Negócios'])assert.ok(evaluateJob(t,'SQL Power BI dashboards').gaps.length,t);
});
test('localizacao valida cidade e remoto sem confundir estado com municipio',()=>{
  assert.ok(compatibleLocation('São Paulo, São Paulo, Brasil','Híbrido'));
  assert.ok(compatibleLocation('Osasco, SP, Brasil','Presencial'));
  assert.ok(compatibleLocation('Brasil','Remoto'));
  assert.equal(compatibleLocation('Campinas, São Paulo, Brasil','Híbrido'),false);
  assert.equal(compatibleLocation('Belo Horizonte, Brasil','Híbrido'),false);
  assert.equal(compatibleLocation('United States','Remoto'),false);
});
test('busca cobre dois locais e consulta pleno; rodizio evita primeiros links monopolizarem lote',()=>{
  const tasks=searchTasks({hours:24});assert.ok(tasks.some(x=>x.query.includes('Pleno')));assert.ok(tasks.some(x=>x.scope==='Remoto no Brasil'));
  for(const task of tasks){const u=new URL(task.url);assert.equal(u.searchParams.get('f_AL'),'true');assert.equal(u.searchParams.get('f_TPR'),'r86400');}
  const selected=selectCandidates([{id:'1',title:'Data Analyst',bucket:'A'},{id:'2',title:'Data Analyst',bucket:'A'},{id:'3',title:'Analista de Dados',bucket:'B'},{id:'4',title:'Data Scientist',bucket:'B'}],2);
  assert.deepEqual(selected.map(x=>x.id),['1','3']);
});
