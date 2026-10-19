# Privacidade e publicação

A primeira versão foi preparada para o repositório `joaochvs/job-applier` com uma cópia separada da aplicação pessoal. O código público usa `data/profile.json`, `data/resume.pdf` e `data/jobs.csv`; não contém banco de respostas, currículo, telefone, e-mail privado, histórico ou cookies do autor.

## Incluído

- Código do servidor, coordenador, navegador, matching, respostas, painel e scripts de apoio.
- Configuração inicial sem contatos e sem experiência profissional afirmada.
- Testes com perfil, PDF, anúncios e API fictícios.
- Documentação do comportamento atual, limites e arquitetura futura.
- Imagens demonstrativas sem dados reais de candidaturas.
- Workflow de testes em Windows.

## Excluído

`.gitignore` protege `data/`, `runtime/`, `output/`, perfis de navegador, `automation.json` local, dependências, ambientes e documentos pessoais. A única exceção de PDF é `job-applier-app/fixtures/resume.pdf`, criado exclusivamente para testes.

Não basta copiar um arquivo privado para outra pasta com nome diferente: confirme a lista real de arquivos e o conteúdo antes de publicar. Pastas configuradas por `JOB_APPLIER_DATA_DIR` fora de `data/` precisam permanecer fora do repositório ou receber uma regra explícita de exclusão.

## Antes de cada push

```powershell
git status --short
git diff --cached --stat
git diff --cached
git ls-files
git check-ignore data/profile.json data/resume.pdf data/jobs.csv job-applier-app/automation.json
```

Não force inclusão de currículo, configuração privada, logs ou perfil de navegador. Não publique screenshots da sessão real. Os fixtures têm dados fictícios e devem continuar assim. Use placeholders nos relatos de bug.

## Dados locais e backup

O Git não é backup dos dados privados. Ao migrar de computador, configure um perfil novo ou transfira os arquivos privados por um meio apropriado. Faça login manualmente na nova sessão. Não envie cookies ao repositório.

Não exponha o servidor e a porta CDP à rede. A versão atual não oferece autenticação, isolamento de contas ou execução hospedada. A separação por usuário está no roadmap.

## Licença e dependências

A licença de distribuição do projeto ainda não foi definida; o pacote está marcado como `UNLICENSED`. As dependências são declaradas em `package.json` e travadas em `package-lock.json`. Não foram incorporados fontes de outro aplicador a esta publicação. Uma eventual incorporação futura precisa preservar atribuições e licença aplicável.
