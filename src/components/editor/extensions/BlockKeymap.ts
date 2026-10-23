import { Extension } from '@tiptap/core';
import type { Editor } from '@tiptap/core';
import { Fragment, type ResolvedPos } from '@tiptap/pm/model';
import { Selection, TextSelection } from '@tiptap/pm/state';
import { joinTextblockForward } from '@tiptap/pm/commands';
import { convertBlock } from '../utils/block-conversion';
import { deleteBlockAtPos } from '../utils/block-movement';

const LIST_ITEMS = ['listItem', 'taskItem'];
const LISTS = ['bulletList', 'orderedList', 'taskList'];
const TITLED_CONTAINERS = ['blockquote', 'callout', 'toggle'];
const CODE_FENCE = /^(?:```|···|｀｀｀)([\w+#.-]*)$/;

/** An empty caret at the very start of a textblock, or null. */
function caretAtBlockStart(editor: Editor): ResolvedPos | null {
  const { selection } = editor.state;
  if (!(selection instanceof TextSelection) || !selection.empty) return null;
  const { $from } = selection;
  return $from.parent.isTextblock && $from.parentOffset === 0 ? $from : null;
}

/**
 * Notion turns a typed block back into text before it ever merges with the
 * block above. Each Backspace removes one level of formatting; text is never
 * pulled into a different column or lost across an isolating boundary.
 */
export function backspaceAtBlockStart(editor: Editor): boolean {
  const $from = caretAtBlockStart(editor);
  if (!$from || $from.depth < 1) return false;
  const block = $from.parent;
  const depth = $from.depth;
  if (block.type.spec.code) {
    // An empty code block becomes text (Tiptap's own handler). Code is never
    // merged into the line above; at most an empty line above is removed.
    if (!block.content.size) return false;
    const index = $from.index(depth - 1);
    const above = index > 0 ? $from.node(depth - 1).child(index - 1) : null;
    if (above?.type.name === 'paragraph' && !above.content.size) {
      const abovePos = $from.before(depth) - above.nodeSize;
      editor.view.dispatch(editor.state.tr.delete(abovePos, abovePos + above.nodeSize));
    }
    return true;
  }
  const blockPos = $from.before(depth);
  const container = depth > 1 ? $from.node(depth - 1) : null;
  const index = $from.index(depth - 1);

  if (block.type.name === 'heading') return editor.commands.setNode('paragraph');
  if (container && index === 0 && (LIST_ITEMS.includes(container.type.name) || TITLED_CONTAINERS.includes(container.type.name))) {
    return convertBlock(editor, $from.before(depth - 1), 'paragraph');
  }

  const { state, view } = editor;
  if (container?.type.name === 'column' && index === 0) {
    // Leaving the column is never a text merge. An empty block is removed
    // (with its column when it was the last one); typed text stays put.
    if (block.content.size) return true;
    // Deleting the last column can unwrap the row, so find the previous
    // text block again by its document order rather than by position.
    let preceding = 0;
    state.doc.nodesBetween(0, blockPos, (node, pos) => { if (node.isTextblock && pos < blockPos) preceding++; });
    if (!deleteBlockAtPos(editor, blockPos)) return true;
    let caret: number | null = null;
    editor.state.doc.descendants((node, pos) => {
      if (caret !== null) return false;
      if (node.isTextblock && --preceding === 0) caret = pos + node.nodeSize - 1;
    });
    if (caret !== null) view.dispatch(editor.state.tr.setSelection(TextSelection.create(editor.state.doc, caret)));
    return true;
  }

  const previous = index > 0 ? $from.node(depth - 1).child(index - 1) : null;
  if (!previous || previous.isTextblock || previous.isAtom || previous.type.name === 'table') return false;
  // Plain text after a list, quote, toggle or column row continues the last
  // visible line above it, as in Notion. ProseMirror's default would instead
  // wrap the paragraph back into the container (e.g. re-create a list item).
  const previousPos = blockPos - previous.nodeSize;
  const $end = previous.type.name === 'toggle' && previous.attrs.collapsed
    ? state.doc.resolve(previousPos + previous.firstChild!.nodeSize)
    : Selection.findFrom(state.doc.resolve(blockPos), -1, true)?.$from;
  if (!$end || $end.pos <= previousPos || !$end.parent.isTextblock || $end.parent.type.spec.code || $end.pos !== $end.end()) return true;
  const tr = state.tr.delete(blockPos, blockPos + block.nodeSize);
  if (block.content.size) tr.insert($end.pos, block.content);
  tr.setSelection(TextSelection.create(tr.doc, $end.pos));
  view.dispatch(tr.scrollIntoView());
  return true;
}

/**
 * Delete joins text across sibling list items, or pulls a paragraph after
 * a list, quote or toggle into its last line. ProseMirror's joinForward
 * otherwise joins wrappers without joining the text, or nests the paragraph.
 */
export function deleteAtBlockEnd(editor: Editor): boolean {
  const { selection, doc } = editor.state;
  if (!(selection instanceof TextSelection) || !selection.empty) return false;
  const { $from } = selection;
  if (!$from.parent.isTextblock || $from.parent.type.spec.code || $from.parentOffset !== $from.parent.content.size || $from.depth < 2) return false;
  const itemDepth = $from.depth - 1;
  const item = $from.node(itemDepth);
  if (LIST_ITEMS.includes(item.type.name) && $from.index(itemDepth) === item.childCount - 1) {
    const nextItem = doc.resolve($from.after(itemDepth)).nodeAfter;
    // joinForward only joins the item wrappers, leaving two paragraphs.
    // Join the text boundary too, keeping the following item's children.
    if (nextItem?.type === item.type) {
      return joinTextblockForward(editor.state, tr => editor.view.dispatch(tr));
    }
  }
  const $next = Selection.findFrom(doc.resolve($from.after()), 1, true)?.$from;
  if (!$next || $next.parentOffset !== 0) return false;
  const next = $next.parent;
  if (!['paragraph', 'heading'].includes(next.type.name)) return false;
  // Only text that sits outside the current container, directly after it.
  const nextDepth = $next.depth;
  if (nextDepth >= $from.depth || $next.before(nextDepth) !== $from.after(nextDepth)) return false;
  const nextPos = $next.before(nextDepth);
  const tr = editor.state.tr.delete(nextPos, nextPos + next.nodeSize);
  if (next.content.size) tr.insert($from.pos, next.content);
  tr.setSelection(TextSelection.create(tr.doc, $from.pos));
  try { tr.doc.check(); } catch { return false; }
  editor.view.dispatch(tr.scrollIntoView());
  return true;
}

/** Indent a text block under the list or toggle directly above it. */
function indentBlock(editor: Editor): boolean {
  const { $from } = editor.state.selection;
  if (!$from.parent.isTextblock || $from.parent.type.spec.code || $from.depth < 1) return false;
  const depth = $from.depth;
  const block = $from.parent;
  const blockPos = $from.before(depth);
  const parent = $from.node(depth - 1);
  // Text inside a list item is handled by the list's own Tab command.
  if (LIST_ITEMS.includes(parent.type.name)) return false;
  const index = $from.index(depth - 1);
  const previous = index > 0 ? parent.child(index - 1) : null;
  if (!previous) return false;
  const previousPos = blockPos - previous.nodeSize;
  const offset = $from.parentOffset;
  const { state, view } = editor;
  let tr = state.tr;
  if (LISTS.includes(previous.type.name)) {
    // Append to the last item of the list, at that item's deepest end.
    const item = previous.lastChild!;
    const itemEnd = previousPos + previous.nodeSize - 2;
    if (!item.type.validContent(item.content.append(Fragment.from(block)))) return false;
    tr = tr.delete(blockPos, blockPos + block.nodeSize).insert(itemEnd, block);
    tr.setSelection(TextSelection.create(tr.doc, itemEnd + 1 + offset));
  } else if (previous.type.name === 'toggle') {
    const end = previousPos + previous.nodeSize - 1;
    tr = tr.delete(blockPos, blockPos + block.nodeSize).insert(end, block);
    if (previous.attrs.collapsed) tr.setNodeMarkup(previousPos, undefined, { ...previous.attrs, collapsed: false });
    tr.setSelection(TextSelection.create(tr.doc, end + 1 + offset));
  } else return false;
  tr.doc.check();
  view.dispatch(tr.scrollIntoView());
  return true;
}

/** Move the last child of a list item or toggle out to follow its container. */
function outdentBlock(editor: Editor): boolean {
  const { $from } = editor.state.selection;
  if (!$from.parent.isTextblock || $from.depth < 2) return false;
  const depth = $from.depth;
  const container = $from.node(depth - 1);
  const index = $from.index(depth - 1);
  if (index === 0 || index !== container.childCount - 1) return false;
  const block = $from.parent;
  const blockPos = $from.before(depth);
  const offset = $from.parentOffset;
  let after: number;
  if (container.type.name === 'toggle') after = $from.after(depth - 1);
  else if (LIST_ITEMS.includes(container.type.name)) {
    // Only the final item may release a child without reordering siblings.
    const list = $from.node(depth - 2);
    if ($from.index(depth - 2) !== list.childCount - 1) return false;
    after = $from.after(depth - 2);
  } else return false;
  // The original precedes `after`, so the copy shifts back by its size.
  const tr = editor.state.tr.insert(after, block).delete(blockPos, blockPos + block.nodeSize);
  tr.setSelection(TextSelection.create(tr.doc, after - block.nodeSize + 1 + offset));
  tr.doc.check();
  editor.view.dispatch(tr.scrollIntoView());
  return true;
}

/** Tab keeps focus in the editor: code indents, text nests, nothing escapes. */
function codeIndent(editor: Editor, outdent: boolean): boolean {
  const { state, view } = editor;
  const { $from, from, to } = state.selection;
  if (!$from.parent.type.spec.code) return false;
  if (!outdent) {
    view.dispatch(state.tr.insertText('  ', from, to));
    return true;
  }
  const lineStart = $from.start() + $from.parent.textBetween(0, $from.parentOffset).lastIndexOf('\n') + 1;
  const spaces = /^ {1,2}/.exec(state.doc.textBetween(lineStart, Math.min(lineStart + 2, $from.end())))?.[0].length ?? 0;
  if (spaces) view.dispatch(state.tr.delete(lineStart, lineStart + spaces));
  return true;
}

/** ``` + Enter (optionally with a language) starts a code block. */
function enterCodeFence(editor: Editor): boolean {
  const { selection } = editor.state;
  if (!selection.empty) return false;
  const { $from } = selection;
  if ($from.parent.type.name !== 'paragraph' || $from.parentOffset !== $from.parent.content.size) return false;
  const match = CODE_FENCE.exec($from.parent.textContent);
  if (!match) return false;
  return editor.chain()
    .deleteRange({ from: $from.start(), to: $from.end() })
    .setNode('codeBlock', { language: match[1] || null })
    .run();
}

export const BlockKeymap = Extension.create({
  name: 'blockKeymap',
  // Above StarterKit's joinBackward, below block selection and slash menus.
  priority: 1000,
  addKeyboardShortcuts() {
    return {
      Backspace: ({ editor }) => {
        const plugin = editor.state.plugins.find(plugin => plugin.spec.isInputRules && plugin.getState(editor.state));
        const input = plugin?.getState(editor.state);
        // Undoing a whole-list replacement maps the caret to the suffix.
        // Restore the original input position after the literal marker.
        if (input) return editor.chain().undoInputRule().setTextSelection(input.from + input.text.length).run();
        return backspaceAtBlockStart(editor);
      },
      Delete: ({ editor }) => deleteAtBlockEnd(editor),
      // StarterKit's hard break would exit the code block; code wants a newline.
      'Shift-Enter': ({ editor }) => {
        if (!editor.state.selection.$from.parent.type.spec.code) return false;
        editor.view.dispatch(editor.state.tr.insertText('\n').scrollIntoView());
        return true;
      },
      Enter: ({ editor }) => enterCodeFence(editor),
      // Before liftListItem: nested text leaves its item without taking the item along.
      'Shift-Tab': ({ editor }) => outdentBlock(editor),
    };
  },
  addExtensions() {
    // Fallbacks run after list, table and task-item Tab handlers.
    return [Extension.create({
      name: 'blockKeymapFallback',
      priority: 10,
      addKeyboardShortcuts() {
        return {
          Tab: ({ editor }) => codeIndent(editor, false) || indentBlock(editor) || true,
          'Shift-Tab': ({ editor }) => codeIndent(editor, true) || true,
        };
      },
    })];
  },
});
