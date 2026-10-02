'use strict';

/* =====================================================
   Compasso — lógica do aplicativo
   1) Kanban: planejamento → progresso → concluído
   2) Rádio de fundo via API radio-browser
   ===================================================== */

/* ---------------- Utilidades ---------------- */
const $  = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

const esc = (s = '') => String(s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

const carregarLS = (chave, padrao) => {
  try {
    const v = localStorage.getItem(chave);
    return v === null ? padrao : JSON.parse(v);
  } catch { return padrao; }
};
const salvarLS = (chave, valor) => {
  try { localStorage.setItem(chave, JSON.stringify(valor)); } catch { /* ignora quota */ }
};

const fmtData = (ts) => new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short' }).format(ts);

const bandeira = (cc) => (!cc || cc.length !== 2)
  ? ''
  : String.fromCodePoint(...[...cc.toUpperCase()].map((c) => 127397 + c.charCodeAt(0)));

function toast(msg, tipo = 'sucesso') {
  const el = document.createElement('div');
  el.className = `toast ${tipo}`;
  el.textContent = msg;
  $('#toasts').appendChild(el);
  setTimeout(() => {
    el.classList.add('saindo');
    setTimeout(() => el.remove(), 320);
  }, 3400);
}

function confete(x, y) {
  const cores = ['#2e7d54', '#24405e', '#9a6a1b', '#5c6675', '#b3382e', '#8fa3b8'];
  for (let i = 0; i < 18; i++) {
    const p = document.createElement('span');
    p.className = 'confete';
    p.style.left = `${x}px`;
    p.style.top = `${y}px`;
    p.style.background = cores[i % cores.length];
    p.style.setProperty('--dx', `${Math.random() * 260 - 130}px`);
    p.style.setProperty('--rot', `${Math.random() * 720 - 360}deg`);
    p.style.animationDelay = `${Math.random() * 120}ms`;
    document.body.appendChild(p);
    setTimeout(() => p.remove(), 1400);
  }
}

const novoId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

/* =====================================================
   1) TAREFAS (KANBAN)
   ===================================================== */

const ORDEM_STATUS = ['planejamento', 'progresso', 'concluido'];
const TEXTO_VAZIO = {
  planejamento: 'Nada planejado ainda.<br>Escreva a primeira nota do seu dia.',
  progresso: 'Nada tocando agora.<br>Arraste um cartão para a frente.',
  concluido: 'Nada concluído ainda.<br>Feche o seu primeiro compasso.',
};
const ROTULO_PRIORIDADE = { alta: 'Alta', media: 'Média', baixa: 'Baixa' };

let tarefas = carregarLS('focushub.tarefas', []);
let editandoId = null;
let arrastandoId = null;

const persistirTarefas = () => salvarLS('focushub.tarefas', tarefas);

/* ---------- Renderização ---------- */
function criarCard(t) {
  const card = document.createElement('article');
  card.className = `task-card prioridade-${t.prioridade}${t.status === 'concluido' ? ' concluido' : ''}`;
  card.draggable = true;
  card.dataset.id = t.id;

  const idx = ORDEM_STATUS.indexOf(t.status);
  const prazoAtrasado = t.prazo && t.status !== 'concluido' && new Date(t.prazo + 'T23:59:59') < new Date();

  card.innerHTML = `
    <div class="tc-top">
      <span class="tc-prioridade">${ROTULO_PRIORIDADE[t.prioridade]}</span>
      <span class="tc-data">${t.status === 'concluido' && t.concluidaEm ? 'concluída em ' + fmtData(t.concluidaEm) : 'criada em ' + fmtData(t.criadaEm)}</span>
    </div>
    <h4 class="tc-title">${esc(t.titulo)}</h4>
    ${t.descricao ? `<p class="tc-desc">${esc(t.descricao)}</p>` : ''}
    ${t.prazo ? `
      <div class="tc-meta">
        <span class="tc-badge ${prazoAtrasado ? 'atrasado' : ''}">prazo ${fmtData(new Date(t.prazo + 'T12:00:00').getTime())}${prazoAtrasado ? ' · atrasada' : ''}</span>
      </div>` : ''}
    <footer class="tc-actions">
      <div class="tc-move">
        <button class="tc-btn mover-esq" title="Mover para trás" ${idx === 0 ? 'disabled' : ''}>←</button>
        <button class="tc-btn mover-dir" title="Mover para frente" ${idx === ORDEM_STATUS.length - 1 ? 'disabled' : ''}>→</button>
      </div>
      <div class="tc-edit">
        <button class="tc-btn editar" title="Editar tarefa">✏️</button>
        <button class="tc-btn del excluir" title="Excluir tarefa">🗑️</button>
      </div>
    </footer>`;

  /* Ações dos botões */
  card.querySelector('.mover-esq').addEventListener('click', () => moverTarefa(t.id, -1));
  card.querySelector('.mover-dir').addEventListener('click', () => moverTarefa(t.id, 1));
  card.querySelector('.editar').addEventListener('click', () => abrirFormTarefa(t.id));
  card.querySelector('.excluir').addEventListener('click', () => {
    if (confirm(`Excluir a tarefa "${t.titulo}"?`)) {
      tarefas = tarefas.filter((x) => x.id !== t.id);
      persistirTarefas();
      renderizar();
      toast('Tarefa excluída.');
    }
  });

  /* Arrastar e soltar */
  card.addEventListener('dragstart', (e) => {
    arrastandoId = t.id;
    card.classList.add('dragging');
    e.dataTransfer.setData('text/plain', t.id);
    e.dataTransfer.effectAllowed = 'move';
  });
  card.addEventListener('dragend', () => {
    card.classList.remove('dragging');
    arrastandoId = null;
    $$('.col-body').forEach((c) => c.classList.remove('drop-hover'));
  });

  return card;
}

function renderizar() {
  const contagens = { planejamento: 0, progresso: 0, concluido: 0 };
  tarefas.forEach((t) => contagens[t.status]++);

  $('#statPlanejamento').textContent = contagens.planejamento;
  $('#statProgresso').textContent = contagens.progresso;
  $('#statConcluido').textContent = contagens.concluido;
  $('#countPlanejamento').textContent = contagens.planejamento;
  $('#countProgresso').textContent = contagens.progresso;
  $('#countConcluido').textContent = contagens.concluido;
  $('#btnLimparConcluidas').hidden = contagens.concluido === 0;

  for (const status of ORDEM_STATUS) {
    const corpo = $(`.col-body[data-status="${status}"]`);
    corpo.innerHTML = '';
    const lista = tarefas.filter((t) => t.status === status);
    if (lista.length === 0) {
      const vazio = document.createElement('div');
      vazio.className = 'col-empty';
      vazio.innerHTML = TEXTO_VAZIO[status];
      corpo.appendChild(vazio);
    } else {
      lista.forEach((t) => corpo.appendChild(criarCard(t)));
    }
  }

  /* Progresso geral */
  const total = tarefas.length;
  const pct = total ? Math.round((contagens.concluido / total) * 100) : 0;
  $('#pgPercent').textContent = `${pct}%`;
  $('#pgFill').style.width = `${pct}%`;
  $('#pgHint').textContent = total === 0
    ? 'Adicione a primeira nota do seu dia.'
    : pct === 100
      ? 'Compasso completo. Curta uma rádio para celebrar.'
      : `Você concluiu ${contagens.concluido} de ${total} tarefas. Mantenha o compasso.`;
}

/* ---------- Movimentação ---------- */
function moverPara(id, status) {
  const t = tarefas.find((x) => x.id === id);
  if (!t || t.status === status) return;

  const cardEl = $(`.task-card[data-id="${id}"]`);
  const concluiu = status === 'concluido' && t.status !== 'concluido';

  t.status = status;
  t.concluidaEm = status === 'concluido' ? Date.now() : null;
  persistirTarefas();
  renderizar();

  if (concluiu) {
    const r = cardEl ? cardEl.getBoundingClientRect() : { left: innerWidth / 2, top: innerHeight / 2 };
    confete(r.left + r.width / 2, r.top + r.height / 2);
    toast(`"${t.titulo}" concluída! 🎉`);
  }
}

function moverTarefa(id, direcao) {
  const t = tarefas.find((x) => x.id === id);
  if (!t) return;
  const idx = ORDEM_STATUS.indexOf(t.status) + direcao;
  if (idx < 0 || idx >= ORDEM_STATUS.length) return;
  moverPara(id, ORDEM_STATUS[idx]);
}

/* ---------- Formulário de tarefa ---------- */
function abrirFormTarefa(idParaEditar = null) {
  editandoId = idParaEditar;
  const form = $('#formTarefa');
  form.reset();

  if (idParaEditar) {
    const t = tarefas.find((x) => x.id === idParaEditar);
    if (!t) return;
    $('#modalTarefaTitulo').textContent = 'Editar tarefa';
    $('#inpTitulo').value = t.titulo;
    $('#inpDesc').value = t.descricao || '';
    $('#inpPrioridade').value = t.prioridade;
    $('#inpPrazo').value = t.prazo || '';
  } else {
    $('#modalTarefaTitulo').textContent = 'Nova tarefa';
  }

  $('#modalTarefa').classList.add('open');
  $('#modalTarefa').setAttribute('aria-hidden', 'false');
  setTimeout(() => $('#inpTitulo').focus(), 60);
}

function fecharModal(id) {
  $(`#${id}`).classList.remove('open');
  $(`#${id}`).setAttribute('aria-hidden', 'true');
  if (id === 'modalTarefa') editandoId = null;
}

$('#formTarefa').addEventListener('submit', (e) => {
  e.preventDefault();
  const titulo = $('#inpTitulo').value.trim();
  if (!titulo) { $('#inpTitulo').focus(); return; }

  const dados = {
    titulo,
    descricao: $('#inpDesc').value.trim(),
    prioridade: $('#inpPrioridade').value,
    prazo: $('#inpPrazo').value || null,
  };

  if (editandoId) {
    const t = tarefas.find((x) => x.id === editandoId);
    if (t) Object.assign(t, dados);
    toast('Tarefa atualizada.');
  } else {
    tarefas.unshift({
      id: novoId(),
      ...dados,
      status: 'planejamento',
      criadaEm: Date.now(),
      concluidaEm: null,
    });
    toast('Tarefa adicionada ao planejamento.');
  }

  persistirTarefas();
  renderizar();
  fecharModal('modalTarefa');
});

/* ---------- Eventos gerais do kanban ---------- */
$('#btnNovaTarefa').addEventListener('click', () => abrirFormTarefa());

$('#btnLimparConcluidas').addEventListener('click', () => {
  const n = tarefas.filter((t) => t.status === 'concluido').length;
  if (n && confirm(`Remover ${n} tarefa(s) concluída(s)?`)) {
    tarefas = tarefas.filter((t) => t.status !== 'concluido');
    persistirTarefas();
    renderizar();
    toast('Concluídas removidas.');
  }
});

$$('.col-body').forEach((corpo) => {
  corpo.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    corpo.classList.add('drop-hover');
  });
  corpo.addEventListener('dragleave', (e) => {
    if (!corpo.contains(e.relatedTarget)) corpo.classList.remove('drop-hover');
  });
  corpo.addEventListener('drop', (e) => {
    e.preventDefault();
    corpo.classList.remove('drop-hover');
    const id = e.dataTransfer.getData('text/plain') || arrastandoId;
    if (id) moverPara(id, corpo.dataset.status);
  });
});

