import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireUser, forbiddenIdentity } from '@/lib/server-user';
import { parseDocument } from '@/components/editor/utils/document';
import { LOG_INCLUDE } from '@/lib/log-query';

export async function GET(req: Request) {
  try {
    const actor = await requireUser();
    if (actor instanceof NextResponse) return actor;
    const { searchParams } = new URL(req.url);
    const userId = searchParams.get('userId');
    const teamId = searchParams.get('teamId');
    const date = searchParams.get('date');
    const startDate = searchParams.get('startDate');
    const endDate = searchParams.get('endDate');
    const tag = searchParams.get('tag');
    const hasBlocker = searchParams.get('hasBlocker');
    const keyword = searchParams.get('keyword');

    const where: any = {};

    if (userId) {
      where.userId = userId;
    }

    if (teamId) {
      where.user = { teamId };
    }

    if (date) {
      where.date = date;
    } else if (startDate || endDate) {
      where.date = {};
      if (startDate) where.date.gte = startDate;
      if (endDate) where.date.lte = endDate;
    }

    if (hasBlocker !== null && hasBlocker !== undefined && hasBlocker !== '') {
      where.hasBlocker = hasBlocker === 'true';
    }

    if (tag) {
      where.tags = {
        some: {
          tag: {
            name: tag,
          },
        },
      };
    }

    if (keyword) {
      where.OR = [
        { title: { contains: keyword } },
        { contentText: { contains: keyword } },
      ];
    }

    const logs = await prisma.workLog.findMany({
      where,
      include: LOG_INCLUDE,
      orderBy: [
        { date: 'desc' },
        { createdAt: 'desc' },
      ],
    });

    return NextResponse.json(logs);
  } catch (error) {
    console.error('Error fetching logs:', error);
    return NextResponse.json({ error: 'Failed to fetch logs' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const actor = await requireUser();
    if (actor instanceof NextResponse) return actor;
    const body = await req.json();
    const { date, title, contentJson, contentText, mood, tagNames } = body;
    if (body.userId !== undefined && body.userId !== actor.id) return forbiddenIdentity();
    const userId = actor.id;

    if (!userId || !date) {
      return NextResponse.json({ error: 'userId and date are required' }, { status: 400 });
    }

    let document;
    try { document = parseDocument(contentJson); }
    catch { return NextResponse.json({ error: 'Invalid document content' }, { status: 400 }); }
    const cleanTags = Array.isArray(tagNames)
      ? [...new Set(tagNames.filter((name): name is string => typeof name === 'string').map(name => name.trim().replace(/^#+/, '').trim()).filter(Boolean))]
      : null;

    // Auto-detect blocker from text content
    const textToCheck = (contentText || '') + ' ' + (title || '');
    const hasBlocker = /【Blocker】|blocker|卡点|阻塞|风险|阻碍/i.test(textToCheck);

    // Save the document and tag associations atomically.
    const fullLog = await prisma.$transaction(async (tx) => {
      const workLog = await tx.workLog.upsert({
        where: {
          userId_date: {
            userId,
            date,
          },
        },
        update: {
          title: title || null,
          contentJson: JSON.stringify(document),
          contentText: contentText || '',
          hasBlocker,
          mood: mood || null,
        },
        create: {
          userId,
          date,
          title: title || null,
          contentJson: JSON.stringify(document),
          contentText: contentText || '',
          hasBlocker,
          mood: mood || '🚀',
        },
      });

      // Handle Tags association if provided
      if (cleanTags !== null) {
        // Clear existing tags
        await tx.tagOnLog.deleteMany({
          where: { logId: workLog.id },
        });

        for (const tagName of cleanTags) {
          if (!tagName) continue;
          const tag = await tx.tag.upsert({
            where: { name: tagName.trim() },
            update: {},
            create: { name: tagName.trim() },
          });

          await tx.tagOnLog.create({
            data: {
              logId: workLog.id,
              tagId: tag.id,
            },
          });
        }
      }

      // Return the updated log with relations
      return tx.workLog.findUnique({
        where: { id: workLog.id },
        include: LOG_INCLUDE,
      });

    });
    return NextResponse.json(fullLog);
  } catch (error) {
    console.error('Error saving log:', error);
    return NextResponse.json({ error: 'Failed to save log' }, { status: 500 });
  }
}
