const $=s=>document.querySelector(s);
const $$=s=>[...document.querySelectorAll(s)];
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const safeUrl=s=>{try{const u=new URL(s);return ['http:','https:'].includes(u.protocol)?u.href:'#'}catch{return '#'}};
const time=s=>s?new Date(s).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'}):'—';
let jobs=[],snapshot={},jobFilter='',auditFilter='all',pollTimer,flight,actionPending=false,lastAudit='',lastEvents='',lastJobs='',runs=[],awaitingImport=false;
let lastPending='';const pendingDrafts=new Map(),pendingRevisions=new Map();
function scopedQuestion(q){return /salari|salary|remunera|pretensao|presencial|onsite|on.site|hibrid|hybrid|relocat|mudanca|disponib|availability|aceita|accept|viage|viajar|interess|interested/.test(String(q).normalize('NFD').replace(/[\u0300-\u036f]/g,'' ).toLowerCase())}
function renderPendingAnswers(){
  const list=jobs.filter(j=>j.retryable&&j.pending_fields?.some(f=>['text','number','choice'].includes(f.type)));
  const signature=JSON.stringify(list.map(j=>[j.id,j.pending_fields,j.pending_revision,j.resume_queued]));if(signature===lastPending)return;lastPending=signature;
  const panel=$('#pending-answers'),modal=$('#answers-modal');$('#pending-notice').classList.toggle('hidden',!list.length);
  if(!list.length){modal.close();panel.innerHTML='';return;}
  let newQuestions=false;
  for(const j of list){const revision=JSON.stringify([j.pending_fields,j.pending_revision]);if(pendingRevisions.get(j.id)!==revision){newQuestions=true;pendingRevisions.set(j.id,revision);for(const f of j.pending_fields)if(f.error)pendingDrafts.delete(j.id+'|'+f.question);}}
  panel.innerHTML=`<p class="eyebrow">PRECISO DA SUA RESPOSTA</p><h2 id="pending-title">Complete as informações e continue</h2><p class="muted">A candidatura fica pendente até você responder. Ao salvar, ela volta para a fila e continua automaticamente quando o navegador estiver livre.</p>${list.map(j=>`<form class="answer-form" data-job="${esc(j.id)}"><h3>${esc(j.cargo)}</h3><p class="meta">${esc(j.empresa)} · ${esc(j.localizacao)}</p>${j.pending_fields.filter(f=>['text','number','choice'].includes(f.type)).map((f,i)=>{
    const draft=pendingDrafts.get(j.id+'|'+f.question)||{},id=`answer-${j.id}-${i}`;
    return `<div class="answer-field" data-question="${esc(f.question)}"><label for="${id}">${esc(f.question)}</label>${f.error?`<div class="validation-note"><strong>Corrija esta resposta</strong><p>Resposta anterior: ${esc(f.previous_answer||'(vazia)')}</p><p>${esc(f.error)}</p></div>`:''}${f.type==='choice'?`<select id="${id}" name="answer" required><option value="">Selecione uma opção</option>${f.options.map(o=>`<option value="${esc(o)}" ${draft.answer===o?'selected':''}>${esc(o)}</option>`).join('')}</select>`:`<input id="${id}" name="answer" type="${f.type==='number'?'number':'text'}" ${f.type==='number'?'step="any"':''} maxlength="${f.max_length||4000}" value="${esc(draft.answer||'')}" required>`}${scopedQuestion(f.question)?'<small>Resposta válida somente para esta vaga.</small>':`<label class="remember-answer"><input type="checkbox" name="remember" ${draft.remember?'checked':''}> Lembrar para perguntas iguais nas próximas vagas deste perfil</label>`}</div>`;
  }).join('')}${j.pending_fields.some(f=>f.type==='manual_review')?'<p class="muted">Há também uma pendência que exige revisão no LinkedIn. Ela será conferida novamente na retomada.</p>':''}<p class="answer-feedback" role="status">${j.resume_queued?'Respostas salvas. Aguardando o navegador ficar livre…':''}</p><button class="btn primary" type="submit" ${j.resume_queued?'disabled':''}>${j.resume_queued?'Na fila para continuar':'Salvar e continuar'}</button></form>`).join('')}`;
  if(newQuestions&&!modal.open&&!$('#modal').open)modal.showModal();
}
async function api(path,options={}){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);
  try{const r=await fetch(path,{cache:'no-store',headers:{'Content-Type':'application/json'},...options,signal:controller.signal});
    const d=await r.json();if(!r.ok)throw Error(d.error||`Falha ${r.status}. Reinicie o aplicativo se ele acabou de ser atualizado.`);return d;
  }catch(e){if(e.name==='AbortError')throw Error('O aplicativo demorou para responder. Tente atualizar novamente.');throw e}finally{clearTimeout(timer)}
}
let toastTimer;
function toast(text){clearTimeout(toastTimer);$('#toast').textContent=text;$('#toast').classList.add('show');toastTimer=setTimeout(()=>$('#toast').classList.remove('show'),4000)}
function empty(title,text=''){return `<div class="empty"><strong>${esc(title)}</strong>${esc(text)}</div>`}
function badge(status){return ({submitted:['Enviada','success'],already_applied:['Já enviada','success'],needs_input:['Pendente','warning'],needs_login:['Login necessário','warning'],submit_uncertain:['Envio incerto','error'],error:['Falha','error'],starting:['Em andamento','working'],cancelled:['Interrompida','neutral'],completed:['Concluída','success'],stopped:['Interrompida','neutral'],Enviada:['Enviada','success'],'Aguardando aprovação':['Pendente','warning']})[status]||[status||'Nova','neutral']}
function renderSummary(s){$('#summary').innerHTML=[['Vagas registradas',s.total,'Acumulado no histórico'],['Candidatura rápida',s.easy_apply,'Vagas registradas com envio fácil'],['Pendentes',s.ready,'Precisam de informação ou revisão'],['Enviadas',s.sent,'Acumulado no histórico']].map(([label,value,detail])=>`<article class="metric"><span>${label}</span><strong>${value||0}</strong><small>${detail}</small></article>`).join('')}
function renderJobs(force=false){
  const q=$('#search').value.toLowerCase();
  const list=jobs.filter(j=>(!jobFilter||j.status===jobFilter)&&`${j.cargo} ${j.empresa}`.toLowerCase().includes(q));
  const signature=JSON.stringify(list)+jobFilter+q;if(!force&&signature===lastJobs)return;lastJobs=signature;
  $('#jobs').innerHTML=list.length?list.map(j=>{
    const [label,color]=badge(j.status),eligible=j.retryable||j.tipo_candidatura==='LinkedIn Simplificada'&&j.nota>=75&&!j.lacunas&&!['Enviada','Entrevista','Recusada','Encerrada','Descartada','Aguardando aprovação'].includes(j.status);
    return `<article class="job"><div class="job-score">${j.nota}</div><div><h3>${esc(j.cargo)}</h3><p class="meta">${esc(j.empresa)} · ${esc(j.localizacao)} · ${esc(j.modelo)}</p><div>${String(j.competencias_correspondentes||'').split(';').filter(Boolean).slice(0,5).map(x=>`<span class="chip">${esc(x.trim())}</span>`).join(' ')}</div>${j.status==='Aguardando aprovação'&&(j.pending_questions?.length||j.worker_message)?`<p class="meta">Pendência: ${esc(j.pending_questions?.join('; ')||j.worker_message)}</p>`:''}${j.candidatura_em?`<p class="meta">Envio registrado em ${esc(j.candidatura_em)}</p>`:''}<div class="job-actions">${eligible?`<button class="btn secondary apply-job" data-id="${esc(j.id)}">${j.retryable?'Retomar preenchimento':'Preencher e enviar'}</button>`:''}<a class="btn secondary" href="${esc(safeUrl(j.url))}" target="_blank" rel="noreferrer">Ver vaga ↗</a></div></div><span class="badge ${color}">${esc(label)}</span></article>`;
  }).join(''):empty('Nenhuma vaga neste filtro','As vagas analisadas aparecem acima. As registradas e enviadas ficam neste histórico.');
  $$('.apply-job').forEach(b=>{b.disabled=!!snapshot.run?.active||!!snapshot.search_active||actionPending});
}
function renderAudit(force=false){
  const audit=snapshot.audit||[];$('#audit-count').textContent=`${audit.length} analisadas`;
  const signature=JSON.stringify(audit)+auditFilter;if(!force&&signature===lastAudit)return;lastAudit=signature;
  const open=new Set($$('#audit-list details[open]').map(x=>x.dataset.id));
  const list=audit.filter(j=>auditFilter==='all'||j.status===auditFilter);
  $('#audit-list').innerHTML=list.length?list.map(j=>`<details class="audit-row" data-id="${esc(j.id)}" ${open.has(j.id)?'open':''}><summary><div><strong>${esc(j.title)}</strong><small>${esc(j.company||'Empresa não identificada')} ${j.location?'· '+esc(j.location):''}</small><small>${j.status==='eligible'?'✓ Compatível':'Não selecionada'}</small></div><span class="score-label">${j.score!=null?esc(j.score)+'/100':'—'}</span></summary><p>${esc(j.reason)}</p>${j.breakdown?.length?'<div class="breakdown">'+j.breakdown.map(x=>`<span class="chip">${esc(x.label)} +${x.points}</span>`).join('')+'</div>':''}<a href="${esc(safeUrl(j.url))}" target="_blank" rel="noreferrer">Abrir vaga ↗</a></details>`).join(''):empty('Aguardando oportunidades','As análises aparecerão aqui conforme cada descrição for lida.');
}
function renderEvents(){
  const events=snapshot.events||[],signature=JSON.stringify(events);if(signature===lastEvents)return;lastEvents=signature;
  const feed=$('#activity-feed'),atBottom=feed.scrollHeight-feed.scrollTop-feed.clientHeight<55;
  feed.innerHTML=events.length?events.map(e=>{
    const color=['submitted','eligible','completed','search_done'].includes(e.stage)?'good':['error','submit_uncertain'].includes(e.stage)?'bad':['rejected','needs_input','needs_login','stopped'].includes(e.stage)?'warn':'';
    return `<div class="event ${color}"><time>${time(e.at)}</time><span class="dot"></span><div><p>${esc(e.message)}</p>${e.step?`<small>Etapa ${esc(e.step)} do formulário</small>`:''}</div></div>`;
  }).join(''):empty('Tudo pronto','Ao iniciar, você verá consultas, análises e resultados de envio.');
  if(atBottom)feed.scrollTop=feed.scrollHeight;
}
function renderExecution(){
  const run=snapshot.run||{},search=snapshot.search||{},searchOnly=snapshot.session?.mode==='search';
  const active=!!run.active||!!snapshot.search_active;
  const state=searchOnly?search.status:run.status;
  let phase='search',label='Pronto para começar',detail='Inicie uma busca para acompanhar cada etapa.',progressLabel='Nenhuma execução em andamento',value=null;
  const apps=searchOnly?[]:run.applications||[],sent=apps.filter(x=>x.status==='submitted').length,pending=apps.filter(x=>!['starting','submitted','already_applied'].includes(x.status)).length;
  if(active){
    if(run.phase==='applying'&&!searchOnly){
      phase='apply';const current=apps.find(x=>x.status==='starting');label='Preenchendo e enviando candidaturas';
      detail=current?`${current.title} · ${current.company}${snapshot.worker?.step?' · Etapa '+snapshot.worker.step+' do formulário':''}`:'Preparando a próxima candidatura…';
      const completed=apps.filter(x=>x.status!=='starting').length,total=run.selected||0;progressLabel=`${completed} de ${total} candidaturas processadas · ${sent} enviadas · ${pending} pendentes`;value=total?100*completed/total:null;
    }else if(search.status==='evaluating'){
      phase='evaluate';label='Analisando as oportunidades';detail=search.title||'Lendo requisitos e comparando com seu perfil.';
      progressLabel=`Vaga ${search.current||0} de ${search.total||0} · ${search.accepted||0} compatíveis`;value=search.total?100*(search.current-1)/search.total:null;
    }else{
      label='Buscando novas vagas';detail=search.query?`${search.query} · ${search.scope||'LinkedIn'}`:'Conectando ao navegador e iniciando as consultas…';progressLabel=`Consulta ${search.current||0} de ${search.total||'…'} · ${search.found||0} links encontrados`;value=search.total?100*(search.current-1)/search.total:null;
    }
  }else if(['completed','stopped','error','needs_login'].includes(state)){
    phase='finish';label=state==='completed'?(searchOnly?'Busca concluída':'Execução concluída'):state==='stopped'?'Execução interrompida':state==='needs_login'?'Faça login no LinkedIn':'Execução precisa de atenção';
    const analyzed=searchOnly?(search.evaluated??snapshot.audit?.length??0):(run.evaluated??0),compatible=searchOnly?(search.eligible||0):(run.eligible??run.selected??0);
    detail=(searchOnly?search.message:run.message)||`${analyzed} analisadas · ${compatible} compatíveis · ${sent} enviadas · ${pending} pendentes`;
    progressLabel=state==='completed'?'Processamento finalizado':state==='stopped'?'Interrupção concluída':'Confira a atividade e as pendências abaixo';value=state==='completed'?100:0;
  }
  $('#automatic-status').textContent=label;$('#automatic-detail').textContent=detail;$('#progress-label').textContent=progressLabel;
  const statusBadge=active?['Em andamento','working']:badge(state==='idle'?'Aguardando':state);$('#run-badge').textContent=statusBadge[0];$('#run-badge').className='badge '+statusBadge[1];
  const stageIndex=['search','evaluate','apply','finish'].indexOf(phase);$$('#steps li').forEach((e,i)=>{e.classList.toggle('active',active&&i===stageIndex);e.classList.toggle('done',i<stageIndex&&(active||state==='completed'))});
  $('#progress').classList.toggle('indeterminate',active&&value===null);$('#progress-fill').style.width=`${Math.max(0,Math.min(100,value||0))}%`;$('#progress-value').textContent=value===null?'':Math.round(value)+'% da etapa';
  if(value===null)$('#progress').removeAttribute('aria-valuenow');else $('#progress').setAttribute('aria-valuenow',String(Math.round(value)));
  $('#live-indicator').classList.toggle('running',active);$('#live-indicator').innerHTML=`<span class="dot"></span> ${active?'Ao vivo':'Em espera'}`;
  const retryCount=jobs.filter(j=>j.retryable).length;$('#retry-pending').disabled=active||actionPending||!retryCount;if(!$('#retry-pending').classList.contains('busy'))$('#retry-pending').textContent=`Retomar pendentes (${retryCount})`;
  $('#run-automatic').disabled=active||actionPending;$('#find-jobs').disabled=active||actionPending;$('#stop-automatic').hidden=!active;
  const config=snapshot.config||{},schedule=config.enabled?`Agenda diária ativa: ${String(config.hour).padStart(2,'0')}:${String(config.minute).padStart(2,'0')} · São Paulo. Abrir após esse horário pode iniciar o lote pendente.`:'Agenda diária desativada · Execução pelos botões do painel.';
  $('#schedule-label').textContent=schedule;
  $('#search-policy').textContent=`São Paulo e região · Remoto no Brasil · Últimas ${config.search?.hours||24}h · Até ${config.search?.max_candidates||40} análises`;
  $$('.apply-job').forEach(b=>b.disabled=active||actionPending);
}
async function refresh(){
  if(flight)return flight;
  flight=(async()=>{
    const [live,j,s]=await Promise.all([api('/api/live'),api('/api/jobs'),api('/api/summary')]);snapshot=live;jobs=j.jobs;renderSummary(s);renderJobs();renderPendingAnswers();renderExecution();renderAudit();renderEvents();
    $('#connection-dot').className='dot green';$('#connection-label').textContent='Conectado';$('#last-update').textContent='Atualizado às '+time(live.updated_at);$('#error-banner').classList.add('hidden');
    if(awaitingImport&&!live.search_active&&live.search?.status==='completed'){
      awaitingImport=false;await api('/api/search/import',{method:'POST',body:'{}'});toast('Busca concluída. Vagas compatíveis adicionadas ao histórico.');
    }
  })();
  try{return await flight}catch(e){$('#connection-dot').className='dot';$('#connection-label').textContent='Sem atualização';$('#error-banner').textContent='Não foi possível atualizar: '+e.message;$('#error-banner').classList.remove('hidden');throw e}finally{flight=null}
}
async function poll(){try{await refresh()}catch{}finally{pollTimer=setTimeout(poll,2000)}}
async function busy(button,label,fn){const original=button.innerHTML;button.disabled=true;button.classList.add('busy');button.textContent=label;try{return await fn()}catch(e){toast(e.message)}finally{button.innerHTML=original;button.classList.remove('busy');button.disabled=false;renderExecution()}}
async function start(path,button,label){await busy(button,label,async()=>{actionPending=true;try{await api(path,{method:'POST',body:'{}'});if(path==='/api/search/start')awaitingImport=true;toast(path.includes('/jobs/')?'Candidatura iniciada. Acompanhe a atividade.':'Execução iniciada. Acompanhe o progresso abaixo.');await refresh()}finally{actionPending=false}})}
async function loadProfile(){const d=await api('/api/profile');const names={full_name:'Nome',email:'E-mail',phone:'Telefone',city:'Cidade',current_title:'Cargo atual',current_company:'Empresa atual',english_level:'Inglês',highest_education:'Formação',institution:'Instituição',education_end_year:'Previsão de conclusão',total_data_experience_years:'Experiência em dados (anos)'};
  $('#profile').innerHTML=`<section class="card"><p class="eyebrow">DADOS CADASTRADOS</p><h2>Perfil profissional</h2><div class="profile-grid">${Object.entries(names).filter(([k])=>d.profile[k]!=null).map(([k,label])=>`<div class="field"><small>${label}</small>${esc(d.profile[k])}</div>`).join('')}</div></section><section class="card"><h2>Conhecimentos e respostas</h2>${Object.entries(d.skills).map(([k,v])=>`<div class="skill"><span>${esc(k.replaceAll('_',' '))}</span><span class="badge ${v.automatic?'success':'neutral'}">${esc(v.answer||'Pendente')}${v.experience_years!=null?' · '+esc(v.experience_years)+' anos':''}</span></div>`).join('')}</section>`;
  $('#profile').insertAdjacentHTML('beforeend',`<section class="card"><h2>Respostas informadas no painel</h2>${(d.learned_answers||[]).length?d.learned_answers.map(a=>`<div class="field"><small>${a.job_id?'Somente vaga '+esc(a.job_id):'Perguntas iguais nas próximas vagas deste perfil'}</small><strong>${esc(a.question)}</strong><p>${esc(a.answer)}</p></div>`).join(''):empty('Nenhuma resposta adicional salva','Quando surgir uma pergunta nova, responda na visão geral.')}</section>`);
}
async function loadHistory(){const d=await api('/api/runs');runs=d.runs;$('#history-list').innerHTML=runs.length?runs.map((r,i)=>{const [label,color]=badge(r.status),apps=r.applications||[];return `<article class="run-row"><div><strong>${esc(r.date||r.file)}</strong> <span class="badge ${color}">${esc(label)}</span><p>${r.evaluated??r.found??0} analisadas · ${apps.filter(x=>x.status==='submitted').length} envios confirmados · ${apps.filter(x=>!['submitted','already_applied','starting'].includes(x.status)).length} pendências</p></div><button class="btn secondary run-detail" data-index="${i}">Ver execução</button></article>`}).join(''):empty('Nenhuma execução salva');}
$('#refresh').onclick=()=>busy($('#refresh'),'Atualizando…',async()=>{await refresh();if(!$('#history-view').classList.contains('hidden'))await loadHistory();toast('Painel atualizado. Se nada mudou, não houve novos registros.');});
$('#retry-pending').onclick=()=>start('/api/automatic/retry',$('#retry-pending'),'Retomando…');
$('#run-automatic').onclick=()=>start('/api/automatic/start',$('#run-automatic'),'Iniciando…');$('#find-jobs').onclick=()=>start('/api/search/start',$('#find-jobs'),'Iniciando busca…');
$('#stop-automatic').onclick=()=>busy($('#stop-automatic'),'Solicitando parada…',async()=>{await api('/api/automatic/stop',{method:'POST',body:'{}'});toast('Interrupção solicitada. Um envio já acionado pode terminar.');});
$('#search').oninput=()=>renderJobs(true);
$('#jobs').onclick=e=>{const b=e.target.closest('.apply-job');if(b)start(`/api/jobs/${encodeURIComponent(b.dataset.id)}/apply`,b,'Iniciando…')};
$('#job-filters').onclick=e=>{const b=e.target.closest('[data-status]');if(!b)return;jobFilter=b.dataset.status;$$('#job-filters .filter').forEach(x=>x.classList.toggle('active',x===b));renderJobs(true)};
$('#audit-filters').onclick=e=>{const b=e.target.closest('[data-audit]');if(!b)return;auditFilter=b.dataset.audit;$$('#audit-filters .filter').forEach(x=>x.classList.toggle('active',x===b));renderAudit(true)};
$$('.nav').forEach(b=>b.onclick=async()=>{const view=b.dataset.view;$$('.nav').forEach(x=>x.classList.toggle('active',x===b));['jobs','history','profile'].forEach(x=>$('#'+x+'-view').classList.toggle('hidden',x!==view));try{if(view==='profile')await loadProfile();if(view==='history')await loadHistory()}catch(e){toast(e.message)}});
$('#history-list').onclick=e=>{const b=e.target.closest('.run-detail');if(!b)return;const r=runs[Number(b.dataset.index)];$('#modal-content').innerHTML=`<p class="eyebrow">EXECUÇÃO DE ${esc(r.date)}</p><h2>Resultados do lote</h2>${r.message?`<p>${esc(r.message)}</p>`:''}${(r.applications||[]).length?r.applications.map(a=>{const [label,color]=badge(a.status);return `<article class="audit-row"><strong>${esc(a.title)}</strong><p>${esc(a.company)} <span class="badge ${color}">${esc(label)}</span></p><p>${esc((a.unknown||[]).join('; ')||a.message||'')}</p><a href="${esc(safeUrl(a.url))}" target="_blank" rel="noreferrer">Ver vaga ↗</a></article>`}).join(''):empty('Nenhuma candidatura iniciada neste lote')}`;$('#modal').showModal();};
$('#modal .close').onclick=()=>$('#modal').close();
$('#close-answers').onclick=()=>$('#answers-modal').close();
$('#open-answers').onclick=()=>$('#answers-modal').showModal();poll();

