// Respostas factuais: desconhecido nunca equivale a "Sim".
const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const {compatibleLocation} = require('./matching');
const skillPatterns = {
  power_bi: /\bpower bi\b/, excel: /\bexcel\b/, sql: /\bsql\b/, powerpoint: /\bpower\s?point\b/,
  python: /\bpython\b/, dax: /\bdax\b/, power_query: /\bpower query\b/,
  postgresql: /\bpostgres(?:ql)?\b/, mysql: /\bmysql\b/,
  dashboards: /\bdashboards?\b/, etl: /\betl\b/, apis: /\bapis?\b/,
  data_modeling: /modelagem de dados|data modeling/,
  kpis: /\bkpis?\b|indicadores/, git_github: /\bgit(?:hub)?\b/,
  looker_studio: /looker studio/,
  statistical_analysis: /analise de dados estatisticos|analise estatistica|statistical (?:data )?analysis/,
};
function durationUnit(label){
  const q=normalize(label);
  if(/quantos meses|how many months|months of.*experience|meses de experiencia/.test(q))return 'months';
  if(/quantos anos|how many years|years of.*experience|anos de experiencia/.test(q))return 'years';
  return null;
}
function resolveAnswer(label, answers, context={}) {
  const q = normalize(label), p = answers.profile;
  const unit=durationUnit(label);
  if (!q) return null;
  const saved=(answers.custom_answers||[]).filter(a=>normalize(a.question)===q && (a.job_id===String(context.jobId)||a.job_id===null));
  const specific=saved.find(a=>a.job_id===String(context.jobId))||saved.find(a=>a.job_id===null);
  if(specific && typeof specific.answer==='string')return unit&&!/^\d+(?:[.,]\d+)?$/.test(specific.answer.trim())?null:specific.answer;
  if(/pretensao|salary expectation|expected salary|desired salary/.test(q)){
    const title=normalize(context.title),location=normalize(context.location),description=normalize(context.description);
    const salary=answers.application_defaults?.salary_expectation;
    if(salary&&/analista.*(dados|\bbi\b)|business intelligence|data analyst/.test(title)&&/^sao paulo(?:,|$)/.test(location)
       &&!/\bpj\b|pessoa juridica|contractor/.test(description+' '+q)&&!/anual|annual|hour|hora|usd|dolar|year|por ano/.test(q))return String(salary.monthly_brl);
    return null;
  }
  if (/salary|salari|remuneracao|pretensao|certifica|visa|visto|deficien|disabil|genero|gender|criminal|autorizacao|authorization/.test(q)) return null;
  if (/conclu|completed|graduated|diploma|superior completo|bachelor/.test(q)) return null;
  if (/mudar de cidade|mudanca de cidade|relocat|viagen|viajar/.test(q)) return null;
  if (/^(?:voce )?aceita trabalhar presencialmente\s*[?* .]*$/.test(q)) {
    const onsite=answers.application_defaults?.onsite_sao_paulo_region;
    return typeof onsite==='boolean' && compatibleLocation(context.location,'Presencial') ? (onsite?'Sim':'Não') : null;
  }
  // Os dois anos foram confirmados somente para conhecimentos já cadastrados.
  // Avaliar isso antes dos campos de contato evita responder uma URL para anos de GitHub.
  if (unit) {
    if (/\d|nao possui|nao tem|without|lack|sap|tableau|salesforce|azure|aws|spark|databricks/.test(q)) return null;
    // Aceitar somente a pergunta geral: um complemento sobre ferramenta ou
    // especialidade desconhecida precisa continuar pendente.
    const generalDataYears = /^(?:ha )?quantos anos (?:voce )?(?:ja )?(?:trabalha com|atua com|atua em|tem (?:de )?experiencia (?:com|em)|de experiencia (?:com|em)) analise de dados(?: no trabalho)?\s*[?* .]*$/;
    if (generalDataYears.test(q)) return p.total_data_experience_years == null ? null : String(p.total_data_experience_years);
    const keys=Object.entries(skillPatterns).filter(([,pattern])=>pattern.test(q)).map(([key])=>key);
    if(!keys.length||!keys.every(key=>answers.skills[key]?.automatic&&answers.skills[key].answer==='Sim'))return null;
    const years=keys.map(key=>p[`${key}_experience_years`]??answers.skills[key].experience_years);
    return years.every(y=>y!=null&&y===years[0])?String(years[0]*(unit==='months'?12:1)):null;
  }
  if (/nome completo|full name/.test(q)) return p.full_name;
  if (/sobrenome|last name|surname/.test(q)) return p.full_name.split(' ').slice(1).join(' ');
  if (/^(nome|first name|given name)\b/.test(q)) return p.full_name.split(' ')[0];
  if (/pais.*telefone|country.*phone|phone.*country|codigo.*pais/.test(q)) return p.phone_country;
  if (/telefone|celular|phone|mobile/.test(q)) return p.phone;
  if (/e-?mail/.test(q)) return p.email;
  if (/cidade|city|localizacao atual|current location/.test(q)) return p.city;
  if (/linkedin/.test(q)) return p.linkedin;
  if (/github|portfolio|portifolio/.test(q)) return p.github;
  if (/nivel de ingles|english level|english proficiency/.test(q)) return p.english_level;
  if (/empresa atual|current company/.test(q)) return p.current_company;
  if (/cargo atual|current (job )?title/.test(q)) return p.current_title;
  if (/quanto tempo|how long|tempo de experiencia/.test(q)) return null;
  if (/\d|nao possui|nao tem|without|lack|sap|tableau|salesforce|azure|aws|spark|databricks|fluente|fluent/.test(q)) return null;
  // Perguntas com limiares, negação ou tecnologias adicionais ficam pendentes.
  const skills = Object.entries(skillPatterns).filter(([, pattern]) => pattern.test(q)).map(([key]) => key);
  if (skills.length && /experien|conhec|dominio|proficien|habilidade|possui|utiliza|trabalh|familiar|have|know|skilled/.test(q)) {
    if (/avancad|advanced|expert|especialista/.test(q)) {
      if (!skills.every(k => ['power_bi', 'excel'].includes(k)) || !answers.skills.advanced_power_bi_and_excel?.automatic) return null;
    }
    if (skills.every(k => answers.skills[k]?.automatic && answers.skills[k].answer === 'Sim')) return 'Sim';
  }
  return null;
}
function matchOption(answer, options) {
  const aliases = {sim: ['sim', 'yes'], nao: ['nao', 'no'], intermediario: ['intermediario', 'intermediate']};
  const wanted = aliases[normalize(answer)] || [normalize(answer)];
  const matches = options.filter(o => wanted.includes(normalize(o.label)) || wanted.includes(normalize(o.value)));
  return matches.length === 1 ? matches[0] : null;
}
module.exports = {resolveAnswer, matchOption, normalize,durationUnit};
