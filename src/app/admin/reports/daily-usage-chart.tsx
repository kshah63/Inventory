"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipProps,
} from "recharts";

export interface DailyUsagePoint {
  day: string; // YYYY-MM-DD (Asia/Singapore)
  total_qty: number;
}

// Chart colors must be literal strings (SVG attributes can't resolve CSS vars).
// These match the theme tokens in globals.css: --primary / --border / --muted-foreground.
const NAVY = "hsl(222 63% 22%)";
const GRID = "hsl(220 20% 88%)";
const INK_MUTED = "hsl(220 12% 44%)";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function formatDayTick(day: string): string {
  const parts = day.split("-");
  if (parts.length !== 3) return day;
  return `${Number(parts[2])} ${MONTHS[Number(parts[1]) - 1] ?? ""}`;
}

function ChartTooltip({ active, payload, label }: TooltipProps<number, string>) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="rounded-md border bg-card px-3 py-2 text-xs shadow-md">
      <p className="font-medium">{formatDayTick(String(label))}</p>
      <p className="mt-0.5 text-muted-foreground">
        <span className="font-medium tabular-nums text-foreground">{payload[0].value ?? 0}</span>{" "}
        units checked out
      </p>
    </div>
  );
}

/** Single-series area chart of daily checkout volume. Data arrives pre-filled
 * (zero rows for quiet days) from the server component. */
export function DailyUsageChart({ data }: { data: DailyUsagePoint[] }) {
  return (
    <div className="h-[280px] w-full">
      <ResponsiveContainer width="100%" height={280}>
        <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="dailyUsageFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={NAVY} stopOpacity={0.22} />
              <stop offset="100%" stopColor={NAVY} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={GRID} strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="day"
            tickFormatter={formatDayTick}
            tick={{ fontSize: 11, fill: INK_MUTED }}
            tickLine={false}
            axisLine={false}
            minTickGap={28}
            tickMargin={8}
          />
          <YAxis
            allowDecimals={false}
            width={36}
            tick={{ fontSize: 11, fill: INK_MUTED }}
            tickLine={false}
            axisLine={false}
          />
          <Tooltip
            content={ChartTooltip}
            cursor={{ stroke: INK_MUTED, strokeWidth: 1, strokeDasharray: "3 3" }}
          />
          <Area
            type="monotone"
            dataKey="total_qty"
            name="Units checked out"
            stroke={NAVY}
            strokeWidth={2}
            fill="url(#dailyUsageFill)"
            activeDot={{ r: 4, fill: NAVY, stroke: "hsl(0 0% 100%)", strokeWidth: 2 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
