# Contribuir

Leia README, configuração e implementação atual. O escopo inicial é o aplicativo local em Windows; mudanças na interface do LinkedIn precisam ser reproduzidas com HTML fictício, não com cookies ou currículos reais.

## Ambiente

1. Clone o projeto, execute `python setup.py` e `npm ci --ignore-scripts` em `job-applier-app/`.
2. Use Python 3.11+ e Node.js 22+; o workflow usa Python 3.11 e Node 24.
3. Instale Chrome/Edge ou configure `JOB_APPLIER_BROWSER`.
4. Execute os testes descritos no README antes do PR.

## Regras de desenvolvimento

- Testes automatizados não devem acessar contas nem enviar candidaturas reais.
- Use o perfil e o PDF fictícios em `job-applier-app/fixtures/`.
- Cubra mudanças no resolvedor com exemplos positivos e negativos; ferramenta reconhecida não autoriza afirmar conhecimento de outra.
- Preserve a distinção entre pergunta pendente, falha técnica e resultado incerto de envio.
- Não apague a proteção de journal para permitir repetição automática.
- Não adicione contatos, currículos, histórico, tokens, cookies ou logs privados.
- Documente mudanças nos contratos e no comportamento do painel.

## Relatar bugs

Descreva o botão usado, etapa, comportamento esperado e resultado. Anexe somente HTML reduzido ou imagem anonimizada. Não inclua perfil de navegador, logs completos com dados pessoais ou currículos reais. Não publique uma vulnerabilidade com credenciais ou dados de terceiros.

O projeto ainda não definiu licença de distribuição; não altere atribuições de dependências nem incorpore fontes de terceiros sem registrar sua origem e condições.
