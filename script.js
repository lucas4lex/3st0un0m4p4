import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js";

const URL_GEOJSON =
  "https://raw.githubusercontent.com/codeforamerica/click_that_hood/master/public/data/brazil-states.geojson";

const $ = (seletor) => document.querySelector(seletor);

const mapaElement = $("#mapa");
const carregandoElement = $("#mapaCarregando");
const listaElement = $("#listaPessoas");
const mensagemElement = $("#mensagem");
const campoBusca = $("#campoBusca");
const tooltipElement = $("#tooltipMapa");

let informacoes = { projeto: {}, pessoas: [] };
let pessoasVisiveis = [];
let marcadores = new Map();

let cena;
let camera;
let renderizador;
let grupoMapa;
let grupoEstados;
let grupoPessoas;
let animacaoId = null;

let raycaster;
let ponteiro = new THREE.Vector2();
let marcadorApontado = null;
let pessoaSelecionada = null;

let arrastando = false;
let movimento = false;
let inicioX = 0;
let inicioY = 0;
let rotacaoInicialX = 0;
let rotacaoInicialZ = 0;
let distanciaInicial = 0;

const materialTerreno = new THREE.MeshStandardMaterial({
  color: 0x167d66,
  roughness: 0.65,
  metalness: 0.08
});

const materialBorda = new THREE.LineBasicMaterial({
  color: 0x6ee7b7,
  transparent: true,
  opacity: 0.55
});

const materialMarcador = new THREE.MeshStandardMaterial({
  color: 0xf9d44b,
  emissive: 0x795500,
  emissiveIntensity: 0.7,
  roughness: 0.3,
  metalness: 0.15
});

const materialSelecionado = new THREE.MeshStandardMaterial({
  color: 0x36df94,
  emissive: 0x08764a,
  emissiveIntensity: 1
});

/* =====================================================
   UTILITÁRIOS
===================================================== */

