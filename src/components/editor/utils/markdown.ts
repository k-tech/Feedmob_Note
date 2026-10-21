import MarkdownIt from 'markdown-it';
import { DOMParser as ProseMirrorParser, type Schema, type Fragment } from '@tiptap/pm/model';

// External HTML is parsed through the editor schema. Markdown HTML stays literal;
// executable HTML is only available through the existing isolated preview block.
const markdown = new MarkdownIt({ html: false, breaks: true, linkify: false });

/**
 * A rendered checkbox at the start of a list item: `<input type="checkbox">`
 * from GitHub, Markdown previews and chat apps, possibly inside a label/span.
 */
function leadingCheckbox(root: Element): HTMLInputElement | null {
  for (const child of Array.from(root.childNodes)) {
    if (child.nodeType === 3 && !(child as Text).data.trim()) continue;
    if (child.nodeType !== 1) return null;
    const element = child as Element;
    if (element.matches('input[type="checkbox"]')) return element as HTMLInputElement;
    return ['LABEL', 'SPAN'].includes(element.tagName) ? leadingCheckbox(element) : null;
  }
  return null;
}

/** Normalize GFM/Notion checkbox text without discarding links or inline marks. */
export function normalizeTaskHTML(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  if (doc.querySelector('[data-pm-slice]')) return html;
  let changed = false;
  for (const list of Array.from(doc.querySelectorAll('ul, ol')).reverse()) {
    const items = Array.from(list.children).filter(child => child.tagName === 'LI');
    if (!items.length || list.getAttribute('data-type') === 'taskList') continue;
    const checked = items.map(item => {
      if (item.hasAttribute('data-type')) return null;
      const first = item.firstElementChild;
      const root = first && ['P', 'DIV'].includes(first.tagName) ? first : item;
      const texts: Text[] = [];
      const collect = (element: Node) => {
        for (const child of Array.from(element.childNodes)) {
          if (child.nodeType === 3) texts.push(child as Text);
          else if (child.nodeType === 1 && !['UL', 'OL', 'BR', 'P', 'DIV'].includes((child as Element).tagName)) collect(child);
          else break;
        }
      };
      const checkbox = leadingCheckbox(root);
      if (checkbox) {
        const isChecked = checkbox.hasAttribute('checked');
        checkbox.remove();
        item.setAttribute('data-type', 'taskItem');
        item.setAttribute('data-checked', String(isChecked));
        return isChecked;
      }
      collect(root);
      // Notion/GFM text markers, or box characters used by docs and chat apps.
      const match = /^\s*(?:\[([ xX])\]|([☐☑☒]))(?:[ \t]+|$)/.exec(texts.map(text => text.data).join(''));
      if (!match) return null;
      const isChecked = match[1] ? match[1].toLowerCase() === 'x' : match[2] !== '☐';
      let remaining = match[0].length;
      for (const text of texts) {
        const count = Math.min(remaining, text.length);
        text.deleteData(0, count); remaining -= count;
        if (!remaining) break;
      }
      item.setAttribute('data-type', 'taskItem');
      item.setAttribute('data-checked', String(isChecked));
      return isChecked;
    });
    if (checked.every(value => value === null)) continue;
    changed = true;
    const replacement = doc.createDocumentFragment();
    let group: Element | null = null;
    let taskGroup: boolean | null = null;
    items.forEach((item, index) => {
      const isTask = checked[index] !== null;
      if (!group || isTask !== taskGroup) {
        group = isTask ? doc.createElement('ul') : list.cloneNode(false) as Element;
        if (isTask) group.setAttribute('data-type', 'taskList');
        else if (list.tagName === 'OL') group.setAttribute('start', String(Number(list.getAttribute('start') || 1) + index));
        replacement.appendChild(group); taskGroup = isTask;
      }
      group.appendChild(item);
    });
    list.replaceWith(replacement);
  }
  if (changed) {
    for (const list of Array.from(doc.querySelectorAll('ul[data-type="taskList"]'))) {
      const previous = list.previousElementSibling;
      if (previous?.matches('ul[data-type="taskList"]')) {
        while (list.firstChild) previous.appendChild(list.firstChild);
        list.remove();
      }
    }
  }
  return changed ? doc.body.innerHTML : html;
}

export function parseMarkdown(text: string, schema: Schema): Fragment | null {
  const source = text.replace(/\r\n?/g, '\n');
  const tokens = markdown.parse(source, {});
  const meaningful = tokens.some(token => ['heading_open', 'bullet_list_open', 'ordered_list_open', 'blockquote_open', 'fence', 'code_block', 'hr', 'table_open'].includes(token.type)
    || token.children?.some(child => ['strong_open', 'em_open', 's_open', 'link_open', 'image', 'code_inline'].includes(child.type)));
  if (!meaningful) return null;
  // Markdown parsers include the fence's terminating newline in token.content.
  // Store only the code body, so repeated copy/paste never adds a blank line.
  for (const token of tokens) {
    if (token.type === 'fence' || token.type === 'code_block') token.content = token.content.replace(/\n$/, '');
  }
  const html = normalizeTaskHTML(markdown.renderer.render(tokens, markdown.options, {}));
  const dom = new DOMParser().parseFromString(html, 'text/html');
  const doc = ProseMirrorParser.fromSchema(schema).parse(dom.body);
  doc.check();
  return doc.content;
}
