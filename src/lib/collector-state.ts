/** 状态独立于考勤事件；一天没有新事件不表示监听器失效。 */
export interface CollectorState {
  mode: "power";
  pid: number;
  helper_pid: number | null;
  ready: boolean;
  running: boolean;
  last_event_at: number | null;
}
