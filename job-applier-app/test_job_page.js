const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('fs');
const {chromium}=require('playwright-core');
const {readJobPage}=require('./job-page');
test('le layout sem classes antigas, aguarda descricao e exclui empresa e recomendacoes',async()=>{
  const executable=[process.env.JOB_APPLIER_BROWSER,'C:/Program Files/Google/Chrome/Application/chrome.exe','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p=>p&&fs.existsSync(p));
  const browser=await chromium.launch({executablePath:executable,headless:true});
  try{
    const page=await browser.newPage();
    await page.setContent(`<title>Analista de Dados | Empresa A | LinkedIn</title><main><section><p>Empresa A</p><p>Analista de Dados</p><p>São Paulo, São Paulo, Brasil · há 2 horas</p><p>Híbrido</p><div id="about"></div><div><h2>Sobre a empresa</h2><p>Empresa com 50 anos; gestores seniores e engenharia de software</p></div></section></main>`);
    await page.evaluate(()=>setTimeout(()=>{document.querySelector('#about').innerHTML='<div><h2>Sobre a vaga</h2></div><p>Requisitos: SQL, Power BI, Excel. Construção de dashboards e indicadores, integração de APIs e modelagem de dados para análises de negócio.</p>';},700));
    const job=await readJobPage(page,{timeout:4000});
    assert.equal(job.source,'about-heading');
    assert.equal(job.company,'Empresa A');
    assert.equal(job.title,'Analista de Dados');
    assert.equal(job.location,'São Paulo, São Paulo, Brasil');
    assert.match(job.description,/Requisitos: SQL/);
    assert.doesNotMatch(job.description,/50 anos|gestores/);
    await page.setContent('<main><h1>Analista de BI</h1><div class="jobs-description__content" style="display:none">Descrição antiga escondida.</div><div class="jobs-description__content">SQL Power BI Excel '.repeat(1)+'Desenvolver dashboards, indicadores e análises de negócio com qualidade de dados e automação em Python.</div></main>');
    assert.equal((await readJobPage(page)).source,'legacy-description');
    await page.setContent('<main><h2>Mais vagas</h2><p>SQL Python Power BI. Somente recomendações e informações promocionais; esta página não possui a descrição da vaga solicitada.</p></main>');
    await assert.rejects(readJobPage(page,{timeout:100}),/seção Sobre a vaga/);
  }finally{await browser.close()}
});
