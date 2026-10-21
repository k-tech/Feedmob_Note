import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, EditorState } from '@tiptap/pm/state';

export interface SlashMatch { from: number; to: number; query: string }
interface SlashState { match: SlashMatch | null; dismissedFrom: number | null }
export const slashCommandKey = new PluginKey<SlashState>('slashCommand');

export function findSlashMatch(state: EditorState): SlashMatch | null {
  const { selection } = state;
  const { $from, empty } = selection;
  if (!empty || !$from.parent.isTextblock || $from.parent.type.spec.code) return null;
  const before = $from.parent.textBetween(0, $from.parentOffset, '\n', '\ufffc');
  // Chinese punctuation mode types "、" for the "/" key.
  const match = /(?:^|\s)[/、]([^\s/、]*)$/.exec(before);
  if (!match) return null;
  return { from: $from.pos - match[1].length - 1, to: $from.pos, query: match[1] };
}

// Derive queries from committed document transactions, including IME, paste,
// undo and selection changes. Keydown events are not a source of document text.
export const SlashCommand = Extension.create({
  name: 'slashCommand',
  addProseMirrorPlugins() {
    return [new Plugin<SlashState>({
      key: slashCommandKey,
      state: {
        init: () => ({ match: null, dismissedFrom: null }),
        apply(tr, previous, oldState, state) {
          if (tr.getMeta(slashCommandKey) === 'close') {
            return { match: null, dismissedFrom: previous.match?.from ?? null };
          }
          if (!tr.docChanged && !tr.selectionSet) return previous;
          if (!tr.docChanged && tr.selection.eq(oldState.selection)) return previous;
          const match = findSlashMatch(state);
          const dismissedFrom = previous.dismissedFrom === null ? null : tr.mapping.map(previous.dismissedFrom);
          if (!match) return { match: null, dismissedFrom: null };
          if (match.from === dismissedFrom) return { match: null, dismissedFrom };
          // Moving the caret away dismisses the menu; navigation alone never opens it.
          if (!tr.docChanged) return { match: null, dismissedFrom: null };
          return { match, dismissedFrom: null };
        },
      },
    })];
  },
});
