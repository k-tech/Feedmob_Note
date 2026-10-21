import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import type { NodeViewProps } from '@tiptap/react';
import { ResizableBlock, blockSizeAttributes } from '../ResizableBlock';
import React, { useRef, useState, useEffect } from 'react';
import { Palette, Trash2, Undo, PenTool, Square, MoveRight } from 'lucide-react';

const WhiteboardComponent = (props: NodeViewProps) => {
  const { node, updateAttributes, editor } = props;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [color, setColor] = useState('#2563eb');
  const [lineWidth, setLineWidth] = useState(3);
  const [tool, setTool] = useState<'pen' | 'rect' | 'arrow'>('pen');
  const latestDataRef = useRef<string | null>(null);
  const drawingRef = useRef(false);
  const startPos = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  // Attributes are the source of truth, including editor undo/redo.
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx || latestDataRef.current === node.attrs.dataUrl) return;
    latestDataRef.current = node.attrs.dataUrl;
    let cancelled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (node.attrs.dataUrl) {
      const img = new Image();
      img.onload = () => { if (!cancelled) { ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.drawImage(img, 0, 0); } };
      img.src = node.attrs.dataUrl;
    }
    return () => { cancelled = true; };
  }, [node.attrs.dataUrl]);

  const saveCanvas = () => {
    if (canvasRef.current) {
      const dataUrl = canvasRef.current.toDataURL();
      latestDataRef.current = dataUrl;
      updateAttributes({ dataUrl });
    }
  };

  const getPos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left) * canvas.width / rect.width,
      y: (e.clientY - rect.top) * canvas.height / rect.height,
    };
  };

  const editable = editor.isEditable;
  const startDraw = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0 || !editor.isEditable) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drawingRef.current = true;
    const pos = getPos(e);
    startPos.current = pos;
    setIsDrawing(true);
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!ctx) return;

    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
  };

  const draw = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!ctx) return;

    const pos = getPos(e);

    if (tool === 'pen') {
      ctx.lineTo(pos.x, pos.y);
      ctx.stroke();
    }
  };

  const stopDraw = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    const pos = getPos(e);

    if (ctx && tool === 'rect') {
      const width = pos.x - startPos.current.x;
      const height = pos.y - startPos.current.y;
      ctx.strokeRect(startPos.current.x, startPos.current.y, width, height);
    } else if (ctx && tool === 'arrow') {
      ctx.beginPath();
      ctx.moveTo(startPos.current.x, startPos.current.y);
      ctx.lineTo(pos.x, pos.y);
      const angle = Math.atan2(pos.y - startPos.current.y, pos.x - startPos.current.x);
      const head = 12;
      ctx.moveTo(pos.x - head * Math.cos(angle - Math.PI / 6), pos.y - head * Math.sin(angle - Math.PI / 6));
      ctx.lineTo(pos.x, pos.y);
      ctx.lineTo(pos.x - head * Math.cos(angle + Math.PI / 6), pos.y - head * Math.sin(angle + Math.PI / 6));
      ctx.stroke();
    }

    drawingRef.current = false;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    setIsDrawing(false);
    saveCanvas();
    // Drawing happens outside the text; keep Cmd/Ctrl+Z undoing the stroke.
    editor.view.focus();
  };

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (ctx && canvas) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      // An empty board stores nothing rather than a blank image.
      latestDataRef.current = null;
      updateAttributes({ dataUrl: null });
    }
  };

  return (
    <ResizableBlock {...props} className="my-4 border border-[var(--border)] rounded-md overflow-hidden bg-[var(--background)]">
      {/* Header bar: drawing tools belong to the author */}
      {editable && <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 px-3 py-2 bg-[var(--muted)] text-sm text-[var(--foreground)] border-b border-[var(--border)]">
        <div className="flex items-center gap-2">
          <Palette className="w-4 h-4 text-[var(--muted-foreground)]" />
          <span className="font-medium text-[var(--foreground)]">草图白板</span>
        </div>

        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {/* Tool selector */}
          <div className="flex items-center bg-[var(--background)] rounded p-0.5 border border-[var(--border)]">
            <button
              type="button"
              onClick={() => setTool('pen')}
              className={`p-1.5 rounded-md ${tool === 'pen' ? 'bg-[var(--selection)] text-[var(--accent)] ' : 'text-[var(--foreground)] '}`}
              aria-label="画笔"
              aria-pressed={tool === 'pen'}
              title="画笔"
            >
              <PenTool className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setTool('rect')}
              className={`p-1.5 rounded-md ${tool === 'rect' ? 'bg-[var(--selection)] text-[var(--accent)] ' : 'text-[var(--foreground)] '}`}
              aria-label="矩形"
              aria-pressed={tool === 'rect'}
              title="矩形"
            >
              <Square className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setTool('arrow')}
              className={`p-1.5 rounded-md ${tool === 'arrow' ? 'bg-[var(--selection)] text-[var(--accent)] ' : 'text-[var(--foreground)] '}`}
              aria-label="箭头"
              aria-pressed={tool === 'arrow'}
              title="箭头"
            >
              <MoveRight className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Color picker */}
          <div className="flex items-center gap-1.5">
            {['#2563eb', '#16a34a', '#dc2626', '#f59e0b', '#0f172a'].map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                aria-label={`画笔颜色 ${c}`}
                aria-pressed={color === c}
                className={`w-5 h-5 rounded-full border border-[var(--border)] ${color === c ? 'ring-2 ring-[var(--accent)]' : ''}`}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>

          <button type="button" onClick={() => editor.commands.undo()} aria-label="撤销白板操作" title="撤销" className="p-1.5 text-[var(--muted-foreground)]"><Undo className="w-4 h-4" /></button>
          <button
            type="button"
            onClick={clearCanvas}
            className="p-1.5 text-[var(--muted-foreground)] hover:text-red-500 transition rounded hover:bg-[var(--muted)]"
            aria-label="清空白板" title="清空白板"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>}


      {/* Canvas Area */}
      <div className="p-2 flex min-w-0 justify-center bg-[var(--muted)] overflow-x-auto">
        <canvas
          ref={canvasRef}
          aria-label="草图绘画区域"
          width={960}
          height={280}
          onPointerDown={startDraw}
          onPointerMove={draw}
          onPointerUp={stopDraw}
          onPointerCancel={stopDraw}
          style={{ touchAction: editable ? 'none' : 'auto' }}
          className={`resizable-block-body whiteboard-canvas border border-dashed border-[var(--border)] bg-[var(--background)] rounded-md ${editable ? 'cursor-crosshair' : ''}`}
        />
      </div>
    </ResizableBlock>
  );

};

export const WhiteboardNode = Node.create({
  name: 'whiteboard',
  group: 'block',
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      ...blockSizeAttributes,
      dataUrl: {
        default: null,
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="whiteboard"]',
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'whiteboard' })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(WhiteboardComponent);
  },
});
