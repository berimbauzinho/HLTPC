# HLTPC

Portal histórico dos campeonatos de Counter-Strike da turma.

## Estrutura

- `index.html`: estrutura das telas públicas.
- `styles.css`: identidade visual responsiva.
- `data.js`: única fonte dos dados históricos confirmados.
- `app.js`: cálculos derivados e renderização.
- `netlify.toml`: publicação estática pelo Netlify.

## Regras dos dados

- Escalações pertencem a uma edição de campeonato, nunca a um time permanente.
- Perfis de jogadores e times são derivados das participações.
- Partidas só aparecem quando confronto e resultado forem confirmados.
- Estatísticas de eventos sem demo não são calculadas.
- Dados vindos de demos incompletas devem ser identificados como parciais.

## Desenvolvimento local

Abra `index.html` no navegador ou use um servidor estático, por exemplo:

```bash
python3 -m http.server 8080
```

O projeto não exige etapa de build nesta versão.

## Acesso administrativo

O painel em `/admin/` usa usuário e senha por meio de Netlify Functions. Configure no Netlify:

- `HLTPC_OWNER_PASSWORD`: senha do owner `lanches`.

Opcionalmente, `HLTPC_OWNER_USERNAME` altera o usuário principal e `HLTPC_SESSION_SECRET` define manualmente o segredo usado para assinar sessões.

O owner pode liberar outros nomes de usuário em **Usuários e acessos**. Novos administradores entram primeiro com `mudar1234` e precisam criar uma senha própria antes de acessar o painel. As contas e os hashes das senhas são persistidos no Netlify Blobs.

Depois de criar ou alterar variáveis de ambiente, faça um novo deploy para que as Functions recebam os valores atualizados.