/* =====================================================
   2) RÁDIO (API radio-browser)
   ===================================================== */

const SERVIDORES = [
  'https://de1.api.radio-browser.info',
  'https://fi1.api.radio-browser.info',
  'https://all.api.radio-browser.info',
];
let indiceServidor = 0;
let controleBusca = null;      // AbortController da busca atual
let estacoesAtuais = [];       // últimos resultados exibidos
let estacaoAtual = null;       // estação selecionada
let tocando = false;

const audio = $('#radioAudio');
audio.volume = carregarLS('focushub.volume', 0.7);
$('#mpVolume').value = Math.round(audio.volume * 100);

/* ---------- API com fallback de servidores ---------- */
async function apiRadio(caminho, sinal) {
  let ultimoErro;
  for (let i = 0; i < SERVIDORES.length; i++) {
    const base = SERVIDORES[(indiceServidor + i) % SERVIDORES.length];
    try {
      const resp = await fetch(base + caminho, { signal: sinal });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      indiceServidor = (indiceServidor + i) % SERVIDORES.length;
      return await resp.json();
    } catch (erro) {
      if (erro.name === 'AbortError') throw erro;
      ultimoErro = erro;
    }
  }
  throw ultimoErro || new Error('Sem conexão com a API');
}

async function buscarEstacoes({ nome = '', tag = '', countrycode = '' } = {}) {
  if (controleBusca) controleBusca.abort();
  controleBusca = new AbortController();

  mostrarSkeletons();
  $('#radioStatus').className = 'radio-status';
  $('#radioStatus').textContent = 'Buscando estações...';

  const params = new URLSearchParams({
    limit: '36',
    hidebroken: 'true',
    order: 'clickcount',
    reverse: 'true',
  });
  if (nome) params.set('name', nome);
  if (tag) params.set('tag', tag);
  if (countrycode) params.set('countrycode', countrycode);

  try {
    const brutas = await apiRadio(`/json/stations/search?${params}`, controleBusca.signal);

    const vistas = new Set();
    estacoesAtuais = brutas.filter((st) => {
      if (!st.lastcheckok) return false;
      if (!st.url_resolved && !st.url) return false;
      const chave = (st.name || '').trim().toLowerCase();
      if (vistas.has(chave)) return false;
      vistas.add(chave);
      return true;
    });

    renderizarEstacoes();

    $('#radioStatus').textContent = estacoesAtuais.length
      ? `${estacoesAtuais.length} ${countrycode === 'BR' ? 'estações brasileiras' : 'estações'} encontradas`
      : 'Nenhuma estação encontrada. Tente outra busca.';

    if (estacoesAtuais.length === 0) $('#radioResults').innerHTML =
      '<div class="col-empty" style="grid-column:1/-1">🔍 Nada por aqui.<br>Tente outro termo ou gênero.</div>';
  } catch (erro) {
    if (erro.name === 'AbortError') return;
    estacoesAtuais = [];
    $('#radioResults').innerHTML = '';
    $('#radioStatus').className = 'radio-status erro';
    $('#radioStatus').textContent = '⚠️ Não foi possível falar com a API radio-browser. Verifique sua internet e tente de novo.';
  }
}

