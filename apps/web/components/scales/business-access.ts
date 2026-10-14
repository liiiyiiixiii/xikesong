export interface HistoryStatus {
  phase: string | null;
  start?: string | null;
  end?: string | null;
  mode?: string | null;
  simulation?: { enabled: boolean } | null;
}

export function businessAccess(history: { data?: HistoryStatus; loading: boolean; error?: string }) {
  const unavailable = history.error ? '数据状态暂不可用，恢复后才能保存。'
    : history.loading || !history.data ? '正在核对数据状态，暂不可保存。' : '';
  const scenario = history.data?.phase === 'ready' && history.data.mode === 'scenario';
  const scenarioReason = scenario ? '当前为模拟数据集只读回放，可查看记录，不能修改。' : '';
  const frozen = history.data?.phase === 'ready' && !history.data.simulation?.enabled;
  return {
    scenario,
    scalesReadOnlyReason: unavailable || scenarioReason || (frozen ? '历史数据已冻结，可查看记录，不能修改设备或备料数据。' : ''),
    freshnessReadOnlyReason: unavailable || scenarioReason,
  };
}
