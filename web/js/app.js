(() => {
  const CHIPS = ["消防", "押运", "诈骗", "交通", "巡逻", "守护"];
  const MAX_LIST = 80;
  const STORE_KEY = "baoan-practice-v1";

  const els = {
    metaLine: document.getElementById("metaLine"),
    tabSearch: document.getElementById("tabSearch"),
    tabPractice: document.getElementById("tabPractice"),
    searchView: document.getElementById("searchView"),
    practiceView: document.getElementById("practiceView"),
    input: document.getElementById("keywordInput"),
    queryBtn: document.getElementById("queryBtn"),
    clearBtn: document.getElementById("clearBtn"),
    chips: document.getElementById("chips"),
    statusLine: document.getElementById("statusLine"),
    matchBlock: document.getElementById("matchBlock"),
    matchCount: document.getElementById("matchCount"),
    matchList: document.getElementById("matchList"),
    answerCard: document.getElementById("answerCard"),
    pracCard: document.getElementById("pracCard"),
    pracPos: document.getElementById("pracPos"),
    pracStats: document.getElementById("pracStats"),
    pracBar: document.getElementById("pracBar"),
    pracPrev: document.getElementById("pracPrev"),
    pracNext: document.getElementById("pracNext"),
  };

  const state = {
    questions: [],
    byId: new Map(),
    ranked: [],
    selectedId: null,
    activeChip: "",
    mode: "search",
    practice: {
      deck: "seq",
      ids: [],
      index: 0,
      picked: [],
      submitted: false,
      records: {},
    },
  };

  function normalize(text) {
    return String(text || "")
      .toLowerCase()
      .replace(/[\u3000\s]+/g, "")
      .replace(/[，。、；：！？“”‘’（）()【】\[\]《》·\-—_／/]/g, "")
      .replace(/[\uff01-\uff5e]/g, (ch) =>
        String.fromCharCode(ch.charCodeAt(0) - 0xfee0)
      );
  }

  function tokensOf(query) {
    return query
      .trim()
      .split(/[\s,，、;；]+/)
      .map((t) => t.trim())
      .filter(Boolean);
  }

  function haystack(q) {
    const optionText = q.options.map((o) => o.key + o.text).join("");
    return normalize(q.stem + optionText + q.answer_text);
  }

  function stemOf(q) {
    return normalize(q.stem);
  }

  function fuzzyIndex(hay, token) {
    let from = 0;
    for (const ch of token) {
      const i = hay.indexOf(ch, from);
      if (i === -1) return -1;
      from = i + 1;
    }
    return hay.indexOf(token[0]);
  }

  function parseIdQuery(query) {
    const t = query.trim();
    let m = t.match(/^第\s*0*(\d{1,4})\s*题$/);
    if (m) return Number(m[1]);
    m = t.match(/^0*(\d{1,4})$/);
    if (m) {
      const n = Number(m[1]);
      if (n >= 1 && n <= state.questions.length) return n;
    }
    return 0;
  }

  function scoreQuestion(q, tokens, nQuery) {
    const nStem = q._stem || (q._stem = stemOf(q));
    const hay = q._hay || (q._hay = haystack(q));
    let score = 0;
    if (nQuery.length >= 2 && nStem.includes(nQuery)) {
      score += 900 + Math.min(nQuery.length, 60) * 10;
      if (nStem.startsWith(nQuery)) score += 120;
      score += (nQuery.length / Math.max(nStem.length, 1)) * 280;
    }
    for (const token of tokens) {
      const nToken = normalize(token);
      if (!nToken) continue;
      const exactStem = nStem.indexOf(nToken);
      const exactAll = hay.indexOf(nToken);
      if (exactStem !== -1) {
        score += 260 - Math.min(exactStem, 90);
        if (exactStem === 0) score += 50;
        score += Math.min(nToken.length, 20) * 4;
      } else if (exactAll !== -1) {
        score += 90;
      } else if (nToken.length >= 2 && fuzzyIndex(nStem, nToken) !== -1) {
        score += 40;
      } else if (nToken.length >= 2 && fuzzyIndex(hay, nToken) !== -1) {
        score += 16;
      } else {
        return null;
      }
    }
    if (tokens.length > 1) {
      const glued = normalize(tokens.join(""));
      if (glued && nStem.includes(glued)) score += 320;
    }
    score -= Math.min(nStem.length, 160) * 0.04;
    return score;
  }

  function search(query) {
    const trimmed = query.trim();
    if (!trimmed) return [];
    const id = parseIdQuery(trimmed);
    if (id) {
      const hit = state.byId.get(id);
      if (hit) return [{ q: hit, score: 5000 }];
    }
    const tokens = tokensOf(trimmed);
    const nQuery = normalize(trimmed);
    if (!tokens.length && !nQuery) return [];
    const ranked = [];
    for (const q of state.questions) {
      const score = scoreQuestion(q, tokens, nQuery);
      if (score !== null) ranked.push({ q, score });
    }
    ranked.sort((a, b) => b.score - a.score || a.q.id - b.q.id);
    return ranked;
  }

  function escapeHtml(text) {
    return String(text)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  function highlight(text, query) {
    const tokens = tokensOf(query)
      .map((t) => t.trim())
      .filter((t) => t.length)
      .sort((a, b) => b.length - a.length);
    if (!tokens.length) return escapeHtml(text);
    const source = String(text);
    const ranges = [];
    const lower = source.toLowerCase();
    for (const token of tokens) {
      const needle = token.toLowerCase();
      if (!needle) continue;
      let from = 0;
      while (from < lower.length) {
        const i = lower.indexOf(needle, from);
        if (i === -1) break;
        ranges.push([i, i + needle.length]);
        from = i + needle.length;
      }
    }
    if (!ranges.length) return escapeHtml(source);
    ranges.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
    const merged = [];
    for (const range of ranges) {
      const last = merged[merged.length - 1];
      if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
      else merged.push(range.slice());
    }
    let html = "";
    let cursor = 0;
    for (const [start, end] of merged) {
      html += escapeHtml(source.slice(cursor, start));
      html += `<mark>${escapeHtml(source.slice(start, end))}</mark>`;
      cursor = end;
    }
    html += escapeHtml(source.slice(cursor));
    return html;
  }

  function badgeClass(qtype) {
    if (qtype === "判断") return "badge judge";
    if (qtype === "多选") return "badge multi";
    return "badge";
  }

  function sameKeys(a, b) {
    const left = [...a].sort().join(",");
    const right = [...b].sort().join(",");
    return left === right;
  }

  function loadPractice() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw);
      if (saved && typeof saved === "object") {
        state.practice.records = saved.records || {};
        if (saved.deck) state.practice.deck = saved.deck;
        if (Number.isInteger(saved.index)) state.practice.index = saved.index;
      }
    } catch {
      /* ignore */
    }
  }

  function savePractice() {
    try {
      localStorage.setItem(
        STORE_KEY,
        JSON.stringify({
          deck: state.practice.deck,
          index: state.practice.index,
          records: state.practice.records,
        })
      );
    } catch {
      /* ignore */
    }
  }

  function shuffle(list) {
    const arr = list.slice();
    for (let i = arr.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function wrongIds() {
    return Object.entries(state.practice.records)
      .filter(([, rec]) => rec && rec.correct === false)
      .map(([id]) => Number(id));
  }

  function buildDeck(deck, keepIndex) {
    state.practice.deck = deck;
    let ids = state.questions.map((q) => q.id);
    if (deck === "rand") ids = shuffle(ids);
    if (deck === "wrong") ids = wrongIds();
    state.practice.ids = ids;
    const last = Math.max(ids.length - 1, 0);
    state.practice.index = keepIndex
      ? Math.min(Math.max(state.practice.index, 0), last)
      : 0;
    resetCurrentPicks();
    savePractice();
  }

  function resetCurrentPicks() {
    const q = currentQuestion();
    const rec = q ? state.practice.records[q.id] : null;
    if (rec) {
      state.practice.picked = rec.picked.slice();
      state.practice.submitted = true;
    } else {
      state.practice.picked = [];
      state.practice.submitted = false;
    }
  }

  function currentQuestion() {
    const id = state.practice.ids[state.practice.index];
    return id ? state.byId.get(id) : null;
  }

  function stats() {
    let ok = 0;
    let bad = 0;
    for (const rec of Object.values(state.practice.records)) {
      if (!rec) continue;
      if (rec.correct) ok += 1;
      else bad += 1;
    }
    return { ok, bad };
  }

  function setMode(mode) {
    state.mode = mode;
    els.searchView.hidden = mode !== "search";
    els.practiceView.hidden = mode !== "practice";
    els.tabSearch.classList.toggle("active", mode === "search");
    els.tabPractice.classList.toggle("active", mode === "practice");
    if (mode === "practice") {
      if (!state.practice.ids.length) buildDeck(state.practice.deck);
      renderPractice();
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  function renderPracticeMeta() {
    const total = state.practice.ids.length;
    const pos = total ? state.practice.index + 1 : 0;
    const { ok, bad } = stats();
    els.pracPos.textContent = `${pos} / ${total}`;
    els.pracStats.textContent = `答对 ${ok} · 答错 ${bad}`;
    els.pracBar.style.width = total ? `${(pos / total) * 100}%` : "0%";
    els.pracPrev.disabled = state.practice.index <= 0;
    els.pracNext.disabled = state.practice.index >= total - 1 || total === 0;
    for (const btn of document.querySelectorAll(".prac-chip")) {
      btn.classList.toggle("active", btn.dataset.deck === state.practice.deck);
    }
  }

  function renderPractice() {
    renderPracticeMeta();
    const q = currentQuestion();
    if (!q) {
      const empty =
        state.practice.deck === "wrong"
          ? "错题本还是空的。先去顺序或随机练习，答错的题会自动收进来。"
          : "题库还没载入完成。";
      els.pracCard.innerHTML = `<p class="prac-empty">${empty}</p>`;
      return;
    }

    const correct = new Set(q.answer_keys);
    const picked = new Set(state.practice.picked);
    const done = state.practice.submitted;
    const multi = q.qtype === "多选";

    const optionsHtml = q.options
      .map((opt) => {
        const isPicked = picked.has(opt.key);
        const isRight = correct.has(opt.key);
        let extra = "";
        if (!done && isPicked) extra = " picked";
        if (done && isRight) extra = " correct disabled";
        if (done && isPicked && !isRight) extra = " wrong disabled";
        if (done && !isPicked && !isRight) extra = " disabled";
        const tick = done && isRight ? "正确答案" : done && isPicked ? "你的选择" : "";
        return `<button class="option${extra}" type="button" data-key="${escapeHtml(opt.key)}">
          <span class="key">${escapeHtml(opt.key)}</span>
          <span>${escapeHtml(opt.text || "（空）")}</span>
          <span class="tick">${tick}</span>
        </button>`;
      })
      .join("");

    let result = "";
    if (done) {
      const good = sameKeys(picked, correct);
      const keyLabel = q.answer_keys.join("、") || "（原表未填）";
      result = `<div class="prac-result ${good ? "ok" : "bad"}">
        ${good ? "回答正确" : "回答错误"}<br>
        标准答案：${escapeHtml(keyLabel)}<br>
        <span style="font-weight:600">${escapeHtml(q.answer_text || "")}</span>
      </div>`;
    }

    const submit =
      !done && multi
        ? `<button class="prac-submit" id="pracSubmit" type="button">确认提交</button>`
        : "";

    els.pracCard.innerHTML = `
      <div class="q-meta">
        <span class="${badgeClass(q.qtype)}">${escapeHtml(q.qtype)}</span>
        <span class="q-id">第 ${q.id} 题</span>
      </div>
      <p class="q-stem">${escapeHtml(q.stem)}</p>
      <div class="options">${optionsHtml || "<p class='empty'>本题未收录选项</p>"}</div>
      ${submit}
      ${result}
    `;
  }

  function submitCurrent() {
    const q = currentQuestion();
    if (!q || state.practice.submitted) return;
    if (!state.practice.picked.length) return;
    const good = sameKeys(state.practice.picked, q.answer_keys);
    state.practice.submitted = true;
    state.practice.records[q.id] = {
      correct: good,
      picked: state.practice.picked.slice(),
    };
    savePractice();
    renderPractice();
  }

  function pickOption(key) {
    const q = currentQuestion();
    if (!q || state.practice.submitted) return;
    if (q.qtype === "多选") {
      const set = new Set(state.practice.picked);
      if (set.has(key)) set.delete(key);
      else set.add(key);
      state.practice.picked = [...set];
      renderPractice();
      return;
    }
    state.practice.picked = [key];
    submitCurrent();
  }

  function gotoIndex(next) {
    const total = state.practice.ids.length;
    if (!total) return;
    state.practice.index = Math.max(0, Math.min(total - 1, next));
    resetCurrentPicks();
    savePractice();
    renderPractice();
    els.pracCard.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function syncQueryBtn() {
    els.queryBtn.textContent = state.selectedId ? "看答案" : "查询";
  }

  function renderAnswer(question, query) {
    const keys = new Set(question.answer_keys);
    const optionsHtml = question.options
      .map((opt) => {
        const ok = keys.has(opt.key);
        return `<div class="option${ok ? " correct" : ""}">
          <span class="key">${escapeHtml(opt.key)}</span>
          <span>${highlight(opt.text || "（空）", query)}</span>
          <span class="tick">${ok ? "正确答案" : ""}</span>
        </div>`;
      })
      .join("");
    const keyLabel = question.answer_keys.length
      ? question.answer_keys.join("、")
      : "（原表未填）";
    els.answerCard.hidden = false;
    els.answerCard.innerHTML = `
      <div class="q-meta">
        <span class="${badgeClass(question.qtype)}">${escapeHtml(question.qtype)}</span>
        <span class="q-id">第 ${question.id} 题</span>
      </div>
      <p class="q-stem">${highlight(question.stem, query)}</p>
      <div class="answer-box">
        <span class="seal">标准答案</span>
        <div class="answer-keys">${escapeHtml(keyLabel)}</div>
        <p class="answer-text">${highlight(question.answer_text || keyLabel, query)}</p>
      </div>
      <div class="options">${optionsHtml || "<p class='empty'>本题未收录选项</p>"}</div>
    `;
    els.answerCard.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function renderList(ranked, query) {
    const shown = ranked.slice(0, MAX_LIST);
    els.matchCount.textContent =
      ranked.length > MAX_LIST
        ? `显示前 ${MAX_LIST} / ${ranked.length} 题`
        : `共 ${ranked.length} 题`;
    els.matchList.innerHTML = shown
      .map((item, i) => {
        const q = item.q;
        const active = q.id === state.selectedId ? " active" : "";
        return `<li>
          <button class="match-item${active}" type="button" data-id="${q.id}">
            <span class="idx">${i + 1}</span>
            <span class="stem">${highlight(q.stem, query)}</span>
            <span class="type">${escapeHtml(q.qtype)}</span>
          </button>
        </li>`;
      })
      .join("");
  }

  function resetView(message) {
    els.matchBlock.hidden = true;
    els.answerCard.hidden = true;
    els.statusLine.hidden = false;
    els.statusLine.textContent = message;
    state.selectedId = null;
    state.ranked = [];
    syncQueryBtn();
  }

  function applySearch(query) {
    const trimmed = query.trim();
    els.clearBtn.hidden = !trimmed;
    state.selectedId = null;
    els.answerCard.hidden = true;
    syncQueryBtn();
    if (!trimmed) {
      resetView("输入关键字后会列出相关题目。先点选一道，再点「查询」看答案。");
      return;
    }
    const ranked = search(trimmed);
    state.ranked = ranked;
    if (!ranked.length) {
      els.matchBlock.hidden = true;
      els.statusLine.hidden = false;
      els.statusLine.textContent = "没有找到相关题目，换几个字再试试。";
      return;
    }
    els.statusLine.hidden = false;
    els.statusLine.textContent = "请点选下面的题目，再点「看答案」。";
    els.matchBlock.hidden = false;
    renderList(ranked, trimmed);
  }

  function showSelectedAnswer() {
    const query = els.input.value.trim();
    if (!query) {
      resetView("请先输入题目关键字。");
      return;
    }
    if (!state.ranked.length) applySearch(query);
    if (!state.ranked.length) return;
    if (!state.selectedId) {
      els.statusLine.hidden = false;
      els.statusLine.textContent = "请先点选一道题目，再点「看答案」。";
      els.matchBlock.hidden = false;
      els.answerCard.hidden = true;
      return;
    }
    const hit = state.ranked.find((item) => item.q.id === state.selectedId);
    if (!hit) {
      state.selectedId = null;
      syncQueryBtn();
      els.statusLine.textContent = "请先点选一道题目，再点「看答案」。";
      return;
    }
    els.statusLine.hidden = true;
    renderAnswer(hit.q, query);
  }

  function bind() {
    els.tabSearch.addEventListener("click", () => setMode("search"));
    els.tabPractice.addEventListener("click", () => setMode("practice"));

    let timer = 0;
    els.input.addEventListener("input", () => {
      state.activeChip = "";
      syncChips();
      clearTimeout(timer);
      timer = setTimeout(() => applySearch(els.input.value), 140);
    });
    els.input.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") {
        ev.preventDefault();
        if (state.selectedId) showSelectedAnswer();
        else applySearch(els.input.value);
      }
    });
    els.queryBtn.addEventListener("click", () => {
      if (state.selectedId) showSelectedAnswer();
      else applySearch(els.input.value);
    });
    els.clearBtn.addEventListener("click", () => {
      els.input.value = "";
      state.activeChip = "";
      syncChips();
      applySearch("");
      els.input.focus();
    });
    els.matchList.addEventListener("click", (ev) => {
      const btn = ev.target.closest(".match-item");
      if (!btn) return;
      const id = Number(btn.dataset.id);
      const hit = state.ranked.find((item) => item.q.id === id);
      if (!hit) return;
      state.selectedId = id;
      els.answerCard.hidden = true;
      renderList(state.ranked, els.input.value);
      syncQueryBtn();
      els.statusLine.hidden = false;
      els.statusLine.textContent = "已选中题目，请点「看答案」。";
    });

    document.querySelector(".prac-toolbar").addEventListener("click", (ev) => {
      const btn = ev.target.closest(".prac-chip");
      if (!btn) return;
      buildDeck(btn.dataset.deck);
      renderPractice();
    });
    els.pracCard.addEventListener("click", (ev) => {
      const submit = ev.target.closest("#pracSubmit");
      if (submit) {
        submitCurrent();
        return;
      }
      const opt = ev.target.closest(".option");
      if (opt && opt.dataset.key) pickOption(opt.dataset.key);
    });
    els.pracPrev.addEventListener("click", () => gotoIndex(state.practice.index - 1));
    els.pracNext.addEventListener("click", () => gotoIndex(state.practice.index + 1));
  }

  function syncChips() {
    for (const btn of els.chips.querySelectorAll(".chip")) {
      btn.classList.toggle("active", btn.dataset.key === state.activeChip);
    }
  }

  function renderChips() {
    els.chips.innerHTML = CHIPS.map(
      (key) =>
        `<button class="chip" type="button" data-key="${escapeHtml(key)}">${escapeHtml(key)}</button>`
    ).join("");
    els.chips.addEventListener("click", (ev) => {
      const btn = ev.target.closest(".chip");
      if (!btn) return;
      const key = btn.dataset.key;
      els.input.value = key;
      state.activeChip = key;
      syncChips();
      applySearch(key);
      els.input.focus();
    });
  }

  async function boot() {
    renderChips();
    bind();
    syncQueryBtn();
    loadPractice();
    try {
      const res = await fetch("data/questions.json", { cache: "no-cache" });
      if (!res.ok) throw new Error(res.statusText);
      const data = await res.json();
      state.questions = data.questions || [];
      state.byId = new Map(state.questions.map((q) => [q.id, q]));
      const count = data.meta?.count ?? state.questions.length;
      els.metaLine.textContent = `题库 ${count} 题 · 手机刷题`;
      buildDeck(state.practice.deck || "seq", true);
      const preset = new URLSearchParams(location.search).get("q");
      const mode = new URLSearchParams(location.search).get("mode");
      if (mode === "practice") setMode("practice");
      if (preset) {
        setMode("search");
        els.input.value = preset;
        applySearch(preset);
      }
    } catch (err) {
      els.metaLine.textContent = "题库载入失败";
      els.statusLine.textContent =
        "无法读取 data/questions.json，请确认已导入试题。";
      console.error(err);
    }
  }

  boot();
})();