function normalizar(valor) {
  return String(valor ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function escaparHTML(valor) {
  return String(valor ?? "").replace(/[&<>"']/g, (caractere) => {
    const entidades = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    };

    return entidades[caractere];
  });
}

function obterParametros() {
  return new URLSearchParams(window.location.search);
}

function atualizarURL(chave, valor) {
  const url = new URL(window.location.href);

  if (valor) {
    url.searchParams.set(chave, valor);
  } else {
    url.searchParams.delete(chave);
  }

  window.history.replaceState({}, "", url);
}

function mostrarMensagem(texto) {
  mensagemElement.textContent = texto;
}

function esconderCarregamento() {
  carregandoElement.hidden = true;
}

function mostrarErroMapa(texto) {
  carregandoElement.hidden = false;
  carregandoElement.innerHTML = `
    <strong>Não foi possível carregar o mapa</strong>
    <span>${escaparHTML(texto)}</span>
    <button id="tentarMapa" type="button">Tentar novamente</button>
  `;

  $("#tentarMapa")?.addEventListener("click", iniciarMapa);
}

/* =====================================================
   CARREGAMENTO DO INFO.JSON
===================================================== */

async function carregarInformacoes() {
  try {
    const resposta = await fetch("./info.json", {
      cache: "no-store"
    });

    if (!resposta.ok) {
      throw new Error(`O servidor respondeu com HTTP ${resposta.status}.`);
    }

    const dados = await resposta.json();

    if (!dados || !Array.isArray(dados.pessoas)) {
      throw new Error(
        'O arquivo info.json precisa conter uma lista chamada "pessoas".'
      );
    }

    informacoes = dados;

    // Apenas pessoas com visivel: true aparecem publicamente.
    pessoasVisiveis = dados.pessoas.filter((pessoa) => {
      return (
        pessoa.visivel === true &&
        pessoa.id !== undefined &&
        pessoa.nome &&
        Number.isFinite(Number(pessoa.latitude)) &&
        Number.isFinite(Number(pessoa.longitude)) &&
        Number(pessoa.latitude) >= -90 &&
        Number(pessoa.latitude) <= 90 &&
        Number(pessoa.longitude) >= -180 &&
        Number(pessoa.longitude) <= 180
      );
    });

    $("#totalPessoas").textContent = pessoasVisiveis.length;

    const estados = new Set(
      pessoasVisiveis.map((pessoa) => pessoa.uf).filter(Boolean)
    );

    $("#totalEstados").textContent = estados.size;

    document.title =
      `${informacoes.projeto?.nome || "3st0un0m4p4"} — ` +
      `${informacoes.projeto?.slogan || "Estou no Mapa"}`;

    renderizarPessoas();
    posicionarMarcadores();

  } catch (erro) {
    console.error("Erro ao carregar info.json:", erro);

    mostrarMensagem(
      "Erro ao carregar info.json. Confira o nome do arquivo, o JSON e se os arquivos estão publicados juntos."
    );

    $("#totalPessoas").textContent = "—";
    $("#totalEstados").textContent = "—";
    $("#contadorResultados").textContent = "Indisponível";
  }
}

/* =====================================================
   PESQUISA E PARÂMETROS DA URL
===================================================== */

function filtrarPessoas() {
  const parametros = obterParametros();

  const id = parametros.get("pessoa");
  const uf = parametros.get("uf");
  const cidade = parametros.get("cidade");
  const busca = parametros.get("buscar");

  let resultado = [...pessoasVisiveis];

  if (id) {
    resultado = resultado.filter(
      (pessoa) => String(pessoa.id) === id
    );
  }

  if (uf) {
    resultado = resultado.filter(
      (pessoa) => normalizar(pessoa.uf) === normalizar(uf)
    );
  }

  if (cidade) {
    resultado = resultado.filter(
      (pessoa) => normalizar(pessoa.cidade) === normalizar(cidade)
    );
  }

  if (busca) {
    const termo = normalizar(busca);

    resultado = resultado.filter((pessoa) => {
      const conteudo = [
        pessoa.nome,
        pessoa.cidade,
        pessoa.estado,
        pessoa.uf,
        pessoa.descricao,
        pessoa.categoria
      ].map(normalizar).join(" ");

      return conteudo.includes(termo);
    });
  }

  return resultado;
}

function aplicarFiltros() {
  const parametros = obterParametros();
  const busca = parametros.get("buscar") || "";

  campoBusca.value = busca;

  renderizarPessoas();
  atualizarDestaque();

  const pessoaId = parametros.get("pessoa");

  if (pessoaId) {
    const pessoa = pessoasVisiveis.find(
      (item) => String(item.id) === pessoaId
    );

    if (pessoa) {
      selecionarPessoa(pessoa, false);
    }
  }
}

$("#formBusca").addEventListener("submit", (evento) => {
  evento.preventDefault();

  const termo = campoBusca.value.trim();
  const url = new URL(window.location.href);

  url.searchParams.delete("pessoa");
  url.searchParams.delete("uf");
  url.searchParams.delete("cidade");

  if (termo) {
    url.searchParams.set("buscar", termo);
  } else {
    url.searchParams.delete("buscar");
  }

  window.history.pushState({}, "", url);
  aplicarFiltros();
});

window.addEventListener("popstate", aplicarFiltros);

/* =====================================================
   CARTÕES DAS PESSOAS
===================================================== */

function renderizarPessoas() {
  const pessoas = filtrarPessoas();

  $("#tituloResultados").textContent =
    obterParametros().has("pessoa")
      ? "Pessoa selecionada"
      : "Pessoas no mapa";

  $("#contadorResultados").textContent =
    `${pessoas.length} ${pessoas.length === 1 ? "resultado" : "resultados"}`;

  listaElement.innerHTML = "";

  if (!pessoas.length) {
    mostrarMensagem(
      "Nenhuma pessoa encontrada. Tente outro nome, cidade ou estado."
    );
    return;
  }

  mostrarMensagem("");

  const fragmento = document.createDocumentFragment();

  pessoas.forEach((pessoa) => {
    const card = document.createElement("article");
    card.className = "person-card";
    card.dataset.id = String(pessoa.id);

    if (String(pessoa
