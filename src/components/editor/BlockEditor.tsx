'use client';

import React, { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import { SelectionToolbar } from './SelectionToolbar';
import { ToggleNode } from './extensions/ToggleNode';
import { BlockSelection, handleBlockSelectionKeyDown } from './extensions/BlockSelection';
import { EditorLinkPopover } from './EditorLinkPopover';
import { BlockSelectionToolbar } from './BlockSelectionToolbar';
import StarterKit from '@tiptap/starter-kit';
import TaskList from '@tiptap/extension-task-list';
import { TaskItem } from './extensions/TaskItem';
import Placeholder from '@tiptap/extension-placeholder';
import Underline from '@tiptap/extension-underline';
import Highlight from '@tiptap/extension-highlight';
import Link from '@tiptap/extension-link';

import { CalloutNode } from './extensions/CalloutNode';
import { MermaidNode } from './extensions/MermaidNode';
import { WhiteboardNode } from './extensions/WhiteboardNode';
import { EmbedNode } from './extensions/EmbedNode';
import { ImageNode } from './extensions/ImageNode';
import { HtmlNode } from './extensions/HtmlNode';
import { TableExtensions } from './extensions/TableExtensions';
import { TableToolbar } from './TableToolbar';
import { hasPendingImages } from './utils/image';
import { ColumnList, Column } from './extensions/ColumnsExtension';
import { SlashCommandMenu, LOG_TEMPLATE } from './SlashCommandMenu';
import { BlockDragHandle } from './BlockDragHandle';
import { moveBlock, duplicateBlock } from './utils/block-movement';
import { SlashCommand } from './extensions/SlashCommand';
import { EditorClipboard } from './extensions/EditorClipboard';
import { serializeBlocks } from './utils/clipboard';
import { getDraggedBlockPos } from './utils/block-drag';
import { useSlashCommand } from './useSlashCommand';
import { parseDocument, snapshotKey, type DocumentSnapshot } from './utils/document';
import { useCurrentUser } from '@/lib/user-context';
import { BEFORE_APP_REFRESH, type AppRefreshDetail } from '@/lib/app-update';
import {
  Bold,
  Italic,
  Underline as UnderlineIcon,
  Strikethrough,
  Highlighter,
  Check,
  Save,
  Plus,
  X,
  Keyboard,
  MoreHorizontal,
  Link2,
  Undo2,
  Redo2,
  FileText,
  Maximize2,
  Minimize2,
} from 'lucide-react';


interface BlockEditorProps {
  initialContent?: unknown;
  initialTitle?: string;
  initialTags?: string[];
  initialMood?: string;
  date: string;
  documentId: string;
  onSave: (data: DocumentSnapshot & { contentText: string }) => Promise<void>;
  isSaving?: boolean;
}

const MOODS = ['🚀', '⚡', '🔥', '🧘', '☕', '😴', '💪', '🎉'];

export const BlockEditor: React.FC<BlockEditorProps> = ({
  initialContent,
  initialTitle = '',
  initialTags = [],
  initialMood = '🚀',
  date,
  documentId,
  onSave,
  isSaving = false,
}) => {
  const draftKey = 'feedmob-draft:' + documentId;
  const [initialSnapshot] = useState<DocumentSnapshot>(() => {
    const server = { title: initialTitle, contentJson: parseDocument(initialContent), tagNames: initialTags, mood: initialMood };
    try {
      const draft = JSON.parse(localStorage.getItem(draftKey) || 'null');
      if (draft && typeof draft.title === 'string' && typeof draft.mood === 'string' && Array.isArray(draft.tagNames) && draft.tagNames.every((tag: unknown) => typeof tag === 'string')) {
        return { ...draft, contentJson: parseDocument(draft.contentJson) };
      }
    } catch { /* Storage may be unavailable; editing still works. */ }
    return server;
  });
  const [title, setTitle] = useState(initialSnapshot.title);
  const [tags, setTags] = useState<string[]>(initialSnapshot.tagNames);
  const [newTagInput, setNewTagInput] = useState('');
  const [isAddingTag, setIsAddingTag] = useState(false);
  const [mood, setMood] = useState(initialSnapshot.mood);
  const [isMoodPickerOpen, setIsMoodPickerOpen] = useState(false);
  const [lastSavedTime, setLastSavedTime] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const optionsRef = useRef<HTMLDivElement>(null);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [wordCount, setWordCount] = useState(0);

  const savingRef = useRef(false);
  const [savePending, setSavePending] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [draftStored, setDraftStored] = useState(true);
  const savedRef = useRef(snapshotKey({ title: initialTitle, contentJson: parseDocument(initialContent), tagNames: initialTags, mood: initialMood }));

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        // A second native cursor contradicts the column/group drop preview.
        dropcursor: false,
        heading: {
          levels: [1, 2, 3],
        },
      }),
      TaskList,
      TaskItem.configure({
        nested: true,
      }),
      Underline,
      Highlight.configure({
        multicolor: true,
      }),
      Link.configure({
        openOnClick: false,
      }),
      Placeholder.configure({
        includeChildren: true,
        showOnlyCurrent: false,
        placeholder: ({ node, pos, editor }) => {
          const $pos = editor.state.doc.resolve(pos);
          if (['tableCell', 'tableHeader'].includes($pos.parent.type.name)) return '';
          if ($pos.parent.type.name === 'toggle' && $pos.index() === 0) return '折叠标题';
          if (node.type.name === 'heading') {
            return '标题...';
          }
          return '输入文字，或按 / 插入块';
        },
      }),
      CalloutNode,
      MermaidNode,
      WhiteboardNode,
      EmbedNode,
      ImageNode,
      HtmlNode,
      ...TableExtensions,
      ColumnList,
      Column,
      SlashCommand,
      EditorClipboard,
      ToggleNode,
      BlockSelection,
    ],
    content: initialSnapshot.contentJson,
    editorProps: {
      attributes: { role: 'textbox', 'aria-label': '日志正文', 'aria-multiline': 'true' },
      handleDOMEvents: {
        // Let the native IME commit its candidate without passing Enter through
        // ProseMirror keymaps. Returning here does not prevent the DOM default.
        keydown: (view, event) => event.isComposing || view.composing || event.keyCode === 229,
        dragover: (view, event) => {
          const isBlock = getDraggedBlockPos(view) !== null;
          if (isBlock) {
            event.preventDefault();
            if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
            return true;
          }
          return false;
        },
      },
      // Custom block drops are handled in the container's capture phase so
      // its gutters and the editable DOM share the same preview/commit path.
      handleDrop: view => getDraggedBlockPos(view) !== null,
      handleClick: (view, pos, event) => {
        const dom = event.target as HTMLElement;
        if (dom === view.dom && event.clientY >= (view.dom.lastElementChild?.getBoundingClientRect().bottom ?? 0)) {
          const { doc } = view.state;
          const lastChild = doc.lastChild;
          const isLastEmpty =
            lastChild &&
            lastChild.type.name === 'paragraph' &&
            lastChild.content.size === 0;

          if (!isLastEmpty && editor) {
            editor
              .chain()
              .focus()
              .insertContentAt(doc.content.size, { type: 'paragraph' })
              .setTextSelection(doc.content.size + 1)
              .run();
            return true;
          }
        }
        return false;
      },
      handleKeyDown: (view, event) => {
        if (event.isComposing || view.composing || event.keyCode === 229) return false;
        if (editor && handleBlockSelectionKeyDown(editor, event)) return true;
        // Handle Alt + ArrowUp to move block up
        if (event.altKey && event.key === 'ArrowUp') {
          event.preventDefault();
          if (editor) moveBlock(editor, 'up');
          return true;
        }

        // Handle Alt + ArrowDown to move block down
        if (event.altKey && event.key === 'ArrowDown') {
          event.preventDefault();
          if (editor) moveBlock(editor, 'down');
          return true;
        }

        // Handle Ctrl + D / Cmd + D to duplicate block
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'd') {
          event.preventDefault();
          if (editor) duplicateBlock(editor);
          return true;
        }

        // Handle Ctrl+Enter or Cmd+Enter to save immediately
        if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
          event.preventDefault();
          handleManualSave();
          return true;
        }

        return false;
      },

    },
  });

  const slash = useSlashCommand(editor);
  const currentSnapshotRef = useRef(initialSnapshot);
  currentSnapshotRef.current = { title, contentJson: editor?.getJSON() ?? initialSnapshot.contentJson, tagNames: tags, mood };

  // A mounted editor owns one document. Save responses are acknowledgements,
  // never new editor input. Persist local drafts across date/user navigation.
  useEffect(() => {
    if (!editor) return;
    const persist = () => {
      const snapshot = { ...currentSnapshotRef.current, contentJson: editor.getJSON() };
      currentSnapshotRef.current = snapshot;
      const dirty = snapshotKey(snapshot) !== savedRef.current;
      setIsDirty(dirty);
      setWordCount(editor.getText().replace(/\s/g, "").length);
      try {
        if (dirty) localStorage.setItem(draftKey, JSON.stringify(snapshot));
        else localStorage.removeItem(draftKey);
        setDraftStored(true);
      } catch { setDraftStored(false); setSaveError('本地草稿无法保存，请及时提交日志。'); return false; }
      return true;
    };
    const beforeRefresh = (event: Event) => {
      const refreshEvent = event as CustomEvent<AppRefreshDetail>;
      let reason: string | undefined;
      if (savingRef.current) reason = '日志正在提交，请完成后再刷新。';
      else if (hasPendingImages(editor)) reason = '图片正在处理，请完成后再刷新。';
      else if (editor.view.composing) reason = '请先完成当前文字输入，再刷新更新。';
      else if (!persist()) reason = '草稿未能保存，请先提交日志，再刷新更新。';
      if (reason) { refreshEvent.detail.reason = reason; refreshEvent.preventDefault(); }
    };
    persist();
    editor.on('update', persist);
    window.addEventListener(BEFORE_APP_REFRESH, beforeRefresh);
    return () => { editor.off('update', persist); window.removeEventListener(BEFORE_APP_REFRESH, beforeRefresh); };
  }, [editor, title, tags, mood, draftKey]);

  const handleManualSave = async () => {
    if (!editor || isSaving || savingRef.current) return;
    if (hasPendingImages(editor)) { setSaveError('图片正在处理，请完成后再提交。'); return; }
    savingRef.current = true;
    setSavePending(true);
    setSaveError(null);
    const snapshot = { title, contentJson: editor.getJSON(), tagNames: tags, mood };
    try {
      await onSave({ ...snapshot, contentText: serializeBlocks(editor.state.doc.content) });
      savedRef.current = snapshotKey(snapshot);
      const dirty = snapshotKey(currentSnapshotRef.current) !== savedRef.current;
      setIsDirty(dirty);
      if (!dirty) {
        try {
          // An older, unmounted editor must not erase a newer draft of this date.
          const stored = localStorage.getItem(draftKey);
          if (stored === snapshotKey(snapshot)) localStorage.removeItem(draftKey);
        } catch {}
      }
      setLastSavedTime(new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }));
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : '保存失败，请重试。');
    } finally {
      savingRef.current = false;
      setSavePending(false);
    }
  };

  const handleAddTag = () => {
    if (!newTagInput.trim()) return;
    const cleanTag = newTagInput.trim().replace(/^#+/, '').trim();
    if (!cleanTag) return;
    if (!tags.includes(cleanTag)) {
      setTags([...tags, cleanTag]);
    }
    setNewTagInput('');
    setIsAddingTag(false);
  };

  const removeTag = (tagToRemove: string) => {
    setTags(tags.filter((t) => t !== tagToRemove));
  };

  const insertTemplate = () => {
    if (!editor) return;
    LOG_TEMPLATE.action(editor);
  };

  const { isFullWidth, toggleFullWidth } = useCurrentUser();

  useLayoutEffect(() => {
    const resize = () => {
      if (!titleRef.current) return;
      titleRef.current.style.height = '0px';
      titleRef.current.style.height = Math.max(48, titleRef.current.scrollHeight) + 'px';
    };
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, [title, isFullWidth]);

  useEffect(() => {
    if (!optionsOpen) return;
    const dismiss = (event: MouseEvent) => {
      if (!optionsRef.current?.contains(event.target as Node)) setOptionsOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { setOptionsOpen(false); optionsRef.current?.querySelector('button')?.focus(); }
    };
    document.addEventListener('mousedown', dismiss);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('mousedown', dismiss); document.removeEventListener('keydown', escape); };
  }, [optionsOpen]);

  useEffect(() => {
    if (!isMoodPickerOpen) return;
    const dismiss = (event: MouseEvent) => {
      if (!(event.target as Element).closest('[data-mood-picker]')) setIsMoodPickerOpen(false);
    };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setIsMoodPickerOpen(false); };
    document.addEventListener('mousedown', dismiss);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('mousedown', dismiss); document.removeEventListener('keydown', escape); };
  }, [isMoodPickerOpen]);

  const focusEnd = () => {
    if (!editor) return;
    const { doc } = editor.state;
    if (doc.lastChild?.type.name !== 'paragraph' || doc.lastChild.content.size) {
      editor.chain().focus().insertContentAt(doc.content.size, { type: 'paragraph' }).setTextSelection(doc.content.size + 1).run();
    } else editor.commands.focus('end');
  };

  return (
    <div className="document-editor flex-1 flex flex-col min-w-0">
      <div className="document-toolbar">
        <span role="status" className="document-status">
          <span className={`status-dot ${isDirty ? 'is-dirty' : ''}`} />
          {isDirty ? (draftStored ? '本地草稿已保存 · 有未提交修改' : '有未提交修改 · 请及时提交') : (lastSavedTime ? `成功保存于 ${lastSavedTime}` : '准备开始记录')}
        </span>
        <div className="flex items-center gap-1.5 shrink-0">
          <button type="button" onClick={insertTemplate} className="quiet-button template-button"><FileText size={15} />日志模板</button>
          <div ref={optionsRef} className="relative">
            <button type="button" aria-label="页面选项" aria-expanded={optionsOpen} onClick={() => setOptionsOpen(!optionsOpen)} className="icon-button"><MoreHorizontal size={19} /></button>
            {optionsOpen && <div className="page-options popover-panel" role="group" aria-label="页面选项">
              <button type="button" onClick={() => { toggleFullWidth(); setOptionsOpen(false); }} className="popover-row">
                {isFullWidth ? <Minimize2 size={16} /> : <Maximize2 size={16} />}<span>{isFullWidth ? '恢复标准宽度' : '展开为全宽'}</span>
              </button>
              <button type="button" onClick={() => { insertTemplate(); setOptionsOpen(false); }} className="popover-row"><FileText size={16} />插入日志模板</button>
              <button type="button" onClick={() => { setHelpOpen(!helpOpen); setOptionsOpen(false); }} className="popover-row"><Keyboard size={16} />键盘快捷键</button>
              <div className="popover-divider" />
              <button type="button" disabled={!editor?.can().undo()} onClick={() => { editor?.chain().focus().undo().run(); setOptionsOpen(false); }} className="popover-row"><Undo2 size={16} />撤销<span className="ml-auto text-xs">⌘ / Ctrl Z</span></button>
              <button type="button" disabled={!editor?.can().redo()} onClick={() => { editor?.chain().focus().redo().run(); setOptionsOpen(false); }} className="popover-row"><Redo2 size={16} />重做</button>
            </div>}
          </div>
          <button type="button" onClick={handleManualSave} disabled={isSaving || savePending} className="primary-button">
            <Save size={14} /><span>{isSaving || savePending ? '正在保存...' : '提交工作日志'}</span>
          </button>
        </div>
      </div>
      {saveError && <div role="alert" className="save-error">{saveError}<button type="button" disabled={savePending} onClick={handleManualSave}>重试</button></div>}

      <div className={`document-canvas ${isFullWidth ? 'is-full-width' : ''}`}>
        <div className="document-heading">
          <div className="relative inline-block" data-mood-picker>
            <button type="button" aria-label="设置日志图标" aria-expanded={isMoodPickerOpen} onClick={() => setIsMoodPickerOpen(!isMoodPickerOpen)} className="document-icon">{mood}</button>
            {isMoodPickerOpen && <div className="mood-picker popover-panel" role="group" aria-label="选择日志图标">{MOODS.map(m => <button key={m} type="button" aria-label={`选择 ${m}`} className="mood-option" onClick={() => { setMood(m); setIsMoodPickerOpen(false); }}>{m}</button>)}</div>}
          </div>
          <textarea ref={titleRef} rows={1} value={title} onChange={event => setTitle(event.target.value.replace(/\r?\n/g, ' '))}
            onKeyDown={event => {
              if (event.nativeEvent.isComposing) return;
              if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); void handleManualSave(); }
              else if (event.key === 'Enter' || event.key === 'ArrowDown') { event.preventDefault(); editor?.commands.focus('start'); }
            }} aria-label="日志标题" placeholder="未命名日志" className="document-title" />
          <div className="document-properties">
            <span className="property-label">标签</span>
            <div className="flex flex-wrap items-center gap-1.5 min-w-0">
              {tags.map(tag => <span key={tag} className="document-tag">{tag}<button type="button" aria-label={`删除标签 ${tag}`} onClick={() => removeTag(tag)}><X size={12} /></button></span>)}
              {isAddingTag ? <div className="flex items-center gap-1">
                <input aria-label="标签名称" value={newTagInput} onChange={event => setNewTagInput(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) handleAddTag(); if (event.key === 'Escape') { setIsAddingTag(false); setNewTagInput(''); } }} autoFocus placeholder="标签名称" className="tag-input" />
                <button type="button" aria-label="确认添加标签" onClick={handleAddTag} className="icon-button"><Check size={15} /></button>
              </div> : <button type="button" onClick={() => setIsAddingTag(true)} className="property-add"><Plus size={13} />添加标签</button>}
            </div>
          </div>
        </div>

        <div ref={containerRef} className="document-body relative">
          <BlockDragHandle editor={editor} editorContainerRef={containerRef} />
          {editor && <BlockSelectionToolbar editor={editor} />}
          {editor && <SelectionToolbar editor={editor} className="selection-toolbar">
            {[
              { label: '加粗', icon: Bold, mark: 'bold', action: () => editor.chain().focus().toggleBold().run() },
              { label: '斜体', icon: Italic, mark: 'italic', action: () => editor.chain().focus().toggleItalic().run() },
              { label: '下划线', icon: UnderlineIcon, mark: 'underline', action: () => editor.chain().focus().toggleUnderline().run() },
              { label: '删除线', icon: Strikethrough, mark: 'strike', action: () => editor.chain().focus().toggleStrike().run() },
              { label: '高亮', icon: Highlighter, mark: 'highlight', action: () => editor.chain().focus().toggleHighlight().run() },
            ].map(({ label, icon: Icon, mark, action }) => <button type="button" key={mark} aria-label={label} aria-pressed={editor.isActive(mark)} onClick={action} className={editor.isActive(mark) ? 'is-active' : ''}><Icon size={16} /></button>)}
            <span className="toolbar-separator" />
            <button type="button" aria-label="编辑链接" aria-pressed={editor.isActive('link')} onClick={() => setLinkOpen(true)}><Link2 size={16} /></button>
          </SelectionToolbar>}
          {editor && <EditorLinkPopover editor={editor} isOpen={linkOpen} onClose={() => setLinkOpen(false)} />}
          {editor && <TableToolbar editor={editor} />}
          <EditorContent editor={editor} className="editor-content" />
          <SlashCommandMenu editor={editor} isOpen={!!slash.match} onClose={slash.close} position={slash.position} query={slash.match?.query} range={slash.match ? { from: slash.match.from, to: slash.match.to } : undefined} />
          <button type="button" aria-label="在文档末尾添加块" className="document-end" onClick={focusEnd}><Plus size={14} /><span>继续记录，或输入 / 插入块</span></button>
        </div>
      </div>
      <div className="editor-footer">
        <span>{date}<span className="mx-2">·</span>{wordCount} 字</span>
        <div className="flex items-center gap-2"><button type="button" className="quiet-button mobile-block-button" onMouseDown={event => event.preventDefault()} onClick={() => editor?.view.dom.dispatchEvent(new Event('feedmob:open-block-menu'))}>块操作</button><button type="button" className="quiet-button" aria-expanded={helpOpen} onClick={() => setHelpOpen(!helpOpen)}><Keyboard size={15} />快捷键</button></div>
      </div>
      {helpOpen && <div className="keyboard-help" role="region" aria-label="编辑器快捷键">
        <div className="flex items-center justify-between mb-3"><span className="font-medium">让记录跟上思路</span><button type="button" aria-label="关闭快捷键" className="icon-button" onClick={() => setHelpOpen(false)}><X size={16} /></button></div>
        {[
          ['/', '搜索并插入块'], ['Enter / Shift Enter', '新建块 / 块内换行'], ['Esc → Shift ↑/↓', '选择块 / 扩展块选区'], ['⌘ / Ctrl D', '复制所选块'], ['Alt ↑/↓', '上下移动块'], ['⌘ / Ctrl /', '打开块操作菜单'], ['⌘ / Ctrl Enter', '提交工作日志'],
        ].map(([key, text]) => <div key={key} className="flex justify-between gap-4 py-1.5"><span className="text-[var(--muted-foreground)]">{text}</span><kbd>{key}</kbd></div>)}
        <p className="mt-3 text-xs text-[var(--muted-foreground)]">草稿自动保存在此浏览器；提交后写入工作区。拖到块的左右边缘可以分栏。</p>
      </div>}
    </div>
  );
};