$('#pending-answers').oninput=e=>{
  const form=e.target.closest('.answer-form'),field=e.target.closest('.answer-field');if(!form||!field)return;
  pendingDrafts.set(form.dataset.job+'|'+field.dataset.question,{answer:field.querySelector('[name=answer]').value,remember:!!field.querySelector('[name=remember]')?.checked});
};
$('#pending-answers').onsubmit=async e=>{
  e.preventDefault();const form=e.target.closest('.answer-form');if(!form)return;
  const button=form.querySelector('button'),feedback=form.querySelector('.answer-feedback');button.disabled=true;button.textContent='Salvando…';
  try{
    const answers=[...form.querySelectorAll('.answer-field')].map(f=>({question:f.dataset.question,answer:f.querySelector('[name=answer]').value,remember:!!f.querySelector('[name=remember]')?.checked}));
    await api(`/api/jobs/${encodeURIComponent(form.dataset.job)}/answers`,{method:'POST',body:JSON.stringify({answers})});
    feedback.textContent='Respostas salvas. A candidatura continuará automaticamente.';button.textContent='Na fila para continuar';toast('Respostas salvas. Candidatura na fila para continuar.');await refresh();
  }catch(error){feedback.textContent=error.message;button.disabled=false;button.textContent='Salvar e continuar'}
};
