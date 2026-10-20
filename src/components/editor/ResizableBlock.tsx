'use client';

import React, { useEffect, useRef } from 'react';
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react';
import { boundedSize, commitNodeSize, trackResize } from './utils/resize';

export const blockSizeAttributes = {
  blockWidth: {
    default: 100,
    parseHTML: (element: HTMLElement) => boundedSize(element.getAttribute('data-block-width'), 100, 20, 100),
    renderHTML: (attrs: Record<string, unknown>) => ({ 'data-block-width': boundedSize(attrs.blockWidth, 100, 20, 100) }),
  },
  blockHeight: {
    default: null,
    parseHTML: (element: HTMLElement) => element.hasAttribute('data-block-height') ? boundedSize(element.getAttribute('data-block-height'), 280, 120, 1200) : null,
    renderHTML: (attrs: Record<string, unknown>) => attrs.blockHeight == null ? {} : { 'data-block-height': boundedSize(attrs.blockHeight, 280, 120, 1200) },
  },
};

type Props = Pick<NodeViewProps, 'node' | 'editor' | 'getPos'> & { children: React.ReactNode; className: string; allowHeight?: boolean };

export function ResizableBlock({ node, editor, getPos, children, className, allowHeight = true }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const cancel = useRef<(() => void) | undefined>(undefined);
  useEffect(() => () => cancel.current?.(), []);
  const width = boundedSize(node.attrs.blockWidth, 100, 20, 100);
  const height = node.attrs.blockHeight == null ? undefined : boundedSize(node.attrs.blockHeight, 280, 120, 1200);
  const resize = (event: React.PointerEvent<HTMLButtonElement>, direction: 'left' | 'right' | 'corner') => {
    if (event.button !== 0 || !editor.isEditable || !root.current) return;
    cancel.current?.();
    const element = root.current;
    const rect = element.getBoundingClientRect();
    const parentWidth = element.parentElement?.getBoundingClientRect().width || rect.width;
    const body = element.querySelector<HTMLElement>('.resizable-block-body');
    const bodyHeight = body?.getBoundingClientRect().height || height || 280;
    const before = editor.state.doc;
    let nextWidth = width, nextHeight = height, moved = false;
    const oldWidth = element.style.width, oldHeight = element.style.getPropertyValue('--block-height');
    element.classList.add('is-resizing-block');
    cancel.current = trackResize(event.nativeEvent, event.currentTarget, (x, y) => {
      moved ||= Math.abs(x - event.clientX) > 2 || Math.abs(y - event.clientY) > 2;
      if (!moved) return;
      const delta = (x - event.clientX) * (direction === 'left' ? -1 : 1);
      const minWidth = Math.max(parentWidth * 0.2, Math.min(parentWidth, 160));
      nextWidth = Math.round(Math.max(minWidth, Math.min(parentWidth, rect.width + delta)) / parentWidth * 10000) / 100;
      element.style.width = `${nextWidth}%`;
      if (direction === 'corner' && allowHeight) {
        nextHeight = Math.round(Math.max(120, Math.min(1200, bodyHeight + y - event.clientY)));
        element.style.setProperty('--block-height', `${nextHeight}px`);
      }
    }, cancelled => {
      cancel.current = undefined;
      element.classList.remove('is-resizing-block');
      element.style.width = oldWidth;
      if (oldHeight) element.style.setProperty('--block-height', oldHeight); else element.style.removeProperty('--block-height');
      if (!cancelled && moved && editor.state.doc.eq(before)) {
        commitNodeSize(editor, getPos, node.type.name, { blockWidth: nextWidth, blockHeight: nextHeight ?? null });
        // Pointer resizing leaves focus in the document so undo works next.
        if (!editor.isDestroyed) editor.view.focus();
      }
    });
  };
  const keyboard = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home'].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    if (event.key === 'Home') commitNodeSize(editor, getPos, node.type.name, { blockWidth: 100, blockHeight: null });
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') commitNodeSize(editor, getPos, node.type.name, { blockWidth: Math.max(20, Math.min(100, width + (event.key === 'ArrowRight' ? 5 : -5))) });
    else if (allowHeight) commitNodeSize(editor, getPos, node.type.name, { blockHeight: Math.max(120, Math.min(1200, (height ?? root.current?.querySelector('.resizable-block-body')?.getBoundingClientRect().height ?? 280) + (event.key === 'ArrowDown' ? 20 : -20))) });
  };
  return <NodeViewWrapper ref={root} contentEditable={false} className={`resizable-block ${className}`} style={{ width: `${width}%`, '--block-height': height ? `${height}px` : undefined } as React.CSSProperties}>
    {children}
    {editor.isEditable && <>
      <button type="button" data-editor-control className="block-resize-side is-left" aria-label="拖动左侧调整区块宽度" onPointerDown={event => resize(event, 'left')} onKeyDown={keyboard} />
      <button type="button" data-editor-control className="block-resize-side is-right" aria-label="拖动右侧调整区块宽度" onPointerDown={event => resize(event, 'right')} onKeyDown={keyboard} />
      <button type="button" data-editor-control className="block-resize-corner" aria-label={allowHeight ? '调整区块宽高' : '调整区块宽度'} title="拖动调整大小；方向键微调；Home 恢复默认" onPointerDown={event => resize(event, 'corner')} onKeyDown={keyboard} onDoubleClick={() => commitNodeSize(editor, getPos, node.type.name, { blockWidth: 100, blockHeight: null })} />
    </>}
  </NodeViewWrapper>;
}