/* ---------- Renderização dos resultados ---------- */
function mostrarSkeletons() {
  $('#radioResults').innerHTML = Array.from({ length: 8 }, () =>
    `<div class="station skeleton">
       <span class="st-icon"></span>
       <span class="st-info"><strong>&nbsp;</strong><span>&nbsp;</span></span>
       <span class="st-play">▶</span>
     </div>`).join('');
}

function renderizarEstacoes() {
  const cont = $('#radioResults');
  cont.innerHTML = '';

  for (const st of estacoesAtuais) {
    const el = document.createElement('button');
    el.className = 'station';
    el.type = 'button';
    el.dataset.uuid = st.stationuuid;

    const ehAtual = estacaoAtual && estacaoAtual.stationuuid === st.stationuuid;
    if (ehAtual && tocando) el.classList.add('tocando');

    const infoPais = [bandeira(st.countrycode), st.country].filter(Boolean).join(' ') || 'Global';
    const detalhes = [infoPais, st.bitrate ? `${st.bitrate} kbps` : '', st.codec && st.codec !== 'UNKNOWN' ? st.codec : '']
      .filter(Boolean).join(' · ');

    el.innerHTML = `
      <span class="st-icon">${st.favicon ? `<img src="${esc(st.favicon)}" alt="" loading="lazy" onerror="this.replaceWith('📻')">` : '📻'}</span>
      <span class="st-info">
        <strong>${esc(st.name || 'Estação sem nome')}</strong>
        <span>${esc(detalhes)}</span>
      </span>
      <span class="st-play">${ehAtual && tocando ? '⏸' : '▶'}</span>`;

    el.addEventListener('click', () => {
      if (ehAtual) {
        alternarReproducao();
      } else {
        tocarEstacao(st);
      }
    });
    cont.appendChild(el);
  }
}

