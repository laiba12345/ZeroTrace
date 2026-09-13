import { NextResponse } from "next/server";
import { prisma } from "@/db/client";

// Lists recent runs so the app can reconstruct state on reload instead of
// losing the audit trail (section 12).
export async function GET() {
  const runs = await prisma.run.findMany({
    orderBy: { createdAt: "desc" },
    take: 25,
    select: {
      id: true,
      rawInstruction: true,
      status: true,
      createdAt: true,
      completedAt: true,
      resolvedIdentity: true,
      resolvedProject: true,
    },
  });
  return NextResponse.json({ runs });
}
