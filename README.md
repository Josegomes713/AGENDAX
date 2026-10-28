# AGENDA X — Agendamentos Inteligentes
*Sua agenda, seu negócio, seu crescimento.*

SaaS de agendamentos para barbeiros, salões, manicures e esteticistas.
Node 22+ (sem dependências npm): servidor HTTP próprio + SQLite embutido (`node:sqlite`).

## Começar agora (computador)
1. Instale o Node.js 22+ (nodejs.org).
2. Dê dois cliques em `iniciar.bat` (Windows) ou `iniciar.command` (Mac/Linux), digite seu e-mail e o app abre no navegador.
3. Clique em "Comece 14 dias grátis" e crie a conta **com esse mesmo e-mail**: você entra com acesso total (Premium, sem expirar).

## Rodar (avançado)
```bash
npm start       # começa 100% vazio: o primeiro cadastro é o seu
# npm run demo:seed  -> só para testes locais (cria a "Barbearia Demo"); NÃO use em produção
# abre em http://localhost:3000
npm test        # 39 testes de ponta a ponta
```
- Site / cadastro / login: `/` · Painel: `/app` · Página pública do cliente: `/agendar/<slug>` (demo: `/agendar/barbearia-demo`)

## O que já funciona
Login e cadastro seguros (scrypt, cookie HttpOnly, limite de tentativas) · Painel com gráficos · Agenda (grade e lista, criar/editar/cancelar/concluir/faltou, bloqueio de conflitos) · Clientes com histórico · Serviços com foto, descrição, preço e duração · Profissionais (horários, serviços, cor) · Financeiro · Comissões por profissional · Relatórios + CSV · Notificações dentro do app · Página pública de agendamento com cancelamento por código · Dados isolados por estabelecimento · 14 dias grátis com TUDO liberado (nível Premium); depois a conta assina um plano pago ou cai no plano Grátis (1 profissional, 5 serviços, 50 clientes, 30 agendamentos/mês, sem financeiro/comissões/relatórios). Planos: Grátis R$0 · Básico R$20 · Profissional R$37,90 · Premium R$59,90, com bloqueio de recursos e limites por plano.

## Para produção
- `NODE_ENV=production`, `TRUST_PROXY=1` atrás de HTTPS (o `Dockerfile` e o Render já definem), `DATA_DIR` num disco persistente (banco, fotos, chave do push e backups).
- **Pagamento (Pix, Mercado Pago):** a cobrança é criada pelo servidor com o preço do plano cadastrado; o plano só é ativado quando o webhook assinado do Mercado Pago chega e o pagamento é reconsultado na API (valor, moeda, referência e método conferidos). Sem `MP_ACCESS_TOKEN` o pagamento fica desligado (nenhum plano pago é liberado). Variáveis: `MP_ACCESS_TOKEN` (`TEST-...` = modo teste, `APP_USR-...` = produção), `MP_WEBHOOK_SECRET`, `PUBLIC_URL`. Webhook a cadastrar no painel do Mercado Pago: `PUBLIC_URL/api/webhooks/mercadopago` (tópico *Pagamentos*). Cada Pix vale 30 dias; não há recorrência automática.
- **Dono do sistema:** defina `ADMIN_EMAILS` (seu e-mail). Na tela inicial, o link **Administrador** entra só com e-mail e senha; no primeiro acesso a senha digitada vira a do administrador (faça isso logo após publicar). Esse e-mail não pode ser usado no cadastro comum.
- **Recuperação de senha:** cada conta recebe um código de recuperação mostrado uma vez no cadastro (e regenerável em Minha conta). Sem envio de e-mail por enquanto.
- **Contas de teste:** no máximo 3 por IP a cada 24 h (`MAX_TESTES_POR_IP`) e 10 cadastros por IP por hora (`MAX_CADASTROS_HORA`). A verificação de e-mail será a proteção definitiva (precisa de provedor de e-mail).
- **Notificações push:** funcionam em HTTPS. Defina `VAPID_CONTACT` (ex.: `mailto:voce@email.com`). A chave é criada sozinha em `DATA_DIR/vapid.json`; mantenha o disco persistente. No iPhone o app precisa estar na Tela de Início.
- **Lembretes:** gerados pelo servidor a cada minuto, com o app aberto ou não.
- **Backup:** cópia diária do banco em `DATA_DIR/backups` (últimas 7). Copie também para fora do servidor de tempos em tempos (o disco é o mesmo).
- **Saúde:** `/saude` responde `ok` (usado pelo Render).
- **LGPD:** páginas `/termos.html` e `/privacidade.html` (modelos: revise com um advogado e inclua razão social/CNPJ e e-mail de contato), exportação (Baixar meus dados) e exclusão de conta em Minha conta.
- **Pendências conhecidas:** cobrança real dos planos; verificação de e-mail e e-mail de recuperação; logins separados por profissional (hoje há uma conta por estabelecimento).

## Publicar na internet (Render, exemplo)
1. Suba esta pasta para um repositório no GitHub.
2. No Render: New → Blueprint → escolha o repositório (usa `render.yaml`: Docker + disco persistente em `/data`).
3. Quando terminar, o Render entrega um endereço `https://agenda-x.onrender.com`; os clientes agendam em `/agendar/<slug>`.
Serve também Railway, Fly.io ou qualquer VPS com Docker (`docker build -t agenda-x . && docker run -p 3000:3000 -v agendax:/data agenda-x`).

## Acesso total do dono
Defina `ADMIN_EMAILS=seu@email.com` (vários separados por vírgula) no servidor. Quem cadastrar/entrar com esse e-mail fica com o plano Premium ativo, sem limites e sem fim de teste. No Render, adicione a variável em Environment.

## Painel de administração (só dono)
Quem entra com um e-mail listado em `ADMIN_EMAILS` vê o item **Administração** no menu: totais de contas (em teste, assinantes, limitadas, suspensas, novas), busca por negócio/nome/e-mail e, em cada conta, **liberar um plano**, **estender o teste**, **voltar ao plano limitado** e **suspender/reativar**. Cada ação fica no histórico. Quem não é dono recebe 404 em `/api/admin/*`. O painel não mostra clientes, agenda nem financeiro dos negócios, só contagens.


## Acesso do administrador
Na tela inicial há um link discreto **Administrador**: e-mail e senha, sem código. Só funciona para e-mails de `ADMIN_EMAILS`. Usuários comuns nunca veem o menu Administração e a API responde 404 para eles.
Se `ADMIN_EMAILS` estiver vazio, o **primeiro** e-mail e senha digitados no link Administrador viram o acesso de administrador e o acesso fica trancado para qualquer outro e-mail. Por isso, faça esse primeiro acesso logo depois de publicar.

## Credenciais do Mercado Pago pelo painel
Em **Administração → Pagamentos dos planos** você cola o Access Token, a assinatura do webhook e o endereço do app, sem mexer no Render. Eles ficam guardados criptografados (AES-256-GCM) e nunca voltam para a tela; o botão **Testar conexão** confere o token sem cobrar nada. O painel tem prioridade sobre as variáveis `MP_ACCESS_TOKEN`, `MP_WEBHOOK_SECRET` e `PUBLIC_URL`. A chave de criptografia fica em `/data/.chave-config` (ou em `CONFIG_KEY`), por isso o disco do Render precisa continuar ligado.
