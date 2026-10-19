const {test}=require('node:test');
const assert=require('node:assert/strict');
const {resolveAnswer,matchOption}=require('./answers');
const answers=require('./fixtures/profile.json');

test('tempo em meses recebe numero convertido, nunca Sim',()=>{
  assert.equal(resolveAnswer('Você trabalha com Power Bi a média de quantos meses?*',answers),'24');
  assert.equal(resolveAnswer('How many months of experience with Excel?',answers),'24');
  assert.equal(resolveAnswer('Você trabalha com Kubernetes há quantos meses?',answers),null);
  assert.equal(resolveAnswer('Há quanto tempo você trabalha com Power BI?',answers),null);
  const learned={...answers,custom_answers:[{question:'Quantos meses de Power BI?',answer:'Sim',job_id:null}]};
  assert.equal(resolveAnswer('Quantos meses de Power BI?',learned),null);
});

test('resposta aprendida vale somente para pergunta exata e escopo escolhido',()=>{
  const learned={...answers,custom_answers:[{question:'Quantos anos de PowerPoint?',answer:'3',job_id:null},{question:'Quantos anos de PowerPoint?',answer:'2',job_id:'123'},{question:'Aceita presencial?',answer:'Yes',job_id:'123'}]};
  assert.equal(resolveAnswer('QUANTOS ANOS DE POWERPOINT?',learned,{jobId:'123'}),'2');
  assert.equal(resolveAnswer('Quantos anos de PowerPoint?',learned,{jobId:'999'}),'3');
  assert.equal(resolveAnswer('Quantos anos de PowerPoint e SAP?',learned,{jobId:'123'}),null);
  assert.equal(resolveAnswer('Aceita presencial?',learned,{jobId:'999'}),null);
  assert.equal(resolveAnswer('Aceita presencial?',learned,{jobId:'123'}),'Yes');
});

test('pergunta geral do formulário usa experiencia confirmada em analise de dados',()=>{
  assert.equal(resolveAnswer('Há quantos anos você trabalha com analise de dados ?\n*',answers),'2');
  assert.equal(resolveAnswer('Quantos anos de experiência em análise de dados?',answers),'2');
  assert.equal(resolveAnswer('Quantos anos você trabalha com análise de dados com Kubernetes?',answers),null);
  assert.equal(resolveAnswer('Há quantos anos você trabalha com análise de dados?',{...answers,profile:{}}),null);
  assert.equal(resolveAnswer('Há quantos anos você já usa Microsoft PowerPoint no trabalho?',answers),'2');
  assert.equal(resolveAnswer('Você aceita trabalhar presencialmente?',answers),null);
});

test('presencial respeita a regiao e a preferencia confirmada',()=>{
  const label='Você aceita trabalhar presencialmente?*';
  assert.equal(resolveAnswer(label,answers,{location:'São Paulo, Brasil'}),'Sim');
  assert.equal(resolveAnswer(label,answers,{location:'Barueri, São Paulo, Brasil'}),'Sim');
  assert.equal(resolveAnswer(label,answers,{location:'Belo Horizonte, Brasil'}),null);
  assert.equal(resolveAnswer(label,{...answers,application_defaults:{}},{location:'São Paulo, Brasil'}),null);
  assert.equal(resolveAnswer('Você aceita mudar de cidade e trabalhar presencialmente?',answers,{location:'São Paulo, Brasil'}),null);
});
test('dois anos para ferramentas e analise estatistica confirmadas, sem extrapolar desconhecidos',()=>{
  for(const tool of ['Microsoft Excel','SQL','Python','Power BI','DAX','Power Query','PostgreSQL','MySQL','GitHub','ETL','APIs','Looker Studio','Análise de dados estatísticos'])
    assert.equal(resolveAnswer(`Há quantos anos você já usa ${tool} no trabalho?`,answers),'2',tool);
  assert.equal(resolveAnswer('How many years of statistical data analysis experience?',answers),'2');
  assert.equal(resolveAnswer('How many years of experience with Kubernetes?',answers),null);
  assert.equal(resolveAnswer('Quantos anos de SQL e SAP?',answers),null);
});
test('Excel usa dois anos confirmados e salario exige contexto do cargo e local',()=>{
  assert.equal(resolveAnswer('Há quantos anos você já usa Microsoft Excel no trabalho?',answers),'2');
  const context={title:'Analista Business Intelligence Jr',location:'São Paulo, Brasil',description:'SQL e Power BI'};
  assert.equal(resolveAnswer('Qual sua pretensão salarial?',answers,context),'4500');
  assert.equal(resolveAnswer('Pretensão salarial anual?',answers,context),null);
  assert.equal(resolveAnswer('Pretensão salarial?',answers,{...context,description:'Contratação PJ'}),null);
  assert.equal(resolveAnswer('Pretensão salarial?',answers,{...context,title:'Engenheiro de Dados Júnior'}),null);
});
test('conhecimentos aprovados e anos por ferramenta',()=>{
  assert.equal(resolveAnswer('Possui conhecimento avançado em Power BI e Excel?',answers),'Sim');
  assert.equal(resolveAnswer('How many years of experience do you have with SQL?',answers),String(answers.profile.sql_experience_years));
  assert.equal(resolveAnswer('Conhecimento em Python?',answers),'Sim');
});
test('nao transforma conhecimento geral em qualificacao desconhecida',()=>{
  for(const label of ['Possui conhecimento em SQL e SAP?','Conhecimento avançado em Python?', 'How many years of experience with AWS?', 'Possui 5 anos de experiência com Power BI?', 'Ensino superior completo?', 'Qual sua pretensão salarial?', 'Possui certificação Power BI?', 'Não possui experiência com Excel?'])
    assert.equal(resolveAnswer(label,answers),null,label);
});
test('opcoes bilingues exigem correspondencia unica e exata',()=>{
  assert.equal(matchOption('Sim',[{label:'Yes',value:'1'},{label:'No',value:'2'}]).value,'1');
  assert.equal(matchOption('Sim',[{label:'Yes, expert',value:'1'}]),null);
  assert.equal(matchOption('Sim',[{label:'Yes',value:'1'},{label:'Sim',value:'2'}]),null);
});
