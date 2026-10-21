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

const ORDERED_MARKER = /^[(（]?(?:\d+|[a-zA-Z]|[ivxlcIVXLC]+|[一二三四五六七八九十]+)[.)）、]$/;

/** Word/WPS write list items as paragraphs styled `mso-list: l0 level2`. */
function normalizeWordLists(doc: Document): boolean {
  const isItem = (element: Element | null): element is HTMLElement =>
    !!element && element.tagName === 'P' && /mso-list:\s*l\d+/i.test(element.getAttribute('style') || '');
  const items = Array.from(doc.querySelectorAll('p')).filter(isItem);
  if (!items.length) return false;
  const done = new Set<Element>();
  for (const first of items) {
    if (done.has(first)) continue;
    const run: HTMLElement[] = [];
    for (let element: Element | null = first; isItem(element); element = element.nextElementSibling) run.push(element);
    const stack: { level: number; list: HTMLElement }[] = [];
    let root: HTMLElement | null = null;
    for (const paragraph of run) {
      done.add(paragraph);
      const level = Number(/level(\d+)/i.exec(paragraph.getAttribute('style') || '')?.[1] || 1);
      const markerElement = paragraph.querySelector('span[style*="mso-list:Ignore" i]');
      const marker = (markerElement?.textContent || '').replace(/\u00a0/g, ' ').trim();
      markerElement?.remove();
      while (stack.length && stack[stack.length - 1].level > level) stack.pop();
      let top = stack[stack.length - 1];
      if (!top || top.level < level) {
        const ordered = ORDERED_MARKER.test(marker);
        const list = doc.createElement(ordered ? 'ol' : 'ul');
        const start = Number(/^\d+/.exec(marker)?.[0]);
        if (ordered && start > 1) list.setAttribute('start', String(start));
        if (top) (top.list.lastElementChild ?? top.list).appendChild(list);
        else root = list;
        top = { level, list };
        stack.push(top);
      }
      const item = doc.createElement('li');
      const body = doc.createElement('p');
      body.append(...Array.from(paragraph.childNodes));
      item.appendChild(body);
      top.list.appendChild(item);
    }
    run[0].before(root!);
    run.forEach(paragraph => paragraph.remove());
  }
  return true;
}

/**
 * Bring clipboard HTML from common apps into the editor's structure before
 * ProseMirror parses it. Internal Minework slices are left untouched.
 */
export function normalizePastedHTML(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  if (doc.querySelector('[data-pm-slice]')) return html;
  let changed = false;
  // Word / WPS: real lists, and no " " paragraphs from <o:p>&nbsp;</o:p>.
  if (/mso-|urn:schemas-microsoft-com/i.test(html)) {
    changed = normalizeWordLists(doc) || changed;
    for (const marker of Array.from(doc.getElementsByTagName('o:p'))) { marker.replaceWith(...Array.from(marker.childNodes)); changed = true; }
    for (const paragraph of Array.from(doc.querySelectorAll('p'))) {
      if (!paragraph.querySelector('img') && !paragraph.textContent!.replace(/[\s\u00a0]/g, '')) { paragraph.textContent = ''; changed = true; }
    }
  }
  // Notion and GitHub toggles.
  for (const details of Array.from(doc.querySelectorAll('details')).reverse()) {
    const toggle = doc.createElement('div');
    toggle.setAttribute('data-type', 'toggle');
    toggle.setAttribute('data-collapsed', String(!details.hasAttribute('open')));
    const title = doc.createElement('p');
    const summary = Array.from(details.children).find(child => child.tagName === 'SUMMARY');
    if (summary) { title.append(...Array.from(summary.childNodes)); summary.remove(); }
    toggle.append(title, ...Array.from(details.childNodes));
    details.replaceWith(toggle);
    changed = true;
  }
  // A code block's final newline is a terminator, not a blank last line.
  for (const pre of Array.from(doc.querySelectorAll('pre'))) {
    let last: Node | null = pre;
    while (last && last.nodeType !== 3) last = last.lastChild;
    if (last && (last as Text).data.endsWith('\n')) { (last as Text).data = (last as Text).data.slice(0, -1); changed = true; }
  }
  // Google Docs separates blocks with bare <br>s at the top level.
  for (const br of Array.from(doc.querySelectorAll('body > br, b[id^="docs-internal-guid"] > br'))) { br.remove(); changed = true; }
  const normalized = changed ? doc.body.innerHTML : html;
  return normalizeTaskHTML(normalized);
}

/** Markdown images are blocks here: lift them out of their sentence. */
function liftImages(doc: Document) {
  for (const image of Array.from(doc.querySelectorAll('p img'))) {
    const paragraph = image.closest('p')!;
    const after = doc.createElement('p');
    let node = image.nextSibling;
    while (node) { const next = node.nextSibling; after.appendChild(node); node = next; }
    paragraph.after(image);
    image.after(after);
    for (const part of [paragraph, after]) {
      if (part.firstChild?.nodeType === 3) part.firstChild.textContent = part.firstChild.textContent!.replace(/^\s+/, '');
      if (part.lastChild?.nodeType === 3) part.lastChild.textContent = part.lastChild.textContent!.replace(/\s+$/, '');
      if (!part.textContent && !part.querySelector('img')) part.remove();
    }
  }
}

const LIST_LINE = /^\s*(?:[-+*]|\d+[.)])\s/;

/**
 * Plain text from Minework (and Notion) puts one block per line with no
 * blank lines. In Markdown an unindented line right after a list item or a
 * quote would be a lazy continuation of it; end the list/quote there.
 */
function separateBlocks(source: string): string {
  const out: string[] = [];
  let fence: string | null = null;
  let previous = '';
  for (const line of source.split('\n')) {
    const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
    if (fence) { if (marker?.startsWith(fence[0]) && marker.length >= fence.length) fence = null; out.push(line); previous = line; continue; }
    if (marker) fence = marker;
    const continuesList = LIST_LINE.test(previous) || (/^\s+\S/.test(previous) && out.some(l => LIST_LINE.test(l)));
    const endsContainer = line.trim() && !/^\s/.test(line) && !LIST_LINE.test(line) && !line.startsWith('>')
      && (continuesList || previous.startsWith('>')) && previous.trim();
    if (endsContainer) out.push('');
    out.push(line);
    previous = line;
  }
  return out.join('\n');
}

/** Each pasted line is its own block (Notion), not a hard break in one paragraph. */
function splitLines(doc: Document) {
  for (const paragraph of Array.from(doc.body.querySelectorAll(':scope > p')).filter(p => p.querySelector(':scope > br'))) {
    let current = doc.createElement('p');
    const parts = [current];
    for (const child of Array.from(paragraph.childNodes)) {
      if (child.nodeName === 'BR') { current = doc.createElement('p'); parts.push(current); }
      else current.appendChild(child);
    }
    for (const part of parts) {
      if (part.firstChild?.nodeType === 3) part.firstChild.textContent = part.firstChild.textContent!.replace(/^\n/, '');
    }
    paragraph.replaceWith(...parts);
  }
}

export function parseMarkdown(text: string, schema: Schema): Fragment | null {
  const source = separateBlocks(text.replace(/\r\n?/g, '\n'));
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
  liftImages(dom);
  splitLines(dom);
  const doc = ProseMirrorParser.fromSchema(schema).parse(dom.body);
  doc.check();
  return doc.content;
}
