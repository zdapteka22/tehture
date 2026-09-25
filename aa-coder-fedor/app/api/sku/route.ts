import { isFreeEdition } from "@/lib/brand";

export function GET() {
  return Response.json({ free: isFreeEdition() });
}
