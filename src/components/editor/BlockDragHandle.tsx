'use client';

import React, { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { selectBlockAt } from './extensions/BlockSelection';
import { findBlockAtPoint, blockHandleAnchor } from './utils/block-dom';
import { startBlockDrag, getDraggedBlockPos, endBlockDrag } from './utils/block-drag';
import { BLOCK_TYPES, canConvertBlock, convertBlock, type BlockType } from './utils/block-conversion';
import { Editor } from '@tiptap/react';
import {
  GripVertical,
  ArrowUp,
  ArrowDown,
  Copy,
  Trash2,
  Plus,
  Columns,
  Rows,
} from 'lucide-react';
import {
  moveBlockAtPos,
  duplicateBlockAtPos,
  deleteBlockAtPos,
  insertParagraphNear,
  turnBlockIntoColumns,
  resolveDomBlockPos,
  computeBlockDropTarget,
  moveBlockToDropTarget,
  type BlockDropTarget,
  getEnclosingColumnList,
  unwrapColumnList,
  BLOCK_DRAG_MIME,
  getBlockPosFromSelection,
} from './utils/block-movement';

interface BlockDragHandleProps {
  editor: Editor | null;
  editorContainerRef: React.RefObject<HTMLDivElement | null>;
  onTriggerSlash?: (pos: { x: number; y: number }) => void;
}

export const BlockDragHandle: React.FC<BlockDragHandleProps> = ({
  editor,
  editorContainerRef,
}) => {
  const [handleTop, setHandleTop] = useState<number | null>(null);
  const [handleLeft, setHandleLeft] = useState<number>(8);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [activeDomNode, setActiveDomNode] = useState<HTMLElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  const menuRef = useRef<HTMLDivElement>(null);
  const [menuPosition, setMenuPosition] = useState({ left: 8, top: 8 });
  const handleRef = useRef<HTMLDivElement>(null);
  const hideTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // --- Block drag & drop state (Notion-style) ---
  const dragSourceRef = useRef<{ pos: number; dom: HTMLElement } | null>(null);
  const [dropIndicator, setDropIndicator] = useState<{
    top: number;
    left: number;
    width: number;
    height: number;
    isVertical: boolean;
    zone: BlockDropTarget['zone'];
    label: string;
    highlight: { top: number; left: number; width: number; height: number };
  } | null>(null);

  // Resolve the block position of the currently hovered DOM node.
  // Handles every block kind uniformly (text blocks, atoms like mermaid,
  // nested blocks and the title of a toggle/callout).
  const getActiveBlockPos = (): number | null => {
    if (!activeDomNode || !editor?.view) return null;
    return resolveDomBlockPos(editor.view, activeDomNode);
  };

  // Hover, caret anchoring and drag targets all address the same logical block.
  useEffect(() => {
    const container = editorContainerRef.current;
    if (!container || !editor) return;
    const clearHide = () => {
      if (hideTimeoutRef.current) clearTimeout(hideTimeoutRef.current);
      hideTimeoutRef.current = null;
    };
    const hide = () => {
      if (!hideTimeoutRef.current) hideTimeoutRef.current = setTimeout(() => {
        setActiveDomNode(null); setHandleTop(null); hideTimeoutRef.current = null;
      }, 180);
    };
    const position = (dom: HTMLElement) => {
      const bounds = container.getBoundingClientRect();
      const anchor = blockHandleAnchor(dom);
      setActiveDomNode(dom);
      setHandleTop(anchor.top - bounds.top);
      setHandleLeft(Math.max(0, anchor.left - bounds.left));
    };
    const handleMouseMove = (event: MouseEvent) => {
      if (isMenuOpen || isDragging) return;
      if ((event.target as Element).closest?.('[data-editor-control]')) { hide(); return; }
      if (handleRef.current?.contains(event.target as Node)) { clearHide(); return; }
      const hit = findBlockAtPoint(editor.view, event.clientX, event.clientY);
      if (!hit) { hide(); return; }
      clearHide();
      position(hit.dom);
    };
    const handleMouseLeave = () => {
      if (isMenuOpen || isDragging) return;
      hide();
    };
    const reposition = () => {
      if (!isDragging && activeDomNode?.isConnected) position(activeDomNode);
    };
    container.addEventListener('mousemove', handleMouseMove);
    container.addEventListener('mouseleave', handleMouseLeave);
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    editor.on('update', reposition);
    return () => {
      container.removeEventListener('mousemove', handleMouseMove);
      container.removeEventListener('mouseleave', handleMouseLeave);
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
      editor.off('update', reposition);
      clearHide();
    };
  }, [editor, editorContainerRef, isMenuOpen, isDragging, activeDomNode]);

  // Capture drops on the complete body (including each column's gutter).
  // The same computed target supplies both the guide and the committed move.
  useEffect(() => {
    const container = editorContainerRef.current;
    if (!container || !editor) return;
    let lastPoint: { x: number; y: number } | null = null;
    const inside = (x: number, y: number) => {
      const rect = container.getBoundingClientRect();
      return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
    };
    const targetAt = (x: number, y: number) => {
      const sourcePos = getDraggedBlockPos(editor.view);
      return sourcePos === null || !inside(x, y) ? null : computeBlockDropTarget(editor.view, x, y, { sourcePos });
    };
    const showTarget = (target: BlockDropTarget | null) => {
      if (!target) { setDropIndicator(null); return; }
      const bounds = container.getBoundingClientRect();
      const highlight = target.highlight ?? target.rect;
      const indicator = {
        ...target.indicator,
        top: target.indicator.top - bounds.top,
        left: target.indicator.left - bounds.left,
        zone: target.zone,
        label: target.label ?? '移到这里',
        highlight: { ...highlight, top: highlight.top - bounds.top, left: highlight.left - bounds.left },
      };
      setDropIndicator(prev => prev && JSON.stringify(prev) === JSON.stringify(indicator) ? prev : indicator);
    };
    const handleDragOver = (event: DragEvent) => {
      if (!dragSourceRef.current) return;
      lastPoint = { x: event.clientX, y: event.clientY };
      const target = targetAt(event.clientX, event.clientY);
      showTarget(target);
      if (inside(event.clientX, event.clientY)) event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = target ? 'move' : 'none';
    };
    const refreshTarget = () => {
      if (lastPoint) showTarget(targetAt(lastPoint.x, lastPoint.y));
    };
    const finishDrag = () => {
      endBlockDrag(editor.view);
      document.querySelectorAll('.feedmob-drag-source-active').forEach(el => el.classList.remove('feedmob-drag-source-active'));
      dragSourceRef.current = null;
      lastPoint = null;
      setIsDragging(false); setDropIndicator(null);
      setActiveDomNode(null); setHandleTop(null);
    };
    const handleContainerDrop = (event: DragEvent) => {
      if (!dragSourceRef.current) return;
      event.preventDefault();
      event.stopPropagation();
      const sourcePos = getDraggedBlockPos(editor.view);
      const target = targetAt(event.clientX, event.clientY);
      if (sourcePos !== null && target) moveBlockToDropTarget(editor, sourcePos, target);
      finishDrag();
      // Native drag-and-drop leaves focus on the handle; return it to the
      // document so Cmd/Ctrl+Z undoes the drop immediately.
      editor.view.focus();
    };
    const handleDragLeave = (event: DragEvent) => {
      // Child-to-child transitions often have a null relatedTarget during
      // native dragging. Coordinates prevent a guide flicker on every block.
      if (dragSourceRef.current && !inside(event.clientX, event.clientY)) setDropIndicator(null);
    };
    container.addEventListener('drop', handleContainerDrop, true);
    window.addEventListener('dragover', handleDragOver, { passive: false });
    window.addEventListener('dragleave', handleDragLeave);
    window.addEventListener('drop', finishDrag);
    window.addEventListener('dragend', finishDrag);
    window.addEventListener('scroll', refreshTarget, true);
    window.addEventListener('resize', refreshTarget);
    return () => {
      container.removeEventListener('drop', handleContainerDrop, true);
      window.removeEventListener('dragover', handleDragOver);
      window.removeEventListener('dragleave', handleDragLeave);
      window.removeEventListener('drop', finishDrag);
      window.removeEventListener('dragend', finishDrag);
      window.removeEventListener('scroll', refreshTarget, true);
      window.removeEventListener('resize', refreshTarget);
      endBlockDrag(editor.view);
    };
  }, [editor, editorContainerRef]);

  // Click outside to close menu
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        menuRef.current &&
        !menuRef.current.contains(e.target as Node) &&
        handleRef.current &&
        !handleRef.current.contains(e.target as Node)
      ) {
        setIsMenuOpen(false);
      }
    };

    if (isMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isMenuOpen]);

  // Also anchor the handle to the caret for keyboard and touch editing.
  useEffect(() => {
    if (!editor) return;
    const anchorSelection = () => {
      const pos = getBlockPosFromSelection(editor);
      const dom = pos === null ? null : editor.view.nodeDOM(pos);
      const container = editorContainerRef.current;
      if (!(dom instanceof HTMLElement) || !container) return;
      const bounds = container.getBoundingClientRect(), anchor = blockHandleAnchor(dom);
      setActiveDomNode(dom);
      setHandleTop(anchor.top - bounds.top);
      setHandleLeft(Math.max(0, anchor.left - bounds.left));
    };
    const sync = () => { if (!isMenuOpen && !isDragging && editor.isFocused) anchorSelection(); };
    const openMenu = () => {
      anchorSelection();
      const pos = getBlockPosFromSelection(editor);
      if (pos !== null) selectBlockAt(editor, pos);
      setIsMenuOpen(true);
    };
    const shortcut = (event: KeyboardEvent) => {
      if (event.isComposing || event.keyCode === 229 || !editor.view.dom.contains(event.target as Node)) return;
      if ((event.ctrlKey || event.metaKey) && event.key === '/') {
        event.preventDefault();
        sync();
        const pos = getBlockPosFromSelection(editor);
        if (pos !== null) selectBlockAt(editor, pos);
        setIsMenuOpen(open => !open);
      }
    };
    editor.on('selectionUpdate', sync);
    editor.on('focus', sync);
    editor.view.dom.addEventListener('keydown', shortcut);
    editor.view.dom.addEventListener('feedmob:open-block-menu', openMenu);
    return () => { editor.off('selectionUpdate', sync); editor.off('focus', sync); editor.view.dom.removeEventListener('keydown', shortcut); editor.view.dom.removeEventListener('feedmob:open-block-menu', openMenu); };
  }, [editor, editorContainerRef, isMenuOpen, isDragging]);

  useLayoutEffect(() => {
    if (!isMenuOpen) return;
    const position = () => {
      const anchor = handleRef.current?.getBoundingClientRect();
      const menu = menuRef.current?.getBoundingClientRect();
      if (!anchor || !menu) return;
      setMenuPosition({ left: Math.max(8, Math.min(anchor.left, window.innerWidth - menu.width - 8)), top: Math.max(8, Math.min(anchor.bottom + 6, window.innerHeight - menu.height - 8)) });
    };
    position();
    menuRef.current?.querySelector<HTMLElement>('select, button')?.focus();
    window.addEventListener('resize', position);
    window.addEventListener('scroll', position, true);
    return () => { window.removeEventListener('resize', position); window.removeEventListener('scroll', position, true); };
  }, [isMenuOpen, handleTop, handleLeft]);

  if (!editor) return null;

  const focusBlock = () => {
    const pos = getActiveBlockPos();
    if (pos !== null) selectBlockAt(editor, pos);
  };

  const handlePlusClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    const pos = getActiveBlockPos();
    if (pos === null) return;
    if (insertParagraphNear(editor, pos, e.altKey ? 'above' : 'below')) editor.commands.insertContent('/');
  };

  const handleTurnIntoColumns = () => {
    const pos = getActiveBlockPos();
    if (pos === null) return;
    turnBlockIntoColumns(editor, pos);
    setIsMenuOpen(false);
  };

  const handleMoveUp = () => {
    const pos = getActiveBlockPos();
    if (pos !== null) moveBlockAtPos(editor, pos, 'up');
    setIsMenuOpen(false);
  };

  const handleMoveDown = () => {
    const pos = getActiveBlockPos();
    if (pos !== null) moveBlockAtPos(editor, pos, 'down');
    setIsMenuOpen(false);
  };

  const handleDuplicate = () => {
    const pos = getActiveBlockPos();
    if (pos !== null) duplicateBlockAtPos(editor, pos);
    setIsMenuOpen(false);
    editor.commands.focus();
  };

  const handleDelete = () => {
    const pos = getActiveBlockPos();
    if (pos !== null) deleteBlockAtPos(editor, pos);
    setIsMenuOpen(false);
    setActiveDomNode(null);
    setHandleTop(null);
    editor.commands.focus();
  };

  return (
    <>
      {/* 1. Floating Action Handle (only when handleTop !== null) */}
      {handleTop !== null && (
        <div
          ref={handleRef}
          data-block-handle="true"
          data-block-pos={getActiveBlockPos() ?? undefined}
          style={{
            top: `${handleTop}px`,
            left: `${handleLeft}px`,
            opacity: isDragging ? 0 : 1,
          }}
          className="absolute z-20 flex items-center gap-0.5 select-none transition-opacity duration-150"
        >
          {/* 1. Notion Plus Button (+) */}
          <div className="relative">
            <button
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              aria-label="添加块"
              onClick={handlePlusClick}
              className="block-handle-button"
              title=""
            >
              <Plus className="w-3.5 h-3.5" />
            </button>

          </div>

          {/* 2. Notion 6-Dot Grip Handle (⠿) */}
          <div className="relative">
            <button
              type="button"
              aria-label="块操作菜单"
              aria-expanded={isMenuOpen}
              draggable
              onDragStart={(e) => {
                const blockPos = getActiveBlockPos();
                if (blockPos === null || !activeDomNode) {
                  e.preventDefault();
                  return;
                }
                const sourceDom = activeDomNode;
                dragSourceRef.current = { pos: blockPos, dom: sourceDom };
                startBlockDrag(editor.view, blockPos);
                setIsMenuOpen(false);
                setIsDragging(true);

                try {
                  e.dataTransfer.setData(BLOCK_DRAG_MIME, String(blockPos));
                } catch {}
                e.dataTransfer.effectAllowed = 'move';

                // 1. Create a pristine Notion-style floating drag snapshot
                const isDark = document.documentElement.classList.contains('dark');
                const dragGhost = document.createElement('div');
                dragGhost.className = 'feedmob-drag-ghost-preview';
                dragGhost.style.position = 'fixed';
                dragGhost.style.top = '-9999px';
                dragGhost.style.left = '-9999px';
                dragGhost.style.width = `${Math.min(Math.max(sourceDom.offsetWidth, 160), 380)}px`;
                dragGhost.style.maxWidth = '380px';
                dragGhost.style.padding = '8px 14px';
                dragGhost.style.borderRadius = '10px';
                dragGhost.style.backgroundColor = isDark ? '#1e293b' : '#ffffff';
                dragGhost.style.color = isDark ? '#f1f5f9' : '#0f172a';
                dragGhost.style.boxShadow = '0 12px 32px rgba(0,0,0,0.18), 0 2px 6px rgba(0,0,0,0.08)';
                dragGhost.style.border = isDark ? '1px solid #334155' : '1px solid #e2e8f0';
                dragGhost.style.opacity = '0.92';
                dragGhost.style.pointerEvents = 'none';
                dragGhost.style.zIndex = '999999';
                dragGhost.style.overflow = 'hidden';
                dragGhost.style.textOverflow = 'ellipsis';
                dragGhost.style.whiteSpace = 'nowrap';
                dragGhost.style.fontSize = '14px';
                dragGhost.style.lineHeight = '1.5';
                dragGhost.style.fontFamily = 'inherit';

                const textContent = sourceDom.innerText?.trim() || sourceDom.textContent?.trim() || 'Block 内容';
                dragGhost.innerText = textContent;

                document.body.appendChild(dragGhost);

                try {
                  e.dataTransfer.setDragImage(dragGhost, 16, 16);
                } catch {}

                setTimeout(() => {
                  if (dragGhost.parentNode) {
                    dragGhost.parentNode.removeChild(dragGhost);
                  }
                }, 0);

                // 2. Notion-style dimming and grayscale effect on source block in document
                requestAnimationFrame(() => {
                  if (dragSourceRef.current?.dom === sourceDom && getDraggedBlockPos(editor.view) !== null) {
                    sourceDom.classList.add('feedmob-drag-source-active');
                  }
                });
              }}
              onDragEnd={() => {
                endBlockDrag(editor.view);
                const source = dragSourceRef.current;
                if (source && source.dom) {
                  source.dom.classList.remove('feedmob-drag-source-active');
                  source.dom.style.opacity = '';
                  source.dom.style.filter = '';
                  source.dom.style.transition = '';
                }
                document.querySelectorAll('.feedmob-drag-source-active').forEach((el) => {
                  el.classList.remove('feedmob-drag-source-active');
                });
                dragSourceRef.current = null;
                setIsDragging(false);
                setDropIndicator(null);
                // Doc may have changed on drop — drop the stale hover block
                // and let the next mousemove re-anchor the handle.
                setActiveDomNode(null);
                setHandleTop(null);
              }}
              onClick={(e) => {
                e.stopPropagation();
                focusBlock();
                setIsMenuOpen(!isMenuOpen);
              }}
              className="block-handle-button cursor-grab active:cursor-grabbing"
              title=""
            >
              <GripVertical className="w-3.5 h-3.5" />
            </button>

          </div>

          {isMenuOpen && createPortal(
            <div ref={menuRef} role="group" aria-label="块操作" className="block-action-menu popover-panel fixed z-[60]"
              style={menuPosition}
              onKeyDown={event => {
                if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setIsMenuOpen(false); editor.commands.focus(); }
                if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && !(event.target instanceof HTMLSelectElement)) {
                  const controls = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('button, select') || []);
                  const current = controls.indexOf(document.activeElement as HTMLElement);
                  const next = (current + (event.key === 'ArrowDown' ? 1 : -1) + controls.length) % controls.length;
                  event.preventDefault(); controls[next]?.focus();
                }
              }}>
              <div className="slash-group">块操作</div>
              {getActiveBlockPos() !== null && canConvertBlock(editor, getActiveBlockPos()!) && <label className="flex items-center gap-2 px-2 py-2 text-xs">
                <span className="shrink-0 text-[var(--muted-foreground)]">转换为</span>
                <select aria-label="转换块类型" value="" className="w-full text-sm" onChange={event => { const pos = getActiveBlockPos(); if (pos !== null) convertBlock(editor, pos, event.target.value as BlockType); setIsMenuOpen(false); }}>
                  <option value="" disabled>选择类型</option>{BLOCK_TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>}
              <div className="popover-divider" />
              <button type="button" onClick={handleMoveUp} className="popover-row"><ArrowUp size={15} /><span>上移</span><kbd className="ml-auto">Alt ↑</kbd></button>
              <button type="button" onClick={handleMoveDown} className="popover-row"><ArrowDown size={15} /><span>下移</span><kbd className="ml-auto">Alt ↓</kbd></button>
              <button type="button" onClick={handleDuplicate} className="popover-row"><Copy size={15} /><span>复制块</span><kbd className="ml-auto">⌘ / Ctrl D</kbd></button>
              <div className="popover-divider" />
              <button type="button" onClick={handleTurnIntoColumns} className="popover-row"><Columns size={15} />转换为双栏</button>
              {getEnclosingColumnList(editor, getActiveBlockPos() ?? undefined) && <button type="button" className="popover-row" onClick={() => { const pos = getActiveBlockPos(); if (pos !== null) unwrapColumnList(editor, pos); setIsMenuOpen(false); }}><Rows size={15} />解散分栏</button>}
              <div className="popover-divider" />
              <button type="button" onClick={handleDelete} className="popover-row text-red-600"><Trash2 size={15} />删除块</button>
            </div>, document.body
          )}

        </div>
      )}

      {dropIndicator && <>
        <div className="block-drop-highlight" style={dropIndicator.highlight} />
        <div
          data-testid="block-drop-indicator"
          data-orientation={dropIndicator.isVertical ? 'vertical' : 'horizontal'}
          data-zone={dropIndicator.zone}
          className="absolute z-30 pointer-events-none rounded-full bg-[var(--accent)]"
          style={{ top: dropIndicator.top, left: dropIndicator.left, width: dropIndicator.width, height: dropIndicator.height }}
        />
        <div data-testid="block-drop-label" className="block-drop-label"
          style={{
            top: dropIndicator.highlight.top - 30,
            left: Math.max(0, Math.min(dropIndicator.left + 8, (editorContainerRef.current?.clientWidth ?? 500) - 200)),
          }}>{dropIndicator.label}</div>
      </>}

    </>
  );
};
