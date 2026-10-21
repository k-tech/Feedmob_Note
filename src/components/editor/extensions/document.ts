import type { Extensions } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import TaskList from '@tiptap/extension-task-list';
import Underline from '@tiptap/extension-underline';
import Highlight from '@tiptap/extension-highlight';
import Link from '@tiptap/extension-link';
import { TaskItem } from './TaskItem';
import { CalloutNode } from './CalloutNode';
import { MermaidNode } from './MermaidNode';
import { WhiteboardNode } from './WhiteboardNode';
import { EmbedNode } from './EmbedNode';
import { ImageNode } from './ImageNode';
import { HtmlNode } from './HtmlNode';
import { TableExtensions } from './TableExtensions';
import { ColumnList, Column } from './ColumnsExtension';
import { ToggleNode } from './ToggleNode';

/**
 * The log's schema and node views. The editor adds its editing behaviour on
 * top; read-only views (team feed, log page) render the same document with
 * exactly these blocks, so every block type looks the same in both places.
 */
export function documentExtensions({ editable }: { editable: boolean }): Extensions {
  return [
    StarterKit.configure({
      // A second native cursor contradicts the column/group drop preview.
      dropcursor: false,
      heading: { levels: [1, 2, 3] },
    }),
    TaskList,
    TaskItem.configure({ nested: true }),
    Underline,
    Highlight.configure({ multicolor: true }),
    // Typing after a link continues as plain text, as in Notion. Readers
    // open links on click; writers place the caret in them instead.
    Link.extend({ inclusive: () => false }).configure({ openOnClick: !editable }),
    CalloutNode,
    MermaidNode,
    WhiteboardNode,
    EmbedNode,
    ImageNode,
    HtmlNode,
    ...TableExtensions,
    ColumnList,
    Column,
    ToggleNode,
  ];
}
