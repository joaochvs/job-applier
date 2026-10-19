// Executada no DOM renderizado: evita depender de classes ofuscadas do LinkedIn.
function readJobDOM() {
  const main=document.querySelector('main,[role=main]');
  const root=main||document;
  const clean=s=>String(s||'').replace(/\s+/g,' ').trim();
  const visible=e=>!!e && e.getClientRects().length>0;
  const parts=document.title.split('|').map(clean);
  const title=[...root.querySelectorAll('h1')].find(visible)?.innerText?.trim() || (parts.length>=3?parts[0]:'');
  const company=[...root.querySelectorAll('a[href*="/company/"]')].find(e=>visible(e)&&clean(e.innerText))?.innerText?.trim() || (parts.length>=3?parts[1]:'');
  const lines=(main?.innerText||'').split('\n').map(clean).filter(Boolean);
  const titleIndex=lines.findIndex(x=>x.toLowerCase()===title.toLowerCase());
  const location=titleIndex>=0?(lines[titleIndex+1]||'').split('·')[0].trim():'';
  const top=lines.slice(0,Math.min(lines.length,18)).join('\n');
  let description='',source='';
  const heading=[...root.querySelectorAll('h2,h3,[role=heading]')].find(e=>visible(e)&&/^(sobre a vaga|about the job)$/i.test(clean(e.innerText)));
  if(heading){
    // Colete somente os irmãos da seção, sem a próxima seção de empresa/recomendações.
    let node=heading;
    for(let depth=0;node&&node!==main&&depth<7;depth++,node=node.parentElement){
      const headings=[...node.querySelectorAll('h2,h3,[role=heading]')];
      const text=(node.innerText||'').trim();
      if(text.length>120&&headings.length===1&&headings[0]===heading){
        description=text.replace(/^\s*(Sobre a vaga|About the job)\s*/i,'').trim();
        source='about-heading';break;
      }
    }
  }
  if(!description){
    const candidates=[...root.querySelectorAll('.jobs-description__content,.jobs-box__html-content,.show-more-less-html__markup,.description__text')];
    const el=candidates.find(e=>visible(e)&&(e.innerText||'').trim().length>=100);
    if(el){description=el.innerText.trim();source='legacy-description';}
  }
  const bodyText=(document.body?.innerText||'').slice(0,4000);
  const blocked=/\/(login|authwall|checkpoint)/.test(locationHref()) || !!document.querySelector('iframe[src*="captcha"],iframe[src*="challenge"]');
  const expired=/nao aceita mais candidaturas|não aceita mais candidaturas|no longer accepting applications|vaga nao esta mais disponivel|vaga não está mais disponível/i.test(bodyText);
  return {title:clean(title),company:clean(company),location,description:description.slice(0,18000),source,
    model:/\b(remoto|remote)\b/i.test(top)?'Remoto':/h[ií]brid|hybrid/i.test(top)?'Híbrido':/presencial|on.site/i.test(top)?'Presencial':'A confirmar',
    blocked,expired,url:locationHref()};
  function locationHref(){return window.location.href;}
}
async function readJobPage(page,{timeout=30000,stopped=()=>false}={}) {
  const deadline=Date.now()+timeout;
  let data;
  do{
    if(stopped())throw new Error('Leitura interrompida.');
    data=await page.evaluate(readJobDOM);
    if(data.blocked||data.expired||data.description.length>=100)return data;
    await page.waitForTimeout(500);
  }while(Date.now()<deadline);
  const error=new Error('A seção Sobre a vaga não foi identificada após aguardar o carregamento.');
  error.pageData=data;throw error;
}
module.exports={readJobDOM,readJobPage};
