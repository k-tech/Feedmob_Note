import type { Fragment, Node as ProseMirrorNode, Slice } from '@tiptap/pm/model';
import type { EditorState } from '@tiptap/pm/state';

function inline(node: ProseMirrorNode): string {
  if (node.isText) {
    let text = node.text || '';
    if (!node.marks.some(mark => mark.type.name === 'code')) {
      // Plain text is read by people: only escape what would turn ordinary
      // text into formatting (* and `), not snake_case, [labels] or ~.
      text = text.replace(/[`*]/g, '\\$&');
    }
    for (const mark of node.marks) {
      if (mark.type.name === 'code') {
        const fence = '`'.repeat(Math.max(1, ...Array.from(text.matchAll(/`+/g), m => m[0].length + 1)));
        text = `${fence} ${text} ${fence}`;
      } else if (['bold', 'italic', 'strike'].includes(mark.type.name)) {
        const delimiter = { bold: '**', italic: '*', strike: '~~' }[mark.type.name]!;
        text = text.replace(/^(\s*)([\s\S]*?)(\s*)$/, (_all, before, body, after) => body ? `${before}${delimiter}${body}${delimiter}${after}` : before + after);
      }
      else if (mark.type.name === 'link') text = `[${text}](${mark.attrs.href})`;
    }
    return text;
  }
  if (node.type.name === 'hardBreak') return '\n';
  let text = '';
  node.forEach(child => { text += inline(child); });
  return text;
}

function block(node: ProseMirrorNode): string {
  const type = node.type.name;
  if (node.isText || node.isInline) return inline(node);
  if (type === 'paragraph') return inline(node);
  if (type === 'heading') return `${'#'.repeat(node.attrs.level)} ${inline(node)}`;
  if (type === 'codeBlock') {
    const fence = '`'.repeat(Math.max(3, ...Array.from(node.textContent.matchAll(/`+/g), m => m[0].length + 1)));
    return `${fence}${node.attrs.language || ''}\n${node.textContent}\n${fence}`;
  }
  if (['taskList', 'bulletList', 'orderedList'].includes(type)) {
    const lines: string[] = [];
    node.forEach((item, _offset, index) => {
      const prefix = type === 'taskList' ? `- [${item.attrs.checked ? 'x' : ' '}] `
        : type === 'orderedList' ? `${(node.attrs.start || 1) + index}. ` : '- ';
      // Checkbox syntax is item content, not part of Markdown's list marker.
      const indent = ' '.repeat(type === 'taskList' ? 2 : prefix.length);
      const parts: string[] = [];
      item.forEach((child, _pos, childIndex) => {
        const text = block(child);
        if (!childIndex) parts.push(prefix + text.replace(/\n/g, '\n' + indent));
        else if (['taskList', 'bulletList', 'orderedList'].includes(child.type.name)) parts.push(text.split('\n').map(line => indent + line).join('\n'));
        // A second paragraph inside one item keeps Markdown's blank line, or
        // it would come back as a line break of the first (rare in logs).
        else parts.push('\n' + text.split('\n').map(line => indent + line).join('\n'));
      });
      lines.push(parts.join('\n'));
    });
    return lines.join('\n');
  }
  if (type === 'horizontalRule') return '---';
  if (type === 'blockquote' || type === 'callout') return serializeBlocks(node.content).split('\n').map(line => '> ' + line).join('\n');
  if (type === 'table') {
    const rows: string[] = [];
    node.forEach((row, _pos, index) => {
      const cells: string[] = [];
      row.forEach(cell => cells.push(serializeBlocks(cell.content).replace(/\n/g, '<br>').replace(/\|/g, '\\|')));
      rows.push('| ' + cells.join(' | ') + ' |');
      if (index === 0) rows.push('| ' + cells.map(() => '---').join(' | ') + ' |');
    });
    return rows.join('\n');
  }
  // Custom blocks keep their full attributes in ProseMirror's HTML clipboard.
  // Their plain-text representation is intentionally readable and portable.
  if (type === 'image') {
    const label = node.attrs.alt || node.attrs.caption || '图片';
    // Embedded image bytes stay in the rich Slice, not text indexes/clipboards.
    return /^https?:\/\//i.test(node.attrs.src || '') ? `![${label}](${node.attrs.src})` : `[图片${label === '图片' ? '' : '：' + label}]`;
  }
  if (type === 'htmlPreview') return `[HTML 预览${node.attrs.title ? '：' + node.attrs.title : ''}]`;
  if (type === 'embed') return node.attrs.src || '[嵌入内容]';
  if (type === 'mermaid') return '```mermaid\n' + (node.attrs.code || '') + '\n```';
  if (type === 'whiteboard') return '[白板]';
  return serializeBlocks(node.content);
}

/**
 * One line per block, like Notion's plain text: no blank line between
 * blocks, so pasting into a text editor or chat keeps the log's line rhythm.
 * An empty paragraph is a deliberate blank line and stays exactly one.
 */
export function serializeBlocks(content: Fragment): string {
  const blocks: string[] = [];
  content.forEach(node => blocks.push(block(node)));
  return blocks.join('\n');
}

export function serializeClipboard(slice: Slice, state: EditorState): string {
  const { selection, doc } = state;
  if (selection.$from.sameParent(selection.$to) && selection.$from.parent.isTextblock) {
    // A partial text selection is text, not a request to copy its task/heading.
    return doc.textBetween(selection.from, selection.to, '\n', node => node.type.name === 'hardBreak' ? '\n' : node.textContent);
  }
  return serializeBlocks(slice.content);
}
