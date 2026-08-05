/**
 * validate-lib.mjs
 * 题库校验公共逻辑，供 tools/validate.mjs 与 tools/update.mjs 复用。
 * 返回 { errors, warnings }，errors 为空即校验通过。
 */
export function checkQuestions(questions) {
  const errors = [];
  const warnings = [];
  const ids = new Set();

  questions.forEach((q, index) => {
    if (!q.id) {
      errors.push(`第 ${index + 1} 题缺少 id`);
      return;
    }

    if (ids.has(q.id)) {
      errors.push(`题目 id 重复：${q.id}`);
    }
    ids.add(q.id);

    if (!q.type) {
      errors.push(`题目 ${q.id} 缺少 type`);
    }

    if (!q.stem && !q.code && !q.codeLines) {
      warnings.push(`题目 ${q.id} 可能缺少题干`);
    }

    if (q.type === 'single_choice') {
      if (!q.options) {
        errors.push(`选择题 ${q.id} 缺少 options`);
      }
      if (!q.answer) {
        errors.push(`选择题 ${q.id} 缺少 answer`);
      }
    }
  });

  return { errors, warnings };
}
