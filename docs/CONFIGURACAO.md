# Configuração

## Instalação e arquivos privados

`python setup.py` cria `data/profile.json`, `data/jobs.csv` e `job-applier-app/automation.json`. É idempotente: preserva arquivos existentes e não abre navegador. O comando `--resume` copia um PDF apenas quando ainda não há currículo. `--check` verifica arquivos e contatos básicos; não certifica a veracidade nem a completude profissional do perfil.

O currículo deve estar em `data/resume.pdf`. O perfil deve respeitar o esquema do arquivo `examples/profile.example.json`, efetivamente usado pelo setup. Um perfil novo não contém experiências nem preferências afirmativas inventadas.

## Perfil e respostas

Em `profile`, preencha nome, e-mail, telefone sem formatação, cidade, estado, país, URLs, cargo e empresa atuais, formação e idioma. Campos desconhecidos devem ficar `null`. O campo `education_completed` não é inferido apenas da previsão de conclusão.

Competências vão em `skills`. Exemplo **fictício**, a ser substituído apenas por informação confirmada:

```json
{
  "sql": {
    "answer": "Sim",
    "automatic": true,
    "experience_years": 3,
    "evidence": "Tempo de uso profissional informado pelo candidato"
  }
}
```

Chaves reconhecidas: `power_bi`, `powerpoint`, `excel`, `sql`, `python`, `dax`, `power_query`, `postgresql`, `mysql`, `dashboards`, `etl`, `apis`, `data_modeling`, `kpis`, `git_github`, `looker_studio` e `statistical_analysis`. `advanced_power_bi_and_excel` habilita a declaração específica de nível avançado nessas duas ferramentas. Não use essa chave para outras ferramentas.

`profile.total_data_experience_years` responde às perguntas gerais reconhecidas sobre experiência em análise de dados. Para ferramentas, o resolvedor consulta primeiro `profile.<chave>_experience_years`, quando existir, e depois `skills.<chave>.experience_years`. Não há preenchimento automático de experiência para uma ferramenta desconhecida. Perguntas com limiar, negação ou outras condições podem ficar pendentes mesmo contendo uma ferramenta conhecida.

`application_defaults` admite salário mensal em `salary_expectation.monthly_brl` e aceite presencial em `onsite_sao_paulo_region`. Deixe ausentes quando não confirmados. A regra salarial atual só cobre Dados/BI em São Paulo, sem indicação de PJ, contractor, valor anual, por hora ou moeda estrangeira; não generaliza para Engenharia. O aceite presencial é limitado à região reconhecida pelo app. Veja os critérios exatos em `answers.js`.

`custom_answers` é mantido pelo modal, com pergunta original, resposta, `job_id`, origem e data. `job_id: null` permite reutilização em perguntas iguais; um ID restringe à vaga. A comparação normaliza acentos, caixa e espaços, mas não faz similaridade semântica. Uma resposta específica da vaga tem prioridade. Respostas restritas ao emprego não são transformadas em preferências globais pelo modal.

Para corrigir ou remover uma resposta aprendida já salva, feche o aplicativo e edite `data/profile.json`. O painel exibe as respostas, mas não tem um editor completo delas nesta versão.

## Busca e agenda

`job-applier-app/automation.json` é local e ignorado pelo Git. Exemplo instalado:

```json
{
  "enabled": false,
  "hour": 11,
  "minute": 0,
  "timezone": "America/Sao_Paulo",
  "max_applications": 10,
  "min_score": 75,
  "platform": "LinkedIn Simplificada",
  "search": {"hours": 24, "max_candidates": 40, "pages_per_query": 1}
}
```

`enabled` controla a agenda, não bloqueia os botões manuais de envio. `max_applications` limita o lote. `search.hours` define a janela e `max_candidates` limita as descrições analisadas. `pages_per_query` vai de 1 a 3. `search.queries` opcional substitui os termos padrão.

Localização e famílias de senioridade ainda têm regras fixas em `matching.js`: São Paulo e região ou remoto no Brasil; Dados/BI júnior e pleno, Engenharia de Dados júnior e automação compatível. O campo `timezone` documenta São Paulo; o coordenador usa UTC−03:00 fixo, não um conversor genérico de fusos.

## Variáveis de ambiente

| Variável | Padrão / efeito |
|---|---|
| `JOB_APPLIER_DATA_DIR` | Caminho absoluto opcional para a pasta privada que contém `profile.json`, `resume.pdf`, `jobs.csv` e `browser-profile/` |
| `JOB_APPLIER_PORT` | Porta do painel, padrão `8765` |
| `JOB_APPLIER_BROWSER` | Caminho absoluto do executável Chrome/Edge |
| `JOB_APPLIER_BROWSER_PORT` | Porta CDP local do navegador, padrão `9333` |
| `JOB_APPLIER_NODE` | Caminho opcional do executável Node usado pelo servidor Python |

Exemplo PowerShell: `$env:JOB_APPLIER_BROWSER = 'C:\Program Files\Google\Chrome\Application\chrome.exe'`.

Defina variáveis antes de abrir o app. Execute uma instalação por vez; mudar apenas a pasta de dados não isola `runtime/`, agenda e fila da aplicação. Para outra pessoa, use outra clonagem e sessões próprias. A separação multiusuário ainda está planejada.
