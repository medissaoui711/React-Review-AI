const LATENCY_BUCKETS_MS = [10, 50, 100, 250, 500, 1000, 5000];

export function createRuntimeMetrics() {
  const counters = {
    http_requests_total: 0,
    http_aborted_total: 0,
    http_rate_limited_total: 0,
    analysis_runs_total: 0,
    analysis_timeouts_total: 0,
    analysis_parse_errors_total: 0,
    analysis_truncated_total: 0,
    analysis_findings_total: 0,
    analysis_bytes_total: 0,
    analysis_duration_ms_total: 0,
    analysis_duration_ms_max: 0
  };
  const requestsByRoute = {
    mcp: 0,
    health: 0,
    readiness: 0,
    oauth_metadata: 0,
    other: 0
  };
  const requestsByStatusClass = { '2xx': 0, '3xx': 0, '4xx': 0, '5xx': 0, other: 0 };
  const latencyBuckets = Object.fromEntries(
    [...LATENCY_BUCKETS_MS.map(value => `le_${value}ms`), 'gt_5000ms'].map(key => [key, 0])
  );

  return Object.freeze({
    recordHttp({ route, status, durationMs, aborted = false }) {
      counters.http_requests_total += 1;
      if (aborted) counters.http_aborted_total += 1;
      if (Object.hasOwn(requestsByRoute, route)) requestsByRoute[route] += 1;
      const statusClass = Number.isInteger(status) ? `${Math.floor(status / 100)}xx` : 'other';
      if (Object.hasOwn(requestsByStatusClass, statusClass)) requestsByStatusClass[statusClass] += 1;
      else requestsByStatusClass.other += 1;
      const duration = Math.max(0, Number(durationMs) || 0);
      let matched = false;
      for (const bound of LATENCY_BUCKETS_MS) {
        if (duration <= bound) {
          latencyBuckets[`le_${bound}ms`] += 1;
          matched = true;
        }
      }
      if (!matched) latencyBuckets.gt_5000ms += 1;
    },

    recordRateLimit() {
      counters.http_rate_limited_total += 1;
    },

    recordAnalysis({ durationMs = 0, parseErrors = 0, timedOut = false, truncated = false, findings = 0, bytesRead = 0 } = {}) {
      counters.analysis_runs_total += 1;
      if (timedOut) counters.analysis_timeouts_total += 1;
      if (truncated) counters.analysis_truncated_total += 1;
      counters.analysis_parse_errors_total += Math.max(0, Number(parseErrors) || 0);
      counters.analysis_findings_total += Math.max(0, Number(findings) || 0);
      counters.analysis_bytes_total += Math.max(0, Number(bytesRead) || 0);
      const duration = Math.max(0, Number(durationMs) || 0);
      counters.analysis_duration_ms_total += duration;
      counters.analysis_duration_ms_max = Math.max(counters.analysis_duration_ms_max, duration);
    },

    snapshot() {
      return {
        counters: { ...counters },
        http_requests_by_route: { ...requestsByRoute },
        http_requests_by_status_class: { ...requestsByStatusClass },
        http_request_duration_ms_buckets: { ...latencyBuckets }
      };
    }
  });
}
