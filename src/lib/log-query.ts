import type { Prisma } from '@prisma/client';

/** Everything a reader needs to render a log with its people and feedback. */
export const LOG_INCLUDE = {
  user: { include: { team: true } },
  tags: { include: { tag: true } },
  reactions: { include: { user: true } },
  comments: { include: { user: true }, orderBy: { createdAt: 'asc' } },
} satisfies Prisma.WorkLogInclude;
