(function () {
  const view = document.getElementById('view');
  const STORAGE_KEY = 'cpp_quiz_v1';

  const TYPE_LABELS = {
    single_choice: '选择题',
    fill_blank: '填空题',
    code_fill: '程序填空题',
    code_output: '程序阅读题',
    coding: '程序设计题'
  };

  const defaultDb = {
    progress: {},
    wrong: [],
    fav: [],
    customQuestions: [],
    settings: {}
  };

  let db = loadDb();
  let bank = { questions: [] };
  let quiz = loadQuiz();

  // 每题开始作答的时间戳（用于记录单题耗时）
  let qStartTs = {};

  function loadDb() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return Object.assign({}, defaultDb, raw ? JSON.parse(raw) : {});
    } catch (e) {
      return Object.assign({}, defaultDb);
    }
  }

  function saveDb() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
  }

  function loadQuiz() {
    try {
      return JSON.parse(sessionStorage.getItem('quiz') || 'null');
    } catch (e) {
      return null;
    }
  }

  function saveQuiz() {
    sessionStorage.setItem('quiz', JSON.stringify(quiz));
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (m) {
      return {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
      }[m];
    });
  }

  function nl2br(s) {
    return esc(s).replace(/\n/g, '<br>');
  }

  function truncate(s, n) {
    s = String(s || '');
    return s.length > n ? s.slice(0, n) + '...' : s;
  }

  function getCode(q) {
    return q.code || (q.codeLines || []).join('\n') || '';
  }

  function getRef(q) {
    return q.reference || (q.referenceLines || []).join('\n') || '';
  }

  // 写入答题历史（IndexedDB，静默失败不影响主流程）
  function recordHistory(q, answer, correct) {
    if (!window.QuizIDB) return;
    const start = qStartTs[q.id];
    const rec = {
      qid: q.id,
      qtype: q.type,
      correct: !!correct,
      answer: answer,
      ts: Date.now(),
      duration: start ? Date.now() - start : 0
    };
    delete qStartTs[q.id];
    window.QuizIDB.safeAdd(rec);
  }

  // 代码格式化：把挤成一行的 C++ 代码按语法断行 + 花括号缩进（数据兜底用）
  function formatCodeText(code) {
    const out = [];
    let cur = '';
    let brace = 0;
    let paren = 0;
    let inStr = false;
    let inChar = false;
    let i = 0;
    const n = code.length;

    const indent = () => '    '.repeat(Math.max(0, brace));
    const flush = () => {
      cur = cur.replace(/\s+$/, '');
      if (cur.trim()) out.push(cur);
      cur = '';
    };

    while (i < n) {
      const ch = code[i];

      if (inStr || inChar) {
        cur += ch;
        if (ch === '\\') { cur += code[i + 1] || ''; i += 2; continue; }
        if (inStr && ch === '"') inStr = false;
        if (inChar && ch === "'") inChar = false;
        i++;
        continue;
      }
      if (ch === '"') { inStr = true; cur += ch; i++; continue; }
      if (ch === "'") { inChar = true; cur += ch; i++; continue; }
      if (ch === '(') { paren++; cur += ch; i++; continue; }
      if (ch === ')') { paren = Math.max(0, paren - 1); cur += ch; i++; continue; }

      if (ch === '{') {
        if (!cur) cur = indent();
        cur += ch;
        brace++;
        const rest = code.slice(i + 1).replace(/^\s+/, '');
        if (/^(public|private|protected):/.test(rest)) { i++; continue; }
        flush();
        i++;
        continue;
      }

      if (ch === '}') {
        flush();
        brace = Math.max(0, brace - 1);
        cur = indent() + '}';
        const rest = code.slice(i + 1).replace(/^\s+/, '');
        if (rest.startsWith(';')) {
          cur += ';';
          const semi = code.indexOf(';', i + 1);
          i = semi + 1;
          flush();
          continue;
        }
        flush();
        i++;
        continue;
      }

      if (ch === ';') {
        if (!cur) cur = indent();
        cur = cur.replace(/\s+$/, '') + ';';
        if (paren === 0) flush();
        i++;
        continue;
      }

      if (ch === '>' && cur.replace(/^\s+/, '').startsWith('#')) {
        cur += ch;
        flush();
        i++;
        continue;
      }

      if (!cur) {
        if (/\s/.test(ch)) { i++; continue; }
        cur = indent();
      }
      cur += ch;
      i++;
    }

    cur = cur.replace(/\s+$/, '');
    if (cur.trim()) out.push(cur);
    return out.join('\n');
  }

  function norm(s) {
    return String(s == null ? '' : s)
      .trim()
      .replace(/\u00A0/g, ' ')
      .replace(/\s+/g, ' ');
  }

  function normLoose(s) {
    return norm(s).replace(/\s+/g, '').toLowerCase();
  }

  function normOutput(s) {
    return String(s == null ? '' : s)
      .replace(/\r/g, '')
      .split('\n')
      .map(function (x) { return x.trim(); })
      .filter(Boolean)
      .join('\n');
  }

  function matchOne(input, answers) {
    return (answers || []).some(function (a) {
      return norm(input) === norm(a) || normLoose(input) === normLoose(a);
    });
  }

  function matchOutput(input, answers) {
    const a = normOutput(input);
    return (answers || []).some(function (ans) {
      const b = normOutput(ans);
      return a === b || a.replace(/\s+/g, '') === b.replace(/\s+/g, '');
    });
  }

  function shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = arr[i];
      arr[i] = arr[j];
      arr[j] = t;
    }
    return arr;
  }

  function allQuestions() {
    return bank.questions.concat(db.customQuestions || []);
  }

  function qById(id) {
    return allQuestions().find(function (q) { return q.id === id; });
  }

  function getProgress(id) {
    return db.progress[id] || {};
  }

  function setProgress(id, patch) {
    db.progress[id] = Object.assign({}, getProgress(id), patch);
    saveDb();
  }

  function isFav(id) {
    return db.fav.indexOf(id) !== -1;
  }

  function isWrong(id) {
    return db.wrong.indexOf(id) !== -1;
  }

  function addWrong(id) {
    if (!isWrong(id)) {
      db.wrong.push(id);
      saveDb();
    }
  }

  function removeWrong(id) {
    db.wrong = db.wrong.filter(function (x) { return x !== id; });
    saveDb();
  }

  function toggleFav(id) {
    if (isFav(id)) {
      db.fav = db.fav.filter(function (x) { return x !== id; });
    } else {
      db.fav.push(id);
    }
    saveDb();
    render();
  }

  async function loadData() {
    try {
      let files = [];

      try {
        const manifest = await fetch('data/manifest.json', { cache: 'no-cache' })
          .then(function (r) { return r.ok ? r.json() : null; });
        files = (manifest && manifest.files) || [];
      } catch (e) {
        files = [];
      }

      if (!files.length) {
        files = ['data/bank.json'];
      }

      const questions = [];

      for (const file of files) {
        try {
          const data = await fetch(file, { cache: 'no-cache' })
            .then(function (r) { return r.json(); });

          if (Array.isArray(data)) {
            questions.push.apply(questions, data);
          } else if (data && Array.isArray(data.questions)) {
            questions.push.apply(questions, data.questions);
          }
        } catch (err) {
          console.warn('题库加载失败:', file, err);
        }
      }

      bank.questions = questions;
    } catch (e) {
      bank.questions = [];
    }
  }

  function parseHash() {
    const raw = location.hash.slice(1) || '/';
    const parts = raw.split('?');
    const path = parts[0] || '/';
    const params = new URLSearchParams(parts[1] || '');
    return { path: path, params: params };
  }

  function updateNav(path, params) {
    const links = document.querySelectorAll('.tabbar a');
    links.forEach(function (a) {
      const tab = a.getAttribute('data-tab');
      let active = false;

      if (tab === 'home' && path === '/') active = true;
      if (tab === 'list' && path === '/list' && params.get('type') === 'all') active = true;
      if (tab === 'wrong' && path === '/list' && params.get('type') === 'wrong') active = true;
      if (tab === 'fav' && path === '/list' && params.get('type') === 'fav') active = true;
      if (tab === 'settings' && path === '/settings') active = true;

      a.classList.toggle('active', active);
    });
  }

  function render() {
    const route = parseHash();
    updateNav(route.path, route.params);

    if (route.path === '/') {
      renderHome();
    } else if (route.path === '/quiz') {
      renderQuiz();
    } else if (route.path === '/report') {
      renderReport();
    } else if (route.path === '/list') {
      renderList(route.params);
    } else if (route.path === '/history') {
      renderHistory();
    } else if (route.path === '/settings') {
      renderSettings();
    } else {
      view.innerHTML = '<div class="card">页面不存在</div>';
    }
  }

  function stats() {
    const progressValues = Object.values(db.progress);
    const done = progressValues.filter(function (p) { return p.judged; }).length;
    const right = progressValues.filter(function (p) { return p.judged && p.correct; }).length;
    const acc = done ? Math.round(right / done * 100) : 0;

    return {
      total: allQuestions().length,
      done: done,
      right: right,
      acc: acc,
      wrong: db.wrong.length,
      fav: db.fav.length
    };
  }

  function renderHome() {
    const s = stats();
    const papers = {};

    allQuestions().forEach(function (q) {
      const key = q.paper || '未分组';
      if (!papers[key]) papers[key] = [];
      papers[key].push(q);
    });

    let html = `
      <section class="card">
        <h1>自考C++真题刷题</h1>
        <div class="muted">无后端静态版：进度保存在本机浏览器，可导出/导入。</div>
        <div class="stats">
          <div class="stat">总题数<b>${s.total}</b></div>
          <div class="stat">已练习<b>${s.done}</b></div>
          <div class="stat">正确率<b>${s.acc}%</b></div>
          <div class="stat">错题<b>${s.wrong}</b></div>
          <div class="stat">收藏<b>${s.fav}</b></div>
          <div class="stat">历史作答<b id="stat-history">·</b></div>
        </div>
        <div class="btn-row">
          <button class="btn primary" data-action="start" data-mode="order">全部顺序</button>
          <button class="btn" data-action="start" data-mode="random">全部随机</button>
          <button class="btn danger" data-action="start" data-source="wrong">错题练习</button>
          <button class="btn" data-action="start" data-source="fav">收藏练习</button>
        </div>
      </section>
      <section class="card">
        <h2>按题型练习</h2>
        <div class="type-grid">
    `;

    Object.keys(TYPE_LABELS).forEach(function (type) {
      const n = allQuestions().filter(function (q) { return q.type === type; }).length;

      html += `
        <div class="card type-card">
          <h3>${TYPE_LABELS[type]}</h3>
          <div class="muted">共 ${n} 题</div>
          <div class="btn-row">
            <button class="btn primary" data-action="start" data-qtype="${esc(type)}" data-mode="order" ${n ? '' : 'disabled'}>顺序练习</button>
            <button class="btn" data-action="start" data-qtype="${esc(type)}" data-mode="random" ${n ? '' : 'disabled'}>随机练习</button>
          </div>
        </div>
      `;
    });

    html += '</div></section><section class="cards">';

    Object.keys(papers).sort().forEach(function (paper) {
      const items = papers[paper];
      const done = items.filter(function (q) { return getProgress(q.id).judged; }).length;

      html += `
        <div class="card">
          <h2>${esc(paper)}</h2>
          <div class="muted">共 ${items.length} 题 / 已练 ${done} 题</div>
          <div class="btn-row">
            <button class="btn primary" data-action="start" data-paper="${esc(paper)}" data-mode="order">顺序练习</button>
            <button class="btn" data-action="start" data-paper="${esc(paper)}" data-mode="random">随机练习</button>
          </div>
        </div>
      `;
    });

    html += '</section>';
    view.innerHTML = html;

    // 异步填充历史作答统计（IndexedDB）
    if (window.QuizIDB) {
      window.QuizIDB.count().then(function (n) {
        const el = document.getElementById('stat-history');
        if (el) el.textContent = String(n);
      }).catch(function () {
        const el = document.getElementById('stat-history');
        if (el) el.textContent = 'N/A';
      });
    }
  }

  function renderList(params) {
    const type = params.get('type') || 'all';
    const qtype = params.get('qtype') || '';
    const paper = params.get('paper') || '';
    let qs = allQuestions();

    if (type === 'wrong') {
      qs = qs.filter(function (q) { return isWrong(q.id); });
    }

    if (type === 'fav') {
      qs = qs.filter(function (q) { return isFav(q.id); });
    }

    if (paper) {
      qs = qs.filter(function (q) { return q.paper === paper; });
    }

    if (qtype) {
      qs = qs.filter(function (q) { return q.type === qtype; });
    }

    const typeName = TYPE_LABELS[qtype];
    const title = (type === 'wrong' ? '错题本' : type === 'fav' ? '收藏夹' : '题库列表') + (typeName ? ' - ' + typeName : '');
    const shown = qs.slice(0, 300);

    let html = `
      <section class="card">
        <h1>${title}</h1>
        <div class="muted">共 ${qs.length} 题${qs.length > 300 ? '，仅显示前300题' : ''}</div>
        <div class="btn-row">
          <button class="btn primary" data-action="start" data-source="${esc(type)}" data-qtype="${esc(qtype)}" data-mode="order">开始本列表</button>
        </div>
        <div class="type-filter">
          <a class="type-pill ${qtype ? '' : 'active'}" href="#/list?type=${esc(type)}&paper=${esc(paper)}">全部题型</a>
          ${Object.keys(TYPE_LABELS).map(function (t) {
            return `<a class="type-pill ${qtype === t ? 'active' : ''}" href="#/list?type=${esc(type)}&paper=${esc(paper)}&qtype=${esc(t)}">${TYPE_LABELS[t]}</a>`;
          }).join('')}
        </div>
      </section>
      <section class="cards">
    `;

    shown.forEach(function (q, idx) {
      html += `
        <div class="card">
          <div class="q-title">${idx + 1}. ${esc(truncate(q.stem || '', 70))}</div>
          <div class="muted" style="margin:8px 0;">
            <span class="badge">${esc(q.paper || '未分组')}</span>
            <span class="badge">${esc(q.section || q.type || '')}</span>
          </div>
          <div class="btn-row">
            <button class="btn primary" data-action="start-single" data-id="${esc(q.id)}">作答</button>
            <button class="btn" data-action="toggle-fav" data-id="${esc(q.id)}">${isFav(q.id) ? '取消收藏' : '收藏'}</button>
            ${type === 'wrong' ? `<button class="btn danger" data-action="remove-wrong" data-id="${esc(q.id)}">移出错题</button>` : ''}
          </div>
        </div>
      `;
    });

    html += '</section>';
    view.innerHTML = html;
  }

  function startQuiz(options) {
    let qs = allQuestions();

    if (options.paper) {
      qs = qs.filter(function (q) { return q.paper === options.paper; });
    }

    if (options.source === 'wrong') {
      qs = qs.filter(function (q) { return isWrong(q.id); });
    }

    if (options.source === 'fav') {
      qs = qs.filter(function (q) { return isFav(q.id); });
    }

    if (options.qtype) {
      qs = qs.filter(function (q) { return q.type === options.qtype; });
    }

    if (options.mode === 'random') {
      shuffle(qs);
    }

    if (!qs.length) {
      alert('当前没有可练习的题目');
      return;
    }

    quiz = {
      qids: qs.map(function (q) { return q.id; }),
      index: 0
    };

    saveQuiz();
    location.hash = '#/quiz';
  }

  function startSingle(id) {
    quiz = {
      qids: [id],
      index: 0
    };
    saveQuiz();
    location.hash = '#/quiz';
  }

  function questionMetaHtml(q) {
    return `
      <div class="q-meta" style="margin-bottom:10px;">
        <span class="badge">${esc(q.paper || '未分组')}</span>
        <span class="badge">${esc(q.section || '')}</span>
        <span class="badge">${esc(q.type || '')}</span>
        ${q.tags ? q.tags.map(function (t) { return `<span class="badge">${esc(t)}</span>`; }).join('') : ''}
      </div>
    `;
  }

  function stemHtml(q) {
    let stem = q.stem || '';
    let code = getCode(q);

    // 兜底：历史/导入数据把代码嵌在题干里（第一个冒号后），无独立 code 字段时自动提取并按格式渲染
    if (!code && (q.type === 'code_output' || q.type === 'code_fill' || q.type === 'coding')) {
      const idx = stem.search(/[：:]/);
      if (idx !== -1) {
        const rest = stem.slice(idx + 1).trim();
        if (/^(#include|class|struct|template|using\s+namespace|(int|double|char|float|long|unsigned|bool|void)\s+\w+)/.test(rest)) {
          stem = stem.slice(0, idx + 1);
          code = formatCodeText(rest);
        }
      }
    }

    let h = `<div class="stem" style="font-weight:700;line-height:1.8;">${nl2br(stem)}</div>`;

    if (code) {
      h += `<pre class="code">${esc(code)}</pre>`;
    }

    return h;
  }

  function questionHtml(q, prog) {
    if (!prog.judged && !qStartTs[q.id]) qStartTs[q.id] = Date.now();

    let h = questionMetaHtml(q);
    h += stemHtml(q);

    if (q.type === 'single_choice') {
      const options = q.options || {};
      const correctList = Array.isArray(q.answer) ? q.answer : [q.answer];

      Object.keys(options).forEach(function (letter) {
        let cls = 'option';
        const selected = prog.choice === letter;
        if (selected) cls += ' selected';

        if (prog.judged) {
          if (correctList.indexOf(letter) !== -1) cls += ' correct';
          else if (selected) cls += ' wrong';
        }

        h += `
          <button class="${cls}" data-action="option" data-id="${esc(q.id)}" data-letter="${esc(letter)}" ${prog.judged ? 'disabled' : ''}>
            <b>${esc(letter)}.</b> ${esc(options[letter])}
          </button>
        `;
      });
    } else if (q.type === 'fill_blank') {
      const answers = Array.isArray(q.answer) ? q.answer : [q.answer];
      const count = Math.max(1, answers.length, Number(q.blankCount || 1));

      for (let i = 0; i < count; i++) {
        const val = (prog.inputs && prog.inputs[i]) || '';
        h += `
          <div class="fill-item">
            <div class="muted">第 ${i + 1} 空</div>
            <input type="text" class="fill-input" data-index="${i}" value="${esc(val)}" ${prog.judged ? 'disabled' : ''}>
          </div>
        `;
      }

      if (!prog.judged) {
        h += `<button class="btn primary" data-action="submit-fill" data-id="${esc(q.id)}">提交答案</button>`;
      }
    } else if (q.type === 'code_fill') {
      const blanks = q.blanks || [];

      blanks.forEach(function (b, i) {
        const val = (prog.blanks && prog.blanks[i]) || '';
        h += `
          <div class="blank-item">
            <div class="muted">空 ${b.id || (i + 1)}</div>
            <input type="text" class="blank-input" data-index="${i}" value="${esc(val)}" ${prog.judged ? 'disabled' : ''}>
          </div>
        `;
      });

      if (!prog.judged) {
        h += `<button class="btn primary" data-action="submit-codefill" data-id="${esc(q.id)}">提交答案</button>`;
      }
    } else if (q.type === 'code_output') {
      h += `
        <textarea id="output-answer" placeholder="请输入程序运行结果" ${prog.judged ? 'disabled' : ''}>${esc(prog.output || '')}</textarea>
      `;

      if (!prog.judged) {
        h += `<button class="btn primary" data-action="submit-output" data-id="${esc(q.id)}">提交答案</button>`;
      }
    } else if (q.type === 'coding') {
      h += `
        <textarea id="coding-answer" placeholder="请写代码或思路，保存后可查看参考答案并自评" ${prog.judged ? 'disabled' : ''}>${esc(prog.coding || '')}</textarea>
      `;

      if (!prog.saved) {
        h += `<button class="btn primary" data-action="save-coding" data-id="${esc(q.id)}">保存并显示参考答案</button>`;
      } else if (!prog.judged) {
        h += `
          <div class="btn-row">
            <button class="btn" data-action="judge-subj" data-id="${esc(q.id)}" data-correct="1">自评：正确</button>
            <button class="btn danger" data-action="judge-subj" data-id="${esc(q.id)}" data-correct="0">自评：错误</button>
          </div>
        `;
      }
    } else {
      h += `<div class="muted">该题型暂以查看解析为主。</div>`;
    }

    return h;
  }

  function answerBlock(q) {
    if (q.type === 'single_choice') {
      return `<p><b>答案：</b>${esc([].concat(q.answer || []).join('，'))}</p>`;
    }

    if (q.type === 'fill_blank') {
      const ans = [].concat(q.answer || []);
      return `<p><b>答案：</b>${esc(ans.join('；'))}</p>`;
    }

    if (q.type === 'code_fill') {
      const ans = (q.blanks || []).map(function (b, i) {
        return `${b.id || (i + 1)}：${[].concat(b.answers || b.answer || []).join(' / ')}`;
      }).join('；');
      return `<p><b>答案：</b>${esc(ans)}</p>`;
    }

    if (q.type === 'code_output') {
      return `<p><b>参考输出：</b></p><pre class="code">${esc([].concat(q.answer || []).join('\n'))}</pre>`;
    }

    if (q.type === 'coding') {
      const ref = getRef(q);
      return ref
        ? `<p><b>参考代码：</b></p><pre class="code">${esc(ref)}</pre>`
        : `<p class="muted">暂无参考代码，请参考下方解析思路自行实现。</p>`;
    }

    return '';
  }

  function analysisHtml(q) {
    let h = '<div class="analysis"><h3>参考答案 / 解析</h3>';
    h += answerBlock(q);

    if (q.analysis) {
      h += `<div style="margin-top:10px;">${nl2br(q.analysis)}</div>`;
    }

    h += '</div>';
    return h;
  }

  function renderQuiz() {
    if (!quiz || !quiz.qids || !quiz.qids.length) {
      location.hash = '#/';
      return;
    }

    const id = quiz.qids[quiz.index];
    const q = qById(id);

    if (!q) {
      view.innerHTML = `
        <div class="card">
          <p>题目不存在</p>
          <button class="btn" data-action="exit-quiz">返回首页</button>
        </div>
      `;
      return;
    }

    const prog = getProgress(id);
    const total = quiz.qids.length;

    let html = `
      <div class="card">
        <div class="quiz-head" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
          <div class="muted">第 ${quiz.index + 1} / ${total} 题</div>
          <div class="muted">${prog.judged ? (prog.correct ? '已答对' : '已答错') : '未作答'}</div>
        </div>
        ${questionHtml(q, prog)}
        <div class="btn-row">
          <button class="btn" data-action="prev" ${quiz.index === 0 ? 'disabled' : ''}>上一题</button>
          <button class="btn" data-action="next" ${quiz.index === total - 1 ? 'disabled' : ''}>下一题</button>
          <button class="btn primary" data-action="finish">完成</button>
          <button class="btn" data-action="toggle-fav" data-id="${esc(q.id)}">${isFav(q.id) ? '取消收藏' : '收藏'}</button>
          <button class="btn" data-action="toggle-analysis" data-id="${esc(q.id)}">解析</button>
        </div>
      </div>
    `;

    if (prog.judged || prog.showAnalysis) {
      html += analysisHtml(q);
    }

    view.innerHTML = html;
  }

  function checkSingle(q, choice) {
    const ans = Array.isArray(q.answer) ? q.answer : [q.answer];
    return ans.indexOf(choice) !== -1;
  }

  function checkFill(q, inputs) {
    const answers = Array.isArray(q.answer) ? q.answer : [q.answer];
    const count = Math.max(1, answers.length, Number(q.blankCount || 1));

    for (let i = 0; i < count; i++) {
      let expected = [answers[i]];
      if (q.accepted && q.accepted[i]) {
        expected = expected.concat(q.accepted[i]);
      }
      expected = expected.filter(Boolean);

      if (!matchOne(inputs[i] || '', expected)) {
        return false;
      }
    }

    return true;
  }

  function checkCodeFill(q, inputs) {
    return (q.blanks || []).every(function (b, i) {
      const expected = [].concat(b.answers || b.answer || []).filter(Boolean);
      return matchOne(inputs[i] || '', expected);
    });
  }

  function checkOutput(q, output) {
    let expected = [].concat(q.answer || []).filter(Boolean);
    if (q.accepted) {
      expected = expected.concat(q.accepted);
    }
    return matchOutput(output, expected);
  }

  function judgeObjective(q) {
    const prog = getProgress(q.id);
    let correct = false;

    if (q.type === 'single_choice') {
      correct = checkSingle(q, prog.choice);
    }

    setProgress(q.id, { judged: true, correct: correct });

    if (correct) {
      removeWrong(q.id);
    } else {
      addWrong(q.id);
    }

    recordHistory(q, prog.choice, correct);
    render();
  }

  function submitFill(id) {
    const inputs = Array.from(view.querySelectorAll('.fill-input')).map(function (x) { return x.value; });
    const q = qById(id);
    const correct = checkFill(q, inputs);

    setProgress(id, { inputs: inputs, judged: true, correct: correct });

    if (correct) removeWrong(id);
    else addWrong(id);

    recordHistory(q, inputs, correct);
    render();
  }

  function submitCodeFill(id) {
    const inputs = Array.from(view.querySelectorAll('.blank-input')).map(function (x) { return x.value; });
    const q = qById(id);
    const correct = checkCodeFill(q, inputs);

    setProgress(id, { blanks: inputs, judged: true, correct: correct });

    if (correct) removeWrong(id);
    else addWrong(id);

    recordHistory(q, inputs, correct);
    render();
  }

  function submitOutput(id) {
    const ta = document.getElementById('output-answer');
    const val = ta ? ta.value : '';
    const q = qById(id);
    const correct = checkOutput(q, val);

    setProgress(id, { output: val, judged: true, correct: correct });

    if (correct) removeWrong(id);
    else addWrong(id);

    recordHistory(q, val, correct);
    render();
  }

  function saveCoding(id) {
    const ta = document.getElementById('coding-answer');
    const val = ta ? ta.value : '';

    setProgress(id, {
      coding: val,
      saved: true,
      showAnalysis: true
    });

    render();
  }

  function judgeSubjective(id, correct) {
    const prog = getProgress(id);
    setProgress(id, { judged: true, correct: correct });

    if (correct) removeWrong(id);
    else addWrong(id);

    recordHistory(qById(id), prog.coding || '', correct);
    render();
  }

  function renderReport() {
    if (!quiz || !quiz.qids) {
      location.hash = '#/';
      return;
    }

    const items = quiz.qids.map(function (id) {
      return {
        q: qById(id),
        p: getProgress(id)
      };
    }).filter(function (x) { return x.q; });

    const judged = items.filter(function (x) { return x.p.judged; }).length;
    const correct = items.filter(function (x) { return x.p.judged && x.p.correct; }).length;
    const acc = judged ? Math.round(correct / judged * 100) : 0;

    let html = `
      <div class="card">
        <h1>练习结果</h1>
        <div class="stats">
          <div class="stat">总题数<b>${items.length}</b></div>
          <div class="stat">已作答<b>${judged}</b></div>
          <div class="stat">正确<b>${correct}</b></div>
          <div class="stat">正确率<b>${acc}%</b></div>
        </div>
        <div class="btn-row">
          <button class="btn" data-action="exit-quiz">退出本次练习</button>
        </div>
      </div>
      <section class="cards">
    `;

    items.forEach(function (item, idx) {
      const cls = item.p.judged ? (item.p.correct ? 'card good' : 'card bad') : 'card';

      html += `
        <div class="${cls}">
          <div class="q-title">${idx + 1}. ${esc(truncate(item.q.stem || '', 70))}</div>
          <div class="muted" style="margin:8px 0;">${item.p.judged ? (item.p.correct ? '正确' : '错误') : '未作答'}</div>
          <div class="btn-row">
            <button class="btn primary" data-action="start-single" data-id="${esc(item.q.id)}">查看</button>
          </div>
        </div>
      `;
    });

    html += '</section>';
    view.innerHTML = html;
  }

  function renderHistory() {
    view.innerHTML = '<div class="card"><h1>答题历史</h1><p class="muted">正在读取…</p></div>';

    if (!window.QuizIDB) {
      view.innerHTML = '<div class="card"><h1>答题历史</h1><p class="muted">当前浏览器不支持 IndexedDB，无法记录历史。</p></div>';
      return;
    }

    window.QuizIDB.getAll(500).then(function (list) {
      const total = list.length;
      const right = list.filter(function (r) { return r.correct; }).length;
      const acc = total ? Math.round(right / total * 100) : 0;

      let h = `
        <div class="card">
          <h1>答题历史</h1>
          <p class="muted">每次作答的时间、题型、题干与对错（IndexedDB 本地存储）。</p>
          <div class="stats">
            <div class="stat">记录<b>${total}</b></div>
            <div class="stat">正确<b>${right}</b></div>
            <div class="stat">正确率<b>${acc}%</b></div>
          </div>
          <div class="btn-row">
            <button class="btn" data-action="go-home">返回首页</button>
            <button class="btn danger" data-action="clear-history" ${total ? '' : 'disabled'}>清空历史</button>
          </div>
        </div>
      `;

      if (!total) {
        h += '<div class="card"><p class="muted">暂无作答记录。完成一道题后，这里会显示每次作答的明细。</p></div>';
      } else {
        h += '<section class="cards">' + list.map(function (r) {
          const q = qById(r.qid);
          const label = (q && TYPE_LABELS[q.type]) || TYPE_LABELS[r.qtype] || r.qtype || '未知';
          const stemText = q ? String(q.stem || '').replace(/\s+/g, ' ').slice(0, 60) : ('（题库中已无此题的题目数据：' + r.qid + '）');
          const time = new Date(r.ts).toLocaleString('zh-CN', { hour12: false });
          const dur = r.duration ? Math.max(1, Math.round(r.duration / 1000)) + 's' : '';
          const ansText = Array.isArray(r.answer)
            ? r.answer.filter(Boolean).join(' / ')
            : String(r.answer == null ? '' : r.answer).replace(/\s+/g, ' ').slice(0, 60);

          return `
            <div class="card history-item">
              <div class="history-head">
                <span class="badge ${r.correct ? 'badge-good' : 'badge-bad'}">${r.correct ? '正确' : '错误'}</span>
                <span class="hist-label">${esc(label)}</span>
                <span class="muted">${esc(time)}</span>
                ${dur ? `<span class="muted">${dur}</span>` : ''}
              </div>
              <div class="stem">${esc(stemText)}</div>
              ${ansText ? `<div class="muted">作答：${esc(ansText)}</div>` : ''}
            </div>
          `;
        }).join('') + '</section>';
      }

      view.innerHTML = h;
    }).catch(function () {
      view.innerHTML = '<div class="card"><h1>答题历史</h1><p class="muted">读取失败（IndexedDB 不可用）。</p></div>';
    });
  }

  function renderSettings() {
    view.innerHTML = `
      <div class="card">
        <h1>设置</h1>
        <p class="muted">
          本应用无后端。题库来自静态 JSON 文件；学习进度与自定义题库保存在当前浏览器中。
        </p>
        <div class="btn-row">
          <button class="btn" data-action="go-history">查看答题历史</button>
          <button class="btn danger" data-action="clear-history">清空答题历史</button>
        </div>
        <div class="btn-row">
          <button class="btn" data-action="export-progress">导出全部本机数据</button>
          <button class="btn" data-action="export-custom">导出自定义题库</button>
          <button class="btn danger" data-action="clear-data">清空本机数据</button>
        </div>
        <div class="btn-row">
          <label class="file-btn">导入本机数据<input type="file" id="importProgress" accept="application/json"></label>
          <label class="file-btn">导入题库JSON<input type="file" id="importQuestions" accept="application/json"></label>
        </div>
      </div>
    `;
  }

  function exportJSON(filename, obj) {
    const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function readJSONFile(file, cb) {
    if (!file) return;
    const fr = new FileReader();
    fr.onload = function () {
      try {
        cb(JSON.parse(fr.result));
      } catch (e) {
        alert('JSON 解析失败');
      }
    };
    fr.readAsText(file);
  }

  view.addEventListener('click', function (e) {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;

    const action = btn.getAttribute('data-action');
    const id = btn.getAttribute('data-id');

    if (action === 'start') {
      startQuiz(btn.dataset);
    }

    if (action === 'start-single') {
      startSingle(id);
    }

    if (action === 'option') {
      setProgress(id, { choice: btn.getAttribute('data-letter') });
      judgeObjective(qById(id));
    }

    if (action === 'submit-fill') {
      submitFill(id);
    }

    if (action === 'submit-codefill') {
      submitCodeFill(id);
    }

    if (action === 'submit-output') {
      submitOutput(id);
    }

    if (action === 'save-coding') {
      saveCoding(id);
    }

    if (action === 'judge-subj') {
      judgeSubjective(id, btn.getAttribute('data-correct') === '1');
    }

    if (action === 'toggle-fav') {
      toggleFav(id);
    }

    if (action === 'toggle-analysis') {
      const prog = getProgress(id);
      setProgress(id, { showAnalysis: !prog.showAnalysis });
      render();
    }

    if (action === 'prev') {
      quiz.index = Math.max(0, quiz.index - 1);
      saveQuiz();
      render();
    }

    if (action === 'next') {
      quiz.index = Math.min(quiz.qids.length - 1, quiz.index + 1);
      saveQuiz();
      render();
    }

    if (action === 'finish') {
      location.hash = '#/report';
    }

    if (action === 'exit-quiz') {
      quiz = null;
      sessionStorage.removeItem('quiz');
      location.hash = '#/';
    }

    if (action === 'remove-wrong') {
      removeWrong(id);
      render();
    }

    if (action === 'export-progress') {
      exportJSON('cpp-quiz-local-data.json', db);
    }

    if (action === 'export-custom') {
      exportJSON('cpp-quiz-custom-questions.json', { questions: db.customQuestions || [] });
    }

    if (action === 'go-history') {
      location.hash = '#/history';
    }

    if (action === 'go-home') {
      location.hash = '#/';
    }

    if (action === 'clear-history') {
      if (confirm('确认清空全部答题历史记录？该操作不可恢复。')) {
        window.QuizIDB.clear().then(function () {
          alert('已清空答题历史');
          render();
        }).catch(function () {
          alert('清空失败（IndexedDB 不可用）');
        });
      }
    }

    if (action === 'clear-data') {
      if (confirm('确认清空本机刷题数据？该操作不可恢复。')) {
        localStorage.removeItem(STORAGE_KEY);
        location.reload();
      }
    }
  });

  view.addEventListener('change', function (e) {
    if (e.target.id === 'importProgress') {
      readJSONFile(e.target.files[0], function (data) {
        db = Object.assign({}, defaultDb, data);
        saveDb();
        alert('导入成功');
        render();
      });
    }

    if (e.target.id === 'importQuestions') {
      readJSONFile(e.target.files[0], function (data) {
        let arr = Array.isArray(data) ? data : (data.questions || []);
        const existing = {};

        allQuestions().forEach(function (q) {
          existing[q.id] = true;
        });

        let added = 0;

        arr.forEach(function (q, i) {
          if (!q.id) q.id = 'custom-' + Date.now() + '-' + i;
          if (existing[q.id]) return;

          db.customQuestions.push(q);
          existing[q.id] = true;
          added++;
        });

        saveDb();
        alert('导入成功，新增 ' + added + ' 题');
        render();
      });
    }
  });

  window.addEventListener('hashchange', render);

  async function init() {
    await loadData();
    render();
  }

  init();
})();
