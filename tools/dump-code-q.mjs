#!/usr/bin/env node
/**
 * dump-code-q.mjs — 提取所有含代码的题目（section=程序填空 的 fill_blank + code_output + code_fill）
 * 输出 out/dump-code-q.txt（UTF-8）
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const DIR = 'data/questions';
const OUT = 'out/dump-code-q.txt';
mkdirSync('out', { recursive: true });

const files = readdirSync(DIR).filter(f => f.endsWith('.json')).sort();
const lines = [];
const push = (s = '') => lines.push(s);

for (const f of files) {
  const data = JSON.parse(readFileSync(join(DIR, f), 'utf8'));
  const qs = Array.isArray(data) ? data : data.questions;

  const fills = qs.filter(q => q.type === 'fill_blank' && (q.section || '').includes('程序填空'));
  const outputs = qs.filter(q => q.type === 'code_output');
  if (!fills.length && !outputs.length) continue;

  push(`\n########## ${f} ##########`);

  if (fills.length) {
    push(`\n===== 程序填空题（fill_blank / section=程序填空）共 ${fills.length} 题 =====`);
    fills.forEach((q, i) => {
      push(`\n--- [${i + 1}] ${q.id} ---`);
      push(`stem: ${q.stem}`);
      if (q.code) push(`code: ${JSON.stringify(q.code)}`);
      push(`answer: ${JSON.stringify(q.answer)}`);
      push(`analysis: ${q.analysis || ''}`);
    });
  }

  if (outputs.length) {
    push(`\n===== 程序阅读题（code_output）共 ${outputs.length} 题 =====`);
    outputs.forEach((q, i) => {
      push(`\n--- [${i + 1}] ${q.id} ---`);
      push(`stem: ${q.stem}`);
      push(`answer: ${JSON.stringify(q.answer)}`);
      push(`accepted: ${JSON.stringify(q.accepted || [])}`);
    });
  }
}

writeFileSync(OUT, lines.join('\n'), 'utf8');
console.log(`写入 ${OUT}`);