/* ---------- Reprodução ---------- */
async function tocarEstacao(st) {
  estacaoAtual = st;
  salvarLS('focushub.estacao', st);
  atualizarMiniPlayer();
  $('#miniPlayer').hidden = false;
  posicionarPainelRadio(); /* o botão pode ter se movido no cabeçalho com a entrada do player */

  audio.src = st.url_resolved || st.url;
  try {
    definirEstado('buffering');
    await audio.play();
  } catch {
    /* Alguns navegadores podem bloquear; o estado é corrigido pelos eventos do áudio */
  }
  renderizarEstacoes();
}

function alternarReproducao() {
  if (!estacaoAtual) return;
  if (audio.paused) {
    audio.play().catch(() => toast('Não foi possível retomar a estação.', 'erro'));
  } else {
    audio.pause();
  }
}

function pararRadio() {
  audio.pause();
  audio.removeAttribute('src');
  audio.load();
  tocando = false;
  estacaoAtual = null;
  salvarLS('focushub.estacao', null);
  $('#miniPlayer').hidden = true;
  $('#miniPlayer').classList.remove('tocando', 'buffering');
  renderizarEstacoes();
}

function definirEstado(estado) {
  const player = $('#miniPlayer');
  player.classList.toggle('tocando', estado === 'tocando');
  player.classList.toggle('buffering', estado === 'buffering');
  $('#mpPlay').textContent = estado === 'tocando' ? '⏸' : '▶';
  tocando = estado === 'tocando';
  renderizarEstacoes();
}

