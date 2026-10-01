# Comunidade HLTPC

Contas de nickname e senha, comentários por notícia e tópicos com respostas no fórum. As publicações aparecem imediatamente; denúncias, ocultação/restauração, fechamento de tópicos e suspensão/reativação ficam em **Admin → Moderação da comunidade**.

## Contas e proteção

- A autenticação da comunidade é independente do acesso administrativo. Não há promoção de contas públicas para administradores.
- Senhas de 12–128 caracteres e chaves de recuperação são armazenadas com scrypt e salt aleatório, nunca em texto puro. Este sistema usa o armazenamento privado do Supabase já configurado, não Supabase Auth.
- O cadastro mostra uma chave de recuperação uma única vez. A recuperação substitui a chave e revoga sessões antigas. Não há recuperação por e-mail nesta versão.
- Cookie exclusivo `hltpc_community`, assinado com chave derivada e validade de oito horas, HttpOnly, Secure e SameSite=Strict. Suspensão e alteração/recuperação de senha revogam sessões pela versão da conta.
- Escritas exigem JSON e origem igual ao host. Credenciais do Supabase continuam somente no servidor, atrás das permissões existentes de `hltpc_objects`.
- Limites persistentes: 20 operações de autenticação por IP/10 minutos; 10 por nickname/10 minutos; três cadastros por IP/hora; três tópicos por conta/hora; cinco mensagens por conta/minuto; dez denúncias por conta/hora.
- Publicações são texto puro, escapado ao renderizar. Não aceitam HTML, anexos ou execução de código.

## Persistência e limites

Dados ficam no namespace `hltpc-community`, separado do conteúdo editorial e dos usuários administrativos. Cada discussão usa um registro independente e escrita condicional por ETag; concorrência não pode sobrescrever respostas silenciosamente. Ocultar mantém o texto e registra o moderador na auditoria da discussão.

Mensagens têm até 2.000 caracteres e tópicos até 120 no título. Conversas têm páginas de 20 mensagens e limite de 1.000 publicações. A listagem do fórum mostra até 100 tópicos recentes. A moderação lista até 100 contas, 100 denúncias e 100 publicações recentes; ampliar a paginação administrativa será necessário se a comunidade crescer além dessa escala.

Prévias Netlify com ID imutável usam `hltpc-community-preview-<deploy-id>`. Contas e conversas de teste não migram para produção quando o mesmo deploy é publicado.

## Validação

`node --test tests/community.test.mjs` cobre isolamento do admin, origem das solicitações, colisão de nickname, autenticação, persistência concorrente, denúncia, ocultação, fechamento, recuperação, revogação, suspensão e limites de tentativas. As funções usam o adaptador local nos testes e o Supabase na implantação.
