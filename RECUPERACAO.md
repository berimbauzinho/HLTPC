# Recuperação do HLTPC

O Netlify continua publicando o site. O Supabase passa a guardar o conteúdo, contas e imagens, com gravação condicional e histórico de versões. Demos grandes podem ser processadas no PC, sem subir o arquivo inteiro para uma função do Netlify. Restringir editores ajuda no controle, mas não substitui a proteção contra duas gravações simultâneas.

Esta mudança está preparada no código. O projeto Supabase `wmpewqelsxyhkuazrxfa` já foi inspecionado e recebeu a estrutura privada, a função de gravação e a restrição de acesso à função interna de RLS. A cópia pública da revisão 13 foi preservada em `hltpc-recovery/published-20260926-revision-13` e verificada: 18 jogadores, 10 times, 4 campeonatos, 18 partidas e 3 notícias. Essa cópia de recuperação ainda não é o conteúdo ativo do site. A importação completa e a troca das variáveis do Netlify aguardam o acesso ao armazenamento original. Não mescle antes de preparar e validar a migração.

Na inspeção de 26/09/2026, o banco não tinha tabelas do aplicativo, buckets, arquivos ou usuários Supabase antes desta preparação. O banco real confirmou RLS, ausência de acesso de leitura/gravação para anon/authenticated e rejeição de uma gravação com etag inválido. A função interna `rls_auto_enable` perdeu as permissões públicas desnecessárias. O único aviso de segurança restante é informativo: RLS sem políticas na tabela privada, proposital para negar acesso direto aos clientes. O backend usa service_role. O arquivo `/api/media/c3e3a383-4c14-4ef8-93b6-c2b2e2b6bf32` retornou 404 no site original e precisa ser procurado na exportação privada; não há confirmação de recuperação desse arquivo.

## Primeiro, preserve o que existe

Guarde uma exportação do conteúdo publicado e mantenha o armazenamento antigo até validar o novo. A exportação do painel contém o conteúdo do campeonato, não os arquivos de imagens nem as contas. A cópia pública recuperada nesta tarefa tem 18 partidas, mas não permite afirmar que todos os dados perdidos foram recuperados. Copie as imagens antes de trocar o provedor; apenas manter o armazenamento antigo não torna os arquivos acessíveis pelo novo.

Para a cópia completa, pause as edições, configure `NETLIFY_SITE_ID` e `NETLIFY_AUTH_TOKEN` no PC e execute `node --env-file=.env tools/transfer-storage.mjs export-netlify backup-privado.json`. O arquivo contém contas e deve ser guardado fora do repositório, em local privado. Com Supabase configurado e vazio, execute `node --env-file=.env tools/transfer-storage.mjs import backup-privado.json`. Isso verifica cada objeto e recusa sobrescrever o destino. Não execute a importação parcial de conteúdo junto com essa opção. Importação interrompida exige um novo destino vazio; não há exclusão automática. Imagens antigas acima de 1,5 MB ou de formatos diferentes de PNG/JPEG/WebP precisam ser otimizadas antes de migrar para o bucket atual.

## Preparar o Supabase

1. Crie um projeto em https://supabase.com/dashboard e escolha uma senha forte para o banco.
2. Execute `supabase/migrations/001_persistent_storage.sql` no SQL Editor desse projeto. O script cria armazenamento privado de imagens, controle de acesso e gravação com histórico transacional.
3. Configure no servidor `HLTPC_STORAGE=supabase`, `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY`. Confira o nome exato no arquivo `.env.example`. A chave privilegiada fica apenas nas variáveis do servidor; nunca no HTML, no GitHub ou no chat.
4. Preserve a senha do proprietário já configurada em `HLTPC_OWNER_PASSWORD` e o segredo de sessão em `HLTPC_SESSION_SECRET`. Não há mais senha padrão pública.
   Configure também `HLTPC_OWNER_ONLY=true` para que apenas o proprietário entre no painel durante a recuperação. Contas de editores permanecem guardadas, mas não recebem acesso nesse modo. Desativar ou redefinir uma conta invalida sua sessão nas próximas requisições.
5. Importe a cópia de conteúdo com `node --env-file=.env tools/import-content.mjs caminho/para/conteudo.json`. A ferramenta recusa sobrescrever um destino já preenchido. Isso importa conteúdo; contas e arquivos precisam ser preservados/migrados separadamente.
6. Valide primeiro em um ambiente separado: editar e recarregar uma notícia, enviar uma imagem, processar uma demo real e conferir os resultados, exportar e restaurar uma versão. Use projeto Supabase separado para testes. Um preview do Netlify com o armazenamento antigo pode compartilhar os dados da produção.
7. Só depois configure as variáveis do ambiente de produção no Netlify e publique. Mantenha a versão anterior disponível para voltar caso necessário.

O banco mantém o formato de conteúdo existente para preservar compatibilidade. Não é ainda uma migração para tabelas individuais de jogadores e partidas. O histórico permite restaurar edições, mas não substitui cópias externas do banco e dos arquivos.

## Usar no PC

Instale Node.js e as dependências. Copie `.env.example` para `.env`, escolha `HLTPC_STORAGE=local`, defina senha e segredo próprios, execute `node tools/build-public.js` e importe a cópia com a ferramenta acima. Inicie com `node --env-file=.env server.js` e abra http://127.0.0.1:3000/admin/.

Os dados locais ficam em `.data/`, ou no diretório definido por `HLTPC_LOCAL_DATA_DIR`. Faça cópia dessa pasta com o servidor parado. O servidor aceita apenas conexões do próprio PC. Ele deve rodar em uma única instância. O site publicado não depende desse PC ficar ligado quando usa Supabase.

## O que foi protegido

- Uma sessão antiga recebe conflito em vez de apagar uma edição mais recente.
- Falha no envio de imagem interrompe a gravação e mantém o formulário; não há falso sucesso com imagem só no navegador.
- O painel oferece exportação e restauração ao proprietário.
- Processamento de demo não substitui placar confirmado manualmente e descarta resultados quando a fonte mudou.
- Dependências reais substituem o armazenamento simulado; arquivos internos não entram na pasta pública.

Validação automatizada: `node --test tests/*.test.mjs`, `node tools/check-code.js` e `node tools/build-public.js`. Os testes usam dados temporários e PostgreSQL local em memória. A conexão real com Supabase e a leitura de uma demo real continuam obrigatórias antes de publicar.
