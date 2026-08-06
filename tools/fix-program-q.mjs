#!/usr/bin/env node
/**
 * fix-program-q.mjs — 修复程序填空题（fill_blank / section=程序填空）的代码格式
 *
 * 问题：代码全部内嵌在 stem 单行文本中，无换行无缩进。
 * 修复：把代码从 stem 提取为独立 codeLines（多行 + 规范缩进），stem 只保留题目说明。
 *       fill_blank 前端已支持 codeLines 渲染（getCode() 返回 join('\n') 后 <pre> 显示）。
 *
 * 幂等：已有 codeLines 的题目跳过。
 * 输出：out/fix-program-q-report.txt 转换报告；直接改写 data/questions/*.json
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const DIR = 'data/questions';
const OUT = 'out/fix-program-q-report.txt';
mkdirSync('out', { recursive: true });

const files = readdirSync(DIR).filter(f => f.endsWith('.json')).sort();
const report = [];
let converted = 0, skipped = 0;

// ---------- 断行 + 缩进核心 ----------
// C++ 语句起始关键词（行缓冲非空且括号深度为0时，遇到这些词前断行）
const STMT_KWS = /^(?<![A-Za-z0-9_])(int|char|double|float|long|unsigned|short|bool|void|string|class|struct|template|namespace|return|if|else|for|while|switch|case|cout|cin|friend|virtual|static|const|enum|break|continue|delete|new|using|include)\b/;

function splitCode(oneLine) {
  // 1) 保护字符串字面量
  const strings = [];
  let s = oneLine.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, m => {
    strings.push(m);
    return `\u0000${strings.length - 1}\u0000`;
  });

  // 2) 按断行点拆物理行
  const rawLines = [];
  let buf = '';
  let paren = 0;
  let ctrlParen = false;
  let inComment = false;

  function flush() {
    const t = buf.trim();
    if (t) rawLines.push(t);
    buf = '';
  }

  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    const next = s[i + 1] || '';

    // // 注释
    if (ch === '/' && next === '/') {
      flush();
      buf = '//';
      i++;
      inComment = true;
      continue;
    }
    if (inComment) {
      if (ch === ';' || ch === '{' || ch === '}' || ch === '\n') {
        flush();
        inComment = false;
        i--; // 重放断行字符
        continue;
      }
      if (paren === 0 && !ctrlParen) {
        const rest = s.slice(i);
        if (STMT_KWS.test(rest)) {
          flush();
          inComment = false;
          buf = ch; // 当前字符即关键词首字母，保留
          continue;
        }
      }
      buf += ch;
      continue;
    }

    if (ch === '\n') { flush(); continue; }

    if (ch === '(') {
      paren++;
      if (paren === 1 && /(for|while|if|switch|catch)\s*$/.test(buf)) ctrlParen = true;
      buf += ch;
      continue;
    }
    if (ch === ')') {
      paren--;
      if (ctrlParen && paren === 0) ctrlParen = false;
      buf += ch;
      continue;
    }

    if (ch === ';' && !ctrlParen) { buf += ch; flush(); continue; }
    if (ch === '{') {
      if (rawLines.length && rawLines[rawLines.length - 1].startsWith('//')) {
        rawLines[rawLines.length - 1] += ' ' + ch;
      } else {
        buf += ch;
        flush();
      }
      continue;
    }
    if (ch === '}') {
      flush();
      let token = '}';
      let j = i + 1;
      while (j < s.length && s[j] === ' ') j++;
      if (s[j] === ';') { token = '};'; i = j; }
      rawLines.push(token);
      continue;
    }

    // 访问说明符（行中）前断行
    if (paren === 0 && !ctrlParen && /^(public|private|protected):/.test(s.slice(i))) {
      const prev = buf[buf.length - 1] || '';
      // 前一个字符是非标识符且非 ':'（class B: public A 继承列表不断行）
      if (buf.trim() && prev !== ':' && !/[A-Za-z0-9_]/.test(prev)) flush();
    }

    // 语句关键词断行
    if (paren === 0 && !ctrlParen && buf.trim()) {
      const rest = s.slice(i);
      if (STMT_KWS.test(rest)) {
        const prev = buf[buf.length - 1] || '';
        // 关键词前需是分隔符，但排除 '<'（泛型参数 Sample<double> 等不断行）
        if (prev !== '<' && /[\s;{}()<>]/.test(prev)) {
          const kws = rest.match(STMT_KWS)[1];
          const MODIFIERS = /(virtual|static|const|inline|friend|explicit|register)\s*$/;
          const isType = /^(int|char|double|float|long|unsigned|short|bool|void|string)\b/.test(kws);
          const skip = (kws === 'using' && /#include\s*$/.test(buf))
            || (kws === 'namespace' && /using\s*$/.test(buf))
            || (kws === 'const' && /\)\s*$/.test(buf))   // int Get() const{
            || MODIFIERS.test(buf)                        // virtual void f1(){
            || (isType && /new\s*$/.test(buf));           // p=new int(10);
          if (!skip) {
            flush();
            buf = ch; // 当前字符即关键词首字母，保留
            continue;
          }
        }
      }
    }
    buf += ch;
  }
  flush();

  // 3) 还原字符串字面量
  const lines = rawLines.map(l => l.replace(/\u0000(\d+)\u0000/g, (m, n) => strings[Number(n)]));

  // 4) 计算缩进
  let depth = 0;
  const out = [];
  for (let line of lines) {
    let open = 0, close = 0;
    for (const ch of line) {
      if (ch === '{') open++;
      else if (ch === '}') close++;
    }
    const indent = (/^}/.test(line) ? Math.max(0, depth - 1) : depth) * 4;
    const pad = ' '.repeat(indent);

    const am = line.match(/^(public|private|protected):/);
    if (am && line.length > am[0].length) {
      out.push(pad + am[1] + ':');
      out.push(pad + line.slice(am[0].length).trim());
    } else {
      out.push(pad + line);
    }
    depth += open - close;
    if (depth < 0) depth = 0;
  }
  return out;
}

// ---------- 提取代码起点 ----------
const CODE_START = /(?:#include|class\s+[A-Za-z_]|struct\s+[A-Za-z_]|template\s*<|int\s+main|namespace\s+[A-Za-z_]|using\s+namespace|\bwhile\s*\(|____|friend\s+[A-Za-z_]|\bvirtual\b|\bstatic\s+[A-Za-z_]|\bconst\s+[A-Za-z_]|(?:int|double|char|float|long|bool|void|string)\s+[A-Za-z_]|cout\s*<<|cin\s*>>)/;

function splitStem(stem) {
  const m = stem.search(CODE_START);
  if (m === -1) return { desc: stem.trim(), code: '' };
  const desc = stem.slice(0, m)
    .replace(/(代码要点|代码|补全程序)([:：])?$/, '')
    .replace(/[:：]\s*$/, '')
    .trim();
  const code = stem.slice(m).trim();
  return { desc, code };
}

// ---------- 主流程 ----------
for (const f of files) {
  const path = join(DIR, f);
  const data = JSON.parse(readFileSync(path, 'utf8'));
  const qs = Array.isArray(data) ? data : data.questions;
  let changed = false;

  qs.forEach(q => {
    if (q.type !== 'fill_blank' || !(q.section || '').includes('程序填空')) return;
    if (Array.isArray(q.codeLines) && q.codeLines.length) { skipped++; return; }

    const { desc, code } = splitStem(q.stem);
    const codeLines = splitCode(code);

    report.push(`\n--- ${q.id} ---`);
    report.push(`说明: ${desc}`);
    report.push(`代码(${codeLines.length}行):`);
    codeLines.forEach(l => report.push(`  |${l}`));

    q.stem = desc || q.stem;
    q.codeLines = codeLines;
    changed = true;
    converted++;
  });

  if (changed) writeFileSync(path, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

report.unshift(`共处理：转换 ${converted} 题，跳过（已有 codeLines）${skipped} 题\n`);
writeFileSync(OUT, report.join('\n'), 'utf8');
console.log(`完成：转换 ${converted} 题，跳过 ${skipped} 题。报告：${OUT}`);
