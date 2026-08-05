import { readFileSync } from 'fs';

const file = process.argv[2];

if (!file) {
  console.error('用法: node tools/validate.mjs data/questions/sample.json');
  process.exit(1);
}

const raw = readFileSync(file, 'utf8');
const data = JSON.parse(raw);

const questions = Array.isArray(data) ? data : data.questions;

if (!Array.isArray(questions)) {
  console.error('错误：JSON 中必须包含 questions 数组');
  process.exit(1);
}

const ids = new Set();

questions.forEach((q, index) => {
  if (!q.id) {
    console.error(`错误：第 ${index + 1} 题缺少 id`);
    process.exit(1);
  }

  if (ids.has(q.id)) {
    console.error(`错误：题目 id 重复：${q.id}`);
    process.exit(1);
  }

  ids.add(q.id);

  if (!q.type) {
    console.error(`错误：题目 ${q.id} 缺少 type`);
    process.exit(1);
  }

  if (!q.stem && !q.code && !q.codeLines) {
    console.error(`警告：题目 ${q.id} 可能缺少题干`);
  }

  if (q.type === 'single_choice') {
    if (!q.options) {
      console.error(`错误：选择题 ${q.id} 缺少 options`);
      process.exit(1);
    }

    if (!q.answer) {
      console.error(`错误：选择题 ${q.id} 缺少 answer`);
      process.exit(1);
    }
  }
});

console.log('校验通过：', file);
