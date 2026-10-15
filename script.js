async function carregarInformacoes() {
  const loading = document.getElementById("map-loading");

  try {
    const resposta = await fetch("./info.json", {
      cache: "no-store"
    });

    if (!resposta.ok) {
      throw new Error(`Erro HTTP ${resposta.status}`);
    }

    const info = await resposta.json();

    console.log("Informações carregadas:", info);

    const pessoas = (info.pessoas || [])
      .filter(pessoa => pessoa.visivel === true);

    console.log("Pessoas visíveis no mapa:", pessoas);

    if (loading) {
      loading.textContent =
        `${pessoas.length} pessoa(s) encontrada(s)!`;
    }

    // Use "pessoas" para criar os marcadores no mapa 3D.
    return pessoas;

  } catch (erro) {
    console.error("Erro ao carregar info.json:", erro);

    if (loading) {
      loading.textContent =
        "Não foi possível carregar os cadastros. Verifique o info.json.";
    }

    return [];
  }
}

carregarInformacoes();
