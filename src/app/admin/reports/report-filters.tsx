"use client";

import { useRouter } from "next/navigation";
import { Select } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

export type ReportGroupBy = "user" | "item" | "category" | "department" | "zone";

/** Range + group-by controls. Both write to the URL so the page stays
 * server-rendered — every change is a normal navigation. */
export function ReportFilters({ range, by }: { range: number; by: ReportGroupBy }) {
  const router = useRouter();

  function push(nextRange: number, nextBy: string) {
    router.push(`/admin/reports?range=${nextRange}&by=${nextBy}`);
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Tabs value={String(range)} onValueChange={(v) => push(Number(v), by)}>
        <TabsList>
          <TabsTrigger value="7">7 days</TabsTrigger>
          <TabsTrigger value="30">30 days</TabsTrigger>
          <TabsTrigger value="90">90 days</TabsTrigger>
        </TabsList>
      </Tabs>
      <Select
        aria-label="Group consumption by"
        value={by}
        onChange={(e) => push(range, e.target.value)}
        className="w-44"
      >
        <option value="item">By item</option>
        <option value="user">By user</option>
        <option value="zone">By zone</option>
        <option value="category">By category</option>
        <option value="department">By department</option>
      </Select>
    </div>
  );
}
