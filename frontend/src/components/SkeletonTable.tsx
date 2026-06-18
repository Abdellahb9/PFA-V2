// Generic, typed table that shows an AntD Skeleton while data loads, then the
// real Table. The skeleton reuses the same column definitions so there is no
// layout shift when the data arrives. A subtle overlay is shown on background
// refetches (React Query `isFetching`).
import type { Key } from "react";
import { Skeleton, Table } from "antd";
import type { TableProps } from "antd";

type SkeletonTableProps<RecordType> = TableProps<RecordType> & {
  /** Initial load (no data yet) -> render the skeleton. */
  loading: boolean;
  /** Background refetch -> subtle spin overlay on the real table. */
  fetching?: boolean;
  /** Number of skeleton rows to display while loading. */
  skeletonRows?: number;
};

export default function SkeletonTable<RecordType extends object>({
  loading,
  fetching = false,
  skeletonRows = 6,
  columns = [],
  ...rest
}: SkeletonTableProps<RecordType>) {
  if (loading) {
    const placeholder = Array.from({ length: skeletonRows }, (_, i) => ({ key: i }));
    // Same columns, but each cell renders a skeleton block -> identical layout.
    const skeletonColumns = columns.map((col, index) => ({
      ...col,
      key: (col as { key?: Key }).key ?? index,
      render: () => <Skeleton.Input active block size="small" style={{ height: 18 }} />,
    })) as unknown as TableProps<{ key: number }>["columns"];

    return (
      <div role="status" aria-busy="true" aria-live="polite">
        <Table<{ key: number }>
          columns={skeletonColumns}
          dataSource={placeholder}
          rowKey="key"
          pagination={false}
        />
        <span className="sr-only">Chargement des données…</span>
      </div>
    );
  }

  return (
    <div className="phos-fade-in">
      <Table<RecordType> columns={columns} loading={fetching} {...rest} />
    </div>
  );
}
