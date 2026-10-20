import type { NodeViewRendererProps } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { TextSelection } from '@tiptap/pm/state';
import { closeHistory } from '@tiptap/pm/history';
import { boundedSize, trackResize } from '../utils/resize';

export const columnWeight = (value: unknown) => boundedSize(value, 1, 0.01, 100);

export function columnView({ node, editor, getPos }: NodeViewRendererProps) {
  let current = node;
  let cancelResize: (() => void) | undefined;
  const dom = document.createElement('div');
  dom.dataset.type = 'column';
  dom.className = 'column-block';
  const contentDOM = document.createElement('div');
  contentDOM.className = 'column-content';
  const append = document.createElement('button');
  append.type = 'button';
  append.contentEditable = 'false';
  append.className = 'column-add-block';
  append.dataset.editorControl = 'true';
  append.setAttribute('aria-label', '在此列末尾添加区块');
  append.title = '在此列继续记录，点击选择区块类型';
  append.textContent = '＋ 添加区块';
  const handle = document.createElement('div');
  handle.contentEditable = 'false';
  handle.className = 'column-resize-handle';
  handle.dataset.editorControl = 'true';
  handle.tabIndex = 0;
  handle.setAttribute('role', 'separator');
  handle.setAttribute('aria-label', '调整相邻列宽度');
  handle.setAttribute('aria-orientation', 'vertical');
  handle.title = '拖动调整列宽；双击均分；方向键微调';
  dom.append(contentDOM, append, handle);

  const sync = () => {
    dom.style.flex = `${columnWeight(current.attrs.width)} 1 0%`;
    dom.dataset.columnWidth = String(columnWeight(current.attrs.width));
    append.hidden = !editor.isEditable;
    handle.hidden = !editor.isEditable;
  };
  sync();
  const context = () => {
    const pos = getPos();
    if (typeof pos !== 'number' || editor.isDestroyed || !editor.isEditable) return null;
    const $pos = editor.state.doc.resolve(pos);
    const row = $pos.parent, index = $pos.index();
    if (row.type.name !== 'columnList' || index + 1 >= row.childCount) return null;
    const right = row.child(index + 1);
    const rightDOM = editor.view.nodeDOM(pos + current.nodeSize);
    if (!(rightDOM instanceof HTMLElement)) return null;
    return { pos, right, rightDOM, left: editor.state.doc.nodeAt(pos)!, doc: editor.state.doc };
  };
  type Pair = NonNullable<ReturnType<typeof context>>;
  const apply = (pair: Pair, ratio: number) => {
    if (editor.isDestroyed || !editor.isEditable || !editor.state.doc.eq(pair.doc)) return;
    const total = columnWeight(pair.left.attrs.width) + columnWeight(pair.right.attrs.width);
    const left = Number((total * ratio).toFixed(6));
    const right = Number((total - left).toFixed(6));
    if (Math.abs(left - columnWeight(pair.left.attrs.width)) < 0.00001) return;
    const tr = closeHistory(editor.state.tr);
    tr.setNodeMarkup(pair.pos, undefined, { ...pair.left.attrs, width: left });
    tr.setNodeMarkup(pair.pos + pair.left.nodeSize, undefined, { ...pair.right.attrs, width: right });
    editor.view.dispatch(tr);
    editor.view.dispatch(closeHistory(editor.state.tr));
  };
  handle.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    const pair = context();
    if (!pair) return;
    cancelResize?.();
    const leftRect = dom.getBoundingClientRect(), rightRect = pair.rightDOM.getBoundingClientRect();
    const width = leftRect.width + rightRect.width;
    if (width <= 0) return;
    const minimum = Math.min(120, width * 0.25);
    const total = columnWeight(pair.left.attrs.width) + columnWeight(pair.right.attrs.width);
    let ratio = leftRect.width / width;
    // Never mark the row itself: it is ProseMirror-managed DOM, and an
    // attribute change there re-renders the row and destroys this view.
    const body = dom.ownerDocument.body;
    body.classList.add('is-resizing-columns');
    dom.classList.add('is-resizing');
    cancelResize = trackResize(event, handle, x => {
      ratio = Math.max(minimum / width, Math.min(1 - minimum / width, (leftRect.width + x - event.clientX) / width));
      dom.style.flex = `${total * ratio} 1 0%`;
      pair.rightDOM.style.flex = `${total * (1 - ratio)} 1 0%`;
    }, cancelled => {
      cancelResize = undefined;
      body.classList.remove('is-resizing-columns');
      dom.classList.remove('is-resizing');
      sync();
      pair.rightDOM.style.flex = `${columnWeight(pair.right.attrs.width)} 1 0%`;
      if (!cancelled) apply(pair, ratio);
      // Keep Cmd/Ctrl+Z working right after the drag, as in Notion.
      if (!editor.isDestroyed) editor.view.focus();
    });
  });
  handle.addEventListener('dblclick', event => { event.preventDefault(); const pair = context(); if (pair) apply(pair, 0.5); });
  handle.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home'].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    const pair = context();
    if (!pair) return;
    const total = columnWeight(pair.left.attrs.width) + columnWeight(pair.right.attrs.width);
    const ratio = columnWeight(pair.left.attrs.width) / total;
    const width = dom.getBoundingClientRect().width + pair.rightDOM.getBoundingClientRect().width;
    const min = width > 0 ? Math.min(0.25, 120 / width) : 0.2;
    apply(pair, event.key === 'Home' ? 0.5 : Math.max(min, Math.min(1 - min, ratio + (event.key === 'ArrowRight' ? 0.025 : -0.025))));
  });
  const addBlock = (openMenu = false) => {
    const pos = getPos();
    if (typeof pos !== 'number' || editor.isDestroyed || !editor.isEditable) return;
    const col = editor.state.doc.nodeAt(pos);
    if (col?.type !== current.type) return;
    const last = col.lastChild;
    const tr = closeHistory(editor.state.tr);
    let caret = pos + col.nodeSize - 1;
    if (last?.type.name === 'paragraph' && !last.content.size) caret -= last.nodeSize - 1;
    else { tr.insert(caret, editor.schema.nodes.paragraph.create()); caret++; }
    // Match the editor's other + controls: an explicit click opens the block
    // picker, including when we reuse an existing empty paragraph.
    if (openMenu) { tr.insertText('/', caret); caret++; }
    tr.setSelection(TextSelection.near(tr.doc.resolve(caret)));
    editor.view.dispatch(tr);
    editor.view.focus();
    const block = editor.view.domAtPos(caret).node;
    const target = block instanceof HTMLElement ? block : block.parentElement;
    target?.scrollIntoView({ block: 'nearest' });
  };
  append.addEventListener('mousedown', event => event.preventDefault());
  append.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); addBlock(true); });
  dom.addEventListener('mousedown', event => { if (event.target === dom) event.preventDefault(); });
  dom.addEventListener('click', event => { if (event.target === dom) addBlock(); });
  return {
    dom, contentDOM,
    update(next: PMNode) { if (next.type !== current.type) return false; current = next; sync(); return true; },
    stopEvent(event: Event) { return append.contains(event.target as globalThis.Node) || handle.contains(event.target as globalThis.Node); },
    ignoreMutation(mutation: MutationRecord | { type: 'selection'; target: globalThis.Node }) {
      return mutation.type !== 'selection' && !contentDOM.contains(mutation.target);
    },
    destroy() { cancelResize?.(); },
  };
}
