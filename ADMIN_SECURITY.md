# Senha da conta principal do admin

No painel, use **Alterar minha senha**, confirme a senha atual e escolha uma senha exclusiva com pelo menos 12 caracteres. A nova credencial é gravada como hash scrypt com salt no armazenamento privado `hltpc-admin-security`, separado do conteúdo editorial. A senha nunca é devolvida pelas APIs.

A senha de ambiente serve apenas para o acesso inicial quando ainda não existe uma credencial persistida. Depois da primeira troca, ela não autentica mais, inclusive em novas prévias. Falhas ou corrupção do armazenamento bloqueiam o acesso; não restauram a senha de ambiente. Uma nova publicação preserva a credencial persistida.

Cada troca cria uma nova versão de autenticação: todas as outras sessões da conta principal deixam de valer. O navegador que concluiu a troca recebe uma nova sessão. A gravação usa comparação de versão para impedir que duas trocas simultâneas se sobrescrevam.

Prévias herdam a credencial de produção até uma troca de teste, que fica isolada por deploy. Nunca promover um registro de senha de teste a produção. Não usar a senha antiga de `.env.migration` em verificações após o owner concluir a troca; o usuário deve entrar no painel com a nova senha. Recuperação administrativa exige redefinição explícita da credencial persistida com acesso autorizado ao armazenamento privado.
