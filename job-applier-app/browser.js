const { chromium } = require('playwright-core');
const { spawn } = require('child_process');
const path = require('path');
const http = require('http');
const fs = require('fs');

const candidates = [
  process.env.JOB_APPLIER_BROWSER,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  path.join(process.env.LOCALAPPDATA||'', 'Google','Chrome','Application','chrome.exe'),
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
];
const chrome = candidates.find(file=>file&&fs.existsSync(file));
const {dataDir}=require('./config');
const profile=path.join(dataDir,'browser-profile');
const port=Number(process.env.JOB_APPLIER_BROWSER_PORT||9333);
if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('JOB_APPLIER_BROWSER_PORT inválida.');
const sleep = ms => new Promise(r => setTimeout(r, ms));

function endpointReady() {
  return new Promise(resolve => {
    const req=http.get(`http://127.0.0.1:${port}/json/version`,res=>{res.resume();resolve(res.statusCode===200)});
    req.on('error',()=>resolve(false)); req.setTimeout(500,()=>{req.destroy();resolve(false)});
  });
}

async function getBrowser() {
  if(!await endpointReady()) {
    if(!chrome) throw new Error('Chrome/Edge não encontrado. Configure JOB_APPLIER_BROWSER com o executável instalado.');
    const child=spawn(chrome,[`--remote-debugging-port=${port}`,`--user-data-dir=${profile}`,'--start-maximized','--no-first-run'],{detached:true,stdio:'ignore'});
    child.unref();
    for(let i=0;i<30&&!await endpointReady();i++) await sleep(300);
  }
  if(!await endpointReady()) throw new Error('Não foi possível iniciar o navegador de candidaturas. Feche as janelas antigas dele e tente novamente.');
  const browser=await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const context=browser.contexts()[0];
  if(!context) throw new Error('O navegador foi aberto, mas o perfil não ficou disponível.');
  return {browser,context};
}

module.exports={getBrowser};
