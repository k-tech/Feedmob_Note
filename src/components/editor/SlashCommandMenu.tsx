import React, { useEffect, useLayoutEffect, useState, useRef } from 'react';
import { HTML_EXAMPLE } from './extensions/HtmlNode';
import { convertBlock } from './utils/block-conversion';
import { addColumnsInRow, getLinePosFromSelection } from './utils/block-movement';
import { applyBlockConversion } from './utils/block-conversion';
import type { Editor } from '@tiptap/core';
import type { LucideIcon } from 'lucide-react';
import {
  Type,
  Heading1,
  Heading2,
  Heading3,
  CheckSquare,
  AlertTriangle,
  ChevronRight,
  GitGraph,
  Palette,
  Layout,
  Code2,
  Quote,
  Sparkles,
  List,
  ListOrdered,
  Minus,
  ImagePlus,
  Table2,
  Lightbulb,
  Info,
  Target,
} from 'lucide-react';

/**
 * Before a non-text block (image, table, divider…) is inserted: remove the
 * slash query, and when the line is an empty list item, leave the list first
 * so the block replaces the empty bullet instead of nesting under it.
 */
function beginBlockInsert(editor: Editor, range?: { from: number; to: number }) {
  const tr = editor.state.tr;
  if (range) tr.delete(range.from, range.to);
  const { $from } = tr.selection;
  const itemDepth = $from.depth - 1;
  const item = itemDepth > 0 ? $from.node(itemDepth) : null;
  if (item && ['listItem', 'taskItem'].includes(item.type.name) && item.childCount === 1 && !$from.parent.content.size) {
    applyBlockConversion(tr, $from.before(itemDepth), 'paragraph');
  }
  if (tr.docChanged) editor.view.dispatch(tr);
}

export interface SlashItem {
  id: string;
  title: string;
  description: string;
  keywords: string[];
  icon: LucideIcon;
  action: (editor: Editor, range?: { from: number; to: number }) => void;
}

interface SlashCommandMenuProps {
  editor: Editor | null;
  isOpen: boolean;
  onClose: () => void;
  position: { x: number; y: number };
  query?: string;
  range?: { from: number; to: number };
}

