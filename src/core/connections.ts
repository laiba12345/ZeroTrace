import { PROVIDER_ORDER, getProvider } from "@/providers";
import type { ConnectionHealth } from "@/providers/types";

// Phase A — connection gate. A harmless read against each provider; the UI
// must not enable preflight unless all three come back "connected".
export async function checkAllConnections(): Promise<ConnectionHealth[]> {
  return Promise.all(PROVIDER_ORDER.map((name) => getProvider(name).checkConnection()));
}
