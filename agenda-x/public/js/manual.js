/* Manual do usuário: capítulos que abrem e fecham, com passo a passo e dicas. */
(function () {
  const M = (t, linhas) => `<div class="man-tela"><div class="man-tela-bar"></div><div class="man-tela-in">${t}</div></div><div class="man-cap">Visualização da tela — ${linhas}</div>`;
  const telaLogin = M('<div class="mt-logo">AGENDA <b>X</b></div><div class="mt-inp">E-mail</div><div class="mt-inp">••••••••</div><div class="mt-btn">Entrar</div><div class="mt-link">Esqueci minha senha</div>', 'Entrar');
  const telaDisp = M('<div class="mt-tit">Disponibilidade de horários</div><div class="mt-lin"><span>Segunda</span><b>09:00 – 18:00</b></div><div class="mt-lin"><span>Terça</span><b>09:00 – 18:00</b></div><div class="mt-lin"><span>Sábado</span><b>09:00 – 13:00</b></div><div class="mt-lin off"><span>Domingo</span><b>Fechado</b></div><div class="mt-btn">Salvar disponibilidade</div>', 'Disponibilidade');
  const telaAg = M('<div class="mt-tit">Agenda de hoje</div><div class="mt-ag"><i>09:00</i><div><b>João Silva</b><small>Corte masculino · Rafael</small></div><em>Agendado</em></div><div class="mt-ag"><i>10:00</i><div><b>Pedro Alves</b><small>Barba completa · Rafael</small></div><em class="ok">Concluído</em></div>', 'Agenda');
  const telaNot = M('<div class="mt-tit">🔔 Notificações</div><div class="mt-not"><b>Novo agendamento online 📅</b><small>Ana Souza — Corte em 24/10 às 15:00</small></div><div class="mt-lin"><span>Som de mensagem</span><b>Ligado</b></div><div class="mt-btn">Ativar avisos no celular</div>', 'Sino e alertas');

  const CAPS = [
    { ico: '🔑', cor: '#ea7a2f', t: 'Primeiros passos', secoes: [
      { t: 'Entrando no app', mock: telaLogin, passos: ['Abra o endereço do app no navegador do celular ou do computador.', 'Digite seu e-mail e senha e toque em "Entrar". Se ainda não tem conta, toque em "Comece 14 dias grátis" e preencha nome do estabelecimento, seu nome, e-mail, senha e o plano que pretende assinar depois.', 'No primeiro cadastro o app mostra um <b>código de recuperação de senha</b>. Anote ou tire uma foto: ele aparece uma única vez.', 'No celular, use "Instalar app" (ou "Adicionar à Tela de Início") para abrir como um aplicativo.'],
        dica: 'Esqueceu a senha? Na tela de entrada toque em "Esqueci minha senha" e use o código de recuperação. Depois de usado, o app mostra um código novo.' },
      { t: 'Como o app é organizado', passos: ['No computador o <b>menu lateral</b> fica sempre à esquerda. No celular, toque nas três linhas no canto de cima para abrir e fechar.', 'Menu: Painel inicial, Agenda, Disponibilidade, Clientes, Serviços, Produtos, Profissionais, Financeiro, Comissões, Relatórios, Minha assinatura, Manual do usuário, Configurações e Sair.', 'No alto da tela ficam o título da página, o botão "Instalar app" (quando disponível) e o <b>sino de notificações</b>.', 'Itens do menu com a etiqueta "Upgrade" pertencem a um plano superior ao seu.'] },
    ] },
    { ico: '🏠', cor: '#7c3aed', t: 'Painel inicial', secoes: [
      { t: 'O resumo do seu dia', passos: ['<b>Cartões do topo:</b> agendamentos de hoje (concluídos e pendentes), faturamento de hoje, faturamento do mês (com as despesas) e total de clientes (novos no mês e cancelamentos).', '<b>Agenda de hoje:</b> lista os atendimentos do dia. Toque em um para ver os detalhes.', '<b>Próximos atendimentos:</b> os próximos horários marcados, mesmo de outros dias.', '<b>Sua página de agendamento:</b> o link para enviar aos clientes, com os botões "Copiar link" e "Abrir página".', '<b>Gráficos</b> (plano Premium): faturamento e agendamentos dos últimos 7 dias e serviços mais procurados nos últimos 30.'] },
      { t: 'Primeiros passos e disponibilidade', passos: ['Enquanto a conta é nova, o painel mostra o guia <b>Primeiros passos</b>: cadastrar serviços, vincular a um profissional, compartilhar o link e fazer o primeiro agendamento. Cada item concluído ganha um ✓ e o guia some quando tudo estiver pronto.', 'O cartão <b>Disponibilidade de horários</b> mostra a semana de cada profissional. Toque em "Configurar horários" para editar.'] },
    ] },
    { ico: '✂️', cor: '#d946ef', t: 'Serviços', secoes: [
      { t: 'Cadastrando e editando serviços', passos: ['Abra <b>Serviços</b> e toque em "Novo serviço".', 'Informe nome, descrição, preço e duração em minutos. Escolha uma foto: ela aparece para o cliente na página de agendamento.', 'Marque quais profissionais fazem o serviço e salve.', 'Para mudar algo, toque em "Editar" no cartão do serviço. Você pode ativar ou desativar o serviço sem perder o histórico.'],
        dica: 'Serviço sem profissional vinculado não aparece para o cliente agendar. Serviço que já tem atendimentos não é apagado: ele é apenas desativado.' },
    ] },
    { ico: '📦', cor: '#f97316', t: 'Produtos', secoes: [
      { t: 'Cadastrando seus produtos', passos: ['Abra <b>Produtos</b> no menu lateral e toque em "Novo produto".', 'Informe nome, descrição, preço e uma foto.', 'Para tirar um produto da página sem perder o cadastro, edite e desmarque "Produto ativo".', 'Se excluir um produto, os agendamentos antigos continuam com o registro do que foi pedido.'],
        dica: 'Na página de agendamento o cliente vê "Quer levar algum produto? (opcional)". Ele escolhe a quantidade ou simplesmente continua sem nada: o horário é marcado do mesmo jeito.' },
      { t: 'Onde aparecem os pedidos', passos: ['O aviso de novo agendamento online já informa os produtos escolhidos.', 'Ao abrir o agendamento na agenda você vê a lista de produtos, e o <b>valor</b> já soma serviço + produtos.', 'Ao concluir o atendimento, esse valor entra no Financeiro como receita.'] },
    ] },
    { ico: '💇', cor: '#0ea5e9', t: 'Profissionais', secoes: [
      { t: 'Cadastrando a equipe', passos: ['Abra <b>Profissionais</b> e toque em "Novo profissional".', 'Preencha nome e telefone. Defina a <b>comissão</b> (porcentagem sobre cada atendimento concluído).', 'Marque os serviços que ele atende. O app já cria um profissional com o seu nome quando você abre a conta.', 'Foto, cor na agenda e horários próprios de cada profissional dependem do plano; quando faltar, o app avisa qual plano libera.', 'O contador no alto mostra quantos profissionais ativos o seu plano permite.'],
        dica: 'Profissional com atendimentos no histórico é desativado em vez de excluído, para não bagunçar relatórios e comissões.' },
    ] },
    { ico: '🕐', cor: '#16a34a', t: 'Disponibilidade', secoes: [
      { t: 'Definindo seus horários de atendimento', mock: telaDisp, passos: ['Abra <b>Disponibilidade</b> no menu.', 'Escolha o profissional no alto da tela.', 'Marque os dias em que ele atende e defina o horário de início e de fim de cada dia.', 'Escolha o intervalo entre horários (10 a 60 minutos) e toque em "Salvar disponibilidade".', 'Use "Copiar para todos os profissionais" para repetir os mesmos horários na equipe.'],
        dica: 'Só os horários dentro do expediente ficam livres na agenda e na página de agendamento dos clientes.' },
    ] },
    { ico: '📅', cor: '#d99a1a', t: 'Agenda', secoes: [
      { t: 'Navegando pela agenda', mock: telaAg, passos: ['A agenda tem duas formas de ver: <b>Grade</b> (uma coluna por profissional, com os horários) e <b>Lista</b> (ideal para o celular).', 'Use as setas para ir ao dia anterior ou ao próximo e o botão "Hoje" para voltar.', 'Filtre por profissional para ver só a agenda de uma pessoa.', 'Cada atendimento aparece com a cor do profissional e uma etiqueta: Agendado, Concluído, Cancelado ou Faltou. Toque nele para abrir os detalhes.'] },
      { t: 'Criando um agendamento', passos: ['Toque em "Novo agendamento" (ou toque num horário livre da grade).', 'Escolha o cliente da lista ou cadastre um novo na hora.', 'Escolha o serviço e o profissional que o realiza, depois a data. O app mostra só os <b>horários livres</b>.', 'Salve. Se o horário já estiver ocupado, o app avisa e não permite marcar um atendimento em cima de outro.'],
        dica: 'Valor personalizado e observações no agendamento dependem do plano (Profissional e Premium).' },
    ] },
    { ico: '✅', cor: '#16a34a', t: 'Atendimentos', secoes: [
      { t: 'Concluir, cancelar e marcar falta', passos: ['Toque no agendamento para abrir os detalhes.', '<b>Concluir atendimento:</b> confirme o valor e toque em "Concluir e lançar receita". O app registra a receita no Financeiro e calcula a comissão do profissional.', '<b>Cancelar:</b> libera o horário e remove a receita, se ela já tinha sido lançada.', '<b>Marcar falta:</b> registra que o cliente não apareceu (plano Premium).', '<b>Editar:</b> troca cliente, serviço, profissional, data ou horário de um atendimento ainda agendado (a partir do plano Profissional).'] },
    ] },
    { ico: '👥', cor: '#2563eb', t: 'Clientes', secoes: [
      { t: 'Cadastro e histórico', passos: ['Em <b>Clientes</b>, busque por nome, telefone ou e-mail e toque em "Novo cliente" para cadastrar.', 'Ao abrir um cliente você vê quantos atendimentos ele fez, quanto já gastou e a data do último atendimento.', 'O histórico de atendimentos de cada cliente e o campo de observações dependem do plano (Básico e Profissional).', 'Da ficha do cliente você pode criar um novo agendamento direto.', 'Quem já tem atendimentos no histórico não pode ser excluído, para preservar seus relatórios.', 'No plano Premium, "Exportar CSV" baixa a lista de clientes.'] },
    ] },
    { ico: '💰', cor: '#16a34a', t: 'Financeiro', secoes: [
      { t: 'Receitas, despesas e saldo', passos: ['Abra <b>Financeiro</b> e escolha o período (hoje, 7 dias, 30 dias, este mês, mês passado ou datas à sua escolha).', 'Veja receitas, despesas e saldo do período, o gráfico por dia e o total por categoria.', 'As receitas dos atendimentos entram sozinhas quando você conclui o atendimento.', 'Toque em "Despesa" para lançar um gasto (descrição, valor e data). "Receita" lança entradas avulsas, no plano Premium.', 'Categorias nos lançamentos (aluguel, produtos…) são do plano Premium. Para apagar um lançamento, use "Excluir" na linha dele.', 'Receitas de atendimentos só saem cancelando o atendimento na agenda. No plano Premium há "Exportar CSV".'] },
    ] },
    { ico: '📊', cor: '#a855f7', t: 'Comissões e relatórios', secoes: [
      { t: 'Comissões', passos: ['Abra <b>Comissões</b> (a partir do plano Profissional).', 'Para cada profissional: atendimentos concluídos, faturamento e valor da comissão no período, mais o total a pagar.', 'Ajuste a porcentagem direto na linha do profissional e toque em "Salvar". Vale para os próximos atendimentos concluídos.', 'Abaixo fica a lista detalhada dos atendimentos que geraram comissão.'] },
      { t: 'Relatórios', passos: ['Abra <b>Relatórios</b> (a partir do plano Profissional) e escolha o período.', 'Veja faturamento, atendimentos concluídos, total de agendamentos e a situação (agendados, concluídos, cancelados e faltas).', 'No plano Premium aparecem também ticket médio, taxa de cancelamento, serviços mais procurados, desempenho por profissional, melhores clientes, cancelamentos e faltas e origem dos agendamentos (interno ou online).', '"Exportar CSV" baixa os agendamentos do período (Premium).'] },
    ] },
    { ico: '🔗', cor: '#0ea5e9', t: 'Página de agendamento', secoes: [
      { t: 'O que seu cliente vê', passos: ['Em <b>Configurações</b> ou no Painel, copie o link da sua página e envie aos clientes (WhatsApp, Instagram, cartão).', 'O cliente escolhe o <b>serviço</b> (com foto, preço e duração), o <b>profissional</b> (se o plano permitir) e o <b>dia</b>. Só aparecem horários livres.', 'Se você cadastrou produtos, ele pode adicionar algum (opcional). Informa nome e telefone (e e-mail, se quiser) e confirma. A tela mostra um <b>código do agendamento</b>.', 'O cliente pode cancelar pela própria página usando esse código (a partir do plano Básico).', 'A agenda online fica aberta por 14 dias à frente; no plano Premium, por 60 dias.'],
        dica: 'Logo, descrição, endereço e telefone na página dependem do plano. O endereço da página (o nome no final do link) é personalizável no plano Premium.' },
      { t: 'Quando o cliente marca', passos: ['O agendamento cai na agenda como origem "online".', 'O app toca o som, vibra e mostra uma notificação, sem precisar atualizar a página.', 'Se o cliente cancelar pelo código, você também recebe um aviso.'] },
    ] },
    { ico: '🔔', cor: '#2563eb', t: 'Alertas e app no celular', secoes: [
      { t: 'Sino, som e avisos', mock: telaNot, passos: ['O sino no alto mostra quantas notificações ainda não foram lidas. Toque nele para ver os detalhes e em "Marcar todas como lidas" para limpar.', 'Você recebe aviso de: novo agendamento online, cancelamento pelo cliente, lembrete de atendimento próximo (a partir do plano Básico) e avisos sobre o seu plano.', 'No sino você liga ou desliga o <b>som de mensagem</b> e usa "Testar alerta".', 'Toque em "Ativar avisos no celular" e permita as notificações para o celular tocar mesmo com o app fechado.'],
        dica: 'No iPhone, primeiro adicione o app à Tela de Início (Compartilhar → Adicionar à Tela de Início) e abra por lá. O navegador só libera o som depois de um toque na tela.' },
      { t: 'Instalando como aplicativo', passos: ['No Android/Chrome, toque em "Instalar app" no alto da tela (ou no menu do navegador → Instalar aplicativo).', 'No iPhone/Safari, toque em Compartilhar → "Adicionar à Tela de Início".', 'O AGENDA X passa a abrir em tela cheia, como um aplicativo.'] },
    ] },
    { ico: '⚙️', cor: '#6b6580', t: 'Configurações e conta', secoes: [
      { t: 'Estabelecimento', passos: ['Em <b>Configurações → Estabelecimento</b> edite o nome, telefone, endereço e a apresentação que aparece na página de agendamento.', 'Escolha o <b>intervalo entre horários</b> e o <b>fuso horário</b> (fuso personalizado é do plano Premium).', 'Em <b>Configurações → Aparência</b> envie a logomarca e toque em "Salvar logomarca" (a partir do plano Básico).'] },
      { t: 'Aparência da página', passos: ['Em <b>Configurações → Aparência</b>, escolha a <b>Cor Principal</b> (botões e links), a <b>Cor Secundária</b> (cabeçalho escuro) e a <b>Cor de Destaque</b> (acentos).', 'Em "Fundo da Página de Agendamento" escolha <b>Cor Sólida</b> (seletor ou paleta rápida), <b>Temático</b> (barbearia, dourado, rosa, oceano, natureza, minimalista) ou <b>Imagem</b> (sua foto).', 'Veja a pré-visualização ao lado e toque em <b>Salvar aparência</b>. Cores e fundo estão disponíveis a partir do plano Profissional.'] },
      { t: 'Minha conta e segurança', passos: ['Em <b>Configurações → Minha conta</b> você altera a senha (isso encerra o acesso em outros aparelhos).', 'Gere um <b>novo código de recuperação</b> informando sua senha. O código anterior deixa de valer.', '"Baixar meus dados" guarda uma cópia de tudo o que está no app.', '"Excluir minha conta" apaga todos os dados de forma definitiva (pede a senha e que você digite EXCLUIR).'] },
    ] },
    { ico: '⭐', cor: '#a855f7', t: 'Planos e funções', dinamico: true, secoes: [
      { t: 'Teste grátis e assinatura', passos: ['Toda conta nova tem <b>14 dias com tudo liberado</b>. O aviso no topo mostra quantos dias restam.', 'Depois, você escolhe um plano ou continua no plano <b>Grátis</b>, sem perder nenhum dado.', 'Em <b>Minha assinatura</b> (menu lateral) veja o que cada plano libera, gere o <b>Pix</b> (QR Code ou Copia e Cola) e pague. Quando o pagamento é confirmado, o plano é liberado automaticamente por 30 dias. Perto do vencimento você recebe um aviso para renovar.'] },
    ] },
    { ico: '❓', cor: '#ea7a2f', t: 'Dúvidas frequentes', secoes: [
      { t: 'Soluções rápidas', passos: ['<b>Não consigo marcar um horário:</b> confira se o profissional atende no dia e horário (Disponibilidade) e se faz o serviço escolhido.', '<b>O cliente não vê um serviço na página:</b> o serviço precisa estar ativo e vinculado a um profissional ativo.', '<b>Apareceu "Upgrade" ou aviso de plano:</b> a função é de um plano superior ou o limite do seu plano foi atingido.', '<b>Não ouço o som:</b> toque uma vez na tela, confira se o som está "Ligado" no sino e se o volume do celular está alto.', '<b>Perdi o acesso:</b> use "Esqueci minha senha" com o código de recuperação. Sem o código, fale com o administrador do sistema.', '<b>Troquei de celular:</b> entre com seu e-mail e senha; os dados ficam no servidor, não no aparelho.'] },
    ] },
  ];
  const secao = (s, i) => `<div class="man-sec"><h4><i></i>${s.t}</h4>${s.mock || ''}<ol class="man-pass">${s.passos.map((p) => `<li><span>${p}</span></li>`).join('')}</ol>${s.dica ? `<div class="man-dica"><b>💡 Dica</b><p>${s.dica}</p></div>` : ''}</div>`;
  AX.manualAberto = AX.manualAberto == null ? 0 : AX.manualAberto;
  const planosHtml = (pl) => `<div class="man-sec"><h4><i></i>O que cada plano libera</h4><div class="man-planos">${pl.filter((p) => p.id !== 'gratis').map((p) => `<div class="man-plano"><b>${p.nome}</b> <span>${p.preco ? 'R$ ' + p.preco.toFixed(2).replace('.', ',') : 'R$ 0'}/mês</span>${p.herda ? `<small>Tudo do plano ${p.herda} e mais ${p.funcoes.length} funções (total: ${p.total_funcoes})</small>` : ''}<ul>${p.destaques.map((d) => `<li>${d}</li>`).join('')}${p.funcoes.map((f) => `<li>${f.nome}</li>`).join('')}</ul></div>`).join('')}</div><p class="muted small">O plano <b>Grátis</b> mantém agenda, clientes, serviços e a página de agendamento, com limites: ${(pl.find((p) => p.id === 'gratis') || {}).destaques.slice(2).join(', ').toLowerCase()}.</p></div>`;
  VIEWS.manual = async (el) => {
    let pl = []; try { pl = (await api('/api/planos')).planos; } catch (_) { /* sem lista de planos */ }
    el.innerHTML = `<div class="man">
      <div class="man-hd"><span class="man-ico">${icon('livro')}</span><div class="grow"><h2>Manual do Usuário</h2><div class="muted">AGENDA X · ${CAPS.length} capítulos</div></div><button class="btn primary" data-act="man-pdf">${icon('imprimir')} PDF</button></div>
      <div class="man-banner"><span>💈</span><div><b>Manual do Profissional</b><p>${CAPS.length} capítulos essenciais para gerenciar sua agenda, atendimentos, clientes e financeiro.</p></div></div>
      ${CAPS.map((c, i) => `<section class="man-card ${AX.manualAberto === i ? 'open' : ''}" data-cap="${i}"><button class="man-top" data-act="man-toggle" data-i="${i}" aria-expanded="${AX.manualAberto === i}"><span class="man-ci" style="background:${c.cor}1f">${c.ico}</span><span class="grow"><small style="color:${c.cor}">CAPÍTULO ${String(i + 1).padStart(2, '0')}</small><b>${c.t}</b></span><svg class="man-seta" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg></button><div class="man-body">${c.secoes.map(secao).join('')}${c.dinamico && pl.length ? planosHtml(pl) : ''}</div></section>`).join('')}
    </div>`;
  };
  act('man-toggle', (b) => {
    const i = parseInt(b.dataset.i, 10), card = b.closest('.man-card'), abrir = !card.classList.contains('open');
    document.querySelectorAll('.man-card.open').forEach((c) => { c.classList.remove('open'); c.querySelector('.man-top').setAttribute('aria-expanded', 'false'); });
    AX.manualAberto = abrir ? i : -1;
    if (abrir) { card.classList.add('open'); b.setAttribute('aria-expanded', 'true'); setTimeout(() => card.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60); }
  });
  act('man-pdf', () => {
    const antes = AX.manualAberto; document.querySelectorAll('.man-card').forEach((c) => c.classList.add('open'));
    window.print();
    setTimeout(() => document.querySelectorAll('.man-card').forEach((c, i) => c.classList.toggle('open', i === antes)), 500);
  });
})();