const ITEMS: SlashItem[] = [
  {
    id: 'image', title: '图片', description: '选择图片、粘贴截图、拖入文件或添加图片链接',
    keywords: ['image', 'img', 'photo', 'picture', 'tupian', '截图', '照片', '图片'], icon: ImagePlus,
    action: (editor, range) => {
      beginBlockInsert(editor, range);
      const chain = editor.chain().focus();
      chain.insertContent({ type: 'image' }).run();
    },
  },
  {
    id: 'html', title: 'HTML 预览', description: '在日志中显示 HTML 页面、样式和交互，可导入文件',
    keywords: ['html', 'web', 'preview', '网页', '界面', '代码预览', 'yulan'], icon: Code2,
    action: (editor, range) => {
      beginBlockInsert(editor, range);
      const chain = editor.chain().focus();
      chain.insertContent({ type: 'htmlPreview', attrs: { code: HTML_EXAMPLE } }).run();
    },
  },
  {
    id: 'table', title: '表格', description: '插入三列表格，整理指标、进度与对照信息',
    keywords: ['table', 'sheet', 'biaoge', '表格', '数据', '对照'], icon: Table2,
    action: (editor, range) => {
      beginBlockInsert(editor, range);
      const chain = editor.chain().focus();
      chain.insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
    },
  },
  ...([
    ['tip', '提示', '突出提醒、经验和注意事项', Lightbulb],
    ['info', '说明', '补充背景、上下文和参考信息', Info],
    ['success', '目标与产出', '记录目标、交付结果和里程碑', Target],
  ] as const).map(([id, title, description, icon]): SlashItem => ({
    id, title, description, keywords: [id, title, 'callout', '提示块', id === 'tip' ? 'tishi' : id === 'info' ? 'shuoming' : 'goal'], icon,
    action: (editor, range) => {
      beginBlockInsert(editor, range);
      const chain = editor.chain().focus();
      chain.insertContent({ type: 'callout', attrs: { type: id }, content: [{ type: 'paragraph' }] }).run();
    },
  })),
  {
    id: 'toggle', title: '折叠列表', description: '收起细节，让正文保持清晰',
    keywords: ['toggle', 'fold', 'zhedie', '折叠', '收起'], icon: ChevronRight,
    action: (editor, range) => {
      const pos = getLinePosFromSelection(editor);
      if (pos !== null) convertBlock(editor, pos, 'toggle', range);
    },
  },
  {
    id: "template",
    title: '今日标准日志模版',
    description: '一键插入「Done、阻塞卡点、Todo」结构化模版',
    keywords: ['moban', 'template', 'today', 'jinri', 'mb'],
    icon: Sparkles,
    action: (editor, range) => {
      beginBlockInsert(editor, range);
      const chain = editor.chain().focus();
      chain.insertContent([
        {
          type: 'heading',
          attrs: { level: 2 },
          content: [{ type: 'text', text: 'Done' }],
        },
        {
          type: 'taskList',
          content: [
            {
              type: 'taskItem',
              attrs: { checked: false },
              content: [{ type: 'paragraph' }],
            },
          ],
        },
        {
          type: 'callout',
          attrs: { type: 'blocker' },
          content: [{ type: 'paragraph', content: [{ type: 'text', text: '【Blocker】' }] }],
        },
        {
          type: 'heading',
          attrs: { level: 2 },
          content: [{ type: 'text', text: 'Todo' }],
        },
        {
          type: 'taskList',
          content: [
            {
              type: 'taskItem',
              attrs: { checked: false },
              content: [{ type: 'paragraph' }],
            },
          ],
        },
      ]).run();
    },
  },
  {
    id: "blocker",
    title: '卡点 / Blocker 高亮块',
    description: '特别标注阻塞风险与需协调事项',
    keywords: ['blocker', 'kadian', 'risk', 'warn', 'kd', 'callout'],
    icon: AlertTriangle,
    action: (editor, range) => {
      beginBlockInsert(editor, range);
      const chain = editor.chain().focus();
      chain.insertContent({
        type: 'callout',
        attrs: { type: 'blocker' },
        content: [{ type: 'paragraph', content: [{ type: 'text', text: '【Blocker】' }] }],
      }).run();
    },
  },
  {
    id: "taskList",
    title: '待办任务清单 (Todo)',
    description: '可勾选的 Task List 事项',
    keywords: ['todo', 'task', 'daiban', 'checklist', 'renwu'],
    icon: CheckSquare,
    action: (editor, range) => {
      const pos = getLinePosFromSelection(editor);
      if (pos !== null) convertBlock(editor, pos, 'taskList', range);
    },
  },
  {
    id: "mermaid",
    title: 'Mermaid 架构/流程图',
    description: '代码驱动的时序图、架构图与流程图',
    keywords: ['mermaid', 'flowchart', 'diagram', 'tu', 'liucheng'],
    icon: GitGraph,
    action: (editor, range) => {
      beginBlockInsert(editor, range);
      const chain = editor.chain().focus();
      chain.insertContent({
        type: 'mermaid',
        attrs: {
          code: 'graph TD\n  A[开始] --> B[处理]\n  B --> C[结束]',
        },
      }).run();
    },
  },
  {
    id: "whiteboard",
    title: '交互白板 / 画板 (Canvas)',
    description: '在日志中手绘架构与草图',
    keywords: ['whiteboard', 'canvas', 'draw', 'baiban', 'tldraw'],
    icon: Palette,
    action: (editor, range) => {
      beginBlockInsert(editor, range);
      const chain = editor.chain().focus();
      chain.insertContent({
        type: 'whiteboard',
      }).run();
    },
  },
  ...[2, 3, 4].map((count): SlashItem => ({
    id: count === 2 ? 'columns' : `columns${count}`,
    title: `${count} 栏并排布局`,
    description: `在同一行并排显示 ${count} 列区块`,
    keywords: ['column', 'columns', 'fenlan', '分栏', '分列', 'bingpai', 'grid', String(count), `${count}lan`, `${count} columns`],
    icon: Layout,
    action: (editor, range) => {
      // Inside a column the row grows instead of nesting a second row.
      const tr = editor.state.tr;
      if (range) tr.delete(range.from, range.to);
      if (addColumnsInRow(tr, count - 1)) { editor.view.dispatch(tr.scrollIntoView()); editor.commands.focus(); return; }
      beginBlockInsert(editor, range);
      const chain = editor.chain().focus();
      chain.insertContent({
        type: 'columnList',
        attrs: { columns: count },
        content: Array.from({ length: count }, () => ({ type: 'column', content: [{ type: 'paragraph' }] })),
      }).run();
    },
  })),
  {
    id: "embed",
    title: 'Figma / 网页嵌入 (Embed)',
    description: '嵌入 Figma 原型、Loom 视频或外部链接',
    keywords: ['figma', 'embed', 'video', 'link', 'qianru'],
    icon: Layout,
    action: (editor, range) => {
      beginBlockInsert(editor, range);
      const chain = editor.chain().focus();
      chain.insertContent({
        type: 'embed',
        attrs: { src: '', type: 'bookmark' },
      }).run();
    },
  },
  {
    id: "h1",
    title: '一级标题 (H1)',
    description: '高层级大标题',
    keywords: ['h1', 'heading1', 'biaoti1', '1'],
    icon: Heading1,
    action: (editor, range) => {
      const pos = getLinePosFromSelection(editor);
      if (pos !== null) convertBlock(editor, pos, 'heading1', range);
    },
  },
  {
    id: "h2",
    title: '二级标题 (H2)',
    description: '中层级小节标题',
    keywords: ['h2', 'heading2', 'biaoti2', '2'],
    icon: Heading2,
    action: (editor, range) => {
      const pos = getLinePosFromSelection(editor);
      if (pos !== null) convertBlock(editor, pos, 'heading2', range);
    },
  },
  {
    id: "h3",
    title: '三级标题 (H3)',
    description: '低层级子标题',
    keywords: ['h3', 'heading3', 'biaoti3', '3'],
    icon: Heading3,
    action: (editor, range) => {
      const pos = getLinePosFromSelection(editor);
      if (pos !== null) convertBlock(editor, pos, 'heading3', range);
    },
  },
  {
    id: "codeBlock",
    title: '代码块 (Code Block)',
    description: '保留缩进与格式的代码片段',
    keywords: ['code', 'daima', 'snippet', 'js', 'ts', 'python'],
    icon: Code2,
    action: (editor, range) => {
      const pos = getLinePosFromSelection(editor);
      if (pos !== null) convertBlock(editor, pos, 'codeBlock', range);
    },
  },
  {
    id: "blockquote",
    title: '引用块 (Quote)',
    description: '心得、纪要或重要引用',
    keywords: ['quote', 'yinyong', 'cite'],
    icon: Quote,
    action: (editor, range) => {
      const pos = getLinePosFromSelection(editor);
      if (pos !== null) convertBlock(editor, pos, 'blockquote', range);
    },
  },
  {
    id: "bulletList",
    title: '无序列表 (Bullet List)',
    description: '标准圆点项目列表',
    keywords: ['bullet', 'list', 'wuxu', 'liebiao', 'ul', '-'],
    icon: List,
    action: (editor, range) => {
      const pos = getLinePosFromSelection(editor);
      if (pos !== null) convertBlock(editor, pos, 'bulletList', range);
    },
  },
  {
    id: "orderedList",
    title: '有序列表 (Numbered List)',
    description: '带数字编号的项目列表',
    keywords: ['numbered', 'order', 'youxu', 'liebiao', 'ol', '1.'],
    icon: ListOrdered,
    action: (editor, range) => {
      const pos = getLinePosFromSelection(editor);
      if (pos !== null) convertBlock(editor, pos, 'orderedList', range);
    },
  },
  {
    id: "divider",
    title: '分割线 (Divider)',
    description: '用于区分段落的水平分割线',
    keywords: ['divider', 'hr', 'line', 'fengexian', 'fgx', '分割线', '---'],
    icon: Minus,
    action: (editor, range) => {
      beginBlockInsert(editor, range);
      const chain = editor.chain().focus();
      chain.setHorizontalRule().run();
    },
  },
  {
    id: "paragraph",
    title: '普通文本段落',
    description: '自由键入普通正文',
    keywords: ['text', 'paragraph', 'wenben', 'p'],
    icon: Type,
    action: (editor, range) => {
      const pos = getLinePosFromSelection(editor);
      if (pos !== null) convertBlock(editor, pos, 'paragraph', range);
    },
  },
];

