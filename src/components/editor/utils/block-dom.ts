import type { EditorView } from '@tiptap/pm/view';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';

const LAYOUT_NODES = new Set(['column', 'columnList']);

/** Match the actual node DOM, including the outer wrapper of React NodeViews. */
export function resolveDomBlockPos(view: EditorView, dom: HTMLElement): number | null {
  try {
    const pos = view.posAtDOM(dom, 0);
    const at = view.state.doc.nodeAt(pos);
    if (at?.isBlock && view.nodeDOM(pos) === dom) return pos;
    const $pos = view.state.doc.resolve(pos);
    for (let depth = $pos.depth; depth > 0; depth--) {
      const before = $pos.before(depth);
      if ($pos.node(depth).isBlock && view.nodeDOM(before) === dom) return before;
    }
  } catch { /* Decoration DOM and detached NodeViews have no document position. */ }
  return null;
}

export interface BlockHit {
  pos: number;
  node: ProseMirrorNode;
  dom: HTMLElement;
  column: HTMLElement | null;
  row: HTMLElement | null;
}

/** Align actions with the first visible text line, including padded code blocks. */
export function blockHandleAnchor(dom: HTMLElement) {
  const bounds = dom.getBoundingClientRect();
  const text = dom.matches('p, h1, h2, h3, pre, li') ? dom : dom.querySelector<HTMLElement>('p, h1, h2, h3, pre');
  const line = text?.getBoundingClientRect() ?? bounds;
  const style = getComputedStyle(text ?? dom);
  const lineHeight = Number.parseFloat(style.lineHeight) || 26;
  const padding = Number.parseFloat(style.paddingTop) || 0;
  return { left: bounds.left - 48, top: line.top + padding + Math.max(0, (lineHeight - 26) / 2) };
}

function logicalBlock(view: EditorView, pos: number): BlockHit | null {
  let node = view.state.doc.nodeAt(pos);
  if (!node?.isBlock || LAYOUT_NODES.has(node.type.name)) return null;
  const $pos = view.state.doc.resolve(pos);
  // Table rows/cells are structural nodes; their handles address the table.
  for (let depth = $pos.depth; depth > 0; depth--) {
    if ($pos.node(depth).type.name === 'table') {
      pos = $pos.before(depth);
      node = $pos.node(depth);
      break;
    }
  }
  // Checkbox/number, text and nested content address one whole list item.
  for (let depth = $pos.depth; depth > 0; depth--) {
    if (node.type.name !== 'table' && ['listItem', 'taskItem'].includes($pos.node(depth).type.name)) {
      pos = $pos.before(depth);
      node = $pos.node(depth);
      break;
    }
  }
  // The first paragraph is the title of a toggle/callout, not a second block.
  if (node.isTextblock && ['toggle', 'callout', 'blockquote'].includes($pos.parent.type.name) && $pos.index() === 0) {
    pos = $pos.before();
    node = $pos.parent;
  }
  const dom = view.nodeDOM(pos);
  if (!(dom instanceof HTMLElement)) return null;
  return {
    pos, node, dom,
    column: dom.closest<HTMLElement>('[data-type="column"]'),
    row: dom.closest<HTMLElement>('[data-type="column-list"]'),
  };
}

function hitFromElement(view: EditorView, element: Element | null): BlockHit | null {
  for (let current = element; current && current !== view.dom; current = current.parentElement) {
    if (current.matches('[data-type="column"], [data-type="column-list"]')) return null;
    if (!(current instanceof HTMLElement)) continue;
    const pos = resolveDomBlockPos(view, current);
    if (pos !== null) return logicalBlock(view, pos);
  }
  return null;
}

function distance(value: number, start: number, end: number) {
  return Math.max(start - value, value - end, 0);
}

/** Find the nearest visible child; gaps belong to their local column. */
function nearestChild(scope: HTMLElement, x: number, y: number, view?: EditorView, excludePos?: number): HTMLElement | null {
  const horizontal = scope.matches('[data-type="column-list"]') && !getComputedStyle(scope).flexDirection.startsWith('column');
  let best: HTMLElement | null = null;
  let bestDistance = Infinity;
  for (const el of Array.from(scope.children)) {
    if (!(el instanceof HTMLElement)) continue;
    if (el.matches('[data-editor-control]')) continue;
    if (view && excludePos !== undefined && hitFromElement(view, el)?.pos === excludePos) continue;
    const rect = el.getBoundingClientRect();
    if (!rect.width || !rect.height) continue;
    const d = horizontal ? distance(x, rect.left, rect.right) : distance(y, rect.top, rect.bottom);
    if (d < bestDistance) { bestDistance = d; best = el; }
  }
  return best;
}

/** Resolve a gutter boundary without letting the dragged block mask a neighbour. */
export function findColumnGap(view: EditorView, row: HTMLElement, x: number, y: number, sourcePos?: number): { hit: BlockHit; zone: 'left' | 'right' } | null {
  const columns = Array.from(row.children).filter((el): el is HTMLElement => el instanceof HTMLElement && el.matches('[data-type="column"]'));
  const inColumn = (column: HTMLElement) => {
    let scope = column;
    for (let depth = 0; depth < 12; depth++) {
      const child = nearestChild(scope, x, y, view, sourcePos);
      if (!child) return null;
      const hit = hitFromElement(view, child);
      if (hit) return hit;
      scope = child;
    }
    return null;
  };
  for (let index = 0; index < columns.length - 1; index++) {
    const left = columns[index].getBoundingClientRect(), right = columns[index + 1].getBoundingClientRect();
    // Stacked mobile columns have no horizontal gutter.
    if (right.left <= left.right || x < left.right || x > right.left) continue;
    const leftHit = inColumn(columns[index]);
    if (leftHit) return { hit: leftHit, zone: 'right' };
    const rightHit = inColumn(columns[index + 1]);
    if (rightHit) return { hit: rightHit, zone: 'left' };
  }
  return null;
}

/**
 * Hover and drop use the same x/y lookup. In particular, a column's empty
 * padding resolves to a child in that column, never to the entire row.
 */
export function findBlockAtPoint(view: EditorView, x: number, y: number, forDrop = false): BlockHit | null {
  const bounds = view.dom.getBoundingClientRect();
  if (bounds.width && (x < bounds.left - 52 || x > bounds.right + 52 || y < bounds.top - 12 || y > bounds.bottom + 12)) return null;
  const element = document.elementFromPoint(x, y);
  const inside = element && view.dom.contains(element);
  if (inside) {
    const direct = hitFromElement(view, element);
    if (direct) return direct;
  }
  let scope: HTMLElement = inside
    ? (element!.closest<HTMLElement>('[data-type="column"], [data-type="column-list"]') ?? view.dom)
    : view.dom;
  // Read only a local row/column's children, rather than measuring every block
  // on every pointer move. This also handles the gutter left of each column.
  for (let depth = 0; depth < 12; depth++) {
    const child = nearestChild(scope, x, y);
    if (!child) return null;
    const hit = hitFromElement(view, child);
    if (hit) {
      const rect = hit.dom.getBoundingClientRect();
      return forDrop || distance(y, rect.top, rect.bottom) <= 24 ? hit : null;
    }
    scope = child;
  }
  return null;
}