function atualizarMiniPlayer() {
  if (!estacaoAtual) return;
  const st = estacaoAtual;
  $('#mpNome').textContent = st.name || 'Estação';
  $('#mpPais').textContent = [bandeira(st.countrycode), st.country, st.tags ? st.tags.split(',')[0] : '']
    .filter(Boolean).join(' · ');
  $('#mpIcon').innerHTML = st.favicon ? `<img src="${esc(st.favicon)}" alt="" onerror="this.replaceWith('📻')">` : '📻';
}

/* ---------- Eventos de áudio ---------- */
audio.addEventListener('playing', () => definirEstado('tocando'));
audio.addEventListener('pause', () => {
  if (estacaoAtual) definirEstado('pausado');
});
audio.addEventListener('waiting', () => definirEstado('buffering'));
audio.addEventListener('error', () => {
  if (!estacaoAtual || !audio.src) return;
  definirEstado('pausado');
  toast('⚠️ Esta estação está fora do ar. Tente outra.', 'erro');
});

/* ---------- Mini player ---------- */
$('#mpPlay').addEventListener('click', alternarReproducao);
$('#mpStop').addEventListener('click', pararRadio);
$('#mpVolume').addEventListener('input', (e) => {
  audio.volume = e.target.value / 100;
  salvarLS('focushub.volume', audio.volume);
});

