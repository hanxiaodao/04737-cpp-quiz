/**
 * normalize-code-output.mjs
 * 修复历史题库：程序阅读题（code_output）的代码曾嵌入 stem 且无换行。
 * 处理：把 stem 中"题干："之后的代码提取出来，按 C++ 语法断行/缩进，
 * 存入 codeLines 数组；stem 只保留题干文字。
 *
 * 用法：
 *   node tools/normalize-code-output.mjs            # dry-run，只打印不改文件
 *   node tools/normalize-code-output.mjs --apply    # 写回题库文件
 */
import { readdirSync, readFileSync, writeFileSync, copyFileSync } from 'fs';
import { join } from 'path';

const DIR = 'data/questions';
const TYPES = ['code_output'];

// ---------- 代码格式化：按 C++ 语法断行 + 花括号缩进 ----------
function formatCode(code) {
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

  const pushIndent = () => {
    if (!cur) cur = indent();
  };

  while (i < n) {
    const ch = code[i];

    // 字符串 / 字符字面量：整段原样保留
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
      pushIndent();
      cur += ch;
      brace++;
      const rest = code.slice(i + 1).replace(/^\s+/, '');
      if (/^(public|private|protected):/.test(rest)) { i++; continue; } // 与访问修饰符同行
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
        const semi = code.indexOf(';', i + 1); // 精确定位原串中的分号，跳过它
        i = semi + 1;
        flush();
        continue;
      }
      flush();
      i++;
      continue;
    }

    if (ch === ';') {
      pushIndent();
      cur = cur.replace(/\s+$/, '') + ';';
      if (paren === 0) flush();
      i++;
      continue;
    }

    // #include<...> 结束后断行（以 # 开头的行遇到 > 即断）
    if (ch === '>' && cur.replace(/^\s+/, '').startsWith('#')) {
      cur += ch;
      flush();
      i++;
      continue;
    }

    // 普通字符：行首先补缩进，行首空白跳过
    if (!cur) {
      if (/\s/.test(ch)) { i++; continue; }
      cur = indent();
    }
    cur += ch;
    i++;
  }

  cur = cur.replace(/\s+$/, '');
  if (cur.trim()) out.push(cur);
  return out;
}

// ---------- 从 stem 提取题干 + 代码 ----------
function splitStem(stem) {
  // 找第一个冒号（题干与代码的分界）。注意不能用 split(regex, 2)：
  // 它会在第 2 个冒号（如 :: 或 public: 中的冒号）处截断，丢弃其余代码。
  const idx = stem.search(/[：:]/);
  if (idx === -1) return null;
  const prompt = stem.slice(0, idx).trim();
  const code = stem.slice(idx + 1).trim();
  if (!/^(#include|class|struct|template|using\s+namespace|(int|double|char|float|long|unsigned|bool|void)\s+\w+|inline|const|virtual)/.test(code)) {
    return null;
  }
  return { prompt, code };
}

// ---------- 主流程 ----------
const apply = process.argv.includes('--apply');
const files = readdirSync(DIR).filter(f => f.endsWith('.json')).sort();
let fixedTotal = 0;

for (const file of files) {
  const path = join(DIR, file);
  const data = JSON.parse(readFileSync(path, 'utf8'));
  const questions = Array.isArray(data) ? data : data.questions;
  let changed = false;

  for (const q of questions) {
    if (!TYPES.includes(q.type)) continue;
    if (q.code || q.codeLines) continue; // 已有独立代码字段，跳过

    const parts = splitStem(q.stem || '');
    if (!parts) continue;

    const lines = formatCode(parts.code);

    console.log(`== ${q.id} (${file})`);
    console.log(`  题干: ${parts.prompt}`);
    console.log(`  代码行数: ${lines.length}`);
    console.log(`  --- 格式化预览 ---`);
    lines.slice(0, 8).forEach(l => console.log(`  | ${l}`));
    if (lines.length > 8) console.log(`  | ... (共 ${lines.length} 行)`);
    console.log('');

    if (apply) {
      q.stem = parts.prompt;
      q.codeLines = lines;
      changed = true;
      fixedTotal++;
    }
  }

  if (apply && changed) {
    copyFileSync(path, path + '.bak'); // 备份
    writeFileSync(path, JSON.stringify(data, null, 2) + '\n', 'utf8');
    console.log(`已更新 ${file}（备份: ${file}.bak）`);
  }
}

if (!apply) {
  console.log('\n[Dry-run] 未写文件。确认无误后运行: node tools/normalize-code-output.mjs --apply');
} else {
  console.log(`\n完成，共修复 ${fixedTotal} 题`);
}
