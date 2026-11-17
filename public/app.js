'use strict';

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho',
               'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const PAGINAS = ['painel', 'receitas', 'despesas', 'contas', 'relatorio'];

const $ = (id) => document.getElementById(id);
const brl = (v) => Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const dataBR = (iso) => iso.split('-').reverse().join('/');
const soma = (lista) => Math.round(lista.reduce((s, t) => s + t.valor, 0) * 100) / 100;

function hojeISO() {
  const agora = new Date();
  return new Date(agora.getTime() - agora.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function rotuloMes(ym) {
  const [ano, mes] = ym.split('-');
  return `${MESES[Number(mes) - 1]} de ${ano}`;
}

function deslocarMes(ym, delta) {
  const [ano, mes] = ym.split('-').map(Number);
  const d = new Date(ano, mes - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function el(tag, classe, texto) {
  const e = document.createElement(tag);
  if (classe) e.className = classe;
  if (texto !== undefined) e.textContent = texto;
  return e;
}

async function api(url, opcoes) {
  const resposta = await fetch(url, opcoes);
  if (resposta.status === 204) return null;
  const corpo = await resposta.json().catch(() => ({}));
  if (!resposta.ok) throw new Error(corpo.erro || 'Não foi possível concluir a operação.');
  return corpo;
}

const enviar = (url, metodo, corpo) =>
  api(url, {
    method: metodo,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(corpo),
  });

function mostrarAviso(texto) {
  $('aviso').textContent = texto || '';
  $('aviso').hidden = !texto;
}

function mensagemDoForm(form, texto, tipo) {
  const m = form.querySelector('.mensagem');
  m.textContent = texto;
  m.className = 'mensagem' + (tipo ? ' ' + tipo : '');
}

function listaVazia(ul, texto) {
  ul.replaceChildren(el('li', 'vazio', texto));
}

/* ---------- Navegação entre as seções ---------- */
let paginaAtual = 'painel';
let mesRelatorio = hojeISO().slice(0, 7);

function mostrarPagina() {
  const pedida = location.hash.slice(1);
  paginaAtual = PAGINAS.includes(pedida) ? pedida : 'painel';
  PAGINAS.forEach((p) => { $(p).hidden = p !== paginaAtual; });
  document.querySelectorAll('#menu a').forEach((a) => {
    if (a.getAttribute('href') === '#' + paginaAtual) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  carregarPagina();
}

async function carregarPagina() {
  try {
    mostrarAviso('');
    if (paginaAtual === 'painel') await carregarPainel();
    else if (paginaAtual === 'receitas') await carregarTransacoes('receita');
    else if (paginaAtual === 'despesas') await carregarTransacoes('despesa');
    else if (paginaAtual === 'contas') await carregarContas();
    else await carregarRelatorio();
  } catch (erro) {
    mostrarAviso('Não foi possível carregar os dados. Confira se o servidor está no ar.');
  }
}

/* ---------- 1. Painel ---------- */
function statusConta(conta) {
  if (conta.pago) return 'paga';
  return conta.vencimento < hojeISO() ? 'vencida' : 'pendente';
}

const ROTULO_STATUS = { paga: 'Paga', pendente: 'Pendente', vencida: 'Vencida' };

async function carregarPainel() {
  const [resumo, contas] = await Promise.all([api('/api/resumo'), api('/api/contas')]);

  $('p-saldo').textContent = brl(resumo.saldo);
  $('p-saldo').classList.toggle('negativo', resumo.saldo < 0);
  $('p-receitas').textContent = brl(resumo.receitas);
  $('p-despesas').textContent = brl(resumo.despesas);

  const pendentes = contas.filter((c) => !c.pago);
  const { quantidade, total } = resumo.pendentes;
  $('p-pendentes-resumo').textContent = quantidade
    ? `${quantidade} ${quantidade === 1 ? 'conta pendente' : 'contas pendentes'}, somando ${brl(total)}.`
    : 'Nenhuma conta pendente.';

  const ul = $('p-contas');
  ul.replaceChildren();
  pendentes.slice(0, 5).forEach((c) => ul.append(criarItemConta(c, false)));
}

/* ---------- 2 e 3. Receitas e despesas ---------- */
function criarItemTransacao(t, aoExcluir) {
  const li = el('li', 'item');
  li.append(el('span', 'item-descricao', t.descricao));
  li.append(el('span', 'item-valor ' + t.tipo, (t.tipo === 'despesa' ? '− ' : '+ ') + brl(t.valor)));

  const meta = el('span', 'item-meta');
  meta.append(el('span', '', dataBR(t.data)), el('span', '', t.categoria));
  if (t.conta_id) meta.append(el('span', 'etiqueta paga', 'Conta paga'));
  li.append(meta);

  if (aoExcluir) {
    const acoes = el('div', 'item-acoes');
    const excluir = el('button', 'acao-item perigo', 'Excluir');
    excluir.type = 'button';
    excluir.setAttribute('aria-label', 'Excluir ' + t.descricao);
    excluir.addEventListener('click', () => aoExcluir(t));
    acoes.append(excluir);
    li.append(acoes);
  }
  return li;
}

async function excluirTransacao(t) {
  if (t.conta_id && !confirm('Esta despesa veio do pagamento de uma conta. Excluir faz a conta voltar para pendente. Continuar?')) {
    return;
  }
  try {
    await api('/api/transacoes/' + t.id, { method: 'DELETE' });
    carregarPagina();
  } catch (erro) {
    mostrarAviso(erro.message);
  }
}

async function carregarTransacoes(tipo) {
  const lista = await api('/api/transacoes?tipo=' + tipo);
  document.querySelector(`[data-total="${tipo}"]`).textContent = brl(soma(lista));
  const ul = document.querySelector(`[data-lista="${tipo}"]`);
  if (!lista.length) {
    listaVazia(ul, tipo === 'receita' ? 'Nenhuma receita cadastrada.' : 'Nenhuma despesa cadastrada.');
    return;
  }
  ul.replaceChildren(...lista.map((t) => criarItemTransacao(t, excluirTransacao)));
}

document.querySelectorAll('form[data-tipo]').forEach((form) => {
  form.addEventListener('submit', async (evento) => {
    evento.preventDefault();
    const campos = new FormData(form);
    try {
      await enviar('/api/transacoes', 'POST', {
        tipo: form.dataset.tipo,
        descricao: campos.get('descricao'),
        valor: Number(campos.get('valor')),
        data: campos.get('data'),
        categoria: campos.get('categoria'),
      });
      form.reset();
      mensagemDoForm(form, form.dataset.tipo === 'receita' ? 'Receita adicionada.' : 'Despesa adicionada.', 'ok');
      carregarPagina();
    } catch (erro) {
      mensagemDoForm(form, erro.message, 'erro');
    }
  });
});

/* ---------- 4. Contas a pagar ---------- */
function criarItemConta(conta, comAcoes) {
  const status = statusConta(conta);
  const li = el('li', 'item');
  li.append(el('span', 'item-descricao', conta.descricao));
  li.append(el('span', 'item-valor', brl(conta.valor)));

  const meta = el('span', 'item-meta');
  meta.append(el('span', '', conta.pago && conta.pago_em
    ? 'Paga em ' + dataBR(conta.pago_em)
    : 'Vence em ' + dataBR(conta.vencimento)));
  meta.append(el('span', 'etiqueta ' + status, ROTULO_STATUS[status]));
  li.append(meta);

  if (comAcoes) {
    const acoes = el('div', 'item-acoes');

    const alternar = el('button', 'acao-item', conta.pago ? 'Marcar como pendente' : 'Marcar como paga');
    alternar.type = 'button';
    alternar.addEventListener('click', async () => {
      try {
        await enviar('/api/contas/' + conta.id, 'PATCH', { pago: !conta.pago, pago_em: hojeISO() });
        carregarPagina();
      } catch (erro) {
        mostrarAviso(erro.message);
      }
    });

    const excluir = el('button', 'acao-item perigo', 'Excluir');
    excluir.type = 'button';
    excluir.setAttribute('aria-label', 'Excluir conta ' + conta.descricao);
    excluir.addEventListener('click', async () => {
      try {
        await api('/api/contas/' + conta.id, { method: 'DELETE' });
        carregarPagina();
      } catch (erro) {
        mostrarAviso(erro.message);
      }
    });

    acoes.append(alternar, excluir);
    li.append(acoes);
  }
  return li;
}

async function carregarContas() {
  const contas = await api('/api/contas');
  $('c-pendentes').textContent = brl(soma(contas.filter((c) => !c.pago)));
  const ul = $('c-lista');
  if (!contas.length) {
    listaVazia(ul, 'Nenhuma conta cadastrada.');
    return;
  }
  ul.replaceChildren(...contas.map((c) => criarItemConta(c, true)));
}

$('form-conta').addEventListener('submit', async (evento) => {
  evento.preventDefault();
  const form = evento.target;
  const campos = new FormData(form);
  try {
    await enviar('/api/contas', 'POST', {
      descricao: campos.get('descricao'),
      valor: Number(campos.get('valor')),
      vencimento: campos.get('vencimento'),
    });
    form.reset();
    mensagemDoForm(form, 'Conta adicionada.', 'ok');
    carregarPagina();
  } catch (erro) {
    mensagemDoForm(form, erro.message, 'erro');
  }
});

/* ---------- 5. Relatório mensal ---------- */
async function carregarRelatorio() {
  $('mes-rotulo').textContent = rotuloMes(mesRelatorio);
  const [rel, movimentos] = await Promise.all([
    api('/api/relatorio?mes=' + mesRelatorio),
    api('/api/transacoes?mes=' + mesRelatorio),
  ]);

  $('r-recebido').textContent = brl(rel.recebido);
  $('r-gasto').textContent = brl(rel.gasto);
  const sobrou = $('r-sobrou');
  sobrou.textContent = brl(rel.sobrou);
  sobrou.className = rel.sobrou < 0 ? 'neg' : 'pos';

  const categorias = $('r-categorias');
  if (!rel.categorias.length) {
    listaVazia(categorias, 'Nenhuma despesa neste mês.');
  } else {
    categorias.replaceChildren(...rel.categorias.map((c) => {
      const li = el('li');
      li.append(el('span', '', c.categoria), el('span', 'valor', brl(c.total)));
      const trilho = el('span', 'trilho');
      const barra = el('span', 'preenchimento');
      barra.style.width = rel.gasto ? (c.total / rel.gasto) * 100 + '%' : '0';
      trilho.append(barra);
      li.append(trilho);
      return li;
    }));
  }

  const lista = $('r-movimentos');
  if (!movimentos.length) listaVazia(lista, 'Nenhum movimento neste mês.');
  else lista.replaceChildren(...movimentos.map((t) => criarItemTransacao(t, null)));
}

$('mes-anterior').addEventListener('click', () => {
  mesRelatorio = deslocarMes(mesRelatorio, -1);
  carregarPagina();
});
$('mes-seguinte').addEventListener('click', () => {
  mesRelatorio = deslocarMes(mesRelatorio, 1);
  carregarPagina();
});

/* ---------- Início ---------- */
document.querySelectorAll('input[type="date"]').forEach((campo) => { campo.defaultValue = hojeISO(); campo.value = hojeISO(); });
window.addEventListener('hashchange', mostrarPagina);
mostrarPagina();
