'use strict';
// Central do Proprietário: rotas só para o dono. Tudo vem do banco real; nada é inventado.
// Receita = somente pagamentos com status 'aprovado'. Datas do painel no fuso de Fortaleza (UTC-3, sem horário de verão).
function montar(ctx) {
  const { get, post, db, L, PLANOS, soDono, ehDono, erro, PAG, notificar, registrarHist, instantaneo, logAtiv, sincronizarPagamento, expirarPendentes, urlPublica, pagPublico } = ctx;
  const FUSO = 'America/Fortaleza';
  const hoje = () => L.hojeLocal(FUSO);
  const LOC = "'-3 hours'";
  const soma = (de, ate) => db.prepare(`SELECT COALESCE(SUM(valor),0) v, COUNT(*) n FROM pagamentos WHERE status='aprovado' AND date(pago_em, ${LOC}) BETWEEN ? AND ?`).get(de, ate);
  const r2 = (n) => Math.round(n * 100) / 100;
  const mesesAtras = (n) => { const out = []; let [a, m] = hoje().slice(0, 7).split('-').map(Number); for (let i = 0; i < n; i++) { out.unshift(a + '-' + String(m).padStart(2, '0')); m--; if (m === 0) { m = 12; a--; } } return out; };

  function contas() {
    const ests = db.prepare('SELECT * FROM estabelecimentos ORDER BY id DESC').all();
    const us = new Map(db.prepare('SELECT estabelecimento_id id, nome, email FROM usuarios ORDER BY id DESC').all().map((u) => [u.id, u]));
    const pagou = new Set(db.prepare("SELECT DISTINCT estabelecimento_id id FROM pagamentos WHERE status='aprovado'").all().map((x) => x.id));
    const contr = new Map(db.prepare("SELECT estabelecimento_id id, MAX(quando) q FROM assinatura_historico WHERE para_status='ativa' GROUP BY 1").all().map((x) => [x.id, x.q]));
    return ests.map((e) => {
      const u = us.get(e.id) || {}, st = L.estadoAssinatura(e);
      return { id: e.id, nome: e.nome, responsavel: u.nome || '', email: u.email || '', criado_em: e.criado_em, plano: e.plano, plano_efetivo: st.plano_efetivo, status: st.status, vencida: !!st.vencida,
        dias_restantes: st.dias_restantes, trial_ate: e.trial_ate, assinatura_ate: e.assinatura_ate || null, suspenso: !!e.suspenso, dono: ehDono(u.email), pagou: pagou.has(e.id), contratado_em: contr.get(e.id) || null };
    });
  }
  const clientes = () => contas().filter((c) => !c.dono);

  get('/api/central/resumo', { semBloqueio: true }, (c) => {
    soDono(c); expirarPendentes();
    const cs = clientes(), h = hoje(), mes = h.slice(0, 7);
    const pg = (s) => db.prepare('SELECT COUNT(*) n, COALESCE(SUM(valor),0) v FROM pagamentos WHERE status = ?').get(s);
    const meses = mesesAtras(6);
    const novosCli = new Map(), novosAss = new Map();
    for (const x of cs) { const k = x.criado_em.slice(0, 7); novosCli.set(k, (novosCli.get(k) || 0) + 1); }
    for (const x of db.prepare("SELECT MIN(date(pago_em, " + LOC + ")) d FROM pagamentos WHERE status='aprovado' GROUP BY estabelecimento_id").all()) { const k = x.d.slice(0, 7); novosAss.set(k, (novosAss.get(k) || 0) + 1); }
    const atual = novosAss.get(meses[5]) || 0, ant = novosAss.get(meses[4]) || 0;
    return {
      gerado_em: new Date().toISOString(), mes_referencia: mes,
      indicadores: {
        clientes: cs.length,
        assinantes_total: cs.filter((x) => x.pagou || x.status === 'ativa').length,
        planos_ativos: cs.filter((x) => x.status === 'ativa').length,
        planos_gratuitos: cs.filter((x) => x.status === 'gratis').length,
        em_teste: cs.filter((x) => x.status === 'trial').length,
        pagamentos_pendentes: pg('pendente').n, pagamentos_aprovados: pg('aprovado').n,
        planos_vencidos: cs.filter((x) => x.vencida).length, suspensas: cs.filter((x) => x.suspenso).length,
        faturamento_mensal: r2(soma(mes + '-01', mes + '-31').v),
      },
      crescimento: { mes_atual: atual, mes_anterior: ant, variacao_pct: ant ? r2(((atual - ant) / ant) * 100) : null },
      serie_meses: meses.map((m) => ({ mes: m, novos_clientes: novosCli.get(m) || 0, novos_assinantes: novosAss.get(m) || 0 })),
    };
  });

  get('/api/central/planos', { semBloqueio: true }, (c) => {
    soDono(c);
    const cs = clientes();
    const assinaturas = cs.map((x) => ({ id: x.id, nome: x.nome, responsavel: x.responsavel, email: x.email, plano: x.status === 'trial' ? 'teste' : x.plano_efetivo, status: x.suspenso ? 'suspensa' : x.status, vencida: x.vencida,
      contratado_em: x.contratado_em, vence_em: x.status === 'trial' ? x.trial_ate : x.assinatura_ate, dias_restantes: x.dias_restantes, forma: x.status !== 'ativa' ? '' : (db.prepare("SELECT 1 FROM pagamentos WHERE estabelecimento_id = ? AND status='aprovado' AND validade_ate = ?").get(x.id, x.assinatura_ate) ? 'Pix' : 'Manual') }));
    const planos = Object.values(PLANOS).map((p) => ({ id: p.id, nome: p.nome, preco: p.preco, tipo: p.preco > 0 ? 'pago' : 'gratis', funcoes: p.total_funcoes, clientes: assinaturas.filter((a) => a.plano === p.id).length }));
    planos.push({ id: 'teste', nome: 'Teste grátis (14 dias)', preco: 0, tipo: 'gratis', funcoes: PLANOS.premium.total_funcoes, clientes: assinaturas.filter((a) => a.plano === 'teste').length });
    return { planos, assinaturas };
  });

  get('/api/central/contas/:id/historico', { semBloqueio: true }, (c) => {
    soDono(c);
    const id = parseInt(c.params.id, 10) || 0;
    const e = db.prepare('SELECT id, nome FROM estabelecimentos WHERE id = ?').get(id);
    if (!e) throw erro(404, 'Conta não encontrada.');
    return { conta: e,
      historico: db.prepare('SELECT quando, origem, de_plano, de_status, para_plano, para_status, detalhe, autor FROM assinatura_historico WHERE estabelecimento_id = ? ORDER BY id DESC LIMIT 100').all(id),
      pagamentos: db.prepare('SELECT id, plano, valor, status, criado_em, pago_em, validade_ate FROM pagamentos WHERE estabelecimento_id = ? ORDER BY id DESC LIMIT 50').all(id) };
  });

  post('/api/central/assinaturas/:id', { semBloqueio: true }, (c) => {
    soDono(c);
    const e = db.prepare('SELECT * FROM estabelecimentos WHERE id = ?').get(parseInt(c.params.id, 10) || 0);
    if (!e) throw erro(404, 'Conta não encontrada.');
    if (db.prepare('SELECT email FROM usuarios WHERE estabelecimento_id = ?').all(e.id).some((u) => ehDono(u.email))) throw erro(400, 'Contas de proprietário não podem ser alteradas por aqui.');
    const b = c.body || {}, acao = String(b.acao || '');
    if (b.confirmar !== true) throw erro(400, 'Confirmação necessária para alterar uma assinatura.');
    const antes = instantaneo(e.id); let detalhe;
    if (acao === 'ativar') {
      if (!PLANOS[b.plano] || b.plano === 'gratis') throw erro(400, 'Escolha um plano pago.');
      const dias = parseInt(b.dias, 10) || 30;
      if (dias < 1 || dias > 365) throw erro(400, 'Informe de 1 a 365 dias.');
      const ate = L.addDias(hoje(), dias);
      db.prepare("UPDATE estabelecimentos SET plano = ?, assinatura_status = 'ativa', assinatura_ate = ? WHERE id = ?").run(b.plano, ate, e.id);
      detalhe = `ativação manual do plano ${b.plano} por ${dias} dia(s), até ${ate}`;
      logAtiv(e.id, null, 'proprietario', 'manual', detalhe);
      notificar(e.id, 'assinatura', 'Plano atualizado ✅', `Seu plano ${PLANOS[b.plano].nome} foi liberado até ${ate.slice(8, 10)}/${ate.slice(5, 7)}/${ate.slice(0, 4)}.`);
    } else if (acao === 'cancelar') {
      if (L.estadoAssinatura(e).status !== 'ativa') throw erro(400, 'Esta conta não tem assinatura paga ativa.');
      db.prepare("UPDATE estabelecimentos SET assinatura_status = 'cancelada' WHERE id = ?").run(e.id);
      detalhe = 'assinatura cancelada manualmente (volta ao plano Grátis)';
      notificar(e.id, 'assinatura', 'Assinatura cancelada', 'Sua assinatura foi encerrada. Você voltou ao plano Grátis e seus dados continuam salvos.');
    } else throw erro(400, 'Ação inválida.');
    db.prepare('INSERT INTO admin_log (admin_email, estabelecimento_id, acao, detalhe) VALUES (?,?,?,?)').run(c.user.email, e.id, 'central_' + acao, detalhe);
    registrarHist(e.id, 'proprietario', antes, detalhe, c.user.email);
    return { ok: true, detalhe };
  });

  const ROTULO_PAG = { aprovado: 'Aprovado', pendente: 'Pendente', rejeitado: 'Recusado', cancelado: 'Cancelado', expirado: 'Expirado', divergente: 'Divergente' };
  get('/api/central/pagamentos', { semBloqueio: true }, (c) => {
    soDono(c); expirarPendentes();
    const st = String(c.query.status || ''), q = String(c.query.q || '').trim().toLowerCase();
    const linhas = db.prepare(`SELECT p.id, p.estabelecimento_id, e.nome cliente, (SELECT email FROM usuarios u WHERE u.estabelecimento_id = e.id ORDER BY u.id LIMIT 1) email, p.plano, p.valor, p.status, p.provedor, p.provedor_id transacao, p.criado_em, p.pago_em,
        (SELECT resultado FROM ativacoes_log a WHERE a.pagamento_id = p.id ORDER BY a.id DESC LIMIT 1) ultima_ativacao
      FROM pagamentos p JOIN estabelecimentos e ON e.id = p.estabelecimento_id ORDER BY p.id DESC LIMIT 500`).all()
      .filter((x) => (!st || x.status === st) && (!q || [x.cliente, x.email, x.transacao].join(' ').toLowerCase().includes(q)))
      .slice(0, 200).map((x) => ({ ...x, metodo: 'Pix', provedor: 'Mercado Pago', rotulo: ROTULO_PAG[x.status] || x.status }));
    const cont = {}; for (const r of db.prepare('SELECT status, COUNT(*) n, COALESCE(SUM(valor),0) v FROM pagamentos GROUP BY status').all()) cont[r.status] = { n: r.n, valor: r2(r.v) };
    return { pagamentos: linhas, contagem: cont };
  });

  post('/api/central/pagamentos/:id/reconsultar', { semBloqueio: true }, async (c) => {
    soDono(c);
    if (PAG.modo() === 'desligado') throw erro(400, 'Pagamentos não estão configurados neste servidor.');
    const pag = db.prepare('SELECT * FROM pagamentos WHERE id = ?').get(parseInt(c.params.id, 10) || 0);
    if (!pag) throw erro(404, 'Pagamento não encontrado.');
    let resultado;
    try { resultado = await sincronizarPagamento(pag, 'proprietario'); }
    catch (e) { if (e.status) { logAtiv(pag.estabelecimento_id, pag.id, 'proprietario', 'falha', 'Consulta manual: não foi possível falar com o Mercado Pago.'); throw erro(502, 'Não foi possível consultar o Mercado Pago agora.'); } throw e; }
    db.prepare('INSERT INTO admin_log (admin_email, estabelecimento_id, acao, detalhe) VALUES (?,?,?,?)').run(c.user.email, pag.estabelecimento_id, 'central_reconsultar', `pagamento ${pag.id} reconsultado: ${resultado}`);
    return { resultado, pagamento: pagPublico(db.prepare('SELECT * FROM pagamentos WHERE id = ?').get(pag.id)) };
  });

  const ROT_WEBHOOK = { aprovado: 'Aprovado e plano ativado', ja_processado: 'Repetido (já processado, sem duplicar)', divergente: 'Valor/dados não conferem: recusado', desconhecido: 'Pagamento não pertence a este sistema', assinatura_invalida: 'Assinatura inválida: recusado', pending: 'Pendente', in_process: 'Em análise', cancelled: 'Cancelado', rejected: 'Recusado' };
  get('/api/central/ativacoes', { semBloqueio: true }, (c) => {
    soDono(c);
    const ativacoes = db.prepare(`SELECT a.id, a.quando, a.origem, a.resultado, a.motivo, a.pagamento_id, e.nome cliente FROM ativacoes_log a LEFT JOIN estabelecimentos e ON e.id = a.estabelecimento_id ORDER BY a.id DESC LIMIT 100`).all();
    const webhooks = db.prepare(`SELECT w.id, w.recebido_em, w.provedor_id transacao, w.resultado, e.nome cliente FROM webhook_eventos w LEFT JOIN pagamentos p ON p.provedor_id = w.provedor_id LEFT JOIN estabelecimentos e ON e.id = p.estabelecimento_id ORDER BY w.id DESC LIMIT 50`).all().map((w) => ({ ...w, descricao: ROT_WEBHOOK[w.resultado] || w.resultado }));
    const n = (sql) => db.prepare(sql).get().n;
    const falhas7 = n("SELECT COUNT(*) n FROM ativacoes_log WHERE resultado IN ('falha','divergente') AND quando > datetime('now','-7 days')");
    const semAtiv = n("SELECT COUNT(*) n FROM pagamentos p WHERE p.status='aprovado' AND NOT EXISTS (SELECT 1 FROM ativacoes_log a WHERE a.pagamento_id = p.id AND a.resultado='ativado')");
    const dup = n("SELECT COUNT(*) n FROM (SELECT pagamento_id FROM ativacoes_log WHERE resultado='ativado' AND pagamento_id IS NOT NULL GROUP BY pagamento_id HAVING COUNT(*) > 1)");
    const inv = n("SELECT COUNT(*) n FROM webhook_eventos WHERE resultado='assinatura_invalida' AND recebido_em > datetime('now','-7 days')");
    const modo = PAG.modo();
    const verificacoes = [
      { id: 'config', ok: modo === 'producao' && !!process.env.MP_WEBHOOK_SECRET && !!urlPublica(), titulo: 'Mercado Pago configurado para pagamentos reais', detalhe: `Modo: ${modo}. Chave do webhook: ${process.env.MP_WEBHOOK_SECRET ? 'configurada' : 'FALTA'}. Endereço público: ${urlPublica() || 'FALTA (PUBLIC_URL)'}.` },
      { id: 'sem_ativacao', ok: semAtiv === 0, titulo: 'Todo pagamento aprovado tem uma ativação registrada', detalhe: semAtiv ? `${semAtiv} pagamento(s) aprovado(s) sem registro de ativação.` : 'Nenhuma inconsistência.' },
      { id: 'duplicadas', ok: dup === 0, titulo: 'Nenhum pagamento ativou o plano mais de uma vez', detalhe: dup ? `${dup} pagamento(s) com ativação duplicada.` : 'Nenhuma ativação duplicada.' },
      { id: 'falhas', ok: falhas7 === 0, titulo: 'Sem falhas ou divergências nos últimos 7 dias', detalhe: falhas7 ? `${falhas7} ocorrência(s). Veja o registro abaixo.` : 'Nenhuma falha registrada.' },
      { id: 'invalidos', ok: inv === 0, titulo: 'Sem avisos de pagamento com assinatura inválida (7 dias)', detalhe: inv ? `${inv} aviso(s) recusado(s) por assinatura inválida.` : 'Nenhum.' },
    ];
    return { saude: { modo, webhook_url: urlPublica() ? urlPublica() + '/api/webhooks/mercadopago' : '', segredo_webhook_configurado: !!process.env.MP_WEBHOOK_SECRET, token_configurado: modo !== 'desligado' }, verificacoes, ativacoes, webhooks };
  });

  get('/api/central/teste', { semBloqueio: true }, (c) => {
    soDono(c);
    const cs = clientes();
    const linha = (x) => ({ id: x.id, nome: x.nome, email: x.email, inicio: x.criado_em.slice(0, 10), fim: x.trial_ate, dias_restantes: x.status === 'trial' ? x.dias_restantes : 0,
      situacao: x.status === 'trial' ? 'em_teste' : (x.pagou || x.status === 'ativa') ? 'convertido' : 'encerrado' });
    const todos = cs.map(linha);
    const emTeste = todos.filter((x) => x.situacao === 'em_teste'), encerrados = todos.filter((x) => x.situacao !== 'em_teste'), conv = todos.filter((x) => x.situacao === 'convertido');
    return { em_teste: emTeste.length, encerrados: encerrados.length, convertidos: conv.length, taxa_conversao_pct: encerrados.length ? r2((conv.length / encerrados.length) * 100) : null, lista: todos };
  });

  get('/api/central/financeiro', { semBloqueio: true }, (c) => {
    soDono(c); expirarPendentes();
    const h = hoje(), mes = h.slice(0, 7);
    const total = db.prepare("SELECT COALESCE(SUM(valor),0) v, COUNT(*) n FROM pagamentos WHERE status='aprovado'").get();
    const pend = db.prepare("SELECT COALESCE(SUM(valor),0) v, COUNT(*) n FROM pagamentos WHERE status='pendente'").get();
    const diario = new Map(db.prepare(`SELECT date(pago_em, ${LOC}) d, SUM(valor) v FROM pagamentos WHERE status='aprovado' AND date(pago_em, ${LOC}) >= ? GROUP BY 1`).all(L.addDias(h, -29)).map((x) => [x.d, x.v]));
    const mensal = new Map(db.prepare(`SELECT substr(date(pago_em, ${LOC}),1,7) m, SUM(valor) v FROM pagamentos WHERE status='aprovado' GROUP BY 1`).all().map((x) => [x.m, x.v]));
    return {
      dia: r2(soma(h, h).v), semana: r2(soma(L.addDias(h, -6), h).v), mes: r2(soma(mes + '-01', mes + '-31').v), total_recebido: r2(total.v), pagamentos_aprovados: total.n,
      pendentes: { n: pend.n, valor: r2(pend.v) },
      serie_diaria: Array.from({ length: 30 }, (_, i) => { const d = L.addDias(h, i - 29); return { dia: d, valor: r2(diario.get(d) || 0) }; }),
      serie_mensal: mesesAtras(6).map((m) => ({ mes: m, valor: r2(mensal.get(m) || 0) })),
      por_plano: db.prepare("SELECT plano, COUNT(*) n, SUM(valor) v FROM pagamentos WHERE status='aprovado' GROUP BY plano ORDER BY v DESC").all().map((x) => ({ plano: x.plano, n: x.n, valor: r2(x.v) })),
      historico: db.prepare(`SELECT p.id, p.pago_em, p.valor, p.plano, p.provedor_id transacao, e.nome cliente FROM pagamentos p JOIN estabelecimentos e ON e.id = p.estabelecimento_id WHERE p.status='aprovado' ORDER BY p.pago_em DESC, p.id DESC LIMIT 100`).all(),
    };
  });

  get('/api/central/inteligencia', { semBloqueio: true }, (c) => {
    soDono(c); expirarPendentes();
    const cs = clientes(), h = hoje(), mes = h.slice(0, 7);
    const resumo = [], alertas = [], recomendacoes = [];
    const em = (s) => cs.filter((x) => x.status === s);
    const fat = soma(mes + '-01', mes + '-31'), total = db.prepare("SELECT COALESCE(SUM(valor),0) v, COUNT(*) n FROM pagamentos WHERE status='aprovado'").get();
    resumo.push(`${cs.length} cliente(s) cadastrado(s): ${em('trial').length} em teste, ${em('ativa').length} com plano pago ativo e ${em('gratis').length} no plano Grátis.`);
    resumo.push(total.n ? `Receita aprovada: R$ ${r2(fat.v).toFixed(2).replace('.', ',')} neste mês e R$ ${r2(total.v).toFixed(2).replace('.', ',')} no total (${total.n} pagamento(s)).` : 'Ainda não há nenhum pagamento aprovado.');
    const meses = mesesAtras(2);
    const novos = (m) => cs.filter((x) => x.criado_em.slice(0, 7) === m).length;
    resumo.push(`Novos cadastros: ${novos(meses[1])} neste mês e ${novos(meses[0])} no mês anterior.`);
    const vencendo = cs.filter((x) => x.status === 'ativa' && x.assinatura_ate && x.dias_restantes != null && x.dias_restantes <= 7).map((x) => ({ id: x.id, nome: x.nome, tipo: 'plano', dias: x.dias_restantes, data: x.assinatura_ate }));
    const testeAcabando = em('trial').filter((x) => x.dias_restantes <= 3).map((x) => ({ id: x.id, nome: x.nome, tipo: 'teste', dias: x.dias_restantes, data: x.trial_ate }));
    const g = (sql) => db.prepare(sql).get().n;
    const falhas = g("SELECT COUNT(*) n FROM ativacoes_log WHERE resultado IN ('falha','divergente') AND quando > datetime('now','-7 days')");
    const inval = g("SELECT COUNT(*) n FROM webhook_eventos WHERE resultado='assinatura_invalida' AND recebido_em > datetime('now','-7 days')");
    const semAtiv = g("SELECT COUNT(*) n FROM pagamentos p WHERE p.status='aprovado' AND NOT EXISTS (SELECT 1 FROM ativacoes_log a WHERE a.pagamento_id = p.id AND a.resultado='ativado')");
    const pendAntigos = g("SELECT COUNT(*) n FROM pagamentos WHERE status='pendente' AND criado_em < datetime('now','-30 minutes')");
    const modo = PAG.modo();
    if (modo === 'desligado') alertas.push({ nivel: 'alto', texto: 'Pagamentos desligados: falta a chave do Mercado Pago no servidor. Ninguém consegue assinar.' });
    else if (modo === 'teste') alertas.push({ nivel: 'alto', texto: 'O servidor está com chave de TESTE do Mercado Pago: pagamentos reais não serão cobrados.' });
    if (modo !== 'desligado' && !process.env.MP_WEBHOOK_SECRET) alertas.push({ nivel: 'alto', texto: 'Falta a chave secreta do webhook: avisos de pagamento serão recusados e o plano só libera pela consulta da tela.' });
    if (modo !== 'desligado' && !urlPublica()) alertas.push({ nivel: 'medio', texto: 'PUBLIC_URL não está definida: o Mercado Pago não sabe para onde avisar os pagamentos.' });
    if (falhas) alertas.push({ nivel: 'alto', texto: `${falhas} falha(s) ou divergência(s) de ativação nos últimos 7 dias. Veja a aba Ativação automática.` });
    if (semAtiv) alertas.push({ nivel: 'alto', texto: `${semAtiv} pagamento(s) aprovado(s) sem ativação registrada.` });
    if (inval) alertas.push({ nivel: 'medio', texto: `${inval} aviso(s) de pagamento recusado(s) por assinatura inválida nos últimos 7 dias.` });
    if (pendAntigos) alertas.push({ nivel: 'baixo', texto: `${pendAntigos} cobrança(s) Pix pendente(s) há mais de 30 minutos.` });
    if (testeAcabando.length) recomendacoes.push({ texto: `${testeAcabando.length} teste(s) grátis terminam em até 3 dias. É um bom momento para lembrar esses clientes de escolher um plano.`, base: testeAcabando.map((x) => x.nome).join(', ') });
    if (vencendo.length) recomendacoes.push({ texto: `${vencendo.length} assinatura(s) vencem em até 7 dias. A renovação é um novo Pix de 30 dias; avise esses clientes.`, base: vencendo.map((x) => x.nome).join(', ') });
    const vencidos = cs.filter((x) => x.vencida);
    if (vencidos.length) recomendacoes.push({ texto: `${vencidos.length} cliente(s) tiveram a assinatura vencida e voltaram ao plano Grátis. Vale um contato para recuperar.`, base: vencidos.map((x) => x.nome).join(', ') });
    const enc = cs.filter((x) => x.status !== 'trial'), conv = enc.filter((x) => x.pagou || x.status === 'ativa');
    if (enc.length >= 5) recomendacoes.push({ texto: `Conversão do teste: ${conv.length} de ${enc.length} (${r2((conv.length / enc.length) * 100)}%).${conv.length / enc.length < 0.2 ? ' Está baixa: considere acompanhar mais de perto os clientes durante os 14 dias.' : ''}`, base: 'testes encerrados' });
    if (!total.n && modo === 'producao') recomendacoes.push({ texto: 'Ainda não houve pagamento aprovado. Faça um Pix real do plano mais barato para confirmar a ativação automática de ponta a ponta.', base: 'nenhum pagamento aprovado no banco' });
    if (!cs.length) recomendacoes.push({ texto: 'Ainda não há clientes cadastrados. Divulgue o link do AGENDA X para começar.', base: 'nenhum cliente no banco' });
    if (!recomendacoes.length) recomendacoes.push({ texto: 'Sem recomendações no momento: não há pendências nos dados atuais.', base: 'dados atuais' });
    return { resumo, alertas, vencendo: [...vencendo, ...testeAcabando], recomendacoes };
  });
}
module.exports = { montar };
