import type { JSONContent } from '@tiptap/core';

const paragraph = (text: string): JSONContent => ({ type: 'paragraph', ...(text ? { content: [{ type: 'text', text }] } : {}) });

// Recognize task lines only. Other text (including angle brackets and HTML)
// remains literal; this is deliberately not an HTML/Markdown rendering path.
export function parseMarkdownTasks(text: string): JSONContent[] | null {
  const blocks: JSONContent[] = [];
  const stack: { indent: number; list: JSONContent; last: JSONContent }[] = [];
  let found = false;
  let fence: { marker: string; length: number } | null = null;
  for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
    const delimiter = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (delimiter) {
      if (!fence) fence = { marker: delimiter[1][0], length: delimiter[1].length };
      else if (delimiter[1][0] === fence.marker && delimiter[1].length >= fence.length && !delimiter[2].trim()) fence = null;
      stack.length = 0;
      blocks.push(paragraph(line));
      continue;
    }
    const task = !fence && /^([ \t]*)[-*+][ \t]+\[([ xX])\](?:[ \t]+(.*)|$)/.exec(line);
    const indent = task ? task[1].replace(/\t/g, '    ').length : 0;
    // Four-space indentation without a parent task is a Markdown code block.
    if (!task || (!stack.length && indent >= 4)) {
      stack.length = 0;
      blocks.push(paragraph(line));
      continue;
    }
    found = true;
    const item: JSONContent = { type: 'taskItem', attrs: { checked: task[2].toLowerCase() === 'x' }, content: [paragraph(task[3] || '')] };
    while (stack.length && indent < stack[stack.length - 1].indent) stack.pop();
    let parent = stack[stack.length - 1];
    if (!parent || indent > parent.indent) {
      const list: JSONContent = { type: 'taskList', content: [] };
      if (parent) parent.last.content!.push(list);
      else blocks.push(list);
      parent = { indent, list, last: item };
      stack.push(parent);
    }
    parent.list.content!.push(item);
    parent.last = item;
  }
  return found ? blocks : null;
}
