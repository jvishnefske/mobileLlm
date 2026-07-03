// Device tools the agent can call. Each one uses a web API that is
// available in both Android and iOS browsers.

export interface ToolDef {
  name: string;
  description: string;
  parameters: string; // human-readable parameter description for the prompt
  run(args: Record<string, unknown>): Promise<string>;
}

function safeCalculate(expression: string): string {
  // Only allow arithmetic characters — no identifiers, so nothing in scope
  // can be referenced by the evaluated expression.
  if (!/^[\d\s+\-*/%().,eE]+$/.test(expression) || /[a-df-zA-DF-Z]/.test(expression)) {
    throw new Error('Expression may only contain numbers and + - * / % ( )');
  }
  const result = new Function(`"use strict"; return (${expression});`)();
  if (typeof result !== 'number' || !Number.isFinite(result)) {
    throw new Error('Expression did not evaluate to a finite number');
  }
  return String(result);
}

export const TOOLS: ToolDef[] = [
  {
    name: 'get_time',
    description: 'Get the current local date and time on this device.',
    parameters: 'none',
    async run() {
      const now = new Date();
      return JSON.stringify({
        iso: now.toISOString(),
        local: now.toLocaleString(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });
    },
  },
  {
    name: 'calculate',
    description:
      'Evaluate an arithmetic expression, e.g. "(17 * 32) / 4". Use this for any math.',
    parameters: '{"expression": "<arithmetic expression>"}',
    async run(args) {
      return safeCalculate(String(args.expression ?? ''));
    },
  },
  {
    name: 'get_location',
    description:
      'Get the device GPS position (latitude/longitude). The user will see a permission prompt.',
    parameters: 'none',
    async run() {
      const pos = await new Promise<GeolocationPosition>((resolve, reject) =>
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          timeout: 15000,
          maximumAge: 60000,
        })
      );
      return JSON.stringify({
        latitude: pos.coords.latitude.toFixed(5),
        longitude: pos.coords.longitude.toFixed(5),
        accuracy_m: Math.round(pos.coords.accuracy),
      });
    },
  },
  {
    name: 'device_info',
    description:
      'Get information about this device: platform, language, online/offline state, screen size, memory.',
    parameters: 'none',
    async run() {
      const nav = navigator as Navigator & { deviceMemory?: number };
      return JSON.stringify({
        platform: nav.platform || 'unknown',
        userAgent: nav.userAgent,
        language: nav.language,
        online: nav.onLine,
        screen: `${screen.width}x${screen.height}`,
        cpu_cores: nav.hardwareConcurrency,
        device_memory_gb: nav.deviceMemory ?? 'unknown',
        installed_as_app: matchMedia('(display-mode: standalone)').matches,
      });
    },
  },
];

export function findTool(name: string): ToolDef | undefined {
  return TOOLS.find((t) => t.name === name);
}
