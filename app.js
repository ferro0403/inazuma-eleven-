(() => {
  "use strict";

  const players = Array.isArray(globalThis.INAZUMA_PLAYERS) ? globalThis.INAZUMA_PLAYERS : [];
  const PAGE_SIZE = 48;
  const elementClass = {
    Fire: "fire",
    Forest: "forest",
    Wind: "wind",
    Mountain: "mountain",
  };
  const elementSymbol = {
    Fire: "◆",
    Forest: "✦",
    Wind: "➶",
    Mountain: "▲",
  };
  const state = { search: "", team: "", position: "", element: "", page: 1 };
  const nodes = {
    search: document.querySelector("#search"),
    team: document.querySelector("#team-filter"),
    position: document.querySelector("#position-filter"),
    element: document.querySelector("#element-filter"),
    reset: document.querySelector("#reset-filters"),
    emptyReset: document.querySelector("#empty-reset"),
    grid: document.querySelector("#player-grid"),
    empty: document.querySelector("#empty-state"),
    pagination: document.querySelector("#pagination"),
    count: document.querySelector("#result-count"),
    total: document.querySelector("#total-count"),
  };

  const collator = new Intl.Collator("en", { sensitivity: "base", numeric: true });

  function uniqueSorted(values) {
    return [...new Set(values.filter(Boolean))].sort(collator.compare);
  }

  function addOptions(select, values) {
    const fragment = document.createDocumentFragment();
    values.forEach((value) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = value;
      fragment.append(option);
    });
    select.append(fragment);
  }

  function playerTeams(player) {
    if (Array.isArray(player.teams)) return player.teams.filter(Boolean);
    return player.teams ? [player.teams] : [];
  }

  function matchingPlayers() {
    const needle = state.search.trim().toLocaleLowerCase();
    return players.filter((player) => {
      const searchableName = `${player.name || ""} ${player.nickname || ""}`.toLocaleLowerCase();
      return (!needle || searchableName.includes(needle))
        && (!state.team || playerTeams(player).includes(state.team))
        && (!state.position || player.position === state.position)
        && (!state.element || player.element === state.element);
    });
  }

  function card(player) {
    const article = document.createElement("article");
    article.className = "player-card";

    const portrait = document.createElement("div");
    portrait.className = "player-card__portrait";
    const image = document.createElement("img");
    image.src = player.imageUrl;
    image.alt = `${player.name} portrait`;
    image.loading = "lazy";
    image.decoding = "async";
    image.addEventListener("error", () => article.classList.add("player-card--image-error"), { once: true });
    portrait.append(image);

    const position = document.createElement("span");
    position.className = "position-badge";
    position.textContent = player.position || "—";
    portrait.append(position);

    const body = document.createElement("div");
    body.className = "player-card__body";
    const meta = document.createElement("p");
    meta.className = "player-card__meta";
    meta.textContent = `NO. ${player.id}`;
    const name = document.createElement("h3");
    name.textContent = player.name;
    const team = document.createElement("p");
    team.className = "player-card__team";
    team.textContent = playerTeams(player).join(" · ") || "Unaffiliated";
    const element = document.createElement("span");
    const color = elementClass[player.element] || "neutral";
    element.className = `element element--${color}`;
    const symbol = document.createElement("span");
    symbol.setAttribute("aria-hidden", "true");
    symbol.textContent = elementSymbol[player.element] || "●";
    element.append(symbol, ` ${player.element || "Unknown"}`);
    body.append(meta, name, team, element);
    article.append(portrait, body);
    return article;
  }

  function pageItems(totalPages, current) {
    if (totalPages <= 7) return Array.from({ length: totalPages }, (_, index) => index + 1);
    const pages = new Set([1, totalPages, current - 1, current, current + 1]);
    const sorted = [...pages].filter((page) => page > 0 && page <= totalPages).sort((a, b) => a - b);
    const items = [];
    sorted.forEach((page, index) => {
      if (index && page - sorted[index - 1] > 1) items.push("…");
      items.push(page);
    });
    return items;
  }

  function renderPagination(total) {
    const totalPages = Math.ceil(total / PAGE_SIZE);
    nodes.pagination.replaceChildren();
    if (totalPages <= 1) return;

    const makeButton = (label, page, disabled = false, current = false) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = label;
      button.disabled = disabled;
      if (current) button.setAttribute("aria-current", "page");
      button.addEventListener("click", () => {
        state.page = page;
        render();
        document.querySelector(".results__heading").scrollIntoView({ behavior: "smooth", block: "start" });
      });
      return button;
    };

    nodes.pagination.append(makeButton("Previous", state.page - 1, state.page === 1));
    pageItems(totalPages, state.page).forEach((item) => {
      if (item === "…") {
        const ellipsis = document.createElement("span");
        ellipsis.textContent = item;
        nodes.pagination.append(ellipsis);
      } else {
        nodes.pagination.append(makeButton(String(item), item, false, item === state.page));
      }
    });
    nodes.pagination.append(makeButton("Next", state.page + 1, state.page === totalPages));
  }

  function render() {
    const filtered = matchingPlayers();
    const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
    state.page = Math.min(state.page, totalPages);
    const start = (state.page - 1) * PAGE_SIZE;
    const visible = filtered.slice(start, start + PAGE_SIZE);
    const fragment = document.createDocumentFragment();
    visible.forEach((player) => fragment.append(card(player)));
    nodes.grid.replaceChildren(fragment);
    nodes.empty.hidden = filtered.length !== 0;
    nodes.grid.hidden = filtered.length === 0;
    nodes.count.textContent = `${filtered.toLocaleString()} ${filtered.length === 1 ? "player" : "players"}`;
    renderPagination(filtered.length);
  }

  function resetFilters() {
    state.search = state.team = state.position = state.element = "";
    state.page = 1;
    nodes.search.value = nodes.team.value = nodes.position.value = nodes.element.value = "";
    render();
  }

  addOptions(nodes.team, uniqueSorted(players.flatMap(playerTeams)));
  addOptions(nodes.position, uniqueSorted(players.map((player) => player.position)));
  addOptions(nodes.element, uniqueSorted(players.map((player) => player.element)));
  nodes.total.textContent = players.length.toLocaleString();

  let searchTimer;
  nodes.search.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.search = nodes.search.value;
      state.page = 1;
      render();
    }, 100);
  });
  [[nodes.team, "team"], [nodes.position, "position"], [nodes.element, "element"]].forEach(([select, key]) => {
    select.addEventListener("change", () => {
      state[key] = select.value;
      state.page = 1;
      render();
    });
  });
  nodes.reset.addEventListener("click", resetFilters);
  nodes.emptyReset.addEventListener("click", resetFilters);
  render();
})();