export const LOG_TEMPLATE = ITEMS.find(item => item.id === 'template')!;
const COMMAND_ORDER = ['paragraph', 'h1', 'h2', 'h3', 'taskList', 'bulletList', 'orderedList', 'toggle', 'blockquote', 'codeBlock', 'divider', 'image', 'html', 'table', 'columns', 'columns3', 'columns4', 'mermaid', 'whiteboard', 'embed', 'tip', 'info', 'success', 'blocker', 'template'];
const LABELS: Record<string, [string, string]> = {
  paragraph: ['文本', '从一段普通文字开始'], h1: ['标题 1', '用于页面的主要章节'], h2: ['标题 2', '用于章节内的小节'], h3: ['标题 3', '用于更细一级的内容'],
  taskList: ['待办事项', '跟踪任务，完成后勾选'], bulletList: ['项目列表', '用圆点列出几件事情'], orderedList: ['编号列表', '按顺序记录步骤或要点'],
  blockquote: ['引用', '突出引用或重要观点'], codeBlock: ['代码', '保留缩进和原始格式'], divider: ['分割线', '为内容划分清晰的段落'],
  blocker: ['阻塞事项', '标记风险和需要协调的事项'], columns: ['双栏', '将内容并排成两列'], columns3: ['三栏', '将内容并排成三列'], columns4: ['四栏', '将内容并排成四列'], mermaid: ['流程图', '用 Mermaid 描述流程与结构'],
  whiteboard: ['白板', '画一个草图或解释想法'], embed: ['嵌入链接', '添加 Figma、视频或网页'], template: ['日志模板', 'Done、阻塞事项和 Todo'],
};
export const SLASH_ITEMS = [...ITEMS].sort((a, b) => COMMAND_ORDER.indexOf(a.id) - COMMAND_ORDER.indexOf(b.id)).map(item => ({ ...item, title: LABELS[item.id]?.[0] || item.title, description: LABELS[item.id]?.[1] || item.description }));
const commandGroup = (id: string) => ['template', 'blocker', 'tip', 'info', 'success'].includes(id) ? '工作日志' : ['image', 'html', 'table', 'columns', 'columns3', 'columns4', 'mermaid', 'whiteboard', 'embed'].includes(id) ? '布局与内容' : '基础块';

