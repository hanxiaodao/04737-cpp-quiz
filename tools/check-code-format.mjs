#!/usr/bin/env node
/**
 * check-code-format.mjs — 检查程序填空(code_fill)/程序阅读(code_output)题目的代码格式
 * 输出到 out/check-code-format.txt（UTF-8），避免控制台乱码。
 *
 * 检查项：
 *  1. codeLines 缺失 / 非数组 / 空数组
 *  2. 行内含真实换行符（\n \r）——数组元素应为单行
 *  3. 行内含 \t 制表符
 *  4. HTML 实体残留（&lt; &gt; &amp; &nbsp;）
 *  5. 乱码（U+FFFD、锟斤拷、é¢ 等 UTF-8 解码错乱特征）
 *  6. code_fill：占位符 ____X____ 与 blanks 不匹配 / 占位符格式不统一
 *  7. 缩进疑点：行尾有多余空格；缩进空格数非 2/4/8 倍数且非顶格
 *  8. 全角字符混入代码（全角括号/分号/逗号等，中文注释除外）
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const DIR = 'data/questions';
const OUT = 'out/check-code-format.txt';
mkdirSync('out', { recursive: true });

const files = readdirSync(DIR).filter(f => f.endsWith('.json')).sort();
const lines = [];
let totalFill = 0, totalOutput = 0;

function push(s = '') { lines.push(s); }

// 检查一行代码的格式问题
function inspectLine(line, idx, issues) {
  if (line.includes('\n') || line.includes('\r')) issues.push(`L${idx}: 行内含换行符`);
  if (line.includes('\t')) issues.push(`L${idx}: 含制表符`);
  if (/&(lt|gt|amp|nbsp|quot);/i.test(line)) issues.push(`L${idx}: HTML实体残留`);
  if (line.includes('\uFFFD') || /锟斤拷|烫烫烫|��/.test(line)) issues.push(`L${idx}: 疑似乱码`);
  if (/[ 　]+$/.test(line)) issues.push(`L${idx}: 行尾多余空格`);
  // 全角字符（排除中文注释）
  const noComment = line.replace(/\/\/.*$/, '').replace(/\/\*.*?\*\//g, '');
  const m = noComment.match(/[！？：；，。（）【】｛｝『』]/);
  if (m) issues.push(`L${idx}: 代码中混入全角标点「${m[0]}」`);
}

for (const f of files) {
  let data;
  try { data = JSON.parse(readFileSync(join(DIR, f), 'utf8')); }
  catch (e) { push(`[${f}] JSON 解析失败: ${e.message}`); continue; }

  const questions = Array.isArray(data) ? data : data.questions;
  if (!Array.isArray(questions)) { push(`[${f}] 无 questions 数组`); continue; }

  const target = questions.filter(q => q.type === 'code_fill' || q.type === 'code_output');
  if (!target.length) continue;

  push(`\n========== ${f}（code_fill ${target.filter(q => q.type === 'code_fill').length} 题，code_output ${target.filter(q => q.type === 'code_output').length} 题） ==========`);
  totalFill += target.filter(q => q.type === 'code_fill').length;
  totalOutput += target.filter(q => q.type === 'code_output').length;

  for (const q of target) {
    push(`\n--- ${q.id} [${q.type}] ${(q.stem || '').slice(0, 60)}`);
    const issues = [];

    if (!q.codeLines) { issues.push('缺 codeLines'); }
    else if (!Array.isArray(q.codeLines)) { issues.push('codeLines 非数组'); }
    else if (!q.codeLines.length) { issues.push('codeLines 为空'); }

    // 占位符检查（code_fill）
    if (q.type === 'code_fill') {
      const blanks = q.blanks || [];
      const used = new Set();
      (q.codeLines || []).forEach(l => {
        const ms = l.match(/_{2,}(.*?)_{2,}/g) || [];
        ms.forEach(m => used.add(m));
      });
      const blankIds = blanks.map(b => String(b.id || ''));
      // 代码中出现的占位符样式
      const styles = new Set();
      (q.codeLines || []).forEach(l => {
        const ms = l.match(/_{2,}(.*?)_{2,}/g) || [];
        ms.forEach(m => styles.add(m));
      });
      if (styles.size > 1) issues.push(`占位符样式不统一: [${[...styles].join('] [')}]`);
      if (used.size !== blankIds.length) {
        issues.push(`占位符数(${used.size}) != blanks 数(${blankIds.length})`);
      }
      // 每个 blank 的 id 是否在代码中作为 ____id____ 出现
      blankIds.forEach(bid => {
        if (!used.has(`____${bid}____`)) issues.push(`blanks id「${bid}」未在代码中找到 ____${bid}____`);
      });
      // blank 格式统一性
      const bidStyles = new Set(blankIds.map(id => (/^[0-9]+$/.test(id) ? '数字' : id.match(/[①-⑳]/) ? '圆圈数字' : /^\(.+\)$/.test(id) ? '括号' : '其他')));
      if (bidStyles.size > 1) issues.push(`blanks id 格式不统一: [${[...bidStyles].join(', ')}]`);
    }

    // 逐行检查
    (q.codeLines || []).forEach((l, i) => inspectLine(l, i + 1, issues));

    // 缩进整体评估：记录每行缩进量，找出异常
    if (Array.isArray(q.codeLines) && q.codeLines.length) {
      const indents = q.codeLines.map(l => l.match(/^ */)[0].length);
      // 首行不该缩进（除非是函数体续行，但代码段首行通常是 #include 或函数签名）
      if (indents[0] > 0) issues.push(`L1: 首行意外缩进 ${indents[0]} 空格`);
      // 每行的缩进若大于 12 空格或非 2/4/8 倍数且非 0，标记
      indents.forEach((n, i) => {
        if (n > 0 && n % 2 !== 0) issues.push(`L${i + 1}: 缩进 ${n} 空格（非 2 的倍数）`);
      });
      // 行内多个连续空格（可能是对齐问题，仅提示）
      q.codeLines.forEach((l, i) => {
        const m = l.match(/[^ ] {3,}[^ ]/);
        if (m) issues.push(`L${i + 1}: 行内 ${m[0].length - 2} 个连续空格`);
      });
    }

    if (issues.length) {
      push(`  ⚠ 问题:`);
      issues.forEach(i => push(`    - ${i}`));
    } else {
      push(`  ✓ 格式无异常`);
    }

    // 完整代码原样输出（每行加行号）
    push(`  ── 代码 ──`);
    (q.codeLines || []).forEach((l, i) => push(`  ${String(i + 1).padStart(3)}|${l}`));
  }
}

push(`\n\n===== 汇总：共检查 code_fill ${totalFill} 题、code_output ${totalOutput} 题 =====`);
writeFileSync(OUT, lines.join('\n'), 'utf8');
console.log(`检查完成，结果写入 ${OUT}`);