/* ---------- Painel do rádio (popover ao lado esquerdo do botão) ---------- */
function posicionarPainelRadio() {
  const painel = $('#modalRadio');
  if (!painel.classList.contains('open')) return;

  const r = $('#btnAbrirRadio').getBoundingClientRect();
  const topo = Math.max(12, r.bottom + 10);
  const espacoEsquerda = r.left - 14;

  if (espacoEsquerda >= 360) {
    /* Painel cresce para a esquerda, com a borda direita encostada no botão */
    painel.style.left = 'auto';
    painel.style.right = `${innerWidth - r.left + 10}px`;
    painel.style.width = `${Math.min(560, espacoEsquerda)}px`;
  } else {
    /* Tela estreita: painel ocupa a largura disponível */
    painel.style.left = '12px';
    painel.style.right = '12px';
    painel.style.width = 'auto';
  }
  painel.style.top = `${topo}px`;
  painel.style.maxHeight = `${innerHeight - topo - 16}px`;
}

$('#btnAbrirRadio').addEventListener('click', () => {
  const painel = $('#modalRadio');
  if (painel.classList.contains('open')) {
    fecharModal('modalRadio');
    return;
  }
  painel.classList.add('open');
  painel.setAttribute('aria-hidden', 'false');
  posicionarPainelRadio();
  if (estacoesAtuais.length === 0) buscarEstacoes({ countrycode: 'BR' }); // rádios brasileiras por padrão
  setTimeout(() => $('#inpBuscaRadio').focus(), 60);
});

/* Reposiciona o painel se a janela ou a página mudarem enquanto ele estiver aberto */
window.addEventListener('resize', posicionarPainelRadio);
window.addEventListener('scroll', posicionarPainelRadio, { passive: true });

let timerBusca = null;
$('#inpBuscaRadio').addEventListener('input', (e) => {
  const termo = e.target.value.trim();
  $$('.chip').forEach((c) => c.classList.toggle('active', !termo && c.dataset.pais === 'BR'));
  clearTimeout(timerBusca);
  timerBusca = setTimeout(() => {
    if (termo) buscarEstacoes({ nome: termo });
    else buscarEstacoes({ countrycode: 'BR' }); // vazio → volta para as brasileiras
  }, 450);
});

$('#chipsGeneros').addEventListener('click', (e) => {
  const chip = e.target.closest('.chip');
  if (!chip) return;
  $$('.chip').forEach((c) => c.classList.remove('active'));
  chip.classList.add('active');
  $('#inpBuscaRadio').value = '';
  if (chip.dataset.tag !== undefined) buscarEstacoes({ tag: chip.dataset.tag });
  else buscarEstacoes({ countrycode: chip.dataset.pais || '' });
});

/* =====================================================
   Modais, atalhos e inicialização
   ===================================================== */

/* Fechar por overlay ou botão ✕ */
$$('.modal-overlay').forEach((overlay) => {
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) fecharModal(overlay.id);
  });
});
$$('[data-close]').forEach((btn) => {
  btn.addEventListener('click', () => fecharModal(btn.dataset.close));
});

/* Fecha o painel do rádio ao clicar fora dele */
document.addEventListener('click', (e) => {
  const painel = $('#modalRadio');
  if (!painel.classList.contains('open')) return;
  if (painel.contains(e.target) || $('#btnAbrirRadio').contains(e.target)) return;
  fecharModal('modalRadio');
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if ($('#modalRadio').classList.contains('open')) fecharModal('modalRadio');
    if ($('#modalTarefa').classList.contains('open')) fecharModal('modalTarefa');
  }
  /* Atalho: "n" abre nova tarefa (fora de inputs) */
  if (e.key.toLowerCase() === 'n' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)
      && !$('#modalTarefa').classList.contains('open') && !$('#modalRadio').classList.contains('open')) {
    abrirFormTarefa();
  }
});

/* ---------- Início ---------- */
(function iniciar() {
  renderizar();

  /* Restaura a última estação (pausada — navegadores bloqueiam autoplay) */
  const salva = carregarLS('focushub.estacao', null);
  if (salva && (salva.url_resolved || salva.url)) {
    estacaoAtual = salva;
    audio.src = salva.url_resolved || salva.url;
    atualizarMiniPlayer();
    $('#miniPlayer').hidden = false;
    definirEstado('pausado');
  }
})();