export const SlashCommandMenu: React.FC<SlashCommandMenuProps> = ({
  editor,
  isOpen,
  onClose,
  position,
  query = '',
  range,
}) => {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuPosition, setMenuPosition] = useState(position);
  useLayoutEffect(() => {
    if (!isOpen || !menuRef.current) return;
    const { height, width } = menuRef.current.getBoundingClientRect();
    setMenuPosition({ x: Math.max(8, Math.min(position.x, window.innerWidth - width - 8)), y: Math.max(8, Math.min(position.y, window.innerHeight - height - 8)) });
  }, [isOpen, position.x, position.y, query]);
  useEffect(() => {
    menuRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  const cleanQuery = query.toLowerCase().trim();
  // Tables and column rows do not nest inside a table cell.
  const inCell = !!editor && (() => {
    const { $from } = editor.state.selection;
    for (let depth = $from.depth; depth > 0; depth--) if (['tableCell', 'tableHeader'].includes($from.node(depth).type.name)) return true;
    return false;
  })();
  const filteredItems = SLASH_ITEMS.filter((item) => {
    if (inCell && (item.id === 'table' || item.id.startsWith('columns'))) return false;
    if (!cleanQuery) return true;
    return (
      item.title.toLowerCase().includes(cleanQuery) ||
      item.description.toLowerCase().includes(cleanQuery) ||
      item.keywords.some((k) => k.toLowerCase().includes(cleanQuery))
    );
  });

  useEffect(() => {
    setSelectedIndex(0);
  }, [cleanQuery, isOpen]);

  // Click outside to dismiss
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    if (isOpen) {
      // Use capture so it detects immediately
      document.addEventListener('mousedown', handleClickOutside, true);
      return () => document.removeEventListener('mousedown', handleClickOutside, true);
    }
  }, [isOpen, onClose]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen || !editor || e.isComposing || editor.view.composing || e.keyCode === 229 || e.ctrlKey || e.metaKey || e.altKey || !editor.view.dom.contains(e.target as Node)) return;
      if (!['ArrowDown', 'ArrowUp', 'Enter', 'Escape'].includes(e.key)) return;
      // Nothing to choose: close the menu and let Enter reach the editor.
      if (e.key === 'Enter' && !filteredItems.length) { onClose(); return; }
      e.stopPropagation();

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % (filteredItems.length || 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((prev) => (prev - 1 + filteredItems.length) % (filteredItems.length || 1));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (filteredItems[selectedIndex]) {
          onClose();
          filteredItems[selectedIndex].action(editor, range);
        }
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };

    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown, true);
      return () => window.removeEventListener('keydown', handleKeyDown, true);
    }
  }, [isOpen, selectedIndex, filteredItems, editor, range, onClose]);

  useEffect(() => {
    if (!editor || !isOpen) return;
    const dom = editor.view.dom;
    dom.setAttribute('aria-controls', 'slash-command-list');
    dom.setAttribute('aria-haspopup', 'listbox');
    const item = filteredItems[selectedIndex];
    if (item) dom.setAttribute('aria-activedescendant', 'slash-option-' + item.id);
    else dom.removeAttribute('aria-activedescendant');
    return () => { dom.removeAttribute('aria-controls'); dom.removeAttribute('aria-haspopup'); dom.removeAttribute('aria-activedescendant'); };
  }, [editor, isOpen, selectedIndex, cleanQuery]);

  if (!isOpen) return null;

  return (
    <div ref={menuRef} id="slash-command-list" role="listbox" aria-label="选择块类型"
      style={{ top: menuPosition.y, left: menuPosition.x }} className="slash-menu popover-panel fixed z-50">
      {cleanQuery && <div className="slash-group">搜索「{query}」</div>}
      {filteredItems.length === 0 ? <div className="p-5 text-sm text-[var(--muted-foreground)]">没有匹配的块。试试「标题」或「todo」。</div> : filteredItems.map((item, index) => {
        const Icon = item.icon;
        const group = commandGroup(item.id);
        const showGroup = !cleanQuery && (index === 0 || commandGroup(filteredItems[index - 1].id) !== group);
        return <React.Fragment key={item.id}>
          {showGroup && <div className="slash-group" role="presentation">{group}</div>}
          <button id={'slash-option-' + item.id} type="button" role="option" aria-selected={index === selectedIndex}
            onMouseDown={event => event.preventDefault()}
            onClick={() => { onClose(); if (editor) item.action(editor, range); }}
            onMouseEnter={() => setSelectedIndex(index)}
            className={`slash-option ${index === selectedIndex ? 'is-selected' : ''}`}>
            <span className="slash-option-icon"><Icon size={18} strokeWidth={1.6} /></span>
            <span className="flex-1 min-w-0"><span className="slash-option-title block">{item.title}</span><span className="slash-option-description block">{item.description}</span></span>
          </button>
        </React.Fragment>;
      })}
      <div className="slash-footer" role="presentation"><kbd>↑↓</kbd>选择<kbd>Enter</kbd>插入<span className="ml-auto"><kbd>Esc</kbd>关闭</span></div>
    </div>
  );
};
