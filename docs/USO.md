# Uso diário

## Abrir e operar

Execute `python job-applier-app/app.py` a partir da raiz, ou use `job-applier-app/start.bat`. O servidor escuta somente `127.0.0.1`. `--no-browser` evita abrir automaticamente a aba do painel. Ele precisa continuar aberto para atualizar o painel e processar a fila de retomadas.

Faça login com `node job-applier-app/login.js` ou `login.bat`. A sessão usa um perfil de navegador separado do Chrome habitual; senha, código e verificações são inseridos manualmente no LinkedIn. Nenhuma senha é configurada no JSON.

| Controle | O que faz |
|---|---|
| Atualizar painel | Recarrega os dados existentes; não procura vagas |
| Só buscar | Busca, analisa e importa vagas elegíveis para o histórico; não envia |
| Buscar e candidatar | Faz nova busca e processa os envios elegíveis do lote |
| Preencher e enviar | Processa uma vaga elegível já cadastrada |
| Retomar preenchimento | Retenta uma vaga pendente sem registro de submissão |
| Retomar pendentes | Processa pendências elegíveis, sem nova busca |
| Interromper | Solicita parada e esvazia a fila de retomadas por respostas; um envio já acionado pode terminar |
| Histórico de execuções | Mostra resultados dos lotes e motivos de pendência |
| Perfil e respostas | Exibe dados, competências e respostas aprendidas |

O app usa o navegador sequencialmente. Botões de busca/envio ficam bloqueados durante operações em andamento. O botão de retomar não ignora nota mínima, lacunas, elegibilidade ou o registro de submissão.

## Modal de perguntas

Quando falta uma resposta ou um campo é rejeitado, o modal aparece sobre o painel. Ele respeita o tipo numérico ou as alternativas lidas na vaga. Uma rejeição mostra o valor anterior e a mensagem de validação; o app pede um novo valor.

**Salvar e continuar** grava as respostas e coloca a candidatura em uma fila persistente. Ela é retomada quando o navegador fica livre. Se houver outro lote ativo, ele não é interrompido para preencher duas vagas ao mesmo tempo.

Marcar **Lembrar para perguntas iguais** permite reutilização no perfil local. Sem marcar, vale só para a vaga. Salário, disponibilidade, modalidade e outras condições de emprego ficam restritos à vaga. Uma resposta salva não é aplicada automaticamente a perguntas apenas parecidas.

Feche o modal com **Responder depois** ou Escape e reabra em **Responder perguntas**. Rascunhos são preservados durante atualizações do painel na mesma aba; eles não são persistidos antes de salvar. Uma nova pendência/rejeição pode abrir o modal novamente. A notificação depende do painel aberto: não há notificação por e-mail nem aviso do sistema operacional.

## Histórico e evidência

`data/jobs.csv` concentra as vagas e seus estados. `output/daily-runs/` guarda relatórios dos lotes. `runtime/events.jsonl` mostra a execução atual e pode ser reiniciado ao começar outra. `runtime/<id>.json` guarda o estado do preenchimento; `<id>.submission.json` registra a tentativa de envio antes do clique.

O estado **Enviada** indica confirmação capturada ou uma candidatura anterior identificada na página. Um clique sem confirmação vira **Envio incerto**, bloqueando repetição automática. A conferência final pode ser feita no próprio LinkedIn. Não apague um journal de envio para simplesmente tentar de novo.

## Problemas frequentes

| Situação | Ação |
|---|---|
| Atualizar não encontra novas vagas | Use Só buscar; atualizar apenas lê registros |
| Nenhuma vaga elegível | Veja a análise e os motivos; 0 enviadas não significa 0 encontradas |
| Pergunta sem resposta | Responda no modal, salve e aguarde a retomada |
| Valor inválido | Corrija no modal; verifique se a pergunta pede meses, anos, número ou opção |
| Login ou CAPTCHA | Resolva manualmente na janela do LinkedIn e retome |
| Currículo ausente | Adicione PDF em `data/resume.pdf` e confira `python setup.py --check` |
| Perfil ausente | Execute `python setup.py` e preencha o JSON local |
| Chrome/Edge não encontrado | Configure `JOB_APPLIER_BROWSER` |
| Navegador fecha ou CDP indisponível | Feche somente a janela dedicada e abra `login.js` novamente; confira a porta configurada |
| Trava por `automatic.lock` | Confira se há processo ativo. Só remova o lock local quando tiver certeza de que não há execução em andamento |
| Erro sem campo identificado | Revise a janela; CAPTCHA, anexos e controles desconhecidos não viram respostas genéricas |
| Atualização de código | Reinicie o servidor Python; apenas atualizar a página não recarrega o backend |

## Agenda e linha de comando

A agenda vem desligada. Se ativada no JSON, roda no horário configurado de São Paulo enquanto o servidor está aberto. Abrir o servidor depois desse horário pode iniciar o lote do dia. Há um marcador diário para evitar outra execução agendada após um lote manual.

```powershell
# Somente simulação dos resultados locais: não navega, não grava, não envia
python job-applier-app/daily.py

# Lote manual real: busca e envio
python job-applier-app/daily.py --run --manual

# Retomada real de pendentes sem nova busca
python job-applier-app/daily.py --run --manual --retry-pending
```

A opção `--job ID --retry-pending` limita a uma vaga já cadastrada e elegível. O worker também pode operar sem `--auto-submit` para aguardar comando de confirmação; o painel padrão executa o fluxo automático. Não há botão de modo assistido completo no painel nesta versão.
