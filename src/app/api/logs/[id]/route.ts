import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireUser } from '@/lib/server-user';
import { LOG_INCLUDE } from '@/lib/log-query';

/** A single submitted log, readable by any signed-in member like the team feed. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await requireUser();
    if (actor instanceof NextResponse) return actor;
    const { id } = await params;
    const log = await prisma.workLog.findUnique({ where: { id }, include: LOG_INCLUDE });
    if (!log) return NextResponse.json({ error: '日志不存在或已被删除。' }, { status: 404 });
    return NextResponse.json(log);
  } catch (error) {
    console.error('Error fetching log:', error);
    return NextResponse.json({ error: 'Failed to fetch log' }, { status: 500 });
  }
}
