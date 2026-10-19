# Roadmap

## Implementado nesta versão

- [x] Configuração local genérica e setup sem sobrescrever dados existentes.
- [x] Exemplos sem dados pessoais; agenda desligada em novas instalações.
- [x] Busca de vagas simplificadas, triagem por regras e explicação de descartes.
- [x] Painel responsivo com atividade, progresso e histórico.
- [x] Preenchimento e upload do currículo, com controle da versão pelo conteúdo.
- [x] Modal de informação ausente e correção de campos rejeitados.
- [x] Respostas com escopo, aprendizado por pergunta exata e fila persistente de retomada.
- [x] Registro de tentativa de envio e bloqueio de repetição em resultado incerto.
- [x] Testes independentes do perfil pessoal e workflow de CI.

## 1. Onboarding local

Editor de perfil e preferências no painel, seleção do PDF, revisão das respostas aprendidas e configuração de limites sem editar JSON. Remover regras fixas de salário, região e competências do resolvedor.

**Concluído quando:** uma pessoa configura seu perfil do zero pela interface, sem herdar fatos de outra e sem editar código.

## 2. Upload e extração do currículo

Receber PDF/DOCX, validar arquivo, extrair texto e estruturar perfil com evidência de origem. Identificar documentos escaneados e tratar OCR separadamente. Mostrar os fatos para revisão antes de usar em candidaturas.

**Concluído quando:** currículo sem menção a uma ferramenta não gera automaticamente experiência nela; a pessoa consegue aprovar e corrigir os dados extraídos.

## 3. Matching dirigido pelo perfil

Separar requisitos obrigatórios e desejáveis e comparar com fatos confirmados, senioridade, idioma, local e preferências. Criar conjunto de anúncios e currículos fictícios para avaliar precisão e explicar decisões. Modelos de IA podem apoiar extração e interpretação, com saída validada e sem inventar fatos.

**Concluído quando:** o mesmo anúncio produz resultados diferentes para perfis diferentes, com evidências, lacunas e critérios verificáveis. Nota alta não compensa um requisito obrigatório ausente.

## 4. Estados e resiliência

Persistência transacional, classificação de falhas mais completa, retomada por etapa, melhores evidências de envio e revisão de resultados incertos. Melhorar validação de restrições de campos e edição de respostas no modal.

**Concluído quando:** testes com falhas entre etapas preservam histórico e não repetem uma submissão incerta.

## 5. Contas e vários usuários

Autenticação, armazenamento privado, autorização por perfil, banco estruturado, fila e agente local de navegador. Cada pessoa usa seu currículo, respostas e sessão. Não apenas duplicar o JSON numa instância compartilhada.

**Concluído quando:** uma pessoa não consegue acessar arquivos, perguntas, execução ou sessão de outra, inclusive alterando IDs na API.

## 6. Outras plataformas

Avaliar adaptadores separados para Indeed e Gupy, respeitando suas diferenças de formulários e sessão. Hoje não há envio automático nessas plataformas.

Nenhuma dessas etapas futuras é apresentada como já implementada. A prioridade é consolidar o produto local antes de criar uma versão hospedada.
