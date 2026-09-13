import { prisma } from "@/db/client";

export const dynamic = "force-dynamic";

// Server-Sent Events stream of RunEvent rows, polling the DB at a short
// interval. Simpler and just as real as a pub/sub bus for a single-instance
// demo — every event streamed is a row that was actually persisted.
export async function GET(_req: Request, context: { params: Promise<{ runId: string }> }) {
  const { runId } = await context.params;

  const encoder = new TextEncoder();
  let closed = false;

  const stream = new ReadableStream({
    async start(controller) {
      let lastCreatedAt = new Date(0);
      const send = (event: string, data: unknown) => {
        if (closed) return;
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      const poll = async () => {
        if (closed) return;
        try {
          const [events, run] = await Promise.all([
            prisma.runEvent.findMany({
              where: { runId, createdAt: { gt: lastCreatedAt } },
              orderBy: { createdAt: "asc" },
            }),
            prisma.run.findUnique({ where: { id: runId }, select: { status: true } }),
          ]);

          for (const e of events) {
            send("run-event", e);
            lastCreatedAt = e.createdAt;
          }

          if (run) {
            send("run-status", { status: run.status });
            if (["COMPLETE", "INCOMPLETE", "UNVERIFIED", "BLOCKED", "SAFETY_VIOLATION"].includes(run.status)) {
              controller.close();
              closed = true;
              clearInterval(interval);
              return;
            }
          }
        } catch {
          // transient DB hiccup — keep polling, next tick will catch up
        }
      };

      await poll();
      const interval = setInterval(poll, 750);

      const abort = () => {
        closed = true;
        clearInterval(interval);
        try {
          controller.close();
        } catch {
          // already closed
        }
      };
      // Best-effort cleanup if the client disconnects.
      setTimeout(abort, 10 * 60 * 1000);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
