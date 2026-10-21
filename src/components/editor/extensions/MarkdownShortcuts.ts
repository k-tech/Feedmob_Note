import { Extension, InputRule, textblockTypeInputRule, wrappingInputRule } from '@tiptap/core';
import { applyBlockConversion, type BlockType } from '../utils/block-conversion';

/**
 * Markdown typed in place becomes the block it describes, like Notion.
 * StarterKit covers the ASCII forms (`# `, `- `, `1. `, `> `, ``` and inline
 * marks). These rules add what Chinese IMEs produce in Chinese punctuation
 * mode (＃ 》 【】 ··· 。) and Markdown links.
 */
const SPACE = '[\\s\\u3000]';

/** Accept explicit web/mail links and bare domains; reject script URLs. */
export function normalizeTypedLink(raw: string): string | null {
  const value = raw.trim();
  if (/^(?:https?:\/\/|mailto:)\S+$/i.test(value)) return value;
  if (/^[\w-]+(?:\.[\w-]+)+(?:[/?#]\S*)?$/.test(value)) return 'https://' + value;
  return null;
}

/**
 * Inside a list item the wrapping/textblock rules above cannot apply (the item
 * already wraps the paragraph). Notion turns the item itself into the typed
 * type, e.g. "1. " in a bullet makes it numbered and "## " makes a heading.
 */
const LIST_ITEM_TURN_INTO: [RegExp, (match: RegExpMatchArray) => BlockType][] = [
  [new RegExp(`^\\d+[.。．)）]${SPACE}$`), () => 'orderedList'],
  [new RegExp(`^[-+*－＋＊]${SPACE}$`), () => 'bulletList'],
  [new RegExp(`^([#＃]{1,3})${SPACE}$`), match => `heading${match[1].length}` as BlockType],
  [new RegExp(`^[>》]${SPACE}$`), () => 'blockquote'],
  [new RegExp(`^(?:\`\`\`|···|｀｀｀)${SPACE}$`), () => 'codeBlock'],
];

function listItemTurnIntoRules(): InputRule[] {
  return LIST_ITEM_TURN_INTO.map(([find, target]) => new InputRule({
    find,
    handler: ({ state, range, match }) => {
      const { $from } = state.selection;
      const itemDepth = $from.depth - 1;
      if (itemDepth < 1 || $from.index(itemDepth) !== 0) return null;
      const item = $from.node(itemDepth);
      if (!['listItem', 'taskItem'].includes(item.type.name)) return null;
      const type = target(match);
      // Typing the list's own marker inside it stays literal text.
      if (type === $from.node(itemDepth - 1).type.name) return null;
      if (applyBlockConversion(state.tr, $from.before(itemDepth), type, range) === null) return null;
    },
  }));
}

export const MarkdownShortcuts = Extension.create({
  name: 'markdownShortcuts',
  addInputRules() {
    const { heading, blockquote, orderedList, bulletList, codeBlock } = this.editor.schema.nodes;
    const linkMark = this.editor.schema.marks.link;
    const rules: InputRule[] = [];
    if (heading) {
      rules.push(textblockTypeInputRule({
        find: new RegExp(`^([#＃]{1,3})${SPACE}$`),
        type: heading,
        getAttributes: match => ({ level: match[1].length }),
      }));
    }
    if (blockquote) rules.push(wrappingInputRule({ find: new RegExp(`^\\s*[>》]${SPACE}$`), type: blockquote }));
    if (bulletList) rules.push(wrappingInputRule({ find: new RegExp(`^\\s*[-+*－＋＊]${SPACE}$`), type: bulletList }));
    if (orderedList) {
      rules.push(wrappingInputRule({
        find: new RegExp(`^(\\d+)[.。．)）]${SPACE}$`),
        type: orderedList,
        getAttributes: match => ({ start: Number(match[1]) }),
        joinPredicate: (match, node) => node.childCount + node.attrs.start === Number(match[1]),
      }));
    }
    if (codeBlock) {
      rules.push(textblockTypeInputRule({
        find: new RegExp(`^(?:\`\`\`|···|｀｀｀)([\\w+#.-]*)${SPACE}$`),
        type: codeBlock,
        getAttributes: match => ({ language: match[1] || null }),
      }));
    }
    if (linkMark) {
      rules.push(new InputRule({
        // [text](url) or the full-width 【text】（url）, not ![image](url).
        find: /(?:^|[^!])([[【]([^\]】]+)[\]】][(（]([^)）\s]+)[)）])$/,
        handler: ({ state, range, match }) => {
          const href = normalizeTypedLink(match[3]);
          if (!href) return null;
          // The closing bracket has not been inserted; a matched prefix
          // character before the link must stay as typed.
          const from = range.from + match[0].length - match[1].length;
          state.tr.replaceWith(from, range.to, state.schema.text(match[2], [linkMark.create({ href })]));
          state.tr.removeStoredMark(linkMark);
        },
      }));
    }
    rules.push(...listItemTurnIntoRules());
    return rules;
  },
});
