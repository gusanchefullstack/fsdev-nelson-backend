// Placeholder until alerts are implemented (US8)
export function evaluateEndedIncomeBuckets(_userId: string, _timeZone: string): Promise<void> {
  return Promise.resolve();
}

export function listAlerts(_userId: string, _opts: { unreadOnly?: boolean }) {
  return Promise.resolve({ data: [] as unknown[], unreadCount: 0 });
}
